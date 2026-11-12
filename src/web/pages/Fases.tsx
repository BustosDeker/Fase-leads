// Fases vecinas del embudo IMPULSE: BUYERS (entrega leads a LEADS), PAYERS (recibe acuerdos y confirma),
// CUSTOMERS y TURNED (fuera del alcance de este proyecto). Cada una muestra su contrato con LEADS y un simulador.
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fechaHora } from '../formato';
import { useLiveEvents } from '../hooks/useLiveEvents';
import { Aviso, Bloque, CampoBusqueda, Chip, ChipEstado, Encabezado, Segmentos, Tabla, coincide, soles, useFiltros } from '../components/ui';

type F = Record<string, any>;

export function Fase() {
  const { fase } = useParams();
  if (fase === 'buyers') return <Buyers />;
  if (fase === 'payers') return <Payers />;
  const info = fase === 'customers'
    ? { t: 'CUSTOMERS', d: 'Acompañamiento del estudiante ya contratado: asignación del asesor académico, sesiones, hitos del cronograma, observaciones de la universidad y reportes de calidad.' }
    : { t: 'TURNED', d: 'Cierre del servicio y fidelización: encuesta de satisfacción, certificado de garantía y referidos que vuelven a BUYERS.' };
  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-5">
      <Encabezado fase={info.t} ruta="Resumen" titulo={info.t} />
      <Bloque titulo="Fuera del alcance de este proyecto" origen="Metodología IMPULSE · fase a cargo de otro equipo">
        <p className="text-sm text-tinta-2">{info.d}</p>
        <p className="mt-3 text-sm text-tinta-2">LEADS entrega a PAYERS los acuerdos aceptados; PAYERS confirma la contratación y, desde ahí, el estudiante pasa a {info.t === 'CUSTOMERS' ? 'esta fase' : 'CUSTOMERS y luego a esta fase'}. Las tablas de la base de datos ya existen en el modelo del informe, pero sus pantallas las construye el equipo responsable.</p>
      </Bloque>
    </div>
  );
}

