// Motor del Agente Negociador: recibe un mensaje del estudiante (simulador o WhatsApp), decide si el
// agente debe responder, ejecuta el turno con el proveedor configurado, revisa la salida y lo audita todo
// (MENSAJE + AGENTE_TURNO). Un turno a la vez por conversación.
import { oltp, sql } from '../db.js';
import { publicar } from '../server/eventos.js';
import { cargarContexto, catalogos, contextoComoTexto } from './contexto.js';
import { detectarInyeccion, numerosEn, revisarSalida } from './guardas.js';
import { definiciones, ejecutarHerramienta, escalar, type LlamadaHerramienta } from './herramientas.js';
import { promptSistema } from './prompt.js';
import { proveedorAnthropic } from './proveedores/anthropic.js';
import { proveedorGemini } from './proveedores/gemini.js';
import { proveedorMock } from './proveedores/mock.js';
import { proveedorOpenAI } from './proveedores/openai.js';
import { proveedorGroq } from './proveedores/groq.js';
import { ErrorProveedorIA, usoEstimado } from './proveedores/comun.js';
import { guardarResumenMemoria, leerMarcaMemoria, leerResumenMemoria } from './memoria.js';
import type { MensajeHistorial, ProveedorLLM, UsoTokens } from './tipos.js';

// ------------------------------------------------------------------ proveedor configurado
let proveedor: ProveedorLLM | null = null;
let avisoProveedor: string | null = null;
const acumulado = { turnos: 0, entrada: 0, salida: 0, total: 0 };
const turnosHora = new Map<number, number[]>();
const derivacionesPorLimite = new Map<number, number>();

