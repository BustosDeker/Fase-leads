// Pipeline de oportunidades: kanban por estado con filtros por asesor, canal y grupo de etapa.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { fecha } from '../formato';
import { Aviso, Chip, Encabezado, NOMBRE_ESTADO, ORDEN_ESTADOS, soles } from '../components/ui';

interface Op { oportunidad_id: number; lead_id: number; estado: string; fecha_inicio: string; es_demo: boolean; estudiante: string;
  responsable: string; canal: string | null; carrera: string | null; grupo_etapa: string; desde: string | null; precio: number | null; version: number | null }

const unicos = (xs: (string | null)[]) => [...new Set(xs.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'es'));
const dias = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null);

export function Pipeline() {
  const navegar = useNavigate();
  const q = useQuery({ queryKey: ['pipeline'], queryFn: () => api.get<Op[]>('/api/pipeline') });
  const [f, setF] = useState({ asesor: '', canal: '', etapa: '', texto: '', ocultarCerradas: true });
  const datos = q.data ?? [];
  const filtradas = useMemo(() => datos.filter((o) =>
    (!f.asesor || o.responsable === f.asesor) && (!f.canal || o.canal === f.canal) && (!f.etapa || o.grupo_etapa === f.etapa) &&
    (!f.texto || o.estudiante.toLowerCase().includes(f.texto.toLowerCase()))), [datos, f]);
  const columnas = ORDEN_ESTADOS.filter((e) => !(f.ocultarCerradas && (e === 'DESCARTADA' || e === 'PAYER_CONFIRMADO')));

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-5">
      <Encabezado ruta="Pipeline" titulo="Pipeline de oportunidades">
        <span className="nota">{filtradas.length} de {datos.length} oportunidades</span>
      </Encabezado>
      <section className="tarjeta grid grid-cols-2 gap-3 p-4 md:grid-cols-5" aria-label="Filtros">
        <label className="col-span-2 md:col-span-1"><span className="etiqueta-campo">Estudiante</span>
          <input className="campo" value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} placeholder="Buscar por nombre" /></label>
        <label><span className="etiqueta-campo">Responsable</span>
          <select className="campo" value={f.asesor} onChange={(e) => setF({ ...f, asesor: e.target.value })}>
            <option value="">Todos</option>{unicos(datos.map((o) => o.responsable)).map((x) => <option key={x}>{x}</option>)}</select></label>
        <label><span className="etiqueta-campo">Canal</span>
          <select className="campo" value={f.canal} onChange={(e) => setF({ ...f, canal: e.target.value })}>
            <option value="">Todos</option>{unicos(datos.map((o) => o.canal)).map((x) => <option key={x}>{x}</option>)}</select></label>
        <label><span className="etiqueta-campo">Grupo de etapa</span>
          <select className="campo" value={f.etapa} onChange={(e) => setF({ ...f, etapa: e.target.value })}>
            <option value="">Todos</option>{unicos(datos.map((o) => o.grupo_etapa)).map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="flex min-h-[44px] items-end gap-2 pb-2 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-black" checked={f.ocultarCerradas} onChange={(e) => setF({ ...f, ocultarCerradas: e.target.checked })} />
          Ocultar descartadas y confirmadas</label>
      </section>
      {q.isError && <Aviso>{(q.error as Error).message}</Aviso>}

      <div className="flex gap-3 overflow-x-auto pb-3" role="list" aria-label="Columnas por estado">
        {columnas.map((estado) => {
          const ops = filtradas.filter((o) => o.estado === estado);
          return (
            <section key={estado} role="listitem" className="flex w-72 shrink-0 flex-col rounded-tarjeta border border-linea bg-[#ECECE8]">
              <header className="flex items-center justify-between px-3 py-2.5">
                <h2 className="text-sm font-semibold">{NOMBRE_ESTADO[estado]}</h2>
                <span className="rounded-full bg-white px-2 text-xs font-semibold">{ops.length}</span>
              </header>
              <ul className="flex max-h-[68vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
                {ops.map((o) => {
                  const d = dias(o.desde);
                  return (
                    <li key={o.oportunidad_id}>
                      <button className="tarjeta w-full p-3 text-left hover:border-tinta" onClick={() => navegar(`/leads/ficha?lead=${o.lead_id}&op=${o.oportunidad_id}`)}>
                        <div className="text-sm font-semibold">{o.estudiante}</div>
                        <div className="nota">#{o.oportunidad_id} · {o.carrera ?? 'sin perfil'} · {o.grupo_etapa}</div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          <Chip>{o.responsable}</Chip>{o.canal && <Chip tono="apagado">{o.canal.replace('Redes sociales ', '')}</Chip>}
                        </div>
                        <div className="mt-2 flex justify-between text-xs text-tinta-3">
                          <span>{o.precio ? `${soles(o.precio)} · v${o.version}` : `Inicio ${fecha(o.fecha_inicio)}`}</span>
                          {d !== null && <span>{d} d en el estado</span>}
                        </div>
                      </button>
                    </li>
                  );
                })}
                {ops.length === 0 && <li className="px-2 py-4 nota">Sin oportunidades.</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
