import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { crearConversacionSimulada, detalleConversacion, devolverControl, listarConversaciones, tomarControl } from '../agente/conversaciones.js';
import { explicarTablero } from '../agente/explicar.js';
import { estadoAgente, guardarMensaje, procesarMensajeEntrante } from '../agente/motor.js';
import { parametrosPorDefecto } from '../etl/parametros.js';
import { esquemaFiltros } from '../kpi/consultas.js';
import { mart, oltp, sql } from '../db.js';
import { publicar } from './eventos.js';
import { buscarCandidatos, ejecutarSeguimiento } from '../agente/seguimiento.js';
import { tokenValido } from '../integraciones/integraciones.js';

const id = z.coerce.number().int().positive();
const limiteDerivaciones = 100;

export interface DerivacionPendiente {
  escalamiento_id: number;
  fecha: Date;
  motivo: string;
  estudiante: string;
  resumen: string | null;
}

export async function listarDerivacionesPendientes(desdeId = 0): Promise<DerivacionPendiente[]> {
  const r = await (await oltp()).request().input('desde', sql.Int, desdeId).input('limite', sql.Int, limiteDerivaciones).query(`
    SELECT TOP (@limite) e.escalamiento_id, e.fecha, e.motivo,
           CONCAT(c.nombres, ' ', c.apellidos) AS estudiante, e.resumen
    FROM dbo.ESCALAMIENTO e
    JOIN dbo.CONVERSACION cv ON cv.conversacion_id = e.conversacion_id
    JOIN dbo.CONTACTO c ON c.contacto_id = cv.contacto_id
    WHERE e.estado = 'PENDIENTE' AND e.escalamiento_id > @desde
    ORDER BY e.escalamiento_id ASC`);
  return r.recordset.map((x: any) => ({
    escalamiento_id: Number(x.escalamiento_id), fecha: new Date(x.fecha), motivo: String(x.motivo),
    estudiante: String(x.estudiante), resumen: x.resumen == null ? null : String(x.resumen).slice(0, 1000),
  }));
}

/** Autenticación propia de los endpoints de seguimiento; no sustituye la sesión del resto de la API. */
export function autenticarSeguimiento(req: { headers: { authorization?: string } }, reply: { code: (estado: number) => { send: (cuerpo: unknown) => unknown } }) {
  if (tokenValido(req.headers.authorization, process.env.AGENTE_API_TOKEN)) return true;
  reply.code(401).send({ error: 'Token de agente no válido.' });
  return false;
}

/** Envío hacia el canal real (WhatsApp). Lo registra la integración con OpenWA; en el simulador no hace falta. */
let enviarPorCanal: ((conversacionId: number, texto: string) => Promise<void>) | null = null;
export const registrarEnvioCanal = (fn: typeof enviarPorCanal) => { enviarPorCanal = fn; };

async function plazos() {
  const r = await (await mart()).request().query("SELECT TOP 1 wd_horas, wq_horas, wa_dias, wc_dias FROM dbo.ETL_EJECUCION WHERE estado = 'OK' ORDER BY etl_id DESC");
  const u = r.recordset[0], d = parametrosPorDefecto();
  return u ? { wdHoras: u.wd_horas, wqHoras: u.wq_horas, waDias: u.wa_dias, wcDias: u.wc_dias } : { wdHoras: d.wdHoras, wqHoras: d.wqHoras, waDias: d.waDias, wcDias: d.wcDias };
}

export interface DependenciasRutasAgente {
  buscarCandidatos: typeof buscarCandidatos;
  ejecutarSeguimiento: typeof ejecutarSeguimiento;
  listarDerivacionesPendientes: typeof listarDerivacionesPendientes;
}

export function rutasAgente(app: FastifyInstance, dependencias: Partial<DependenciasRutasAgente> = {}) {
  const buscar = dependencias.buscarCandidatos ?? buscarCandidatos;
  const ejecutar = dependencias.ejecutarSeguimiento ?? ejecutarSeguimiento;
  const derivacionesPendientes = dependencias.listarDerivacionesPendientes ?? listarDerivacionesPendientes;
  app.get('/api/agente/estado', async () => estadoAgente());

  app.get('/api/agente/seguimiento/candidatos', async (req, reply) => {
    if (!autenticarSeguimiento(req, reply)) return;
    const q = z.object({ ahora: z.coerce.date().optional() }).parse(req.query);
    if (q.ahora && !/^(1|true|si|sí|yes)$/i.test(process.env.AGENTE_PERMITIR_TIEMPO_SIMULADO || ''))
      return reply.code(400).send({ error: 'La simulación de tiempo está desactivada.' });
    return { ahora: q.ahora ?? new Date(), candidatos: await buscar(q.ahora) };
  });

  app.post('/api/agente/seguimiento/ejecutar', async (req, reply) => {
    if (!autenticarSeguimiento(req, reply)) return;
    const b = z.object({ dryRun: z.boolean().optional().default(false), ahora: z.coerce.date().optional() }).parse(req.body ?? {});
    if (b.ahora && !/^(1|true|si|sí|yes)$/i.test(process.env.AGENTE_PERMITIR_TIEMPO_SIMULADO || ''))
      return reply.code(400).send({ error: 'La simulación de tiempo está desactivada.' });
    return ejecutar({ ahora: b.ahora, simular: b.dryRun });
  });

  app.get('/api/agente/derivaciones/pendientes', async (req, reply) => {
    if (!autenticarSeguimiento(req, reply)) return;
    const q = z.object({ desde_id: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    const derivaciones = await derivacionesPendientes(q.desde_id);
    return {
      desde_id: q.desde_id,
      derivaciones,
      siguiente_desde_id: derivaciones.at(-1)?.escalamiento_id ?? q.desde_id,
    };
  });

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

  app.post('/api/tablero/explicar', async (req) => explicarTablero(esquemaFiltros.parse(req.body ?? {}), await plazos()));
}
