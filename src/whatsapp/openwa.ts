// Integración con OpenWA (gateway de WhatsApp Web, proceso aparte en vendor/OpenWA).
// - Sesión: la crea/arranca la app; el QR se muestra en la pantalla Conversaciones.
// - Entrada: OpenWA llama a POST /api/whatsapp/webhook firmado con HMAC-SHA256 (X-OpenWA-Signature).
// - Reglas: solo contactos habilitados desde la aplicación con consentimiento vigente; se ignoran
//   grupos, estados, mensajes propios y viejos.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ, config } from '../config.js';
import { oltp, sql } from '../db.js';
import { asegurarConversacionWhatsApp } from '../agente/conversaciones.js';
import { procesarMensajeEntrante } from '../agente/motor.js';
import { publicar } from '../server/eventos.js';
import { ErrorNegocio } from '../negocio/oportunidad.js';

export type EstadoWhatsApp = 'NO_CONFIGURADO' | 'SIN_CONEXION' | 'DESCONECTADO' | 'CONECTANDO' | 'ESPERANDO_QR' | 'CONECTADO' | 'ERROR';
interface ContactoWhatsApp {
  contacto_id: number;
  whatsapp: string | null;
  whatsapp_habilitado: boolean;
  consentimiento_contacto: boolean;
  no_contactar: boolean;
  lead_id: number;
}

const cfg = () => ({
  habilitado: !/^false$/i.test(process.env.OPENWA_ENABLED || ''),
  url: (process.env.OPENWA_URL || 'http://localhost:2785').replace(/\/$/, ''),
  sesion: process.env.OPENWA_SESSION_ID || 'inbestiga-demo',
  secreto: process.env.OPENWA_WEBHOOK_SECRET || '',
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
    webhookListo: estado.webhookListo };
};

const telefonoNormalizadoSql = `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.whatsapp, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')`;

async function contactoPorNumero(numero: string): Promise<ContactoWhatsApp | null> {
  const r = await (await oltp()).request().input('w', sql.VarChar(20), numero).query(`
    SELECT TOP 1 c.contacto_id, c.whatsapp, c.whatsapp_habilitado, c.consentimiento_contacto, c.no_contactar,
      l.lead_id
    FROM dbo.CONTACTO c JOIN dbo.BUYER b ON b.contacto_id = c.contacto_id
    JOIN dbo.LEAD l ON l.buyer_id = b.buyer_id
    WHERE ${telefonoNormalizadoSql} = @w`);
  return r.recordset[0] ?? null;
}

function validarPermisoContacto(c: ContactoWhatsApp | null) {
  if (!c?.contacto_id || !c.lead_id) throw new ErrorNegocio('No hay un lead registrado para este número de WhatsApp.', 409);
  if (!c.whatsapp_habilitado) throw new ErrorNegocio('WhatsApp no está habilitado para este lead desde la aplicación.', 409);
  if (c.no_contactar || !c.consentimiento_contacto)
    throw new ErrorNegocio('El contacto no tiene consentimiento vigente para WhatsApp.', 409);
}

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

