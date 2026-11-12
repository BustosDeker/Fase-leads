// Conversaciones del Agente Negociador: simulador de WhatsApp (escribir como estudiante), historial,
// auditoría de cada turno (herramientas, latencia, alertas) y control humano (tomar / devolver).
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fechaHora } from '../formato';
import { useLiveEvents } from '../hooks/useLiveEvents';
import { Aviso, Bloque, BuscadorLead, CampoBusqueda, Chip, ChipEstado, Encabezado, SelectFiltro, coincide, useFiltros } from '../components/ui';
import { ConexionWhatsApp } from '../components/ConexionWhatsApp';

type F = Record<string, any>;
const NOMBRE_HERRAMIENTA: Record<string, string> = {
  consultar_situacion: 'Consultó la situación', registrar_consentimiento: 'Registró consentimiento', registrar_perfil_academico: 'Registró perfil académico',
  registrar_preferencias: 'Registró preferencias', solicitar_diagnostico: 'Solicitó diagnóstico', simular_cotizacion: 'Simuló cotización',
  presentar_propuesta: 'Presentó propuesta', registrar_objecion: 'Registró objeción', registrar_respuesta_propuesta: 'Registró respuesta a la propuesta',
  consultar_horarios: 'Consultó horarios', agendar_cita: 'Agendó cita', escalar_a_humano: 'Derivó a una persona',
};
const NOMBRE_PROVEEDOR: Record<string, string> = { mock: 'Modo sin IA (reglas)', anthropic: 'Claude (Anthropic)', openai: 'OpenAI', gemini: 'Gemini' };
const iniciales = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
/** «hace 5 min», «hace 3 h», o la fecha si es de otro día. */
const haceCuanto = (iso: string) => { const m = (Date.now() - new Date(iso).getTime()) / 60_000;
  return m < 1 ? 'ahora' : m < 60 ? `hace ${Math.floor(m)} min` : m < 24 * 60 ? `hace ${Math.floor(m / 60)} h` : fechaHora(iso); };
const motivo = (m: string) => m.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

