// Respuestas predeterminadas: cuando el estudiante contesta un menú con letras (a/b/c) que el propio sistema
// le envió, el cambio de estado y la respuesta salen al instante, sin pasar por el modelo. El modelo solo
// interviene con texto libre. Así el avance de etapa no depende de la latencia ni de los límites del proveedor de IA.
import { oltp, sql } from '../db.js';
import { publicar } from '../server/eventos.js';
import { faltantesDiagnostico } from '../negocio/diagnostico.js';
import { cargarContexto, type ContextoAgente } from './contexto.js';
import { HERRAMIENTAS, type LlamadaHerramienta } from './herramientas.js';

const MARCA_RECAP = 'a) Sí, todo está correcto';
const MARCA_COTIZAR = '¿Te gustaría que te prepare tu cotización?';
const MARCA_PENSARLO = 'quieras ver tu cotización';

const ETAPA: Record<string, string> = { CICLO_IX: 'IX ciclo', CICLO_X: 'X ciclo', EGRESADO: 'Egresado', BACHILLER: 'Bachiller' };
const TIPO: Record<string, string> = { DESCRIPTIVA: 'Descriptiva', CORRELACIONAL: 'Correlacional', EXPERIMENTAL: 'Experimental', APLICADA: 'Aplicada', NO_DEFINIDO: 'Aún no definido' };

const normalizar = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const SI = new Set(['a', '1a', 'opcion a', 'si', 'sii', 'siii', 'correcto', 'todo correcto', 'esta correcto', 'todo esta correcto', 'si todo esta correcto',
  'si correcto', 'ok', 'dale', 'claro', 'quiero', 'si quiero', 'si por favor', 'ya quiero', 'listo', 'de acuerdo']);
const esSi = (t: string) => SI.has(normalizar(t));
const esB = (t: string) => ['b', '1b', 'opcion b'].includes(normalizar(t));

/** ¿Es un mensaje tan corto como un «a» o un «sí»? El motor no lo agrupa con debounce para responder sin esperar. */
export const esRespuestaDeMenu = (texto: string) => esSi(texto) || esB(texto) || ['c', '1c', 'opcion c'].includes(normalizar(texto));

async function ultimoMensajeBot(conversacionId: number): Promise<{ ultimo: string | null; hubo: (marca: string) => boolean }> {
  const r = await (await oltp()).request().input('c', sql.Int, conversacionId).query(`
    SELECT TOP 8 contenido FROM dbo.MENSAJE WHERE conversacion_id = @c AND emisor = 'BOT' ORDER BY fecha_hora DESC, mensaje_id DESC`);
  const textos: string[] = r.recordset.map((x: any) => String(x.contenido ?? ''));
  return { ultimo: textos[0] ?? null, hubo: (marca) => textos.some((t) => t.includes(marca)) };
}
const AVISO_DEMORA = 'Estoy tardando más de lo normal';

const fechaCorta = (iso: string | null) => { if (!iso) return '—'; const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; };

function recapitulacion(cx: ContextoAgente): string {
  const p = cx.perfil!, d = cx.diagnostico!;
  return `Hola ${cx.nombres}, revisemos tus datos antes de continuar:\n\n` +
    `- Universidad: ${p.universidad}\n- Carrera: ${p.carrera}\n- Etapa: ${ETAPA[p.etapa] ?? p.etapa}\n- Sede: ${p.sede ?? '—'}\n` +
    `- Tema de tesis: ${d.tema ?? '—'}\n- Tipo de investigación: ${TIPO[d.tipoTesis ?? ''] ?? d.tipoTesis ?? '—'}\n- Avance: ${d.avance ?? 0} %\n` +
    `- Empresa o institución: ${d.tieneEmpresa ? 'Sí' : 'No'}\n- Limitaciones: ${d.limitaciones ?? '—'}\n- Fecha límite: ${fechaCorta(cx.preferencias?.fechaLimite ?? null)}\n\n` +
    `¿Todo está correcto?\n${MARCA_RECAP}\nb) Hay algo que corregir\nc) No me escriban más`;
}

export interface ResultadoRapido {
  respuesta?: string;          // si viene, el turno termina aquí (sin modelo)
  nota?: string;               // si viene sin respuesta, el modelo continúa con esta nota en su contexto
  herramientas: LlamadaHerramienta[];
}

