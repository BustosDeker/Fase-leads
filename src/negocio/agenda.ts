// Agenda de citas virtuales OPCIONALES (informe, tabla 7). Regla: sin solapamientos por asesor
// (las canceladas no cuentan) e inicio < fin. Cada cambio queda en CITA_HISTORIAL.
import { z } from 'zod';
import { sql } from '../db.js';
import { ErrorNegocio, registrarEvento, type Origen } from './oportunidad.js';

export const ESTADOS_CITA = ['SOLICITADA', 'CONFIRMADA', 'REALIZADA', 'CANCELADA', 'NO_ASISTIO'] as const;
const TRANSICIONES_CITA: Record<string, string[]> = {
  SOLICITADA: ['CONFIRMADA', 'CANCELADA'], CONFIRMADA: ['REALIZADA', 'NO_ASISTIO', 'CANCELADA'],
  REALIZADA: [], CANCELADA: [], NO_ASISTIO: [],
};

export const esquemaCita = z.object({
  oportunidadId: z.number().int().positive(),
  asesorId: z.number().int().positive(),
  inicio: z.coerce.date(),
  duracionMin: z.number().int().min(15).max(180).default(45),
  medio: z.enum(['Google Meet', 'Zoom', 'Llamada de WhatsApp']).default('Google Meet'),
});

/** Sala fija configurada por la empresa/asesor. Nunca se genera una URL en código. */
export function enlaceConfigurado(medio: z.infer<typeof esquemaCita>['medio']): string | null {
  if (medio === 'Google Meet') return process.env.CITA_ENLACE_GOOGLE_MEET?.trim() || null;
  if (medio === 'Zoom') return process.env.CITA_ENLACE_ZOOM?.trim() || null;
  return null;
}

async function tieneColumnaEnlace(tx: sql.Transaction) {
  const r = await new sql.Request(tx).query("SELECT CASE WHEN COL_LENGTH('dbo.CITA_VIRTUAL', 'enlace') IS NULL THEN 0 ELSE 1 END AS existe");
  return !!r.recordset[0]?.existe;
}

async function leerCita(tx: sql.Transaction, citaId: number) {
  const conEnlace = await tieneColumnaEnlace(tx);
  const enlace = conEnlace ? 'enlace' : 'CAST(NULL AS NVARCHAR(300)) AS enlace';
  const r = await new sql.Request(tx).input('c', sql.Int, citaId).query(`
    SELECT cita_id, oportunidad_id, asesor_id, inicio, fin, medio, estado, ${enlace}
    FROM dbo.CITA_VIRTUAL WHERE cita_id = @c`);
  return r.recordset[0] as { cita_id: number; oportunidad_id: number; asesor_id: number; inicio: Date; fin: Date;
    medio: string; estado: string; enlace: string | null } | undefined;
}

async function haySolapamiento(tx: sql.Transaction, asesorId: number, inicio: Date, fin: Date, excluirCita?: number) {
  const r = await new sql.Request(tx).input('a', sql.Int, asesorId).input('i', sql.DateTime2, inicio).input('f', sql.DateTime2, fin)
    .input('x', sql.Int, excluirCita ?? null)
    .query(`SELECT TOP 1 cita_id, inicio, fin FROM dbo.CITA_VIRTUAL WITH (UPDLOCK, HOLDLOCK)
            WHERE asesor_id = @a AND estado <> 'CANCELADA' AND inicio < @f AND @i < fin AND (@x IS NULL OR cita_id <> @x)`);
  return r.recordset[0] as { cita_id: number; inicio: Date; fin: Date } | undefined;
}

export async function agendarCita(tx: sql.Transaction, c: z.infer<typeof esquemaCita>, origen: Origen) {
  const fin = new Date(c.inicio.getTime() + c.duracionMin * 60_000);
  if (c.inicio.getTime() < Date.now() - 60_000) throw new ErrorNegocio('No se puede agendar en el pasado.');
  const choque = await haySolapamiento(tx, c.asesorId, c.inicio, fin);
  if (choque) throw new ErrorNegocio(`El asesor ya tiene la cita #${choque.cita_id} en ese horario. Elige otro horario.`, 409);
  const conEnlace = await tieneColumnaEnlace(tx);
  const enlace = enlaceConfigurado(c.medio);
  const r = await new sql.Request(tx).input('o', sql.Int, c.oportunidadId).input('a', sql.Int, c.asesorId).input('i', sql.DateTime2, c.inicio)
    .input('f', sql.DateTime2, fin).input('m', sql.VarChar, c.medio).input('e', sql.NVarChar(300), enlace)
    .query(conEnlace
      ? `INSERT dbo.CITA_VIRTUAL (oportunidad_id, asesor_id, inicio, fin, medio, estado, enlace) OUTPUT INSERTED.cita_id
         VALUES (@o, @a, @i, @f, @m, 'SOLICITADA', @e)`
      : `INSERT dbo.CITA_VIRTUAL (oportunidad_id, asesor_id, inicio, fin, medio, estado) OUTPUT INSERTED.cita_id
         VALUES (@o, @a, @i, @f, @m, 'SOLICITADA')`);
  const citaId: number = r.recordset[0].cita_id;
  await historial(tx, citaId, null, 'SOLICITADA', origen === 'AGENTE' ? 'Propuesta por el agente y aceptada por el estudiante' : 'Registrada por un asesor');
  await registrarEvento(tx, c.oportunidadId, 'CITA_SOLICITADA', origen, `${c.inicio.toLocaleString('es-PE')} · ${c.medio}`);
  return { citaId, inicio: c.inicio, fin, medio: c.medio, enlace: conEnlace ? enlace : null };
}

