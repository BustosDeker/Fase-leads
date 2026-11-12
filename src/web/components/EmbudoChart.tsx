// Embudo de oportunidades. Cada barra usa SU PROPIA cohorte madura (no es un embudo de una sola población):
// oportunidades maduras → con diagnóstico → aptas → con propuesta → aceptadas → confirmadas por PAYERS.
import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Kpis } from '../api';
import { entero, pct } from '../formato';

export function EmbudoChart({ totales }: { totales: Kpis['totales'] }) {
  const etapas = [
    { etapa: 'Oportunidades', valor: totales.K5.den, cohorte: 'inicio + 60 días' },
    { etapa: 'Con diagnóstico', valor: totales.K1.den, cohorte: 'solicitud + 48 h' },
    { etapa: 'Aptas para cotizar', valor: totales.K2.den, cohorte: 'aptitud + 2 h' },
    { etapa: 'Con propuesta', valor: totales.K3.den, cohorte: 'primera propuesta + 30 días' },
    { etapa: 'Aceptadas', valor: totales.K3.num, cohorte: 'primera propuesta + 30 días' },
    { etapa: 'Confirmadas por PAYERS', valor: totales.K5.num, cohorte: 'inicio + 60 días' },
  ].map((e, i, arr) => ({
    ...e,
    caida: i === 0 || !arr[i - 1].valor ? null : 100 * (1 - e.valor / arr[i - 1].valor),
  }));
  const max = Math.max(1, ...etapas.map((e) => e.valor));

  return (
    <section className="tarjeta p-5" aria-labelledby="t-embudo">
      <h2 id="t-embudo" className="titulo-seccion">Embudo de oportunidades</h2>
      <p className="nota mt-0.5">Cada barra cuenta su propia cohorte madura; la caída entre etapas es orientativa.</p>
      <div className="mt-3 h-[290px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={etapas} layout="vertical" margin={{ top: 4, right: 96, bottom: 4, left: 8 }} barCategoryGap={6}>
            <XAxis type="number" hide domain={[0, max]} />
            <YAxis type="category" dataKey="etapa" width={150} tickLine={false} axisLine={false}
              tick={{ fill: '#3D3D3A', fontSize: 12 }} />
            <Tooltip cursor={{ fill: '#F4F4F1' }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as (typeof etapas)[number];
              return (
                <div className="rounded-lg border border-linea bg-white px-3 py-2 text-xs shadow-sm">
                  <div className="font-semibold text-tinta">{d.etapa}: {entero(d.valor)}</div>
                  <div className="text-tinta-3">Cohorte madura: {d.cohorte}</div>
                  {d.caida !== null && d.caida > 0 && <div className="text-tinta-3">Caída frente a la etapa anterior: {pct(d.caida)}</div>}
                  {d.caida !== null && d.caida <= 0 && <div className="text-tinta-3">Supera a la etapa anterior porque su cohorte madura es distinta.</div>}
                </div>
              );
            }} />
            <Bar dataKey="valor" fill="#2B2B29" radius={[0, 4, 4, 0]} isAnimationActive={false}>
              <LabelList dataKey="valor" position="right" content={(p: any) => {
                const d = etapas[p.index];
                return (
                  <text x={p.x + p.width + 6} y={p.y + p.height / 2} dominantBaseline="middle" fontSize={12} fill="#0B0B0B">
                    <tspan fontWeight={600}>{entero(d.valor)}</tspan>
                    {/* Una etapa puede superar a la anterior porque cada barra usa su propia cohorte: no es caída. */}
                    {d.caida !== null && d.caida > 0 && <tspan fill="#5F5E5A">{`  ↓ ${pct(d.caida, 0)}`}</tspan>}
                    {d.caida !== null && d.caida <= 0 && <tspan fill="#5F5E5A">{'  cohorte distinta'}</tspan>}
                  </text>
                );
              }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
