// Ejecuta el ETL del Anexo C (INBESTIGA_TESIS -> INBESTIGA_MART) con parámetros y deja
// constancia en ETL_EJECUCION. Todo el lote va en UNA transacción: el tablero nunca ve
// los hechos vacíos a mitad de la carga, y si algo falla se revierte completo.
import { oltp, mart, sql } from '../db.js';
import { seccionesEtl } from './script-sql.js';
import type { ParametrosEtl } from './parametros.js';

export const TABLAS_DIM = ['Dim_Tiempo', 'Dim_Estudiante', 'Dim_Ubicacion', 'Dim_Investigacion', 'Dim_Servicio',
  'Dim_Asesor', 'Dim_Canal_Captacion', 'Dim_Objecion'] as const;
export const TABLAS_HECHO = ['Hecho_Diagnostico', 'Hecho_Oportunidad', 'Hecho_Recuperacion_Objecion'] as const;

export type PasoEtl = 'inicio' | 'dimensiones' | 'hechos' | 'conteo' | 'fin';
export interface ResultadoEtl {
  etlId: number;
  ok: boolean;
  duracionMs: number;
  filasDimensiones: number;
  filasHechos: number;
  detalle: Record<string, number>;
  oportunidadesDemo: number;
  oportunidadesReales: number;
  error?: string;
}

function conParametros(req: sql.Request, p: ParametrosEtl) {
  return req
    .input('Corte', sql.DateTime2, p.corte)
    .input('WD', sql.Int, p.wdHoras)
    .input('WQ', sql.Int, p.wqHoras)
    .input('WA', sql.Int, p.waDias)
    .input('WC', sql.Int, p.wcDias);
}

export async function ejecutarEtl(
  p: ParametrosEtl,
  op: { origen?: 'APP' | 'CLI' | 'TEST'; alPaso?: (paso: PasoEtl) => void } = {},
): Promise<ResultadoEtl> {
  const aviso = op.alPaso ?? (() => {});
  const { dimensiones, hechos } = seccionesEtl();
  const [poolOltp, poolMart] = await Promise.all([oltp(), mart()]);
  const t0 = Date.now();

  const reg = await poolMart.request()
    .input('corte', sql.DateTime2, p.corte).input('wd', sql.Int, p.wdHoras).input('wq', sql.Int, p.wqHoras)
    .input('wa', sql.Int, p.waDias).input('wc', sql.Int, p.wcDias).input('origen', sql.VarChar, op.origen ?? 'APP')
    .query(`INSERT dbo.ETL_EJECUCION (corte, wd_horas, wq_horas, wa_dias, wc_dias, origen)
            OUTPUT INSERTED.etl_id VALUES (@corte, @wd, @wq, @wa, @wc, @origen)`);
  const etlId: number = reg.recordset[0].etl_id;
  aviso('inicio');

  const tx = new sql.Transaction(poolOltp);
  try {
    await tx.begin();
    aviso('dimensiones');
    await conParametros(new sql.Request(tx), p).query(dimensiones);
    aviso('hechos');
    await conParametros(new sql.Request(tx), p).query(hechos);
    aviso('conteo');
    const conteo = await new sql.Request(tx).query(
      [...TABLAS_DIM, ...TABLAS_HECHO].map((t) => `SELECT '${t}' AS tabla, COUNT(*) AS filas FROM INBESTIGA_MART.dbo.${t}`).join(' UNION ALL ') +
      `; SELECT SUM(CASE WHEN es_demo = 1 THEN 1 ELSE 0 END) AS demo, SUM(CASE WHEN es_demo = 0 THEN 1 ELSE 0 END) AS reales
         FROM dbo.OPORTUNIDAD_COMERCIAL`,
    );
    await tx.commit();

    const recordsets = conteo.recordsets as sql.IRecordSet<any>[];
    const detalle: Record<string, number> = Object.fromEntries(recordsets[0].map((r) => [r.tabla, r.filas]));
    const filasDimensiones = TABLAS_DIM.reduce((s, t) => s + detalle[t], 0);
    const filasHechos = TABLAS_HECHO.reduce((s, t) => s + detalle[t], 0);
    const { demo, reales } = recordsets[1][0];
    const duracionMs = Date.now() - t0;
    await poolMart.request()
      .input('id', sql.Int, etlId).input('ms', sql.Int, duracionMs).input('fd', sql.Int, filasDimensiones)
      .input('fh', sql.Int, filasHechos).input('det', sql.NVarChar, JSON.stringify(detalle))
      .input('demo', sql.Int, demo ?? 0).input('reales', sql.Int, reales ?? 0)
      .query(`UPDATE dbo.ETL_EJECUCION SET fin = SYSDATETIME(), duracion_ms = @ms, estado = 'OK', filas_dimensiones = @fd,
                     filas_hechos = @fh, detalle_json = @det, oportunidades_demo = @demo, oportunidades_reales = @reales
              WHERE etl_id = @id`);
    aviso('fin');
    return { etlId, ok: true, duracionMs, filasDimensiones, filasHechos, detalle, oportunidadesDemo: demo ?? 0, oportunidadesReales: reales ?? 0 };
  } catch (e: any) {
    try { await tx.rollback(); } catch { /* la transacción pudo no haber empezado */ }
    const duracionMs = Date.now() - t0;
    const error = String(e?.message ?? e).slice(0, 1900);
    await poolMart.request().input('id', sql.Int, etlId).input('ms', sql.Int, duracionMs).input('err', sql.NVarChar, error)
      .query(`UPDATE dbo.ETL_EJECUCION SET fin = SYSDATETIME(), duracion_ms = @ms, estado = 'ERROR', error = @err WHERE etl_id = @id`);
    aviso('fin');
    return { etlId, ok: false, duracionMs, filasDimensiones: 0, filasHechos: 0, detalle: {}, oportunidadesDemo: 0, oportunidadesReales: 0, error };
  }
}

/** Parámetros de la última carga correcta (los usa la verificación). */
export async function ultimaEjecucionOk(): Promise<(ParametrosEtl & { etlId: number; inicio: Date }) | null> {
  const r = await (await mart()).request().query(
    `SELECT TOP 1 etl_id, inicio, corte, wd_horas, wq_horas, wa_dias, wc_dias FROM dbo.ETL_EJECUCION
     WHERE estado = 'OK' ORDER BY etl_id DESC`);
  const x = r.recordset[0];
  return x ? { etlId: x.etl_id, inicio: x.inicio, corte: x.corte, wdHoras: x.wd_horas, wqHoras: x.wq_horas, waDias: x.wa_dias, wcDias: x.wc_dias } : null;
}
