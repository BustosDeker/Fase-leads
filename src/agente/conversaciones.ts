// Conversaciones: alta (simulador o WhatsApp), listado, detalle con auditoría y control humano.
import { oltp, sql } from '../db.js';
import { ErrorNegocio, enTransaccion, registrarEvento } from '../negocio/oportunidad.js';
import { publicar } from '../server/eventos.js';

/**
 * Crea el estudiante de una conversación nueva: CONTACTO → BUYER → LEAD → OPORTUNIDAD (ABIERTA) → CONVERSACION.
 * El consentimiento empieza en 0: lo pide el agente en el primer mensaje.
 * (Cuando BUYERS esté integrado, el lead llega desde allí con su consentimiento; ver POST /api/buyers.)
 */
async function crearEstudiante(tx: sql.Transaction, d: { nombres: string; apellidos: string; whatsapp: string | null; esDemo: boolean;
  canal: 'WHATSAPP' | 'SIMULADOR'; chatId: string }) {
  const canal = await new sql.Request(tx).query(`SELECT TOP 1 canal_id FROM dbo.CANAL WHERE plataforma = 'WhatsApp' ORDER BY canal_id`);
  const canalId: number | null = canal.recordset[0]?.canal_id ?? null;
  const r = await new sql.Request(tx).input('n', sql.VarChar, d.nombres.slice(0, 100)).input('a', sql.VarChar, d.apellidos.slice(0, 100))
    .input('w', sql.VarChar, d.whatsapp).input('demo', sql.Bit, d.esDemo).input('canal', sql.Int, canalId)
    .input('cm', sql.VarChar, d.canal).input('chat', sql.VarChar, d.chatId).query(`
      DECLARE @c INT, @b INT, @l INT, @o INT;
      INSERT dbo.CONTACTO (nombres, apellidos, whatsapp, consentimiento_contacto, es_demo) VALUES (@n, @a, @w, 0, @demo);
      SET @c = SCOPE_IDENTITY();
      INSERT dbo.BUYER (contacto_id, canal_captacion_id, necesidad_inicial) VALUES (@c, @canal, 'Asesoría de tesis (primer contacto por WhatsApp)');
      SET @b = SCOPE_IDENTITY();
      INSERT dbo.LEAD (buyer_id, prioridad, estado) VALUES (@b, 'MEDIA', 'EN_NEGOCIACION');
      SET @l = SCOPE_IDENTITY();
      INSERT dbo.OPORTUNIDAD_COMERCIAL (lead_id, fecha_inicio, estado, es_demo) VALUES (@l, SYSDATETIME(), 'ABIERTA', @demo);
      SET @o = SCOPE_IDENTITY();
      INSERT dbo.CONVERSACION (contacto_id, canal_id, tipo_ventana, ventana_hasta, estado, canal_mensajeria, chat_id, oportunidad_id)
      OUTPUT INSERTED.conversacion_id, @l AS lead_id, @o AS oportunidad_id
      VALUES (@c, @canal, 'SERVICIO_24H', DATEADD(HOUR, 24, SYSDATETIME()), 'ABIERTA', @cm, @chat, @o);`);
  const x = r.recordset[0];
  await registrarEvento(tx, x.oportunidad_id, 'OPORTUNIDAD_CREADA', 'SISTEMA', d.canal === 'SIMULADOR' ? 'Conversación del simulador' : 'Primer mensaje por WhatsApp');
  return x as { conversacion_id: number; lead_id: number; oportunidad_id: number };
}

