// Motor del Agente Negociador: recibe un mensaje del estudiante (simulador o WhatsApp), decide si el
// agente debe responder, ejecuta el turno con el proveedor configurado, revisa la salida y lo audita todo
// (MENSAJE + AGENTE_TURNO). Un turno a la vez por conversación.
import { oltp, sql } from '../db.js';
import { publicar } from '../server/eventos.js';
import { cargarContexto, catalogos, contextoComoTexto } from './contexto.js';
import { detectarInyeccion, numerosEn, revisarSalida } from './guardas.js';
import { definiciones, ejecutarHerramienta, escalar, type LlamadaHerramienta } from './herramientas.js';
import { promptSistema } from './prompt.js';
import { proveedorAnthropic } from './proveedores/anthropic.js';
import { proveedorGemini } from './proveedores/gemini.js';
import { proveedorMock } from './proveedores/mock.js';
import { proveedorOpenAI } from './proveedores/openai.js';
import type { MensajeHistorial, ProveedorLLM } from './tipos.js';

// ------------------------------------------------------------------ proveedor configurado
let proveedor: ProveedorLLM | null = null;
let avisoProveedor: string | null = null;

export function obtenerProveedor(): ProveedorLLM {
  if (proveedor) return proveedor;
  const pedido = (process.env.LLM_PROVIDER || 'mock').toLowerCase();
  const modelo = process.env.LLM_MODEL || '';
  const sinClave = (n: string) => { avisoProveedor = `LLM_PROVIDER=${pedido} pero falta ${n} en .env: se usa el modo mock.`; console.warn('[agente] ' + avisoProveedor); return proveedorMock(); };
  if (pedido === 'anthropic') proveedor = process.env.ANTHROPIC_API_KEY
    ? proveedorAnthropic(process.env.ANTHROPIC_API_KEY, modelo || 'claude-opus-5-5', (process.env.LLM_EFFORT as any) || 'medium') : sinClave('ANTHROPIC_API_KEY');
  else if (pedido === 'openai') proveedor = process.env.OPENAI_API_KEY ? proveedorOpenAI(process.env.OPENAI_API_KEY, modelo || 'gpt-4.1-mini') : sinClave('OPENAI_API_KEY');
  else if (pedido === 'gemini') proveedor = process.env.GEMINI_API_KEY ? proveedorGemini(process.env.GEMINI_API_KEY, modelo || 'gemini-2.5-flash') : sinClave('GEMINI_API_KEY');
  else proveedor = proveedorMock();
  return proveedor;
}
export const estadoAgente = () => ({ proveedor: obtenerProveedor().nombre, modelo: obtenerProveedor().modelo, aviso: avisoProveedor });

// ------------------------------------------------------------------ cola por conversación
const colas = new Map<number, Promise<unknown>>();
function enCola<T>(conversacionId: number, fn: () => Promise<T>): Promise<T> {
  const previa = colas.get(conversacionId) ?? Promise.resolve();
  const actual = previa.catch(() => undefined).then(fn);
  colas.set(conversacionId, actual);
  actual.finally(() => { if (colas.get(conversacionId) === actual) colas.delete(conversacionId); }).catch(() => undefined);
  return actual;
}

// ------------------------------------------------------------------ mensajes
export async function guardarMensaje(conversacionId: number, emisor: 'CLIENTE' | 'BOT' | 'ESPECIALISTA' | 'ADMIN', texto: string,
  opciones: { asesorId?: number | null; idExterno?: string | null } = {}): Promise<number | null> {
  const r = await (await oltp()).request().input('c', sql.Int, conversacionId).input('e', sql.VarChar, emisor)
    .input('a', sql.Int, opciones.asesorId ?? null).input('t', sql.NVarChar, texto.slice(0, 2000)).input('x', sql.VarChar, opciones.idExterno ?? null)
    .query(`IF @x IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.MENSAJE WHERE id_externo = @x) SELECT CAST(NULL AS INT) AS mensaje_id
            ELSE BEGIN
              INSERT dbo.MENSAJE (conversacion_id, emisor, asesor_id, tipo, contenido, dentro_ventana, id_externo)
              OUTPUT INSERTED.mensaje_id VALUES (@c, @e, @a, 'TEXTO', @t, 1, @x);
              IF @e = 'CLIENTE' UPDATE dbo.CONVERSACION SET fecha_ultimo_mensaje_cliente = SYSDATETIME(), ventana_hasta = DATEADD(HOUR, 24, SYSDATETIME()),
                estado = CASE WHEN estado = 'CERRADA' THEN 'ABIERTA' ELSE estado END, fecha_cierre = CASE WHEN estado = 'CERRADA' THEN NULL ELSE fecha_cierre END
                WHERE conversacion_id = @c;
            END`);
  const id = r.recordset[0]?.mensaje_id ?? null;
  if (id) publicar('conversacion', { conversacionId, emisor });
  return id;
}

