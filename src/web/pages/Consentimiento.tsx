// Consentimiento y privacidad (Ley 29733): estado por contacto, revocación/otorgamiento con registro y evidencia.
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fecha } from '../formato';
import { Aviso, BarraFiltros, Bloque, CampoBusqueda, Chip, Encabezado, SelectFiltro, Segmentos, Tabla, coincide, useFiltros } from '../components/ui';
import { useLiveEvents } from '../hooks/useLiveEvents';

type C = Record<string, any>;
const estadoDe = (c: C) => (c.no_contactar ? 'revocado' : c.consentimiento_contacto ? 'vigente' : 'sin');

export function Consentimiento() {
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const { f, fijar, activos, limpiar } = useFiltros({ estado: '', texto: '', datos: '' });
  const q = useQuery({ queryKey: ['consentimientos'], queryFn: () => api.get<C[]>('/api/consentimientos') });
  useLiveEvents({ oltp: () => cliente.invalidateQueries({ queryKey: ['consentimientos'] }) });
  const cambiar = useMutation({
    mutationFn: ({ id, accion }: { id: number; accion: 'OTORGA' | 'REVOCA' }) =>
      api.post(`/api/contactos/${id}/consentimiento`, { accion, evidencia: accion === 'REVOCA' ? 'Revocado desde el panel a pedido del titular' : 'Otorgado desde el panel con confirmación del titular' }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['consentimientos'] }),
  });
  const todos = q.data ?? [];
  const base = useMemo(() => todos.filter((c) => (!f.datos || (f.datos === 'prueba' ? c.es_demo : !c.es_demo)) && coincide(f.texto, c.nombre, c.whatsapp)),
    [todos, f.datos, f.texto]);
  const datos = base.filter((c) => !f.estado || estadoDe(c) === f.estado);
  const n = (e: string) => base.filter((c) => estadoDe(c) === e).length;
  const confirmar = (c: C, accion: 'OTORGA' | 'REVOCA') => {
    const txt = accion === 'REVOCA' ? `¿Revocar el consentimiento de ${c.nombre}? El agente dejará de escribirle.`
      : `¿Registrar un nuevo consentimiento de ${c.nombre}? Hazlo solo con su confirmación expresa.`;
    if (window.confirm(txt)) cambiar.mutate({ id: c.contacto_id, accion });
  };

  return (
    <div className="mx-auto flex max-w-[1300px] flex-col gap-4">
      <Encabezado ruta="Consentimiento" titulo="Consentimiento y privacidad" />
      <Aviso tipo="info">Ley 29733: el agente solo escribe a contactos con consentimiento vigente. Quien pide «no me escriban» queda revocado y deja de recibir mensajes.</Aviso>
      {cambiar.isError && <Aviso>{(cambiar.error as Error).message}</Aviso>}
      <Segmentos etiqueta="Estado del consentimiento" valor={f.estado} alCambiar={(v) => fijar({ estado: v })} opciones={[
        { v: '', t: 'Todos', n: base.length }, { v: 'vigente', t: '● Vigentes', n: n('vigente') },
        { v: 'sin', t: '▲ Sin consentimiento', n: n('sin') }, { v: 'revocado', t: '■ Revocados', n: n('revocado') }]} />
      <BarraFiltros activos={activos} alLimpiar={limpiar} resultado={<><strong className="text-tinta">{datos.length}</strong> de {todos.length} contactos</>}>
        <CampoBusqueda valor={f.texto} alCambiar={(v) => fijar({ texto: v })} placeholder="Nombre o WhatsApp" />
        <SelectFiltro etiqueta="Datos" valor={f.datos} alCambiar={(v) => fijar({ datos: v })} opciones={[['reales', 'Solo reales'], ['prueba', 'Solo de prueba']]} />
      </BarraFiltros>
      <Bloque titulo="Contactos" origen="CONTACTO y CONSENTIMIENTO_HISTORIAL · cada cambio queda registrado con fecha y evidencia">
        {q.isError && <Aviso>{(q.error as Error).message}</Aviso>}
        <Tabla filas={datos} clave={(c) => c.contacto_id} vacio={q.isLoading ? 'Cargando…' : 'Ningún contacto coincide con los filtros.'}
          columnas={[
            { titulo: 'Contacto', orden: (c) => c.nombre, celda: (c) => <><div className="font-medium">{c.nombre}</div>
              <div className="nota">{c.whatsapp ? `+${c.whatsapp}` : 'sin WhatsApp'}{c.es_demo ? ' · dato de prueba' : ''}</div></> },
            { titulo: 'Estado', orden: (c) => estadoDe(c), celda: (c) => c.no_contactar ? <Chip tono="malo">■ Revocado {fecha(c.fecha_revocacion)}</Chip>
              : c.consentimiento_contacto ? <Chip tono="bueno">● Vigente desde {fecha(c.fecha_consentimiento)}</Chip> : <Chip tono="regular">▲ Sin consentimiento</Chip> },
            { titulo: 'Registros', derecha: true, orden: (c) => c.registros, celda: (c) => c.registros },
            { titulo: 'Acciones', celda: (c) => <div className="flex flex-wrap justify-end gap-2">
              {c.no_contactar
                ? <button className="boton-claro" disabled={cambiar.isPending} onClick={() => confirmar(c, 'OTORGA')}>Nuevo consentimiento</button>
                : <button className="boton-claro" disabled={cambiar.isPending} onClick={() => confirmar(c, 'REVOCA')}>Revocar</button>}
              {c.lead_id && <button className="boton-claro" onClick={() => navegar(`/leads/ficha?lead=${c.lead_id}`)}>Ficha</button>}</div> },
          ]} />
      </Bloque>
    </div>
  );
}
