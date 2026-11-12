// Consultas del tablero sobre el DATA MART (nunca sobre el OLTP).
// Cada indicador = SUM(numerador) / SUM(denominador) en su propio hecho y con su propio rol de tiempo.
// Seguridad: las columnas salen de listas blancas (jerarquías e indicadores); los valores van parametrizados.
import { z } from 'zod';
import { mart, sql } from '../db.js';
import { INDICADORES, type CodigoKpi, type DefinicionKpi } from '../shared/indicadores.js';
import { jerarquia, type Dimension } from '../shared/jerarquias.js';

/** Dimensiones de cada hecho (cuadro de medidas y dimensiones, tabla 16 del informe). */
const DIMS_DE_HECHO: Record<DefinicionKpi['hecho'], Dimension[]> = {
  Hecho_Diagnostico: ['tiempo', 'estudiante', 'ubicacion', 'investigacion', 'asesor', 'canal'],
  Hecho_Oportunidad: ['tiempo', 'estudiante', 'ubicacion', 'investigacion', 'servicio', 'asesor', 'canal'],
  Hecho_Recuperacion_Objecion: ['tiempo', 'estudiante', 'ubicacion', 'investigacion', 'servicio', 'asesor', 'canal', 'objecion'],
};
export const kpiAdmiteDimension = (k: DefinicionKpi, d: Dimension) => DIMS_DE_HECHO[k.hecho].includes(d);

const ALIAS: Record<Dimension, string> = {
  tiempo: 't', estudiante: 'de', ubicacion: 'du', investigacion: 'di', servicio: 'ds', asesor: 'da', canal: 'dc', objecion: 'dob',
};
const JOIN: Record<Dimension, (k: DefinicionKpi) => string> = {
  tiempo: (k) => `INNER JOIN dbo.Dim_Tiempo t ON t.KeyTiempo = h.${k.claveTiempo}`,
  estudiante: () => 'INNER JOIN dbo.Dim_Estudiante de ON de.KeyEstudiante = h.KeyEstudiante',
  ubicacion: () => 'INNER JOIN dbo.Dim_Ubicacion du ON du.KeyUbicacion = h.KeyUbicacion',
  investigacion: () => 'INNER JOIN dbo.Dim_Investigacion di ON di.KeyInvestigacion = h.KeyInvestigacion',
  servicio: () => 'INNER JOIN dbo.Dim_Servicio ds ON ds.KeyServicio = h.KeyServicio',
  asesor: () => 'INNER JOIN dbo.Dim_Asesor da ON da.KeyAsesor = h.KeyAsesor',
  canal: () => 'INNER JOIN dbo.Dim_Canal_Captacion dc ON dc.KeyCanalCaptacion = h.KeyCanalCaptacion',
  objecion: () => 'INNER JOIN dbo.Dim_Objecion dob ON dob.KeyObjecion = h.KeyObjecion',
};

/** Expresión SQL de cada nivel (lista blanca). Tiempo usa formatos ISO para poder filtrar y ordenar. */
function expresionNivel(dim: Dimension, nivel: string): string {
  const a = ALIAS[dim];
  if (dim === 'tiempo') {
    const t: Record<string, string> = {
      Anual: 'CAST(t.Anual AS VARCHAR(4))', Trimestre: 't.Trimestre',
      Mes: 'CONVERT(CHAR(7), t.idFecha, 120)', Dia: 'CONVERT(CHAR(10), t.idFecha, 120)',
    };
    if (!t[nivel]) throw new Error('Nivel de tiempo no válido');
    return t[nivel];
  }
  return `ISNULL(CAST(${a}.${nivel} AS NVARCHAR(200)), N'(sin dato)')`;
}

export const esquemaFiltros = z.object({
  desde: z.string().regex(/^\d{4}-\d{2}$/).optional(),     // cohorte: mes inicial (AAAA-MM), por la fecha propia de cada indicador
  hasta: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  grupoEtapa: z.string().max(40).optional(),
  canal: z.string().max(80).optional(),
  asesor: z.string().max(150).optional(),
});
export type Filtros = z.infer<typeof esquemaFiltros>;

export interface Celda { num: number; den: number }
interface OpcionesConsulta { agrupar?: { jerarquia: string; nivel: number; ruta: string[] } }

