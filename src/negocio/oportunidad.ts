// Máquina de estados de la oportunidad (informe, tabla 6). Validada aquí Y en la BD
// (TRANSICION_ESTADO_OPORTUNIDAD + trigger). Cada transición guarda su evento con fecha.
import { sql } from '../db.js';

export const ESTADOS = ['ABIERTA', 'EN_DIAGNOSTICO', 'APTA_PARA_COTIZAR', 'EN_NEGOCIACION', 'ACEPTADA', 'TRANSFERIDA',
  'PAYER_CONFIRMADO', 'DESCARTADA'] as const;
export type EstadoOportunidad = (typeof ESTADOS)[number];
export type Origen = 'AGENTE' | 'HUMANO' | 'SISTEMA' | 'PAYERS';

export class ErrorNegocio extends Error {
  constructor(mensaje: string, public estado = 422) { super(mensaje); }
}

/** Lee la oportunidad bloqueándola hasta el fin de la transacción (evita carreras entre agente y humano). */
export async function oportunidadBloqueada(tx: sql.Transaction, oportunidadId: number) {
  const r = await new sql.Request(tx).input('id', sql.Int, oportunidadId).query(`
    SELECT o.oportunidad_id, o.lead_id, o.estado, o.fecha_inicio, o.fecha_apta_cotizar, o.asesor_responsable_id, o.es_demo
    FROM dbo.OPORTUNIDAD_COMERCIAL o WITH (UPDLOCK, ROWLOCK) WHERE o.oportunidad_id = @id`);
  if (!r.recordset[0]) throw new ErrorNegocio('La oportunidad no existe.', 404);
  return r.recordset[0] as { oportunidad_id: number; lead_id: number; estado: EstadoOportunidad; fecha_inicio: Date;
    fecha_apta_cotizar: Date | null; asesor_responsable_id: number | null; es_demo: boolean };
}

export async function registrarEvento(tx: sql.Transaction, oportunidadId: number, evento: string, origen: Origen,
  detalle?: string | null, anterior: string | null = null, nuevo: string | null = null) {
  await new sql.Request(tx).input('o', sql.Int, oportunidadId).input('ea', sql.VarChar, anterior).input('en', sql.VarChar, nuevo)
    .input('ev', sql.VarChar, evento).input('or', sql.VarChar, origen).input('d', sql.NVarChar, detalle ?? null)
    .query(`INSERT dbo.OPORTUNIDAD_EVENTO (oportunidad_id, estado_anterior, estado_nuevo, evento, origen, detalle)
            VALUES (@o, @ea, @en, @ev, @or, @d)`);
}

/** Cambia el estado si la transición está permitida; si no, lanza un error de negocio (422). */
export async function transicionar(tx: sql.Transaction, oportunidadId: number, nuevo: EstadoOportunidad, origen: Origen, detalle?: string) {
  const op = await oportunidadBloqueada(tx, oportunidadId);
  if (op.estado === nuevo) return op.estado;
  const t = await new sql.Request(tx).input('o', sql.VarChar, op.estado).input('d', sql.VarChar, nuevo)
    .query('SELECT evento FROM dbo.TRANSICION_ESTADO_OPORTUNIDAD WHERE estado_origen = @o AND estado_destino = @d');
  if (!t.recordset[0]) throw new ErrorNegocio(`No se puede pasar de ${op.estado} a ${nuevo}.`);
  const cierre = nuevo === 'DESCARTADA' || nuevo === 'PAYER_CONFIRMADO';
  await new sql.Request(tx).input('id', sql.Int, oportunidadId).input('e', sql.VarChar, nuevo)
    .input('m', sql.NVarChar, nuevo === 'DESCARTADA' ? (detalle ?? 'Descartada') : nuevo === 'PAYER_CONFIRMADO' ? 'Contratación confirmada por PAYERS' : null)
    .query(`UPDATE dbo.OPORTUNIDAD_COMERCIAL SET estado = @e
            ${cierre ? ', fecha_cierre = SYSDATETIME(), motivo_cierre = @m' : ''}
            ${nuevo === 'APTA_PARA_COTIZAR' ? ', fecha_apta_cotizar = ISNULL(fecha_apta_cotizar, SYSDATETIME())' : ''}
            WHERE oportunidad_id = @id`);
  await registrarEvento(tx, oportunidadId, t.recordset[0].evento, origen, detalle, op.estado, nuevo);
  return nuevo;
}

/** Ejecuta `fn` en una transacción (commit si termina bien; rollback si falla). */
export async function enTransaccion<T>(pool: sql.ConnectionPool, fn: (tx: sql.Transaction) => Promise<T>): Promise<T> {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const r = await fn(tx);
    await tx.commit();
    return r;
  } catch (e) {
    try { await tx.rollback(); } catch { /* ya revertida */ }
    throw e;
  }
}
