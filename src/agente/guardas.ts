// Barreras de seguridad del agente (independientes del proveedor de IA):
// - detección de intentos de inyección de instrucciones en el mensaje del estudiante;
// - qué herramientas se permiten según el consentimiento;
// - revisión de la respuesta: sin códigos internos, sin montos que no salgan de las herramientas, largo máximo.
import type { Catalogos } from './contexto.js';

export const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const PATRONES_INYECCION = [
  /ignora\w*\s+(todas?\s+)?(las\s+|tus\s+)?(instrucciones|reglas|indicaciones)/,
  /olvida\w*\s+(todo|tus|las)\s/,
  /(system|sistema)\s*prompt|prompt\s+del\s+sistema/,
  /(muestra|revela|dime|ensena)\w*\s+(me\s+)?(tus|las)\s+(instrucciones|reglas|herramientas)/,
  /\b(actua|comportate|responde)\s+como\b/,
  /\bahora\s+eres\b|\beres\s+ahora\b/,
  /modo\s+(desarrollador|developer|dios|admin|sin\s+restricciones)/,
  /\bjailbreak\b|\bdan\b\s+mode/,
  /<\/?\s*(system|tool|instrucciones|assistant)\b/,
  /descuento\s+(del?\s+)?(100|9\d)\s*%/,
  /(precio|costo)\s+(de\s+)?(s\/\s*)?0+([.,]0+)?\b|\bgratis\b.*\b(obligatorio|ordeno|exijo)/,
];

/** true si el texto parece un intento de cambiar las reglas del agente. */
export function detectarInyeccion(texto: string): boolean {
  const t = normalizar(texto);
  return PATRONES_INYECCION.some((p) => p.test(t));
}

