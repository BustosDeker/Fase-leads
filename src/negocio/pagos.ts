// Pasarela de pago simulada (Bloque E del informe: ORDEN_PAGO, CUOTA_PAGO, ENLACE_PAGO, PAGO, PAYER).
// Al aceptar la propuesta, LEADS genera su propio enlace (de la primera cuota, o del total si es al contado)
// y lo envía por WhatsApp: ACEPTADA -> PENDIENTE_PAGO. Con el primer pago ya es PAYER_CONFIRMADO (aunque falten
// cuotas): cada cuota siguiente se cobra con su propio enlace, enviado automáticamente cuando vence la fecha.
// Si decide no pagar nada, PENDIENTE_PAGO -> DESCARTADA. Nunca se piden datos reales de tarjeta.
import crypto from 'node:crypto';
import { oltp, sql } from '../db.js';
import { publicar } from '../server/eventos.js';
import { enviarAConversacion } from '../whatsapp/openwa.js';
import { ErrorNegocio, enTransaccion, oportunidadBloqueada, registrarEvento, transicionar, type Origen } from './oportunidad.js';

const baseUrl = () => (process.env.APP_URL || `http://localhost:${process.env.PORT || 3100}`).replace(/\/$/, '');
const nuevoToken = () => crypto.randomBytes(18).toString('base64url');
// 2 cuotas: 50/50. 3 cuotas: 34/33/33 (el redondeo de la última cuadra el total exacto).
const SPLITS: Record<number, number[]> = { 1: [100], 2: [50, 50], 3: [34, 33, 33] };

export interface EnlacePago { token: string; url: string; servicio: string; monto: number; estudiante: string; cuotaActual: number; totalCuotas: number }

/** Notifica en la conversación del estudiante (WhatsApp real o simulador). */
async function avisarEnConversacion(oportunidadId: number, texto: string) {
  const r = await (await oltp()).request().input('o', sql.Int, oportunidadId).query(`
    SELECT TOP 1 conversacion_id, canal_mensajeria FROM dbo.CONVERSACION WHERE oportunidad_id = @o ORDER BY conversacion_id DESC`);
  const c = r.recordset[0];
  if (!c) return;
  if (c.canal_mensajeria === 'WHATSAPP') { try { await enviarAConversacion(c.conversacion_id, texto); } catch (e) { console.error('[pagos] no se pudo enviar por WhatsApp:', (e as Error).message); } }
  await (await oltp()).request().input('c', sql.Int, c.conversacion_id).input('t', sql.VarChar, texto).query(`
    INSERT dbo.MENSAJE (conversacion_id, emisor, tipo, contenido, dentro_ventana) VALUES (@c, 'BOT', 'TEXTO', @t, 1)`);
  publicar('conversacion', { conversacionId: c.conversacion_id, oportunidadId });
}

/** Genera el plan de pago y el enlace de la primera cuota (o del total, si es al contado): ACEPTADA -> PENDIENTE_PAGO.
 *  Las cuotas se fijan aquí mismo, con lo que el estudiante acaba de confirmar; no se pueden cambiar después. */
