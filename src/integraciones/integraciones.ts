// Integraciones con las fases vecinas del embudo IMPULSE (contratos mínimos):
//   BUYERS → LEADS : POST /api/buyers               registra un lead con su consentimiento (idempotente por WhatsApp).
//   LEADS → PAYERS : transferencia del acuerdo aceptado (TRANSFERENCIA_PAYER, idempotency_key).
//   PAYERS → LEADS : POST /api/payers/confirmacion  confirma la contratación (CONVERSION_PAYER_REF, idempotente por event_id).
// LEADS no guarda montos pagados ni medios de pago: solo la referencia de la confirmación.
import crypto from 'node:crypto';
import { z } from 'zod';
import { oltp, sql } from '../db.js';
import { catalogos } from '../agente/contexto.js';
import { buscarCarrera, buscarUniversidad } from '../agente/guardas.js';
import { ErrorNegocio, enTransaccion, oportunidadBloqueada, registrarEvento, transicionar, type Origen } from '../negocio/oportunidad.js';

/** Compara un encabezado «Authorization: Bearer <token>» en tiempo constante. */
export function tokenValido(cabecera: string | undefined, esperado: string | undefined): boolean {
  if (!esperado || !cabecera?.startsWith('Bearer ')) return false;
  const a = Buffer.from(crypto.createHash('sha256').update(cabecera.slice(7)).digest('hex'));
  const b = Buffer.from(crypto.createHash('sha256').update(esperado).digest('hex'));
  return crypto.timingSafeEqual(a, b);
}

// ------------------------------------------------------------------ BUYERS → LEADS
export const esquemaLeadBuyers = z.object({
  nombres: z.string().trim().min(2).max(100),
  apellidos: z.string().trim().min(2).max(100),
  whatsapp: z.string().transform((s) => s.replace(/\D/g, '')).pipe(z.string().min(9).max(15)),
  correo: z.string().email().max(150).optional(),
  consentimiento: z.object({
    otorgado: z.literal(true, { errorMap: () => ({ message: 'Sin consentimiento de datos (Ley 29733) no se puede registrar el lead.' }) }),
    fecha: z.coerce.date().optional(),
    evidencia: z.string().trim().min(3).max(300),
  }),
  canal: z.string().max(80).optional(),          // p. ej. «Instagram», «Referidos», «Convenio universitario»
  necesidad: z.string().max(200).optional(),
  universidad: z.string().max(150).optional(),
  carrera: z.string().max(120).optional(),
  etapa: z.enum(['CICLO_IX', 'CICLO_X', 'EGRESADO', 'BACHILLER']).optional(),
  es_prueba: z.boolean().default(false),
});

export async function registrarLeadDesdeBuyers(d: z.infer<typeof esquemaLeadBuyers>) {
  const pool = await oltp();
  const previo = await pool.request().input('w', sql.VarChar, d.whatsapp).query(`
    SELECT TOP 1 l.lead_id, o.oportunidad_id FROM dbo.CONTACTO c JOIN dbo.BUYER b ON b.contacto_id = c.contacto_id JOIN dbo.LEAD l ON l.buyer_id = b.buyer_id
    OUTER APPLY (SELECT TOP 1 oportunidad_id FROM dbo.OPORTUNIDAD_COMERCIAL x WHERE x.lead_id = l.lead_id ORDER BY x.fecha_inicio DESC) o
    WHERE c.whatsapp = @w`);
  if (previo.recordset[0]) return { creado: false, leadId: previo.recordset[0].lead_id as number, oportunidadId: previo.recordset[0].oportunidad_id as number | null };

  const cat = await catalogos();
  const u = d.universidad ? buscarUniversidad(d.universidad, cat) : null;
  const ca = d.carrera ? buscarCarrera(d.carrera, cat) : null;
  return enTransaccion(pool, async (tx) => {
    const canal = d.canal ? await new sql.Request(tx).input('c', sql.NVarChar, `%${d.canal}%`)
      .query('SELECT TOP 1 canal_id FROM dbo.CANAL WHERE nombre LIKE @c OR plataforma LIKE @c OR tipo LIKE @c ORDER BY canal_id') : null;
    const r = await new sql.Request(tx).input('n', sql.VarChar, d.nombres).input('a', sql.VarChar, d.apellidos).input('w', sql.VarChar, d.whatsapp)
      .input('co', sql.VarChar, d.correo ?? null).input('fc', sql.DateTime2, d.consentimiento.fecha ?? new Date()).input('demo', sql.Bit, d.es_prueba)
      .input('canal', sql.Int, canal?.recordset[0]?.canal_id ?? null).input('nec', sql.VarChar, d.necesidad ?? 'Asesoría de tesis')
      .input('ev', sql.NVarChar, d.consentimiento.evidencia).query(`
        DECLARE @c INT, @b INT, @l INT, @o INT;
        INSERT dbo.CONTACTO (nombres, apellidos, whatsapp, correo, consentimiento_contacto, fecha_consentimiento, es_demo)
        VALUES (@n, @a, @w, @co, 1, @fc, @demo); SET @c = SCOPE_IDENTITY();
        INSERT dbo.CONSENTIMIENTO_HISTORIAL (contacto_id, fecha, accion, medio, finalidad, evidencia)
        VALUES (@c, @fc, 'OTORGA', 'BUYERS', N'Atención comercial de asesoría de tesis', @ev);
        INSERT dbo.BUYER (contacto_id, canal_captacion_id, necesidad_inicial, estado) VALUES (@c, @canal, @nec, 'CONVERTIDO'); SET @b = SCOPE_IDENTITY();
        INSERT dbo.LEAD (buyer_id, prioridad, estado) VALUES (@b, 'MEDIA', 'EN_NEGOCIACION'); SET @l = SCOPE_IDENTITY();
        INSERT dbo.OPORTUNIDAD_COMERCIAL (lead_id, fecha_inicio, estado, es_demo) VALUES (@l, SYSDATETIME(), 'ABIERTA', @demo); SET @o = SCOPE_IDENTITY();
        SELECT @c AS contacto_id, @l AS lead_id, @o AS oportunidad_id;`);
    const x = r.recordset[0];
    if (u && ca && d.etapa) await new sql.Request(tx).input('c', sql.Int, x.contacto_id).input('u', sql.Int, u.id).input('ca', sql.Int, ca.id).input('e', sql.VarChar, d.etapa)
      .query('INSERT dbo.PERFIL_ACADEMICO (contacto_id, universidad_id, carrera_id, etapa_academica) VALUES (@c, @u, @ca, @e)');
    await registrarEvento(tx, x.oportunidad_id, 'OPORTUNIDAD_CREADA', 'SISTEMA', `Lead recibido de BUYERS${d.canal ? ' · ' + d.canal : ''}`);
    return { creado: true, leadId: x.lead_id as number, oportunidadId: x.oportunidad_id as number, perfilAcademico: !!(u && ca && d.etapa) };
  });
}

