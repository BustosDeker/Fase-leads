// Bloque negro de acciones sugeridas por el Agente Plataforma (solo cifras devueltas por SQL).
import { useQuery } from '@tanstack/react-query';
import { api, type Accion } from '../api';

export function AccionesSugeridas({ filtros }: { filtros: Record<string, string> }) {
  const q = useQuery({ queryKey: ['acciones', filtros], queryFn: () => api.get<Accion[]>('/api/tablero/acciones', filtros) });
  return (
    <section className="rounded-tarjeta bg-menu p-5 text-white" aria-labelledby="t-acciones">
      <h2 id="t-acciones" className="text-base font-semibold">Acciones sugeridas · Agente Plataforma</h2>
      <p className="mt-0.5 text-xs text-menu-texto">Calculadas solo con las cifras del data mart para los filtros actuales.</p>
      {q.isLoading && <p className="mt-3 text-sm text-menu-texto">Analizando…</p>}
      {q.data && q.data.length === 0 && <p className="mt-3 text-sm">● Todos los indicadores con datos están en estado Bueno.</p>}
      <ol className="mt-3 space-y-3">
        {q.data?.map((a) => (
          <li key={a.codigo} className="rounded-lg border border-white/10 bg-menu-2 p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              <span className={a.estado === 'MALO' ? 'text-[#F4A3A3]' : 'text-[#FFD27A]'}>{a.estado === 'MALO' ? '■ Malo' : '▲ Regular'}</span>
              <span>{a.indicador}</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-white/90">{a.texto}</p>
            <p className="mt-1.5 text-sm"><span className="text-menu-texto">Decisión: </span>{a.decision}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
