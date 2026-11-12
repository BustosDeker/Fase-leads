// Seguimiento proactivo de LEADS. No modifica el esquema: usa la convención B3
// sobre SEGUIMIENTO_LEAD.fecha_accion, resultado y siguiente_accion.
import { oltp, sql } from '../db.js';
import { publicar } from '../server/eventos.js';
import { cargarContexto, catalogos, contextoComoTexto } from './contexto.js';
import { obtenerProveedor } from './motor.js';
import { promptSistema } from './prompt.js';
import { revisarSalida } from './guardas.js';
import { enviarAConversacion } from '../whatsapp/openwa.js';
import { enTransaccion, registrarEvento, transicionar } from '../negocio/oportunidad.js';
import type { UsoTokens } from './tipos.js';

export const RESULTADOS_SEGUIMIENTO = ['PROGRAMADO', 'ENVIADO', 'BLOQUEADO_VENTANA', 'BLOQUEADO_CONSENTIMIENTO', 'SIN_RESPUESTA', 'RESPONDIO'] as const;
type ResultadoSeguimiento = (typeof RESULTADOS_SEGUIMIENTO)[number];

export interface CandidatoSeguimiento {
  conversacionId: number; leadId: number; oportunidadId: number; propuestaId: number | null; programadoId: number | null; canalId: number | null; canal: 'WHATSAPP' | 'SIMULADOR'; chatId: string | null;
  nombres: string; apellidos: string; estadoOportunidad: string; ventanaHasta: Date | null; ultimoCliente: Date; ultimoMensaje: Date;
  intentos: number; siguienteIntentoHoras: number; motivo: string;
}

function listaHoras() {
  const v = (process.env.SEGUIMIENTO_HORAS || '24,72').split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x > 0);
  return v.length ? v : [24, 72];
}
function maxIntentos() {
  const n = Number(process.env.SEGUIMIENTO_MAX_INTENTOS || 2);
  return Number.isInteger(n) && n >= 1 ? n : 2;
}
export function horaPermitidaPeru(ahora: Date): boolean {
  const partes = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(ahora);
  const h = Number(partes.find((x) => x.type === 'hour')?.value ?? 0);
  const m = Number(partes.find((x) => x.type === 'minute')?.value ?? 0);
  return h >= 8 && (h < 21 || (h === 20 && m < 60));
}
export function horasSeguimiento() { return listaHoras(); }
export function intentosPermitidos() { return maxIntentos(); }

