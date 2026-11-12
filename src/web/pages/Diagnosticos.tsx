// Diagnósticos: solicitud y entrega con fechas visibles y semáforo del plazo (48 h por defecto).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { fechaHora } from '../formato';
import { Aviso, Bloque, Chip, ChipEstado, Encabezado, Tabla } from '../components/ui';

interface Dx { diagnostico_id: number; oportunidad_id: number; lead_id: number; fecha_solicitud: string; fecha_entrega: string | null; estado: string;
  tema_tesis: string | null; tipo_tesis: string | null; requiere_derivacion: boolean; asesor: string; estudiante: string; estado_oportunidad: string;
  horas: number; situacion: 'A_TIEMPO' | 'TARDE' | 'EN_PLAZO' | 'VENCIDO' }

const SIT: Record<Dx['situacion'], { t: string; tono: 'bueno' | 'malo' | 'regular' }> = {
  A_TIEMPO: { t: '● Entregado a tiempo', tono: 'bueno' }, TARDE: { t: '■ Entregado fuera de plazo', tono: 'malo' },
  EN_PLAZO: { t: '▲ Pendiente dentro del plazo', tono: 'regular' }, VENCIDO: { t: '■ Pendiente y vencido', tono: 'malo' },
};

export function Diagnosticos() {
  const navegar = useNavigate();
  const [plazo, setPlazo] = useState(48);
  const [filtro, setFiltro] = useState('');
  const q = useQuery({ queryKey: ['diagnosticos', plazo], queryFn: () => api.get<Dx[]>('/api/diagnosticos', { plazo }) });
  const datos = (q.data ?? []).filter((d) => !filtro || d.situacion === filtro);
  const cuenta = (s: string) => (q.data ?? []).filter((d) => d.situacion === s).length;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <Encabezado ruta="Diagnósticos" titulo="Diagnósticos de tesis" />
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(Object.keys(SIT) as Dx['situacion'][]).map((s) => (
          <button key={s} onClick={() => setFiltro(filtro === s ? '' : s)} aria-pressed={filtro === s}
            className={`tarjeta p-4 text-left ${filtro === s ? 'border-tinta' : ''}`}>
            <div className="text-2xl font-bold">{cuenta(s)}</div><Chip tono={SIT[s].tono}>{SIT[s].t}</Chip>
          </button>
        ))}
      </section>
      <Bloque titulo="Solicitudes" origen="LEADS · DIAGNOSTICO · clic en una fila para abrir la ficha nominal"
        accion={<label className="flex items-center gap-2 text-sm">Plazo (h)
          <input type="number" min={1} className="campo w-24" value={plazo} onChange={(e) => setPlazo(Math.max(1, +e.target.value))} /></label>}>
        {q.isError && <Aviso>{(q.error as Error).message}</Aviso>}
        <Tabla filas={datos} clave={(d) => d.diagnostico_id} maxFilas={40} alClic={(d) => navegar(`/leads/ficha?lead=${d.lead_id}&op=${d.oportunidad_id}`)}
          columnas={[
            { titulo: 'Estudiante', celda: (d) => <><div className="font-medium">{d.estudiante}</div><div className="nota">{d.tema_tesis}</div></> },
            { titulo: 'Solicitud', celda: (d) => fechaHora(d.fecha_solicitud) },
            { titulo: 'Entrega', celda: (d) => fechaHora(d.fecha_entrega) },
            { titulo: 'Horas', derecha: true, celda: (d) => Number(d.horas).toLocaleString('es', { maximumFractionDigits: 1 }) },
            { titulo: 'Plazo', celda: (d) => <Chip tono={SIT[d.situacion].tono}>{SIT[d.situacion].t}</Chip> },
            { titulo: 'Responsable', celda: (d) => d.asesor },
            { titulo: 'Oportunidad', celda: (d) => <ChipEstado estado={d.estado_oportunidad} /> },
          ]} />
      </Bloque>
    </div>
  );
}
