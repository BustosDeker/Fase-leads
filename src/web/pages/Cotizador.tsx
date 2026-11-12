// Cotizador versionado: base + extras + recargos − descuentos con la regla aplicada, vigencia y versión.
// Si lo pedido supera el tope de descuento o deja el precio bajo el mínimo, la propuesta queda BLOQUEADA.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fecha, fechaHora } from '../formato';
import { Aviso, Bloque, BuscadorLead, Chip, ChipEstado, Encabezado, soles } from '../components/ui';

interface Ajuste { tipo: 'DESCUENTO' | 'RECARGO'; concepto: string; porcentaje: number; monto: number }
interface Cotizacion { precioBase: number; montoExtras: number; recargo: number; descuento: number; precioFinal: number; precioMinimo: number;
  topeDescuentoPct: number; ajustes: Ajuste[]; extras: { nombre: string; cantidad: number; precioUnitario: number }[]; avisos: string[] }
interface Contexto {
  oportunidad: { oportunidad_id: number; estado: string; lead_id: number; estudiante: string; universidad: string | null; carrera: string | null;
    etapa_academica: string | null; avance_declarado: number | null; tipo_tesis: string | null; fecha_limite: string | null };
  servicios: { servicioId: number; nombre: string; familia: string; tarifa: { precioBase: number; precioMinimo: number; topeDescuentoPct: number } }[];
  extras: { entregableId: number; nombre: string; precioUnitario: number }[];
  versiones: { propuesta_id: number; version: number; fecha_presentacion: string; vigencia_hasta: string; estado: string; servicio: string;
    precio_base: number; monto_extras: number; recargo: number; descuento: number; precio_final: number; respuesta: string | null;
    ajustes: Ajuste[]; entregables: { nombre: string; cantidad: number; precio_unitario: number; es_extra: boolean }[] }[];
}

function Desglose({ q }: { q: Pick<Cotizacion, 'precioBase' | 'montoExtras' | 'recargo' | 'descuento' | 'precioFinal'> & { ajustes?: Ajuste[] } }) {
  const fila = (t: string, v: string, fuerte = false) => (
    <div className={`flex justify-between py-1 ${fuerte ? 'border-t-2 border-tinta pt-2 text-base font-bold' : 'text-sm'}`}><span>{t}</span><span>{v}</span></div>);
  return (
    <div>
      {fila('Precio base (tarifa)', soles(q.precioBase))}
      {fila('+ Extras', soles(q.montoExtras))}
      {fila('+ Recargos', soles(q.recargo))}
      {(q.ajustes ?? []).filter((a) => a.tipo === 'RECARGO').map((a) => <div key={a.concepto} className="flex justify-between py-0.5 pl-3 text-xs text-tinta-3"><span>{a.concepto} ({Number(a.porcentaje)} %)</span><span>+ {soles(a.monto)}</span></div>)}
      {fila('− Descuentos', soles(q.descuento))}
      {(q.ajustes ?? []).filter((a) => a.tipo === 'DESCUENTO').map((a) => <div key={a.concepto} className="flex justify-between py-0.5 pl-3 text-xs text-tinta-3"><span>{a.concepto} ({Number(a.porcentaje).toLocaleString('es')} %)</span><span>− {soles(a.monto)}</span></div>)}
      {fila('Precio final', soles(q.precioFinal), true)}
    </div>
  );
}