/** Candidatos de lectura. Incluye los fuera de horario para que la API explique por qué no se envían. */
export async function buscarCandidatos(ahora = new Date()): Promise<CandidatoSeguimiento[]> {
  const horas = listaHoras();
  const r = await (await oltp()).request().input('a', sql.DateTime2, ahora).input('h0', sql.Int, horas[0]).input('h1', sql.Int, horas[1] ?? horas[horas.length - 1])
    .input('max', sql.Int, maxIntentos()).query(`
      WITH base AS (
        SELECT cv.conversacion_id, cv.canal_id, cv.canal_mensajeria, cv.chat_id, cv.ventana_hasta,
               co.nombres, co.apellidos, l.lead_id, o.oportunidad_id, o.estado AS estado_oportunidad, prop.propuesta_id,
               ult.fecha_hora AS ultimo_mensaje, cli.fecha_hora AS ultimo_cliente,
               ISNULL(seg.intentos, 0) AS intentos, prog.programado_id
        FROM dbo.CONVERSACION cv
        JOIN dbo.CONTACTO co ON co.contacto_id = cv.contacto_id
        JOIN dbo.OPORTUNIDAD_COMERCIAL o ON o.oportunidad_id = cv.oportunidad_id
        JOIN dbo.LEAD l ON l.lead_id = o.lead_id
        OUTER APPLY (SELECT TOP 1 m.fecha_hora, m.emisor FROM dbo.MENSAJE m WHERE m.conversacion_id = cv.conversacion_id ORDER BY m.fecha_hora DESC, m.mensaje_id DESC) ult
        OUTER APPLY (SELECT TOP 1 m.fecha_hora FROM dbo.MENSAJE m WHERE m.conversacion_id = cv.conversacion_id AND m.emisor = 'CLIENTE' ORDER BY m.fecha_hora DESC, m.mensaje_id DESC) cli
        OUTER APPLY (SELECT COUNT(*) AS intentos FROM dbo.SEGUIMIENTO_LEAD s
          WHERE s.oportunidad_id = o.oportunidad_id AND s.resultado IN ('ENVIADO','BLOQUEADO_VENTANA','BLOQUEADO_CONSENTIMIENTO','SIN_RESPUESTA','RESPONDIO')
            AND s.fecha_accion <= @a AND (cli.fecha_hora IS NULL OR s.fecha_accion > cli.fecha_hora)) seg
        OUTER APPLY (SELECT TOP 1 p.propuesta_id FROM dbo.PROPUESTA p WHERE p.oportunidad_id = o.oportunidad_id
          AND p.estado IN ('PRESENTADA','ACEPTADA') ORDER BY p.version DESC) prop
        OUTER APPLY (SELECT TOP 1 sx.seguimiento_lead_id AS programado_id FROM dbo.SEGUIMIENTO_LEAD sx
          WHERE sx.oportunidad_id = o.oportunidad_id AND sx.resultado = 'PROGRAMADO' AND sx.fecha_accion <= @a
          ORDER BY sx.fecha_accion DESC) prog
        WHERE cv.estado = 'ABIERTA' AND cv.control_humano = 0
          AND co.consentimiento_contacto = 1 AND co.no_contactar = 0
          AND o.estado IN ('ABIERTA','EN_DIAGNOSTICO','APTA_PARA_COTIZAR','EN_NEGOCIACION')
          AND ult.emisor IN ('BOT','ESPECIALISTA','ADMIN') AND cli.fecha_hora IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM dbo.ESCALAMIENTO e WHERE e.conversacion_id = cv.conversacion_id AND e.estado = 'PENDIENTE')
          AND NOT EXISTS (SELECT 1 FROM dbo.SEGUIMIENTO_LEAD sx WHERE sx.oportunidad_id = o.oportunidad_id AND sx.resultado = 'PROGRAMADO' AND sx.fecha_accion > @a)
      )
      SELECT * FROM base
      WHERE intentos <= @max
        AND ultimo_cliente <= DATEADD(HOUR, -CASE WHEN intentos = 0 THEN @h0 ELSE @h1 END, @a)
      ORDER BY ultimo_cliente, oportunidad_id`);
  return r.recordset.map((x: any) => {
    const intentos = Number(x.intentos);
    const motivo = !horaPermitidaPeru(ahora) ? 'FUERA_HORARIO' : intentos >= maxIntentos() ? 'INTENTOS_AGOTADOS' : 'INACTIVIDAD';
    return { conversacionId: x.conversacion_id, leadId: x.lead_id, oportunidadId: x.oportunidad_id, canalId: x.canal_id ?? null,
      propuestaId: x.propuesta_id ?? null, programadoId: x.programado_id ?? null, canal: x.canal_mensajeria, chatId: x.chat_id ?? null, nombres: x.nombres, apellidos: x.apellidos,
      estadoOportunidad: x.estado_oportunidad, ventanaHasta: x.ventana_hasta ? new Date(x.ventana_hasta) : null,
      ultimoCliente: new Date(x.ultimo_cliente), ultimoMensaje: new Date(x.ultimo_mensaje), intentos,
      siguienteIntentoHoras: horas[Math.min(intentos, horas.length - 1)], motivo };
  });
}

async function historialReciente(conversacionId: number) {
  const r = await (await oltp()).request().input('c', sql.Int, conversacionId).query(`
    SELECT TOP 12 emisor, contenido FROM dbo.MENSAJE WHERE conversacion_id = @c AND contenido IS NOT NULL ORDER BY fecha_hora DESC, mensaje_id DESC`);
  return r.recordset.reverse().map((x: any) => ({ rol: x.emisor === 'CLIENTE' ? 'user' as const : 'assistant' as const, texto: String(x.contenido) }));
}

