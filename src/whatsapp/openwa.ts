// Integración con OpenWA (gateway de WhatsApp Web, proceso aparte en vendor/OpenWA).
// - Sesión: la crea/arranca la app; el QR se muestra en la pantalla Conversaciones.
// - Entrada: OpenWA llama a POST /api/whatsapp/webhook firmado con HMAC-SHA256 (X-OpenWA-Signature).
// - Reglas: solo números de WHATSAPP_ALLOWLIST; la primera conversación de un número empieza solo con la
//   frase de activación (el agente nunca escribe primero); se ignoran grupos, estados, mensajes propios y viejos.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ, config } from '../config.js';
import { oltp, sql } from '../db.js';
import { asegurarConversacionWhatsApp } from '../agente/conversaciones.js';
import { normalizar } from '../agente/guardas.js';
import { procesarMensajeEntrante } from '../agente/motor.js';
import { publicar } from '../server/eventos.js';

export type EstadoWhatsApp = 'NO_CONFIGURADO' | 'SIN_CONEXION' | 'DESCONECTADO' | 'CONECTANDO' | 'ESPERANDO_QR' | 'CONECTADO' | 'ERROR';

const cfg = () => ({
  habilitado: !/^false$/i.test(process.env.OPENWA_ENABLED || ''),
  url: (process.env.OPENWA_URL || 'http://localhost:2785').replace(/\/$/, ''),
  sesion: process.env.OPENWA_SESSION_ID || 'inbestiga-demo',
  secreto: process.env.OPENWA_WEBHOOK_SECRET || '',
  allowlist: (process.env.WHATSAPP_ALLOWLIST || '').split(',').map((x) => x.replace(/\D/g, '')).filter(Boolean),
  frase: process.env.WHATSAPP_ACTIVATION_PHRASE || 'Hola, quiero información de asesoría de tesis',
});

function apiKey(): string {
  if (process.env.OPENWA_API_KEY) return process.env.OPENWA_API_KEY;
  try { return fs.readFileSync(path.join(RAIZ, 'vendor', 'OpenWA', 'data', '.api-key'), 'utf8').trim(); } catch { return ''; }
}

const estado = { estado: 'NO_CONFIGURADO' as EstadoWhatsApp, sesionId: null as string | null, telefono: null as string | null, nombre: null as string | null,
  detalle: null as string | null, webhookListo: false, actualizado: new Date() };

/** Actualiza el estado y avisa a la UI SOLO si cambió algo visible (evita ciclos evento → consulta → evento). */
function fijarEstado(cambios: Partial<typeof estado>) {
  const antes = JSON.stringify(resumenEstado());
  Object.assign(estado, cambios, { actualizado: new Date() });
  if (JSON.stringify(resumenEstado()) !== antes) publicar('whatsapp', resumenEstado());
}

export const resumenEstado = () => {
  const c = cfg();
  return { estado: estado.estado, telefono: estado.telefono, nombre: estado.nombre, detalle: estado.detalle, sesion: c.sesion,
    numerosPermitidos: c.allowlist.length, fraseActivacion: c.frase, webhookListo: estado.webhookListo };
};

class ErrorOpenWA extends Error { constructor(public estadoHttp: number, m: string) { super(m); } }

async function llamar<T = any>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  const key = apiKey();
  if (!key) throw new ErrorOpenWA(0, 'No se encontró la clave de API de OpenWA (OPENWA_API_KEY o vendor/OpenWA/data/.api-key). ¿Se inició OpenWA al menos una vez?');
  let r: Response;
  try {
    r = await fetch(cfg().url + ruta, { method: metodo, headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo), signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new ErrorOpenWA(0, `OpenWA no responde en ${cfg().url}. Inícialo con \`npm start\` (o revisa OPENWA_URL).`);
  }
  const texto = await r.text();
  const json = texto ? (() => { try { return JSON.parse(texto); } catch { return { message: texto }; } })() : {};
  if (!r.ok) throw new ErrorOpenWA(r.status, `OpenWA respondió ${r.status}: ${json.message ?? texto}`.slice(0, 300));
  return json as T;
}

function mapearEstado(s: string): EstadoWhatsApp {
  return s === 'ready' ? 'CONECTADO' : s === 'qr_ready' ? 'ESPERANDO_QR' : ['initializing', 'authenticating'].includes(s) ? 'CONECTANDO'
    : ['action_required', 'failed'].includes(s) ? 'ERROR' : 'DESCONECTADO';
}

async function buscarSesion() {
  const lista = await llamar<any[]>('GET', '/api/sessions');
  return lista.find((s) => s.name === cfg().sesion) ?? null;
}

