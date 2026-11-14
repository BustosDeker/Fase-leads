// Recordatorio de pago (Bloque E, ALERTA_COBRANZA): si el estudiante no paga, se le reenvía el enlace por
// WhatsApp transcurrida COBRANZA_HORAS (1 h por defecto), hasta COBRANZA_MAX_INTENTOS veces.
import { oltp, sql } from '../db.js';
import { publicar } from '../server/eventos.js';
import { enviarAConversacion } from '../whatsapp/openwa.js';
import { enTransaccion, registrarEvento } from './oportunidad.js';
import { enviarEnlacesCuotasVencidas } from './pagos.js';

export interface CandidatoCobranza {
  ordenPagoId: number; oportunidadId: number; conversacionId: number; canal: string;
  nombres: string; monto: number; token: string; intentos: number;
}

const horasEspera = () => { const n = Number(process.env.COBRANZA_HORAS || 1); return Number.isFinite(n) && n > 0 ? n : 1; };
const maxIntentos = () => { const n = Number(process.env.COBRANZA_MAX_INTENTOS || 2); return Number.isInteger(n) && n >= 1 ? n : 2; };
const baseUrl = () => (process.env.APP_URL || `http://localhost:${process.env.PORT || 3100}`).replace(/\/$/, '');

/** Oportunidades PENDIENTE_PAGO con el enlace enviado hace más de COBRANZA_HORAS y sin recordatorio reciente. */
export async function buscarCandidatosCobranza(ahora = new Date()): Promise<CandidatoCobranza[]> {
  const r = await (await oltp()).request().input('a', sql.DateTime2, ahora).input('h', sql.Int, horasEspera()).query(`
    SELECT o.orden_pago_id, oc.oportunidad_id, cv.conversacion_id, cv.canal_mensajeria AS canal,
           co.nombres, o.monto_comprometido AS monto, e.token, ISNULL(al.intentos, 0) AS intentos
    FROM dbo.ORDEN_PAGO o JOIN dbo.PROPUESTA p ON p.propuesta_id = o.propuesta_id
    JOIN dbo.OPORTUNIDAD_COMERCIAL oc ON oc.oportunidad_id = p.oportunidad_id
    JOIN dbo.LEAD l ON l.lead_id = p.lead_id JOIN dbo.BUYER b ON b.buyer_id = l.buyer_id JOIN dbo.CONTACTO co ON co.contacto_id = b.contacto_id
    OUTER APPLY (SELECT TOP 1 x.enlace_id, x.token, x.fecha_envio FROM dbo.ENLACE_PAGO x WHERE x.orden_pago_id = o.orden_pago_id AND x.estado = 'ENVIADO' ORDER BY x.enlace_id DESC) e
    OUTER APPLY (SELECT TOP 1 x.conversacion_id, x.canal_mensajeria FROM dbo.CONVERSACION x WHERE x.oportunidad_id = oc.oportunidad_id ORDER BY x.conversacion_id DESC) cv
    OUTER APPLY (SELECT COUNT(*) AS intentos FROM dbo.ALERTA_COBRANZA x WHERE x.orden_pago_id = o.orden_pago_id) al
    WHERE oc.estado = 'PENDIENTE_PAGO' AND e.token IS NOT NULL AND cv.conversacion_id IS NOT NULL
      AND e.fecha_envio <= DATEADD(HOUR, -@h, @a)
      AND co.consentimiento_contacto = 1 AND co.no_contactar = 0
      AND NOT EXISTS (SELECT 1 FROM dbo.ALERTA_COBRANZA x WHERE x.orden_pago_id = o.orden_pago_id AND x.fecha_envio > DATEADD(HOUR, -@h, @a))
    ORDER BY e.fecha_envio`);
  return r.recordset.filter((x: any) => Number(x.intentos) < maxIntentos()).map((x: any) => ({
    ordenPagoId: x.orden_pago_id, oportunidadId: x.oportunidad_id, conversacionId: x.conversacion_id, canal: x.canal,
    nombres: x.nombres, monto: Number(x.monto), token: x.token, intentos: Number(x.intentos),
  }));
}

