// Rutas de WhatsApp (OpenWA): estado, conectar con QR, desconectar y webhook firmado.
import type { FastifyInstance } from 'fastify';
import { conectar, desconectar, enviarAConversacion, firmaValida, iniciarWhatsApp, manejarEvento, qr, resumenEstado, sincronizar } from '../whatsapp/openwa.js';
import { registrarEnvioCanal } from './rutas-agente.js';

export function rutasWhatsApp(app: FastifyInstance) {
  registrarEnvioCanal(enviarAConversacion);
  iniciarWhatsApp();

  app.get('/api/whatsapp/estado', async () => { await sincronizar(); return resumenEstado(); });
  app.get('/api/whatsapp/qr', async () => ({ qr: await qr(), ...resumenEstado() }));
  app.post('/api/whatsapp/conectar', async () => conectar());
  app.post('/api/whatsapp/desconectar', async () => { await desconectar(); return resumenEstado(); });

  // Webhook: necesita el cuerpo crudo para verificar la firma HMAC, por eso va en un contexto propio.
  app.register(async (sub) => {
    sub.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 1_000_000 }, (req, cuerpo, listo) => {
      (req as any).cuerpoCrudo = cuerpo;
      try { listo(null, JSON.parse(cuerpo as string)); } catch { listo(null, null); }
    });
    sub.post('/api/whatsapp/webhook', async (req, reply) => {
      const firma = req.headers['x-openwa-signature'];
      if (!firmaValida((req as any).cuerpoCrudo ?? '', Array.isArray(firma) ? firma[0] : firma)) {
        req.log.warn('webhook de WhatsApp con firma inválida: descartado');
        return reply.code(401).send({ error: 'Firma inválida.' });
      }
      const evento = req.body as { event: string; data: unknown } | null;
      if (!evento?.event) return reply.code(400).send({ error: 'Evento no válido.' });
      // Se responde de inmediato (OpenWA espera ≤ 10 s); el turno del agente sigue en segundo plano.
      setImmediate(() => {
        manejarEvento(evento).then((r) => req.log.info({ whatsapp: evento.event, ...r, respuesta: undefined }, 'evento de WhatsApp'))
          .catch((e) => req.log.error(e, 'error al procesar evento de WhatsApp'));
      });
      return { recibido: true };
    });
  });
}
