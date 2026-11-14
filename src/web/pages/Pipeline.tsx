// Pipeline de oportunidades: vista de tablero (kanban por estado) o de lista (tabla ordenable y paginada).
// Los filtros viven en la URL: se pueden compartir y sobreviven a recargar la página.
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fecha } from '../formato';
import { Aviso, BarraFiltros, CampoBusqueda, Chip, ChipEstado, Encabezado, NOMBRE_ESTADO, ORDEN_ESTADOS, SelectFiltro, Segmentos, Tabla,
  coincide, soles, unicos, useFiltros } from '../components/ui';
import { useLiveEvents } from '../hooks/useLiveEvents';

interface Op { oportunidad_id: number; lead_id: number; estado: string; fecha_inicio: string; es_demo: boolean; estudiante: string;
  responsable: string; canal: string | null; carrera: string | null; grupo_etapa: string; desde: string | null; precio: number | null; version: number | null }

/** «Redes sociales (TikTok)» → «TikTok». */
const canalCorto = (c: string) => c.replace(/^Redes sociales \((.*)\)$/, '$1');
const dias = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null);
const ORDENES: Record<string, (a: Op, b: Op) => number> = {
  recientes: (a, b) => +new Date(b.fecha_inicio) - +new Date(a.fecha_inicio),
  estancadas: (a, b) => (dias(b.desde) ?? -1) - (dias(a.desde) ?? -1),
  monto: (a, b) => (b.precio ?? -1) - (a.precio ?? -1),
  nombre: (a, b) => a.estudiante.localeCompare(b.estudiante, 'es'),
};