async function plantillaCobranza() {
  const r = await (await oltp()).request().query(`SELECT TOP 1 plantilla_msg_id, texto FROM dbo.PLANTILLA_MENSAJE
    WHERE categoria = 'COBRANZA' AND activa = 1 ORDER BY plantilla_msg_id`);
  return r.recordset[0] as { plantilla_msg_id: number; texto: string } | undefined;
}

export async function ejecutarCobranza(opciones: { ahora?: Date; simular?: boolean } = {}) {
  const ahora = opciones.ahora ?? new Date();
  const candidatos = await buscarCandidatosCobranza(ahora);
  const salida = { evaluados: candidatos.length, enviados: 0, errores: [] as string[] };
  if (opciones.simular) return salida;
  const plantilla = await plantillaCobranza();
  for (const c of candidatos) {
    const url = `${baseUrl()}/pagar/${c.token}`;
    const texto = (plantilla?.texto ?? 'Hola {nombre}, vimos que aún no completas tu pago de S/ {monto}. Aquí tienes el enlace: {enlace}.')
      .replaceAll('{nombre}', c.nombres).replaceAll('{monto}', c.monto.toFixed(2)).replaceAll('{enlace}', url).slice(0, 1000);
    try {
      if (c.canal === 'WHATSAPP') await enviarAConversacion(c.conversacionId, texto);
      await enTransaccion(await oltp(), async (tx) => {
        await new sql.Request(tx).input('c', sql.Int, c.conversacionId).input('t', sql.VarChar, texto).input('p', sql.Int, plantilla?.plantilla_msg_id ?? null)
          .query(`INSERT dbo.MENSAJE (conversacion_id, emisor, tipo, plantilla_msg_id, contenido, dentro_ventana)
                  VALUES (@c, 'BOT', CASE WHEN @p IS NULL THEN 'TEXTO' ELSE 'PLANTILLA' END, @p, @t, 1)`);
        await new sql.Request(tx).input('o', sql.Int, c.ordenPagoId).input('p', sql.Int, plantilla?.plantilla_msg_id ?? null).input('s', sql.Int, c.intentos + 1)
          .query(`INSERT dbo.ALERTA_COBRANZA (orden_pago_id, plantilla_msg_id, secuencia, tipo, resultado) VALUES (@o, @p, @s, 'RECORDATORIO_PAGO', 'ENVIADO')`);
        await registrarEvento(tx, c.oportunidadId, 'RECORDATORIO_PAGO_ENVIADO', 'SISTEMA', `Intento ${c.intentos + 1}`);
      });
      if (c.canal === 'SIMULADOR') publicar('conversacion', { conversacionId: c.conversacionId, oportunidadId: c.oportunidadId });
      publicar('oltp', { tipo: 'cobranza', oportunidadId: c.oportunidadId, leadId: null });
      salida.enviados++;
    } catch (e) { salida.errores.push(`orden ${c.ordenPagoId}: ${(e as Error).message}`); }
  }
  return salida;
}

let scheduler: NodeJS.Timeout | null = null;
let ejecutando = false;
export function iniciarSchedulerCobranza() {
  if (scheduler || !/^(1|true|si|sí|yes)$/i.test(process.env.SEGUIMIENTO_INTERNO || '')) return;
  const minutos = Math.max(1, Number(process.env.SEGUIMIENTO_CADA_MIN || 15));
  scheduler = setInterval(async () => {
    if (ejecutando) return;
    ejecutando = true;
    try { await ejecutarCobranza(); await enviarEnlacesCuotasVencidas(); } catch (e: any) { console.error('[agente][cobranza] error:', String(e?.message ?? e).slice(0, 300)); }
    finally { ejecutando = false; }
  }, minutos * 60_000);
  scheduler.unref();
}
