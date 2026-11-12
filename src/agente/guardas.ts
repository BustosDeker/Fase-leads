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
