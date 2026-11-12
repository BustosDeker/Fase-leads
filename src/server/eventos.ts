// Bus de eventos en vivo (Server-Sent Events). La UI se suscribe con EventSource en /api/eventos.
// Tipos de evento: etl (progreso de la carga), y en etapas siguientes: mensaje, ficha, oportunidad, whatsapp.
import type { FastifyInstance } from 'fastify';
import type { ServerResponse } from 'node:http';

const clientes = new Set<ServerResponse>();

export function publicar(tipo: string, datos: unknown) {
  const linea = `event: ${tipo}\ndata: ${JSON.stringify(datos)}\n\n`;
  for (const c of clientes) c.write(linea);
}

export function rutasEventos(app: FastifyInstance) {
  app.get('/api/eventos', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`event: hola\ndata: {}\n\n`);
    clientes.add(res);
    const latido = setInterval(() => res.write(': latido\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(latido);
      clientes.delete(res);
    });
  });
}