export async function generarEnlacePago(oportunidadId: number, origen: Origen, plan: { modalidad: 'CONTADO' | 'CUOTAS'; numeroCuotas?: 2 | 3 }): Promise<EnlacePago> {
  return enTransaccion(await oltp(), async (tx) => {
    const op = await oportunidadBloqueada(tx, oportunidadId);
    const p = await new sql.Request(tx).input('o', sql.Int, oportunidadId).query(`
      SELECT TOP 1 p.propuesta_id, p.lead_id, p.precio_final, s.nombre AS servicio, co.nombres + ' ' + co.apellidos AS estudiante
      FROM dbo.PROPUESTA p JOIN dbo.SERVICIO s ON s.servicio_id = p.servicio_id
      JOIN dbo.LEAD l ON l.lead_id = p.lead_id JOIN dbo.BUYER b ON b.buyer_id = l.buyer_id JOIN dbo.CONTACTO co ON co.contacto_id = b.contacto_id
      WHERE p.oportunidad_id = @o AND p.estado = 'ACEPTADA' ORDER BY p.version DESC`);
    const prop = p.recordset[0];
    if (!prop) throw new ErrorNegocio('La oportunidad no tiene una propuesta aceptada.');

    // ORDEN_PAGO es única por propuesta: si ya existe, el plan quedó fijado y solo se reusa su enlace pendiente.
    const existente = await new sql.Request(tx).input('p', sql.Int, prop.propuesta_id).query(`
      SELECT o.orden_pago_id, mp.numero_cuotas,
             (SELECT TOP 1 x.token FROM dbo.ENLACE_PAGO x WHERE x.orden_pago_id = o.orden_pago_id AND x.estado = 'ENVIADO' ORDER BY x.enlace_id DESC) AS token,
             (SELECT TOP 1 c.numero_cuota FROM dbo.ENLACE_PAGO x JOIN dbo.CUOTA_PAGO c ON c.cuota_id = x.cuota_id
                WHERE x.orden_pago_id = o.orden_pago_id AND x.estado = 'ENVIADO' ORDER BY x.enlace_id DESC) AS numero_cuota,
             (SELECT TOP 1 c.monto_programado FROM dbo.ENLACE_PAGO x JOIN dbo.CUOTA_PAGO c ON c.cuota_id = x.cuota_id
                WHERE x.orden_pago_id = o.orden_pago_id AND x.estado = 'ENVIADO' ORDER BY x.enlace_id DESC) AS monto_cuota
      FROM dbo.ORDEN_PAGO o JOIN dbo.MODALIDAD_PAGO mp ON mp.modalidad_pago_id = o.modalidad_pago_id WHERE o.propuesta_id = @p`);
    const ex = existente.recordset[0];
    if (ex) {
      if (!ex.token) throw new ErrorNegocio('Esta propuesta ya tiene un plan de pago resuelto (pagado o anulado).');
      return { token: ex.token, url: `${baseUrl()}/pagar/${ex.token}`, servicio: prop.servicio,
        monto: Number(ex.monto_cuota ?? prop.precio_final), estudiante: prop.estudiante, cuotaActual: ex.numero_cuota ?? 1, totalCuotas: ex.numero_cuotas };
    }
    if (op.estado !== 'ACEPTADA') throw new ErrorNegocio(`Solo se genera el enlace de pago desde ACEPTADA (estado actual: ${op.estado}).`);

    const numeroCuotas = plan.modalidad === 'CONTADO' ? 1 : (plan.numeroCuotas ?? 2);
    const nombreModalidad = numeroCuotas === 1 ? 'Al contado' : `En ${numeroCuotas} cuotas`;
    const modalidad = await new sql.Request(tx).input('n', sql.NVarChar, nombreModalidad).query(`SELECT TOP 1 modalidad_pago_id FROM dbo.MODALIDAD_PAGO WHERE nombre = @n`);
    const modalidadId = modalidad.recordset[0]?.modalidad_pago_id;
    if (!modalidadId) throw new ErrorNegocio('Falta el catálogo de modalidades de pago: ejecuta `node scripts/db-init.js`.');

    const orden = await new sql.Request(tx).input('p', sql.Int, prop.propuesta_id).input('m', sql.Int, modalidadId).input('monto', sql.Decimal(10, 2), prop.precio_final)
      .query(`INSERT dbo.ORDEN_PAGO (propuesta_id, modalidad_pago_id, monto_comprometido, estado)
              OUTPUT INSERTED.orden_pago_id VALUES (@p, @m, @monto, 'ENLACE_ENVIADO')`);
    const ordenId = orden.recordset[0].orden_pago_id as number;

    let cuotaId: number | null = null;
    let montoPrimeraCuota = Number(prop.precio_final);
    if (numeroCuotas > 1) {
      const splits = SPLITS[numeroCuotas];
      const montos = splits.map((pct) => Math.round(Number(prop.precio_final) * pct) / 100);
      montos[montos.length - 1] = Number((Number(prop.precio_final) - montos.slice(0, -1).reduce((s, m) => s + m, 0)).toFixed(2)); // ajusta el redondeo en la última
      for (let i = 0; i < numeroCuotas; i++) {
        const vencimiento = new Date(); vencimiento.setDate(vencimiento.getDate() + 30 * i);
        const c = await new sql.Request(tx).input('o', sql.Int, ordenId).input('n', sql.Int, i + 1).input('pct', sql.Decimal(5, 2), splits[i])
          .input('monto', sql.Decimal(10, 2), montos[i]).input('f', sql.Date, vencimiento).input('e', sql.VarChar, i === 0 ? 'ENLACE_ENVIADO' : 'PENDIENTE')
          .query(`INSERT dbo.CUOTA_PAGO (orden_pago_id, numero_cuota, porcentaje, monto_programado, condicion, fecha_vencimiento, estado)
                  OUTPUT INSERTED.cuota_id VALUES (@o, @n, @pct, @monto, 'FECHA', @f, @e)`);
        if (i === 0) { cuotaId = c.recordset[0].cuota_id; montoPrimeraCuota = montos[0]; }
      }
    }

    const token = nuevoToken();
    await new sql.Request(tx).input('o', sql.Int, ordenId).input('c', sql.Int, cuotaId).input('tk', sql.VarChar(40), token)
      .query(`INSERT dbo.ENLACE_PAGO (orden_pago_id, cuota_id, token, estado) VALUES (@o, @c, @tk, 'ENVIADO')`);
    await transicionar(tx, oportunidadId, 'PENDIENTE_PAGO', origen, `Enlace de pago generado (${nombreModalidad})`);
    return { token, url: `${baseUrl()}/pagar/${token}`, servicio: prop.servicio, monto: montoPrimeraCuota, estudiante: prop.estudiante, cuotaActual: 1, totalCuotas: numeroCuotas };
  });
}

