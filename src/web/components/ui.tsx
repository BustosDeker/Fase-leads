// Componentes de interfaz reutilizables (sin librerías de UI): bloques, chips de estado, tabla, buscador, avisos.
import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  return <span className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${t}`}>{children}</span>;
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
          <dd className="break-words font-medium text-tinta [overflow-wrap:anywhere]">{v === null || v === undefined || v === '' ? <span className="text-tinta-3">—</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface Columna<T> { titulo: string; celda: (f: T) => ReactNode; derecha?: boolean; ancho?: string }
export function Tabla<T>({ filas, columnas, vacio = 'Sin registros.', clave, alClic, maxFilas }: {
  filas: T[]; columnas: Columna<T>[]; vacio?: string; clave: (f: T) => string | number; alClic?: (f: T) => void; maxFilas?: number;
}) {
  const [todas, setTodas] = useState(false);
  const visibles = maxFilas && !todas ? filas.slice(0, maxFilas) : filas;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-linea-fuerte text-left text-xs text-tinta-3">
            {columnas.map((c) => <th key={c.titulo} className={`py-2 pr-3 font-medium ${c.derecha ? 'text-right' : ''} ${c.ancho ?? ''}`}>{c.titulo}</th>)}
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 && <tr><td colSpan={columnas.length} className="py-5 nota">{vacio}</td></tr>}
          {visibles.map((f) => (
            <tr key={clave(f)} className={`border-b border-linea align-top ${alClic ? 'cursor-pointer hover:bg-fondo' : ''}`}
              onClick={alClic ? () => alClic(f) : undefined}>
              {columnas.map((c) => <td key={c.titulo} className={`py-2 pr-3 ${c.derecha ? 'text-right' : ''}`}>{c.celda(f)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {maxFilas && filas.length > maxFilas && (
        <button className="boton-claro mt-3" onClick={() => setTodas(!todas)}>{todas ? 'Mostrar menos' : `Ver los ${filas.length} registros`}</button>
      )}
    </div>
  );
}

export function Aviso({ tipo = 'error', children }: { tipo?: 'error' | 'ok' | 'info'; children: ReactNode }) {
  const t = { error: 'border-malo-marca bg-malo-fondo text-malo-texto', ok: 'border-bueno-marca bg-bueno-fondo text-bueno-texto',
    info: 'border-linea-fuerte bg-white text-tinta-2' }[tipo];
  const s = { error: '■', ok: '●', info: 'ⓘ' }[tipo];
  return <div role={tipo === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2 text-sm ${t}`}>{s} {children}</div>;
}

export interface ResultadoBusqueda { lead_id: number; buyer_id: number; contacto_id: number; nombres: string; apellidos: string;
  whatsapp: string | null; es_demo: boolean; carrera: string | null; estado: string | null }

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
