// API operativa de LEADS sobre el OLTP: ficha nominal, pipeline, diagnósticos, cotizador, agenda,
// objeciones/escalamientos, consentimiento y auditoría. Toda escritura: validación zod + transacción
// + evento SSE «oltp» para que las pantallas abiertas se actualicen en vivo.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { oltp, sql } from '../db.js';
import { agendarCita, cambiarEstadoCita, esquemaCita, reprogramarCita, ESTADOS_CITA } from '../negocio/agenda.js';
import { calificarAptitud, entregarDiagnostico, esquemaSolicitudDiagnostico, solicitarDiagnostico } from '../negocio/diagnostico.js';
import * as L from '../negocio/lecturas.js';
import { enTransaccion, ErrorNegocio, transicionar } from '../negocio/oportunidad.js';
import { contextoCotizacion, esquemaSolicitudCotizacion, presentarPropuesta, simularCotizacion } from '../negocio/propuestas.js';
import { publicar } from './eventos.js';

const id = z.coerce.number().int().positive();
/** Lead al que pertenece una oportunidad (para avisar a la ficha correcta). */
async function leadDe(oportunidadId: number) {
  const r = await (await oltp()).request().input('o', sql.Int, oportunidadId).query('SELECT lead_id FROM dbo.OPORTUNIDAD_COMERCIAL WHERE oportunidad_id = @o');
  return r.recordset[0]?.lead_id as number | undefined;
}
const avisar = async (oportunidadId: number | null, tipo: string) =>
  publicar('oltp', { tipo, oportunidadId, leadId: oportunidadId ? await leadDe(oportunidadId) : null });

