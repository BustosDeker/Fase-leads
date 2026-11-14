import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { config, BD_OLTP, BD_MART, RAIZ } from '../config.js';
import { oltp, mart, cerrarPools } from '../db.js';
import { explicarErrorSql } from '../diagnostico-sql.js';
import { rutasEventos } from './eventos.js';
import { rutasTablero } from './rutas-tablero.js';
import { rutasLeads } from './rutas-leads.js';
import { rutasAgente } from './rutas-agente.js';
import { rutasWhatsApp } from './rutas-whatsapp.js';
import { rutasIntegraciones } from './rutas-integraciones.js';
import { rutasAuth } from './auth.js';
import { rutasEvidencias } from './rutas-evidencias.js';
import { resumenEstado as estadoWhatsApp } from '../whatsapp/openwa.js';
import { estadoAgente, obtenerProveedor } from '../agente/motor.js';
import { ErrorNegocio } from '../negocio/oportunidad.js';
import { iniciarSchedulerSeguimiento } from '../agente/seguimiento.js';
import { iniciarSchedulerCobranza } from '../negocio/cobranza.js';

const app = Fastify({ logger: { level: 'info' } });

obtenerProveedor();

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ZodError) return reply.code(400).send({ error: 'Datos no válidos: ' + err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), detalle: err.issues });
  if (err instanceof ErrorNegocio) return reply.code(err.estado).send({ error: err.message });
  const e = err as any;
  if (e?.code && ['ESOCKET', 'ELOGIN', 'ETIMEOUT', 'ECONNCLOSED'].includes(e.code)) {
    return reply.code(503).send({ error: 'SQL Server no está disponible', detalle: explicarErrorSql(e) });
  }
  app.log.error(err);
  return reply.code(500).send({ error: e?.message ?? 'Error interno' });
});

app.get('/api/salud', async () => {
  const sqlServer: Record<string, unknown> = { ok: false };
  try {
    const [o, m] = await Promise.all([oltp(), mart()]);
    const r = await o.request().query(
      'SELECT (SELECT COUNT(*) FROM dbo.OPORTUNIDAD_COMERCIAL) AS oportunidades, (SELECT COUNT(*) FROM dbo.CONTACTO) AS contactos',
    );
    const e = await m.request().query("SELECT TOP 1 inicio, estado FROM dbo.ETL_EJECUCION WHERE estado = 'OK' ORDER BY etl_id DESC");
    Object.assign(sqlServer, { ok: true, oltp: BD_OLTP, mart: BD_MART, ...r.recordset[0], ultimoEtl: e.recordset[0] ?? null });
  } catch (err) {
    sqlServer.error = explicarErrorSql(err);
  }
  return { app: 'INBESTIGA · LEADS', hora: new Date().toISOString(), sqlServer, agente: await estadoAgente(), whatsapp: estadoWhatsApp() };
});

rutasAuth(app);
rutasEventos(app);
rutasTablero(app);
rutasLeads(app);
rutasAgente(app);
rutasWhatsApp(app);
rutasIntegraciones(app);
rutasEvidencias(app);
iniciarSchedulerSeguimiento();
iniciarSchedulerCobranza();

// Frontend compilado (si existe) + rutas del SPA.
const DIST = path.join(RAIZ, 'dist', 'web');
if (fs.existsSync(path.join(DIST, 'index.html'))) {

  await app.register(fastifyStatic, { root: DIST });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'No encontrado' });
  });
} else {
  app.get('/', async (_req, reply) => reply.type('text/html; charset=utf-8')
    .send('<p style="font-family:sans-serif">Falta compilar el frontend: ejecuta <code>npm run build</code> (o <code>npm run setup</code>).</p>'));
}

const cerrar = async () => {
  await app.close();
  await cerrarPools();
  process.exit(0);
};
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);

app.listen({ port: config.puerto, host: '0.0.0.0' }).then(() => {
  console.log(`\n  INBESTIGA · LEADS lista en http://localhost:${config.puerto}\n`);
}).catch((e) => {
  if (e?.code === 'EADDRINUSE') console.error(`✖ El puerto ${config.puerto} ya está en uso. Cambia PORT en .env o cierra la otra aplicación.`);
  else app.log.error(e);
  process.exit(1);
});
