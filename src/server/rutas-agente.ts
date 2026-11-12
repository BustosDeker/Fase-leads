// API del Agente Negociador: simulador de WhatsApp, conversaciones (con auditoría de turnos),
// control humano y «Explicar este tablero».
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { crearConversacionSimulada, detalleConversacion, devolverControl, listarConversaciones, tomarControl } from '../agente/conversaciones.js';
import { explicarTablero } from '../agente/explicar.js';
import { estadoAgente, guardarMensaje, procesarMensajeEntrante } from '../agente/motor.js';
import { parametrosPorDefecto } from '../etl/parametros.js';
import { esquemaFiltros } from '../kpi/consultas.js';
import { mart } from '../db.js';
import { publicar } from './eventos.js';

const id = z.coerce.number().int().positive();

/** Envío hacia el canal real (WhatsApp). Lo registra la integración con OpenWA; en el simulador no hace falta. */
let enviarPorCanal: ((conversacionId: number, texto: string) => Promise<void>) | null = null;
export const registrarEnvioCanal = (fn: typeof enviarPorCanal) => { enviarPorCanal = fn; };

async function plazos() {
  const r = await (await mart()).request().query("SELECT TOP 1 wd_horas, wq_horas, wa_dias, wc_dias FROM dbo.ETL_EJECUCION WHERE estado = 'OK' ORDER BY etl_id DESC");
  const u = r.recordset[0], d = parametrosPorDefecto();
  return u ? { wdHoras: u.wd_horas, wqHoras: u.wq_horas, waDias: u.wa_dias, wcDias: u.wc_dias } : { wdHoras: d.wdHoras, wqHoras: d.wqHoras, waDias: d.waDias, wcDias: d.wcDias };
}

export function rutasAgente(app: FastifyInstance) {
  app.get('/api/agente/estado', async () => estadoAgente());

  app.get('/api/conversaciones', async (req) => {
    const f = z.object({ canal: z.enum(['WHATSAPP', 'SIMULADOR']).optional(), estado: z.enum(['ABIERTA', 'CERRADA', 'DERIVADA']).optional() }).parse(req.query);
    return listarConversaciones(f);
  });
  app.get('/api/conversaciones/:id', async (req, reply) => {
    const { id: c } = z.object({ id }).parse(req.params);
    return (await detalleConversacion(c)) ?? reply.code(404).send({ error: 'La conversación no existe.' });
  });

  // ---------------- Simulador
  app.post('/api/simulador/conversaciones', async (req) => {
    const d = z.object({ nombres: z.string().trim().min(2).max(100).optional(), apellidos: z.string().trim().min(2).max(100).optional(),
      leadId: z.number().int().positive().optional() }).parse(req.body ?? {});
    return crearConversacionSimulada(d);
  });
  app.post('/api/simulador/conversaciones/:id/mensajes', async (req, reply) => {
    const { id: c } = z.object({ id }).parse(req.params);
    const { texto } = z.object({ texto: z.string().trim().min(1).max(2000) }).parse(req.body);
    const det = await detalleConversacion(c);
    if (!det) return reply.code(404).send({ error: 'La conversación no existe.' });
    if (det.conversacion.canal_mensajeria !== 'SIMULADOR') return reply.code(400).send({ error: 'Solo se escribe como estudiante en conversaciones del simulador.' });
    return procesarMensajeEntrante(c, texto);
  });

  // ---------------- Control humano
  app.post('/api/conversaciones/:id/tomar', async (req) => {
    const { id: c } = z.object({ id }).parse(req.params);
    const { asesorId } = z.object({ asesorId: z.number().int().positive().nullable().default(null) }).parse(req.body ?? {});
    await tomarControl(c, asesorId);
    return { ok: true };
  });
  app.post('/api/conversaciones/:id/devolver', async (req) => {
    const { id: c } = z.object({ id }).parse(req.params);
    await devolverControl(c);
    return { ok: true };
  });
  app.post('/api/conversaciones/:id/mensajes', async (req, reply) => {
    const { id: c } = z.object({ id }).parse(req.params);
    const { texto, asesorId } = z.object({ texto: z.string().trim().min(1).max(2000), asesorId: z.number().int().positive().nullable().default(null) }).parse(req.body);
    const det = await detalleConversacion(c);
    if (!det) return reply.code(404).send({ error: 'La conversación no existe.' });
    if (det.conversacion.no_contactar) return reply.code(409).send({ error: 'El estudiante revocó su consentimiento: no se le puede escribir.' });
    if (det.conversacion.canal_mensajeria === 'WHATSAPP'
      && (!det.conversacion.whatsapp_habilitado || !det.conversacion.consentimiento_contacto))
      return reply.code(409).send({ error: 'WhatsApp no está habilitado para este lead o su consentimiento ya no está vigente.' });
    if (!det.conversacion.control_humano) await tomarControl(c, asesorId);   // escribir como persona implica tomar el control
    await guardarMensaje(c, 'ESPECIALISTA', texto, { asesorId });
    if (det.conversacion.canal_mensajeria === 'WHATSAPP') {
      if (!enviarPorCanal) return reply.code(503).send({ error: 'WhatsApp no está conectado: el mensaje quedó registrado pero no se envió.' });
      await enviarPorCanal(c, texto);
    }
    publicar('oltp', { tipo: 'conversacion', oportunidadId: det.conversacion.oportunidad_id, leadId: det.conversacion.lead_id });
    return { ok: true };
  });

  // ---------------- Agente Plataforma: explicar el tablero
  app.post('/api/tablero/explicar', async (req) => explicarTablero(esquemaFiltros.parse(req.body ?? {}), await plazos()));
}
