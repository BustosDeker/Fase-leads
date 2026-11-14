// Ficha nominal (requisito IMPULSE: «se pone el nombre y salen todos sus datos»). Bloques de la tabla 5 del
// informe; los de BUYERS son de solo lectura. Se actualiza en vivo (SSE) cuando el agente o un asesor registra algo.
// Diseño tipo CRM: cabecera del registro con etapas, pestañas por tema y, sin estudiante elegido, oportunidades recientes.
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fecha, fechaHora } from '../formato';
import { Aviso, Bloque, BuscadorLead, CampoBusqueda, Chip, ChipEstado, DatoClave, Datos, Encabezado, Iniciales, NOMBRE_ESTADO, ORDEN_ESTADOS,
  PasosEstado, SelectFiltro, Segmentos, Tabla, coincide, soles } from '../components/ui';
import { useLiveEvents } from '../hooks/useLiveEvents';

type Fila = Record<string, any>;
interface Ficha { persona: Fila; oportunidades: Fila[]; perfiles: Fila[]; diagnosticos: Fila[]; responsables: Fila[]; propuestas: Fila[];
  respuestas: Fila[]; objeciones: Fila[]; escalamientos: Fila[]; citas: Fila[]; seguimientos: Fila[]; transferencias: Fila[];
  eventos: Fila[]; consentimientos: Fila[] }

const ETAPA: Record<string, string> = { CICLO_IX: 'Ciclo IX', CICLO_X: 'Ciclo X', EGRESADO: 'Egresado', BACHILLER: 'Bachiller' };
const CICLO: Record<string, string> = { CICLO_IX: 'IX', CICLO_X: 'X' };
const TIPO_TESIS: Record<string, string> = {
  DESCRIPTIVA: 'Descriptiva', CORRELACIONAL: 'Correlacional', EXPERIMENTAL: 'Experimental',
  APLICADA: 'Aplicada', NO_DEFINIDO: 'Aún no definido',
};
const ORIGEN: Record<string, string> = { AGENTE: 'Agente IA', HUMANO: 'Asesor', SISTEMA: 'Sistema', PAYERS: 'PAYERS', SEED: 'Dato de prueba' };
/** Los detalles guardados por el agente pueden traer valores técnicos (p. ej. CICLO_X): se muestran con su nombre. */
const detalleLegible = (t: string) => t.replace(/\b(CICLO_IX|CICLO_X|EGRESADO|BACHILLER)\b/g, (m) => ETAPA[m] ?? m);
const horasEntre = (a: string, b?: string | null) => ((b ? new Date(b) : new Date()).getTime() - new Date(a).getTime()) / 3_600_000;
const tituloEvento = (e: Fila) => e.estado_nuevo ? NOMBRE_ESTADO[e.estado_nuevo] ?? e.estado_nuevo
  : (() => { const t = String(e.evento).replaceAll('_', ' ').toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); })();