export function Conversaciones() {
  const [params, setParams] = useSearchParams();
  const actual = Number(params.get('c')) || null;
  const cliente = useQueryClient();
  const navegar = useNavigate();
  const { f, fijar, activos, limpiar } = useFiltros({ canal: '', bandeja: '', buscar: '' });
  const [mostrar, setMostrar] = useState(30);
  // Abre una conversación conservando los filtros de la bandeja.
  const abrirConversacion = (id: number) => setParams((p) => { const n = new URLSearchParams(p); n.set('c', String(id)); return n; });
  const [leadWhatsApp, setLeadWhatsApp] = useState<F | null>(null);

  const estado = useQuery({ queryKey: ['agente-estado'], queryFn: () => api.get<F>('/api/agente/estado') });
  const lista = useQuery({ queryKey: ['conversaciones', f.canal], queryFn: () => api.get<F[]>('/api/conversaciones', { canal: f.canal }) });
  const bandejaDe = (c: F) => (c.estado === 'CERRADA' ? 'cerrada' : c.escalamientos_pendientes > 0 ? 'derivacion' : c.control_humano ? 'persona' : 'agente');
  const cuenta = (b: string) => (lista.data ?? []).filter((c) => bandejaDe(c) === b).length;
  const visibles = (lista.data ?? []).filter((c) => (!f.bandeja || bandejaDe(c) === f.bandeja) && coincide(f.buscar, c.estudiante, c.ultimo_texto));
  const det = useQuery({ queryKey: ['conversacion', actual], enabled: !!actual, queryFn: () => api.get<F>(`/api/conversaciones/${actual}`) });
  useLiveEvents({ conversacion: (d: { conversacionId: number }) => {
    cliente.invalidateQueries({ queryKey: ['conversaciones'] });
    if (d.conversacionId === actual) cliente.invalidateQueries({ queryKey: ['conversacion', actual] });
  } });

  const nueva = useMutation({
    mutationFn: (b: F) => api.post<F>('/api/simulador/conversaciones', b),
    onSuccess: (r) => { abrirConversacion(r.conversacion_id); cliente.invalidateQueries({ queryKey: ['conversaciones'] }); },
  });
  const [nombres, setNombres] = useState('');
  const [apellidos, setApellidos] = useState('');
  // El agente escribe primero por WhatsApp a un lead que ya dio su consentimiento.
  const iniciar = useMutation({
    mutationFn: (leadId: number) => api.post<F>('/api/whatsapp/iniciar', { leadId }),
    onSuccess: (r) => { abrirConversacion(r.conversacionId); cliente.invalidateQueries({ queryKey: ['conversaciones'] }); },
  });
  const activarWhatsApp = useMutation({
    mutationFn: ({ leadId, habilitado }: { leadId: number; habilitado: boolean }) =>
      api.post(`/api/leads/${leadId}/whatsapp`, { habilitado }),
    onSuccess: (_r, variables) => {
      setLeadWhatsApp((actual) => actual?.lead_id === variables.leadId ? { ...actual, whatsapp_habilitado: variables.habilitado } : actual);
      cliente.invalidateQueries({ queryKey: ['buscar'] });
    },
  });

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <Encabezado ruta="Conversaciones" titulo="Conversaciones del agente">
        {estado.data && <Chip tono={estado.data.aviso ? 'regular' : 'neutro'}>{estado.data.aviso ? '▲ ' : ''}Agente: {NOMBRE_PROVEEDOR[estado.data.proveedor] ?? estado.data.proveedor}
          {estado.data.proveedor !== 'mock' ? ` · ${estado.data.modelo}` : ''}</Chip>}
      </Encabezado>
      {estado.data?.aviso && <Aviso tipo="info">{estado.data.aviso}</Aviso>}
      <ConexionWhatsApp />
      {nueva.isError && <Aviso>{(nueva.error as Error).message}</Aviso>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
        <div className="flex flex-col gap-5">
          <Bloque titulo="Escribir primero por WhatsApp" origen="El agente envía el primer mensaje a un lead desde el número vinculado y luego continúa la conversación">
            <BuscadorLead placeholder="Buscar lead con WhatsApp…" alElegir={setLeadWhatsApp} />
            {leadWhatsApp && (
              <div className="mt-3 flex flex-col gap-2 rounded-lg border border-linea p-3">
                <p className="text-sm font-medium">{leadWhatsApp.nombres} {leadWhatsApp.apellidos}</p>
                <p className="nota">{leadWhatsApp.whatsapp ? `WhatsApp: +${leadWhatsApp.whatsapp}` : 'No tiene número de WhatsApp registrado.'}</p>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={!!leadWhatsApp.whatsapp_habilitado}
                    disabled={activarWhatsApp.isPending || (!leadWhatsApp.whatsapp_habilitado
                      && (!leadWhatsApp.whatsapp || !leadWhatsApp.consentimiento_contacto || leadWhatsApp.no_contactar))}
                    onChange={(e) => activarWhatsApp.mutate({ leadId: leadWhatsApp.lead_id, habilitado: e.target.checked })} />
                  <span>Habilitar WhatsApp para este lead</span>
                </label>
                {!leadWhatsApp.consentimiento_contacto || leadWhatsApp.no_contactar
                  ? <p className="nota text-regular-texto">Se necesita consentimiento vigente del contacto.</p>
                  : null}
                {activarWhatsApp.isError && <Aviso>{(activarWhatsApp.error as Error).message}</Aviso>}
                <button className="boton-negro" disabled={!leadWhatsApp.whatsapp_habilitado || iniciar.isPending}
                  onClick={() => {
                    if (leadWhatsApp.whatsapp && window.confirm(`¿Enviar el primer mensaje a ${leadWhatsApp.nombres} ${leadWhatsApp.apellidos} (…${leadWhatsApp.whatsapp.slice(-4)}) por WhatsApp?`))
                      iniciar.mutate(leadWhatsApp.lead_id);
                  }}>Iniciar conversación</button>
              </div>
            )}
            <p className="nota mt-2">Requisitos: WhatsApp conectado, número registrado, permiso activado para este lead y consentimiento vigente.</p>
            {iniciar.isPending && <p className="nota mt-2">Enviando…</p>}
            {iniciar.isError && <div className="mt-2"><Aviso>{(iniciar.error as Error).message}</Aviso></div>}
            {iniciar.data && <div className="mt-2"><Aviso tipo="ok">Mensaje enviado a {iniciar.data.enviadoA}. Cuando responda, el agente continúa.</Aviso></div>}
          </Bloque>

          <Bloque titulo="Bandeja" origen={`${visibles.length} de ${(lista.data ?? []).length} conversaciones`}
            accion={activos > 0 ? <button type="button" className="text-sm font-semibold underline-offset-2 hover:underline" onClick={limpiar}>✕ Limpiar</button> : undefined}>
            <div className="flex flex-col gap-2">
              <CampoBusqueda valor={f.buscar} alCambiar={(v) => fijar({ buscar: v })} placeholder="Estudiante o último mensaje" etiqueta="Buscar" className="w-full" />
              <div className="grid grid-cols-2 gap-2">
                <SelectFiltro etiqueta="Canal" valor={f.canal} alCambiar={(v) => fijar({ canal: v })} todos="Todos" className="w-full"
                  opciones={[['SIMULADOR', 'Simulador'], ['WHATSAPP', 'WhatsApp']]} />
                <SelectFiltro etiqueta="Bandeja" valor={f.bandeja} alCambiar={(v) => fijar({ bandeja: v })} todos="Todas" className="w-full"
                  opciones={[['agente', `Con el agente (${cuenta('agente')})`], ['persona', `Con una persona (${cuenta('persona')})`],
                    ['derivacion', `Derivación pendiente (${cuenta('derivacion')})`], ['cerrada', `Cerradas (${cuenta('cerrada')})`]]} />
              </div>
            </div>
            {lista.isError && <Aviso>{(lista.error as Error).message}</Aviso>}
            {lista.data?.length === 0 && <p className="nota mt-3">Todavía no hay conversaciones. Inicia una de prueba.</p>}
            {lista.data && lista.data.length > 0 && visibles.length === 0 && <p className="nota mt-3 py-4 text-center">Ninguna conversación coincide con los filtros.</p>}
            <ul className="-mx-2 mt-3 flex max-h-[62vh] flex-col divide-y divide-linea overflow-y-auto">
              {visibles.slice(0, mostrar).map((c) => (
                <li key={c.conversacion_id}>
                  <button onClick={() => abrirConversacion(c.conversacion_id)}
                    className={`flex w-full flex-col gap-1 rounded-lg px-2 py-2.5 text-left transition-colors ${c.conversacion_id === actual ? 'bg-fondo ring-1 ring-tinta/30' : 'hover:bg-fondo'}`}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tinta text-xs font-bold text-white">{iniciales(c.estudiante)}</span>
                        <span className="truncate text-sm font-semibold">{c.estudiante}</span>
                      </span>
                      <span className="nota whitespace-nowrap">{c.ultimo_mensaje ? haceCuanto(c.ultimo_mensaje) : ''}</span>
                    </span>
                    <span className="truncate pl-10 text-xs text-tinta-2">{!c.ultimo_texto ? 'Sin mensajes todavía' : `${c.ultimo_emisor === 'BOT' ? 'Agente: ' : c.ultimo_emisor && c.ultimo_emisor !== 'CLIENTE' ? 'Asesor: ' : ''}${c.ultimo_texto}`}</span>
                    <span className="flex flex-wrap gap-1 pl-10">
                      <Chip tono="apagado">{c.canal_mensajeria === 'SIMULADOR' ? 'Simulador' : 'WhatsApp'}</Chip>
                      {c.estado_oportunidad && <ChipEstado estado={c.estado_oportunidad} />}
                      {c.control_humano ? <Chip tono="regular">▲ Con una persona</Chip> : null}
                      {c.escalamientos_pendientes > 0 && <Chip tono="malo">■ Derivación pendiente</Chip>}
                      {c.no_contactar ? <Chip tono="apagado">– No contactar</Chip> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {visibles.length > mostrar && <button className="boton-claro mt-3 w-full" onClick={() => setMostrar(mostrar + 30)}>Mostrar más ({visibles.length - mostrar} restantes)</button>}
          </Bloque>

          <Bloque titulo="Nueva conversación de prueba" origen="Simulador: escribes como el estudiante; el agente responde con las mismas reglas que en WhatsApp">
            <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); nueva.mutate({ nombres: nombres || undefined, apellidos: apellidos || undefined }); }}>
              <div className="grid grid-cols-2 gap-2">
                <input className="campo" placeholder="Nombres" value={nombres} onChange={(e) => setNombres(e.target.value)} aria-label="Nombres" />
                <input className="campo" placeholder="Apellidos" value={apellidos} onChange={(e) => setApellidos(e.target.value)} aria-label="Apellidos" />
              </div>
              <button className="boton-negro" disabled={nueva.isPending}>Iniciar con estudiante nuevo</button>
              <p className="nota">Se registra como dato de prueba. O continúa con un lead existente:</p>
              <BuscadorLead alElegir={(r) => nueva.mutate({ leadId: r.lead_id })} placeholder="Buscar lead existente…" />
            </form>
          </Bloque>

        </div>

        {!actual ? (
          <Bloque titulo="Selecciona una conversación"><p className="nota">Elige una conversación de la lista o inicia una nueva de prueba.</p></Bloque>
        ) : det.isError ? <Aviso>{(det.error as Error).message}</Aviso>
          : !det.data ? <Bloque titulo="Cargando…"><p className="nota">Cargando conversación…</p></Bloque>
          : <Detalle d={det.data} alVerFicha={() => navegar(`/leads/ficha?lead=${det.data!.conversacion.lead_id}&op=${det.data!.conversacion.oportunidad_id}`)} />}
      </div>
    </div>
  );
}

function Detalle({ d, alVerFicha }: { d: F; alVerFicha: () => void }) {
  const c = d.conversacion;
  const cliente = useQueryClient();
  const refrescar = () => { cliente.invalidateQueries({ queryKey: ['conversacion', c.conversacion_id] }); cliente.invalidateQueries({ queryKey: ['conversaciones'] }); };
  const asesores = useQuery({ queryKey: ['asesores'], queryFn: () => api.get<F[]>('/api/asesores') });
  const [texto, setTexto] = useState('');
  const [comoAsesor, setComoAsesor] = useState(false);
  const [asesorId, setAsesorId] = useState<number | null>(null);
  const [verAuditoria, setVerAuditoria] = useState(true);
  const fondo = useRef<HTMLDivElement>(null);
  const esSim = c.canal_mensajeria === 'SIMULADOR';

  const enviar = useMutation({
    mutationFn: (t: string) => comoAsesor || !esSim
      ? api.post(`/api/conversaciones/${c.conversacion_id}/mensajes`, { texto: t, asesorId })
      : api.post<F>(`/api/simulador/conversaciones/${c.conversacion_id}/mensajes`, { texto: t }),
    onSuccess: () => { setTexto(''); refrescar(); },
  });
  const tomar = useMutation({ mutationFn: () => api.post(`/api/conversaciones/${c.conversacion_id}/tomar`, { asesorId }), onSuccess: refrescar });
  const devolver = useMutation({ mutationFn: () => api.post(`/api/conversaciones/${c.conversacion_id}/devolver`), onSuccess: refrescar });
  useEffect(() => { fondo.current?.scrollTo({ top: fondo.current.scrollHeight }); }, [d.mensajes.length, enviar.isPending]);

  const turnoPorSalida = new Map<number, F>(d.turnos.filter((t: F) => t.mensaje_salida_id).map((t: F) => [t.mensaje_salida_id, t]));
  const error = enviar.error ?? tomar.error ?? devolver.error;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <section className="tarjeta flex min-h-[70vh] flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-linea p-4">
          <div className="min-w-0">
            <h2 className="titulo-seccion">{c.nombres} {c.apellidos}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {c.estado_oportunidad && <ChipEstado estado={c.estado_oportunidad} />}
              <Chip tono={c.consentimiento_contacto ? 'bueno' : c.no_contactar ? 'malo' : 'regular'}>
                {c.consentimiento_contacto ? '● Consentimiento otorgado' : c.no_contactar ? '■ Revocó consentimiento' : '▲ Sin consentimiento aún'}</Chip>
              <Chip tono={c.control_humano ? 'regular' : 'neutro'}>{c.control_humano ? `▲ Atiende una persona${c.asesor_control ? ': ' + c.asesor_control : ''}` : 'Atiende el agente'}</Chip>
              {c.es_demo && <Chip tono="apagado">Dato de prueba</Chip>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {c.lead_id && <button className="boton-claro" onClick={alVerFicha}>Ver ficha</button>}
            {c.control_humano
              ? <button className="boton-claro" disabled={devolver.isPending} onClick={() => devolver.mutate()}>Devolver al agente</button>
              : <button className="boton-claro" disabled={tomar.isPending} onClick={() => tomar.mutate()}>Tomar el control</button>}
          </div>
        </header>

        <div ref={fondo} className="flex flex-1 flex-col gap-2 overflow-y-auto bg-fondo p-4" style={{ maxHeight: '60vh' }} aria-live="polite">
          {d.mensajes.length === 0 && <p className="nota m-auto">Escribe el primer mensaje como estudiante (el agente nunca escribe primero).</p>}
          {d.mensajes.map((m: F) => {
            const del = m.emisor === 'CLIENTE';
            const t = turnoPorSalida.get(m.mensaje_id);
            return (
              <div key={m.mensaje_id} className={`flex max-w-[85%] flex-col ${del ? 'self-start items-start' : 'self-end items-end'}`}>
                <div className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm ${del ? 'rounded-bl-sm border border-linea bg-white text-tinta'
                  : m.emisor === 'BOT' ? 'rounded-br-sm bg-tinta text-white' : 'rounded-br-sm border-2 border-tinta bg-white text-tinta'}`}>{m.contenido}</div>
                <span className="nota mt-0.5">{del ? 'Estudiante' : m.emisor === 'BOT' ? 'Agente' : `Asesor${m.asesor ? ': ' + m.asesor : ''}`} · {fechaHora(m.fecha_hora)}
                  {t && verAuditoria && t.detalle?.herramientas?.length ? ` · ${t.detalle.herramientas.map((h: F) => (NOMBRE_HERRAMIENTA[h.herramienta] ?? h.herramienta) + (h.ok ? '' : ' (falló)')).join(', ')}` : ''}</span>
              </div>
            );
          })}
          {enviar.isPending && !comoAsesor && esSim && <p className="nota self-end">El agente está escribiendo…</p>}
        </div>

        <form className="flex flex-col gap-2 border-t border-linea p-3" onSubmit={(e) => { e.preventDefault(); if (texto.trim()) enviar.mutate(texto.trim()); }}>
          {error && <Aviso>{(error as Error).message}</Aviso>}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {esSim && <label className="flex items-center gap-2"><input type="checkbox" checked={comoAsesor} onChange={(e) => setComoAsesor(e.target.checked)} />Escribir como asesor</label>}
            {(comoAsesor || !esSim) && (
              <select className="campo w-60" value={asesorId ?? ''} onChange={(e) => setAsesorId(e.target.value ? Number(e.target.value) : null)} aria-label="Asesor">
                <option value="">Asesor (opcional)</option>
                {asesores.data?.map((a) => <option key={a.asesor_id} value={a.asesor_id}>{a.nombre}</option>)}
              </select>)}
            <label className="ml-auto flex items-center gap-2"><input type="checkbox" checked={verAuditoria} onChange={(e) => setVerAuditoria(e.target.checked)} />Ver acciones del agente</label>
          </div>
          <div className="flex gap-2">
            <input className="campo" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={2000} disabled={enviar.isPending || (!!c.no_contactar && (comoAsesor || !esSim))}
              placeholder={comoAsesor || !esSim ? 'Mensaje del asesor (toma el control de la conversación)…' : 'Mensaje del estudiante…'} aria-label="Mensaje" />
            <button className="boton-negro" disabled={enviar.isPending || !texto.trim()}>Enviar</button>
          </div>
          {!esSim && <p className="nota">Conversación real de WhatsApp: aquí solo puede escribir un asesor.</p>}
        </form>
      </section>

      {d.escalamientos.length > 0 && (
        <Bloque titulo="Derivaciones a una persona" origen="ESCALAMIENTO · con el resumen que preparó el agente">
          <ul className="flex flex-col gap-2">
            {d.escalamientos.map((e: F) => (
              <li key={e.escalamiento_id} className="rounded-lg border border-linea p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tono={e.estado === 'PENDIENTE' ? 'malo' : 'bueno'}>{e.estado === 'PENDIENTE' ? '■ Pendiente' : e.estado === 'ATENDIDO' ? '● Atendido' : '● Cerrado'}</Chip>
                  <strong>{motivo(e.motivo)}</strong><span className="nota">→ {e.destino_rol.toLowerCase()} · {fechaHora(e.fecha)}</span>
                </div>
                {e.resumen && <p className="mt-1 text-tinta-2">{e.resumen}</p>}
              </li>
            ))}
          </ul>
        </Bloque>
      )}

      <Bloque titulo="Auditoría de turnos del agente" origen="AGENTE_TURNO · proveedor, latencia, herramientas usadas con sus resultados y alertas de seguridad">
        {d.turnos.length === 0 && <p className="nota">Sin turnos todavía.</p>}
        <ol className="flex flex-col gap-2">
          {[...d.turnos].reverse().map((t: F) => (
            <li key={t.turno_id}>
              <details className="rounded-lg border border-linea p-3 text-sm">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  <span className="font-medium">Turno {t.turno_id}</span><span className="nota">{fechaHora(t.fecha)} · {NOMBRE_PROVEEDOR[t.proveedor_llm] ?? t.proveedor_llm} · {t.latencia_ms} ms</span>
                  {t.sospecha_inyeccion && <Chip tono="malo">■ Posible manipulación</Chip>}
                  {t.error && <Chip tono="malo">■ Con error</Chip>}
                  {t.detalle?.revision?.length > 0 && <Chip tono="regular">▲ Respuesta corregida</Chip>}
                  <span className="nota">{t.detalle?.herramientas?.length ?? 0} acción(es)</span>
                </summary>
                {t.error && <p className="mt-2 text-malo-texto">{t.error}</p>}
                {t.detalle?.revision?.map((r: string, i: number) => <p key={i} className="mt-2 text-regular-texto">▲ {r}</p>)}
                <ul className="mt-2 flex flex-col gap-2">
                  {t.detalle?.herramientas?.map((h: F, i: number) => (
                    <li key={i} className="rounded-md bg-fondo p-2">
                      <div className="font-medium">{h.ok ? '●' : '■'} {NOMBRE_HERRAMIENTA[h.herramienta] ?? h.herramienta} <span className="nota">· {h.ms} ms</span></div>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-xs text-tinta-2">Entrada: {JSON.stringify(h.entrada)}{'\n'}Resultado: {JSON.stringify(h.resultado)}</pre>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ol>
      </Bloque>
    </div>
  );
}
