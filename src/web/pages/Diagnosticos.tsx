// Diagnósticos: solicitud y entrega con fechas visibles y semáforo del plazo (48 h por defecto).
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fechaHora } from '../formato';
import { Aviso, BarraFiltros, Bloque, CampoBusqueda, Chip, ChipEstado, Encabezado, Metricas, SelectFiltro, Tabla, coincide, unicos, useFiltros } from '../components/ui';
import { useLiveEvents } from '../hooks/useLiveEvents';

interface Dx { diagnostico_id: number; oportunidad_id: number; lead_id: number; fecha_solicitud: string; fecha_entrega: string | null; estado: string;
  tema_tesis: string | null; tipo_tesis: string | null; requiere_derivacion: boolean; asesor: string; estudiante: string; estado_oportunidad: string;
  horas: number; situacion: 'A_TIEMPO' | 'TARDE' | 'EN_PLAZO' | 'VENCIDO' }

const SIT: Record<Dx['situacion'], { t: string; corto: string; tono: 'bueno' | 'malo' | 'regular' }> = {
  VENCIDO: { t: '■ Pendiente y vencido', corto: 'Vencidos', tono: 'malo' },
  EN_PLAZO: { t: '▲ Pendiente dentro del plazo', corto: 'Pendientes en plazo', tono: 'regular' },
  A_TIEMPO: { t: '● Entregado a tiempo', corto: 'Entregados a tiempo', tono: 'bueno' },
  TARDE: { t: '■ Entregado fuera de plazo', corto: 'Entregados tarde', tono: 'malo' },
};
const ORDEN_SIT: Dx['situacion'][] = ['VENCIDO', 'EN_PLAZO', 'A_TIEMPO', 'TARDE'];

export function Diagnosticos() {
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const { f, fijar, activos, limpiar } = useFiltros({ plazo: '48', situacion: '', texto: '', asesor: '' });
  const plazo = Math.max(1, Number(f.plazo) || 48);
  const q = useQuery({ queryKey: ['diagnosticos', plazo], queryFn: () => api.get<Dx[]>('/api/diagnosticos', { plazo }) });
  useLiveEvents({ oltp: () => cliente.invalidateQueries({ queryKey: ['diagnosticos', plazo] }) });
  const todos = q.data ?? [];
  const datos = useMemo(() => todos.filter((d) => (!f.situacion || d.situacion === f.situacion) && (!f.asesor || d.asesor === f.asesor)
    && coincide(f.texto, d.estudiante, d.tema_tesis, d.oportunidad_id)), [todos, f.situacion, f.asesor, f.texto]);
  const cuenta = (s: string) => todos.filter((d) => d.situacion === s).length;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4">
      <Encabezado ruta="Diagnósticos" titulo="Diagnósticos de tesis" />
      <Metricas items={ORDEN_SIT.map((s) => ({ t: SIT[s].corto, v: cuenta(s), activo: f.situacion === s,
        nota: f.situacion === s ? 'Filtro aplicado · clic para quitar' : 'Clic para filtrar', alClic: () => fijar({ situacion: f.situacion === s ? '' : s }) }))} />
      <BarraFiltros activos={activos} alLimpiar={limpiar}
        resultado={<><strong className="text-tinta">{datos.length}</strong> de {todos.length} solicitudes · plazo de entrega {plazo} h</>}>
        <CampoBusqueda valor={f.texto} alCambiar={(v) => fijar({ texto: v })} placeholder="Estudiante, tema o N.º" />
        <SelectFiltro etiqueta="Situación" valor={f.situacion} alCambiar={(v) => fijar({ situacion: v })} opciones={ORDEN_SIT.map((s) => [s, SIT[s].corto])} />
        <SelectFiltro etiqueta="Responsable" valor={f.asesor} alCambiar={(v) => fijar({ asesor: v })} opciones={unicos(todos.map((d) => d.asesor))} />
        <label><span className="etiqueta-campo">Plazo de entrega (horas)</span>
          <input type="number" min={1} max={720} className="campo" value={f.plazo} onChange={(e) => fijar({ plazo: e.target.value })} /></label>
      </BarraFiltros>
      <Bloque titulo="Solicitudes" origen="Clic en una fila para abrir la ficha nominal (ahí se entrega el diagnóstico y se califica la aptitud)">
        {q.isError && <Aviso>{(q.error as Error).message}</Aviso>}
        <Tabla filas={datos} clave={(d) => d.diagnostico_id} alClic={(d) => navegar(`/leads/ficha?lead=${d.lead_id}&op=${d.oportunidad_id}`)}
          vacio={q.isLoading ? 'Cargando…' : 'Ninguna solicitud coincide con los filtros.'}
          columnas={[
            { titulo: 'Estudiante', orden: (d) => d.estudiante, celda: (d) => <><div className="font-medium">{d.estudiante}</div><div className="nota line-clamp-2 max-w-sm">{d.tema_tesis ?? 'Sin tema'}</div></> },
            { titulo: 'Solicitud', nowrap: true, orden: (d) => +new Date(d.fecha_solicitud), celda: (d) => fechaHora(d.fecha_solicitud) },
            { titulo: 'Entrega', nowrap: true, orden: (d) => (d.fecha_entrega ? +new Date(d.fecha_entrega) : null), celda: (d) => fechaHora(d.fecha_entrega) },
            { titulo: 'Horas', derecha: true, orden: (d) => Number(d.horas), celda: (d) => Number(d.horas).toLocaleString('es', { maximumFractionDigits: 1 }) },
            { titulo: 'Plazo', orden: (d) => ORDEN_SIT.indexOf(d.situacion), celda: (d) => <Chip tono={SIT[d.situacion].tono}>{SIT[d.situacion].t}</Chip> },
            { titulo: 'Responsable', orden: (d) => d.asesor, celda: (d) => d.asesor },
            { titulo: 'Oportunidad', orden: (d) => d.estado_oportunidad, celda: (d) => <ChipEstado estado={d.estado_oportunidad} /> },
          ]} />
      </Bloque>
    </div>
  );
}
