// Cotización versionada (tool `cotizar` del agente y pantalla Cotizador).
// El precio sale SIEMPRE de TARIFA + REGLA_PRECIO (motor de precios); nunca de un monto escrito a mano.
// Si lo pedido viola el tope de descuento o el precio mínimo, la propuesta queda BLOQUEADA (no se recorta en silencio).
import { z } from 'zod';
import { sql } from '../db.js';
import { cotizar, validarLimites, type Extra, type Regla, type Tarifa } from './precios.js';
import { ErrorNegocio, oportunidadBloqueada, registrarEvento, transicionar, type Origen } from './oportunidad.js';

export const esquemaSolicitudCotizacion = z.object({
  oportunidadId: z.number().int().positive(),
  servicioId: z.number().int().positive(),
  formaPago: z.enum(['CONTADO', 'CUOTAS']).default('CUOTAS'),
  aplicarPromocion: z.boolean().default(false),
  descuentoNegociadoPct: z.number().min(0).max(100).default(0),
  extras: z.array(z.object({ entregableId: z.number().int(), cantidad: z.number().int().min(1).max(10) })).max(10).default([]),
});
export type SolicitudCotizacion = z.infer<typeof esquemaSolicitudCotizacion>;

type Ejecutor = { request(): sql.Request } | sql.Transaction;
const req = (e: Ejecutor) => (e instanceof sql.Transaction ? new sql.Request(e) : e.request());

/** Contexto para cotizar: datos del estudiante (de BUYERS y del diagnóstico), servicios con tarifa, reglas y extras. */
export async function contextoCotizacion(e: Ejecutor, oportunidadId: number) {
  const r = await req(e).input('o', sql.Int, oportunidadId).query(`
    SELECT o.oportunidad_id, o.estado, o.lead_id, o.asesor_responsable_id,
           co.nombres + ' ' + co.apellidos AS estudiante, u.nombre AS universidad, ca.carrera_id, ca.nombre AS carrera,
           pa.etapa_academica, d.avance_declarado, d.tipo_tesis,
           (SELECT TOP 1 fecha_limite FROM dbo.PERFIL_NEGOCIACION pn WHERE pn.oportunidad_id = o.oportunidad_id ORDER BY version DESC, perfil_negociacion_id DESC) AS fecha_limite
    FROM dbo.OPORTUNIDAD_COMERCIAL o
    JOIN dbo.LEAD l ON l.lead_id = o.lead_id JOIN dbo.BUYER b ON b.buyer_id = l.buyer_id JOIN dbo.CONTACTO co ON co.contacto_id = b.contacto_id
    LEFT JOIN dbo.PERFIL_ACADEMICO pa ON pa.contacto_id = co.contacto_id
    LEFT JOIN dbo.UNIVERSIDAD u ON u.universidad_id = pa.universidad_id LEFT JOIN dbo.CARRERA ca ON ca.carrera_id = pa.carrera_id
    OUTER APPLY (SELECT TOP 1 avance_declarado, tipo_tesis FROM dbo.DIAGNOSTICO x WHERE x.oportunidad_id = o.oportunidad_id ORDER BY x.fecha_solicitud DESC) d
    WHERE o.oportunidad_id = @o;
    SELECT s.servicio_id, s.nombre, s.familia, t.tarifa_id, t.precio_base, t.precio_minimo, t.tope_descuento_pct
    FROM dbo.SERVICIO s JOIN dbo.TARIFA t ON t.servicio_id = s.servicio_id AND t.activo = 1
    WHERE s.activo = 1 AND t.carrera_id = (SELECT pa.carrera_id FROM dbo.OPORTUNIDAD_COMERCIAL o JOIN dbo.LEAD l ON l.lead_id = o.lead_id
          JOIN dbo.BUYER b ON b.buyer_id = l.buyer_id JOIN dbo.PERFIL_ACADEMICO pa ON pa.contacto_id = b.contacto_id WHERE o.oportunidad_id = @o)
      AND t.vigente_desde <= CAST(SYSDATETIME() AS DATE) AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= CAST(SYSDATETIME() AS DATE))
    ORDER BY s.familia, s.nombre;
    SELECT regla_id, nombre, tipo, factor, valor_condicion, umbral_dias, porcentaje FROM dbo.REGLA_PRECIO
    WHERE activa = 1 AND vigente_desde <= CAST(SYSDATETIME() AS DATE) AND (vigente_hasta IS NULL OR vigente_hasta >= CAST(SYSDATETIME() AS DATE));
    SELECT entregable_id, nombre, precio_extra FROM dbo.ENTREGABLE WHERE tipo_entregable = 'EXTRA' AND activo = 1 ORDER BY nombre;`);
  const [cx, servicios, reglas, extras] = r.recordsets as sql.IRecordSet<any>[];
  if (!cx[0]) throw new ErrorNegocio('La oportunidad no existe.', 404);
  return {
    oportunidad: cx[0],
    servicios: servicios.map((s: any) => ({ servicioId: s.servicio_id, nombre: s.nombre, familia: s.familia,
      tarifa: { tarifaId: s.tarifa_id, precioBase: Number(s.precio_base), precioMinimo: Number(s.precio_minimo), topeDescuentoPct: Number(s.tope_descuento_pct) } as Tarifa })),
    reglas: reglas.map((x: any): Regla => ({ reglaId: x.regla_id, nombre: x.nombre, tipo: x.tipo, factor: x.factor,
      valorCondicion: x.valor_condicion, umbralDias: x.umbral_dias, porcentaje: Number(x.porcentaje) })),
    extras: extras.map((x: any): Extra => ({ entregableId: x.entregable_id, nombre: x.nombre, cantidad: 1, precioUnitario: Number(x.precio_extra) })),
  };
}

