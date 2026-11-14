// Configuración del agente editable desde el panel (proveedor principal y uno de respaldo), sin tocar
// .env ni el código. Las API keys se cifran con SESSION_SECRET (AES-256-GCM) y nunca se devuelven en
// texto plano al frontend: solo se informa si hay una guardada y sus últimos 4 caracteres.
// Si no se configura nada aquí, el agente sigue funcionando exactamente igual que antes (variables de entorno).
import crypto from 'node:crypto';
import { oltp, sql } from '../db.js';
import { proveedorAnthropic } from './proveedores/anthropic.js';
import { proveedorGemini } from './proveedores/gemini.js';
import { proveedorGroq } from './proveedores/groq.js';
import { proveedorMock } from './proveedores/mock.js';
import { proveedorOpenAI } from './proveedores/openai.js';
import type { ProveedorLLM } from './tipos.js';

export type Slot = 'PRIMARIO' | 'SECUNDARIO';
export const PROVEEDORES = ['mock', 'anthropic', 'openai', 'gemini', 'groq'] as const;
export type NombreProveedor = (typeof PROVEEDORES)[number];
const UMBRAL_RESPALDO_MS = 60_000;

function claveSecreta(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('Falta SESSION_SECRET en .env (lo genera `npm run setup`).');
  return crypto.createHash('sha256').update(s).digest();
}
function cifrar(texto: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', claveSecreta(), iv);
  const datos = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), datos].map((b) => b.toString('base64')).join('.');
}
function descifrar(cifrado: string): string {
  const [ivB64, tagB64, datosB64] = cifrado.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', claveSecreta(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(datosB64, 'base64')), decipher.final()]).toString('utf8');
}

interface FilaInterna { proveedor: NombreProveedor; modelo: string | null; apiKeyCifrada: string | null; activo: boolean; actualizado: Date }
async function filas(): Promise<Map<Slot, FilaInterna>> {
  const r = await (await oltp()).request().query('SELECT slot, proveedor, modelo, api_key_cifrada, activo, actualizado FROM dbo.CONFIGURACION_AGENTE');
  const m = new Map<Slot, FilaInterna>();
  for (const x of r.recordset) m.set(x.slot, { proveedor: x.proveedor, modelo: x.modelo, apiKeyCifrada: x.api_key_cifrada, activo: !!x.activo, actualizado: x.actualizado });
  return m;
}

export interface FilaConfiguracion { slot: Slot; proveedor: NombreProveedor; modelo: string | null; activo: boolean; keyConfigurada: boolean; keySufijo: string | null }

/** Para el formulario de ajustes: nunca incluye la key completa. */
export async function leerConfiguracion(): Promise<FilaConfiguracion[]> {
  const m = await filas();
  return (['PRIMARIO', 'SECUNDARIO'] as Slot[]).map((slot) => {
    const f = m.get(slot);
    if (!f) return { slot, proveedor: 'mock' as NombreProveedor, modelo: null, activo: false, keyConfigurada: false, keySufijo: null };
    let keySufijo: string | null = null;
    if (f.apiKeyCifrada) { try { keySufijo = descifrar(f.apiKeyCifrada).slice(-4); } catch { keySufijo = '????'; } }
    return { slot, proveedor: f.proveedor, modelo: f.modelo, activo: f.activo, keyConfigurada: !!f.apiKeyCifrada, keySufijo };
  });
}

/** Guarda un slot. Si no se manda apiKey, conserva la que ya hubiera (para solo cambiar modelo o activo/inactivo). */
export async function guardarConfiguracion(slot: Slot, datos: { proveedor: NombreProveedor; modelo?: string | null; apiKey?: string; activo: boolean }) {
  const pool = await oltp();
  const existente = (await pool.request().input('s', sql.VarChar(10), slot).query('SELECT api_key_cifrada FROM dbo.CONFIGURACION_AGENTE WHERE slot = @s')).recordset[0];
  const apiKeyCifrada = datos.apiKey ? cifrar(datos.apiKey) : existente?.api_key_cifrada ?? null;
  await pool.request().input('s', sql.VarChar(10), slot).input('p', sql.VarChar(20), datos.proveedor).input('m', sql.VarChar(80), datos.modelo?.trim() || null)
    .input('k', sql.NVarChar(600), apiKeyCifrada).input('a', sql.Bit, datos.activo).query(`
      MERGE dbo.CONFIGURACION_AGENTE AS d USING (SELECT @s AS slot) AS s ON d.slot = s.slot
      WHEN MATCHED THEN UPDATE SET proveedor = @p, modelo = @m, api_key_cifrada = @k, activo = @a, actualizado = SYSDATETIME()
      WHEN NOT MATCHED THEN INSERT (slot, proveedor, modelo, api_key_cifrada, activo) VALUES (@s, @p, @m, @k, @a);`);
  invalidarCache();
}