export async function cambiarEstadoCita(tx: sql.Transaction, citaId: number, nuevo: string, causa: string, origen: Origen) {
  const r = await new sql.Request(tx).input('c', sql.Int, citaId)
    .query('SELECT cita_id, oportunidad_id, estado FROM dbo.CITA_VIRTUAL WITH (UPDLOCK) WHERE cita_id = @c');
  const cita = r.recordset[0];
  if (!cita) throw new ErrorNegocio('La cita no existe.', 404);
  if (!TRANSICIONES_CITA[cita.estado]?.includes(nuevo)) throw new ErrorNegocio(`Una cita ${cita.estado} no puede pasar a ${nuevo}.`);
  await new sql.Request(tx).input('c', sql.Int, citaId).input('e', sql.VarChar, nuevo)
    .query(`UPDATE dbo.CITA_VIRTUAL SET estado = @e, fecha_confirmacion = CASE WHEN @e = 'CONFIRMADA' THEN SYSDATETIME() ELSE fecha_confirmacion END
            WHERE cita_id = @c`);
  await historial(tx, citaId, cita.estado, nuevo, causa);
  await registrarEvento(tx, cita.oportunidad_id, `CITA_${nuevo}`, origen, causa);
  return leerCita(tx, citaId);
}

export async function reprogramarCita(tx: sql.Transaction, citaId: number, inicio: Date, duracionMin: number, origen: Origen) {
  const r = await new sql.Request(tx).input('c', sql.Int, citaId)
    .query('SELECT cita_id, oportunidad_id, asesor_id, estado, inicio FROM dbo.CITA_VIRTUAL WITH (UPDLOCK) WHERE cita_id = @c');
  const cita = r.recordset[0];
  if (!cita) throw new ErrorNegocio('La cita no existe.', 404);
  if (!['SOLICITADA', 'CONFIRMADA'].includes(cita.estado)) throw new ErrorNegocio('Solo se reprograma una cita solicitada o confirmada.');
  if (inicio.getTime() < Date.now() - 60_000) throw new ErrorNegocio('No se puede reprogramar en el pasado.');
  const fin = new Date(inicio.getTime() + duracionMin * 60_000);
  const choque = await haySolapamiento(tx, cita.asesor_id, inicio, fin, citaId);
  if (choque) throw new ErrorNegocio(`El asesor ya tiene la cita #${choque.cita_id} en ese horario.`, 409);
  await new sql.Request(tx).input('c', sql.Int, citaId).input('i', sql.DateTime2, inicio).input('f', sql.DateTime2, fin)
    .query(`UPDATE dbo.CITA_VIRTUAL SET inicio = @i, fin = @f, estado = 'SOLICITADA', fecha_confirmacion = NULL WHERE cita_id = @c`);
  await historial(tx, citaId, cita.estado, 'SOLICITADA', `Reprogramada desde ${new Date(cita.inicio).toLocaleString('es-PE')}`);
  await registrarEvento(tx, cita.oportunidad_id, 'CITA_REPROGRAMADA', origen, inicio.toLocaleString('es-PE'));
  return leerCita(tx, citaId);
}

async function historial(tx: sql.Transaction, citaId: number, anterior: string | null, nuevo: string, causa: string) {
  await new sql.Request(tx).input('c', sql.Int, citaId).input('a', sql.VarChar, anterior).input('n', sql.VarChar, nuevo).input('ca', sql.NVarChar, causa)
    .query('INSERT dbo.CITA_HISTORIAL (cita_id, estado_anterior, estado_nuevo, causa) VALUES (@c, @a, @n, @ca)');
}
