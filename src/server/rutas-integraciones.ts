// Integraciones con BUYERS y PAYERS (con token Bearer), sus simuladores para la demo y el resumen
// del Agente Plataforma (embudo IMPULSE completo y actividad del agente).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { oltp } from '../db.js';
import { catalogos } from '../agente/contexto.js';
import { estadoAgente } from '../agente/motor.js';
import { bandejaPayers, confirmarDesdePayers, esquemaConfirmacionPayers, esquemaLeadBuyers, registrarLeadDesdeBuyers, tokenValido, transferirAPayers } from '../integraciones/integraciones.js';
import { bandejaPagos, confirmarPagoSimulado, obtenerPagoPorToken, rechazarPagoSimulado } from '../negocio/pagos.js';
import { resumenEstado as estadoWhatsApp } from '../whatsapp/openwa.js';
import { publicar } from './eventos.js';

const id = z.coerce.number().int().positive();
const avisar = (oportunidadId: number | null, leadId: number | null, tipo: string) => publicar('oltp', { tipo, oportunidadId, leadId });

export function rutasIntegraciones(app: FastifyInstance) {
  // ---------------- BUYERS → LEADS (sistema externo, con token)
  app.post('/api/buyers', async (req, reply) => {
    if (!tokenValido(req.headers.authorization, process.env.BUYERS_TOKEN)) return reply.code(401).send({ error: 'Token de BUYERS no válido.' });
    const r = await registrarLeadDesdeBuyers(esquemaLeadBuyers.parse(req.body));
    avisar(r.oportunidadId, r.leadId, 'buyers');
    return reply.code(r.creado ? 201 : 200).send(r);
  });
  // Simulador (desde la pantalla BUYERS): mismo contrato, sin token, marcado como dato de prueba.
  app.post('/api/simulador/buyers', async (req, reply) => {
    const r = await registrarLeadDesdeBuyers(esquemaLeadBuyers.parse({ ...(req.body as object), es_prueba: true }));
    avisar(r.oportunidadId, r.leadId, 'buyers');
    return reply.code(r.creado ? 201 : 200).send(r);
  });

  // ---------------- LEADS → PAYERS
  app.get('/api/payers/bandeja', async () => bandejaPayers());
  app.post('/api/oportunidades/:id/transferir', async (req) => {
    const { id: o } = z.object({ id }).parse(req.params);
    const r = await transferirAPayers(o, 'HUMANO');
    avisar(o, null, 'payers');
    return r;
  });

  // ---------------- PAYERS → LEADS (sistema externo, con token)
  app.post('/api/payers/confirmacion', async (req, reply) => {
    if (!tokenValido(req.headers.authorization, process.env.PAYERS_TOKEN)) return reply.code(401).send({ error: 'Token de PAYERS no válido.' });
    const r = await confirmarDesdePayers(esquemaConfirmacionPayers.parse(req.body));
    if (!r.duplicado) avisar(r.oportunidadId, null, 'payers');
    return r;
  });
  // Simulador de PAYERS (pantalla PAYERS): genera el evento como lo haría PAYERS.
  app.post('/api/simulador/payers/:id/confirmar', async (req) => {
    const { id: o } = z.object({ id }).parse(req.params);
    const r = await confirmarDesdePayers({ event_id: `sim-${o}-${Date.now().toString(36)}`, oportunidad_id: o });
    avisar(o, null, 'payers');
    return r;
  });

  // ---------------- Catálogo académico (para el select del simulador de BUYERS)
  app.get('/api/catalogos/academicos', async () => {
    const cat = await catalogos();
    return { universidades: cat.universidades.map((u) => u.nombre).sort((a, b) => a.localeCompare(b, 'es')),
      carreras: cat.carreras.map((c) => c.nombre).sort((a, b) => a.localeCompare(b, 'es')) };
  });

  // ---------------- Pasarela de pago simulada (pública: la abre el estudiante desde el enlace de WhatsApp)
  app.get('/api/pago/:token', async (req, reply) => {
    const { token } = z.object({ token: z.string().min(10).max(40) }).parse(req.params);
    const d = await obtenerPagoPorToken(token);
    if (!d) return reply.code(404).send({ error: 'Enlace de pago no encontrado o vencido.' });
    return d;
  });
  app.post('/api/pago/:token/confirmar', async (req) => {
    const { token } = z.object({ token: z.string().min(10).max(40) }).parse(req.params);
    const { medioPagoId } = z.object({ medioPagoId: id }).parse(req.body);
    const r = await confirmarPagoSimulado(token, { medioPagoId });
    avisar(r.oportunidadId, null, 'pago');
    return r;
  });
  app.post('/api/pago/:token/rechazar', async (req) => {
    const { token } = z.object({ token: z.string().min(10).max(40) }).parse(req.params);
    const { motivo } = z.object({ motivo: z.string().max(300).optional() }).parse(req.body ?? {});
    const r = await rechazarPagoSimulado(token, motivo);
    avisar(r.oportunidadId, null, 'pago');
    return r;
  });
  // Bandeja de PAYERS (panel interno): solo pendiente de pago, confirmadas y rechazadas.
  app.get('/api/pagos/bandeja', async () => bandejaPagos());

  // ---------------- Agente Plataforma: embudo IMPULSE y salud del sistema
  app.get('/api/plataforma/resumen', async () => {
    const r = await (await oltp()).request().query(`
      SELECT (SELECT COUNT(*) FROM dbo.BUYER) AS buyers, (SELECT COUNT(*) FROM dbo.LEAD) AS leads,
             (SELECT COUNT(*) FROM dbo.OPORTUNIDAD_COMERCIAL WHERE estado = 'ACEPTADA') AS aceptadas,
             (SELECT COUNT(*) FROM dbo.OPORTUNIDAD_COMERCIAL WHERE estado = 'TRANSFERIDA') AS transferidas,
             (SELECT COUNT(*) FROM dbo.CONVERSION_PAYER_REF) AS payers_confirmados,
             (SELECT COUNT(*) FROM dbo.CUSTOMER) AS customers;
      SELECT estado, COUNT(*) AS n FROM dbo.OPORTUNIDAD_COMERCIAL GROUP BY estado;
      SELECT COUNT(*) AS turnos, AVG(CAST(latencia_ms AS FLOAT)) AS latencia_media, SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS con_error,
             SUM(CASE WHEN sospecha_inyeccion = 1 THEN 1 ELSE 0 END) AS sospechas, COUNT(DISTINCT conversacion_id) AS conversaciones
      FROM dbo.AGENTE_TURNO WHERE fecha >= DATEADD(DAY, -7, SYSDATETIME());
      SELECT motivo, COUNT(*) AS n FROM dbo.ESCALAMIENTO WHERE estado = 'PENDIENTE' GROUP BY motivo ORDER BY n DESC;
      SELECT canal_mensajeria AS canal, COUNT(*) AS n FROM dbo.CONVERSACION WHERE estado <> 'CERRADA' AND canal_mensajeria <> 'HISTORICO' GROUP BY canal_mensajeria;`);
    const [emb, est, ag, esc, conv] = r.recordsets as any[];
    return { embudo: emb[0], estados: est, agente: { ...ag[0], ...(await estadoAgente()) }, escalamientosPendientes: esc, conversacionesAbiertas: conv, whatsapp: estadoWhatsApp() };
  });
}