function siguienteVentana(ahora: Date) {
  const partes = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(ahora);
  const n = (t: string) => Number(partes.find((x) => x.type === t)?.value ?? 0);
  const dia = new Date(Date.UTC(n('year'), n('month') - 1, n('day') + (n('hour') >= 21 ? 1 : 0), 13, 0, 0)); // 08:00 America/Lima (UTC-5)
  return dia;
}

async function plantillaAprobada(tx: sql.Transaction) {
  const r = await new sql.Request(tx).query(`SELECT TOP 1 plantilla_msg_id, texto FROM dbo.PLANTILLA_MENSAJE
    WHERE activa = 1 AND aprobada_meta = 1 AND categoria IN ('PROPUESTA','OTRO') ORDER BY CASE WHEN categoria = 'PROPUESTA' THEN 0 ELSE 1 END, plantilla_msg_id`);
  return r.recordset[0] as { plantilla_msg_id: number; texto: string } | undefined;
}
function aplicarPlantilla(texto: string, c: CandidatoSeguimiento, contexto: import('./contexto.js').ContextoAgente) {
  return String(texto).replaceAll('{nombre}', c.nombres).replaceAll('{version}', String(contexto.propuesta?.version ?? ''))
    .replaceAll('{vigencia}', contexto.propuesta?.vigenciaHasta ? new Date(contexto.propuesta.vigenciaHasta).toLocaleDateString('es-PE') : '').slice(0, 1000);
}

async function registrarSeguimiento(tx: sql.Transaction, c: CandidatoSeguimiento, datos: { resultado: ResultadoSeguimiento; texto?: string; siguiente: string; plantillaId?: number | null; fecha?: Date; programadoId?: number | null }) {
  const fecha = datos.fecha ?? new Date();
  const msg = datos.texto ? await new sql.Request(tx).input('c', sql.Int, c.conversacionId).input('t', sql.VarChar, datos.texto.slice(0, 2000)).input('p', sql.Int, datos.plantillaId ?? null)
    .input('f', sql.DateTime2, fecha).input('v', sql.Bit, c.canal === 'WHATSAPP' && c.ventanaHasta && c.ventanaHasta <= fecha ? 0 : 1).query(`
      INSERT dbo.MENSAJE (conversacion_id, emisor, fecha_hora, tipo, plantilla_msg_id, contenido, dentro_ventana)
      OUTPUT INSERTED.mensaje_id VALUES (@c, 'BOT', @f, CASE WHEN @p IS NULL THEN 'TEXTO' ELSE 'PLANTILLA' END, @p, @t, @v)`) : null;
  if (datos.programadoId && datos.resultado === 'ENVIADO') {
    await new sql.Request(tx).input('id', sql.Int, datos.programadoId).input('p', sql.Int, datos.plantillaId ?? null).input('n', sql.VarChar, datos.siguiente)
      .query('UPDATE dbo.SEGUIMIENTO_LEAD SET resultado = \'ENVIADO\', plantilla_msg_id = COALESCE(@p, plantilla_msg_id), siguiente_accion = @n WHERE seguimiento_lead_id = @id');
    await registrarEvento(tx, c.oportunidadId, 'SEGUIMIENTO_ENVIADO', 'AGENTE', datos.siguiente);
    return { mensajeId: msg?.recordset[0]?.mensaje_id ?? null, seguimientoId: datos.programadoId };
  }
  const s = await new sql.Request(tx).input('l', sql.Int, c.leadId).input('o', sql.Int, c.oportunidadId).input('p', sql.Int, c.propuestaId)
    .input('a', sql.Int, null).input('can', sql.Int, c.canalId).input('pm', sql.Int, datos.plantillaId ?? null)
    .input('f', sql.DateTime2, fecha).input('r', sql.VarChar, datos.resultado).input('n', sql.VarChar, datos.siguiente)
    .query(`INSERT dbo.SEGUIMIENTO_LEAD (lead_id, oportunidad_id, propuesta_id, asesor_id, canal_id, plantilla_msg_id, fecha_accion, resultado, siguiente_accion)
            OUTPUT INSERTED.seguimiento_lead_id VALUES (@l, @o, @p, @a, @can, @pm, @f, @r, @n)`);
  await registrarEvento(tx, c.oportunidadId, `SEGUIMIENTO_${datos.resultado}`, 'AGENTE', datos.siguiente);
  return { mensajeId: msg?.recordset[0]?.mensaje_id ?? null, seguimientoId: s.recordset[0].seguimiento_lead_id as number };
}

