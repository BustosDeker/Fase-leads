// Reporte por dimensión con drill-down por las jerarquías del cuadro 4.7.
// Una fila por miembro y una columna por indicador; el TOTAL es cociente de sumas (no promedio).
// Exportar: CSV (descarga) y PDF (impresión del navegador solo de este bloque).
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { INDICADORES, agregar, cocienteDeSumas, semaforo } from '../../shared/indicadores';
import { JERARQUIAS } from '../../shared/jerarquias';
import { api, type Celda, type Reporte } from '../api';
import { entero, etiquetaPeriodo, pct } from '../formato';
import { Semaforo } from './Semaforo';
import { CampoBusqueda, Paginacion, coincide } from './ui';

function CeldaKpi({ c, codigo, aplica }: { c: Celda | null | undefined; codigo: string; aplica: boolean }) {
  if (!aplica) return <span className="nota">No aplica</span>;
  if (!c || c.den === 0) return <span className="nota">Sin datos</span>;
  const def = INDICADORES.find((k) => k.codigo === codigo)!;
  const v = cocienteDeSumas(c.num, c.den);
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="font-semibold text-tinta">{pct(v)}</span>
      <span className="flex items-center gap-1.5 text-[11px] text-tinta-3">{entero(c.num)}/{entero(c.den)} <Semaforo estado={semaforo(def, v)} compacto /></span>
    </div>
  );
}