/** Registra (o renueva) el webhook de la sesión hacia esta app, con el secreto HMAC actual. */
async function asegurarWebhook(sesionId: string) {
  const c = cfg();
  if (!c.secreto) throw new ErrorOpenWA(0, 'Falta OPENWA_WEBHOOK_SECRET en .env (lo genera `npm run setup`).');
  const destino = `http://localhost:${config.puerto}/api/whatsapp/webhook`;
  const existentes = await llamar<any[]>('GET', `/api/sessions/${sesionId}/webhooks`);
  // El secreto no se puede leer de vuelta: se recrea para garantizar que coincide con el de .env.
  for (const w of existentes.filter((x) => x.url === destino)) await llamar('DELETE', `/api/sessions/${sesionId}/webhooks/${w.id}`);
  await llamar('POST', `/api/sessions/${sesionId}/webhooks`, { url: destino, events: ['message.received', 'session.status', 'session.authenticated', 'session.disconnected'], secret: c.secreto });
  estado.webhookListo = true;
}

let ultimaSincronizacion = 0;
let sincronizando: Promise<void> | null = null;

/** Lee el estado real de la sesión en OpenWA (y prepara el webhook la primera vez). Como máximo una vez cada 10 s salvo `forzar`. */
export function sincronizar(forzar = false): Promise<void> {
  if (sincronizando) return sincronizando;
  if (!forzar && Date.now() - ultimaSincronizacion < 10_000) return Promise.resolve();
  sincronizando = sincronizarAhora().finally(() => { ultimaSincronizacion = Date.now(); sincronizando = null; });
  return sincronizando;
}

async function sincronizarAhora() {
  if (!cfg().habilitado) return fijarEstado({ estado: 'NO_CONFIGURADO', detalle: 'OPENWA_ENABLED=false: se usa solo el simulador.' });
  try {
    const s = await buscarSesion();
    if (!s) return fijarEstado({ estado: 'DESCONECTADO', sesionId: null, detalle: 'Sin sesión de WhatsApp: pulsa «Conectar WhatsApp».' });
    if (!estado.webhookListo || estado.sesionId !== s.id) await asegurarWebhook(s.id);
    fijarEstado({ estado: mapearEstado(s.status), sesionId: s.id, telefono: s.phone ?? null, nombre: s.pushName ?? null, detalle: s.lastError ?? null });
  } catch (e: any) {
    if (e instanceof ErrorOpenWA && e.estadoHttp === 429) return;   // límite de OpenWA: se conserva el último estado conocido
    fijarEstado({ estado: e instanceof ErrorOpenWA && e.estadoHttp === 0 ? 'SIN_CONEXION' : 'ERROR', detalle: e.message, webhookListo: false });
  }
}

export async function conectar() {
  let s = await buscarSesion();
  if (!s) s = await llamar('POST', '/api/sessions', { name: cfg().sesion, config: { autoRejectCalls: true } });
  await asegurarWebhook(s.id);
  // Solo se arranca si está detenida; si ya espera QR o se está conectando, basta con mostrar el QR.
  if (['created', 'disconnected', 'failed', 'stopped'].includes(s.status)) s = await llamar('POST', `/api/sessions/${s.id}/start`);
  fijarEstado({ estado: mapearEstado(s.status), sesionId: s.id, detalle: null });
  return resumenEstado();
}

export async function qr(): Promise<string | null> {
  if (!estado.sesionId) await sincronizar();
  if (!estado.sesionId) return null;
  try { return (await llamar<{ qrCode: string }>('GET', `/api/sessions/${estado.sesionId}/qr`)).qrCode ?? null; }
  catch (e) { if (e instanceof ErrorOpenWA && [400, 409].includes(e.estadoHttp)) return null; throw e; }
}

export async function desconectar() {
  if (!estado.sesionId) await sincronizar();
  if (estado.sesionId) await llamar('POST', `/api/sessions/${estado.sesionId}/logout`);
  fijarEstado({ estado: 'DESCONECTADO', telefono: null, nombre: null, detalle: 'Sesión cerrada: el dispositivo quedó desvinculado.' });
}

export async function enviarTexto(chatId: string, texto: string) {
  if (estado.estado !== 'CONECTADO' || !estado.sesionId) await sincronizar(true);
  if (estado.estado !== 'CONECTADO') throw new ErrorOpenWA(0, 'WhatsApp no está conectado.');
  await llamar('POST', `/api/sessions/${estado.sesionId}/messages/send-text`, { chatId, text: texto });
}

/** Envío de un asesor desde el panel: usa el chat de la conversación. */
export async function enviarAConversacion(conversacionId: number, texto: string) {
  const r = await (await oltp()).request().input('c', sql.Int, conversacionId).query('SELECT chat_id FROM dbo.CONVERSACION WHERE conversacion_id = @c');
  const chat = r.recordset[0]?.chat_id;
  if (!chat) throw new Error('La conversación no tiene chat de WhatsApp.');
  await enviarTexto(chat, texto);
}

