// Tablero de gestión de LEADS (Figura 16 del informe). Lee SOLO del data mart.
// Orden de la guía visual: cabecera → franja ETL → filtros → 5 tarjetas → embudo + tendencia →
// tabla por dimensión con drill-down y exportar → acciones sugeridas.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { INDICADORES, type CodigoKpi } from '../../shared/indicadores';
import { api, type Kpis, type OpcionesFiltros } from '../api';
import { AccionesSugeridas } from '../components/AccionesSugeridas';
import { EmbudoChart } from '../components/EmbudoChart';
import { ExplicarTablero } from '../components/ExplicarTablero';
import { BotonEtl, FranjaEtl, useEstadoEtl } from '../components/EtlRunner';
import { KpiCard } from '../components/KpiCard';
import { ReporteDimension } from '../components/ReporteDimension';
import { TendenciaChart } from '../components/TendenciaChart';
import { etiquetaPeriodo, fechaHoraCorta } from '../formato';
import { BarraFiltros, Chip, SelectFiltro, useFiltros } from '../components/ui';


export function Tablero() {
  // Filtros en la URL: el enlace del tablero filtrado se puede compartir.
  const { f, fijar, activos, limpiar } = useFiltros({ desde: '', hasta: '', grupoEtapa: '', canal: '', asesor: '' });
  const [kpiTendencia, setKpiTendencia] = useState<CodigoKpi>('K1');
  const filtros = useMemo(() => Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as Record<string, string>,
    [f.desde, f.hasta, f.grupoEtapa, f.canal, f.asesor]);
  const etl = useEstadoEtl();
  const opciones = useQuery({ queryKey: ['filtros'], queryFn: () => api.get<OpcionesFiltros>('/api/tablero/filtros') });
  const kpis = useQuery({ queryKey: ['kpis', filtros], queryFn: () => api.get<Kpis>('/api/tablero/kpis', filtros) });
  const ok = etl.data?.ultimaOk;
  const simulados = (ok?.oportunidades_demo ?? 0) > 0;
  const plazos = kpis.data?.plazos;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      {/* Cabecera */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <nav className="text-xs text-tinta-3" aria-label="Ruta">IMPULSE › LEADS › Tablero BI</nav>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">Tablero de gestión de LEADS</h1>
            {simulados && (
              <span className="rounded-full border border-linea-fuerte bg-white px-2.5 py-0.5 text-xs font-medium text-tinta-2"
                title={`${ok?.oportunidades_demo} oportunidades sintéticas y ${ok?.oportunidades_reales} creadas en la demo`}>
                Datos simulados
              </span>
            )}
          </div>
        </div>
        <BotonEtl />
      </header>

      <FranjaEtl />

      {/* Filtros y plazos de medición */}
      <div className="no-imprimir">
        <BarraFiltros activos={activos} alLimpiar={limpiar}
          resultado={<span className="nota">Plazos de medición: diagnóstico {plazos?.wdHoras ?? 48} h · cotización {plazos?.wqHoras ?? 2} h ·
            aceptación {plazos?.waDias ?? 30} días · recuperación de objeciones {plazos?.waDias ?? 30} días · conversión a PAYERS {plazos?.wcDias ?? 60} días.
            La cohorte se aplica a la fecha propia de cada indicador.</span>}>
          <div>
            <span className="etiqueta-campo">Fecha de corte</span>
            <div className="campo flex items-center overflow-hidden whitespace-nowrap bg-fondo text-tinta-2" title="Se cambia en «Ajustes» del ETL">{fechaHoraCorta(ok?.corte)}</div>
          </div>
          <label><span className="etiqueta-campo">Cohorte desde</span>
            <input type="month" className={`campo ${f.desde ? 'border-tinta font-medium' : ''}`} value={f.desde} max={f.hasta || undefined} onChange={(e) => fijar({ desde: e.target.value })} /></label>
          <label><span className="etiqueta-campo">Cohorte hasta</span>
            <input type="month" className={`campo ${f.hasta ? 'border-tinta font-medium' : ''}`} value={f.hasta} min={f.desde || undefined} onChange={(e) => fijar({ hasta: e.target.value })} /></label>
          <SelectFiltro etiqueta="Grupo de etapa" valor={f.grupoEtapa} alCambiar={(v) => fijar({ grupoEtapa: v })} opciones={opciones.data?.gruposEtapa ?? []} />
          <SelectFiltro etiqueta="Canal" valor={f.canal} alCambiar={(v) => fijar({ canal: v })} opciones={opciones.data?.canales ?? []} />
          <SelectFiltro etiqueta="Asesor" valor={f.asesor} alCambiar={(v) => fijar({ asesor: v })} opciones={opciones.data?.asesores ?? []} />
        </BarraFiltros>
        {activos > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Filtros aplicados">
            <span className="nota">Filtrando por:</span>
            {(Object.keys({"desde":"Desde","hasta":"Hasta","grupoEtapa":"Etapa","canal":"Canal","asesor":"Asesor"}) as (keyof typeof f)[]).filter((k) => f[k]).map((k) => (
              <button key={k} type="button" onClick={() => fijar({ [k]: '' })} title="Quitar este filtro"
                className="rounded-full focus-visible:outline-2"><Chip>{{"desde":"Desde","hasta":"Hasta","grupoEtapa":"Etapa","canal":"Canal","asesor":"Asesor"}[k]}: {k === 'desde' || k === 'hasta' ? etiquetaPeriodo(f[k]) : f[k]} ✕</Chip></button>
            ))}
          </div>
        )}
      </div>

      {kpis.isError && <div role="alert" className="tarjeta border-malo-marca bg-malo-fondo p-4 text-sm text-malo-texto">■ {(kpis.error as Error).message}</div>}

      {/* Cinco indicadores */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-label="Indicadores">
        {INDICADORES.map((k) => {
          const c = kpis.data?.totales[k.codigo];
          return c ? <KpiCard key={k.codigo} def={k} num={c.num} den={c.den} />
            : <div key={k.codigo} className="tarjeta h-56 animate-pulse" aria-hidden />;
        })}
      </section>

      <ExplicarTablero filtros={filtros} />

      {/* Embudo + tendencia */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {kpis.data ? <EmbudoChart totales={kpis.data.totales} /> : <div className="tarjeta h-80 animate-pulse" aria-hidden />}
        <TendenciaChart filtros={filtros} kpi={kpiTendencia} onKpi={setKpiTendencia} />
      </div>

      <ReporteDimension filtros={filtros} />
      <AccionesSugeridas filtros={filtros} />
    </div>
  );
}
