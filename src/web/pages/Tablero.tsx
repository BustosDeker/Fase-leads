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
import { fechaHoraCorta } from '../formato';

interface Filtros { desde: string; hasta: string; grupoEtapa: string; canal: string; asesor: string }
const VACIOS: Filtros = { desde: '', hasta: '', grupoEtapa: '', canal: '', asesor: '' };

export function Tablero() {
  const [f, setF] = useState<Filtros>(VACIOS);
  const [kpiTendencia, setKpiTendencia] = useState<CodigoKpi>('K1');
  const filtros = useMemo(() => Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as Record<string, string>, [f]);
  const etl = useEstadoEtl();
  const opciones = useQuery({ queryKey: ['filtros'], queryFn: () => api.get<OpcionesFiltros>('/api/tablero/filtros') });
  const kpis = useQuery({ queryKey: ['kpis', filtros], queryFn: () => api.get<Kpis>('/api/tablero/kpis', filtros) });
  const ok = etl.data?.ultimaOk;
  const simulados = (ok?.oportunidades_demo ?? 0) > 0;
  const plazos = kpis.data?.plazos;
  const hayFiltros = Object.keys(filtros).length > 0;

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

      {/* Filtros (una fila) y plazos de medición */}
      <section className="tarjeta no-imprimir p-4" aria-label="Filtros">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <div className="col-span-2 md:col-span-1">
            <span className="etiqueta-campo">Fecha de corte</span>
            <div className="campo flex items-center overflow-hidden whitespace-nowrap bg-fondo text-tinta-2" title="Se cambia en «Ajustes» del ETL">{fechaHoraCorta(ok?.corte)}</div>
          </div>
          <label><span className="etiqueta-campo">Cohorte desde</span>
            <input type="month" className="campo" value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} /></label>
          <label><span className="etiqueta-campo">Cohorte hasta</span>
            <input type="month" className="campo" value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} /></label>
          <label><span className="etiqueta-campo">Grupo de etapa</span>
            <select className="campo" value={f.grupoEtapa} onChange={(e) => setF({ ...f, grupoEtapa: e.target.value })}>
              <option value="">Todos</option>{opciones.data?.gruposEtapa.map((x) => <option key={x}>{x}</option>)}
            </select></label>
          <label><span className="etiqueta-campo">Canal</span>
            <select className="campo" value={f.canal} onChange={(e) => setF({ ...f, canal: e.target.value })}>
              <option value="">Todos</option>{opciones.data?.canales.map((x) => <option key={x}>{x}</option>)}
            </select></label>
          <label><span className="etiqueta-campo">Asesor</span>
            <select className="campo" value={f.asesor} onChange={(e) => setF({ ...f, asesor: e.target.value })}>
              <option value="">Todos</option>{opciones.data?.asesores.map((x) => <option key={x}>{x}</option>)}
            </select></label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="nota">
            Plazos de medición: diagnóstico {plazos?.wdHoras ?? 48} h · cotización {plazos?.wqHoras ?? 2} h ·
            aceptación {plazos?.waDias ?? 30} días · recuperación de objeciones {plazos?.waDias ?? 30} días · conversión a PAYERS {plazos?.wcDias ?? 60} días.
            La cohorte se aplica a la fecha propia de cada indicador.
          </p>
          {hayFiltros && <button className="boton-claro" onClick={() => setF(VACIOS)}>Quitar filtros</button>}
        </div>
      </section>

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