/** Calcula la cotización. `bloqueada` = el AJUSTE NEGOCIADO exige más descuento del permitido (tope o mínimo).
 *  Si solo las reglas automáticas superan el tope, se acotan con aviso y la propuesta sí puede presentarse. */
export async function simularCotizacion(e: Ejecutor, s: SolicitudCotizacion) {
  const cx = await contextoCotizacion(e, s.oportunidadId);
  const serv = cx.servicios.find((x) => x.servicioId === s.servicioId);
  if (!serv) throw new ErrorNegocio('No hay tarifa vigente para ese servicio y la carrera del estudiante: corresponde escalar (PRECIO_NO_CONFIGURADO).');
  const extras = s.extras.map((x) => {
    const e2 = cx.extras.find((y) => y.entregableId === x.entregableId);
    if (!e2) throw new ErrorNegocio('Extra no válido.');
    return { ...e2, cantidad: x.cantidad };
  });
  const dias = cx.oportunidad.fecha_limite ? (new Date(cx.oportunidad.fecha_limite).getTime() - Date.now()) / 86_400_000 : null;
  const q = cotizar(serv.tarifa, cx.reglas, {
    universidad: cx.oportunidad.universidad, etapaAcademica: cx.oportunidad.etapa_academica, avance: cx.oportunidad.avance_declarado,
    tipoTesis: cx.oportunidad.tipo_tesis, formaPago: s.formaPago, diasHastaFechaLimite: dias, aplicarPromocion: s.aplicarPromocion,
    descuentoNegociadoPct: s.descuentoNegociadoPct,
  }, extras);
  return { cotizacion: q, servicio: serv, bloqueada: q.negociadoExcede, motivosBloqueo: q.negociadoExcede ? q.avisos : [], avisos: q.avisos };
}