export interface DatosPago {
  estadoEnlace: 'ENVIADO' | 'PAGADO' | 'EXPIRADO' | 'ANULADO'; estadoOportunidad: string;
  servicio: string; monto: number; cuotaActual: number; totalCuotas: number;
  nombres: string; apellidos: string; whatsapp: string; correo: string | null;
  medios: { id: number; nombre: string }[];
}

/** Datos para la página pública de pago (y marca el primer clic de esta cuota, si es la primera vez que se abre). */
export async function obtenerPagoPorToken(token: string): Promise<DatosPago | null> {
  const pool = await oltp();
  const r = await pool.request().input('tk', sql.VarChar(40), token).query(`
    SELECT e.enlace_id, e.estado AS estado_enlace, e.fecha_primer_clic, o.monto_comprometido,
           ISNULL(c.monto_programado, o.monto_comprometido) AS monto, ISNULL(c.numero_cuota, 1) AS cuota_actual, mp.numero_cuotas AS total_cuotas,
           oc.estado AS estado_oportunidad, s.nombre AS servicio, co.nombres, co.apellidos, co.whatsapp, co.correo
    FROM dbo.ENLACE_PAGO e JOIN dbo.ORDEN_PAGO o ON o.orden_pago_id = e.orden_pago_id
    JOIN dbo.MODALIDAD_PAGO mp ON mp.modalidad_pago_id = o.modalidad_pago_id
    LEFT JOIN dbo.CUOTA_PAGO c ON c.cuota_id = e.cuota_id
    JOIN dbo.PROPUESTA p ON p.propuesta_id = o.propuesta_id
    JOIN dbo.OPORTUNIDAD_COMERCIAL oc ON oc.oportunidad_id = p.oportunidad_id
    JOIN dbo.SERVICIO s ON s.servicio_id = p.servicio_id
    JOIN dbo.LEAD l ON l.lead_id = p.lead_id JOIN dbo.BUYER b ON b.buyer_id = l.buyer_id JOIN dbo.CONTACTO co ON co.contacto_id = b.contacto_id
    WHERE e.token = @tk`);
  const x = r.recordset[0];
  if (!x) return null;
  if (!x.fecha_primer_clic) await pool.request().input('id', sql.Int, x.enlace_id)
    .query(`UPDATE dbo.ENLACE_PAGO SET fecha_primer_clic = SYSDATETIME() WHERE enlace_id = @id AND fecha_primer_clic IS NULL`);
  const medios = (await pool.request().query(`SELECT medio_pago_id AS id, metodo AS nombre FROM dbo.MEDIO_PAGO WHERE activo = 1 ORDER BY medio_pago_id`)).recordset;
  return {
    estadoEnlace: x.estado_enlace, estadoOportunidad: x.estado_oportunidad, servicio: x.servicio, monto: Number(x.monto),
    cuotaActual: x.cuota_actual, totalCuotas: x.total_cuotas, nombres: x.nombres, apellidos: x.apellidos, whatsapp: x.whatsapp, correo: x.correo,
    medios: medios.map((m: any) => ({ id: m.id, nombre: m.nombre })),
  };
}