export function rutasLeads(app: FastifyInstance) {
  // ---------------- Ficha nominal
  app.get('/api/leads/buscar', async (req) => {
    const { q } = z.object({ q: z.string().trim().min(1).max(80) }).parse(req.query);
    return L.buscarLeads(q);
  });
  app.get('/api/leads/:leadId/ficha', async (req, reply) => {
    const { leadId } = z.object({ leadId: id }).parse(req.params);
    const f = await L.fichaNominal(leadId);
    return f ?? reply.code(404).send({ error: 'No existe ese lead.' });
  });
  app.post('/api/leads/:leadId/contacto', async (req) => {
    const { leadId } = z.object({ leadId: id }).parse(req.params);
    const datos = z.object({
      nombres: z.string().trim().min(1).max(100),
      apellidos: z.string().trim().min(1).max(100),
      whatsapp: z.string().trim().refine((v) => !v || (/^\+?[\d\s().-]+$/.test(v) && /\d/.test(v)),
        'El WhatsApp solo puede contener números y separadores habituales.')
        .transform((v) => v.replace(/\D/g, ''))
        .refine((v) => !v || (v.length >= 9 && v.length <= 15), 'El WhatsApp debe tener entre 9 y 15 dígitos.'),
      correo: z.string().trim().max(150).transform((v) => v || null)
        .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Ingresa un correo válido.'),
    }).parse(req.body);
    await enTransaccion(await oltp(), async (tx) => {
      const contacto = await new sql.Request(tx).input('l', sql.Int, leadId).query(`
        SELECT c.contacto_id
        FROM dbo.LEAD l
        JOIN dbo.BUYER b ON b.buyer_id = l.buyer_id
        JOIN dbo.CONTACTO c ON c.contacto_id = b.contacto_id
        WHERE l.lead_id = @l`);
      const contactoId = contacto.recordset[0]?.contacto_id as number | undefined;
      if (!contactoId) throw new ErrorNegocio('No existe ese lead.', 404);
      if (datos.whatsapp) {
        const duplicado = await new sql.Request(tx).input('c', sql.Int, contactoId)
          .input('w', sql.VarChar(20), datos.whatsapp).query(`
            SELECT contacto_id FROM dbo.CONTACTO WITH (UPDLOCK, HOLDLOCK)
            WHERE whatsapp = @w AND contacto_id <> @c`);
        if (duplicado.recordset.length) throw new ErrorNegocio('Ese WhatsApp ya está registrado en otro contacto.', 409);
      }
      await new sql.Request(tx).input('c', sql.Int, contactoId).input('n', sql.VarChar(100), datos.nombres)
        .input('a', sql.VarChar(100), datos.apellidos).input('w', sql.VarChar(20), datos.whatsapp || null)
        .input('e', sql.VarChar(150), datos.correo).query(`
          UPDATE dbo.CONTACTO SET nombres = @n, apellidos = @a, whatsapp = @w, correo = @e
          WHERE contacto_id = @c`);
    });
    publicar('oltp', { tipo: 'contacto', leadId });
    return { ok: true };
  });

  // ---------------- Pipeline y estados
  app.get('/api/pipeline', async () => L.pipeline());
  app.post('/api/oportunidades/:id/descartar', async (req) => {
    const { id: o } = z.object({ id }).parse(req.params);
    const { motivo } = z.object({ motivo: z.string().trim().min(3).max(120) }).parse(req.body);
    await enTransaccion(await oltp(), (tx) => transicionar(tx, o, 'DESCARTADA', 'HUMANO', motivo));
    await avisar(o, 'descarte');
    return { ok: true };
  });

  // ---------------- Diagnóstico y aptitud
  app.get('/api/diagnosticos', async (req) => {
    const { plazo } = z.object({ plazo: z.coerce.number().int().min(1).max(720).default(48) }).parse(req.query);
    return L.diagnosticos(plazo);
  });
  app.post('/api/diagnosticos', async (req) => {
    const s = esquemaSolicitudDiagnostico.extend({ asesorId: z.number().int().positive().nullable().default(null) }).parse(req.body);
    const r = await enTransaccion(await oltp(), (tx) => solicitarDiagnostico(tx, s, s.asesorId, 'HUMANO'));
    await avisar(s.oportunidadId, 'diagnostico');
    return r;
  });
  app.post('/api/diagnosticos/:id/entregar', async (req) => {
    const { id: d } = z.object({ id }).parse(req.params);
    const { resumen } = z.object({ resumen: z.string().trim().min(10).max(4000) }).parse(req.body);
    const r = await enTransaccion(await oltp(), (tx) => entregarDiagnostico(tx, d, resumen, 'HUMANO'));
    await avisar(r.oportunidadId, 'diagnostico');
    return r;
  });
  app.post('/api/oportunidades/:id/aptitud', async (req) => {
    const { id: o } = z.object({ id }).parse(req.params);
    await enTransaccion(await oltp(), (tx) => calificarAptitud(tx, o, 'HUMANO'));
    await avisar(o, 'aptitud');
    return { ok: true };
  });

  // ---------------- Cotizador versionado
  app.get('/api/cotizador/:id', async (req) => {
    const { id: o } = z.object({ id }).parse(req.params);
    const pool = await oltp();
    const cx = await contextoCotizacion(pool, o);
    const versiones = await pool.request().input('o', sql.Int, o).query(`
      SELECT p.propuesta_id, p.version, p.fecha_presentacion, p.vigencia_hasta, p.estado, p.generada_por, p.precio_base, p.monto_extras,
             p.recargo, p.descuento, p.precio_final, p.precio_minimo_aplicado, p.tope_descuento_aplicado, s.nombre AS servicio,
             (SELECT TOP 1 tipo_respuesta FROM dbo.RESPUESTA_PROPUESTA r WHERE r.propuesta_id = p.propuesta_id ORDER BY fecha_respuesta DESC) AS respuesta
      FROM dbo.PROPUESTA p JOIN dbo.SERVICIO s ON s.servicio_id = p.servicio_id WHERE p.oportunidad_id = @o ORDER BY p.version;
      SELECT a.propuesta_id, a.tipo, a.concepto, a.porcentaje, a.monto, a.regla_id
      FROM dbo.PROPUESTA_AJUSTE a JOIN dbo.PROPUESTA p ON p.propuesta_id = a.propuesta_id WHERE p.oportunidad_id = @o;
      SELECT pe.propuesta_id, e.nombre, pe.cantidad, pe.precio_unitario, pe.es_extra
      FROM dbo.PROPUESTA_ENTREGABLE pe JOIN dbo.ENTREGABLE e ON e.entregable_id = pe.entregable_id
      JOIN dbo.PROPUESTA p ON p.propuesta_id = pe.propuesta_id WHERE p.oportunidad_id = @o;`);
    const [v, aj, en] = versiones.recordsets as sql.IRecordSet<any>[];
    return { ...cx, versiones: v.map((x) => ({ ...x, ajustes: aj.filter((a) => a.propuesta_id === x.propuesta_id),
      entregables: en.filter((e) => e.propuesta_id === x.propuesta_id) })) };
  });
  app.post('/api/cotizador/simular', async (req) => simularCotizacion(await oltp(), esquemaSolicitudCotizacion.parse(req.body)));
  app.post('/api/cotizador/presentar', async (req) => {
    const s = esquemaSolicitudCotizacion.parse(req.body);
    const r = await enTransaccion(await oltp(), async (tx) => {
      const resp = await new sql.Request(tx).input('o', sql.Int, s.oportunidadId)
        .query('SELECT asesor_responsable_id AS a FROM dbo.OPORTUNIDAD_COMERCIAL WHERE oportunidad_id = @o');
      return presentarPropuesta(tx, s, { origen: 'HUMANO', asesorId: resp.recordset[0]?.a ?? null });
    });
    await avisar(s.oportunidadId, 'propuesta');
    return r;
  });

  // ---------------- Agenda
  app.get('/api/agenda', async (req) => {
    const q = z.object({ desde: z.coerce.date(), hasta: z.coerce.date() }).parse(req.query);
    return L.agenda(q.desde, q.hasta);
  });
  app.post('/api/agenda/citas', async (req) => {
    const c = esquemaCita.parse(req.body);
    const r = await enTransaccion(await oltp(), (tx) => agendarCita(tx, c, 'HUMANO'));
    await avisar(c.oportunidadId, 'cita');
    return r;
  });
  app.post('/api/agenda/citas/:id/estado', async (req) => {
    const { id: c } = z.object({ id }).parse(req.params);
    const b = z.object({ estado: z.enum(ESTADOS_CITA), causa: z.string().trim().min(3).max(200) }).parse(req.body);
    await enTransaccion(await oltp(), (tx) => cambiarEstadoCita(tx, c, b.estado, b.causa, 'HUMANO'));
    publicar('oltp', { tipo: 'cita' });
    return { ok: true };
  });
  app.post('/api/agenda/citas/:id/reprogramar', async (req) => {
    const { id: c } = z.object({ id }).parse(req.params);
    const b = z.object({ inicio: z.coerce.date(), duracionMin: z.number().int().min(15).max(180).default(45) }).parse(req.body);
    await enTransaccion(await oltp(), (tx) => reprogramarCita(tx, c, b.inicio, b.duracionMin, 'HUMANO'));
    publicar('oltp', { tipo: 'cita' });
    return { ok: true };
  });

  // ---------------- Objeciones y escalamientos
  app.get('/api/objeciones', async () => L.objecionesYEscalamientos());
  app.post('/api/escalamientos/:id/atender', async (req) => {
    const { id: e } = z.object({ id }).parse(req.params);
    const r = await (await oltp()).request().input('e', sql.Int, e).query(`
      UPDATE dbo.ESCALAMIENTO SET fecha_atencion = SYSDATETIME(), estado = 'ATENDIDO'
      OUTPUT INSERTED.oportunidad_id WHERE escalamiento_id = @e AND fecha_atencion IS NULL`);
    await avisar(r.recordset[0]?.oportunidad_id ?? null, 'escalamiento');
    return { ok: !!r.recordset[0] };
  });

  // ---------------- Consentimiento (Ley 29733)
  app.get('/api/consentimientos', async () => L.consentimientos());
  app.post('/api/contactos/:id/consentimiento', async (req) => {
    const { id: c } = z.object({ id }).parse(req.params);
    const b = z.object({ accion: z.enum(['OTORGA', 'REVOCA']), evidencia: z.string().trim().min(3).max(300) }).parse(req.body);
    await enTransaccion(await oltp(), async (tx) => {
      await new sql.Request(tx).input('c', sql.Int, c).input('r', sql.Bit, b.accion === 'REVOCA').query(`
        UPDATE dbo.CONTACTO SET consentimiento_contacto = CASE WHEN @r = 1 THEN 0 ELSE 1 END, no_contactar = @r,
               fecha_revocacion = CASE WHEN @r = 1 THEN SYSDATETIME() ELSE NULL END,
               fecha_consentimiento = CASE WHEN @r = 0 THEN SYSDATETIME() ELSE fecha_consentimiento END,
               estado = CASE WHEN @r = 1 THEN 'BAJA' ELSE 'ACTIVO' END
        WHERE contacto_id = @c`);
      await new sql.Request(tx).input('c', sql.Int, c).input('a', sql.VarChar, b.accion).input('e', sql.NVarChar, b.evidencia).query(`
        INSERT dbo.CONSENTIMIENTO_HISTORIAL (contacto_id, accion, medio, finalidad, evidencia)
        VALUES (@c, @a, 'PANEL', N'Información y asesoría comercial de tesis', @e)`);
    });
    publicar('oltp', { tipo: 'consentimiento' });
    return { ok: true };
  });

  // ---------------- Auditoría operativa (R4)
  app.get('/api/auditoria', async () => L.auditoria());
  app.get('/api/asesores', async () => (await (await oltp()).request().query(
    "SELECT asesor_id, nombre, rol, especialidad FROM dbo.ASESOR WHERE estado = 'ACTIVO' ORDER BY nombre")).recordset);
}