async function registrarAuditoria(tx: sql.Transaction, c: CandidatoSeguimiento, mensajeId: number | null, proveedor: ReturnType<typeof obtenerProveedor>, uso: UsoTokens | undefined, error: string | null = null) {
  await new sql.Request(tx).input('c', sql.Int, c.conversacionId).input('o', sql.Int, c.oportunidadId).input('mi', sql.Int, null).input('mo', sql.Int, mensajeId)
    .input('p', sql.VarChar, proveedor.nombre).input('m', sql.VarChar, proveedor.modelo).input('l', sql.Int, null)
    .input('t', sql.NVarChar, JSON.stringify({ tipo: 'SEGUIMIENTO', uso: uso ?? null })).input('e', sql.NVarChar, error).query(`
      INSERT dbo.AGENTE_TURNO (conversacion_id, oportunidad_id, mensaje_entrada_id, mensaje_salida_id, proveedor_llm, modelo, latencia_ms, tools_json, sospecha_inyeccion, error)
      VALUES (@c, @o, @mi, @mo, @p, @m, @l, @t, 0, @e)`);
}

async function registrarResultadoSinEnvio(c: CandidatoSeguimiento, datos: { resultado: ResultadoSeguimiento; siguiente: string; fecha?: Date }, error?: string) {
  const proveedor = obtenerProveedor();
  return enTransaccion(await oltp(), async (tx) => {
    const r = await registrarSeguimiento(tx, c, datos);
    await registrarAuditoria(tx, c, null, proveedor, undefined, error ?? null);
    return r;
  });
}

/** Reclama el intento en una transacción; el applock evita dos envíos simultáneos del mismo intento. */
async function enviarYRegistrar(c: CandidatoSeguimiento, ahora: Date, texto: string, plantillaId: number | null, proveedor: ReturnType<typeof obtenerProveedor>, uso?: UsoTokens) {
  const resultado = await enTransaccion(await oltp(), async (tx) => {
    const lock = await new sql.Request(tx).input('r', sql.NVarChar, `INBESTIGA:SEGUIMIENTO:${c.oportunidadId}`).query(`
      DECLARE @resultado INT;
      EXEC @resultado = sp_getapplock @Resource = @r, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 0;
      SELECT @resultado AS resultado;`);
    if (Number(lock.recordset[0]?.resultado ?? -1) < 0) return null;
    const duplicado = await new sql.Request(tx).input('o', sql.Int, c.oportunidadId).input('a', sql.DateTime2, ahora).input('pid', sql.Int, c.programadoId).query(`
      SELECT TOP 1 seguimiento_lead_id FROM dbo.SEGUIMIENTO_LEAD WITH (UPDLOCK, HOLDLOCK)
      WHERE oportunidad_id = @o AND fecha_accion >= DATEADD(SECOND, -2, @a) AND resultado IN ('PROGRAMADO','ENVIADO')
        AND seguimiento_lead_id <> ISNULL(@pid, -1)`);
    if (duplicado.recordset[0]) return null;
    if (c.intentos > 0) await new sql.Request(tx).input('o', sql.Int, c.oportunidadId).query(`
      UPDATE s SET resultado = 'SIN_RESPUESTA', siguiente_accion = 'No respondió al intento anterior; se realiza el siguiente seguimiento.'
      FROM dbo.SEGUIMIENTO_LEAD s WHERE s.seguimiento_lead_id = (SELECT TOP 1 seguimiento_lead_id FROM dbo.SEGUIMIENTO_LEAD
        WHERE oportunidad_id = @o AND resultado = 'ENVIADO' ORDER BY fecha_accion DESC)`);
    if (c.canal === 'WHATSAPP') await enviarAConversacion(c.conversacionId, texto);
    const r = await registrarSeguimiento(tx, c, { resultado: 'ENVIADO', texto, siguiente: 'Esperar respuesta del estudiante; si no responde, aplicar la siguiente cadencia.', plantillaId, fecha: ahora, programadoId: c.programadoId });
    await registrarAuditoria(tx, c, r.mensajeId, proveedor, uso);
    return r;
  });
  if (resultado && c.canal === 'SIMULADOR') publicar('conversacion', { conversacionId: c.conversacionId, oportunidadId: c.oportunidadId, leadId: c.leadId });
  return resultado;
}