/** Conversación de prueba en el simulador: con un estudiante nuevo (dato de prueba) o con un lead existente. */
export async function crearConversacionSimulada(d: { nombres?: string; apellidos?: string; leadId?: number }) {
  const chatId = `sim:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const r = await enTransaccion(await oltp(), async (tx) => {
    if (!d.leadId) return crearEstudiante(tx, { nombres: d.nombres || 'Estudiante', apellidos: d.apellidos || 'de prueba', whatsapp: null, esDemo: true, canal: 'SIMULADOR', chatId });
    const o = await new sql.Request(tx).input('l', sql.Int, d.leadId).query(`
      SELECT TOP 1 o.oportunidad_id, b.contacto_id FROM dbo.OPORTUNIDAD_COMERCIAL o JOIN dbo.LEAD l ON l.lead_id = o.lead_id JOIN dbo.BUYER b ON b.buyer_id = l.buyer_id
      WHERE o.lead_id = @l ORDER BY CASE WHEN o.estado IN ('DESCARTADA','PAYER_CONFIRMADO') THEN 1 ELSE 0 END, o.fecha_inicio DESC`);
    if (!o.recordset[0]) throw new ErrorNegocio('Ese lead no tiene oportunidades.', 404);
    const c = await new sql.Request(tx).input('c', sql.Int, o.recordset[0].contacto_id).input('o', sql.Int, o.recordset[0].oportunidad_id).input('chat', sql.VarChar, chatId).query(`
      INSERT dbo.CONVERSACION (contacto_id, tipo_ventana, ventana_hasta, estado, canal_mensajeria, chat_id, oportunidad_id)
      OUTPUT INSERTED.conversacion_id VALUES (@c, 'SERVICIO_24H', DATEADD(HOUR, 24, SYSDATETIME()), 'ABIERTA', 'SIMULADOR', @chat, @o)`);
    return { conversacion_id: c.recordset[0].conversacion_id, lead_id: d.leadId, oportunidad_id: o.recordset[0].oportunidad_id };
  });
  publicar('conversacion', { conversacionId: r.conversacion_id, nueva: true });
  return r;
}

/** Conversación activa de un número de WhatsApp; si es la primera vez, crea al estudiante (lo usa el webhook de OpenWA). */
export async function asegurarConversacionWhatsApp(chatId: string, nombreVisible: string | null, numeroTelefono?: string) {
  const pool = await oltp();
  const ex = await pool.request().input('chat', sql.VarChar, chatId).query(`
    SELECT TOP 1 conversacion_id FROM dbo.CONVERSACION WHERE chat_id = @chat AND canal_mensajeria = 'WHATSAPP' ORDER BY conversacion_id DESC`);
  if (ex.recordset[0]) return ex.recordset[0].conversacion_id as number;
  // WhatsApp puede identificar al mismo chat como «51…@c.us» o con un id de privacidad «…@lid»: se usa el número real.
  const numero = (numeroTelefono || chatId.replace(/@.*/, '')).replace(/\D/g, '');
  // ¿El agente ya le escribió primero a este número? Se continúa esa conversación (y se guarda el id de chat con el que respondió).
  const previa = await pool.request().input('w', sql.VarChar, numero.slice(0, 20)).input('chat', sql.VarChar, chatId).query(`
    UPDATE TOP (1) cv SET chat_id = @chat OUTPUT INSERTED.conversacion_id
    FROM dbo.CONVERSACION cv JOIN dbo.CONTACTO c ON c.contacto_id = cv.contacto_id
    WHERE c.whatsapp = @w AND cv.canal_mensajeria = 'WHATSAPP' AND cv.estado <> 'CERRADA'`);
  if (previa.recordset[0]) return previa.recordset[0].conversacion_id as number;
  // ¿Ya es un lead (p. ej. llegó desde BUYERS con su consentimiento)? Se abre la conversación sobre su oportunidad vigente.
  const conocido = await pool.request().input('w', sql.VarChar, numero.slice(0, 20)).query(`
    SELECT TOP 1 c.contacto_id, o.oportunidad_id FROM dbo.CONTACTO c JOIN dbo.BUYER b ON b.contacto_id = c.contacto_id JOIN dbo.LEAD l ON l.buyer_id = b.buyer_id
    JOIN dbo.OPORTUNIDAD_COMERCIAL o ON o.lead_id = l.lead_id WHERE c.whatsapp = @w
    ORDER BY CASE WHEN o.estado IN ('DESCARTADA','PAYER_CONFIRMADO') THEN 1 ELSE 0 END, o.fecha_inicio DESC`);
  if (conocido.recordset[0]) {
    const c = await pool.request().input('c', sql.Int, conocido.recordset[0].contacto_id).input('o', sql.Int, conocido.recordset[0].oportunidad_id).input('chat', sql.VarChar, chatId).query(`
      INSERT dbo.CONVERSACION (contacto_id, tipo_ventana, ventana_hasta, estado, canal_mensajeria, chat_id, oportunidad_id)
      OUTPUT INSERTED.conversacion_id VALUES (@c, 'SERVICIO_24H', DATEADD(HOUR, 24, SYSDATETIME()), 'ABIERTA', 'WHATSAPP', @chat, @o)`);
    publicar('conversacion', { conversacionId: c.recordset[0].conversacion_id, nueva: true });
    return c.recordset[0].conversacion_id as number;
  }
  const partes = (nombreVisible || '').trim().split(/\s+/).filter(Boolean);
  const r = await enTransaccion(pool, (tx) => crearEstudiante(tx, {
    nombres: partes[0] || 'Estudiante', apellidos: partes.slice(1).join(' ') || `WhatsApp ${numero.slice(-4)}`,
    whatsapp: numero.slice(0, 20), esDemo: false, canal: 'WHATSAPP', chatId }));
  publicar('conversacion', { conversacionId: r.conversacion_id, nueva: true });
  return r.conversacion_id;
}

export async function listarConversaciones(filtro: { canal?: string; estado?: string }) {
  const r = await (await oltp()).request().input('canal', sql.VarChar, filtro.canal ?? null).input('estado', sql.VarChar, filtro.estado ?? null).query(`
    SELECT TOP 200 cv.conversacion_id, cv.canal_mensajeria, cv.chat_id, cv.estado, cv.control_humano, cv.fecha_inicio, cv.oportunidad_id,
           co.nombres + ' ' + co.apellidos AS estudiante, co.es_demo, co.consentimiento_contacto, co.no_contactar, o.estado AS estado_oportunidad, o.lead_id,
           ult.fecha_hora AS ultimo_mensaje, ult.contenido AS ultimo_texto, ult.emisor AS ultimo_emisor,
           (SELECT COUNT(*) FROM dbo.ESCALAMIENTO e WHERE e.conversacion_id = cv.conversacion_id AND e.estado = 'PENDIENTE') AS escalamientos_pendientes
    FROM dbo.CONVERSACION cv JOIN dbo.CONTACTO co ON co.contacto_id = cv.contacto_id
    LEFT JOIN dbo.OPORTUNIDAD_COMERCIAL o ON o.oportunidad_id = cv.oportunidad_id
    OUTER APPLY (SELECT TOP 1 fecha_hora, contenido, emisor FROM dbo.MENSAJE m WHERE m.conversacion_id = cv.conversacion_id ORDER BY m.fecha_hora DESC, m.mensaje_id DESC) ult
    WHERE cv.canal_mensajeria <> 'HISTORICO' AND (@canal IS NULL OR cv.canal_mensajeria = @canal) AND (@estado IS NULL OR cv.estado = @estado)
    ORDER BY ISNULL(ult.fecha_hora, cv.fecha_inicio) DESC`);
  return r.recordset;
}

export async function detalleConversacion(conversacionId: number) {
  const r = await (await oltp()).request().input('c', sql.Int, conversacionId).query(`
    SELECT cv.conversacion_id, cv.canal_mensajeria, cv.chat_id, cv.estado, cv.control_humano, cv.asesor_control_id, cv.fecha_inicio, cv.oportunidad_id,
           co.contacto_id, co.nombres, co.apellidos, co.es_demo, co.consentimiento_contacto, co.no_contactar, o.estado AS estado_oportunidad, o.lead_id,
           a.nombre AS asesor_control
    FROM dbo.CONVERSACION cv JOIN dbo.CONTACTO co ON co.contacto_id = cv.contacto_id
    LEFT JOIN dbo.OPORTUNIDAD_COMERCIAL o ON o.oportunidad_id = cv.oportunidad_id LEFT JOIN dbo.ASESOR a ON a.asesor_id = cv.asesor_control_id
    WHERE cv.conversacion_id = @c;
    SELECT m.mensaje_id, m.emisor, m.fecha_hora, m.contenido, a.nombre AS asesor FROM dbo.MENSAJE m LEFT JOIN dbo.ASESOR a ON a.asesor_id = m.asesor_id
    WHERE m.conversacion_id = @c ORDER BY m.fecha_hora, m.mensaje_id;
    SELECT turno_id, fecha, proveedor_llm, modelo, latencia_ms, tools_json, sospecha_inyeccion, error, mensaje_entrada_id, mensaje_salida_id
    FROM dbo.AGENTE_TURNO WHERE conversacion_id = @c ORDER BY turno_id;
    SELECT escalamiento_id, fecha, motivo, destino_rol, estado, resumen FROM dbo.ESCALAMIENTO WHERE conversacion_id = @c ORDER BY fecha DESC;`);
  const [c, mensajes, turnos, escalamientos] = r.recordsets as sql.IRecordSet<any>[];
  if (!c[0]) return null;
  return { conversacion: c[0], mensajes, escalamientos,
    turnos: turnos.map((t: any) => ({ ...t, tools_json: undefined, detalle: t.tools_json ? JSON.parse(t.tools_json) : null })) };
}

/** Un asesor toma el control: el agente deja de responder en esta conversación. */
export async function tomarControl(conversacionId: number, asesorId: number | null) {
  await (await oltp()).request().input('c', sql.Int, conversacionId).input('a', sql.Int, asesorId)
    .query(`UPDATE dbo.CONVERSACION SET control_humano = 1, asesor_control_id = @a, estado = 'DERIVADA', resuelta_sin_humano = 0 WHERE conversacion_id = @c;
            UPDATE dbo.ESCALAMIENTO SET estado = 'ATENDIDO', fecha_atencion = SYSDATETIME(), asesor_id = ISNULL(asesor_id, @a)
            WHERE conversacion_id = @c AND estado = 'PENDIENTE';`);
  publicar('conversacion', { conversacionId, control: 'humano' });
}

/** Devuelve la conversación al agente (cierra los escalamientos atendidos). */
export async function devolverControl(conversacionId: number) {
  await (await oltp()).request().input('c', sql.Int, conversacionId)
    .query(`UPDATE dbo.CONVERSACION SET control_humano = 0, asesor_control_id = NULL, estado = 'ABIERTA' WHERE conversacion_id = @c;
            UPDATE dbo.ESCALAMIENTO SET estado = 'CERRADO' WHERE conversacion_id = @c AND estado IN ('PENDIENTE','ATENDIDO');`);
  publicar('conversacion', { conversacionId, control: 'agente' });
}