/** Una consulta por indicador: devuelve filas { miembro, num, den }. */
async function consultarKpi(k: DefinicionKpi, f: Filtros, op: OpcionesConsulta = {}): Promise<{ miembro: string | null; num: number; den: number }[]> {
  const req = (await mart()).request();
  const where: string[] = [];
  const dims = new Set<Dimension>();
  if (f.desde || f.hasta) {
    dims.add('tiempo');
    where.push("t.idFecha <> '19000101'");
    if (f.desde) { where.push('t.idFecha >= @desde'); req.input('desde', sql.Date, new Date(`${f.desde}-01T00:00:00`)); }
    if (f.hasta) {
      const [y, m] = f.hasta.split('-').map(Number);
      where.push('t.idFecha < @hasta'); req.input('hasta', sql.Date, new Date(y, m, 1));
    }
  }
  if (f.grupoEtapa) { dims.add('estudiante'); where.push('de.GrupoEtapa = @grupoEtapa'); req.input('grupoEtapa', sql.NVarChar, f.grupoEtapa); }
  if (f.canal) { dims.add('canal'); where.push('dc.Canal = @canal'); req.input('canal', sql.NVarChar, f.canal); }
  if (f.asesor) { dims.add('asesor'); where.push('da.Asesor = @asesor'); req.input('asesor', sql.NVarChar, f.asesor); }

  let grupo = '';
  if (op.agrupar) {
    const j = jerarquia(op.agrupar.jerarquia);
    if (!j || op.agrupar.nivel < 0 || op.agrupar.nivel >= j.niveles.length) throw new Error('Jerarquía o nivel no válido');
    if (!kpiAdmiteDimension(k, j.dimension)) return [];
    dims.add(j.dimension);
    if (j.dimension === 'tiempo') where.push("t.idFecha <> '19000101'"); // miembro «No aplica» fuera del corte temporal
    op.agrupar.ruta.slice(0, op.agrupar.nivel).forEach((valor, i) => {
      where.push(`${expresionNivel(j.dimension, j.niveles[i].id)} = @r${i}`);
      req.input(`r${i}`, sql.NVarChar, valor);
    });
    grupo = expresionNivel(j.dimension, j.niveles[op.agrupar.nivel].id);
  }
  const joins = [...dims].map((d) => JOIN[d](k)).join('\n');
  const q = `SELECT ${grupo ? `${grupo} AS miembro,` : 'NULL AS miembro,'}
                    ISNULL(SUM(h.${k.numerador.columna}), 0) AS num, ISNULL(SUM(h.${k.denominador.columna}), 0) AS den
             FROM dbo.${k.hecho} h
             ${joins}
             ${where.length ? 'WHERE ' + [...new Set(where)].join(' AND ') : ''}
             ${grupo ? `GROUP BY ${grupo}` : ''}`;
  return (await req.query(q)).recordset;
}

/** Totales de los cinco indicadores con los filtros globales. */
export async function totalesKpi(f: Filtros): Promise<Record<CodigoKpi, Celda>> {
  const out = {} as Record<CodigoKpi, Celda>;
  for (const k of INDICADORES) {
    const [r] = await consultarKpi(k, f);
    out[k.codigo] = { num: r?.num ?? 0, den: r?.den ?? 0 };
  }
  return out;
}

/** Reporte por dimensión con drill-down: una fila por miembro y una celda por indicador (null = no aplica). */
export async function reportePorDimension(f: Filtros, jerarquiaId: string, nivel: number, ruta: string[]) {
  const j = jerarquia(jerarquiaId);
  if (!j) throw new Error('Jerarquía no válida');
  const filas = new Map<string, Partial<Record<CodigoKpi, Celda | null>>>();
  const aplica: Record<string, boolean> = {};
  for (const k of INDICADORES) {
    aplica[k.codigo] = kpiAdmiteDimension(k, j.dimension);
    if (!aplica[k.codigo]) continue;
    for (const r of await consultarKpi(k, f, { agrupar: { jerarquia: jerarquiaId, nivel, ruta } })) {
      if (!r.den && !r.num) continue;
      const m = r.miembro ?? '(sin dato)';
      if (!filas.has(m)) filas.set(m, {});
      filas.get(m)![k.codigo] = { num: r.num, den: r.den };
    }
  }
  const lista = [...filas.entries()].map(([miembro, celdas]) => ({ miembro, celdas })).sort((a, b) => a.miembro.localeCompare(b.miembro, 'es'));
  return { jerarquia: j, nivel, ruta, aplica, filas: lista, hayMasNiveles: nivel < j.niveles.length - 1 };
}

/** Tendencia mensual de un indicador por la fecha de su propia cohorte. */
export async function tendenciaMensual(f: Filtros, codigo: CodigoKpi) {
  const k = INDICADORES.find((x) => x.codigo === codigo);
  if (!k) throw new Error('Indicador no válido');
  const filas = await consultarKpi(k, f, { agrupar: { jerarquia: 'tiempo', nivel: 2, ruta: [] } });
  return filas.filter((r) => r.den > 0 || r.num > 0).sort((a, b) => String(a.miembro).localeCompare(String(b.miembro)))
    .map((r) => ({ mes: r.miembro as string, num: r.num, den: r.den }));
}

/** Opciones de los filtros: solo miembros con hechos cargados (no se listan miembros huérfanos). */
export async function opcionesFiltros() {
  const r = await (await mart()).request().query(`
    SELECT DISTINCT de.GrupoEtapa AS v FROM dbo.Dim_Estudiante de
      WHERE de.KeyEstudiante IN (SELECT KeyEstudiante FROM dbo.Hecho_Oportunidad UNION SELECT KeyEstudiante FROM dbo.Hecho_Diagnostico);
    SELECT DISTINCT dc.Canal AS v FROM dbo.Dim_Canal_Captacion dc
      WHERE dc.KeyCanalCaptacion IN (SELECT KeyCanalCaptacion FROM dbo.Hecho_Oportunidad UNION SELECT KeyCanalCaptacion FROM dbo.Hecho_Diagnostico);
    SELECT DISTINCT da.Asesor AS v FROM dbo.Dim_Asesor da
      WHERE da.KeyAsesor IN (SELECT KeyAsesor FROM dbo.Hecho_Oportunidad UNION SELECT KeyAsesor FROM dbo.Hecho_Diagnostico);
    SELECT MIN(t.idFecha) AS minimo, MAX(t.idFecha) AS maximo FROM dbo.Dim_Tiempo t WHERE t.idFecha <> '19000101';`);
  const rs = r.recordsets as sql.IRecordSet<any>[];
  const lista = (i: number) => rs[i].map((x) => x.v as string).filter(Boolean).sort((a, b) => a.localeCompare(b, 'es'));
  return { gruposEtapa: lista(0), canales: lista(1), asesores: lista(2), rango: rs[3][0] };
}