function estadoDeSesion(s: any): EstadoWhatsApp {
  const estadoSesion = mapearEstado(s.status);
  return s.engineLoaded && estadoSesion === 'DESCONECTADO' ? 'CONECTANDO' : estadoSesion;
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
    fijarEstado({ estado: estadoDeSesion(s), sesionId: s.id, telefono: s.phone ?? null, nombre: s.pushName ?? null, detalle: s.lastError ?? null });
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
  if (!s.engineLoaded && ['created', 'disconnected', 'failed', 'stopped'].includes(s.status)) {
    try {
      s = await llamar('POST', `/api/sessions/${s.id}/start`);
    } catch (e) {
      const esInicioEnCurso = e instanceof ErrorOpenWA && e.estadoHttp === 400
        && /Session is already (started|starting)/i.test(e.message);
      if (!esInicioEnCurso) throw e;
      s = await llamar('GET', `/api/sessions/${s.id}`);
    }
  }
  fijarEstado({ estado: estadoDeSesion(s), sesionId: s.id, telefono: s.phone ?? null, nombre: s.pushName ?? null, detalle: s.lastError ?? null });
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
  const porChat = await (await oltp()).request().input('chat', sql.VarChar(60), chatId).query(`
    SELECT TOP 1 c.contacto_id, c.whatsapp, c.whatsapp_habilitado, c.consentimiento_contacto, c.no_contactar,
      l.lead_id
    FROM dbo.CONVERSACION cv JOIN dbo.CONTACTO c ON c.contacto_id = cv.contacto_id
    JOIN dbo.BUYER b ON b.contacto_id = c.contacto_id JOIN dbo.LEAD l ON l.buyer_id = b.buyer_id
    WHERE cv.chat_id = @chat AND cv.canal_mensajeria = 'WHATSAPP' ORDER BY cv.conversacion_id DESC`);
  const numero = chatId.replace(/@.*/, '').replace(/\D/g, '');
  const contacto = porChat.recordset[0] ?? (numero ? await contactoPorNumero(numero) : null);
  validarPermisoContacto(contacto);
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
  const contacto = numero ? await contactoPorNumero(numero) : null;
  if (!contacto) return { procesado: false, motivo: `número sin lead registrado (…${numero.slice(-4)})` };
  if (!contacto.whatsapp_habilitado) return { procesado: false, motivo: 'WhatsApp no está habilitado para este lead desde la aplicación' };
  if (!contacto.consentimiento_contacto || contacto.no_contactar) return { procesado: false, motivo: 'el contacto no tiene consentimiento vigente' };
  const texto = String(m.body ?? '').trim();
  if (m.type && m.type !== 'text' && m.type !== 'chat') {
    if (!texto) return { procesado: false, motivo: `tipo no soportado: ${m.type}` };
  }
  if (!texto) return { procesado: false, motivo: 'mensaje vacío' };

  const existente = await (await oltp()).request().input('chat', sql.VarChar, chatId)
    .query(`SELECT TOP 1 conversacion_id, contacto_id FROM dbo.CONVERSACION
            WHERE chat_id = @chat AND canal_mensajeria = 'WHATSAPP' ORDER BY conversacion_id DESC`);
  if (existente.recordset[0] && existente.recordset[0].contacto_id !== contacto.contacto_id)
    return { procesado: false, motivo: 'el chat de WhatsApp está asociado a otro contacto' };

  const conv = existente.recordset[0]?.conversacion_id ?? await asegurarConversacionWhatsApp(chatId, m.contact?.pushName || m.contact?.name || null, numero);
  const idExterno = typeof m.id === 'string' ? m.id : m.id?._serialized ?? null;
  const r = await procesarMensajeEntrante(conv, texto, idExterno);
  if (!r.respondio || !r.respuesta) return { procesado: true, motivo: r.motivo };
  try { await enviarTexto(chatId, r.respuesta); }
  catch (e: any) { console.error('[whatsapp] no se pudo enviar la respuesta:', e.message); publicar('whatsapp', { ...resumenEstado(), errorEnvio: e.message }); }
  return { procesado: true, respuesta: r.respuesta };
}

/** Arranque: sincroniza al iniciar y luego cada 20 s mientras no esté conectado (OpenWA puede tardar en levantar). */
export function iniciarWhatsApp() {
  if (!cfg().habilitado) { fijarEstado({ estado: 'NO_CONFIGURADO', detalle: 'OPENWA_ENABLED=false' }); return; }
  void sincronizar();
  setInterval(() => { if (estado.estado !== 'CONECTADO' || !estado.webhookListo) void sincronizar(); }, 20_000).unref();
}

// ------------------------------------------------------------------ primer contacto saliente
const PLANTILLA_PRIMER_CONTACTO = 'Primer contacto LEADS';
const TEXTO_PRIMER_CONTACTO = 'Hola {nombre}, te escribe el asistente virtual de INBESTIGA. Recibimos tu interés en la asesoría de tesis y estoy aquí para orientarte. '
  + '¿Te parece si conversamos sobre tu tesis? Puedes responder a este mensaje cuando gustes. Si prefieres que no te escribamos, responde «no me escriban».';

/**
 * El agente escribe PRIMERO a un lead existente (lo pide un asesor desde Conversaciones).
 * Solo con permiso habilitado desde la aplicación, consentimiento vigente y WhatsApp conectado.
 * Se envía la plantilla de primer contacto (fuera de la ventana de 24 h solo se permiten plantillas).
 */