/** Presenta una NUEVA VERSIÓN (la anterior vigente pasa a REEMPLAZADA). Transacción completa. */
export async function presentarPropuesta(tx: sql.Transaction, s: SolicitudCotizacion, op: { origen: Origen; asesorId: number | null }) {
  const opo = await oportunidadBloqueada(tx, s.oportunidadId);
  if (!['APTA_PARA_COTIZAR', 'EN_NEGOCIACION'].includes(opo.estado))
    throw new ErrorNegocio(`Solo se cotiza una oportunidad apta o en negociación (estado actual: ${opo.estado}).`);
  const sim = await simularCotizacion(tx, s);
  if (sim.bloqueada) throw new ErrorNegocio(`Propuesta bloqueada: ${sim.motivosBloqueo.join(' ')}`);
  const q = sim.cotizacion;
  if (validarLimites(q).length) throw new ErrorNegocio(validarLimites(q).join(' '));
  const v = await new sql.Request(tx).input('o', sql.Int, s.oportunidadId)
    .query('SELECT ISNULL(MAX(version), 0) + 1 AS v FROM dbo.PROPUESTA WITH (UPDLOCK, HOLDLOCK) WHERE oportunidad_id = @o');
  const version: number = v.recordset[0].v;
  await new sql.Request(tx).input('o', sql.Int, s.oportunidadId)
    .query(`UPDATE dbo.PROPUESTA SET estado = 'REEMPLAZADA' WHERE oportunidad_id = @o AND estado = 'PRESENTADA'`);
  const ins = await new sql.Request(tx)
    .input('l', sql.Int, opo.lead_id).input('o', sql.Int, s.oportunidadId).input('s', sql.Int, s.servicioId).input('t', sql.Int, q.tarifaId)
    .input('a', sql.Int, op.asesorId).input('g', sql.VarChar, op.asesorId == null ? 'BOT' : 'ESPECIALISTA').input('v', sql.Int, version)
    .input('pb', sql.Decimal(10, 2), q.precioBase).input('me', sql.Decimal(10, 2), q.montoExtras).input('de', sql.Decimal(10, 2), q.descuento)
    .input('re', sql.Decimal(10, 2), q.recargo).input('pm', sql.Decimal(10, 2), q.precioMinimo).input('tp', sql.Decimal(5, 2), q.topeDescuentoPct)
    .query(`INSERT dbo.PROPUESTA (lead_id, oportunidad_id, servicio_id, tarifa_id, asesor_id, generada_por, version, fecha_presentacion,
              precio_base, monto_extras, descuento, recargo, precio_minimo_aplicado, tope_descuento_aplicado, vigencia_hasta, estado)
            OUTPUT INSERTED.propuesta_id, INSERTED.precio_final
            VALUES (@l, @o, @s, @t, @a, @g, @v, SYSDATETIME(), @pb, @me, @de, @re, @pm, @tp, DATEADD(DAY, 7, CAST(SYSDATETIME() AS DATE)), 'PRESENTADA')`);
  const propuestaId: number = ins.recordset[0].propuesta_id;
  for (const a of q.ajustes) await new sql.Request(tx).input('p', sql.Int, propuestaId).input('r', sql.Int, a.reglaId).input('t', sql.VarChar, a.tipo)
    .input('c', sql.NVarChar, a.concepto).input('pc', sql.Decimal(5, 2), a.porcentaje).input('m', sql.Decimal(10, 2), a.monto)
    .query('INSERT dbo.PROPUESTA_AJUSTE (propuesta_id, regla_id, tipo, concepto, porcentaje, monto) VALUES (@p, @r, @t, @c, @pc, @m)');
  await new sql.Request(tx).input('p', sql.Int, propuestaId).input('s', sql.Int, s.servicioId).query(`
    INSERT dbo.PROPUESTA_ENTREGABLE (propuesta_id, entregable_id, cantidad, precio_unitario, es_extra)
    SELECT @p, entregable_id, ISNULL(cantidad_incluida, 1), 0, 0 FROM dbo.SERVICIO_ENTREGABLE WHERE servicio_id = @s`);
  for (const x of q.extras) await new sql.Request(tx).input('p', sql.Int, propuestaId).input('e', sql.Int, x.entregableId)
    .input('c', sql.Int, x.cantidad).input('pu', sql.Decimal(10, 2), x.precioUnitario)
    .query(`MERGE dbo.PROPUESTA_ENTREGABLE AS d USING (SELECT @p AS p, @e AS e) s ON d.propuesta_id = s.p AND d.entregable_id = s.e
            WHEN MATCHED THEN UPDATE SET cantidad = d.cantidad + @c, precio_unitario = @pu, es_extra = 1
            WHEN NOT MATCHED THEN INSERT (propuesta_id, entregable_id, cantidad, precio_unitario, es_extra) VALUES (@p, @e, @c, @pu, 1);`);
  if (opo.estado === 'APTA_PARA_COTIZAR') await transicionar(tx, s.oportunidadId, 'EN_NEGOCIACION', op.origen, `Versión ${version}`);
  await registrarEvento(tx, s.oportunidadId, `PROPUESTA_V${version}`, op.origen, `S/ ${q.precioFinal.toFixed(2)} · ${sim.servicio.nombre}`);
  return { propuestaId, version, precioFinal: q.precioFinal, cotizacion: q };
}