async function ejecutar(cx: ContextoAgente, nombre: 'entregar_diagnostico' | 'calificar_aptitud', bitacora: LlamadaHerramienta[]) {
  const t0 = Date.now();
  const h = HERRAMIENTAS as unknown as Record<string, { ejecutar(c: ContextoAgente, e: unknown): Promise<any> }>;
  const resultado = await h[nombre].ejecutar(cx, {});
  bitacora.push({ herramienta: nombre, entrada: {}, ok: resultado?.ok !== false, resultado, ms: Date.now() - t0 });
  publicar('oltp', { tipo: 'agente', oportunidadId: cx.oportunidadId, leadId: cx.leadId });
  return resultado;
}

/** Devuelve null si el mensaje no responde a un menú conocido (entonces decide el modelo). */
export async function intentarRespuestaRapida(cx: ContextoAgente, texto: string): Promise<ResultadoRapido | null> {
  if (!cx.oportunidadId || !cx.consentimiento || !cx.perfil || !cx.diagnostico) return null;
  if (/no me escrib|no escrib|dejen de|baja/.test(normalizar(texto))) return null;   // revocación: la atiende el modelo
  const bitacora: LlamadaHerramienta[] = [];
  const { ultimo, hubo } = await ultimoMensajeBot(cx.conversacionId);

  // 1) Primer mensaje del estudiante con el diagnóstico de BUYERS completo: recapitulación con menú a/b/c.
  if (cx.estado === 'ABIERTA' && cx.diagnostico.estado !== 'ENTREGADO' && !cx.diagnostico.requiereDerivacion) {
    const faltan = faltantesDiagnostico({ tema: cx.diagnostico.tema, tipoTesis: cx.diagnostico.tipoTesis, avance: cx.diagnostico.avance,
      tieneEmpresa: cx.diagnostico.tieneEmpresa, limitaciones: cx.diagnostico.limitaciones, fechaLimite: cx.preferencias?.fechaLimite ?? null });
    if (faltan.length) return null;
    if (!hubo(MARCA_RECAP)) return { respuesta: recapitulacion(cx), herramientas: bitacora };
    // 2) Respondió «a» (todo correcto): diagnóstico confirmado y se pregunta por la cotización.
    // «a» solo vale si contesta a la recapitulación (o al aviso de demora que la siguió): no una frase cualquiera.
    if (esSi(texto) && (ultimo?.includes(MARCA_RECAP) || ultimo?.includes(AVISO_DEMORA))) {
      const r = await ejecutar(cx, 'entregar_diagnostico', bitacora);
      if (r?.ok === false) return null;
      return { respuesta: `Diagnóstico confirmado.\n\n${MARCA_COTIZAR}\na) Sí\nb) Déjame pensarlo\nc) Ya no me interesa`, herramientas: bitacora };
    }
    return null;   // «b», «c» o texto libre: lo atiende el modelo (necesita saber qué corregir)
  }

  // 3) Diagnóstico confirmado, esperando su decisión sobre la cotización.
  if (cx.estado === 'EN_DIAGNOSTICO' && cx.diagnostico.estado === 'ENTREGADO' && ultimo && (ultimo.includes(MARCA_COTIZAR) || ultimo.includes(MARCA_PENSARLO) || ultimo.includes(AVISO_DEMORA))) {
    if (esSi(texto)) {
      const r = await ejecutar(cx, 'calificar_aptitud', bitacora);
      if (r?.ok === false) return null;
      Object.assign(cx, await cargarContexto(cx.conversacionId));
      // Sin modelo también el siguiente paso: la lista de planes sale directo del catálogo.
      const t0 = Date.now();
      const h = HERRAMIENTAS as unknown as Record<string, { ejecutar(c: ContextoAgente, e: unknown): Promise<any> }>;
      const cat = await h.consultar_catalogo.ejecutar(cx, {});
      bitacora.push({ herramienta: 'consultar_catalogo', entrada: {}, ok: cat?.ok !== false, resultado: cat, ms: Date.now() - t0 });
      if (cat?.ok && cat.servicios?.length) {
        const lista = cat.servicios.map((x: any, i: number) => `${i + 1}) ${x.nombre} — desde S/ ${Number(x.precio_base).toFixed(2)}`).join('\n');
        return { respuesta: `Perfecto, ya puedes ver tus opciones. Estos son los servicios disponibles para tu carrera:\n\n${lista}\n\n¿Cuál te interesa? Respóndeme con el número.`, herramientas: bitacora };
      }
      return { nota: 'El estudiante acaba de aceptar ver la cotización y el sistema ya calificó su aptitud (no llames calificar_aptitud). '
        + 'Sigue directo con el paso 4: usa consultar_catalogo y preséntale los planes disponibles con letras para que elija.', herramientas: bitacora };
    }
    if (esB(texto)) return { respuesta: 'Claro, tómate tu tiempo. Cuando quieras ver tu cotización, respóndeme «sí» y la preparo.', herramientas: bitacora };
  }
  return null;
}