// ------------------------------------------------------------------ webhook entrante
export function firmaValida(cuerpoCrudo: string, firma: string | undefined): boolean {
  const s = cfg().secreto;
  if (!s || !firma) return false;
  const esperada = 'sha256=' + crypto.createHmac('sha256', s).update(cuerpoCrudo).digest('hex');
  const a = Buffer.from(esperada), b = Buffer.from(firma);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface Descarte { procesado: false; motivo: string }

/** Procesa un evento ya verificado. Devuelve qué se hizo (para el log y las pruebas). */
export async function manejarEvento(evento: { event: string; data: any }): Promise<{ procesado: boolean; motivo?: string; respuesta?: string }> {
  const { event, data } = evento;
  if (event === 'session.status' || event === 'session.authenticated' || event === 'session.disconnected') {
    void sincronizar(true);
    return { procesado: true, motivo: 'estado de sesión' };
  }
  if (event !== 'message.received') return { procesado: false, motivo: `evento ignorado: ${event}` };
  const m = data ?? {};
  if (m.fromMe) return { procesado: false, motivo: 'mensaje propio' };
  if (m.isGroup || m.isStatusBroadcast || (m.kind && m.kind !== 'individual')) return { procesado: false, motivo: 'no es un chat individual' };
  if (m.timestamp && Date.now() / 1000 - Number(m.timestamp) > 600) return { procesado: false, motivo: 'mensaje de hace más de 10 minutos (pendiente de una reconexión)' };
  const chatId: string = m.chatId || m.from;
  const numero = String(m.senderPhone || m.from || '').replace(/@.*/, '').replace(/\D/g, '');
  const c = cfg();
  if (!c.allowlist.includes(numero)) return { procesado: false, motivo: `número fuera de WHATSAPP_ALLOWLIST (…${numero.slice(-4)})` };
  const texto = String(m.body ?? '').trim();
  if (m.type && m.type !== 'text' && m.type !== 'chat') {
    if (!texto) return { procesado: false, motivo: `tipo no soportado: ${m.type}` };
  }
  if (!texto) return { procesado: false, motivo: 'mensaje vacío' };

  const existente = await (await oltp()).request().input('chat', sql.VarChar, chatId).input('w', sql.VarChar, numero.slice(0, 20))
    .query(`SELECT TOP 1 conversacion_id FROM dbo.CONVERSACION WHERE chat_id = @chat AND canal_mensajeria = 'WHATSAPP';
            SELECT COUNT(*) AS n FROM dbo.CONTACTO c JOIN dbo.BUYER b ON b.contacto_id = c.contacto_id WHERE c.whatsapp = @w;`);
  const leadConocido = (existente.recordsets as any[])[1][0].n > 0;   // lead que llegó desde BUYERS: no necesita la frase
  if (!existente.recordset[0] && !leadConocido && !frasesCoinciden(texto, c.frase))
    return { procesado: false, motivo: 'primer mensaje sin la frase de activación' };

  const conv = existente.recordset[0]?.conversacion_id ?? await asegurarConversacionWhatsApp(chatId, m.contact?.pushName || m.contact?.name || null);
  const idExterno = typeof m.id === 'string' ? m.id : m.id?._serialized ?? null;
  const r = await procesarMensajeEntrante(conv, texto, idExterno);
  if (!r.respondio || !r.respuesta) return { procesado: true, motivo: r.motivo };
  try { await enviarTexto(chatId, r.respuesta); }
  catch (e: any) { console.error('[whatsapp] no se pudo enviar la respuesta:', e.message); publicar('whatsapp', { ...resumenEstado(), errorEnvio: e.message }); }
  return { procesado: true, respuesta: r.respuesta };
}

/** La frase de activación coincide si el mensaje contiene sus palabras significativas (sin tildes ni signos). */
function frasesCoinciden(texto: string, frase: string) {
  const limpio = (s: string) => normalizar(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
  const t = new Set(limpio(texto));
  const f = limpio(frase);
  return f.length > 0 && f.filter((w) => t.has(w)).length >= Math.ceil(f.length * 0.8);
}

/** Arranque: sincroniza al iniciar y luego cada 20 s mientras no esté conectado (OpenWA puede tardar en levantar). */
export function iniciarWhatsApp() {
  if (!cfg().habilitado) { fijarEstado({ estado: 'NO_CONFIGURADO', detalle: 'OPENWA_ENABLED=false' }); return; }
  void sincronizar();
  setInterval(() => { if (estado.estado !== 'CONECTADO' || !estado.webhookListo) void sincronizar(); }, 20_000).unref();
}