async function marcarRespuesta(c: CandidatoSeguimiento, ahora: Date) {
  return enTransaccion(await oltp(), async (tx) => {
    const r = await new sql.Request(tx).input('o', sql.Int, c.oportunidadId).input('a', sql.DateTime2, ahora).query(`
      ;WITH ultimo AS (
        SELECT TOP 1 s.seguimiento_lead_id FROM dbo.SEGUIMIENTO_LEAD s
        WHERE s.oportunidad_id = @o AND s.resultado = 'ENVIADO'
          AND EXISTS (SELECT 1 FROM dbo.CONVERSACION cv JOIN dbo.MENSAJE m ON m.conversacion_id = cv.conversacion_id
            WHERE cv.oportunidad_id = @o AND m.emisor = 'CLIENTE' AND m.fecha_hora > s.fecha_accion AND m.fecha_hora <= @a)
        ORDER BY s.fecha_accion DESC
      ) UPDATE s SET resultado = 'RESPONDIO', siguiente_accion = 'Continuar la atención desde el último mensaje del estudiante.'
        OUTPUT INSERTED.seguimiento_lead_id FROM dbo.SEGUIMIENTO_LEAD s JOIN ultimo u ON u.seguimiento_lead_id = s.seguimiento_lead_id`);
    if (r.recordset.length) await registrarEvento(tx, c.oportunidadId, 'SEGUIMIENTO_RESPONDIO', 'AGENTE', 'El estudiante respondió; se reinicia la cadencia.');
    return r.recordset.length > 0;
  });
}

async function escalarAbandono(c: CandidatoSeguimiento, motivo: string) {
  const cx = await cargarContexto(c.conversacionId);
  const resumen = `Estudiante: ${c.nombres} ${c.apellidos}; Carrera/universidad/etapa: ${cx.perfil?.carrera ?? 'no registrada'} / ${cx.perfil?.universidad ?? 'no registrada'} / ${cx.perfil?.etapa ?? 'no registrada'}; Tema/avance: ${cx.diagnostico?.tema ?? 'no registrado'} / ${cx.diagnostico?.avance ?? 'no registrado'}%; Propuesta vigente: ${cx.propuesta?.servicio ?? 'no registrada'}; Motivo: ${motivo}; Último mensaje: seguimiento sin respuesta.`.slice(0, 1000);
  return enTransaccion(await oltp(), async (tx) => {
    const dup = await new sql.Request(tx).input('c', sql.Int, c.conversacionId).query("SELECT TOP 1 escalamiento_id FROM dbo.ESCALAMIENTO WHERE conversacion_id = @c AND estado = 'PENDIENTE' AND motivo = 'RIESGO_ABANDONO'");
    if (dup.recordset[0]) return false;
    await new sql.Request(tx).input('c', sql.Int, c.conversacionId).input('l', sql.Int, c.leadId).input('r', sql.NVarChar, resumen)
      .query(`INSERT dbo.ESCALAMIENTO (conversacion_id, lead_id, motivo, destino_rol, resumen_entregado, estado, resumen)
              VALUES (@c, @l, 'RIESGO_ABANDONO', 'ESPECIALISTA', 1, 'PENDIENTE', @r);
              UPDATE dbo.CONVERSACION SET estado = 'DERIVADA', control_humano = 1, resuelta_sin_humano = 0 WHERE conversacion_id = @c`);
    await registrarEvento(tx, c.oportunidadId, 'ESCALAMIENTO', 'AGENTE', resumen);
    return true;
  });
}

