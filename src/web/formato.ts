// Formatos en español (Perú). Los porcentajes usan coma decimal, como el informe.
const ZONA = 'America/Lima';

export const pct = (v: number | null, dec = 1) =>
  v === null ? 'Sin datos' : `${v.toLocaleString('es', { minimumFractionDigits: dec, maximumFractionDigits: dec })} %`;

export const entero = (n: number) => n.toLocaleString('es-PE');

export const fechaHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('es-PE', { timeZone: ZONA, dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const fecha = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('es-PE', { timeZone: ZONA, day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const segundos = (ms: number | null | undefined) =>
  ms == null ? '—' : `${(ms / 1000).toLocaleString('es', { maximumFractionDigits: 1 })} s`;

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** "2026-05" -> "may 2026" ; "2026-05-14" -> "14 may 2026" ; otros valores sin cambio. */
export function etiquetaPeriodo(v: string) {
  let m = /^(\d{4})-(\d{2})$/.exec(v);
  if (m) return `${MESES[Number(m[2]) - 1]} ${m[1]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}`;
  m = /^(\d{4})T(\d)$/.exec(v);
  if (m) return `${m[2]}.º trimestre ${m[1]}`;
  return v;
}

/** Valor para <input type="datetime-local"> en hora local. */
export function aInputLocal(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Fecha y hora compactas en 24 h (p. ej. 11/11/2026 20:37), para campos estrechos. */
export const fechaHoraCorta = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('es-PE', { timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
