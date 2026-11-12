// Ficha nominal (requisito IMPULSE: «se pone el nombre y salen todos sus datos»). Bloques de la tabla 5 del
// informe; los de BUYERS son de solo lectura. Se actualiza en vivo (SSE) cuando el agente o un asesor registra algo.
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fecha, fechaHora } from '../formato';
import { Aviso, Bloque, BuscadorLead, Chip, ChipEstado, Datos, Encabezado, NOMBRE_ESTADO, soles } from '../components/ui';

type Fila = Record<string, any>;
interface Ficha { persona: Fila; oportunidades: Fila[]; perfiles: Fila[]; diagnosticos: Fila[]; responsables: Fila[]; propuestas: Fila[];
  respuestas: Fila[]; objeciones: Fila[]; escalamientos: Fila[]; citas: Fila[]; seguimientos: Fila[]; transferencias: Fila[];
  eventos: Fila[]; consentimientos: Fila[] }

const ETAPA: Record<string, string> = { CICLO_IX: 'Ciclo IX', CICLO_X: 'Ciclo X', EGRESADO: 'Egresado', BACHILLER: 'Bachiller' };
const horasEntre = (a: string, b?: string | null) => ((b ? new Date(b) : new Date()).getTime() - new Date(a).getTime()) / 3_600_000;

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

