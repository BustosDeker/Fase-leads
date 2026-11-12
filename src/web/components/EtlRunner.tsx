// Ejecutar ETL (carga del data mart) con progreso por paso vía SSE, panel de ajustes (fecha de corte y
// plazos) y franja de estado de la última carga correcta.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type EstadoEtl } from '../api';
import { aInputLocal, entero, fechaHora, segundos } from '../formato';
import { useLiveEvents } from '../hooks/useLiveEvents';

const PASOS: Record<string, string> = {
  inicio: 'Preparando la carga…', dimensiones: 'Cargando dimensiones (MERGE)…', hechos: 'Cargando hechos (limpieza total)…',
  conteo: 'Contando filas…', fin: 'Terminando…',
};

export function useEstadoEtl() {
  return useQuery({ queryKey: ['etl'], queryFn: () => api.get<EstadoEtl>('/api/etl/estado') });
}

export function BotonEtl() {
  const cliente = useQueryClient();
  const [paso, setPaso] = useState<string | null>(null);
  const [ajustes, setAjustes] = useState(false);
  const [p, setP] = useState({ corte: '', wdHoras: 48, wqHoras: 2, waDias: 30, wcDias: 60 });
  useLiveEvents({ etl: (d) => setPaso(d.paso === 'terminado' ? null : d.paso) });

  const m = useMutation({
    mutationFn: () => api.post<{ ok: boolean; error?: string }>('/api/etl/ejecutar', {
      ...p, corte: p.corte ? new Date(p.corte).toISOString() : undefined,
    }),
    onSettled: () => { setPaso(null); cliente.invalidateQueries(); },
  });
  const error = m.error ? (m.error as Error).message : m.data && !m.data.ok ? m.data.error : null;

  return (
    <div className="no-imprimir relative flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button className="boton-claro" onClick={() => setAjustes(!ajustes)} aria-expanded={ajustes}>Ajustes</button>
        <button className="boton-negro min-w-[150px]" onClick={() => m.mutate()} disabled={m.isPending}>
          {m.isPending ? 'Ejecutando…' : 'Ejecutar ETL'}
        </button>
      </div>
      {m.isPending && <span className="text-xs text-tinta-3" role="status">{PASOS[paso ?? 'inicio']}</span>}
      {error && <span className="max-w-sm text-right text-xs text-malo-texto" role="alert">■ {error}</span>}
      {ajustes && (
        <div className="tarjeta absolute right-0 top-14 z-20 w-[min(92vw,360px)] p-4 shadow-lg">
          <h3 className="text-sm font-semibold">Parámetros de medición</h3>
          <p className="nota mt-1">Se fijan antes de cada carga. Si dejas la fecha vacía se usa el momento actual.</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="col-span-2"><span className="etiqueta-campo">Fecha de corte</span>
              <input type="datetime-local" className="campo" value={p.corte} max={aInputLocal(new Date())}
                onChange={(e) => setP({ ...p, corte: e.target.value })} /></label>
            <label><span className="etiqueta-campo">Diagnóstico (horas)</span>
              <input type="number" min={1} className="campo" value={p.wdHoras} onChange={(e) => setP({ ...p, wdHoras: +e.target.value })} /></label>
            <label><span className="etiqueta-campo">Cotización (horas)</span>
              <input type="number" min={1} className="campo" value={p.wqHoras} onChange={(e) => setP({ ...p, wqHoras: +e.target.value })} /></label>
            <label><span className="etiqueta-campo">Aceptación y recuperación (días)</span>
              <input type="number" min={1} className="campo" value={p.waDias} onChange={(e) => setP({ ...p, waDias: +e.target.value })} /></label>
            <label><span className="etiqueta-campo">Conversión a PAYERS (días)</span>
              <input type="number" min={1} className="campo" value={p.wcDias} onChange={(e) => setP({ ...p, wcDias: +e.target.value })} /></label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button className="boton-claro" onClick={() => setP({ corte: '', wdHoras: 48, wqHoras: 2, waDias: 30, wcDias: 60 })}>Restablecer</button>
            <button className="boton-negro" onClick={() => { setAjustes(false); m.mutate(); }} disabled={m.isPending}>Ejecutar con estos valores</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function FranjaEtl() {
  const q = useEstadoEtl();
  const ok = q.data?.ultimaOk;
  const ultima = q.data?.ultima;
  if (q.isLoading) return <div className="tarjeta px-4 py-3 text-sm text-tinta-3">Consultando el estado del ETL…</div>;
  if (!ok) return (
    <div className="tarjeta border-regular-marca bg-regular-fondo px-4 py-3 text-sm text-regular-texto" role="status">
      ▲ El data mart aún no tiene ninguna carga. Pulsa «Ejecutar ETL» para poblarlo desde el OLTP.
    </div>
  );
  const det = ok.detalle_json ? (JSON.parse(ok.detalle_json) as Record<string, number>) : {};
  const nDims = Object.keys(det).filter((t) => t.startsWith('Dim_')).length;
  const nHechos = Object.keys(det).filter((t) => t.startsWith('Hecho_')).length;
  return (
    <div className="tarjeta flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 text-sm" role="status">
      <span className="font-semibold text-bueno-texto">● Último ETL correcto</span>
      <span>{fechaHora(ok.fin ?? ok.inicio)}</span>
      <span className="text-tinta-3">Duración <strong className="text-tinta">{segundos(ok.duracion_ms)}</strong></span>
      <span className="text-tinta-3">{nDims} dimensiones · <strong className="text-tinta">{entero(ok.filas_dimensiones ?? 0)}</strong> filas</span>
      <span className="text-tinta-3">{nHechos} hechos · <strong className="text-tinta">{entero(ok.filas_hechos ?? 0)}</strong> filas</span>
      {ultima && ultima.estado === 'ERROR' && ultima.etl_id > ok.etl_id && (
        <span className="text-malo-texto">■ La última ejecución falló y se revirtió: {ultima.error}</span>
      )}
      <span className="nota w-full">Las oportunidades nuevas aparecen en el tablero después de ejecutar el ETL.</span>
    </div>
  );
}