/** El estudiante paga esta cuota (o el total). La primera vez que paga algo: PENDIENTE_PAGO -> PAYER_CONFIRMADO. */
export async function confirmarPagoSimulado(token: string, datos: { medioPagoId: number }) {
  const r = await enTransaccion(await oltp(), async (tx) => {
    const e = await new sql.Request(tx).input('tk', sql.VarChar(40), token).query(`
      SELECT e.enlace_id, e.estado AS estado_enlace, e.cuota_id, o.orden_pago_id, o.monto_comprometido,
             ISNULL(c.monto_programado, o.monto_comprometido) AS monto, c.numero_cuota, p.lead_id, p.oportunidad_id,
             (SELECT COUNT(*) FROM dbo.CUOTA_PAGO x WHERE x.orden_pago_id = o.orden_pago_id AND x.estado <> 'PAGADA' AND x.cuota_id <> ISNULL(e.cuota_id, -1)) AS otras_pendientes
      FROM dbo.ENLACE_PAGO e JOIN dbo.ORDEN_PAGO o ON o.orden_pago_id = e.orden_pago_id JOIN dbo.PROPUESTA p ON p.propuesta_id = o.propuesta_id
      LEFT JOIN dbo.CUOTA_PAGO c ON c.cuota_id = e.cuota_id
      WHERE e.token = @tk`);
    const x = e.recordset[0];
    if (!x) throw new ErrorNegocio('Enlace de pago no encontrado.', 404);
    if (x.estado_enlace !== 'ENVIADO') throw new ErrorNegocio('Este enlace ya no está disponible para pagar.', 409);
    const op = await oportunidadBloqueada(tx, x.oportunidad_id);
    const primeraVez = op.estado === 'PENDIENTE_PAGO';
    if (!primeraVez && op.estado !== 'PAYER_CONFIRMADO') throw new ErrorNegocio(`No se puede pagar: la oportunidad está en ${op.estado}.`, 409);

    if (x.cuota_id) await new sql.Request(tx).input('id', sql.Int, x.cuota_id).query(`UPDATE dbo.CUOTA_PAGO SET estado = 'PAGADA' WHERE cuota_id = @id`);
    const quedanCuotas = Number(x.otras_pendientes) > 0;
    await new sql.Request(tx).input('o', sql.Int, x.orden_pago_id).input('e', sql.VarChar, quedanCuotas ? 'PARCIAL' : 'PAGADA')
      .query(`UPDATE dbo.ORDEN_PAGO SET estado = @e WHERE orden_pago_id = @o`);
    await new sql.Request(tx).input('o', sql.Int, x.orden_pago_id).input('c', sql.Int, x.cuota_id).input('me', sql.Int, datos.medioPagoId).input('monto', sql.Decimal(10, 2), x.monto)
      .query(`INSERT dbo.PAGO (orden_pago_id, cuota_id, medio_pago_id, fecha_confirmacion, monto_pagado, metodo_verificacion, estado)
              VALUES (@o, @c, @me, SYSDATETIME(), @monto, 'WEBHOOK', 'CONFIRMADO')`);
    await new sql.Request(tx).input('id', sql.Int, x.enlace_id).query(`UPDATE dbo.ENLACE_PAGO SET estado = 'PAGADO' WHERE enlace_id = @id`);
    if (primeraVez) {
      await new sql.Request(tx).input('l', sql.Int, x.lead_id).input('o', sql.Int, x.orden_pago_id)
        .query(`INSERT dbo.PAYER (lead_id, orden_pago_id, estado) VALUES (@l, @o, 'ACTIVO')`);
      await transicionar(tx, x.oportunidad_id, 'PAYER_CONFIRMADO', 'SISTEMA', 'Primer pago simulado confirmado por el estudiante');
    } else {
      await registrarEvento(tx, x.oportunidad_id, 'CUOTA_PAGADA', 'SISTEMA', `Cuota ${x.numero_cuota ?? ''} confirmada`);
    }
    return { oportunidadId: x.oportunidad_id as number, monto: Number(x.monto), numeroCuota: x.numero_cuota as number | null, quedanCuotas, primeraVez };
  });
  const detalle = r.numeroCuota ? ` (cuota ${r.numeroCuota}${r.quedanCuotas ? ', aún quedan cuotas por pagar' : ', completaste todas tus cuotas'})` : '';
  const siguiente = r.primeraVez
    ? ' Para agendar tu primera sesión, cuéntame qué día y hora te acomodan y te propongo horarios disponibles.'
    : '';
  await avisarEnConversacion(r.oportunidadId, `¡Gracias! Confirmamos tu pago de S/ ${r.monto.toFixed(2)}${detalle}.${siguiente}`);
  return r;
}