export async function iniciarConversacionConLead(leadId: number, asesor: string | null) {
  const pool = await oltp();
  const r = await pool.request().input('l', sql.Int, leadId).query(`
    SELECT TOP 1 c.contacto_id, c.nombres, c.whatsapp, c.whatsapp_habilitado, c.consentimiento_contacto, c.no_contactar, o.oportunidad_id, o.estado
    FROM dbo.LEAD l JOIN dbo.BUYER b ON b.buyer_id = l.buyer_id JOIN dbo.CONTACTO c ON c.contacto_id = b.contacto_id
    LEFT JOIN dbo.OPORTUNIDAD_COMERCIAL o ON o.lead_id = l.lead_id
    WHERE l.lead_id = @l ORDER BY CASE WHEN o.estado IN ('DESCARTADA','PAYER_CONFIRMADO') THEN 1 ELSE 0 END, o.fecha_inicio DESC`);
  const x = r.recordset[0];
  if (!x) throw new ErrorNegocio('Ese lead no existe.', 404);
  const numero = String(x.whatsapp ?? '').replace(/\D/g, '');
  if (!numero) throw new ErrorNegocio('El lead no tiene número de WhatsApp registrado. Regístralo desde la pantalla BUYERS con su número.');
  if (x.no_contactar) throw new ErrorNegocio('El estudiante pidió no ser contactado (revocó su consentimiento).', 409);
  if (!x.consentimiento_contacto) throw new ErrorNegocio('El lead no tiene consentimiento de contacto: el agente no puede escribirle primero (Ley 29733).', 409);
  if (!x.whatsapp_habilitado) throw new ErrorNegocio('Activa WhatsApp para este lead desde la ventana de conversaciones.', 409);
  if (!x.oportunidad_id) throw new ErrorNegocio('El lead no tiene una oportunidad comercial.');
  if (['DESCARTADA', 'PAYER_CONFIRMADO'].includes(x.estado)) throw new ErrorNegocio('La oportunidad de ese lead ya está cerrada.', 409);

  // Plantilla registrada (se crea la primera vez).
  const p = await pool.request().input('n', sql.VarChar, PLANTILLA_PRIMER_CONTACTO).input('t', sql.VarChar, TEXTO_PRIMER_CONTACTO).query(`
    IF NOT EXISTS (SELECT 1 FROM dbo.PLANTILLA_MENSAJE WHERE nombre = @n)
      INSERT dbo.PLANTILLA_MENSAJE (nombre, categoria, texto, aprobada_meta, activa) VALUES (@n, 'SEGUIMIENTO_BUYER', @t, 0, 1);
    SELECT TOP 1 plantilla_msg_id, texto FROM dbo.PLANTILLA_MENSAJE WHERE nombre = @n`);
  const plantilla = p.recordset[0];
  const texto = String(plantilla.texto).replace('{nombre}', String(x.nombres).split(' ')[0]);
  const chatId = `${numero}@c.us`;

  await enviarTexto(chatId, texto);   // primero se envía: si falla, no queda nada registrado como enviado

  const c = await pool.request().input('c', sql.Int, x.contacto_id).input('o', sql.Int, x.oportunidad_id).input('chat', sql.VarChar, chatId)
    .input('pl', sql.Int, plantilla.plantilla_msg_id).input('t', sql.NVarChar, texto)
    .input('d', sql.NVarChar, `Primer mensaje enviado por el agente${asesor ? ` a pedido de ${asesor}` : ''}`).query(`
      DECLARE @cv INT = (SELECT TOP 1 conversacion_id FROM dbo.CONVERSACION WHERE contacto_id = @c AND canal_mensajeria = 'WHATSAPP' AND estado <> 'CERRADA' ORDER BY conversacion_id DESC);
      IF @cv IS NULL BEGIN
        INSERT dbo.CONVERSACION (contacto_id, tipo_ventana, estado, canal_mensajeria, chat_id, oportunidad_id)
        VALUES (@c, 'SERVICIO_24H', 'ABIERTA', 'WHATSAPP', @chat, @o);
        SET @cv = SCOPE_IDENTITY();
      END
      INSERT dbo.MENSAJE (conversacion_id, emisor, tipo, plantilla_msg_id, contenido, dentro_ventana) VALUES (@cv, 'BOT', 'PLANTILLA', @pl, @t, 0);
      INSERT dbo.OPORTUNIDAD_EVENTO (oportunidad_id, evento, origen, detalle) VALUES (@o, 'PRIMER_CONTACTO_WHATSAPP', 'AGENTE', @d);
      SELECT @cv AS conversacion_id;`);
  const conversacionId = c.recordset[0].conversacion_id as number;
  publicar('conversacion', { conversacionId, nueva: true });
  publicar('oltp', { tipo: 'whatsapp', oportunidadId: x.oportunidad_id, leadId });
  return { conversacionId, enviadoA: `…${numero.slice(-4)}` };
}