export function Cotizador() {
  const [params, setParams] = useSearchParams();
  const cliente = useQueryClient();
  const opId = Number(params.get('op')) || null;
  const cx = useQuery({ queryKey: ['cotizador', opId], enabled: !!opId, queryFn: () => api.get<Contexto>(`/api/cotizador/${opId}`) });
  const [s, setS] = useState({ servicioId: 0, formaPago: 'CUOTAS' as 'CONTADO' | 'CUOTAS', aplicarPromocion: false, descuentoNegociadoPct: 0, extras: [] as number[] });
  useEffect(() => { if (cx.data && !s.servicioId) setS((x) => ({ ...x, servicioId: cx.data!.servicios[0]?.servicioId ?? 0 })); }, [cx.data, s.servicioId]);
  const solicitud = { oportunidadId: opId, ...s, extras: s.extras.map((e) => ({ entregableId: e, cantidad: 1 })) };
  const sim = useQuery({ queryKey: ['simular', solicitud], enabled: !!opId && !!s.servicioId,
    queryFn: () => api.post<{ cotizacion: Cotizacion; bloqueada: boolean; motivosBloqueo: string[]; avisos: string[] }>('/api/cotizador/simular', solicitud) });
  const presentar = useMutation({
    mutationFn: () => api.post<{ version: number; precioFinal: number }>('/api/cotizador/presentar', solicitud),
    onSuccess: () => { cliente.invalidateQueries({ queryKey: ['cotizador', opId] }); setS((x) => ({ ...x, descuentoNegociadoPct: 0 })); },
  });
  const d = cx.data;
  const editable = d && ['APTA_PARA_COTIZAR', 'EN_NEGOCIACION'].includes(d.oportunidad.estado);
  const siguiente = (d?.versiones.at(-1)?.version ?? 0) + 1;
  const tarifa = d?.servicios.find((x) => x.servicioId === s.servicioId)?.tarifa;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <Encabezado ruta="Cotizador" titulo="Cotizador versionado">
        <div className="w-full sm:w-[420px]"><BuscadorLead placeholder="Buscar estudiante para cotizar…"
          alElegir={async (r) => {
            const f = await api.get<{ oportunidades: { oportunidad_id: number }[] }>(`/api/leads/${r.lead_id}/ficha`);
            if (f.oportunidades[0]) setParams({ op: String(f.oportunidades[0].oportunidad_id) });
          }} /></div>
      </Encabezado>
      {!opId && <div className="tarjeta p-8 text-center text-sm text-tinta-2">Elige un estudiante o abre el cotizador desde su ficha nominal.</div>}
      {cx.isError && <Aviso>{(cx.error as Error).message}</Aviso>}

      {d && (
        <>
          <section className="tarjeta flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-bold">{d.oportunidad.estudiante}</h2><ChipEstado estado={d.oportunidad.estado} /></div>
              <p className="nota mt-1">Oportunidad #{d.oportunidad.oportunidad_id} · {d.oportunidad.carrera ?? 'sin carrera'} · {d.oportunidad.universidad ?? 'sin universidad'} ·
                avance {d.oportunidad.avance_declarado != null ? `${Number(d.oportunidad.avance_declarado)} %` : '—'} · tesis {d.oportunidad.tipo_tesis ?? '—'} ·
                fecha límite {fecha(d.oportunidad.fecha_limite)}</p>
            </div>
            <Link className="boton-claro" to={`/leads/ficha?lead=${d.oportunidad.lead_id}&op=${d.oportunidad.oportunidad_id}`}>Ver ficha</Link>
          </section>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <Bloque titulo={`Nueva versión (v${siguiente})`} origen="Precio desde TARIFA + REGLA_PRECIO vigentes; el agente no puede inventar montos" className="xl:col-span-2">
              {!editable && <Aviso tipo="info">Solo se cotiza una oportunidad apta para cotizar o en negociación (estado actual: {d.oportunidad.estado}).</Aviso>}
              {d.servicios.length === 0 && <Aviso>No hay tarifa configurada para la carrera del estudiante: corresponde escalar a un humano.</Aviso>}
              <div className="mt-2 grid grid-cols-1 gap-3">
                <label><span className="etiqueta-campo">Servicio</span>
                  <select className="campo" value={s.servicioId} onChange={(e) => setS({ ...s, servicioId: +e.target.value })} disabled={!editable}>
                    {d.servicios.map((x) => <option key={x.servicioId} value={x.servicioId}>{x.nombre} · {soles(x.tarifa.precioBase)}</option>)}</select></label>
                {tarifa && <p className="nota">Precio mínimo {soles(tarifa.precioMinimo)} · tope de descuento {tarifa.topeDescuentoPct} %</p>}
                <div className="grid grid-cols-2 gap-3">
                  <label><span className="etiqueta-campo">Forma de pago</span>
                    <select className="campo" value={s.formaPago} onChange={(e) => setS({ ...s, formaPago: e.target.value as 'CONTADO' | 'CUOTAS' })} disabled={!editable}>
                      <option value="CUOTAS">En cuotas</option><option value="CONTADO">Al contado</option></select></label>
                  <label><span className="etiqueta-campo">Ajuste negociado (%)</span>
                    <input type="number" min={0} max={50} step={0.5} className="campo" value={s.descuentoNegociadoPct} disabled={!editable}
                      onChange={(e) => setS({ ...s, descuentoNegociadoPct: Math.max(0, +e.target.value) })} /></label>
                </div>
                <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-black" checked={s.aplicarPromocion}
                  disabled={!editable} onChange={(e) => setS({ ...s, aplicarPromocion: e.target.checked })} />Aplicar promoción de temporada</label>
                <fieldset><legend className="etiqueta-campo">Extras</legend>
                  {d.extras.map((x) => (
                    <label key={x.entregableId} className="flex min-h-[40px] items-center gap-2 text-sm">
                      <input type="checkbox" className="h-5 w-5 accent-black" disabled={!editable} checked={s.extras.includes(x.entregableId)}
                        onChange={(e) => setS({ ...s, extras: e.target.checked ? [...s.extras, x.entregableId] : s.extras.filter((y) => y !== x.entregableId) })} />
                      {x.nombre} · {soles(x.precioUnitario)}</label>))}
                </fieldset>
              </div>
            </Bloque>

            <Bloque titulo="Desglose" origen="Cálculo en el servidor con las reglas vigentes" className="xl:col-span-3">
              {sim.isError && <Aviso>{(sim.error as Error).message}</Aviso>}
              {sim.data && (
                <>
                  {sim.data.bloqueada && (
                    <div className="mb-3 rounded-lg border-2 border-malo-marca bg-malo-fondo p-3 text-sm text-malo-texto" role="alert">
                      <strong>■ Propuesta bloqueada.</strong> {sim.data.motivosBloqueo.join(' ')} Reduce el ajuste o escala el caso a un humano.
                    </div>
                  )}
                  {!sim.data.bloqueada && sim.data.avisos.length > 0 && (
                    <div className="mb-3"><Aviso tipo="info">Descuentos automáticos acotados al tope: {sim.data.avisos.join(' ')}</Aviso></div>
                  )}
                  <Desglose q={sim.data.cotizacion} />
                  <p className="nota mt-2">Vigencia: 7 días desde la presentación. Entregables estándar del servicio incluidos sin costo.</p>
                  {presentar.isError && <div className="mt-3"><Aviso>{(presentar.error as Error).message}</Aviso></div>}
                  {presentar.data && <div className="mt-3"><Aviso tipo="ok">Versión {presentar.data.version} presentada: {soles(presentar.data.precioFinal)}.</Aviso></div>}
                  <button className="boton-negro mt-3 w-full" disabled={!editable || sim.data.bloqueada || presentar.isPending}
                    onClick={() => presentar.mutate()}>{presentar.isPending ? 'Registrando…' : `Presentar versión ${siguiente}`}</button>
                </>
              )}
            </Bloque>
          </div>

          <Bloque titulo="Versiones presentadas" origen="Cada modificación es una nueva versión; la aceptación se asocia a una versión concreta">
            {d.versiones.length === 0 ? <p className="nota">Aún no hay propuestas.</p> : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {d.versiones.map((v, i) => {
                  const ant = d.versiones[i - 1];
                  const dif = ant ? Number(v.precio_final) - Number(ant.precio_final) : null;
                  return (
                    <article key={v.propuesta_id} className="rounded-lg border border-linea p-4">
                      <div className="flex items-center justify-between"><strong>Versión {v.version}</strong>
                        <Chip tono={v.estado === 'ACEPTADA' ? 'bueno' : v.estado === 'RECHAZADA' ? 'malo' : v.estado === 'PRESENTADA' ? 'neutro' : 'apagado'}>{v.estado}</Chip></div>
                      <p className="nota mb-2">{v.servicio} · {fechaHora(v.fecha_presentacion)} · vigente hasta {fecha(v.vigencia_hasta)}{v.respuesta ? ` · respuesta: ${v.respuesta}` : ''}</p>
                      <Desglose q={{ precioBase: Number(v.precio_base), montoExtras: Number(v.monto_extras), recargo: Number(v.recargo),
                        descuento: Number(v.descuento), precioFinal: Number(v.precio_final), ajustes: v.ajustes }} />
                      {dif !== null && <p className="mt-2 text-xs text-tinta-2">Frente a v{ant!.version}: {dif === 0 ? 'mismo precio' : `${dif < 0 ? '−' : '+'} ${soles(Math.abs(dif))}`}</p>}
                    </article>
                  );
                })}
              </div>
            )}
          </Bloque>
        </>
      )}
    </div>
  );
}