/** Genera y envía por WhatsApp el enlace de cada cuota vencida que todavía no se le mandó (payers activos). */
export async function enviarEnlacesCuotasVencidas(ahora = new Date()) {
  const pool = await oltp();
  const pendientes = await pool.request().input('a', sql.Date, ahora).query(`
    SELECT c.cuota_id, c.numero_cuota, c.monto_programado, o.orden_pago_id, p.oportunidad_id, mp.numero_cuotas AS total_cuotas
    FROM dbo.CUOTA_PAGO c JOIN dbo.ORDEN_PAGO o ON o.orden_pago_id = c.orden_pago_id
    JOIN dbo.PROPUESTA p ON p.propuesta_id = o.propuesta_id JOIN dbo.OPORTUNIDAD_COMERCIAL oc ON oc.oportunidad_id = p.oportunidad_id
    JOIN dbo.MODALIDAD_PAGO mp ON mp.modalidad_pago_id = o.modalidad_pago_id
    WHERE c.estado = 'PENDIENTE' AND c.fecha_vencimiento <= @a AND oc.estado = 'PAYER_CONFIRMADO'`);
  const salida = { evaluadas: pendientes.recordset.length, enviadas: 0, errores: [] as string[] };
  for (const c of pendientes.recordset) {
    try {
      const token = nuevoToken();
      await enTransaccion(pool, async (tx) => {
        await new sql.Request(tx).input('id', sql.Int, c.cuota_id).query(`UPDATE dbo.CUOTA_PAGO SET estado = 'ENLACE_ENVIADO' WHERE cuota_id = @id AND estado = 'PENDIENTE'`);
        await new sql.Request(tx).input('o', sql.Int, c.orden_pago_id).input('c', sql.Int, c.cuota_id).input('tk', sql.VarChar(40), token)
          .query(`INSERT dbo.ENLACE_PAGO (orden_pago_id, cuota_id, token, estado) VALUES (@o, @c, @tk, 'ENVIADO')`);
        await registrarEvento(tx, c.oportunidad_id, 'ENLACE_CUOTA_ENVIADO', 'SISTEMA', `Cuota ${c.numero_cuota} de ${c.total_cuotas}`);
      });
      await avisarEnConversacion(c.oportunidad_id,
        `Hola, te toca tu cuota ${c.numero_cuota} de ${c.total_cuotas}: S/ ${Number(c.monto_programado).toFixed(2)}. Puedes pagarla aquí: ${baseUrl()}/pagar/${token}`);
      publicar('oltp', { tipo: 'cuota', oportunidadId: c.oportunidad_id, leadId: null });
      salida.enviadas++;
    } catch (e) { salida.errores.push(`cuota ${c.cuota_id}: ${(e as Error).message}`); }
  }
  return salida;
}

/** El estudiante decide no pagar nada (antes del primer pago): PENDIENTE_PAGO -> DESCARTADA. */
export async function rechazarPagoSimulado(token: string, motivo?: string) {
  const r = await enTransaccion(await oltp(), async (tx) => {
    const e = await new sql.Request(tx).input('tk', sql.VarChar(40), token).query(`
      SELECT e.enlace_id, e.estado AS estado_enlace, e.cuota_id, o.orden_pago_id, p.oportunidad_id
      FROM dbo.ENLACE_PAGO e JOIN dbo.ORDEN_PAGO o ON o.orden_pago_id = e.orden_pago_id JOIN dbo.PROPUESTA p ON p.propuesta_id = o.propuesta_id
      WHERE e.token = @tk`);
    const x = e.recordset[0];
    if (!x) throw new ErrorNegocio('Enlace de pago no encontrado.', 404);
    if (x.estado_enlace !== 'ENVIADO') throw new ErrorNegocio('Este enlace ya no está disponible.', 409);
    const op = await oportunidadBloqueada(tx, x.oportunidad_id);
    if (op.estado !== 'PENDIENTE_PAGO') throw new ErrorNegocio(`Solo se puede rechazar antes del primer pago (estado actual: ${op.estado}).`, 409);
    await new sql.Request(tx).input('o', sql.Int, x.orden_pago_id).query(`UPDATE dbo.ORDEN_PAGO SET estado = 'ANULADA' WHERE orden_pago_id = @o`);
    if (x.cuota_id) await new sql.Request(tx).input('id', sql.Int, x.cuota_id).query(`UPDATE dbo.CUOTA_PAGO SET estado = 'ANULADA' WHERE cuota_id = @id`);
    await new sql.Request(tx).input('id', sql.Int, x.enlace_id).query(`UPDATE dbo.ENLACE_PAGO SET estado = 'ANULADO' WHERE enlace_id = @id`);
    await transicionar(tx, x.oportunidad_id, 'DESCARTADA', 'SISTEMA', motivo?.slice(0, 300) ?? 'El estudiante decidió no pagar desde la pasarela');
    return { oportunidadId: x.oportunidad_id as number };
  });
  await avisarEnConversacion(r.oportunidadId, 'Entendido, no se realizó ningún cargo. Si más adelante quieres retomarlo, aquí seguimos para ayudarte.');
  return r;
}