export function Pipeline() {
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const q = useQuery({ queryKey: ['pipeline'], queryFn: () => api.get<Op[]>('/api/pipeline') });
  // Sin esto el tablero solo refleja lo que el agente avanzó por WhatsApp al recargar la página a mano.
  useLiveEvents({ oltp: () => cliente.invalidateQueries({ queryKey: ['pipeline'] }) });
  const { f, fijar, activos } = useFiltros({ vista: 'tablero', texto: '', asesor: '', canal: '', etapa: '', datos: '', cerradas: '', orden: 'recientes' });
  const datos = q.data ?? [];
  const filtradas = useMemo(() => datos.filter((o) =>
    (!f.asesor || o.responsable === f.asesor) && (!f.canal || o.canal === f.canal) && (!f.etapa || o.grupo_etapa === f.etapa) &&
    (!f.datos || (f.datos === 'prueba' ? o.es_demo : !o.es_demo)) && coincide(f.texto, o.estudiante, o.carrera, o.oportunidad_id))
    .sort(ORDENES[f.orden] ?? ORDENES.recientes), [datos, f.asesor, f.canal, f.etapa, f.datos, f.texto, f.orden]);
  const verCerradas = f.cerradas === '1';
  // ABIERTA sigue siendo el punto de partida real del embudo (para medir ese tiempo en los KPI), aunque el
  // diagnóstico ya venga resuelto de BUYERS: solo se confirma por WhatsApp, no se salta ese estado.
  // PAYER_CONFIRMADO ya es el cierre exitoso real (coincide con la bandeja de PAYERS); TRANSFERIDA es
  // un estado técnico que la pasarela de pago ya no usa para leads nuevos, así que se oculta por defecto.
  const columnas = ORDEN_ESTADOS.filter((e) => verCerradas || (e !== 'DESCARTADA' && e !== 'TRANSFERIDA'));
  const abrir = (o: Op) => navegar(`/leads/ficha?lead=${o.lead_id}&op=${o.oportunidad_id}`);
  const enJuego = filtradas.filter((o) => !['DESCARTADA', 'TRANSFERIDA', 'PAYER_CONFIRMADO'].includes(o.estado));
  const montoEnJuego = enJuego.reduce((s, o) => s + Number(o.precio ?? 0), 0);
  // «vista» y «orden» no cuentan como filtros activos.
  const nFiltros = activos - (f.vista !== 'tablero' ? 1 : 0) - (f.orden !== 'recientes' ? 1 : 0);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
      <Encabezado ruta="Pipeline" titulo="Pipeline de oportunidades">
        <Segmentos etiqueta="Vista" valor={f.vista} alCambiar={(v) => fijar({ vista: v })}
          opciones={[{ v: 'tablero', t: '▦ Tablero' }, { v: 'lista', t: '☰ Lista' }]} />
      </Encabezado>

      <BarraFiltros activos={nFiltros} alLimpiar={() => fijar({ texto: '', asesor: '', canal: '', etapa: '', datos: '', cerradas: '' })}
        resultado={<><strong className="text-tinta">{filtradas.length.toLocaleString('es-PE')}</strong> de {datos.length.toLocaleString('es-PE')} oportunidades
          · {enJuego.length} abiertas · <strong className="text-tinta">{soles(montoEnJuego)}</strong> en propuestas abiertas</>}>
        <CampoBusqueda valor={f.texto} alCambiar={(v) => fijar({ texto: v })} placeholder="Estudiante, carrera o N.º" />
        <SelectFiltro etiqueta="Responsable" valor={f.asesor} alCambiar={(v) => fijar({ asesor: v })} opciones={unicos(datos.map((o) => o.responsable))} />
        <SelectFiltro etiqueta="Canal" valor={f.canal} alCambiar={(v) => fijar({ canal: v })} opciones={unicos(datos.map((o) => o.canal))} />
        <SelectFiltro etiqueta="Grupo de etapa" valor={f.etapa} alCambiar={(v) => fijar({ etapa: v })} opciones={unicos(datos.map((o) => o.grupo_etapa))} />
        <SelectFiltro etiqueta="Datos" valor={f.datos} alCambiar={(v) => fijar({ datos: v })} opciones={[['reales', 'Solo reales'], ['prueba', 'Solo de prueba']]} />
        <SelectFiltro etiqueta="Ordenar por" valor={f.orden === 'recientes' ? '' : f.orden} alCambiar={(v) => fijar({ orden: v || 'recientes' })} todos="Más recientes"
          opciones={[['estancadas', 'Más días en el estado'], ['monto', 'Mayor monto'], ['nombre', 'Nombre (A–Z)']]} />
        <label className="flex min-h-[44px] items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="h-5 w-5 accent-black" checked={verCerradas} onChange={(e) => fijar({ cerradas: e.target.checked ? '1' : '' })} />
          Ver descartadas y transferidas (estado antiguo)</label>
      </BarraFiltros>
      {q.isError && <Aviso>{(q.error as Error).message}</Aviso>}
      {q.isLoading && <div className="tarjeta h-80 animate-pulse" aria-hidden />}

      {q.data && f.vista === 'tablero' && (
        <div className="flex gap-3 overflow-x-auto pb-3" role="list" aria-label="Columnas por estado">
          {columnas.map((estado) => {
            const ops = filtradas.filter((o) => o.estado === estado);
            const total = ops.reduce((s, o) => s + Number(o.precio ?? 0), 0);
            return (
              <section key={estado} role="listitem" className="flex w-72 shrink-0 flex-col rounded-tarjeta border border-linea bg-[#ECECE8]">
                <header className="border-b border-linea px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">{NOMBRE_ESTADO[estado]}</h2>
                    <span className="rounded-full bg-white px-2 text-xs font-semibold tabular-nums">{ops.length}</span>
                  </div>
                  {total > 0 && <div className="nota mt-0.5 tabular-nums">{soles(total)}</div>}
                </header>
                <ul className="flex max-h-[66vh] flex-col gap-2 overflow-y-auto p-2">
                  {ops.map((o) => {
                    const d = dias(o.desde);
                    return (
                      <li key={o.oportunidad_id}>
                        <button className="tarjeta w-full p-3 text-left transition-shadow hover:border-tinta hover:shadow-sm" onClick={() => abrir(o)}>
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-semibold leading-snug">{o.estudiante}</span>
                            <span className="nota shrink-0">#{o.oportunidad_id}</span>
                          </div>
                          <div className="nota mt-0.5 truncate">{o.carrera ?? 'Sin perfil académico'} · {o.grupo_etapa}</div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <Chip>{o.responsable}</Chip>
                            {o.canal && <Chip tono="apagado">{canalCorto(o.canal)}</Chip>}
                            {o.es_demo && <Chip tono="apagado">Prueba</Chip>}
                          </div>
                          <div className="mt-2 flex justify-between gap-2 border-t border-linea pt-2 text-xs text-tinta-3">
                            <span className="tabular-nums">{o.precio ? <strong className="text-tinta">{soles(o.precio)}</strong> : `Inicio ${fecha(o.fecha_inicio)}`}{o.version ? ` · v${o.version}` : ''}</span>
                            {d !== null && <span className={d >= 7 ? 'font-semibold text-regular-texto' : ''}>{d >= 7 ? '▲ ' : ''}{d} d</span>}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                  {ops.length === 0 && <li className="px-2 py-6 text-center nota">Sin oportunidades</li>}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {q.data && f.vista === 'lista' && (
        <section className="tarjeta p-4">
          <Tabla filas={filtradas.filter((o) => verCerradas || !['DESCARTADA', 'TRANSFERIDA'].includes(o.estado))} clave={(o) => o.oportunidad_id}
            alClic={abrir} vacio="Ninguna oportunidad coincide con los filtros."
            columnas={[
              { titulo: 'Estudiante', orden: (o) => o.estudiante, celda: (o) => <><div className="font-medium">{o.estudiante}</div>
                <div className="nota">#{o.oportunidad_id} · {o.carrera ?? 'sin perfil'}{o.es_demo ? ' · prueba' : ''}</div></> },
              { titulo: 'Estado', orden: (o) => ORDEN_ESTADOS.indexOf(o.estado), celda: (o) => <ChipEstado estado={o.estado} /> },
              { titulo: 'Responsable', orden: (o) => o.responsable, celda: (o) => o.responsable },
              { titulo: 'Canal', orden: (o) => o.canal, celda: (o) => (o.canal ? canalCorto(o.canal) : '—') },
              { titulo: 'Etapa', nowrap: true, orden: (o) => o.grupo_etapa, celda: (o) => o.grupo_etapa },
              { titulo: 'Inicio', nowrap: true, orden: (o) => +new Date(o.fecha_inicio), celda: (o) => fecha(o.fecha_inicio) },
              { titulo: 'Días en estado', derecha: true, orden: (o) => dias(o.desde), celda: (o) => dias(o.desde) ?? '—' },
              { titulo: 'Monto', derecha: true, orden: (o) => o.precio, celda: (o) => (o.precio ? <>{soles(o.precio)}<div className="nota">v{o.version}</div></> : '—') },
            ]} />
        </section>
      )}
    </div>
  );
}