async function procesarCandidato(c: CandidatoSeguimiento, ahora: Date, simular: boolean) {
  const ventanaAbierta = c.canal !== 'WHATSAPP' || !c.ventanaHasta || c.ventanaHasta > ahora;
  const fueraHorario = !horaPermitidaPeru(ahora);
  if (simular) return { evaluado: true, enviado: false, bloqueado: c.intentos >= maxIntentos() ? 'INTENTOS_AGOTADOS' : fueraHorario ? 'FUERA_HORARIO' : !ventanaAbierta ? 'VENTANA_EXPIRADA' : null, escalado: false };
  if (c.intentos >= maxIntentos()) return { evaluado: true, enviado: false, bloqueado: 'INTENTOS_AGOTADOS', escalado: false };
  if (fueraHorario) {
    await registrarResultadoSinEnvio(c, { resultado: 'PROGRAMADO', siguiente: `Reintentar dentro del horario permitido (08:00–21:00, Perú).`, fecha: siguienteVentana(ahora) });
    return { evaluado: true, enviado: false, bloqueado: 'FUERA_HORARIO', escalado: false };
  }
  const contexto = await cargarContexto(c.conversacionId);
  if (!contexto.consentimiento || contexto.noContactar || contexto.controlHumano || contexto.estadoConversacion === 'DERIVADA') {
    await registrarResultadoSinEnvio(c, { resultado: 'BLOQUEADO_CONSENTIMIENTO', siguiente: 'No enviar hasta que exista consentimiento vigente y no haya control humano.' });
    return { evaluado: true, enviado: false, bloqueado: 'BLOQUEADO_CONSENTIMIENTO', escalado: false };
  }
  let texto: string;
  let plantillaId: number | null = null;
  if (!ventanaAbierta) {
    const plantilla = await enTransaccion(await oltp(), (tx) => plantillaAprobada(tx));
    if (!plantilla) {
      await registrarResultadoSinEnvio(c, { resultado: 'BLOQUEADO_VENTANA', siguiente: 'Aprobar una plantilla de Meta o atender manualmente antes de contactar fuera de ventana.' });
      await escalarAbandono(c, 'No existe plantilla aprobada para la ventana de WhatsApp.');
      return { evaluado: true, enviado: false, bloqueado: 'BLOQUEADO_VENTANA', escalado: true };
    }
    plantillaId = plantilla.plantilla_msg_id;
    texto = aplicarPlantilla(plantilla.texto, c, contexto);
  } else {
    const proveedor = obtenerProveedor();
    const t0 = Date.now();
    const generado = await proveedor.responder({ sistema: promptSistema(await catalogos()) + '\n\nGenera solo un recordatorio breve, cordial y personalizado. No presiones, no repitas el mensaje anterior y no inventes datos. No tienes herramientas de escritura.',
      contexto: contextoComoTexto(contexto, false), historial: await historialReciente(c.conversacionId), herramientas: [], ejecutar: async () => JSON.stringify({ ok: false }), datos: contexto, sospechaInyeccion: false });
    const permitidos = contexto.propuesta ? [contexto.propuesta.precioFinal, contexto.propuesta.precioBase, contexto.propuesta.descuento, contexto.propuesta.recargo, contexto.propuesta.extras] : [];
    texto = revisarSalida(generado, permitidos).texto.slice(0, 2000);
    const uso = proveedor.uso ? { ...proveedor.uso } : undefined;
    const resultado = await enviarYRegistrar(c, ahora, texto, null, proveedor, uso);
    if (!resultado) return { evaluado: true, enviado: false, bloqueado: 'DUPLICADO', escalado: false };
    return { evaluado: true, enviado: true, bloqueado: null, escalado: false, latenciaMs: Date.now() - t0 };
  }
  const resultado = await enviarYRegistrar(c, ahora, texto, plantillaId, obtenerProveedor());
  if (!resultado) return { evaluado: true, enviado: false, bloqueado: 'DUPLICADO', escalado: false };
  return { evaluado: true, enviado: true, bloqueado: null, escalado: false };
}

