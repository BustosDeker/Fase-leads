// Componentes de interfaz reutilizables (sin librerías de UI): bloques, chips de estado, tabla, buscador, avisos.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

export const NOMBRE_ESTADO: Record<string, string> = {
  ABIERTA: 'Abierta', EN_DIAGNOSTICO: 'En diagnóstico', APTA_PARA_COTIZAR: 'Apta para cotizar', EN_NEGOCIACION: 'En negociación',
  ACEPTADA: 'Aceptada', TRANSFERIDA: 'Transferida a PAYERS', PAYER_CONFIRMADO: 'Confirmada por PAYERS', DESCARTADA: 'Descartada',
};
export const ORDEN_ESTADOS = Object.keys(NOMBRE_ESTADO);

/** Chip de estado de la oportunidad: neutro (blanco y negro); solo los estados finales llevan color puntual. */
export function ChipEstado({ estado }: { estado: string }) {
  const estilo = estado === 'PAYER_CONFIRMADO' ? 'bg-bueno-fondo text-bueno-texto border-bueno-marca/40'
    : estado === 'DESCARTADA' ? 'bg-fondo text-tinta-3 border-linea-fuerte' : 'bg-white text-tinta border-tinta/70';
  const simbolo = estado === 'PAYER_CONFIRMADO' ? '● ' : estado === 'DESCARTADA' ? '– ' : '';
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${estilo}`}>{simbolo}{NOMBRE_ESTADO[estado] ?? estado}</span>;
}

/** Chip genérico neutro, o con tono de semáforo cuando el estado lo amerita (siempre con texto y símbolo). */
export function Chip({ children, tono = 'neutro' }: { children: ReactNode; tono?: 'neutro' | 'bueno' | 'regular' | 'malo' | 'apagado' }) {
  const t = {
    neutro: 'bg-white text-tinta border-linea-fuerte', apagado: 'bg-fondo text-tinta-3 border-linea',
    bueno: 'bg-bueno-fondo text-bueno-texto border-bueno-marca/40', regular: 'bg-regular-fondo text-regular-texto border-regular-marca/60',
    malo: 'bg-malo-fondo text-malo-texto border-malo-marca/40',
  }[tono];
  return <span className={`inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${t}`}>{children}</span>;
}

export function Bloque({ titulo, origen, children, accion, className = '' }: { titulo: string; origen?: string; children: ReactNode; accion?: ReactNode; className?: string }) {
  return (
    <section className={`tarjeta p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="titulo-seccion">{titulo}</h2>
          {origen && <p className="nota mt-0.5">{origen}</p>}
        </div>
        {accion}
      </div>
      {children}
    </section>
  );
}

