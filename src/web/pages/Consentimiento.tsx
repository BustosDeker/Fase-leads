// Consentimiento y privacidad (Ley 29733): estado por contacto, revocación/otorgamiento con registro y evidencia.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fecha } from '../formato';
import { Aviso, Bloque, Chip, Encabezado, Tabla } from '../components/ui';

type C = Record<string, any>;

export function Consentimiento() {
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const [texto, setTexto] = useState('');
  const [solo, setSolo] = useState('');
  const q = useQuery({ queryKey: ['consentimientos'], queryFn: () => api.get<C[]>('/api/consentimientos') });
  const cambiar = useMutation({
    mutationFn: ({ id, accion }: { id: number; accion: 'OTORGA' | 'REVOCA' }) =>
      api.post(`/api/contactos/${id}/consentimiento`, { accion, evidencia: accion === 'REVOCA' ? 'Revocado desde el panel a pedido del titular' : 'Otorgado desde el panel con confirmación del titular' }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['consentimientos'] }),
  });
  const datos = (q.data ?? []).filter((c) => (!texto || `${c.nombre} ${c.whatsapp}`.toLowerCase().includes(texto.toLowerCase()))
    && (!solo || (solo === 'revocado' ? c.no_contactar : !c.no_contactar)));
  const revocados = (q.data ?? []).filter((c) => c.no_contactar).length;

  return (
    <div className="mx-auto flex max-w-[1300px] flex-col gap-5">
      <Encabezado ruta="Consentimiento" titulo="Consentimiento y privacidad" />
      <Aviso tipo="info">Ley 29733: el agente solo envía seguimientos a contactos con consentimiento vigente. Quien escribe «STOP», «BAJA» o «NO MÁS» queda con no contactar y deja de recibir mensajes proactivos.</Aviso>
      {cambiar.isError && <Aviso>{(cambiar.error as Error).message}</Aviso>}
      <Bloque titulo={`Contactos (${(q.data ?? []).length}) · ${revocados} con consentimiento revocado`} origen="CONTACTO y CONSENTIMIENTO_HISTORIAL"
        accion={<div className="flex flex-wrap gap-2">
          <input className="campo w-56" placeholder="Buscar nombre o WhatsApp" value={texto} onChange={(e) => setTexto(e.target.value)} />
          <select className="campo w-44" value={solo} onChange={(e) => setSolo(e.target.value)} aria-label="Estado">
            <option value="">Todos</option><option value="vigente">Vigente</option><option value="revocado">Revocado</option></select></div>}>
        <Tabla filas={datos} clave={(c) => c.contacto_id} maxFilas={30}
          columnas={[
            { titulo: 'Contacto', celda: (c) => <><div className="font-medium">{c.nombre}</div><div className="nota">{c.whatsapp ?? 'sin WhatsApp'}{c.es_demo ? ' · dato de prueba' : ''}</div></> },
            { titulo: 'Estado', celda: (c) => c.no_contactar ? <Chip tono="malo">■ Revocado {fecha(c.fecha_revocacion)}</Chip>
              : c.consentimiento_contacto ? <Chip tono="bueno">● Vigente desde {fecha(c.fecha_consentimiento)}</Chip> : <Chip tono="regular">▲ Sin consentimiento</Chip> },
            { titulo: 'Registros', derecha: true, celda: (c) => c.registros },
            { titulo: 'Acciones', celda: (c) => <div className="flex flex-wrap gap-2">
              {c.no_contactar
                ? <button className="boton-claro" disabled={cambiar.isPending} onClick={() => cambiar.mutate({ id: c.contacto_id, accion: 'OTORGA' })}>Registrar nuevo consentimiento</button>
                : <button className="boton-claro" disabled={cambiar.isPending} onClick={() => cambiar.mutate({ id: c.contacto_id, accion: 'REVOCA' })}>Revocar</button>}
              {c.lead_id && <button className="boton-claro" onClick={() => navegar(`/leads/ficha?lead=${c.lead_id}`)}>Ficha</button>}</div> },
          ]} />
      </Bloque>
    </div>
  );
}
