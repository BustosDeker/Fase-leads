// Objeciones y escalamientos: cola de casos para una persona (con resumen del agente), objeciones clasificadas
// por grupo/tipo con su resultado, y el catálogo de respuestas respaldadas. Filtros en la URL.
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fechaHora } from '../formato';
import { Aviso, BarraFiltros, Bloque, CampoBusqueda, Chip, Encabezado, SelectFiltro, Segmentos, Tabla, coincide, unicos, useFiltros } from '../components/ui';
import { useLiveEvents } from '../hooks/useLiveEvents';

type F = Record<string, any>;
const motivo = (m: string) => m.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
const resultadoDe = (o: F) => (o.estado === 'RESUELTA' ? 'recuperada' : o.escalada ? 'escalada' : 'pendiente');

export function Objeciones() {
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const { f, fijar, activos } = useFiltros({ vista: 'cola', texto: '', grupo: '', resultado: '', destino: '' });
  const q = useQuery({ queryKey: ['objeciones'], queryFn: () => api.get<{ objeciones: F[]; escalamientos: F[]; catalogo: F[] }>('/api/objeciones') });
  useLiveEvents({ oltp: () => cliente.invalidateQueries({ queryKey: ['objeciones'] }) });
  const atender = useMutation({ mutationFn: (id: number) => api.post(`/api/escalamientos/${id}/atender`), onSuccess: () => cliente.invalidateQueries({ queryKey: ['objeciones'] }) });
  const ficha = (x: F) => x.lead_id && navegar(`/leads/ficha?lead=${x.lead_id}&op=${x.oportunidad_id ?? ''}`);

  const esc = q.data?.escalamientos ?? [];
  const pendientes = useMemo(() => esc.filter((e) => !e.fecha_atencion && (!f.destino || e.destino_rol === f.destino)
    && coincide(f.texto, e.estudiante, e.motivo, e.resumen)), [esc, f.destino, f.texto]);
  const objs = q.data?.objeciones ?? [];
  const objFiltradas = useMemo(() => objs.filter((o) => (!f.grupo || o.grupo === f.grupo) && (!f.resultado || resultadoDe(o) === f.resultado)
    && coincide(f.texto, o.estudiante, o.tipo, o.grupo)), [objs, f.grupo, f.resultado, f.texto]);
  const nRes = (r: string) => objs.filter((o) => resultadoDe(o) === r).length;
  const totalPendientes = esc.filter((e) => !e.fecha_atencion).length;
  const nFiltros = activos - (f.vista !== 'cola' ? 1 : 0);

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4">
      <Encabezado ruta="Objeciones y escalamientos" titulo="Objeciones y escalamientos" />
      {q.isError && <Aviso>{(q.error as Error).message}</Aviso>}
      {atender.isError && <Aviso>{(atender.error as Error).message}</Aviso>}
      <Segmentos etiqueta="Sección" valor={f.vista} alCambiar={(v) => fijar({ vista: v })} opciones={[
        { v: 'cola', t: 'Cola de atención', n: totalPendientes }, { v: 'objeciones', t: 'Objeciones', n: objs.length },
        { v: 'catalogo', t: 'Catálogo de respuestas', n: q.data?.catalogo.length }]} />

      {f.vista !== 'catalogo' && (
        <BarraFiltros activos={nFiltros} alLimpiar={() => fijar({ texto: '', grupo: '', resultado: '', destino: '' })}
          resultado={f.vista === 'cola' ? <><strong className="text-tinta">{pendientes.length}</strong> casos pendientes</>
            : <><strong className="text-tinta">{objFiltradas.length}</strong> de {objs.length} objeciones · {nRes('recuperada')} recuperadas</>}>
          <CampoBusqueda valor={f.texto} alCambiar={(v) => fijar({ texto: v })} placeholder={f.vista === 'cola' ? 'Estudiante, motivo o resumen' : 'Estudiante o tipo'} />
          {f.vista === 'cola' ? (
            <SelectFiltro etiqueta="Derivado a" valor={f.destino} alCambiar={(v) => fijar({ destino: v })}
              opciones={unicos(esc.map((e) => e.destino_rol)).map((d) => [d, d.charAt(0) + d.slice(1).toLowerCase()])} />
          ) : <>
            <SelectFiltro etiqueta="Grupo" valor={f.grupo} alCambiar={(v) => fijar({ grupo: v })} opciones={unicos(objs.map((o) => o.grupo))} />
            <SelectFiltro etiqueta="Resultado" valor={f.resultado} alCambiar={(v) => fijar({ resultado: v })}
              opciones={[['pendiente', `Pendientes (${nRes('pendiente')})`], ['escalada', `Escaladas (${nRes('escalada')})`], ['recuperada', `Recuperadas (${nRes('recuperada')})`]]} />
          </>}
        </BarraFiltros>
      )}

      {f.vista === 'cola' && (
        <Bloque titulo="Casos que esperan a una persona" origen="El agente deriva: precio no configurado, excepciones, consultas académicas complejas, descuentos fuera de tope y objeciones repetidas">
          {pendientes.length === 0 && <p className="py-6 text-center nota">{q.isLoading ? 'Cargando…' : '● No hay casos pendientes con estos filtros.'}</p>}
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {pendientes.map((e) => (
              <li key={e.escalamiento_id} className="flex flex-col rounded-lg border border-linea-fuerte border-l-4 border-l-malo-marca bg-white p-4">
                <div className="flex flex-wrap items-center gap-2"><Chip tono="malo">■ Pendiente</Chip><strong>{motivo(e.motivo)}</strong></div>
                <p className="nota mt-1">→ {e.destino_rol.toLowerCase()} · {fechaHora(e.fecha)}</p>
                <p className="mt-2 text-sm"><span className="text-tinta-3">Estudiante: </span><span className="font-medium">{e.estudiante ?? '—'}</span></p>
                <p className="mt-1 flex-1 text-sm text-tinta-2"><span className="text-tinta-3">Resumen del agente: </span>{e.resumen ?? 'Sin resumen.'}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="boton-negro" disabled={atender.isPending} onClick={() => atender.mutate(e.escalamiento_id)}>Marcar atendido</button>
                  {e.lead_id && <button className="boton-claro" onClick={() => ficha(e)}>Ver ficha</button>}
                </div>
              </li>
            ))}
          </ul>
        </Bloque>
      )}

      {f.vista === 'objeciones' && (
        <Bloque titulo="Objeciones registradas" origen="Clasificadas por grupo y tipo · clic en una fila para abrir la ficha">
          <Tabla filas={objFiltradas} clave={(o) => o.objecion_id} alClic={ficha} vacio={q.isLoading ? 'Cargando…' : 'Ninguna objeción coincide con los filtros.'}
            columnas={[
              { titulo: 'Estudiante', orden: (o) => o.estudiante, celda: (o) => <><div className="font-medium">{o.estudiante}</div><div className="nota">sobre la versión {o.version}</div></> },
              { titulo: 'Fecha', orden: (o) => +new Date(o.fecha_registro), celda: (o) => fechaHora(o.fecha_registro) },
              { titulo: 'Grupo / tipo', orden: (o) => `${o.grupo} ${o.tipo}`, celda: (o) => <><div className="font-medium">{o.grupo}</div><div className="nota">{o.tipo}</div></> },
              { titulo: 'Respuesta del agente', ancho: 'w-[36%]', celda: (o) => <span className="line-clamp-3 text-tinta-2">{o.respuesta_agente ?? '—'}</span> },
              { titulo: 'Resultado', orden: (o) => resultadoDe(o), celda: (o) => <div className="flex flex-col items-start gap-1">
                <Chip tono={o.estado === 'RESUELTA' ? 'bueno' : 'regular'}>{o.estado === 'RESUELTA' ? '● Recuperada' : '▲ Pendiente'}</Chip>
                {o.escalada && <Chip tono="malo">■ Escalada ({o.veces_repetida}×)</Chip>}</div> },
            ]} />
        </Bloque>
      )}

      {f.vista === 'catalogo' && (
        <Bloque titulo="Catálogo de objeciones" origen="CATALOGO_OBJECION (editable en la base de datos): respuesta base respaldada y criterio de escalamiento">
          <Tabla filas={q.data?.catalogo ?? []} clave={(c) => `${c.grupo}/${c.tipo}`}
            columnas={[
              { titulo: 'Grupo / tipo', orden: (c) => `${c.grupo} ${c.tipo}`, celda: (c) => <><div className="font-medium">{c.grupo}</div><div className="nota">{c.tipo}</div></> },
              { titulo: 'Respuesta base', ancho: 'w-[45%]', celda: (c) => <span className="text-tinta-2">{c.respuesta_base}</span> },
              { titulo: 'Criterio de escalamiento', celda: (c) => <span className="text-tinta-2">{c.criterio_escalamiento ?? `Escalar si se repite ${c.max_repeticiones} veces`}</span> },
            ]} />
        </Bloque>
      )}
    </div>
  );
}