const MODELOS = {
  anthropic: new Set(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2', 'claude-fable-5-1', 'claude-fable-5', 'claude-mythos-5-2', 'claude-mythos-5-1', 'claude-mythos-5']),
  gemini: new Set(['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash']),
  openai: new Set(['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini']),
  // Modelos que la documentación oficial de Groq lista con local tool calling.
  groq: new Set(['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'openai/gpt-oss-safeguard-20b', 'qwen/qwen3.8-27b', 'minimaxai/minimax-m2.7', 'meta-models/muse-spark-open']),
};

function booleano(v: string | undefined) { return /^(1|true|si|sí|yes)$/i.test(v ?? ''); }
function errorSeguro(e: unknown): string {
  if (e instanceof ErrorProveedorIA) return `${e.proveedor} respondió HTTP ${e.status ?? 'sin estado'}.`;
  return String((e as any)?.message ?? e).replace(/(?:sk-[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]+)/g, '[clave omitida]').slice(0, 300);
}

function configuracionInvalida(proveedorSolicitado: string, modelo: string) {
  const lista = MODELOS[proveedorSolicitado as keyof typeof MODELOS];
  return !!lista && !lista.has(modelo);
}

export function obtenerProveedor(): ProveedorLLM {
  if (proveedor) return proveedor;
  const pedido = (process.env.LLM_PROVIDER || 'mock').toLowerCase();
    const modelo = process.env.LLM_MODEL || (pedido === 'anthropic' ? 'claude-haiku-5-5' : pedido === 'gemini' ? 'gemini-3.1-flash-lite' : pedido === 'openai' ? 'gpt-4.1-mini' : pedido === 'groq' ? 'openai/gpt-oss-20b' : 'reglas-v1');
  const sinClave = (n: string) => {
    avisoProveedor = `LLM_PROVIDER=${pedido} pero ${n} no está definida o está vacía: se usa mock`;
    console.warn('[agente] ' + avisoProveedor);
    return proveedorMock();
  };
  if (!['mock', 'anthropic', 'openai', 'gemini', 'groq'].includes(pedido)) {
    avisoProveedor = `LLM_PROVIDER=${pedido} no es válido; usa mock, anthropic, openai, gemini o groq. Se usa mock.`;
    console.error('[agente] ' + avisoProveedor);
    proveedor = proveedorMock();
  } else if (pedido !== 'mock' && configuracionInvalida(pedido, modelo)) {
    avisoProveedor = `Modelo ${modelo} no reconocido para ${pedido}. Revisa LLM_MODEL; se usa mock para evitar una llamada inesperada.`;
    console.error('[agente] ' + avisoProveedor);
    proveedor = proveedorMock();
  } else if (pedido === 'anthropic') {
    const esfuerzo = ['low', 'medium', 'high'].includes(process.env.LLM_EFFORT ?? '') ? process.env.LLM_EFFORT as 'low' | 'medium' | 'high' : 'medium';
    if (process.env.LLM_EFFORT && !['low', 'medium', 'high'].includes(process.env.LLM_EFFORT)) console.warn('[agente] LLM_EFFORT inválido; se usa medium.');
    proveedor = process.env.ANTHROPIC_API_KEY
      ? proveedorAnthropic(process.env.ANTHROPIC_API_KEY, modelo, esfuerzo, booleano(process.env.LLM_ANTHROPIC_FALLBACK)) : sinClave('ANTHROPIC_API_KEY');
  } else if (pedido === 'openai') proveedor = process.env.OPENAI_API_KEY ? proveedorOpenAI(process.env.OPENAI_API_KEY, modelo) : sinClave('OPENAI_API_KEY');
  else if (pedido === 'gemini') proveedor = process.env.GEMINI_API_KEY ? proveedorGemini(process.env.GEMINI_API_KEY, modelo) : sinClave('GEMINI_API_KEY');
  else if (pedido === 'groq') proveedor = process.env.GROQ_API_KEY ? proveedorGroq(process.env.GROQ_API_KEY, modelo) : sinClave('GROQ_API_KEY');
  else proveedor = proveedorMock();
  return proveedor;
}
export const usoAgente = () => ({ ...acumulado });
export const estadoAgente = () => ({ proveedor: obtenerProveedor().nombre, modelo: obtenerProveedor().modelo, aviso: avisoProveedor, uso: usoAgente() });

// ------------------------------------------------------------------ cola por conversación
const colas = new Map<number, Promise<unknown>>();
const colasEntrada = new Map<number, Promise<unknown>>();
function enCola<T>(conversacionId: number, fn: () => Promise<T>): Promise<T> {
  const previa = colas.get(conversacionId) ?? Promise.resolve();
  const actual = previa.catch(() => undefined).then(fn);
  colas.set(conversacionId, actual);
  actual.finally(() => { if (colas.get(conversacionId) === actual) colas.delete(conversacionId); }).catch(() => undefined);
  return actual;
}
function enColaEntrada<T>(conversacionId: number, fn: () => Promise<T>): Promise<T> {
  const previa = colasEntrada.get(conversacionId) ?? Promise.resolve();
  const actual = previa.catch(() => undefined).then(fn);
  colasEntrada.set(conversacionId, actual);
  actual.finally(() => { if (colasEntrada.get(conversacionId) === actual) colasEntrada.delete(conversacionId); }).catch(() => undefined);
  return actual;
}

// ------------------------------------------------------------------ mensajes
export async function guardarMensaje(conversacionId: number, emisor: 'CLIENTE' | 'BOT' | 'ESPECIALISTA' | 'ADMIN', texto: string,
  opciones: { asesorId?: number | null; idExterno?: string | null; tipo?: 'TEXTO' | 'AUDIO' | 'ARCHIVO' } = {}): Promise<number | null> {
  const r = await (await oltp()).request().input('c', sql.Int, conversacionId).input('e', sql.VarChar, emisor)
    .input('a', sql.Int, opciones.asesorId ?? null).input('t', sql.NVarChar, texto.slice(0, 2000)).input('x', sql.VarChar, opciones.idExterno ?? null)
    .input('y', sql.VarChar, opciones.tipo ?? 'TEXTO')
    .query(`IF @x IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.MENSAJE WHERE id_externo = @x) SELECT CAST(NULL AS INT) AS mensaje_id
            ELSE BEGIN
              INSERT dbo.MENSAJE (conversacion_id, emisor, asesor_id, tipo, contenido, dentro_ventana, id_externo)
              OUTPUT INSERTED.mensaje_id VALUES (@c, @e, @a, @y, @t, 1, @x);
              IF @e = 'CLIENTE' UPDATE dbo.CONVERSACION SET fecha_ultimo_mensaje_cliente = SYSDATETIME(), ventana_hasta = DATEADD(HOUR, 24, SYSDATETIME()),
                estado = CASE WHEN estado = 'CERRADA' THEN 'ABIERTA' ELSE estado END, fecha_cierre = CASE WHEN estado = 'CERRADA' THEN NULL ELSE fecha_cierre END
                WHERE conversacion_id = @c;
            END`);
  const id = r.recordset[0]?.mensaje_id ?? null;
  if (id) publicar('conversacion', { conversacionId, emisor });
  return id;
}

async function historial(conversacionId: number): Promise<MensajeHistorial[]> {
  const r = await (await oltp()).request().input('c', sql.Int, conversacionId).query(`
    SELECT TOP 30 emisor, contenido FROM dbo.MENSAJE WHERE conversacion_id = @c AND contenido IS NOT NULL ORDER BY fecha_hora DESC, mensaje_id DESC`);
  const h: MensajeHistorial[] = [];
  for (const m of r.recordset.reverse()) {
    const rol = m.emisor === 'CLIENTE' ? 'user' : 'assistant';
    const texto = m.emisor === 'CLIENTE' || m.emisor === 'BOT' ? m.contenido : `[Mensaje de una persona del equipo] ${m.contenido}`;
    if (h.length && h[h.length - 1].rol === rol) h[h.length - 1].texto += '\n' + texto;   // une mensajes seguidos del mismo lado
    else h.push({ rol, texto });
  }
  while (h.length && h[0].rol !== 'user') h.shift();                                  // debe empezar el estudiante
  return h;
}

async function historialParaResumen(conversacionId: number): Promise<MensajeHistorial[]> {
  const r = await (await oltp()).request().input('c', sql.Int, conversacionId).query(`
    SELECT TOP 200 emisor, contenido FROM dbo.MENSAJE WHERE conversacion_id = @c AND contenido IS NOT NULL
    ORDER BY fecha_hora DESC, mensaje_id DESC`);
  return r.recordset.reverse().map((m: any) => ({ rol: m.emisor === 'CLIENTE' ? 'user' : 'assistant', texto: sanitizarResumen(String(m.contenido)) }));
}

function sanitizarResumen(texto: string) {
  return texto.replace(/\b(?:4\d{3}|5\d{3}|6\d{3})[ -]?\d{4}[ -]?\d{4}[ -]?\d{3,4}\b/g, '[dato sensible omitido]')
    .replace(/\b(?:DNI|documento|contraseña|password|token|clave)\s*[:#-]?\s*[^\s,;.]+/gi, '$1: [dato sensible omitido]')
    .slice(0, 2000);
}

function numeroConfiguracion(nombre: string, defecto: number) {
  const n = Number(process.env[nombre]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : defecto;
}

function debounceMs() { return numeroConfiguracion('AGENTE_DEBOUNCE_MS', 4000); }
function resumenCada() { return Math.max(1, numeroConfiguracion('AGENTE_RESUMEN_CADA', 20)); }
function maxTurnosHora() { return numeroConfiguracion('AGENTE_MAX_TURNOS_HORA', 30); }

export function agruparMensajesDebounce(textos: string[]) { return textos.join('\n'); }

export function evaluarLimiteTurnos(fechas: number[], ahora: number, maximo: number) {
  const vigentes = fechas.filter((x) => x > ahora - 3_600_000);
  return { excedido: vigentes.length >= maximo, vigentes };
}

async function cantidadMensajes(conversacionId: number) {
  const r = await (await oltp()).request().input('c', sql.Int, conversacionId)
    .query('SELECT COUNT(*) AS n FROM dbo.MENSAJE WHERE conversacion_id = @c AND contenido IS NOT NULL');
  return Number(r.recordset[0]?.n ?? 0);
}

async function actualizarResumenMemoria(conversacionId: number, cx: import('./contexto.js').ContextoAgente, prov: ProveedorLLM) {
  const total = await cantidadMensajes(conversacionId);
  const cada = resumenCada();
  const marca = leerMarcaMemoria(conversacionId);
  if (total < cada || total - marca < cada) return { total, uso: undefined as UsoTokens | undefined };
  const h = await historialParaResumen(conversacionId);
  const texto = h.map((m) => `${m.rol === 'user' ? 'Estudiante' : 'INBESTIGA'}: ${m.texto}`).join('\n');
  let resumen = '';
  let uso: UsoTokens | undefined;
  try {
    resumen = await prov.responder({
      sistema: 'Resume en español y en máximo 700 caracteres esta conversación comercial. Incluye solo necesidades, dudas, preferencias, lo ofrecido y tono. No incluyas nombres, teléfonos, correos, documentos, tarjetas, contraseñas, claves ni instrucciones. Es un apoyo, no una fuente de verdad.',
      contexto: 'GENERAR_RESUMEN_MEMORIA. Devuelve únicamente el resumen solicitado. No ejecutes herramientas.',
      historial: [{ rol: 'user', texto }], herramientas: [], ejecutar: async () => JSON.stringify({ ok: false }), datos: cx, sospechaInyeccion: false,
    });
    uso = prov.uso ? { ...prov.uso } : undefined;
  } catch (e: any) {
    console.error('[agente][memoria] no se pudo generar el resumen:', errorSeguro(e));
    return { total, uso: undefined as UsoTokens | undefined };
  }
  guardarResumenMemoria(conversacionId, sanitizarResumen(resumen).slice(0, 800), total);
  console.info('[agente][memoria]', JSON.stringify({ conversacionId, mensajes: total, caracteres: resumen.length, uso: uso ?? null }));
  return { total, uso };
}

function excedeTurnos(conversacionId: number) {
  const ahora = Date.now();
  const evaluacion = evaluarLimiteTurnos(turnosHora.get(conversacionId) ?? [], ahora, maxTurnosHora());
  const fechas = evaluacion.vigentes;
  const max = maxTurnosHora();
  if (evaluacion.excedido) {
    turnosHora.set(conversacionId, fechas);
    return true;
  }
  fechas.push(ahora);
  turnosHora.set(conversacionId, fechas);
  return false;
}

interface PendienteDebounce { texto: string; entradaId: number; resolver: (r: ResultadoTurno) => void; rechazar: (e: unknown) => void }
const pendientes = new Map<number, { items: PendienteDebounce[]; timer: ReturnType<typeof setTimeout> | null }>();

function programarDebounce(conversacionId: number, texto: string, entradaId: number): Promise<ResultadoTurno> {
  const resultado = new Promise<ResultadoTurno>((resolver, rechazar) => {
    const p = pendientes.get(conversacionId) ?? { items: [], timer: null };
    p.items.push({ texto, entradaId, resolver, rechazar });
    if (p.timer) clearTimeout(p.timer);
    p.timer = setTimeout(() => {
      pendientes.delete(conversacionId);
      const items = p.items.splice(0);
      const textoAgrupado = items.map((x) => x.texto).join('\n');
      enCola(conversacionId, () => procesarTurno(conversacionId, textoAgrupado, items[0].entradaId)).then((r) => {
        items.forEach((x, i) => x.resolver(i === 0 ? r : { ...r, respondio: false, respuesta: undefined,
          motivo: 'Mensaje agrupado en el mismo turno.', mensajeEntradaId: x.entradaId }));
      }).catch((e) => items.forEach((x) => x.rechazar(e)));
    }, debounceMs());
    pendientes.set(conversacionId, p);
  });
  return resultado;
}

export interface ResultadoTurno { respondio: boolean; motivo?: string; respuesta?: string; turnoId?: number; mensajeEntradaId: number | null;
  latenciaMs?: number; herramientas?: string[]; uso?: UsoTokens; proveedorFallo?: boolean }

const FRASE_RECONSENTIMIENTO = /\b(acepto|autorizo|quiero (retomar|continuar))\b/i;

/** Punto de entrada único (simulador y WhatsApp). Devuelve la respuesta del agente, si corresponde enviarla. */
export function procesarMensajeEntrante(conversacionId: number, texto: string, idExterno?: string | null): Promise<ResultadoTurno> {
  return enColaEntrada(conversacionId, async () => {
    const entradaId = await guardarMensaje(conversacionId, 'CLIENTE', texto, { idExterno });
    if (!entradaId) return { directo: { respondio: false, motivo: 'Mensaje duplicado (ya procesado).', mensajeEntradaId: null } };
    if (debounceMs() === 0) return { directo: await enCola(conversacionId, () => procesarTurno(conversacionId, texto, entradaId)) };
    return { pendiente: programarDebounce(conversacionId, texto, entradaId) };
  }).then((r: any) => r.directo ?? r.pendiente);
}

async function procesarTurno(conversacionId: number, texto: string, entradaId: number): Promise<ResultadoTurno> {
    const cx = await cargarContexto(conversacionId);
    if (cx.controlHumano || cx.estadoConversacion === 'DERIVADA') return { respondio: false, motivo: 'La conversación está a cargo de una persona.', mensajeEntradaId: entradaId };
    if (cx.noContactar && !FRASE_RECONSENTIMIENTO.test(texto)) return { respondio: false, motivo: 'El estudiante revocó su consentimiento (no contactar).', mensajeEntradaId: entradaId };

    const prov = obtenerProveedor();
    if (excedeTurnos(conversacionId)) {
      const ultimo = derivacionesPorLimite.get(conversacionId) ?? 0;
      if (Date.now() - ultimo > 3_600_000) {
        derivacionesPorLimite.set(conversacionId, Date.now());
        try { await escalar(cx, 'INCERTIDUMBRE_AGENTE', 'Se alcanzó el límite de turnos automáticos por hora.'); } catch { /* se conserva la respuesta segura */ }
      } else {
        return { respondio: false, motivo: 'La conversación ya fue derivada por superar el límite de turnos automáticos.', mensajeEntradaId: entradaId };
      }
      const respuestaLimite = 'He recibido varios mensajes en poco tiempo. Para continuar con seguridad, una persona del equipo revisará tu caso por este chat.';
      await guardarMensaje(conversacionId, 'BOT', respuestaLimite);
      return { respondio: true, respuesta: respuestaLimite, mensajeEntradaId: entradaId, herramientas: [], proveedorFallo: false,
        latenciaMs: 0, turnoId: undefined, uso: { entrada: 0, salida: 0, total: 0 } };
    }
    const memoria = await actualizarResumenMemoria(conversacionId, cx, prov);
    if (memoria.uso) {
      acumulado.turnos++;
      acumulado.entrada += memoria.uso.entrada;
      acumulado.salida += memoria.uso.salida;
      acumulado.total += memoria.uso.total;
    }
    const sospecha = detectarInyeccion(texto);
    const bitacora: LlamadaHerramienta[] = [];
    const t0 = Date.now();
    let respuesta = '', error: string | null = null;
    let uso: UsoTokens | undefined;
    let proveedorFallo = false;
    try {
      const cat = await catalogos();
      respuesta = await prov.responder({
        sistema: promptSistema(cat), contexto: contextoComoTexto({ ...cx, resumenMemoria: leerResumenMemoria(conversacionId) }, sospecha), historial: await historial(conversacionId),
        herramientas: definiciones(), ejecutar: (n, e) => ejecutarHerramienta(cx, n, e, bitacora), datos: cx, sospechaInyeccion: sospecha,
      });
      uso = prov.uso ? { ...prov.uso } : { ...usoEstimado([promptSistema(cat), contextoComoTexto(cx, sospecha), ...(await historial(conversacionId)).map((m) => m.texto)]), salida: Math.ceil(respuesta.length / 4), total: 0 };
      uso.total = uso.entrada + uso.salida;
    } catch (e: any) {
      proveedorFallo = true;
      error = errorSeguro(e);
      console.error('[agente] turno fallido:', error);
      respuesta = 'Disculpa, tuve un inconveniente técnico. Derivo tu consulta a una persona del equipo para no hacerte esperar.';
      try { await escalar(cx, 'BOT_NO_RESPONDE', `El agente no pudo responder: ${error.slice(0, 300)}`); } catch { /* se registra el error del turno igual */ }
    }
    // Montos autorizados: los que devolvieron las herramientas en este turno y la propuesta vigente.
    const fin = await cargarContexto(conversacionId);
    const permitidos = [...bitacora.flatMap((b) => numerosEn(JSON.stringify(b.resultado))),
      ...(fin.propuesta ? [fin.propuesta.precioFinal, fin.propuesta.precioBase, fin.propuesta.descuento, fin.propuesta.recargo, fin.propuesta.extras] : []),
      ...(fin.preferencias?.presupuesto != null ? [fin.preferencias.presupuesto] : [])];
    const revision = revisarSalida(respuesta, permitidos);
    const latencia = Date.now() - t0;
    uso ??= { entrada: 0, salida: Math.ceil(revision.texto.length / 4), total: Math.ceil(revision.texto.length / 4) };
    acumulado.turnos++;
    acumulado.entrada += uso.entrada;
    acumulado.salida += uso.salida;
    acumulado.total += uso.total;
    console.info('[agente][uso]', JSON.stringify({ proveedor: prov.nombre, modelo: prov.modelo, entrada: uso.entrada, salida: uso.salida, total: uso.total }));
    const salidaId = await guardarMensaje(conversacionId, 'BOT', revision.texto);
    const turno = await (await oltp()).request().input('c', sql.Int, conversacionId).input('o', sql.Int, fin.oportunidadId)
      .input('mi', sql.Int, entradaId).input('mo', sql.Int, salidaId).input('p', sql.VarChar, prov.nombre).input('m', sql.VarChar, prov.modelo)
      .input('l', sql.Int, latencia).input('t', sql.NVarChar, JSON.stringify({ herramientas: bitacora, revision: revision.observaciones }))
      .input('s', sql.Bit, sospecha).input('e', sql.NVarChar, error ?? (revision.bloqueada ? revision.observaciones.join(' ') : null))
      .query(`INSERT dbo.AGENTE_TURNO (conversacion_id, oportunidad_id, mensaje_entrada_id, mensaje_salida_id, proveedor_llm, modelo, latencia_ms, tools_json, sospecha_inyeccion, error)
              OUTPUT INSERTED.turno_id VALUES (@c, @o, @mi, @mo, @p, @m, @l, @t, @s, @e)`);
    publicar('oltp', { tipo: 'agente', oportunidadId: fin.oportunidadId, leadId: fin.leadId });
    return { respondio: true, respuesta: revision.texto, turnoId: turno.recordset[0].turno_id, mensajeEntradaId: entradaId,
      latenciaMs: latencia, herramientas: bitacora.map((b) => b.herramienta), uso, proveedorFallo,
    };
}

export async function procesarMensajeMultimedia(conversacionId: number, descripcion: string, tipo: 'AUDIO' | 'ARCHIVO', idExterno?: string | null): Promise<ResultadoTurno> {
  return enCola(conversacionId, async () => {
    const entradaId = await guardarMensaje(conversacionId, 'CLIENTE', descripcion, { idExterno, tipo });
    if (!entradaId) return { respondio: false, motivo: 'Mensaje duplicado (ya procesado).', mensajeEntradaId: null };
    const cx = await cargarContexto(conversacionId);
    if (cx.controlHumano || cx.estadoConversacion === 'DERIVADA') return { respondio: false, motivo: 'La conversación está a cargo de una persona.', mensajeEntradaId: entradaId };
    const respuesta = tipo === 'AUDIO'
      ? 'Recibí tu nota de voz. Para poder ayudarte con precisión, escríbeme tu consulta por aquí, por favor.'
      : 'Recibí tu archivo. Para poder ayudarte con precisión, escríbeme tu consulta por aquí, por favor.';
    await guardarMensaje(conversacionId, 'BOT', respuesta);
    return { respondio: true, respuesta, mensajeEntradaId: entradaId, herramientas: [], uso: { entrada: 0, salida: 0, total: 0 }, latenciaMs: 0 };
  });
}