/** Botón que abre un campo de texto y ejecuta la acción con lo escrito. */
function AccionConTexto({ etiqueta, placeholder, minimo = 3, onEnviar, pendiente }: {
  etiqueta: string; placeholder: string; minimo?: number; onEnviar: (t: string) => void; pendiente: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [t, setT] = useState('');
  if (!abierto) return <button className="boton-claro" onClick={() => setAbierto(true)}>{etiqueta}</button>;
  return (
    <div className="flex w-full flex-col gap-2">
      <textarea className="campo min-h-[80px] py-2" value={t} onChange={(e) => setT(e.target.value)} placeholder={placeholder} autoFocus />
      <div className="flex gap-2">
        <button className="boton-negro" disabled={pendiente || t.trim().length < minimo} onClick={() => onEnviar(t.trim())}>Confirmar</button>
        <button className="boton-claro" onClick={() => setAbierto(false)}>Cancelar</button>
      </div>
    </div>
  );
}

function situacionDiagnostico(d: Fila) {
  const h = horasEntre(d.fecha_solicitud, d.fecha_entrega);
  if (d.fecha_entrega) return h <= 48 ? <Chip tono="bueno">● Entregado en {h.toFixed(1)} h</Chip> : <Chip tono="malo">■ Entregado en {h.toFixed(1)} h (fuera de 48 h)</Chip>;
  return h <= 48 ? <Chip tono="regular">▲ Pendiente · quedan {(48 - h).toFixed(1)} h</Chip> : <Chip tono="malo">■ Vencido hace {(h - 48).toFixed(1)} h</Chip>;
}

// ------------------------------------------------------------------ sin estudiante elegido: oportunidades recientes
interface Op { oportunidad_id: number; lead_id: number; estado: string; fecha_inicio: string; es_demo: boolean; estudiante: string;
  responsable: string; carrera: string | null; precio: number | null }

function Recientes() {
  const navegar = useNavigate();
  const q = useQuery({ queryKey: ['pipeline'], queryFn: () => api.get<Op[]>('/api/pipeline') });
  const [texto, setTexto] = useState('');
  const [estado, setEstado] = useState('');
  const filas = useMemo(() => (q.data ?? []).filter((o) => (!estado || o.estado === estado) && coincide(texto, o.estudiante, o.carrera, o.oportunidad_id))
    .sort((a, b) => +new Date(b.fecha_inicio) - +new Date(a.fecha_inicio)), [q.data, texto, estado]);
  return (
    <Bloque titulo="Oportunidades recientes" origen="Elige una fila para abrir su ficha, o busca arriba por nombre, WhatsApp o identificador">
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <CampoBusqueda valor={texto} alCambiar={setTexto} placeholder="Estudiante, carrera o N.º" />
        <SelectFiltro etiqueta="Estado" valor={estado} alCambiar={setEstado} opciones={ORDEN_ESTADOS.map((e) => [e, NOMBRE_ESTADO[e]])} />
      </div>
      {q.isError && <Aviso>{(q.error as Error).message}</Aviso>}
      <Tabla filas={filas} clave={(o) => o.oportunidad_id} porPagina={10} vacio={q.isLoading ? 'Cargando…' : 'Ninguna oportunidad coincide.'}
        alClic={(o) => navegar(`/leads/ficha?lead=${o.lead_id}&op=${o.oportunidad_id}`)}
        columnas={[
          { titulo: 'Estudiante', orden: (o) => o.estudiante, celda: (o) => <div className="flex items-center gap-2"><Iniciales nombre={o.estudiante} />
            <div><div className="font-medium">{o.estudiante}</div><div className="nota">#{o.oportunidad_id} · {o.carrera ?? 'sin perfil'}{o.es_demo ? ' · prueba' : ''}</div></div></div> },
          { titulo: 'Estado', orden: (o) => ORDEN_ESTADOS.indexOf(o.estado), celda: (o) => <ChipEstado estado={o.estado} /> },
          { titulo: 'Responsable', orden: (o) => o.responsable, celda: (o) => o.responsable },
          { titulo: 'Inicio', nowrap: true, orden: (o) => +new Date(o.fecha_inicio), celda: (o) => fecha(o.fecha_inicio) },
          { titulo: 'Monto', derecha: true, orden: (o) => o.precio, celda: (o) => (o.precio ? soles(o.precio) : '—') },
        ]} />
    </Bloque>
  );
}

// ------------------------------------------------------------------ ficha
export function Ficha() {
  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const [editarContacto, setEditarContacto] = useState(false);
  const [contactoEditado, setContactoEditado] = useState({ nombres: '', apellidos: '', whatsapp: '', correo: '' });
  const [filtroOrigen, setFiltroOrigen] = useState('');
  const [buscarEvento, setBuscarEvento] = useState('');
  const leadId = Number(params.get('lead')) || null;
  const seccion = params.get('seccion') ?? 'resumen';
  const irSeccion = (s: string) => setParams((prev) => { const n = new URLSearchParams(prev); if (s === 'resumen') n.delete('seccion'); else n.set('seccion', s); return n; }, { replace: true });
  const q = useQuery({ queryKey: ['ficha', leadId], enabled: !!leadId, queryFn: () => api.get<Ficha>(`/api/leads/${leadId}/ficha`) });
  // El agente escribe en el OLTP por su cuenta (al responder por WhatsApp); sin esta suscripción la ficha
  // solo se actualizaría al recargar la página manualmente.
  useLiveEvents({ oltp: (d: { leadId?: number | null }) => { if (!leadId || !d.leadId || d.leadId === leadId) cliente.invalidateQueries({ queryKey: ['ficha', leadId] }); } });
  const f = q.data;
  const opId = Number(params.get('op')) || f?.oportunidades[0]?.oportunidad_id;
  const op = f?.oportunidades.find((o) => o.oportunidad_id === opId);
  const deOp = <T extends Fila>(xs: T[] | undefined) => (xs ?? []).filter((x) => x.oportunidad_id === opId);

  const accion = useMutation({
    mutationFn: ({ url, cuerpo }: { url: string; cuerpo?: unknown }) => api.post(url, cuerpo),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['ficha', leadId] }),
  });
  const guardarContacto = useMutation({
    mutationFn: () => api.post(`/api/leads/${leadId}/contacto`, contactoEditado),
    onSuccess: async () => {
      setEditarContacto(false);
      await Promise.all([
        cliente.invalidateQueries({ queryKey: ['ficha', leadId] }),
        cliente.invalidateQueries({ queryKey: ['buscar'] }),
      ]);
    },
  });
  const eliminarLead = useMutation({
    mutationFn: () => api.delete(`/api/leads/${leadId}`),
    onSuccess: async () => {
      await Promise.all([
        cliente.invalidateQueries({ queryKey: ['pipeline'] }),
        cliente.invalidateQueries({ queryKey: ['buscar'] }),
      ]);
      setParams({});
    },
  });

  const p = f?.persona;
  const perfil = f?.perfiles.find((x) => x.oportunidad_id === opId) ?? f?.perfiles[0];
  const diags = deOp(f?.diagnosticos);
  const props = deOp(f?.propuestas);
  const objs = deOp(f?.objeciones);
  const escs = deOp(f?.escalamientos);
  const citas = deOp(f?.citas);
  const segs = deOp(f?.seguimientos);
  const eventos = deOp(f?.eventos);
  const transf = deOp(f?.transferencias)[0];
  const respuestaDe = (pid: number) => f?.respuestas.filter((r) => r.propuesta_id === pid) ?? [];
  const diagPendiente = diags.find((d) => d.estado !== 'ENTREGADO');
  const vigente = [...props].reverse().find((x) => ['PRESENTADA', 'ACEPTADA'].includes(x.estado));
  const eventosFiltrados = eventos.filter((e) => (!filtroOrigen || e.origen === filtroOrigen) && coincide(buscarEvento, tituloEvento(e), e.detalle));
  const pendientes = escs.filter((e) => !e.fecha_atencion).length + (diagPendiente ? 1 : 0);

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4">
      <Encabezado ruta="Ficha nominal" titulo="Ficha nominal de negociación">
        <div className="w-full sm:w-[420px]"><BuscadorLead alElegir={(r) => setParams({ lead: String(r.lead_id) })} /></div>
      </Encabezado>

      {!leadId && <Recientes />}
      {q.isLoading && <div className="tarjeta h-40 animate-pulse" />}
      {q.isError && <Aviso>{(q.error as Error).message}</Aviso>}
      {accion.isError && <Aviso>{(accion.error as Error).message}</Aviso>}
      {eliminarLead.isError && <Aviso>{(eliminarLead.error as Error).message}</Aviso>}

      {f && p && (
        <>
          {/* Cabecera del registro */}
          <section className="tarjeta overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-4 p-5">
              <div className="flex min-w-0 items-start gap-4">
                <Iniciales nombre={`${p.nombres} ${p.apellidos}`} grande />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold">{p.nombres} {p.apellidos}</h2>
                    {op && <ChipEstado estado={op.estado} />}
                    {p.es_demo && <Chip tono="apagado">Dato de prueba</Chip>}
                    {pendientes > 0 && <Chip tono="malo">■ {pendientes} pendiente{pendientes > 1 ? 's' : ''}</Chip>}
                  </div>
                  <p className="nota mt-1">Lead #{p.lead_id} · Buyer #{p.buyer_id} · Contacto #{p.contacto_id} · Lead desde {fecha(p.fecha_lead)} · Prioridad {p.prioridad ?? '—'}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {f.oportunidades.length > 1 && (
                  <label className="flex items-center gap-2 text-sm">Oportunidad
                    <select className="campo w-auto" value={opId} onChange={(e) => setParams({ lead: String(leadId), op: e.target.value })}>
                      {f.oportunidades.map((o) => <option key={o.oportunidad_id} value={o.oportunidad_id}>#{o.oportunidad_id} · {fecha(o.fecha_inicio)} · {NOMBRE_ESTADO[o.estado]}</option>)}
                    </select>
                  </label>
                )}
                {op && ['APTA_PARA_COTIZAR', 'EN_NEGOCIACION'].includes(op.estado) && <Link className="boton-negro" to={`/leads/cotizador?op=${op.oportunidad_id}`}>Cotizar</Link>}
                {op && <Link className="boton-claro" to={`/leads/agenda?op=${op.oportunidad_id}`}>Agendar cita</Link>}
                <button className="boton-claro border-malo-marca text-malo-texto" disabled={eliminarLead.isPending}
                  onClick={() => {
                    if (window.confirm(`¿Eliminar el lead de ${p.nombres} ${p.apellidos} y sus datos de prueba, conversaciones e historial comercial? Esta acción no se puede deshacer. Los leads con pagos u honorarios se conservan y no podrán eliminarse.`))
                      eliminarLead.mutate();
                  }}>{eliminarLead.isPending ? 'Eliminando…' : 'Eliminar lead'}</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 border-t border-linea bg-fondo/60 px-5 py-3 sm:grid-cols-3 lg:grid-cols-6">
              <DatoClave t="WhatsApp" v={p.whatsapp ? `+${p.whatsapp}` : null} />
              <DatoClave t="Carrera" v={p.carrera} />
              <DatoClave t="Universidad" v={p.universidad} />
              <DatoClave t="Responsable" v={op?.responsable} />
              <DatoClave t="Propuesta vigente" v={vigente ? `${soles(vigente.precio_final)} · v${vigente.version}` : null} />
              <DatoClave t="Días desde el inicio" v={op ? Math.floor(horasEntre(op.fecha_inicio) / 24) : null} />
            </div>
            {op && <div className="border-t border-linea px-5 py-4"><PasosEstado estado={op.estado} /></div>}
          </section>

          <Segmentos etiqueta="Secciones de la ficha" valor={seccion} alCambiar={irSeccion} opciones={[
            { v: 'resumen', t: 'Resumen' }, { v: 'diagnostico', t: 'Diagnóstico', n: diags.length },
            { v: 'propuestas', t: 'Propuestas y objeciones', n: props.length + objs.length + escs.length },
            { v: 'actividad', t: 'Actividad', n: eventos.length + citas.length + segs.length }, { v: 'consentimiento', t: 'Consentimiento', n: f.consentimientos.length }]} />

          {seccion === 'resumen' && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <Bloque titulo="Identidad y contacto" origen="Datos del contacto recibido desde BUYERS"
                accion={<button className="boton-claro" onClick={() => {
                  setContactoEditado({ nombres: p.nombres ?? '', apellidos: p.apellidos ?? '', whatsapp: p.whatsapp ?? '', correo: p.correo ?? '' });
                  guardarContacto.reset();
                  setEditarContacto(!editarContacto);
                }}>{editarContacto ? 'Cerrar edición' : 'Editar contacto'}</button>}>
                <Datos filas={[
                  ['Nombres', p.nombres], ['Apellidos', p.apellidos], ['WhatsApp', p.whatsapp], ['Correo', p.correo],
                  ['Consentimiento', p.no_contactar ? <Chip tono="malo">■ Revocado {fecha(p.fecha_revocacion)}</Chip>
                    : p.consentimiento_contacto ? <Chip tono="bueno">● Vigente desde {fecha(p.fecha_consentimiento)}</Chip> : <Chip tono="regular">▲ Sin consentimiento</Chip>],
                  ['Estado del contacto', p.estado_contacto],
                ]} />
                {editarContacto && (
                  <form className="mt-4 grid grid-cols-1 gap-3 border-t border-linea pt-4 sm:grid-cols-2"
                    onSubmit={(e) => { e.preventDefault(); guardarContacto.mutate(); }}>
                    <label><span className="etiqueta-campo">Nombres</span>
                      <input className="campo" required maxLength={100} value={contactoEditado.nombres}
                        onChange={(e) => setContactoEditado({ ...contactoEditado, nombres: e.target.value })} /></label>
                    <label><span className="etiqueta-campo">Apellidos</span>
                      <input className="campo" required maxLength={100} value={contactoEditado.apellidos}
                        onChange={(e) => setContactoEditado({ ...contactoEditado, apellidos: e.target.value })} /></label>
                    <label><span className="etiqueta-campo">WhatsApp (con código de país)</span>
                      <input className="campo" inputMode="tel" placeholder="51987654321" value={contactoEditado.whatsapp}
                        onChange={(e) => setContactoEditado({ ...contactoEditado, whatsapp: e.target.value })} /></label>
                    <label><span className="etiqueta-campo">Correo</span>
                      <input className="campo" type="email" maxLength={150} value={contactoEditado.correo}
                        onChange={(e) => setContactoEditado({ ...contactoEditado, correo: e.target.value })} /></label>
                    <p className="nota sm:col-span-2">El WhatsApp debe incluir el código de país, por ejemplo 51. Déjalo vacío si no tiene número. Esto no modifica el consentimiento; al cambiar el número tendrás que volver a habilitar WhatsApp desde Conversaciones.</p>
                    {guardarContacto.isError && <div className="sm:col-span-2"><Aviso>{(guardarContacto.error as Error).message}</Aviso></div>}
                    <div className="flex gap-2 sm:col-span-2">
                      <button className="boton-negro" disabled={guardarContacto.isPending}>
                        {guardarContacto.isPending ? 'Guardando…' : 'Guardar cambios'}
                      </button>
                      <button type="button" className="boton-claro" onClick={() => setEditarContacto(false)}>Cancelar</button>
                    </div>
                  </form>
                )}
              </Bloque>
              <Bloque titulo="Contexto académico" origen="BUYERS · PERFIL_ACADEMICO (solo lectura)">
                {p.carrera ? <Datos filas={[
                  ['Universidad', p.universidad], ['Tipo', p.tipo_universidad === 'PUBLICA' ? 'Pública' : p.tipo_universidad === 'PRIVADA' ? 'Privada' : p.tipo_universidad],
                  ['Carrera', p.carrera], ['Facultad', p.facultad], ['Sede', p.sede], ['Etapa académica', ETAPA[p.etapa_academica] ?? p.etapa_academica],
                  ...(CICLO[p.etapa_academica] ? [['Ciclo', p.ciclo ?? CICLO[p.etapa_academica]] as [string, ReactNode]] : []),
                  ['Avance declarado en BUYERS', p.avance != null ? `${Number(p.avance)} %` : null],
                ]} /> : <p className="nota">Sin perfil académico registrado en BUYERS.</p>}
              </Bloque>
              <Bloque titulo="Canal de origen" origen="BUYERS · BUYER (solo lectura)">
                <Datos filas={[
                  ['Canal', p.canal], ['Tipo de canal', p.tipo_canal], ['Plataforma', p.plataforma], ['Campaña', p.campania ?? 'Sin campaña'],
                  ['Servicio de interés', p.servicio_interes], ['Captado el', fecha(p.fecha_buyer)],
                ]} />
              </Bloque>
              <Bloque titulo="Preferencias y disponibilidad" origen={`LEADS · PERFIL_NEGOCIACION${perfil ? ` (versión ${perfil.version})` : ''}`}>
                {perfil ? <Datos filas={[
                  ['Disponibilidad', perfil.disponibilidad], ['Horario', perfil.horario], ['Fecha límite', fecha(perfil.fecha_limite)],
                  ['Nivel de confianza', perfil.nivel_confianza ? `${perfil.nivel_confianza} / 5` : null],
                  ['Presupuesto orientativo', perfil.presupuesto_orientativo ? soles(perfil.presupuesto_orientativo) : null],
                  ['Necesidad de acompañamiento', perfil.necesidad_acompanamiento],
                ]} /> : <p className="nota">El agente aún no registra preferencias.</p>}
              </Bloque>
              <Bloque titulo="Decisión y responsable de pago" origen="LEADS · RESPONSABLE_PAGO (no tramita cobros)">
                {f.responsables.length === 0 ? <p className="nota">Sin responsable registrado.</p> : f.responsables.map((r) => (
                  <Datos key={r.responsable_pago_id} filas={[
                    ['Responsable', r.nombre], ['Tipo', r.tipo_responsable], ['Relación', r.tipo_relacion],
                    ['Participa en la decisión', r.participa_decision ? 'Sí' : 'No'],
                  ]} />
                ))}
              </Bloque>
              <Bloque titulo="Estado de la oportunidad" origen="LEADS · OPORTUNIDAD_COMERCIAL, TRANSFERENCIA_PAYER, CONVERSION_PAYER_REF"
                accion={op && !['DESCARTADA', 'PAYER_CONFIRMADO'].includes(op.estado) ? (
                  <AccionConTexto etiqueta="Descartar" placeholder="Motivo del descarte" pendiente={accion.isPending}
                    onEnviar={(t) => accion.mutate({ url: `/api/oportunidades/${opId}/descartar`, cuerpo: { motivo: t } })} />) : undefined}>
                {op && <Datos filas={[
                  ['Estado', <ChipEstado key="e" estado={op.estado} />], ['Responsable', op.responsable],
                  ['Inicio', fechaHora(op.fecha_inicio)], ['Apta para cotizar', fechaHora(op.fecha_apta_cotizar)],
                  ['Transferencia a PAYERS', transf ? `${fechaHora(transf.fecha_envio)} · ${transf.idempotency_key}` : null],
                  ['Confirmación de PAYERS', transf?.fecha_confirmacion ? `${fechaHora(transf.fecha_confirmacion)} · ${transf.event_id}` : null],
                  ['Cierre', op.fecha_cierre ? `${fechaHora(op.fecha_cierre)} · ${op.motivo_cierre ?? ''}` : null],
                ]} />}
              </Bloque>
            </div>
          )}

          {seccion === 'diagnostico' && (
            <Bloque titulo="Diagnóstico de tesis" origen="LEADS · DIAGNOSTICO"
              accion={op && op.estado === 'ABIERTA' && !diags.length ? (
                <button className="boton-claro" disabled={accion.isPending}
                  onClick={() => accion.mutate({ url: '/api/diagnosticos', cuerpo: { oportunidadId: opId } })}>Registrar solicitud</button>) : undefined}>
              {diags.length === 0 && <p className="nota py-4">Sin solicitud de diagnóstico.</p>}
              {diags.map((d) => (
                <div key={d.diagnostico_id} className="mb-3 border-b border-linea pb-3 last:mb-0 last:border-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">{situacionDiagnostico(d)}{d.requiere_derivacion && <Chip>Derivado a {d.asesor}</Chip>}</div>
                  <Datos filas={[
                    ['Fecha de solicitud', fechaHora(d.fecha_solicitud)], ['Fecha de entrega', fechaHora(d.fecha_entrega)],
                    ['Tema', d.tema_tesis], ['Tipo de tesis', TIPO_TESIS[d.tipo_tesis] ?? d.tipo_tesis],
                    ['Avance', d.avance_declarado != null ? `${Number(d.avance_declarado)} %` : null],
                    ['Empresa de aplicación', d.tiene_empresa_aplicacion == null ? null : d.tiene_empresa_aplicacion ? 'Sí' : 'No'],
                    ['Limitaciones', d.limitaciones], ['Responsable', d.asesor],
                  ]} />
                  {d.resumen && <p className="mt-2 text-sm text-tinta-2"><span className="text-tinta-3">Resumen: </span>{d.resumen}</p>}
                </div>
              ))}
              <div className="mt-2 flex flex-wrap gap-2">
                {diagPendiente && (
                  <AccionConTexto etiqueta="Registrar entrega" placeholder="Resumen del diagnóstico entregado al estudiante (mín. 10 caracteres)" minimo={10}
                    pendiente={accion.isPending} onEnviar={(t) => accion.mutate({ url: `/api/diagnosticos/${diagPendiente.diagnostico_id}/entregar`, cuerpo: { resumen: t } })} />
                )}
                {op?.estado === 'EN_DIAGNOSTICO' && diags.some((d) => d.estado === 'ENTREGADO') && (
                  <button className="boton-negro" disabled={accion.isPending} onClick={() => accion.mutate({ url: `/api/oportunidades/${opId}/aptitud` })}>Marcar apta para cotizar</button>
                )}
              </div>
            </Bloque>
          )}

          {seccion === 'propuestas' && (
            <>
              <Bloque titulo="Propuestas" origen="LEADS · PROPUESTA y RESPUESTA_PROPUESTA · cada cambio es una versión nueva"
                accion={op && ['APTA_PARA_COTIZAR', 'EN_NEGOCIACION'].includes(op.estado) ? <Link className="boton-claro" to={`/leads/cotizador?op=${opId}`}>Abrir cotizador</Link> : undefined}>
                <Tabla filas={[...props].reverse()} clave={(x) => x.propuesta_id} vacio="Sin propuestas presentadas."
                  columnas={[
                    { titulo: 'Versión', orden: (x) => x.version, celda: (x) => <strong>v{x.version}</strong> },
                    { titulo: 'Servicio', orden: (x) => x.servicio, celda: (x) => x.servicio },
                    { titulo: 'Precio final', derecha: true, orden: (x) => Number(x.precio_final), celda: (x) => <strong>{soles(x.precio_final)}</strong> },
                    { titulo: 'Presentada', nowrap: true, orden: (x) => +new Date(x.fecha_presentacion), celda: (x) => fechaHora(x.fecha_presentacion) },
                    { titulo: 'Vigencia', nowrap: true, celda: (x) => fecha(x.vigencia_hasta) },
                    { titulo: 'Estado y respuesta', celda: (x) => <><Chip tono={x.estado === 'ACEPTADA' ? 'bueno' : x.estado === 'RECHAZADA' ? 'malo' : 'neutro'}>{x.estado}</Chip>
                      {respuestaDe(x.propuesta_id).map((r) => <div key={r.respuesta_id} className="nota mt-1">{r.tipo_respuesta} · {fechaHora(r.fecha_respuesta)}</div>)}</> },
                  ]} />
              </Bloque>
              <Bloque titulo="Objeciones y escalamientos" origen="LEADS · OBJECION, ESCALAMIENTO">
                {objs.length === 0 && escs.length === 0 && <p className="nota py-4">Sin objeciones ni escalamientos.</p>}
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {objs.map((o) => (
                    <div key={o.objecion_id} className="rounded-lg border border-linea p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2"><strong>Objeción · {o.grupo}</strong>
                        <Chip tono={o.estado === 'RESUELTA' ? 'bueno' : 'regular'}>{o.estado === 'RESUELTA' ? '● Recuperada' : '▲ Pendiente'}</Chip>
                        {o.escalada && <Chip tono="malo">■ Escalada</Chip>}</div>
                      <p className="nota mt-1">{o.tipo} · sobre v{o.version} · {fechaHora(o.fecha_registro)}</p>
                      {o.respuesta_agente && <p className="mt-1 text-tinta-2"><span className="text-tinta-3">Respuesta del agente: </span>{o.respuesta_agente}</p>}
                    </div>
                  ))}
                  {escs.map((e) => (
                    <div key={e.escalamiento_id} className={`rounded-lg border p-3 text-sm ${e.fecha_atencion ? 'border-linea' : 'border-linea-fuerte border-l-4 border-l-malo-marca'}`}>
                      <div className="flex flex-wrap items-center gap-2"><strong>Escalamiento · {e.motivo.replaceAll('_', ' ').toLowerCase()}</strong>
                        {e.fecha_atencion ? <Chip tono="bueno">● Atendido</Chip> : <Chip tono="malo">■ Pendiente</Chip>}</div>
                      <p className="nota mt-1">a {e.destino_rol.toLowerCase()} · {fechaHora(e.fecha)}</p>
                      {e.resumen && <p className="mt-1 text-tinta-2">{e.resumen}</p>}
                    </div>
                  ))}
                </div>
              </Bloque>
            </>
          )}

          {seccion === 'actividad' && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <Bloque titulo="Línea de tiempo" origen="Cada cambio de estado y acción del agente o de un asesor, con fecha" className="xl:col-span-2">
                <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <CampoBusqueda valor={buscarEvento} alCambiar={setBuscarEvento} placeholder="Buscar en la actividad" />
                  <SelectFiltro etiqueta="Origen" valor={filtroOrigen} alCambiar={setFiltroOrigen}
                    opciones={[...new Set(eventos.map((e) => e.origen as string))].map((o) => [o, ORIGEN[o] ?? o])} />
                </div>
                {eventosFiltrados.length === 0 && <p className="nota py-4">{eventos.length ? 'Ningún evento coincide con los filtros.' : 'Sin actividad registrada.'}</p>}
                <ol className="space-y-0 border-l border-linea-fuerte pl-4">
                  {eventosFiltrados.map((e) => (
                    <li key={e.evento_id} className="relative pb-3">
                      <span className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ${e.estado_nuevo ? 'bg-tinta' : 'border border-tinta bg-white'}`} aria-hidden />
                      <div className="text-sm"><strong>{tituloEvento(e)}</strong>{e.detalle && <span className="text-tinta-2"> · {detalleLegible(e.detalle)}</span>}</div>
                      <div className="nota">{fechaHora(e.fecha)} · {ORIGEN[e.origen] ?? e.origen}</div>
                    </li>
                  ))}
                </ol>
              </Bloque>
              <Bloque titulo="Agenda y seguimiento" origen="LEADS · CITA_VIRTUAL, SEGUIMIENTO_LEAD">
                {citas.length === 0 && segs.length === 0 && <p className="nota">Sin citas ni seguimientos. La cita es opcional: el estudiante puede seguir por WhatsApp.</p>}
                <ul className="space-y-2 text-sm">
                  {citas.map((c) => <li key={c.cita_id} className="flex flex-wrap items-center gap-2"><Chip>{c.estado}</Chip>{fechaHora(c.inicio)} · {c.medio} · {c.asesor}
                    {c.enlace ? <a className="font-medium underline underline-offset-2 hover:no-underline" href={c.enlace} target="_blank" rel="noreferrer">Enlace de reunión ↗</a>
                      : <span className="nota">El asesor enviará el enlace antes de la reunión.</span>}</li>)}
                  {segs.map((s) => <li key={s.seguimiento_lead_id} className="text-tinta-2">{fechaHora(s.fecha_accion)} · {s.resultado}<span className="nota block">Siguiente: {s.siguiente_accion}</span></li>)}
                </ul>
                {op && <Link className="boton-claro mt-3" to={`/leads/agenda?op=${op.oportunidad_id}`}>Agendar cita</Link>}
              </Bloque>
            </div>
          )}

          {seccion === 'consentimiento' && (
            <Bloque titulo="Consentimiento" origen="Ley 29733 · CONSENTIMIENTO_HISTORIAL"
              accion={<button className="boton-claro" onClick={() => navegar('/leads/consentimiento')}>Gestionar consentimiento</button>}>
              {f.consentimientos.length === 0 && <p className="nota py-4">Sin registros de consentimiento.</p>}
              <ul className="divide-y divide-linea text-sm">{f.consentimientos.map((c) => (
                <li key={c.consentimiento_id} className="flex flex-wrap items-start gap-3 py-2.5">
                  <Chip tono={c.accion === 'OTORGA' ? 'bueno' : 'malo'}>{c.accion === 'OTORGA' ? '● Otorga' : '■ Revoca'}</Chip>
                  <div><div>{fechaHora(c.fecha)} · {c.medio}</div><div className="nota">{c.evidencia}</div></div></li>))}
              </ul>
            </Bloque>
          )}
        </>
      )}
    </div>
  );
}
