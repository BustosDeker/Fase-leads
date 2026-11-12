// Agenda de citas virtuales por asesor (opcionales): semana, estados, solapamientos y alta de citas sin choques.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { aInputLocal } from '../formato';
import { Aviso, Bloque, Chip, Encabezado } from '../components/ui';

interface Cita { cita_id: number; oportunidad_id: number; lead_id: number; asesor_id: number; asesor: string; inicio: string; fin: string;
  medio: string; estado: string; estudiante: string; solapada: number }
interface Agenda { citas: Cita[]; asesores: { asesor_id: number; nombre: string; rol: string }[]; rango: { primera: string | null; ultima: string | null } }

const SIGUIENTE: Record<string, string[]> = { SOLICITADA: ['CONFIRMADA', 'CANCELADA'], CONFIRMADA: ['REALIZADA', 'NO_ASISTIO', 'CANCELADA'] };
const NOMBRE: Record<string, string> = { SOLICITADA: 'Solicitada', CONFIRMADA: 'Confirmada', REALIZADA: 'Realizada', CANCELADA: 'Cancelada', NO_ASISTIO: 'No asistió' };
const lunes = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false });

export function Agenda() {
  const [params] = useSearchParams();
  const opParam = Number(params.get('op')) || null;
  const cliente = useQueryClient();
  const [inicioSemana, setInicioSemana] = useState(() => lunes(new Date()));
  const [asesor, setAsesor] = useState('');
  const [estadoCita, setEstadoCita] = useState('');
  const [medio, setMedio] = useState('');
  const fin = new Date(inicioSemana.getTime() + 7 * 86_400_000);
  const q = useQuery({ queryKey: ['agenda', inicioSemana.toISOString()],
    queryFn: () => api.get<Agenda>('/api/agenda', { desde: inicioSemana.toISOString(), hasta: fin.toISOString() }) });
  const citas = useMemo(() => (q.data?.citas ?? []).filter((c) => (!asesor || String(c.asesor_id) === asesor)
    && (!estadoCita || c.estado === estadoCita) && (!medio || c.medio === medio)), [q.data, asesor, estadoCita, medio]);
  const totalSemana = q.data?.citas.length ?? 0;
  const filtrosActivos = [asesor, estadoCita, medio].filter(Boolean).length;
  const solapadas = citas.filter((c) => c.solapada);

  const [nueva, setNueva] = useState({ oportunidadId: opParam ?? 0, asesorId: 0, inicio: aInputLocal(new Date(Date.now() + 86_400_000)), duracionMin: 45, medio: 'Google Meet' });
  const crear = useMutation({
    mutationFn: () => api.post<{ citaId: number }>('/api/agenda/citas', { ...nueva, inicio: new Date(nueva.inicio).toISOString() }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['agenda'] }),
  });
  const estado = useMutation({
    mutationFn: ({ id, e }: { id: number; e: string }) => api.post(`/api/agenda/citas/${id}/estado`, { estado: e, causa: `Marcada como ${NOMBRE[e].toLowerCase()} por el asesor` }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['agenda'] }),
  });
  const irA = (iso: string | null) => iso && setInicioSemana(lunes(new Date(iso)));

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
      <Encabezado ruta="Agenda" titulo="Agenda de citas virtuales">
        <div className="flex flex-wrap gap-2">
          <button className="boton-claro" onClick={() => setInicioSemana(new Date(inicioSemana.getTime() - 7 * 86_400_000))}>‹ Semana anterior</button>
          <button className="boton-claro" onClick={() => setInicioSemana(lunes(new Date()))}>Hoy</button>
          <button className="boton-claro" onClick={() => setInicioSemana(new Date(inicioSemana.getTime() + 7 * 86_400_000))}>Semana siguiente ›</button>
          <button className="boton-claro" onClick={() => irA(q.data?.rango.ultima ?? null)}>Última cita registrada</button>
        </div>
      </Encabezado>

      <section className="tarjeta flex flex-wrap items-end gap-3 p-4">
        <div className="text-sm font-semibold">Semana del {inicioSemana.toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
        <span className="nota">{citas.length} de {totalSemana} citas esta semana</span>
        <label className="ml-auto w-full sm:w-60"><span className="etiqueta-campo">Asesor</span>
          <select className={`campo ${asesor ? 'border-tinta font-medium' : ''}`} value={asesor} onChange={(e) => setAsesor(e.target.value)}>
            <option value="">Todos</option>{q.data?.asesores.map((a) => <option key={a.asesor_id} value={a.asesor_id}>{a.nombre}</option>)}</select></label>
        <label className="w-full sm:w-44"><span className="etiqueta-campo">Estado</span>
          <select className={`campo ${estadoCita ? 'border-tinta font-medium' : ''}`} value={estadoCita} onChange={(e) => setEstadoCita(e.target.value)}>
            <option value="">Todos</option>{Object.entries(NOMBRE).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
        <label className="w-full sm:w-48"><span className="etiqueta-campo">Medio</span>
          <select className={`campo ${medio ? 'border-tinta font-medium' : ''}`} value={medio} onChange={(e) => setMedio(e.target.value)}>
            <option value="">Todos</option><option>Google Meet</option><option>Zoom</option><option>Llamada de WhatsApp</option></select></label>
        {filtrosActivos > 0 && <button type="button" className="min-h-[44px] text-sm font-semibold underline-offset-2 hover:underline"
          onClick={() => { setAsesor(''); setEstadoCita(''); setMedio(''); }}>✕ Limpiar ({filtrosActivos})</button>}
      </section>

      {solapadas.length > 0 && <Aviso>{solapadas.length} citas solapadas esta semana (mismo asesor y horario). Revísalas en Auditoría.</Aviso>}
      {q.isError && <Aviso>{(q.error as Error).message}</Aviso>}
      {estado.isError && <Aviso>{(estado.error as Error).message}</Aviso>}

      <div className="overflow-x-auto">
        <div className="grid min-w-[980px] grid-cols-7 gap-2">
          {DIAS.map((dn, i) => {
            const dia = new Date(inicioSemana.getTime() + i * 86_400_000);
            const delDia = citas.filter((c) => new Date(c.inicio).toDateString() === dia.toDateString());
            const esHoy = dia.toDateString() === new Date().toDateString();
            return (
              <section key={dn} className={`tarjeta flex min-h-[260px] flex-col p-2 ${esHoy ? 'border-tinta' : ''}`} aria-label={dia.toLocaleDateString('es-PE')}>
                <h2 className="px-1 pb-2 text-xs font-semibold text-tinta-3">{dn} {dia.getDate()}{esHoy ? ' · hoy' : ''}</h2>
                <ul className="flex flex-col gap-2">
                  {delDia.map((c) => (
                    <li key={c.cita_id} className={`rounded-lg border p-2 text-xs ${c.solapada ? 'border-2 border-malo-marca bg-malo-fondo' : c.estado === 'CANCELADA' ? 'border-linea bg-fondo text-tinta-3' : 'border-linea-fuerte bg-white'}`}>
                      <div className="font-semibold">{hora(c.inicio)}–{hora(c.fin)}</div>
                      <Link className="underline-offset-2 hover:underline" to={`/leads/ficha?lead=${c.lead_id}&op=${c.oportunidad_id}`}>{c.estudiante}</Link>
                      <div className="text-tinta-3">{c.asesor} · {c.medio}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Chip tono={c.estado === 'REALIZADA' ? 'bueno' : c.estado === 'NO_ASISTIO' ? 'malo' : c.estado === 'CANCELADA' ? 'apagado' : 'neutro'}>{NOMBRE[c.estado]}</Chip>
                        {c.solapada ? <Chip tono="malo">■ Solapada</Chip> : null}
                      </div>
                      {SIGUIENTE[c.estado] && (
                        <select className="mt-1 w-full rounded border border-linea-fuerte bg-white p-1" value="" aria-label="Cambiar estado"
                          onChange={(e) => e.target.value && estado.mutate({ id: c.cita_id, e: e.target.value })}>
                          <option value="">Cambiar estado…</option>{SIGUIENTE[c.estado].map((x) => <option key={x} value={x}>{NOMBRE[x]}</option>)}</select>
                      )}
                    </li>
                  ))}
                  {delDia.length === 0 && <li className="px-1 nota">—</li>}
                </ul>
              </section>
            );
          })}
        </div>
      </div>

      <Bloque titulo="Agendar cita" origen="Opcional: la conversación puede seguir por WhatsApp. El sistema impide solapamientos por asesor.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <label><span className="etiqueta-campo">N.º de oportunidad</span>
            <input type="number" className="campo" value={nueva.oportunidadId || ''} onChange={(e) => setNueva({ ...nueva, oportunidadId: +e.target.value })} /></label>
          <label><span className="etiqueta-campo">Asesor</span>
            <select className="campo" value={nueva.asesorId} onChange={(e) => setNueva({ ...nueva, asesorId: +e.target.value })}>
              <option value={0}>Elegir…</option>{q.data?.asesores.map((a) => <option key={a.asesor_id} value={a.asesor_id}>{a.nombre}</option>)}</select></label>
          <label><span className="etiqueta-campo">Inicio</span>
            <input type="datetime-local" className="campo" value={nueva.inicio} onChange={(e) => setNueva({ ...nueva, inicio: e.target.value })} /></label>
          <label><span className="etiqueta-campo">Duración (min)</span>
            <input type="number" min={15} max={180} step={15} className="campo" value={nueva.duracionMin} onChange={(e) => setNueva({ ...nueva, duracionMin: +e.target.value })} /></label>
          <label><span className="etiqueta-campo">Medio</span>
            <select className="campo" value={nueva.medio} onChange={(e) => setNueva({ ...nueva, medio: e.target.value })}>
              <option>Google Meet</option><option>Zoom</option><option>Llamada de WhatsApp</option></select></label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="boton-negro" disabled={!nueva.oportunidadId || !nueva.asesorId || crear.isPending} onClick={() => crear.mutate()}>Agendar</button>
          {crear.isError && <Aviso>{(crear.error as Error).message}</Aviso>}
          {crear.data && <Aviso tipo="ok">Cita #{crear.data.citaId} registrada como solicitada.</Aviso>}
        </div>
      </Bloque>
    </div>
  );
}