export function Ficha() {
  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const [editarContacto, setEditarContacto] = useState(false);
  const [contactoEditado, setContactoEditado] = useState({ nombres: '', apellidos: '', whatsapp: '', correo: '' });
  const leadId = Number(params.get('lead')) || null;
  const q = useQuery({ queryKey: ['ficha', leadId], enabled: !!leadId, queryFn: () => api.get<Ficha>(`/api/leads/${leadId}/ficha`) });
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
      await cliente.invalidateQueries({ queryKey: ['ficha', leadId] });
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

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <Encabezado ruta="Ficha nominal" titulo="Ficha nominal de negociación">
        <div className="w-full sm:w-[420px]"><BuscadorLead alElegir={(r) => setParams({ lead: String(r.lead_id) })} /></div>
      </Encabezado>

      {!leadId && (
        <div className="tarjeta p-8 text-center">
          <p className="text-sm text-tinta-2">Escribe el nombre del estudiante, su WhatsApp o un identificador (lead, buyer u oportunidad) para ver todos sus datos.</p>
        </div>
      )}
      {q.isLoading && <div className="tarjeta h-40 animate-pulse" />}
      {q.isError && <Aviso>{(q.error as Error).message}</Aviso>}
      {accion.isError && <Aviso>{(accion.error as Error).message}</Aviso>}

      {f && p && (
        <>
          {/* Cabecera de la persona y selección de oportunidad */}
          <section className="tarjeta flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold">{p.nombres} {p.apellidos}</h2>
                {op && <ChipEstado estado={op.estado} />}
                {p.es_demo && <Chip tono="apagado">Dato de prueba</Chip>}
              </div>
              <p className="nota mt-1">Lead #{p.lead_id} · Buyer #{p.buyer_id} · Contacto #{p.contacto_id} · Lead desde {fecha(p.fecha_lead)} · Prioridad {p.prioridad ?? '—'}</p>
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
            </div>
          </section>

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
                  <p className="nota sm:col-span-2">El WhatsApp debe incluir el código de país, por ejemplo 51. Déjalo vacío si no tiene número. Esto no modifica el consentimiento.</p>
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
                ['Ciclo', p.ciclo], ['Avance declarado en BUYERS', p.avance != null ? `${Number(p.avance)} %` : null],
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

            <Bloque titulo="Diagnóstico de tesis" origen="LEADS · DIAGNOSTICO" className="xl:col-span-2"
              accion={op && op.estado === 'ABIERTA' && !diags.length ? (
                <button className="boton-claro" disabled={accion.isPending}
                  onClick={() => accion.mutate({ url: '/api/diagnosticos', cuerpo: { oportunidadId: opId } })}>Registrar solicitud</button>) : undefined}>
              {diags.length === 0 && <p className="nota">Sin solicitud de diagnóstico.</p>}
              {diags.map((d) => (
                <div key={d.diagnostico_id} className="mb-3 border-b border-linea pb-3 last:mb-0 last:border-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">{situacionDiagnostico(d)}{d.requiere_derivacion && <Chip>Derivado a {d.asesor}</Chip>}</div>
                  <Datos filas={[
                    ['Fecha de solicitud', fechaHora(d.fecha_solicitud)], ['Fecha de entrega', fechaHora(d.fecha_entrega)],
                    ['Tema', d.tema_tesis], ['Tipo de tesis', d.tipo_tesis],
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

            <Bloque titulo="Decisión y responsable de pago" origen="LEADS · RESPONSABLE_PAGO (no tramita cobros)">
              {f.responsables.length === 0 ? <p className="nota">Sin responsable registrado.</p> : f.responsables.map((r) => (
                <Datos key={r.responsable_pago_id} filas={[
                  ['Responsable', r.nombre], ['Tipo', r.tipo_responsable], ['Relación', r.tipo_relacion],
                  ['Participa en la decisión', r.participa_decision ? 'Sí' : 'No'],
                ]} />
              ))}
            </Bloque>

            <Bloque titulo="Propuestas y objeciones" origen="LEADS · PROPUESTA, RESPUESTA_PROPUESTA, OBJECION, ESCALAMIENTO" className="xl:col-span-2"
              accion={op && ['APTA_PARA_COTIZAR', 'EN_NEGOCIACION'].includes(op.estado) ? <Link className="boton-claro" to={`/leads/cotizador?op=${opId}`}>Abrir cotizador</Link> : undefined}>
              {props.length === 0 && <p className="nota">Sin propuestas presentadas.</p>}
              {props.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead><tr className="border-b border-linea-fuerte text-left text-xs text-tinta-3">
                      <th className="py-2 pr-3 font-medium">Versión</th><th className="py-2 pr-3 font-medium">Servicio</th>
                      <th className="py-2 pr-3 text-right font-medium">Precio final</th><th className="py-2 pr-3 font-medium">Presentada</th>
                      <th className="py-2 pr-3 font-medium">Vigencia</th><th className="py-2 pr-3 font-medium">Estado y respuesta</th></tr></thead>
                    <tbody>{props.map((x) => (
                      <tr key={x.propuesta_id} className="border-b border-linea align-top">
                        <td className="py-2 pr-3 font-semibold">v{x.version}</td><td className="py-2 pr-3">{x.servicio}</td>
                        <td className="py-2 pr-3 text-right font-semibold">{soles(x.precio_final)}</td>
                        <td className="py-2 pr-3">{fechaHora(x.fecha_presentacion)}</td><td className="py-2 pr-3">{fecha(x.vigencia_hasta)}</td>
                        <td className="py-2 pr-3"><Chip tono={x.estado === 'ACEPTADA' ? 'bueno' : x.estado === 'RECHAZADA' ? 'malo' : 'neutro'}>{x.estado}</Chip>
                          {respuestaDe(x.propuesta_id).map((r) => <div key={r.respuesta_id} className="nota mt-1">{r.tipo_respuesta} · {fechaHora(r.fecha_respuesta)}</div>)}</td>
                      </tr>))}</tbody>
                  </table>
                </div>
              )}
              {objs.map((o) => (
                <div key={o.objecion_id} className="mt-3 rounded-lg border border-linea p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2"><strong>Objeción · {o.grupo}</strong><span className="text-tinta-3">{o.tipo} · sobre v{o.version} · {fechaHora(o.fecha_registro)}</span>
                    <Chip tono={o.estado === 'RESUELTA' ? 'bueno' : 'regular'}>{o.estado === 'RESUELTA' ? '● Recuperada' : '▲ Pendiente'}</Chip>
                    {o.escalada && <Chip tono="malo">■ Escalada</Chip>}</div>
                  {o.respuesta_agente && <p className="mt-1 text-tinta-2"><span className="text-tinta-3">Respuesta del agente: </span>{o.respuesta_agente}</p>}
                </div>
              ))}
              {escs.map((e) => (
                <div key={e.escalamiento_id} className="mt-3 rounded-lg border border-linea p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2"><strong>Escalamiento · {e.motivo.replaceAll('_', ' ').toLowerCase()}</strong>
                    <span className="text-tinta-3">a {e.destino_rol.toLowerCase()} · {fechaHora(e.fecha)}</span>
                    {e.fecha_atencion ? <Chip tono="bueno">● Atendido</Chip> : <Chip tono="malo">■ Pendiente</Chip>}</div>
                  {e.resumen && <p className="mt-1 text-tinta-2">{e.resumen}</p>}
                </div>
              ))}
            </Bloque>

            <Bloque titulo="Agenda y seguimiento" origen="LEADS · CITA_VIRTUAL, SEGUIMIENTO_LEAD">
              {citas.length === 0 && segs.length === 0 && <p className="nota">Sin citas ni seguimientos. La cita es opcional: el estudiante puede seguir por WhatsApp.</p>}
              <ul className="space-y-2 text-sm">
                {citas.map((c) => <li key={c.cita_id} className="flex flex-wrap items-center gap-2"><Chip>{c.estado}</Chip>{fechaHora(c.inicio)} · {c.medio} · {c.asesor}</li>)}
                {segs.map((s) => <li key={s.seguimiento_lead_id} className="text-tinta-2">{fechaHora(s.fecha_accion)} · {s.resultado}<span className="nota block">Siguiente: {s.siguiente_accion}</span></li>)}
              </ul>
            </Bloque>

            <Bloque titulo="Estado de la oportunidad" origen="LEADS · OPORTUNIDAD_COMERCIAL, TRANSFERENCIA_PAYER, CONVERSION_PAYER_REF" className="xl:col-span-2"
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
              <h3 className="mt-4 text-sm font-semibold">Línea de tiempo</h3>
              <ol className="mt-2 space-y-0 border-l border-linea-fuerte pl-4">
                {eventos.map((e) => (
                  <li key={e.evento_id} className="relative pb-3">
                    <span className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ${e.estado_nuevo ? 'bg-tinta' : 'border border-tinta bg-white'}`} aria-hidden />
                    <div className="text-sm"><strong>{e.estado_nuevo ? NOMBRE_ESTADO[e.estado_nuevo] ?? e.estado_nuevo : (() => { const t = e.evento.replaceAll('_', ' ').toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); })()}</strong>
                      {e.detalle && <span className="text-tinta-2"> · {e.detalle}</span>}</div>
                    <div className="nota">{fechaHora(e.fecha)} · {e.origen === 'AGENTE' ? 'Agente IA' : e.origen === 'HUMANO' ? 'Asesor' : e.origen === 'SEED' ? 'Dato de prueba' : e.origen}</div>
                  </li>
                ))}
              </ol>
            </Bloque>

            <Bloque titulo="Consentimiento" origen="Ley 29733 · CONSENTIMIENTO_HISTORIAL">
              <ul className="space-y-2 text-sm">{f.consentimientos.map((c) => (
                <li key={c.consentimiento_id}><Chip tono={c.accion === 'OTORGA' ? 'bueno' : 'malo'}>{c.accion === 'OTORGA' ? '● Otorga' : '■ Revoca'}</Chip>
                  <span className="ml-2">{fechaHora(c.fecha)} · {c.medio}</span><span className="nota block">{c.evidencia}</span></li>))}
              </ul>
              <button className="boton-claro mt-3" onClick={() => navegar('/leads/consentimiento')}>Gestionar consentimiento</button>
            </Bloque>
          </div>
        </>
      )}
    </div>
  );
}
