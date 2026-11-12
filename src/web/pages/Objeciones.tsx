// Objeciones y escalamientos: clasificación (grupo/tipo), respuesta del agente y cola de casos para humano con resumen.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fechaHora } from '../formato';
import { Aviso, Bloque, Chip, Encabezado, Tabla } from '../components/ui';

type F = Record<string, any>;
const motivo = (m: string) => m.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

export function Objeciones() {
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const [grupo, setGrupo] = useState('');
  const q = useQuery({ queryKey: ['objeciones'], queryFn: () => api.get<{ objeciones: F[]; escalamientos: F[]; catalogo: F[] }>('/api/objeciones') });
  const atender = useMutation({ mutationFn: (id: number) => api.post(`/api/escalamientos/${id}/atender`), onSuccess: () => cliente.invalidateQueries({ queryKey: ['objeciones'] }) });
  const pendientes = (q.data?.escalamientos ?? []).filter((e) => !e.fecha_atencion);
  const objs = (q.data?.objeciones ?? []).filter((o) => !grupo || o.grupo === grupo);
  const grupos = [...new Set((q.data?.objeciones ?? []).map((o) => o.grupo as string))].sort();

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <Encabezado ruta="Objeciones y escalamientos" titulo="Objeciones y escalamientos" />
      {q.isError && <Aviso>{(q.error as Error).message}</Aviso>}
      {atender.isError && <Aviso>{(atender.error as Error).message}</Aviso>}

      <Bloque titulo={`Cola para atención humana (${pendientes.length} pendientes)`} origen="LEADS · ESCALAMIENTO · el agente deriva precio no configurado, excepciones, consultas académicas complejas y objeciones repetidas">
        {pendientes.length === 0 && <p className="nota">● No hay casos pendientes.</p>}
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {pendientes.map((e) => (
            <li key={e.escalamiento_id} className="rounded-lg border-2 border-malo-marca/50 p-4">
              <div className="flex flex-wrap items-center gap-2"><Chip tono="malo">■ Pendiente</Chip><strong>{motivo(e.motivo)}</strong>
                <span className="nota">→ {e.destino_rol.toLowerCase()} · {fechaHora(e.fecha)}</span></div>
              <p className="mt-2 text-sm"><span className="text-tinta-3">Estudiante: </span>{e.estudiante ?? '—'}</p>
              <p className="mt-1 text-sm text-tinta-2"><span className="text-tinta-3">Resumen para el especialista: </span>{e.resumen ?? 'Sin resumen.'}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="boton-negro" disabled={atender.isPending} onClick={() => atender.mutate(e.escalamiento_id)}>Marcar atendido</button>
                {e.lead_id && <button className="boton-claro" onClick={() => navegar(`/leads/ficha?lead=${e.lead_id}&op=${e.oportunidad_id ?? ''}`)}>Ver ficha</button>}
              </div>
            </li>
          ))}
        </ul>
      </Bloque>

      <Bloque titulo="Objeciones registradas" origen="LEADS · OBJECION · clasificadas por grupo y tipo"
        accion={<select className="campo w-56" value={grupo} onChange={(e) => setGrupo(e.target.value)} aria-label="Grupo">
          <option value="">Todos los grupos</option>{grupos.map((g) => <option key={g}>{g}</option>)}</select>}>
        <Tabla filas={objs} clave={(o) => o.objecion_id} maxFilas={30} alClic={(o) => navegar(`/leads/ficha?lead=${o.lead_id}&op=${o.oportunidad_id}`)}
          columnas={[
            { titulo: 'Estudiante', celda: (o) => <><div className="font-medium">{o.estudiante}</div><div className="nota">sobre la versión {o.version} · {fechaHora(o.fecha_registro)}</div></> },
            { titulo: 'Grupo / tipo', celda: (o) => <><div className="font-medium">{o.grupo}</div><div className="nota">{o.tipo}</div></> },
            { titulo: 'Respuesta del agente', ancho: 'w-[40%]', celda: (o) => <span className="text-tinta-2">{o.respuesta_agente ?? '—'}</span> },
            { titulo: 'Resultado', celda: (o) => <div className="flex flex-col items-start gap-1">
              <Chip tono={o.estado === 'RESUELTA' ? 'bueno' : 'regular'}>{o.estado === 'RESUELTA' ? '● Recuperada' : '▲ Pendiente'}</Chip>
              {o.escalada && <Chip tono="malo">■ Escalada ({o.veces_repetida}×)</Chip>}</div> },
          ]} />
      </Bloque>

      <Bloque titulo="Catálogo de objeciones" origen="CATALOGO_OBJECION (editable en la base de datos): respuesta base respaldada y criterio de escalamiento">
        <Tabla filas={q.data?.catalogo ?? []} clave={(c) => `${c.grupo}/${c.tipo}`}
          columnas={[
            { titulo: 'Grupo / tipo', celda: (c) => <><div className="font-medium">{c.grupo}</div><div className="nota">{c.tipo}</div></> },
            { titulo: 'Respuesta base', ancho: 'w-[45%]', celda: (c) => <span className="text-tinta-2">{c.respuesta_base}</span> },
            { titulo: 'Criterio de escalamiento', celda: (c) => <span className="text-tinta-2">{c.criterio_escalamiento ?? `Escalar si se repite ${c.max_repeticiones} veces`}</span> },
          ]} />
      </Bloque>
    </div>
  );
}
