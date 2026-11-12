// Tendencia mensual de un indicador (por la fecha de su propia cohorte), con bandas de umbrales.
import { useQuery } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { INDICADORES, cocienteDeSumas, semaforo, type CodigoKpi } from '../../shared/indicadores';
import { api, type PuntoTendencia } from '../api';
import { entero, etiquetaPeriodo, pct } from '../formato';
import { Semaforo } from './Semaforo';

export function TendenciaChart({ filtros, kpi, onKpi }: { filtros: Record<string, string>; kpi: CodigoKpi; onKpi: (k: CodigoKpi) => void }) {
  const def = INDICADORES.find((k) => k.codigo === kpi)!;
  const q = useQuery({ queryKey: ['tendencia', kpi, filtros], queryFn: () => api.get<PuntoTendencia[]>('/api/tablero/tendencia', { kpi, ...filtros }) });
  const datos = (q.data ?? []).map((p) => ({ ...p, valor: cocienteDeSumas(p.num, p.den), etiqueta: etiquetaPeriodo(p.mes) }));

  return (
    <section className="tarjeta p-5" aria-labelledby="t-tendencia">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="t-tendencia" className="titulo-seccion">Tendencia mensual</h2>
          <p className="nota mt-0.5">Mes de la cohorte propia del indicador; las bandas marcan Malo, Regular y Bueno.</p>
        </div>
        <label className="w-full sm:w-60">
          <span className="sr-only">Indicador</span>
          <select className="campo" value={kpi} onChange={(e) => onKpi(e.target.value as CodigoKpi)}>
            {INDICADORES.map((k) => <option key={k.codigo} value={k.codigo}>{k.nombre}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-3 h-[260px]">
        {q.isLoading ? <p className="nota">Cargando…</p> : datos.length === 0 ? <p className="nota">Sin datos para los filtros elegidos.</p> : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={datos} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
              <ReferenceArea y1={0} y2={def.regularDesde} fill="#FBE8E8" fillOpacity={1} ifOverflow="hidden" />
              <ReferenceArea y1={def.regularDesde} y2={def.buenoDesde} fill="#FFF3D6" fillOpacity={1} ifOverflow="hidden" />
              <ReferenceArea y1={def.buenoDesde} y2={100} fill="#E7F4E7" fillOpacity={1} ifOverflow="hidden" />
              <CartesianGrid stroke="#E1E0D9" strokeDasharray="0" vertical={false} />
              <XAxis dataKey="etiqueta" tickLine={false} axisLine={{ stroke: '#C3C2B7' }} tick={{ fill: '#5F5E5A', fontSize: 12 }} />
              <YAxis domain={[0, 100]} ticks={[0, def.regularDesde, def.buenoDesde, 100]} tickFormatter={(v) => `${v} %`}
                tickLine={false} axisLine={false} tick={{ fill: '#5F5E5A', fontSize: 12 }} />
              <Tooltip cursor={{ stroke: '#0B0B0B', strokeWidth: 1 }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof datos)[number];
                return (
                  <div className="rounded-lg border border-linea bg-white px-3 py-2 text-xs shadow-sm">
                    <div className="font-semibold text-tinta">{d.etiqueta}</div>
                    <div className="mt-1 flex items-center gap-2 text-tinta">{pct(d.valor)} <Semaforo estado={semaforo(def, d.valor)} compacto /></div>
                    <div className="text-tinta-3">{entero(d.num)} / {entero(d.den)} {def.denominador.etiqueta}</div>
                  </div>
                );
              }} />
              <Line type="monotone" dataKey="valor" stroke="#0B0B0B" strokeWidth={2} connectNulls
                dot={{ r: 4, fill: '#0B0B0B', stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 6 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