/** Borra la key guardada de un slot (vuelve a quedar sin configurar: ese slot se apaga). */
export async function borrarKey(slot: Slot) {
  await (await oltp()).request().input('s', sql.VarChar(10), slot)
    .query(`UPDATE dbo.CONFIGURACION_AGENTE SET api_key_cifrada = NULL, activo = 0 WHERE slot = @s`);
  invalidarCache();
}

function construir(proveedor: NombreProveedor, modelo: string | null, apiKey: string | null): ProveedorLLM | null {
  const m = modelo?.trim() || undefined;
  if (proveedor === 'mock') return proveedorMock();
  if (!apiKey) return null;
  if (proveedor === 'anthropic') return proveedorAnthropic(apiKey, m ?? 'claude-haiku-5-5', 'medium', false);
  if (proveedor === 'openai') return proveedorOpenAI(apiKey, m ?? 'gpt-4.1-mini');
  if (proveedor === 'gemini') return proveedorGemini(apiKey, m ?? 'gemini-3.1-flash-lite');
  if (proveedor === 'groq') return proveedorGroq(apiKey, m ?? 'openai/gpt-oss-20b');
  return null;
}

let cache: { t: number; primario: ProveedorLLM; primarioDesdeBD: boolean; secundario: ProveedorLLM | null } | null = null;
function invalidarCache() { cache = null; }

/** `proveedorEnv` es el proveedor que ya resuelve el .env (obtenerProveedor() de motor.ts): se usa como
 *  principal mientras no haya nada guardado aquí, para no cambiar el comportamiento de quien no usa este panel. */
export async function proveedoresActivos(proveedorEnv: ProveedorLLM): Promise<{ primario: ProveedorLLM; primarioDesdeBD: boolean; secundario: ProveedorLLM | null }> {
  if (cache && Date.now() - cache.t < 60_000) return cache;
  const m = await filas();
  const pr = m.get('PRIMARIO');
  const primarioBD = (pr?.activo && construir(pr.proveedor, pr.modelo, pr.apiKeyCifrada ? descifrar(pr.apiKeyCifrada) : null)) || null;
  const se = m.get('SECUNDARIO');
  const secundario = (se?.activo && construir(se.proveedor, se.modelo, se.apiKeyCifrada ? descifrar(se.apiKeyCifrada) : null)) || null;
  const v = { t: Date.now(), primario: primarioBD || proveedorEnv, primarioDesdeBD: !!primarioBD, secundario };
  cache = v;
  return v;
}

/** Llama al principal; si no responde en 60 s o falla, llama también al de respaldo (si hay uno activo) y
 *  usa el que responda primero. El principal sigue su curso, pero su resultado se descarta si ya hay ganador.
 *  `alDecidir` se invoca justo cuando hay ganador, para que quien llama pueda bloquear efectos tardíos del otro intento
 *  (p. ej. que siga llamando herramientas después de que el turno ya se respondió). */
export async function responderConRespaldo<T>(proveedorEnv: ProveedorLLM, llamar: (p: ProveedorLLM) => Promise<T>, alDecidir?: () => void):
  Promise<{ resultado: T; proveedor: ProveedorLLM }> {
  const { primario, secundario } = await proveedoresActivos(proveedorEnv);
  if (!secundario) return { resultado: await llamar(primario), proveedor: primario };
  return new Promise((resolve, reject) => {
    let decidido = false;
    let secundarioEnCurso = false;
    const decidir = () => { decidido = true; alDecidir?.(); };
    let timer: NodeJS.Timeout | null = setTimeout(() => { timer = null; intentarSecundario(); }, UMBRAL_RESPALDO_MS);
    const intentarSecundario = () => {
      if (decidido || secundarioEnCurso) return;
      secundarioEnCurso = true;
      llamar(secundario).then((resultado) => { if (!decidido) { decidir(); resolve({ resultado, proveedor: secundario }); } })
        .catch((e) => { if (!decidido) { decidir(); reject(e); } });
    };
    llamar(primario).then((resultado) => { if (!decidido) { decidir(); if (timer) clearTimeout(timer); resolve({ resultado, proveedor: primario }); } })
      .catch(() => { if (timer) { clearTimeout(timer); timer = null; } intentarSecundario(); });
  });
}
