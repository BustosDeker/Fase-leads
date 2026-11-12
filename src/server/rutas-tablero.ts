// API del tablero BI y del ETL. El tablero lee SOLO del data mart.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { mart } from '../db.js';
import { ejecutarEtl } from '../etl/ejecutar.js';
import { esquemaParametrosEtl, parametrosPorDefecto } from '../etl/parametros.js';
import { accionesSugeridas } from '../kpi/acciones.js';
import { esquemaFiltros, opcionesFiltros, reportePorDimension, tendenciaMensual, totalesKpi } from '../kpi/consultas.js';
import { publicar } from './eventos.js';

let etlEnCurso = false;

async function estadoEtl() {
  const r = await (await mart()).request().query(`
    SELECT TOP 1 etl_id, inicio, fin, duracion_ms, estado, corte, wd_horas, wq_horas, wa_dias, wc_dias, filas_dimensiones,
                 filas_hechos, detalle_json, oportunidades_demo, oportunidades_reales, error
    FROM dbo.ETL_EJECUCION WHERE origen <> 'TEST' ORDER BY etl_id DESC;
    SELECT TOP 1 etl_id, inicio, fin, duracion_ms, corte, wd_horas, wq_horas, wa_dias, wc_dias, filas_dimensiones, filas_hechos,
                 detalle_json, oportunidades_demo, oportunidades_reales
    FROM dbo.ETL_EJECUCION WHERE estado = 'OK' ORDER BY etl_id DESC;`);
  const [ultima, ok] = (r.recordsets as any[]).map((x) => x[0] ?? null);
  return { enCurso: etlEnCurso, ultima, ultimaOk: ok };
}

/** Plazos de la última carga correcta (los textos del tablero deben usar los mismos). */
async function plazosVigentes() {
  const { ultimaOk } = await estadoEtl();
  const d = parametrosPorDefecto();
  return ultimaOk
    ? { wdHoras: ultimaOk.wd_horas, wqHoras: ultimaOk.wq_horas, waDias: ultimaOk.wa_dias, wcDias: ultimaOk.wc_dias }
    : { wdHoras: d.wdHoras, wqHoras: d.wqHoras, waDias: d.waDias, wcDias: d.wcDias };
}

export function rutasTablero(app: FastifyInstance) {
  app.get('/api/etl/estado', async () => estadoEtl());

  app.post('/api/etl/ejecutar', async (req, reply) => {
    if (etlEnCurso) return reply.code(409).send({ error: 'Ya hay una carga del data mart en curso.' });
    const cuerpo = z.object({ corte: z.string().optional(), wdHoras: z.number().optional(), wqHoras: z.number().optional(),
      waDias: z.number().optional(), wcDias: z.number().optional() }).parse(req.body ?? {});
    const p = esquemaParametrosEtl.parse({ ...parametrosPorDefecto(), ...Object.fromEntries(Object.entries(cuerpo).filter(([, v]) => v != null && v !== '')) });
    etlEnCurso = true;
    publicar('etl', { paso: 'inicio' });
    try {
      const r = await ejecutarEtl(p, { origen: 'APP', alPaso: (paso) => publicar('etl', { paso }) });
      publicar('etl', { paso: 'terminado', ok: r.ok });
      return r;
    } finally {
      etlEnCurso = false;
    }
  });

  app.get('/api/tablero/filtros', async () => opcionesFiltros());

  app.get('/api/tablero/kpis', async (req) => {
    const f = esquemaFiltros.parse(req.query);
    return { totales: await totalesKpi(f), plazos: await plazosVigentes() };
  });

  app.get('/api/tablero/reporte', async (req) => {
    const q = req.query as Record<string, string>;
    const f = esquemaFiltros.parse(q);
    const p = z.object({ jerarquia: z.string().default('canal'), nivel: z.coerce.number().int().min(0).max(5).default(0),
      ruta: z.string().optional() }).parse(q);
    const ruta = p.ruta ? (JSON.parse(p.ruta) as unknown[]).map(String) : [];
    return reportePorDimension(f, p.jerarquia, p.nivel, ruta);
  });

  app.get('/api/tablero/tendencia', async (req) => {
    const q = req.query as Record<string, string>;
    const kpi = z.enum(['K1', 'K2', 'K3', 'K4', 'K5']).parse(q.kpi ?? 'K1');
    return tendenciaMensual(esquemaFiltros.parse(q), kpi);
  });

  app.get('/api/tablero/acciones', async (req) => accionesSugeridas(esquemaFiltros.parse(req.query), await plazosVigentes()));
}