// ------------------------------------------------------------------ LEADS → PAYERS
/** Transfiere a PAYERS el acuerdo aceptado (idempotente: una transferencia por versión aceptada). */
export async function transferirAPayers(oportunidadId: number, origen: Origen) {
  const r = await enTransaccion(await oltp(), async (tx) => {
    const op = await oportunidadBloqueada(tx, oportunidadId);
    if (op.estado !== 'ACEPTADA') throw new ErrorNegocio(`Solo se transfiere una oportunidad ACEPTADA (estado actual: ${op.estado}).`);
    const p = await new sql.Request(tx).input('o', sql.Int, oportunidadId).query(`
      SELECT TOP 1 p.propuesta_id, p.version, p.precio_final, s.nombre AS servicio, co.nombres + ' ' + co.apellidos AS estudiante, co.whatsapp, co.correo
      FROM dbo.PROPUESTA p JOIN dbo.SERVICIO s ON s.servicio_id = p.servicio_id
      JOIN dbo.LEAD l ON l.lead_id = p.lead_id JOIN dbo.BUYER b ON b.buyer_id = l.buyer_id JOIN dbo.CONTACTO co ON co.contacto_id = b.contacto_id
      WHERE p.oportunidad_id = @o AND p.estado = 'ACEPTADA' ORDER BY p.version DESC`);
    const prop = p.recordset[0];
    if (!prop) throw new ErrorNegocio('La oportunidad no tiene una propuesta aceptada.');
    const clave = `leads-op${oportunidadId}-v${prop.version}`;
    await new sql.Request(tx).input('o', sql.Int, oportunidadId).input('p', sql.Int, prop.propuesta_id).input('k', sql.VarChar, clave).query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.TRANSFERENCIA_PAYER WHERE idempotency_key = @k)
        INSERT dbo.TRANSFERENCIA_PAYER (oportunidad_id, propuesta_id, idempotency_key, estado) VALUES (@o, @p, @k, 'ENVIADA')`);
    await transicionar(tx, oportunidadId, 'TRANSFERIDA', origen, `Acuerdo v${prop.version} enviado a PAYERS`);
    return { idempotencyKey: clave, acuerdo: { oportunidad_id: oportunidadId, propuesta_id: prop.propuesta_id, version: prop.version,
      servicio: prop.servicio, precio_final: Number(prop.precio_final), estudiante: prop.estudiante, whatsapp: prop.whatsapp, correo: prop.correo } };
  });
  // Envío opcional al sistema de PAYERS (si está configurado). Si falla, la transferencia queda registrada y se puede reenviar.
  const url = process.env.PAYERS_URL;
  let envio: { enviado: boolean; detalle: string } = { enviado: false, detalle: 'PAYERS_URL vacío: se usa el simulador de PAYERS.' };
  if (url) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': r.idempotencyKey },
        body: JSON.stringify(r.acuerdo), signal: AbortSignal.timeout(15_000) });
      envio = { enviado: res.ok, detalle: `PAYERS respondió ${res.status}` };
    } catch (e: any) { envio = { enviado: false, detalle: `No se pudo contactar a PAYERS: ${e.message}` }; }
  }
  return { ...r, envio };
}

// ------------------------------------------------------------------ PAYERS → LEADS
export const esquemaConfirmacionPayers = z.object({
  event_id: z.string().trim().min(6).max(64),
  oportunidad_id: z.number().int().positive(),
  fecha_confirmacion: z.coerce.date().optional(),
  orden_pago_ref: z.number().int().positive().optional(),
});

export async function confirmarDesdePayers(c: z.infer<typeof esquemaConfirmacionPayers>) {
  return enTransaccion(await oltp(), async (tx) => {
    const dup = await new sql.Request(tx).input('e', sql.VarChar, c.event_id)
      .query('SELECT oportunidad_id FROM dbo.CONVERSION_PAYER_REF WITH (UPDLOCK, HOLDLOCK) WHERE event_id = @e');
    if (dup.recordset[0]) return { duplicado: true, oportunidadId: dup.recordset[0].oportunidad_id as number };
    const op = await oportunidadBloqueada(tx, c.oportunidad_id);
    if (op.estado === 'PAYER_CONFIRMADO') throw new ErrorNegocio('La oportunidad ya fue confirmada con otro evento.', 409);
    if (op.estado !== 'TRANSFERIDA') throw new ErrorNegocio(`Solo se confirma una oportunidad TRANSFERIDA (estado actual: ${op.estado}).`, 409);
    await new sql.Request(tx).input('o', sql.Int, c.oportunidad_id).input('e', sql.VarChar, c.event_id)
      .input('f', sql.DateTime2, c.fecha_confirmacion ?? new Date()).input('r', sql.Int, c.orden_pago_ref ?? null).query(`
        INSERT dbo.CONVERSION_PAYER_REF (oportunidad_id, event_id, fecha_confirmacion, orden_pago_ref) VALUES (@o, @e, @f, @r);
        UPDATE dbo.TRANSFERENCIA_PAYER SET estado = 'CONFIRMADA' WHERE oportunidad_id = @o AND estado = 'ENVIADA';`);
    await transicionar(tx, c.oportunidad_id, 'PAYER_CONFIRMADO', 'PAYERS', `Evento ${c.event_id}`);
    return { duplicado: false, oportunidadId: c.oportunidad_id };
  });
}

/** Bandeja de la integración con PAYERS: aceptadas por transferir, transferidas por confirmar y confirmadas recientes. */
export async function bandejaPayers() {
  const r = await (await oltp()).request().query(`
    SELECT TOP 300 o.oportunidad_id, o.lead_id, o.estado, o.es_demo, co.nombres + ' ' + co.apellidos AS estudiante,
           p.version, p.precio_final, s.nombre AS servicio, t.fecha_envio, t.idempotency_key, t.estado AS estado_transferencia,
           cr.event_id, cr.fecha_confirmacion,
           (SELECT MAX(fecha) FROM dbo.OPORTUNIDAD_EVENTO e WHERE e.oportunidad_id = o.oportunidad_id) AS ultimo_evento
    FROM dbo.OPORTUNIDAD_COMERCIAL o JOIN dbo.LEAD l ON l.lead_id = o.lead_id JOIN dbo.BUYER b ON b.buyer_id = l.buyer_id
    JOIN dbo.CONTACTO co ON co.contacto_id = b.contacto_id
    OUTER APPLY (SELECT TOP 1 * FROM dbo.PROPUESTA x WHERE x.oportunidad_id = o.oportunidad_id AND x.estado = 'ACEPTADA' ORDER BY x.version DESC) p
    LEFT JOIN dbo.SERVICIO s ON s.servicio_id = p.servicio_id
    OUTER APPLY (SELECT TOP 1 * FROM dbo.TRANSFERENCIA_PAYER x WHERE x.oportunidad_id = o.oportunidad_id ORDER BY x.fecha_envio DESC) t
    LEFT JOIN dbo.CONVERSION_PAYER_REF cr ON cr.oportunidad_id = o.oportunidad_id
    WHERE o.estado IN ('ACEPTADA', 'TRANSFERIDA', 'PAYER_CONFIRMADO')
    ORDER BY CASE o.estado WHEN 'ACEPTADA' THEN 0 WHEN 'TRANSFERIDA' THEN 1 ELSE 2 END, ISNULL(cr.fecha_confirmacion, ISNULL(t.fecha_envio, o.fecha_inicio)) DESC`);
  return r.recordset;
}