// ------------------------------------------------------------------ BUYERS
function Buyers() {
  const navegar = useNavigate();
  const [f, setF] = useState({ nombres: '', apellidos: '', whatsapp: '', canal: 'Instagram', evidencia: 'Aceptó la política de datos en el formulario' });
  const crear = useMutation({ mutationFn: () => api.post<F>('/api/simulador/buyers', {
    nombres: f.nombres, apellidos: f.apellidos, whatsapp: f.whatsapp, canal: f.canal || undefined,
    consentimiento: { otorgado: true, evidencia: f.evidencia } }) });
  const campo = (k: keyof typeof f, etiqueta: string, extra: F = {}) => (
    <label><span className="etiqueta-campo">{etiqueta}</span><input className="campo" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></label>);
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <Encabezado fase="BUYERS" ruta="Integración con LEADS" titulo="BUYERS → LEADS" />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Bloque titulo="Cómo funciona la integración" origen="BUYERS envía cada lead con su consentimiento (Ley 29733). Sin consentimiento, LEADS lo rechaza.">
          <ul className="flex flex-col gap-1 text-sm text-tinta-2">
            <li>• Idempotente por número de WhatsApp: reenviar el mismo lead no lo duplica.</li>
            <li>• Crea contacto, buyer, lead y oportunidad «Abierta», y guarda el consentimiento en el historial con medio BUYERS.</li>
            <li>• BUYERS solo aporta nombre, WhatsApp, canal y consentimiento; universidad, carrera, etapa y demás datos los obtiene el agente en la conversación.</li>
            <li>• Cuando ese estudiante escriba por WhatsApp, el agente continúa sobre su oportunidad sin volver a pedir el consentimiento ni la frase de activación.</li>
          </ul>
        </Bloque>
        <Bloque titulo="Simulador de BUYERS" origen="Envía un lead como lo haría BUYERS (se marca como dato de prueba)">
          <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); crear.mutate(); }}>
            {campo('nombres', 'Nombres', { required: true, minLength: 2 })}
            {campo('apellidos', 'Apellidos', { required: true, minLength: 2 })}
            {campo('whatsapp', 'WhatsApp (con 51)', { required: true, inputMode: 'numeric', placeholder: '51987654321' })}
            {campo('canal', 'Canal de captación', { list: 'canales' })}
            <datalist id="canales"><option>Instagram</option><option>TikTok</option><option>Facebook</option><option>Referidos</option><option>Convenio universitario</option></datalist>
            {campo('evidencia', 'Evidencia del consentimiento', { required: true })}
            <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
              <button className="boton-negro" disabled={crear.isPending}>Enviar lead a LEADS</button>
              {crear.data && <span className="text-sm">{crear.data.creado ? '● Lead creado' : 'ⓘ Ese WhatsApp ya era lead'} (#{crear.data.leadId}){' '}
                <button type="button" className="underline" onClick={() => navegar(`/leads/ficha?lead=${crear.data!.leadId}&op=${crear.data!.oportunidadId ?? ''}`)}>ver ficha</button></span>}
            </div>
          </form>
          {crear.isError && <div className="mt-3"><Aviso>{(crear.error as Error).message}</Aviso></div>}
        </Bloque>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ PAYERS
function Payers() {
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const q = useQuery({ queryKey: ['payers'], queryFn: () => api.get<F[]>('/api/payers/bandeja') });
  useLiveEvents({ oltp: () => cliente.invalidateQueries({ queryKey: ['payers'] }) });
  const refrescar = () => cliente.invalidateQueries({ queryKey: ['payers'] });
  const transferir = useMutation({ mutationFn: (o: number) => api.post<F>(`/api/oportunidades/${o}/transferir`), onSuccess: refrescar });
  const confirmar = useMutation({ mutationFn: (o: number) => api.post<F>(`/api/simulador/payers/${o}/confirmar`), onSuccess: refrescar });
  const { f, fijar } = useFiltros({ estado: '', texto: '' });
  const todas = q.data ?? [];
  const cuenta = (e: string) => todas.filter((x) => x.estado === e).length;
  const filas = todas.filter((x) => (!f.estado || x.estado === f.estado) && coincide(f.texto, x.estudiante, x.servicio, x.oportunidad_id, x.event_id));
  const error = q.error ?? transferir.error ?? confirmar.error;
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <Encabezado fase="PAYERS" ruta="Integración con LEADS" titulo="LEADS → PAYERS" />
      {error && <Aviso>{(error as Error).message}</Aviso>}
      {transferir.data && <Aviso tipo="info">Transferencia registrada ({transferir.data.idempotencyKey}). {transferir.data.envio?.detalle}</Aviso>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Segmentos etiqueta="Estado" valor={f.estado} alCambiar={(v) => fijar({ estado: v })} opciones={[
          { v: '', t: 'Todas', n: todas.length }, { v: 'ACEPTADA', t: 'Por transferir', n: cuenta('ACEPTADA') },
          { v: 'TRANSFERIDA', t: 'Esperando confirmación', n: cuenta('TRANSFERIDA') }, { v: 'PAYER_CONFIRMADO', t: 'Confirmadas', n: cuenta('PAYER_CONFIRMADO') }]} />
        <CampoBusqueda valor={f.texto} alCambiar={(v) => fijar({ texto: v })} placeholder="Estudiante, servicio o evento" />
      </div>
      <Bloque titulo="Bandeja y simulador de PAYERS" origen={`${cuenta('ACEPTADA')} por transferir · ${cuenta('TRANSFERIDA')} esperando confirmación · ${cuenta('PAYER_CONFIRMADO')} confirmadas`}>
        <Tabla filas={filas} clave={(x) => x.oportunidad_id} vacio={todas.length ? 'Ninguna coincide con los filtros.' : 'Todavía no hay propuestas aceptadas.'}
          columnas={[
            { titulo: 'Estudiante', orden: (x) => x.estudiante, celda: (x) => <button className="text-left" onClick={() => navegar(`/leads/ficha?lead=${x.lead_id}&op=${x.oportunidad_id}`)}>
              <div className="font-medium underline-offset-2 hover:underline">{x.estudiante}</div><div className="nota">{x.servicio ?? '—'} · v{x.version ?? '—'}</div></button> },
            { titulo: 'Precio final', derecha: true, orden: (x) => Number(x.precio_final), celda: (x) => soles(x.precio_final) },
            { titulo: 'Estado', celda: (x) => <div className="flex flex-col items-start gap-1"><ChipEstado estado={x.estado} />
              {x.es_demo && <Chip tono="apagado">Dato de prueba</Chip>}</div> },
            { titulo: 'Seguimiento', orden: (x) => +new Date(x.fecha_confirmacion ?? x.fecha_envio ?? 0), celda: (x) => <span className="nota">{x.fecha_confirmacion ? `Confirmada ${fechaHora(x.fecha_confirmacion)} · ${x.event_id}`
              : x.fecha_envio ? `Enviada ${fechaHora(x.fecha_envio)}` : 'Sin transferir'}</span> },
            { titulo: '', celda: (x) => x.estado === 'ACEPTADA'
              ? <button className="boton-claro" disabled={transferir.isPending} onClick={() => transferir.mutate(x.oportunidad_id)}>Transferir</button>
              : x.estado === 'TRANSFERIDA'
                ? <button className="boton-negro" disabled={confirmar.isPending} onClick={() => confirmar.mutate(x.oportunidad_id)}>Simular confirmación</button>
                : null },
          ]} />
      </Bloque>
      <Bloque titulo="Cómo funciona la integración" origen="LEADS no guarda montos pagados ni medios de pago: solo la referencia de la confirmación">
        <ul className="flex flex-col gap-1 text-sm text-tinta-2">
          <li>• Al aceptar la propuesta, LEADS la transfiere a PAYERS con el servicio, la versión, el precio final y los datos de contacto del estudiante.</li>
          <li>• Cada transferencia lleva una clave de idempotencia: reenviarla no duplica el cobro.</li>
          <li>• PAYERS confirma la contratación indicando el evento, la oportunidad, la fecha y la referencia de la orden de pago.</li>
          <li>• Si PAYERS repite una confirmación ya recibida, LEADS la marca como duplicada y no cambia nada.</li>
          <li>• Solo se pueden confirmar oportunidades ya transferidas, y la confirmación exige el token de PAYERS.</li>
        </ul>
      </Bloque>
    </div>
  );
}
