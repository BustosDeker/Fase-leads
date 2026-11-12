// Verificación interna OLTP <-> data mart (no es pantalla de la app): ejecuta
// db/reports/06_verificacion_oltp_mart.sql con los parámetros de la última carga.
import { oltp, sql } from '../db.js';
import { cargarScriptParametrizado } from './script-sql.js';
import type { ParametrosEtl } from './parametros.js';

export interface FilaVerificacion { medida: string; oltp: number; mart: number; resultado: 'COINCIDE' | 'DIFERENCIA' }
export interface FilaCoherencia { regla: string; cumple: 'SI' | 'NO'; num: number; den: number }

export async function verificarOltpMart(p: ParametrosEtl) {
  const script = cargarScriptParametrizado('db/reports/06_verificacion_oltp_mart.sql');
  const r = await (await oltp()).request()
    .input('Corte', sql.DateTime2, p.corte).input('WD', sql.Int, p.wdHoras).input('WQ', sql.Int, p.wqHoras)
    .input('WA', sql.Int, p.waDias).input('WC', sql.Int, p.wcDias)
    .query(script);
  const recordsets = r.recordsets as sql.IRecordSet<any>[];
  const medidas = recordsets[0] as unknown as FilaVerificacion[];
  const coherencia = recordsets[1] as unknown as FilaCoherencia[];
  const ok = medidas.length === 10 && medidas.every((m) => m.resultado === 'COINCIDE') && coherencia.every((c) => c.cumple === 'SI');
  return { ok, medidas, coherencia };
}
