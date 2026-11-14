// Diagnóstico de tesis y aptitud para cotizar (tools solicitar_diagnostico, entregar_diagnostico, calificar_aptitud).
import { z } from 'zod';
import { sql } from '../db.js';
import { ErrorNegocio, oportunidadBloqueada, registrarEvento, transicionar, type Origen } from './oportunidad.js';

export const esquemaSolicitudDiagnostico = z.object({
  oportunidadId: z.number().int().positive(),
  temaTesis: z.string().max(250).optional(),
  tipoTesis: z.enum(['DESCRIPTIVA', 'CORRELACIONAL', 'EXPERIMENTAL', 'APLICADA', 'NO_DEFINIDO']).optional(),
  avanceDeclarado: z.number().min(0).max(100).optional(),
  tieneEmpresaAplicacion: z.boolean().optional(),
  limitaciones: z.string().max(300).optional(),
});

export interface DatosDiagnosticoMinimos {
  tema: string | null;
  tipoTesis: string | null;
  avance: number | null;
  tieneEmpresa: boolean | null;
  limitaciones: string | null;
  fechaLimite: string | null;
}

/** Campos que deben estar completos antes de entregar/calificar el diagnóstico. */
export function faltantesDiagnostico(d: DatosDiagnosticoMinimos): string[] {
  const faltan: string[] = [];
  if (!d.tema?.trim()) faltan.push('tema de tesis');
  if (!d.tipoTesis) faltan.push('tipo de investigación');
  if (d.avance == null) faltan.push('avance declarado');
  if (d.tieneEmpresa == null) faltan.push('si cuenta con empresa o institución');
  if (!d.limitaciones?.trim()) faltan.push('limitaciones');
  if (!d.fechaLimite) faltan.push('fecha límite');
  return faltan;
}

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

export async function entregarDiagnostico(tx: sql.Transaction, diagnosticoId: number, resumen: string, origen: Origen, oportunidadId?: number) {
  const r = await new sql.Request(tx).input('d', sql.Int, diagnosticoId).input('r', sql.NVarChar, resumen).input('o', sql.Int, oportunidadId ?? null)
    .query(`UPDATE dbo.DIAGNOSTICO SET estado = 'ENTREGADO', fecha_entrega = SYSDATETIME(), resumen = @r
            OUTPUT INSERTED.oportunidad_id, INSERTED.fecha_solicitud, INSERTED.fecha_entrega
            WHERE diagnostico_id = @d AND estado <> 'ENTREGADO' AND (@o IS NULL OR oportunidad_id = @o)`);
  const d = r.recordset[0];
  if (!d) throw new ErrorNegocio('El diagnóstico no existe o ya fue entregado.');
  // Normalmente la oportunidad ya está en EN_DIAGNOSTICO (la dejó ahí solicitar_diagnostico). Pero un diagnóstico
  // puede llegar ya resuelto desde BUYERS con la oportunidad todavía ABIERTA (para medir ese tiempo en los KPI);
  // al confirmarlo por WhatsApp recién avanza a EN_DIAGNOSTICO.
  const op = await oportunidadBloqueada(tx, d.oportunidad_id);
  if (op.estado === 'ABIERTA') await transicionar(tx, d.oportunidad_id, 'EN_DIAGNOSTICO', origen, 'Diagnóstico confirmado por el estudiante');
  const horas = (new Date(d.fecha_entrega).getTime() - new Date(d.fecha_solicitud).getTime()) / 3_600_000;
  await registrarEvento(tx, d.oportunidad_id, 'DIAGNOSTICO_ENTREGADO', origen, `Entregado en ${horas.toFixed(1)} h`);
  return { oportunidadId: d.oportunidad_id as number, fechaSolicitud: d.fecha_solicitud as Date,
    fechaEntrega: d.fecha_entrega as Date, horas };
}

/** Aptitud: requiere un diagnóstico entregado. Fija fecha_apta_cotizar (inicia el plazo de cotización). */
export async function calificarAptitud(tx: sql.Transaction, oportunidadId: number, origen: Origen) {
  const op = await oportunidadBloqueada(tx, oportunidadId);
  if (op.estado !== 'EN_DIAGNOSTICO') throw new ErrorNegocio(`Solo una oportunidad en diagnóstico puede calificarse (estado: ${op.estado}).`);
  const d = await new sql.Request(tx).input('o', sql.Int, oportunidadId)
    .query(`SELECT TOP 1 d.tema_tesis, d.tipo_tesis, d.avance_declarado, d.tiene_empresa_aplicacion, d.limitaciones,
                   d.requiere_derivacion, pn.fecha_limite
            FROM dbo.DIAGNOSTICO d
            LEFT JOIN dbo.PERFIL_NEGOCIACION pn ON pn.perfil_negociacion_id =
              (SELECT TOP 1 x.perfil_negociacion_id FROM dbo.PERFIL_NEGOCIACION x WHERE x.oportunidad_id = @o ORDER BY x.version DESC, x.perfil_negociacion_id DESC)
            WHERE d.oportunidad_id = @o AND d.estado = 'ENTREGADO' ORDER BY d.fecha_entrega DESC`);
  if (!d.recordset[0]) throw new ErrorNegocio('Falta un diagnóstico entregado: la aptitud solo se registra con información suficiente.');
  const x = d.recordset[0];
  const fechaLimite = x.fecha_limite ? (x.fecha_limite instanceof Date ? x.fecha_limite.toISOString().slice(0, 10) : String(x.fecha_limite).slice(0, 10)) : null;
  const faltan = faltantesDiagnostico({ tema: x.tema_tesis, tipoTesis: x.tipo_tesis, avance: x.avance_declarado == null ? null : Number(x.avance_declarado),
    tieneEmpresa: x.tiene_empresa_aplicacion == null ? null : !!x.tiene_empresa_aplicacion, limitaciones: x.limitaciones, fechaLimite });
  if (faltan.length) throw new ErrorNegocio(`Faltan requisitos mínimos del diagnóstico: ${faltan.join(', ')}.`);
  await transicionar(tx, oportunidadId, 'APTA_PARA_COTIZAR', origen, 'Requisitos mínimos verificados');
}