/** Bandeja de PAYERS: todas las oportunidades PAYER_CONFIRMADO (incluidas las confirmadas por el flujo
 *  antiguo, sin ORDEN_PAGO, para que coincida con el conteo del Pipeline) o rechazadas tras un enlace. */
export async function bandejaPagos() {
  const r = await (await oltp()).request().query(`
    SELECT oc.oportunidad_id, oc.lead_id, oc.estado AS estado_oportunidad, oc.es_demo,
           co.nombres + ' ' + co.apellidos AS estudiante, s.nombre AS servicio, prop.version, prop.precio_final AS monto_comprometido,
           o.orden_pago_id, mp.numero_cuotas AS total_cuotas,
           (SELECT COUNT(*) FROM dbo.CUOTA_PAGO x WHERE x.orden_pago_id = o.orden_pago_id AND x.estado = 'PAGADA') AS cuotas_pagadas,
           prox.fecha_vencimiento AS proxima_vence, prox.monto_programado AS proximo_monto,
           COALESCE(ultimo_pago.fecha_confirmacion, legado.fecha_confirmacion) AS fecha_pago, ultimo_pago.medio_pago
    FROM dbo.OPORTUNIDAD_COMERCIAL oc
    JOIN dbo.LEAD l ON l.lead_id = oc.lead_id JOIN dbo.BUYER b ON b.buyer_id = l.buyer_id JOIN dbo.CONTACTO co ON co.contacto_id = b.contacto_id
    OUTER APPLY (SELECT TOP 1 x.* FROM dbo.PROPUESTA x WHERE x.oportunidad_id = oc.oportunidad_id AND x.estado = 'ACEPTADA' ORDER BY x.version DESC) prop
    LEFT JOIN dbo.SERVICIO s ON s.servicio_id = prop.servicio_id
    LEFT JOIN dbo.ORDEN_PAGO o ON o.propuesta_id = prop.propuesta_id
    LEFT JOIN dbo.MODALIDAD_PAGO mp ON mp.modalidad_pago_id = o.modalidad_pago_id
    OUTER APPLY (SELECT TOP 1 x.fecha_vencimiento, x.monto_programado FROM dbo.CUOTA_PAGO x WHERE x.orden_pago_id = o.orden_pago_id AND x.estado <> 'PAGADA' ORDER BY x.numero_cuota) prox
    OUTER APPLY (SELECT TOP 1 pg.fecha_confirmacion, mp2.metodo AS medio_pago FROM dbo.PAGO pg LEFT JOIN dbo.MEDIO_PAGO mp2 ON mp2.medio_pago_id = pg.medio_pago_id
                 WHERE pg.orden_pago_id = o.orden_pago_id AND pg.estado = 'CONFIRMADO' ORDER BY pg.pago_id DESC) ultimo_pago
    OUTER APPLY (SELECT TOP 1 fecha_confirmacion FROM dbo.CONVERSION_PAYER_REF x WHERE x.oportunidad_id = oc.oportunidad_id) legado
    WHERE oc.estado = 'PAYER_CONFIRMADO' OR (oc.estado = 'DESCARTADA' AND o.estado = 'ANULADA')
    ORDER BY CASE oc.estado WHEN 'PAYER_CONFIRMADO' THEN 0 ELSE 1 END, ISNULL(COALESCE(ultimo_pago.fecha_confirmacion, legado.fecha_confirmacion), oc.fecha_inicio) DESC`);
  return r.recordset;
}