function descargarCsv(nombre: string, filas: string[][]) {
  const texto = '﻿' + filas.map((f) => f.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  a.click();
  URL.revokeObjectURL(url);
}

export function ReporteDimension({ filtros }: { filtros: Record<string, string> }) {
  const [jerarquiaId, setJerarquia] = useState('canal');
  const [ruta, setRuta] = useState<string[]>([]);
  const nivel = ruta.length;
  const [orden, setOrden] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  const [texto, setTexto] = useState('');
  const [pagina, setPagina] = useState(1);
  const [tamano, setTamano] = useState(25);
  const q = useQuery({
    queryKey: ['reporte', jerarquiaId, ruta, filtros],
    queryFn: () => api.get<Reporte>('/api/tablero/reporte', { jerarquia: jerarquiaId, nivel, ruta: JSON.stringify(ruta), ...filtros }),
  });
  const r = q.data;
  const kpisVisibles = INDICADORES.filter((k) => r?.aplica[k.codigo] !== false);
  const total = Object.fromEntries(INDICADORES.map((k) => [k.codigo,
    agregar((r?.filas ?? []).map((f) => f.celdas[k.codigo]).filter((c): c is Celda => !!c).map((c) => ({ num: c.num, den: c.den })))]));
  const nivelActual = r?.jerarquia.niveles[nivel]?.etiqueta ?? '';
  // Al cambiar de dimensión o de nivel se reinician búsqueda y página.
  useEffect(() => { setTexto(''); setPagina(1); }, [jerarquiaId, ruta.length]);
  const valor = (c: Celda | null | undefined) => (c && c.den > 0 ? cocienteDeSumas(c.num, c.den) : null);
  const filas = (() => {
    const base = (r?.filas ?? []).filter((x) => coincide(texto, etiquetaPeriodo(x.miembro)));
    if (!orden) return base;
    return [...base].sort((a, b) => {
      if (orden.col === 'miembro') return a.miembro.localeCompare(b.miembro, 'es', { numeric: true }) * orden.dir;
      const x = valor(a.celdas[orden.col]), y = valor(b.celdas[orden.col]);
      if (x == null && y == null) return 0;
      if (x == null) return 1;                                   // «Sin datos» siempre al final
      if (y == null) return -1;
      return (x - y) * orden.dir;
    });
  })();
  const paginas = Math.max(1, Math.ceil(filas.length / tamano));
  const actual = Math.min(pagina, paginas);
  const visibles = filas.slice((actual - 1) * tamano, actual * tamano);
  const alternar = (col: string) => setOrden((o) => (!o || o.col !== col ? { col, dir: col === 'miembro' ? 1 : -1 } : o.dir === -1 ? { col, dir: 1 } : null));
  const flecha = (col: string) => (orden?.col === col ? (orden.dir === 1 ? '▲' : '▼') : '↕');

  const exportarCsv = () => {
    if (!r) return;
    const cab = [nivelActual, ...kpisVisibles.flatMap((k) => [`${k.nombre} (%)`, `${k.numerador.etiqueta}`, `${k.denominador.etiqueta}`])];
    const fila = (m: string, celdas: Record<string, { num: number; den: number } | null | undefined>) => [m, ...kpisVisibles.flatMap((k) => {
      const c = celdas[k.codigo];
      const v = c ? cocienteDeSumas(c.num, c.den) : null;
      return [v === null ? 'Sin datos' : v.toFixed(1).replace('.', ','), String(c?.num ?? 0), String(c?.den ?? 0)];
    })];
    descargarCsv(`reporte_${jerarquiaId}_${ruta.join('_') || 'total'}.csv`.replace(/[^\w.-]+/g, '_'),
      [cab, ...r.filas.map((f) => fila(etiquetaPeriodo(f.miembro), f.celdas)), fila('Total (cociente de sumas)', total)]);
  };

  return (
    <section className="tarjeta imprimible p-5" aria-labelledby="t-reporte">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="t-reporte" className="titulo-seccion">Indicadores por dimensión</h2>
          <p className="nota mt-0.5">Haz clic en una fila para bajar de nivel. El total se calcula como cociente de sumas.</p>
        </div>
        <div className="no-imprimir flex flex-wrap gap-2">
          <label className="w-full sm:w-72">
            <span className="sr-only">Dimensión</span>
            <select className="campo" value={jerarquiaId} onChange={(e) => { setJerarquia(e.target.value); setRuta([]); }}>
              {JERARQUIAS.map((j) => <option key={j.id} value={j.id}>{j.etiqueta}</option>)}
            </select>
          </label>
          {(r?.filas.length ?? 0) > 8 && <CampoBusqueda valor={texto} alCambiar={(v) => { setTexto(v); setPagina(1); }} placeholder={`Buscar ${nivelActual.toLowerCase()}`} etiqueta="Buscar" className="w-full sm:w-56 [&>span.etiqueta-campo]:sr-only" />}
          <button className="boton-claro" onClick={exportarCsv} disabled={!r}>Exportar CSV</button>
          <button className="boton-claro" onClick={() => window.print()} disabled={!r}>Exportar PDF</button>
        </div>
      </div>

      {/* Migas del drill-down */}
      <nav className="mt-3 flex flex-wrap items-center gap-1 text-sm" aria-label="Nivel del reporte">
        <button className="rounded px-1.5 py-1 font-medium underline-offset-2 hover:underline" onClick={() => setRuta([])}>
          {r?.jerarquia.etiqueta ?? '…'}
        </button>
        {ruta.map((m, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-tinta-3">›</span>
            <button className="rounded px-1.5 py-1 font-medium underline-offset-2 hover:underline" onClick={() => setRuta(ruta.slice(0, i + 1))}>{etiquetaPeriodo(m)}</button>
          </span>
        ))}
        <span className="text-tinta-3">› {nivelActual}</span>
      </nav>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-linea-fuerte text-left text-xs text-tinta-3">
              <th className="py-2 pr-3 font-medium" aria-sort={orden?.col === 'miembro' ? (orden.dir === 1 ? 'ascending' : 'descending') : undefined}>
                <button type="button" className="no-imprimir inline-flex items-center gap-1 hover:text-tinta" onClick={() => alternar('miembro')}>{nivelActual} <span aria-hidden>{flecha('miembro')}</span></button>
                <span className="hidden print:inline">{nivelActual}</span></th>
              {INDICADORES.map((k) => (
                <th key={k.codigo} className="py-2 pl-3 text-right font-medium" aria-sort={orden?.col === k.codigo ? (orden.dir === 1 ? 'ascending' : 'descending') : undefined}>
                  <button type="button" className="inline-flex items-center gap-1 hover:text-tinta" onClick={() => alternar(k.codigo)} title="Ordenar por este indicador">
                    {k.nombre} <span aria-hidden className="no-imprimir">{flecha(k.codigo)}</span></button></th>))}
            </tr>
          </thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={6} className="py-6 nota">Cargando…</td></tr>}
            {q.isError && <tr><td colSpan={6} className="py-6 text-malo-texto">■ {(q.error as Error).message}</td></tr>}
            {r && r.filas.length === 0 && <tr><td colSpan={6} className="py-6 nota">Sin datos para los filtros elegidos.</td></tr>}
            {r && r.filas.length > 0 && filas.length === 0 && <tr><td colSpan={6} className="py-6 nota">Ningún elemento coincide con la búsqueda.</td></tr>}
            {r && visibles.map((f) => (
              <tr key={f.miembro}
                className={`border-b border-linea ${r.hayMasNiveles ? 'cursor-pointer hover:bg-fondo' : ''}`}
                onClick={() => r.hayMasNiveles && setRuta([...ruta, f.miembro])}
                tabIndex={r.hayMasNiveles ? 0 : undefined}
                onKeyDown={(e) => r.hayMasNiveles && e.key === 'Enter' && setRuta([...ruta, f.miembro])}>
                <td className="py-2.5 pr-3 font-medium">
                  {etiquetaPeriodo(f.miembro)} {r.hayMasNiveles && <span className="no-imprimir text-tinta-3" aria-hidden>›</span>}
                </td>
                {INDICADORES.map((k) => (
                  <td key={k.codigo} className="py-2.5 pl-3 text-right align-top">
                    <CeldaKpi c={f.celdas[k.codigo]} codigo={k.codigo} aplica={r.aplica[k.codigo]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {r && r.filas.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-tinta">
                <td className="py-2.5 pr-3 font-semibold">Total{texto || filas.length > tamano ? <span className="nota block font-normal">de los {r.filas.length} elementos</span> : null}</td>
                {INDICADORES.map((k) => (
                  <td key={k.codigo} className="py-2.5 pl-3 text-right align-top">
                    <CeldaKpi c={total[k.codigo]} codigo={k.codigo} aplica={r.aplica[k.codigo]} />
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {filas.length > 10 && <div className="no-imprimir"><Paginacion total={filas.length} pagina={actual} paginas={paginas} tamano={tamano}
        alPagina={setPagina} alTamano={(t) => { setTamano(t); setPagina(1); }} /></div>}
    </section>
  );
}
