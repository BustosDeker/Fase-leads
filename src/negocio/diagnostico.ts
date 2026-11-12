// Diagnóstico de tesis y aptitud para cotizar (tools solicitar_diagnostico, entregar_diagnostico, calificar_aptitud).
import { z } from 'zod';
import { sql } from '../db.js';
import { ErrorNegocio, oportunidadBloqueada, registrarEvento, transicionar, type Origen } from './oportunidad.js';

export const esquemaSolicitudDiagnostico = z.object({
  oportunidadId: z.number().int().positive(),
  temaTesis: z.string().max(250).optional(),
  tipoTesis: z.enum(['DESCRIPTIVA', 'CORRELACIONAL', 'EXPERIMENTAL', 'APLICADA']).optional(),
  avanceDeclarado: z.number().min(0).max(100).optional(),
  tieneEmpresaAplicacion: z.boolean().optional(),
  limitaciones: z.string().max(300).optional(),
});

export async function solicitarDiagnostico(tx: sql.Transaction, s: z.infer<typeof esquemaSolicitudDiagnostico>, asesorId: number | null, origen: Origen) {
  const op = await oportunidadBloqueada(tx, s.oportunidadId);
  if (!['ABIERTA', 'EN_DIAGNOSTICO'].includes(op.estado)) throw new ErrorNegocio(`La oportunidad ya está en ${op.estado}.`);
  const r = await new sql.Request(tx).input('l', sql.Int, op.lead_id).input('o', sql.Int, s.oportunidadId).input('a', sql.Int, asesorId)
    .input('t', sql.NVarChar, s.temaTesis ?? null).input('tt', sql.VarChar, s.tipoTesis ?? null).input('av', sql.Decimal(5, 2), s.avanceDeclarado ?? null)
    .input('em', sql.Bit, s.tieneEmpresaAplicacion ?? null).input('li', sql.NVarChar, s.limitaciones ?? null)
    .query(`INSERT dbo.DIAGNOSTICO (lead_id, oportunidad_id, asesor_id, fecha_solicitud, estado, tema_tesis, tipo_tesis, avance_declarado,
              tiene_empresa_aplicacion, limitaciones, requiere_derivacion)
            OUTPUT INSERTED.diagnostico_id, INSERTED.fecha_solicitud
            VALUES (@l, @o, @a, SYSDATETIME(), 'SOLICITADO', @t, @tt, @av, @em, @li, CASE WHEN @a IS NULL THEN 0 ELSE 1 END)`);
  if (op.estado === 'ABIERTA') await transicionar(tx, s.oportunidadId, 'EN_DIAGNOSTICO', origen);
  return r.recordset[0] as { diagnostico_id: number; fecha_solicitud: Date };
}

export async function entregarDiagnostico(tx: sql.Transaction, diagnosticoId: number, resumen: string, origen: Origen) {
  const r = await new sql.Request(tx).input('d', sql.Int, diagnosticoId).input('r', sql.NVarChar, resumen)
    .query(`UPDATE dbo.DIAGNOSTICO SET estado = 'ENTREGADO', fecha_entrega = SYSDATETIME(), resumen = @r
            OUTPUT INSERTED.oportunidad_id, INSERTED.fecha_solicitud, INSERTED.fecha_entrega
            WHERE diagnostico_id = @d AND estado <> 'ENTREGADO'`);
  const d = r.recordset[0];
  if (!d) throw new ErrorNegocio('El diagnóstico no existe o ya fue entregado.');
  const horas = (new Date(d.fecha_entrega).getTime() - new Date(d.fecha_solicitud).getTime()) / 3_600_000;
  await registrarEvento(tx, d.oportunidad_id, 'DIAGNOSTICO_ENTREGADO', origen, `Entregado en ${horas.toFixed(1)} h`);
  return { oportunidadId: d.oportunidad_id as number, horas };
}

/** Aptitud: requiere un diagnóstico entregado. Fija fecha_apta_cotizar (inicia el plazo de cotización). */
export async function calificarAptitud(tx: sql.Transaction, oportunidadId: number, origen: Origen) {
  const op = await oportunidadBloqueada(tx, oportunidadId);
  if (op.estado !== 'EN_DIAGNOSTICO') throw new ErrorNegocio(`Solo una oportunidad en diagnóstico puede calificarse (estado: ${op.estado}).`);
  const d = await new sql.Request(tx).input('o', sql.Int, oportunidadId)
    .query(`SELECT COUNT(*) AS n FROM dbo.DIAGNOSTICO WHERE oportunidad_id = @o AND estado = 'ENTREGADO'`);
  if (!d.recordset[0].n) throw new ErrorNegocio('Falta un diagnóstico entregado: la aptitud solo se registra con información suficiente.');
  await transicionar(tx, oportunidadId, 'APTA_PARA_COTIZAR', origen, 'Requisitos mínimos verificados');
}
