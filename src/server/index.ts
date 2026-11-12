// Servidor de la app INBESTIGA · LEADS (Fastify). En E1 solo expone el estado de salud;
// las rutas de negocio, SSE, webhooks y el frontend se agregan en las etapas siguientes.
import Fastify from 'fastify';
import { config, BD_OLTP, BD_MART } from '../config.js';
import { oltp, mart, cerrarPools } from '../db.js';
import { explicarErrorSql } from '../diagnostico-sql.js';

const app = Fastify({ logger: { level: 'info' } });

/** Estado de SQL Server para el pie del menú lateral y el diagnóstico de errores. */
app.get('/api/salud', async () => {
  const sqlServer: Record<string, unknown> = { ok: false };
  try {
    const [o, m] = await Promise.all([oltp(), mart()]);
    const r = await o.request().query(
      'SELECT (SELECT COUNT(*) FROM dbo.OPORTUNIDAD_COMERCIAL) AS oportunidades, (SELECT COUNT(*) FROM dbo.CONTACTO) AS contactos',
    );
    const e = await m.request().query(
      "SELECT TOP 1 inicio, estado FROM dbo.ETL_EJECUCION WHERE estado = 'OK' ORDER BY etl_id DESC",
    );
    Object.assign(sqlServer, { ok: true, oltp: BD_OLTP, mart: BD_MART, ...r.recordset[0], ultimoEtl: e.recordset[0] ?? null });
  } catch (err) {
    sqlServer.error = explicarErrorSql(err);
  }
  return { app: 'INBESTIGA · LEADS', hora: new Date().toISOString(), sqlServer };
});

const cerrar = async () => {
  await app.close();
  await cerrarPools();
  process.exit(0);
};
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);

app.listen({ port: config.puerto, host: '0.0.0.0' }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});