async function historial(conversacionId: number): Promise<MensajeHistorial[]> {
  const r = await (await oltp()).request().input('c', sql.Int, conversacionId).query(`
    SELECT TOP 30 emisor, contenido FROM dbo.MENSAJE WHERE conversacion_id = @c AND contenido IS NOT NULL ORDER BY fecha_hora DESC, mensaje_id DESC`);
  const h: MensajeHistorial[] = [];
  for (const m of r.recordset.reverse()) {
    const rol = m.emisor === 'CLIENTE' ? 'user' : 'assistant';
    const texto = m.emisor === 'CLIENTE' || m.emisor === 'BOT' ? m.contenido : `[Mensaje de una persona del equipo] ${m.contenido}`;
    if (h.length && h[h.length - 1].rol === rol) h[h.length - 1].texto += '\n' + texto;   // une mensajes seguidos del mismo lado
    else h.push({ rol, texto });
  }
  while (h.length && h[0].rol !== 'user') h.shift();                                  // debe empezar el estudiante
  return h;
}

export interface ResultadoTurno { respondio: boolean; motivo?: string; respuesta?: string; turnoId?: number; mensajeEntradaId: number | null }

const FRASE_RECONSENTIMIENTO = /\b(acepto|autorizo|quiero (retomar|continuar))\b/i;

/** Punto de entrada único (simulador y WhatsApp). Devuelve la respuesta del agente, si corresponde enviarla. */
export function procesarMensajeEntrante(conversacionId: number, texto: string, idExterno?: string | null): Promise<ResultadoTurno> {
  return enCola(conversacionId, async () => {
    const entradaId = await guardarMensaje(conversacionId, 'CLIENTE', texto, { idExterno });
    if (!entradaId) return { respondio: false, motivo: 'Mensaje duplicado (ya procesado).', mensajeEntradaId: null };
    const cx = await cargarContexto(conversacionId);
    if (cx.controlHumano || cx.estadoConversacion === 'DERIVADA') return { respondio: false, motivo: 'La conversación está a cargo de una persona.', mensajeEntradaId: entradaId };
    if (cx.noContactar && !FRASE_RECONSENTIMIENTO.test(texto)) return { respondio: false, motivo: 'El estudiante revocó su consentimiento (no contactar).', mensajeEntradaId: entradaId };

    const prov = obtenerProveedor();
    const sospecha = detectarInyeccion(texto);
    const bitacora: LlamadaHerramienta[] = [];
    const t0 = Date.now();
    let respuesta = '', error: string | null = null;
    try {
      const cat = await catalogos();
      respuesta = await prov.responder({
        sistema: promptSistema(cat), contexto: contextoComoTexto(cx, sospecha), historial: await historial(conversacionId),
        herramientas: definiciones(), ejecutar: (n, e) => ejecutarHerramienta(cx, n, e, bitacora), datos: cx, sospechaInyeccion: sospecha,
      });
    } catch (e: any) {
      error = String(e?.message ?? e).slice(0, 1000);
      console.error('[agente] turno fallido:', error);
      respuesta = 'Disculpa, tuve un inconveniente técnico. Derivo tu consulta a una persona del equipo para no hacerte esperar.';
      try { await escalar(cx, 'BOT_NO_RESPONDE', `El agente no pudo responder: ${error.slice(0, 300)}`); } catch { /* se registra el error del turno igual */ }
    }
    // Montos autorizados: los que devolvieron las herramientas en este turno y la propuesta vigente.
    const fin = await cargarContexto(conversacionId);
    const permitidos = [...bitacora.flatMap((b) => numerosEn(JSON.stringify(b.resultado))),
      ...(fin.propuesta ? [fin.propuesta.precioFinal, fin.propuesta.precioBase, fin.propuesta.descuento, fin.propuesta.recargo, fin.propuesta.extras] : []),
      ...(fin.preferencias?.presupuesto != null ? [fin.preferencias.presupuesto] : [])];
    const revision = revisarSalida(respuesta, permitidos);
    const latencia = Date.now() - t0;
    const salidaId = await guardarMensaje(conversacionId, 'BOT', revision.texto);
    const turno = await (await oltp()).request().input('c', sql.Int, conversacionId).input('o', sql.Int, fin.oportunidadId)
      .input('mi', sql.Int, entradaId).input('mo', sql.Int, salidaId).input('p', sql.VarChar, prov.nombre).input('m', sql.VarChar, prov.modelo)
      .input('l', sql.Int, latencia).input('t', sql.NVarChar, JSON.stringify({ herramientas: bitacora, revision: revision.observaciones }))
      .input('s', sql.Bit, sospecha).input('e', sql.NVarChar, error ?? (revision.bloqueada ? revision.observaciones.join(' ') : null))
      .query(`INSERT dbo.AGENTE_TURNO (conversacion_id, oportunidad_id, mensaje_entrada_id, mensaje_salida_id, proveedor_llm, modelo, latencia_ms, tools_json, sospecha_inyeccion, error)
              OUTPUT INSERTED.turno_id VALUES (@c, @o, @mi, @mo, @p, @m, @l, @t, @s, @e)`);
    publicar('oltp', { tipo: 'agente', oportunidadId: fin.oportunidadId, leadId: fin.leadId });
    return { respondio: true, respuesta: revision.texto, turnoId: turno.recordset[0].turno_id, mensajeEntradaId: entradaId };
  });
}