export async function ejecutarSeguimiento(opciones: { ahora?: Date; simular?: boolean } = {}) {
  const ahora = opciones.ahora ?? new Date();
  if (!opciones.simular) {
    // Solo valores de B3 cuentan; las filas sintéticas antiguas quedan fuera y no contaminan la cadencia.
    await marcarRespuestasGlobal(ahora);
  }
  const candidatos = await buscarCandidatos(ahora);
  const salida = { evaluados: candidatos.length, enviados: 0, bloqueados: [] as string[], escalados: 0 };
  for (const c of candidatos) {
    const r = await procesarCandidato(c, ahora, !!opciones.simular);
    if (r.enviado) salida.enviados++;
    if (r.bloqueado) salida.bloqueados.push(r.bloqueado);
    if (r.escalado) salida.escalados++;
    if (!opciones.simular && c.intentos >= maxIntentos() && r.bloqueado !== 'BLOQUEADO_VENTANA') {
      await enTransaccion(await oltp(), async (tx) => {
        await new sql.Request(tx).input('o', sql.Int, c.oportunidadId).query(`
        UPDATE s SET resultado = 'SIN_RESPUESTA', siguiente_accion = 'Sin respuesta tras el máximo de seguimientos.'
        FROM dbo.SEGUIMIENTO_LEAD s WHERE s.seguimiento_lead_id = (SELECT TOP 1 seguimiento_lead_id FROM dbo.SEGUIMIENTO_LEAD
          WHERE oportunidad_id = @o AND resultado = 'ENVIADO' ORDER BY fecha_accion DESC)`);
        await registrarAuditoria(tx, c, null, obtenerProveedor(), undefined, 'Sin respuesta tras el máximo de seguimientos.');
      });
      if (/^(1|true|si|sí|yes)$/i.test(process.env.SEGUIMIENTO_DESCARTAR_AUTOMATICO || '')) {
        await enTransaccion(await oltp(), (tx) => transicionar(tx, c.oportunidadId, 'DESCARTADA', 'AGENTE', 'Sin respuesta tras seguimientos'));
      } else if (!r.escalado) { await escalarAbandono(c, 'Sin respuesta tras seguimientos.'); salida.escalados++; }
    }
  }
  return salida;
}

async function marcarRespuestasGlobal(ahora: Date) {
  return enTransaccion(await oltp(), async (tx) => {
    const r = await new sql.Request(tx).input('a', sql.DateTime2, ahora).query(`
      ;WITH ult AS (
        SELECT s.seguimiento_lead_id, s.oportunidad_id, ROW_NUMBER() OVER (PARTITION BY s.oportunidad_id ORDER BY s.fecha_accion DESC) rn
        FROM dbo.SEGUIMIENTO_LEAD s
        WHERE s.resultado = 'ENVIADO' AND EXISTS (SELECT 1 FROM dbo.CONVERSACION cv JOIN dbo.MENSAJE m ON m.conversacion_id = cv.conversacion_id
          WHERE cv.oportunidad_id = s.oportunidad_id AND m.emisor = 'CLIENTE' AND m.fecha_hora > s.fecha_accion AND m.fecha_hora <= @a)
      )
      UPDATE s SET resultado = 'RESPONDIO', siguiente_accion = 'Continuar la atención desde el último mensaje del estudiante.'
      OUTPUT INSERTED.oportunidad_id FROM dbo.SEGUIMIENTO_LEAD s JOIN ult u ON u.seguimiento_lead_id = s.seguimiento_lead_id AND u.rn = 1`);
    for (const x of r.recordset) await registrarEvento(tx, x.oportunidad_id, 'SEGUIMIENTO_RESPONDIO', 'AGENTE', 'El estudiante respondió; se reinicia la cadencia.');
    return r.recordset.length;
  });
}

let scheduler: NodeJS.Timeout | null = null;
let ejecutando = false;
export function iniciarSchedulerSeguimiento() {
  if (scheduler || !/^(1|true|si|sí|yes)$/i.test(process.env.SEGUIMIENTO_INTERNO || '')) return;
  const minutos = Math.max(1, Number(process.env.SEGUIMIENTO_CADA_MIN || 15));
  scheduler = setInterval(async () => {
    if (ejecutando) return;
    ejecutando = true;
    try { await ejecutarSeguimiento(); } catch (e: any) { console.error('[agente][seguimiento] error:', String(e?.message ?? e).slice(0, 300)); }
    finally { ejecutando = false; }
  }, minutos * 60_000);
  scheduler.unref();
}
