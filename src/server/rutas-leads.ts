// API operativa de LEADS sobre el OLTP: ficha nominal, pipeline, diagnósticos, cotizador, agenda,
// objeciones/escalamientos, consentimiento y auditoría. Toda escritura: validación zod + transacción
// + evento SSE «oltp» para que las pantallas abiertas se actualicen en vivo.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { oltp, sql } from '../db.js';
import { agendarCita, cambiarEstadoCita, esquemaCita, reprogramarCita, ESTADOS_CITA } from '../negocio/agenda.js';
import { calificarAptitud, entregarDiagnostico, esquemaSolicitudDiagnostico, solicitarDiagnostico } from '../negocio/diagnostico.js';
import * as L from '../negocio/lecturas.js';
import { enTransaccion, ErrorNegocio, registrarEvento, transicionar } from '../negocio/oportunidad.js';
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
          UPDATE dbo.CONTACTO SET nombres = @n, apellidos = @a,
            whatsapp_habilitado = CASE WHEN whatsapp = @w THEN whatsapp_habilitado ELSE 0 END,
            whatsapp = @w, correo = @e
          WHERE contacto_id = @c`);
    });
    publicar('oltp', { tipo: 'contacto', leadId });
    return { ok: true };
  });
  app.post('/api/leads/:leadId/whatsapp', async (req) => {
    const { leadId } = z.object({ leadId: id }).parse(req.params);
    const { habilitado } = z.object({ habilitado: z.boolean() }).parse(req.body);
    await enTransaccion(await oltp(), async (tx) => {
      const contacto = await new sql.Request(tx).input('l', sql.Int, leadId).query(`
        SELECT c.contacto_id, c.whatsapp, c.consentimiento_contacto, c.no_contactar
        FROM dbo.LEAD l WITH (UPDLOCK, HOLDLOCK) JOIN dbo.BUYER b ON b.buyer_id = l.buyer_id
        JOIN dbo.CONTACTO c WITH (UPDLOCK, HOLDLOCK) ON c.contacto_id = b.contacto_id WHERE l.lead_id = @l`);
      const c = contacto.recordset[0];
      if (!c) throw new ErrorNegocio('No existe ese lead.', 404);
      const numero = String(c.whatsapp ?? '').replace(/\D/g, '');
      if (habilitado && (numero.length < 9 || numero.length > 15))
        throw new ErrorNegocio('Registra un número de WhatsApp válido, con código de país.', 409);
      if (habilitado && (!c.consentimiento_contacto || c.no_contactar))
        throw new ErrorNegocio('Solo puedes habilitar WhatsApp si el contacto tiene consentimiento vigente.', 409);
      await new sql.Request(tx).input('c', sql.Int, c.contacto_id).input('h', sql.Bit, habilitado)
        .query('UPDATE dbo.CONTACTO SET whatsapp_habilitado = @h WHERE contacto_id = @c');
    });
    publicar('oltp', { tipo: 'whatsapp_contacto', leadId });
    return { ok: true, habilitado };
  });
  app.delete('/api/leads/:leadId', async (req) => {
    const { leadId } = z.object({ leadId: id }).parse(req.params);
    await enTransaccion(await oltp(), async (tx) => {
      const existe = await new sql.Request(tx).input('l', sql.Int, leadId).query(`
        SELECT c.contacto_id, b.buyer_id,
          CASE WHEN EXISTS (SELECT 1 FROM dbo.PAYER p WHERE p.lead_id = l.lead_id)
                 OR EXISTS (SELECT 1 FROM dbo.HONORARIO h WHERE h.lead_id = l.lead_id
                            OR EXISTS (SELECT 1 FROM dbo.DIAGNOSTICO d WHERE d.lead_id = l.lead_id AND d.diagnostico_id = h.diagnostico_id))
                 OR EXISTS (SELECT 1 FROM dbo.ORDEN_PAGO op JOIN dbo.PROPUESTA pr ON pr.propuesta_id = op.propuesta_id
                            WHERE pr.lead_id = l.lead_id)
               THEN 1 ELSE 0 END AS tiene_registros_financieros
        FROM dbo.LEAD l WITH (UPDLOCK, HOLDLOCK) JOIN dbo.BUYER b ON b.buyer_id = l.buyer_id
        JOIN dbo.CONTACTO c ON c.contacto_id = b.contacto_id WHERE l.lead_id = @l`);
      const row = existe.recordset[0];
      if (!row) throw new ErrorNegocio('No existe ese lead.', 404);
      if (row.tiene_registros_financieros)
        throw new ErrorNegocio('No se puede eliminar este lead porque tiene registros de pago o honorarios. Conserva su historial financiero.', 409);

      await new sql.Request(tx).input('l', sql.Int, leadId).query(`
        DECLARE @contacto INT, @buyer INT;
        SELECT @contacto = b.contacto_id, @buyer = l.buyer_id FROM dbo.LEAD l
          JOIN dbo.BUYER b ON b.buyer_id = l.buyer_id WHERE l.lead_id = @l;
        DECLARE @oportunidades TABLE (id INT PRIMARY KEY);
        INSERT @oportunidades SELECT oportunidad_id FROM dbo.OPORTUNIDAD_COMERCIAL WHERE lead_id = @l;
        DECLARE @conversaciones TABLE (id INT PRIMARY KEY);
        INSERT @conversaciones SELECT conversacion_id FROM dbo.CONVERSACION WHERE contacto_id = @contacto;
        DECLARE @mensajes TABLE (id INT PRIMARY KEY);
        INSERT @mensajes SELECT mensaje_id FROM dbo.MENSAJE WHERE conversacion_id IN (SELECT id FROM @conversaciones);
        DECLARE @diagnosticos TABLE (id INT PRIMARY KEY);
        INSERT @diagnosticos SELECT diagnostico_id FROM dbo.DIAGNOSTICO WHERE lead_id = @l;
        DECLARE @propuestas TABLE (id INT PRIMARY KEY);
        INSERT @propuestas SELECT propuesta_id FROM dbo.PROPUESTA WHERE lead_id = @l;
        DECLARE @citas TABLE (id INT PRIMARY KEY);
        INSERT @citas SELECT cita_id FROM dbo.CITA_VIRTUAL WHERE oportunidad_id IN (SELECT id FROM @oportunidades);

        DELETE FROM dbo.AGENTE_TURNO WHERE conversacion_id IN (SELECT id FROM @conversaciones)
          OR oportunidad_id IN (SELECT id FROM @oportunidades)
          OR mensaje_entrada_id IN (SELECT id FROM @mensajes)
          OR mensaje_salida_id IN (SELECT id FROM @mensajes);
        DELETE FROM dbo.MENSAJE WHERE conversacion_id IN (SELECT id FROM @conversaciones);
        DELETE FROM dbo.ESCALAMIENTO WHERE lead_id = @l OR conversacion_id IN (SELECT id FROM @conversaciones)
          OR oportunidad_id IN (SELECT id FROM @oportunidades);
        DELETE FROM dbo.CITA_HISTORIAL WHERE cita_id IN (SELECT id FROM @citas);
        DELETE FROM dbo.CITA_VIRTUAL WHERE oportunidad_id IN (SELECT id FROM @oportunidades);
        DELETE FROM dbo.TRANSFERENCIA_PAYER WHERE oportunidad_id IN (SELECT id FROM @oportunidades)
          OR propuesta_id IN (SELECT id FROM @propuestas);
        DELETE FROM dbo.CONVERSION_PAYER_REF WHERE oportunidad_id IN (SELECT id FROM @oportunidades);
        DELETE FROM dbo.CONTRATO WHERE propuesta_id IN (SELECT id FROM @propuestas);
        DELETE FROM dbo.PROPUESTA_AJUSTE WHERE propuesta_id IN (SELECT id FROM @propuestas);
        DELETE FROM dbo.PROPUESTA_ENTREGABLE WHERE propuesta_id IN (SELECT id FROM @propuestas);
        DELETE FROM dbo.RESPUESTA_PROPUESTA WHERE propuesta_id IN (SELECT id FROM @propuestas);
        DELETE FROM dbo.OBJECION WHERE propuesta_id IN (SELECT id FROM @propuestas);
        DELETE FROM dbo.SEGUIMIENTO_LEAD WHERE lead_id = @l OR oportunidad_id IN (SELECT id FROM @oportunidades);
        DELETE FROM dbo.PERFIL_NEGOCIACION WHERE lead_id = @l OR oportunidad_id IN (SELECT id FROM @oportunidades);
        DELETE FROM dbo.DIAGNOSTICO WHERE lead_id = @l OR oportunidad_id IN (SELECT id FROM @oportunidades);
        DELETE FROM dbo.PROPUESTA WHERE lead_id = @l OR oportunidad_id IN (SELECT id FROM @oportunidades);
        DELETE FROM dbo.RESPONSABLE_PAGO WHERE lead_id = @l;
        DELETE FROM dbo.OPORTUNIDAD_EVENTO WHERE oportunidad_id IN (SELECT id FROM @oportunidades);
        DELETE FROM dbo.CONVERSACION WHERE contacto_id = @contacto;
        DELETE FROM dbo.OPORTUNIDAD_COMERCIAL WHERE lead_id = @l;
        DELETE FROM dbo.CONSENTIMIENTO_HISTORIAL WHERE contacto_id = @contacto;
        DELETE FROM dbo.PERFIL_ACADEMICO WHERE contacto_id = @contacto;
        DELETE FROM dbo.INTERACCION_CAPTACION WHERE buyer_id = @buyer;
        DELETE FROM dbo.DESCARGA_CONTENIDO WHERE buyer_id = @buyer;
        DELETE FROM dbo.SEGUIMIENTO_BUYER WHERE buyer_id = @buyer;
        DELETE FROM dbo.LEAD WHERE lead_id = @l;
        DELETE FROM dbo.BUYER WHERE buyer_id = @buyer;
        UPDATE dbo.PERFIL_ACADEMICO SET recomendado_por_contacto_id = NULL WHERE recomendado_por_contacto_id = @contacto;
        DELETE FROM dbo.CONTACTO WHERE contacto_id = @contacto;`);
    });
    publicar('oltp', { tipo: 'lead_eliminado', leadId });
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
    const oportunidadId = await enTransaccion(await oltp(), async (tx) => {
      const r = await new sql.Request(tx).input('e', sql.Int, e).query(`
        UPDATE dbo.ESCALAMIENTO SET fecha_atencion = SYSDATETIME(), estado = 'ATENDIDO'
        OUTPUT INSERTED.oportunidad_id WHERE escalamiento_id = @e AND estado = 'PENDIENTE' AND fecha_atencion IS NULL`);
      const o = r.recordset[0]?.oportunidad_id as number | undefined;
      if (o) await registrarEvento(tx, o, 'ESCALAMIENTO_ATENDIDO', 'HUMANO', `Escalamiento ${e} atendido.`);
      return o ?? null;
    });
    await avisar(oportunidadId, 'escalamiento');
    return { ok: !!oportunidadId };
  });

  // ---------------- Consentimiento (Ley 29733)
  app.get('/api/consentimientos', async () => L.consentimientos());
  app.post('/api/contactos/:id/consentimiento', async (req) => {
    const { id: c } = z.object({ id }).parse(req.params);
    const b = z.object({ accion: z.enum(['OTORGA', 'REVOCA']), evidencia: z.string().trim().min(3).max(300) }).parse(req.body);
    await enTransaccion(await oltp(), async (tx) => {
      await new sql.Request(tx).input('c', sql.Int, c).input('r', sql.Bit, b.accion === 'REVOCA').query(`
        UPDATE dbo.CONTACTO SET consentimiento_contacto = CASE WHEN @r = 1 THEN 0 ELSE 1 END, no_contactar = @r,
               whatsapp_habilitado = CASE WHEN @r = 1 THEN 0 ELSE whatsapp_habilitado END,
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