/** Lista de pares etiqueta–valor. */
export function Datos({ filas }: { filas: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {filas.map(([k, v]) => (
        <div key={k} className="flex min-w-0 flex-col border-b border-linea pb-1.5">
          <dt className="text-xs text-tinta-3">{k}</dt>
          <dd className="break-words font-medium text-tinta [overflow-wrap:anywhere] [&_span]:whitespace-normal">{v === null || v === undefined || v === '' ? <span className="text-tinta-3">—</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ------------------------------------------------------------------ tabla con orden y paginación
/** `orden` habilita ordenar por esa columna (clic en el encabezado). */
export interface Columna<T> { titulo: string; celda: (f: T) => ReactNode; derecha?: boolean; ancho?: string; orden?: (f: T) => string | number | null | undefined; nowrap?: boolean }

const TAMANOS = [10, 25, 50, 100];

export function Tabla<T>({ filas, columnas, vacio = 'Sin registros.', clave, alClic, maxFilas, porPagina }: {
  filas: T[]; columnas: Columna<T>[]; vacio?: string; clave: (f: T) => string | number; alClic?: (f: T) => void;
  /** Tamaño de página inicial (compatibilidad: antes era el «ver más»). */ maxFilas?: number; porPagina?: number;
}) {
  // El tamaño inicial se ajusta a una de las opciones del selector (10, 25, 50, 100).
  const [tamano, setTamano] = useState(() => TAMANOS.find((t) => t >= (porPagina ?? maxFilas ?? 25)) ?? 100);
  const [pagina, setPagina] = useState(1);
  const [orden, setOrden] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  // Al cambiar los filtros (cambia la cantidad de filas) se vuelve a la primera página.
  useEffect(() => { setPagina(1); }, [filas.length]);

  const ordenadas = (() => {
    const c = orden && columnas.find((x) => x.titulo === orden.col);
    if (!c?.orden || !orden) return filas;
    const k = c.orden;
    return [...filas].sort((a, b) => {
      const x = k(a), y = k(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;                                    // vacíos siempre al final
      if (y == null) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es', { numeric: true })) * orden.dir;
    });
  })();
  const paginas = Math.max(1, Math.ceil(ordenadas.length / tamano));
  const actual = Math.min(pagina, paginas);
  const visibles = ordenadas.slice((actual - 1) * tamano, actual * tamano);
  const alternarOrden = (col: string) => setOrden((o) => (!o || o.col !== col ? { col, dir: 1 } : o.dir === 1 ? { col, dir: -1 } : null));

  return (
    <div>
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-linea-fuerte text-left text-[11px] uppercase tracking-wide text-tinta-3">
              {columnas.map((c) => {
                const activo = orden?.col === c.titulo;
                return (
                  <th key={c.titulo} scope="col" className={`whitespace-nowrap py-2.5 pr-3 font-semibold ${c.derecha ? 'text-right' : ''} ${c.ancho ?? ''}`}
                    aria-sort={activo ? (orden!.dir === 1 ? 'ascending' : 'descending') : undefined}>
                    {c.orden ? (
                      <button type="button" onClick={() => alternarOrden(c.titulo)} title="Ordenar"
                        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-tinta ${activo ? 'text-tinta' : ''}`}>
                        {c.titulo}<span aria-hidden className="text-[10px]">{activo ? (orden!.dir === 1 ? '▲' : '▼') : '↕'}</span>
                      </button>
                    ) : c.titulo}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={columnas.length} className="py-8 text-center nota">{vacio}</td></tr>}
            {visibles.map((f) => (
              <tr key={clave(f)} className={`border-b border-linea align-top transition-colors ${alClic ? 'cursor-pointer hover:bg-fondo' : ''}`}
                onClick={alClic ? () => alClic(f) : undefined}>
                {columnas.map((c) => <td key={c.titulo} className={`py-2.5 pr-3 ${c.derecha ? 'whitespace-nowrap text-right tabular-nums' : ''} ${c.nowrap ? 'whitespace-nowrap' : ''}`}>{c.celda(f)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filas.length > TAMANOS[0] && (
        <Paginacion total={ordenadas.length} pagina={actual} paginas={paginas} tamano={tamano}
          alPagina={setPagina} alTamano={(t) => { setTamano(t); setPagina(1); }} />
      )}
    </div>
  );
}

export function Paginacion({ total, pagina, paginas, tamano, alPagina, alTamano }: {
  total: number; pagina: number; paginas: number; tamano: number; alPagina: (p: number) => void; alTamano: (t: number) => void;
}) {
  const desde = total === 0 ? 0 : (pagina - 1) * tamano + 1;
  const hasta = Math.min(total, pagina * tamano);
  // Números visibles: primera, última y dos alrededor de la actual (con «…» en los saltos).
  const nums = [...new Set([1, paginas, pagina - 1, pagina, pagina + 1].filter((p) => p >= 1 && p <= paginas))].sort((a, b) => a - b);
  const btn = 'inline-flex h-9 min-w-9 items-center justify-center rounded-md border px-2 text-sm';
  return (
    <nav className="mt-3 flex flex-wrap items-center justify-between gap-3" aria-label="Paginación">
      <div className="flex items-center gap-2 text-sm text-tinta-2">
        <span>Mostrando <strong className="text-tinta">{desde}–{hasta}</strong> de <strong className="text-tinta">{total.toLocaleString('es-PE')}</strong></span>
        <select className="h-9 rounded-md border border-linea-fuerte bg-white px-2 text-sm" value={tamano} onChange={(e) => alTamano(+e.target.value)} aria-label="Filas por página">
          {TAMANOS.map((t) => <option key={t} value={t}>{t} por página</option>)}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <button className={`${btn} border-linea-fuerte bg-white disabled:opacity-40`} disabled={pagina <= 1} onClick={() => alPagina(pagina - 1)} aria-label="Página anterior">‹</button>
        {nums.map((p, i) => (
          <span key={p} className="flex items-center gap-1">
            {i > 0 && p - nums[i - 1] > 1 && <span className="px-1 text-tinta-3">…</span>}
            <button className={`${btn} ${p === pagina ? 'border-tinta bg-tinta font-semibold text-white' : 'border-linea-fuerte bg-white hover:bg-fondo'}`}
              aria-current={p === pagina ? 'page' : undefined} onClick={() => alPagina(p)}>{p}</button>
          </span>
        ))}
        <button className={`${btn} border-linea-fuerte bg-white disabled:opacity-40`} disabled={pagina >= paginas} onClick={() => alPagina(pagina + 1)} aria-label="Página siguiente">›</button>
      </div>
    </nav>
  );
}

// ------------------------------------------------------------------ filtros (guardados en la URL: se pueden compartir y sobreviven a recargar)
/** Filtros de una pantalla en la URL. Los valores por defecto no se escriben. Conserva otros parámetros (p. ej. ?c= o ?lead=). */
export function useFiltros<T extends Record<string, string>>(base: T) {
  const [params, setParams] = useSearchParams();
  const f = Object.fromEntries(Object.keys(base).map((k) => [k, params.get(k) ?? base[k]])) as T;
  const fijar = (cambios: Partial<T>) => setParams((prev) => {
    const n = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(cambios)) { if (v === undefined || v === '' || v === base[k]) n.delete(k); else n.set(k, String(v)); }
    return n;
  }, { replace: true });
  const activos = Object.keys(base).filter((k) => f[k] !== base[k]).length;
  const limpiar = () => fijar(Object.fromEntries(Object.keys(base).map((k) => [k, base[k]])) as Partial<T>);
  return { f, fijar, activos, limpiar };
}

/** Búsqueda sin tildes ni mayúsculas en varios campos. */
const sinTildes = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const coincide = (texto: string, ...campos: (string | number | null | undefined)[]) =>
  !texto.trim() || sinTildes(campos.filter((x) => x != null).join(' ')).includes(sinTildes(texto.trim()));

/** Valores únicos ordenados (para armar los selects de filtro). */
export const unicos = (xs: (string | null | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'es'));

export function BarraFiltros({ children, activos, alLimpiar, resultado }: { children: ReactNode; activos: number; alLimpiar: () => void; resultado?: ReactNode }) {
  return (
    <section className="tarjeta p-3 sm:p-4" aria-label="Filtros">
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">{children}</div>
      {(activos > 0 || resultado) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-linea pt-3 text-sm">
          <span className="text-tinta-2">{resultado}</span>
          {activos > 0 && <button type="button" className="text-sm font-semibold underline-offset-2 hover:underline" onClick={alLimpiar}>✕ Limpiar filtros ({activos})</button>}
        </div>
      )}
    </section>
  );
}

export function CampoBusqueda({ valor, alCambiar, placeholder = 'Buscar…', etiqueta = 'Buscar', className = 'w-full sm:col-span-2' }: {
  valor: string; alCambiar: (v: string) => void; placeholder?: string; etiqueta?: string; className?: string;
}) {
  return (
    <label className={className}><span className="etiqueta-campo">{etiqueta}</span>
      <span className="relative block">
        <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tinta-3" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" strokeLinecap="round" /></svg>
        <input className="campo pl-9 pr-9" value={valor} onChange={(e) => alCambiar(e.target.value)} placeholder={placeholder} type="search" />
        {valor && <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 text-tinta-3 hover:text-tinta" onClick={() => alCambiar('')} aria-label="Borrar búsqueda">✕</button>}
      </span>
    </label>
  );
}

export function SelectFiltro({ etiqueta, valor, alCambiar, opciones, todos = 'Todos', className = 'w-full' }: {
  etiqueta: string; valor: string; alCambiar: (v: string) => void; opciones: (string | [string, string])[]; todos?: string; className?: string;
}) {
  return (
    <label className={`min-w-0 ${className}`}><span className="etiqueta-campo">{etiqueta}</span>
      <select className={`campo ${valor ? 'border-tinta font-medium' : ''}`} value={valor} onChange={(e) => alCambiar(e.target.value)}>
        <option value="">{todos}</option>
        {opciones.map((o) => { const [v, t] = Array.isArray(o) ? o : [o, o]; return <option key={v} value={v}>{t}</option>; })}
      </select>
    </label>
  );
}

/** Pestañas de segmentación con conteo (p. ej. Todos · Vigentes · Revocados). */
export function Segmentos({ opciones, valor, alCambiar, etiqueta = 'Vista' }: {
  opciones: { v: string; t: string; n?: number }[]; valor: string; alCambiar: (v: string) => void; etiqueta?: string;
}) {
  return (
    <div role="tablist" aria-label={etiqueta} className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-linea bg-fondo p-1">
      {opciones.map((o) => (
        <button key={o.v} role="tab" type="button" aria-selected={valor === o.v} onClick={() => alCambiar(o.v)}
          className={`flex min-h-[36px] shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors ${
            valor === o.v ? 'bg-white text-tinta shadow-sm ring-1 ring-linea-fuerte' : 'text-tinta-2 hover:text-tinta'}`}>
          {o.t}{o.n !== undefined && <span className={`rounded-full px-1.5 text-xs ${valor === o.v ? 'bg-tinta text-white' : 'bg-white text-tinta-2'}`}>{o.n.toLocaleString('es-PE')}</span>}
        </button>
      ))}
    </div>
  );
}

/** Fila de indicadores compactos (resumen arriba de una lista). */
export function Metricas({ items }: { items: { t: string; v: ReactNode; nota?: string; activo?: boolean; alClic?: () => void }[] }) {
  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((x) => {
        const cuerpo = <><div className="text-xs font-medium text-tinta-3">{x.t}</div><div className="mt-1 text-2xl font-bold tabular-nums">{x.v}</div>
          {x.nota && <div className="nota mt-0.5">{x.nota}</div>}</>;
        return x.alClic
          ? <button key={x.t} type="button" onClick={x.alClic} aria-pressed={!!x.activo}
              className={`tarjeta p-4 text-left transition-colors hover:border-tinta ${x.activo ? 'border-tinta ring-1 ring-tinta' : ''}`}>{cuerpo}</button>
          : <div key={x.t} className="tarjeta p-4">{cuerpo}</div>;
      })}
    </section>
  );
}

export function Aviso({ tipo = 'error', children }: { tipo?: 'error' | 'ok' | 'info'; children: ReactNode }) {
  const t = { error: 'border-malo-marca bg-malo-fondo text-malo-texto', ok: 'border-bueno-marca bg-bueno-fondo text-bueno-texto',
    info: 'border-linea-fuerte bg-white text-tinta-2' }[tipo];
  const s = { error: '■', ok: '●', info: 'ⓘ' }[tipo];
  return <div role={tipo === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2 text-sm ${t}`}>{s} {children}</div>;
}

export interface ResultadoBusqueda { lead_id: number; buyer_id: number; contacto_id: number; nombres: string; apellidos: string;
  whatsapp: string | null; whatsapp_habilitado: boolean; consentimiento_contacto: boolean; no_contactar: boolean;
  es_demo: boolean; carrera: string | null; estado: string | null }

/** Buscador por nombre o identificador con autocompletado. */
export function BuscadorLead({ alElegir, placeholder = 'Nombre, WhatsApp o identificador…' }: { alElegir: (r: ResultadoBusqueda) => void; placeholder?: string }) {
  const [texto, setTexto] = useState('');
  const [debounced, setDebounced] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(texto.trim()), 200); return () => clearTimeout(t); }, [texto]);
  useEffect(() => {
    const cerrar = (e: MouseEvent) => !caja.current?.contains(e.target as Node) && setAbierto(false);
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, []);
  const q = useQuery({ queryKey: ['buscar', debounced], enabled: debounced.length >= 2,
    queryFn: () => api.get<ResultadoBusqueda[]>('/api/leads/buscar', { q: debounced }) });
  const elegir = (r: ResultadoBusqueda) => { alElegir(r); setTexto(''); setAbierto(false); };
  const res = q.data ?? [];
  return (
    <div ref={caja} className="relative w-full">
      <input className="campo" value={texto} placeholder={placeholder} aria-label="Buscar estudiante" role="combobox"
        aria-expanded={abierto} aria-autocomplete="list"
        onChange={(e) => { setTexto(e.target.value); setAbierto(true); setActivo(0); }}
        onFocus={() => setAbierto(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActivo(Math.min(activo + 1, res.length - 1));
          if (e.key === 'ArrowUp') setActivo(Math.max(activo - 1, 0));
          if (e.key === 'Enter' && res[activo]) elegir(res[activo]);
        }} />
      {abierto && debounced.length >= 2 && (
        <ul role="listbox" className="tarjeta absolute z-30 mt-1 max-h-80 w-full overflow-y-auto p-1 shadow-lg">
          {q.isLoading && <li className="px-3 py-2 nota">Buscando…</li>}
          {!q.isLoading && res.length === 0 && <li className="px-3 py-2 nota">Sin coincidencias.</li>}
          {res.map((r, i) => (
            <li key={r.lead_id} role="option" aria-selected={i === activo}>
              <button className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-md px-3 text-left text-sm ${i === activo ? 'bg-fondo' : 'hover:bg-fondo'}`}
                onMouseEnter={() => setActivo(i)} onClick={() => elegir(r)}>
                <span>
                  <span className="font-semibold">{r.nombres} {r.apellidos}</span>
                  <span className="block text-xs text-tinta-3">Lead #{r.lead_id} · {r.carrera ?? 'sin perfil académico'}{r.es_demo ? ' · dato de prueba' : ''}</span>
                </span>
                {r.estado && <ChipEstado estado={r.estado} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const soles = (n: number | string | null | undefined) =>
  n === null || n === undefined ? '—' : `S/ ${Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function Encabezado({ ruta, titulo, children, fase = 'LEADS' }: { ruta: string; titulo: string; children?: ReactNode; fase?: string }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <nav className="text-xs text-tinta-3" aria-label="Ruta">IMPULSE › {fase} › {ruta}</nav>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{titulo}</h1>
      </div>
      {children}
    </header>
  );
}

// ------------------------------------------------------------------ registro (cabecera de ficha tipo CRM)
/** Círculo con las iniciales del nombre. */
export function Iniciales({ nombre, grande = false }: { nombre: string; grande?: boolean }) {
  const ini = nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  return <span aria-hidden className={`flex shrink-0 items-center justify-center rounded-full bg-tinta font-bold text-white ${grande ? 'h-14 w-14 text-lg' : 'h-8 w-8 text-xs'}`}>{ini}</span>;
}

/** Etapas del embudo de LEADS (sin «Descartada», que es una salida). */
const PASOS = ['ABIERTA', 'EN_DIAGNOSTICO', 'APTA_PARA_COTIZAR', 'EN_NEGOCIACION', 'ACEPTADA', 'TRANSFERIDA', 'PAYER_CONFIRMADO'];
const PASO_CORTO: Record<string, string> = { ABIERTA: 'Abierta', EN_DIAGNOSTICO: 'Diagnóstico', APTA_PARA_COTIZAR: 'Apta', EN_NEGOCIACION: 'Negociación',
  ACEPTADA: 'Aceptada', TRANSFERIDA: 'En PAYERS', PAYER_CONFIRMADO: 'Confirmada' };

/** Barra de etapas de la oportunidad: hechas (●), actual (resaltada) y pendientes. */
export function PasosEstado({ estado }: { estado: string }) {
  const i = PASOS.indexOf(estado);
  if (estado === 'DESCARTADA') return <p className="text-sm text-tinta-2">– Oportunidad descartada: salió del embudo.</p>;
  return (
    <ol className="flex w-full overflow-x-auto" aria-label="Etapas de la oportunidad">
      {PASOS.map((p, n) => {
        const hecho = n < i, actual = n === i;
        return (
          <li key={p} className="flex min-w-[92px] flex-1 flex-col items-center gap-1" aria-current={actual ? 'step' : undefined}>
            <div className="flex w-full items-center">
              <span className={`h-0.5 flex-1 ${n === 0 ? 'invisible' : hecho || actual ? 'bg-tinta' : 'bg-linea-fuerte'}`} />
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold ${
                actual ? 'border-tinta bg-tinta text-white' : hecho ? 'border-tinta bg-white text-tinta' : 'border-linea-fuerte bg-white text-tinta-3'}`}>{hecho ? '✓' : n + 1}</span>
              <span className={`h-0.5 flex-1 ${n === PASOS.length - 1 ? 'invisible' : hecho ? 'bg-tinta' : 'bg-linea-fuerte'}`} />
            </div>
            <span className={`whitespace-nowrap text-[11px] ${actual ? 'font-bold text-tinta' : hecho ? 'text-tinta-2' : 'text-tinta-3'}`}>{PASO_CORTO[p]}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Dato clave compacto para la cabecera de un registro. */
export function DatoClave({ t, v }: { t: string; v: ReactNode }) {
  return <div className="min-w-0"><div className="text-[11px] font-medium uppercase tracking-wide text-tinta-3">{t}</div><div className="truncate text-sm font-semibold">{v ?? '—'}</div></div>;
}