/** Extrae un tema de tesis sin confundirlo con datos de avance o disponibilidad de empresa. */
export function extraerTemaTesis(texto: string): string | null {
  const t = texto.trim();
  // Tema aún sin definir pero con una línea de investigación orientativa: es un valor válido.
  if (/^por definir\s*[(:\-—]\s*\S/i.test(t)) return t.slice(0, 250);
  // Frases que empiezan con «no tengo…» (tiempo, tema, empresa) no son un tema.
  if (/^no\s+tengo(?![a-z])/i.test(normalizar(t))) return null;
  // «No está definido/a» no es un tema.
  if (/^no\s+est[aá]\s+definid[oa]s?(?![a-z])/i.test(t) || /^por definir[\s.!?]*$/i.test(t)) return null;
  const marcadores = [
    /(?:mi|el)\s+tema(?:\s+de\s+(?:mi\s+)?tesis)?\s*(?:es|ser[ií]a|ser[aá]|:)\s*(.+)/i,
    /mi\s+tesis\s+(?:trata|es|se\s+enfoca)\s+(?:sobre|en|de)?\s*(.+)/i,
    /(?:quiero|voy\s+a)\s+investigar\s+(?:sobre\s+)?(.+)/i,
    /(?:investigo|analizo)\s+(?:sobre\s+)?(.+)/i,
    /mi\s+investigaci[oó]n\s+(?:trata\s+de|es\s+sobre|consiste\s+en|se\s+titula|es)\s*(.+)/i,
    /t[ií]tulo(?:\s+de\s+tesis)?\s*:\s*(.+)/i,
  ];
  const marcado = marcadores.map((p) => p.exec(t)).find(Boolean);
  if (marcado) {
    const tema = marcado[1].trim().replace(/[.,;]+$/, '');
    return tema.length >= 3 && !/^(?:aun no|todavia no|no se|no tengo tema|por definir)[.!?]*$/i.test(normalizar(tema))
      ? tema.slice(0, 250) : null;
  }
  if (/\b(?:no tengo|no he definido|aun no tengo|todavia no tengo)\s+(?:un\s+)?(?:tema|titulo|tesis)\b/i.test(normalizar(t))) return null;
  if (/\b(?:avance|empresa|instituci[oó]n|aplicar|por ciento|ciclo|universidad|carrera|sede|limitaciones|fecha de entrega|sustentaci[oó]n)\b|%|estudio en\b|estoy en\b/i.test(normalizar(t))) return null;
  if (/^(?:hola|gracias|muchas gracias|no s[eé]|todav[ií]a no s[eé]|no tengo tema)[\s.!?]*$/i.test(t)) return null;
  return t.length >= 8 ? t.slice(0, 250) : null;
}

export type TipoTesis = 'DESCRIPTIVA' | 'CORRELACIONAL' | 'EXPERIMENTAL' | 'APLICADA' | 'NO_DEFINIDO';

export function extraerTipoTesis(texto: string): TipoTesis | null {
  const t = normalizar(texto);
  if (/\b(no se|no lo se|aun no|todavia no|no definido|por definir)\b/.test(t)
    && /\b(tipo|investigacion|tesis)\b/.test(t)) return 'NO_DEFINIDO';
  if (/\b(tema|mi tesis trata|mi tema|titulo)\b/.test(t)) return null;
  if (t.length > 60 && !/\b(tipo|investigacion)\b/.test(t)) return null;
  if (/\b(descriptiv[oa]s?)\b/.test(t)) return 'DESCRIPTIVA';
  if (/\b(correlacional(?:es)?)\b/.test(t)) return 'CORRELACIONAL';
  if (/\b(experimental(?:es)?)\b/.test(t)) return 'EXPERIMENTAL';
  if (/\b(aplicad[oa]s?)\b/.test(t)) return 'APLICADA';
  return null;
}

export function extraerAvance(texto: string): number | null {
  const m = /(?:avance(?:\s+de)?\s*)?(\d{1,3}(?:[.,]\d+)?)\s*(?:%|\bpor\s+ciento\b)/i.exec(texto);
  if (!m) return null;
  const avance = Number(m[1].replace(',', '.'));
  return avance >= 0 && avance <= 100 ? avance : null;
}

export function extraerEstadoEmpresa(texto: string): boolean | null {
  const t = normalizar(texto);
  if (/\b(no tengo|no cuento con|no hay|sin)\s+(?:una?\s+)?(?:empresa|institucion|centro|lugar)\b|\bno cuento con empresa\b/.test(t))
    return false;
  if (/\b(tengo|cuento con|trabajo en|mi empresa es|si,\s*tengo|si,\s*cuento)\b.*\b(empresa|institucion|colegio|hospital|clinica|municipalidad)\b/.test(t))
    return true;
  return null;
}

export function extraerLimitaciones(texto: string): string | null {
  const t = normalizar(texto);
  const respuesta = /(?:mis\s+)?(?:limitaciones|dificultades|obstaculos|problemas)\s*(?:son|es|:)?\s*(.+)/i.exec(texto.trim());
  if (respuesta) {
    const valor = respuesta[1].trim().replace(/[.!?]+$/, '');
    if (/^(ningun[oa]s?|no tengo|ninguna por ahora|no aplica)$/i.test(normalizar(valor))) return 'Ninguna indicada';
    return valor.length >= 2 ? valor.slice(0, 300) : null;
  }
  if (/\b(?:no tengo|ningun[oa]s?|no aplica)\b/.test(t)
    && (/\b(?:limitaciones|dificultades|obstaculos|problemas)\b/.test(t)
      || /^(?:no tengo|ningun[oa]s?|no aplica)[.!?]*$/.test(t))) return 'Ninguna indicada';
  return null;
}

export function extraerFechaLimite(texto: string): string | 'NO_DEFINIDA' | null {
  const t = normalizar(texto);
  if (/\b(no tengo fecha|sin fecha|no hay fecha|aun no se|todavia no se|no esta definida|por definir)\b/.test(t))
    return 'NO_DEFINIDA';
  const m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b|\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/.exec(texto);
  if (!m) return null;
  const year = Number(m[1] ?? m[6]), month = Number(m[2] ?? m[5]), day = Number(m[3] ?? m[4]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function extraerSede(texto: string): string | null {
  const t = normalizar(texto);
  if (/\b(?:no se|no tengo|no recuerdo)\s+(?:cual es\s+)?(?:mi\s+)?sede\b/.test(t)) return 'No especificada';
  const m = /(?:mi\s+)?sede\s*(?:es|de|:)?\s*([^,.;!?]+)/i.exec(texto.trim());
  if (!m) return null;
  const sede = m[1].trim().replace(/^(?:la|el)\s+/i, '');
  if (/^(no se|no aplica|ninguna|sin sede)$/i.test(normalizar(sede))) return 'No especificada';
  return sede.length >= 2 ? sede.slice(0, 100) : null;
}

/** Herramientas permitidas sin consentimiento (Ley 29733): solo pedirlo, consultar la situación o derivar. */
export const HERRAMIENTAS_SIN_CONSENTIMIENTO = new Set(['registrar_consentimiento', 'consultar_situacion', 'escalar_a_humano']);

const CODIGOS_INTERNOS = /\b(K[1-5]|M(10|[1-9])|WD|WQ|WA|WC)\b/g;

/** Montos (S/) que aparecen en un texto. */
export function montosEn(texto: string): number[] {
  const r: number[] = [];
  for (const m of texto.matchAll(/S\/\.?\s?(\d[\d.,]*\d|\d)/g)) {
    // 1,234.50 · 1.234,50 · 1234.5 · 2 500: el último separador seguido de 1–2 dígitos es el decimal.
    const s = m[1];
    const dec = /[.,](\d{1,2})$/.exec(s);
    const entero = (dec ? s.slice(0, dec.index) : s).replace(/[.,]/g, '');
    const n = Number(entero + (dec ? '.' + dec[1] : ''));
    if (Number.isFinite(n)) r.push(n);
  }
  return r;
}

/** Todos los números presentes en los resultados de herramientas (montos autorizados para citar). */
export function numerosEn(texto: string): number[] {
  return [...texto.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

export interface RevisionSalida { texto: string; observaciones: string[]; bloqueada: boolean }

/** Revisa la respuesta antes de enviarla al estudiante. */
export function revisarSalida(texto: string, montosPermitidos: number[]): RevisionSalida {
  const obs: string[] = [];
  let t = texto.trim();
  if (CODIGOS_INTERNOS.test(t)) { obs.push('Se quitaron códigos internos de la respuesta.'); t = t.replace(CODIGOS_INTERNOS, '').replace(/\s{2,}/g, ' '); }
  const fuera = montosEn(t).filter((m) => !montosPermitidos.some((p) => Math.abs(p - m) < 0.01));
  if (fuera.length) {
    obs.push(`La respuesta citaba montos que no salieron del motor de precios (${fuera.map((x) => 'S/ ' + x.toFixed(2)).join(', ')}).`);
    return { bloqueada: true, observaciones: obs,
      texto: 'Para no darte un monto incorrecto, prefiero confirmarlo con el sistema de precios. En un momento te comparto la cifra exacta o te escribe un especialista.' };
  }
  if (t.length > 1500) { obs.push('Respuesta recortada por largo.'); t = t.slice(0, 1480).replace(/\s+\S*$/, '') + '…'; }
  if (!t) { obs.push('Respuesta vacía.'); t = 'Disculpa, ¿podrías repetirme tu consulta?'; }
  return { texto: t, observaciones: obs, bloqueada: false };
}

// ------------------------------------------------------------------ reconocimiento de catálogos (lo usan las herramientas y el mock)
const PALABRAS_VACIAS = new Set(['universidad', 'nacional', 'privada', 'ingenieria', 'ciencias', 'facultad', 'escuela', 'carrera', 'de', 'del', 'la', 'las', 'los', 'y']);
const ALIAS_UNIVERSIDAD: Record<string, string> = {
  unt: 'Universidad Nacional de Trujillo', upao: 'Universidad Privada Antenor Orrego', ucv: 'Universidad César Vallejo',
  upn: 'Universidad Privada del Norte', unmsm: 'Universidad Nacional Mayor de San Marcos', 'san marcos': 'Universidad Nacional Mayor de San Marcos',
  unc: 'Universidad Nacional de Cajamarca', 'cesar vallejo': 'Universidad César Vallejo', 'antenor orrego': 'Universidad Privada Antenor Orrego',
};

function claves(nombre: string) { return normalizar(nombre).split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !PALABRAS_VACIAS.has(w)); }

/** Busca en un catálogo el elemento cuyo nombre (o alias) aparece en el texto. Devuelve el más específico. */
function buscar<T extends { nombre: string }>(texto: string, lista: T[], alias: Record<string, string> = {}): T | null {
  const t = ' ' + normalizar(texto).replace(/[^a-z0-9]+/g, ' ') + ' ';
  for (const [a, nombre] of Object.entries(alias)) if (t.includes(' ' + a + ' ')) { const x = lista.find((e) => e.nombre === nombre); if (x) return x; }
  const exacto = lista.find((e) => t.includes(' ' + normalizar(e.nombre).replace(/[^a-z0-9]+/g, ' ') + ' '));
  if (exacto) return exacto;
  let mejor: T | null = null, puntos = 0;
  for (const e of lista) {
    const k = claves(e.nombre);
    const p = k.filter((w) => t.includes(' ' + w + ' ') || t.includes(' ' + w.slice(0, 6))).length;
    if (p > puntos || (p === puntos && p > 0 && mejor && k.length < claves(mejor.nombre).length)) { mejor = e; puntos = p; }
  }
  return puntos > 0 ? mejor : null;
}

export const buscarUniversidad = (texto: string, c: Catalogos) => buscar(texto, c.universidades, ALIAS_UNIVERSIDAD);
export const buscarCarrera = (texto: string, c: Catalogos) => buscar(texto, c.carreras);

export function detectarEtapa(texto: string): 'CICLO_IX' | 'CICLO_X' | 'EGRESADO' | 'BACHILLER' | null {
  const t = normalizar(texto);
  if (/bachiller/.test(t)) return 'BACHILLER';
  if (/egresad/.test(t)) return 'EGRESADO';
  if (/\b(x|10|decimo)\s*(ciclo)?\b.*ciclo|ciclo\s*(x|10|decimo)\b|\bdecimo\b/.test(t)) return 'CICLO_X';
  if (/\b(ix|9|noveno)\s*(ciclo)?\b.*ciclo|ciclo\s*(ix|9|noveno)\b|\bnoveno\b/.test(t)) return 'CICLO_IX';
  return null;
}
