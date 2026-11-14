// Estructura general: menú lateral oscuro con el embudo IMPULSE numerado 1–5, LEADS activa con sus
// submenús, las otras fases con su integración, Agente Plataforma al final y, al pie, el estado de
// WhatsApp y SQL Server. En móvil el menú se apila sobre el contenido y se puede plegar.
import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLiveEvents } from '../hooks/useLiveEvents';
import { api, type Salud } from '../api';
import { NOMBRE_ROL, useSesion } from './Sesion';

const SUBMENU_LEADS = [
  { a: '/leads/ficha', t: 'Ficha nominal' },
  { a: '/leads/conversaciones', t: 'Conversaciones' },
  { a: '/leads/pipeline', t: 'Pipeline' },
  { a: '/leads/diagnosticos', t: 'Diagnósticos' },
  { a: '/leads/cotizador', t: 'Cotizador' },
  { a: '/leads/objeciones', t: 'Objeciones y escalamientos' },
  { a: '/leads/agenda', t: 'Agenda' },
  { a: '/leads/consentimiento', t: 'Consentimiento' },
  { a: '/leads/tablero', t: 'Tablero BI' },
  { a: '/leads/auditoria', t: 'Auditoría' },
];
const FASES = [
  { n: 1, id: 'buyers', t: 'BUYERS' },
  { n: 2, id: 'leads', t: 'LEADS' },
  { n: 3, id: 'payers', t: 'PAYERS' },
];

function Indicador({ etiqueta, ok, texto }: { etiqueta: string; ok: boolean | null; texto: string }) {
  const color = ok === null ? 'bg-menu-texto' : ok ? 'bg-bueno-marca' : 'bg-malo-marca';
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-menu-texto">{etiqueta}</span>
      <span className="flex items-center gap-1.5 text-white">
        <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden />
        {texto}
      </span>
    </div>
  );
}

const ETIQUETA_WA: Record<string, string> = { CONECTADO: 'Conectado', NO_CONFIGURADO: 'No configurado', SIN_CONEXION: 'OpenWA apagado',
  DESCONECTADO: 'Desconectado', CONECTANDO: 'Conectando…', ESPERANDO_QR: 'Esperando QR', ERROR: 'Con error' };

export function Layout({ children }: { children: ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  const { pathname } = useLocation();
  // Cualquier registro en el OLTP (agente, asesor o PAYERS) refresca las pantallas operativas abiertas.
  // El tablero NO se refresca: lee del data mart y solo cambia al ejecutar el ETL.
  const cliente = useQueryClient();
  const DEL_MART = ['kpis', 'reporte', 'tendencia', 'acciones', 'filtros', 'etl'];
  useLiveEvents({
    oltp: () => cliente.invalidateQueries({ predicate: (q) => !DEL_MART.includes(String(q.queryKey[0])) }),
    whatsapp: () => cliente.invalidateQueries({ queryKey: ['salud'] }),
  });
  const salud = useQuery({ queryKey: ['salud'], queryFn: () => api.get<Salud>('/api/salud'), refetchInterval: 30_000 });
  const sqlOk = salud.data ? salud.data.sqlServer.ok : salud.isError ? false : null;
  const wa = salud.data?.whatsapp.estado;
  const { yo, salir } = useSesion();

  return (
    <div className="min-h-screen md:flex">
      <aside className="no-imprimir bg-menu text-white md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:overflow-y-auto flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 md:py-6">
          <div>
            <div className="text-lg font-bold tracking-wide">INBESTIGA</div>
            <div className="text-xs text-menu-texto">Metodología IMPULSE</div>
          </div>
          <button className="md:hidden boton text-white border border-white/20" onClick={() => setAbierto(!abierto)}
            aria-expanded={abierto} aria-controls="menu-principal">{abierto ? 'Cerrar' : 'Menú'}</button>
        </div>

        <nav id="menu-principal" className={`${abierto ? 'block' : 'hidden'} md:block flex-1 px-3 pb-4`} aria-label="Embudo IMPULSE">
          <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-menu-texto">Embudo IMPULSE</div>
          <ul className="space-y-0.5">
            {FASES.map((f) => {
              const activa = f.id === 'leads';
              return (
                <li key={f.id}>
                  <NavLink to={activa ? '/leads/tablero' : `/fase/${f.id}`} onClick={() => setAbierto(false)}
                    className={() => `flex min-h-[44px] items-center gap-3 rounded-lg px-2 text-sm ${
                      (activa && pathname.startsWith('/leads')) || pathname === `/fase/${f.id}` ? 'bg-menu-2 text-white' : 'text-menu-texto hover:bg-menu-2 hover:text-white'}`}>
                    <span className={`flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold ${activa ? 'bg-white text-tinta' : 'border border-white/25'}`}>{f.n}</span>
                    <span className="flex-1 font-semibold">{f.t}</span>
                    {!activa && <span className="text-[10px] uppercase tracking-wide text-menu-texto/80">{f.id === 'buyers' || f.id === 'payers' ? 'integración' : 'otro equipo'}</span>}
                  </NavLink>
                  {activa && (
                    <ul className="ml-5 mt-0.5 space-y-0.5 border-l border-white/15 pl-3">
                      {SUBMENU_LEADS.map((s) => (
                        <li key={s.a}>
                          <NavLink to={s.a} onClick={() => setAbierto(false)}
                            className={({ isActive }) => `flex min-h-[40px] items-center rounded-md px-2 text-sm ${
                              isActive ? 'bg-white text-tinta font-semibold' : 'text-menu-texto hover:text-white'}`}>{s.t}</NavLink>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-4 border-t border-white/10 pt-3">
            <NavLink to="/plataforma" onClick={() => setAbierto(false)}
              className={({ isActive }) => `flex min-h-[44px] items-center gap-3 rounded-lg px-2 text-sm font-semibold ${
                isActive ? 'bg-menu-2 text-white' : 'text-menu-texto hover:bg-menu-2 hover:text-white'}`}>
              <span className="flex h-6 w-6 items-center justify-center rounded-md border border-white/25 text-xs">◆</span>
              Agente Plataforma
            </NavLink>
            {[{ a: '/evidencias', t: 'Evidencias', s: '✓' }, { a: '/demo', t: 'Guion de demo', s: '▶' }].map((x) => (
              <NavLink key={x.a} to={x.a} onClick={() => setAbierto(false)}
                className={({ isActive }) => `flex min-h-[44px] items-center gap-3 rounded-lg px-2 text-sm font-semibold ${
                  isActive ? 'bg-menu-2 text-white' : 'text-menu-texto hover:bg-menu-2 hover:text-white'}`}>
                <span className="flex h-6 w-6 items-center justify-center rounded-md border border-white/25 text-xs">{x.s}</span>
                {x.t}
              </NavLink>
            ))}
          </div>
        </nav>

        <div className={`${abierto ? 'block' : 'hidden'} md:block space-y-2 border-t border-white/10 px-5 py-4`}>
          <Indicador etiqueta="WhatsApp" ok={wa === 'CONECTADO' ? true : wa ? null : null}
            texto={wa ? (ETIQUETA_WA[wa] ?? wa) : '…'} />
          <Indicador etiqueta="SQL Server" ok={sqlOk} texto={sqlOk === null ? '…' : sqlOk ? 'Conectado' : 'Sin conexión'} />
          <div className="flex items-center justify-between gap-2 border-t border-white/10 pt-3 text-xs">
            <span className="min-w-0 truncate text-white">{yo.usuario} <span className="text-menu-texto">· {NOMBRE_ROL[yo.rol]}</span></span>
            <button className="rounded-md border border-white/25 px-2 py-1 text-white hover:bg-menu-2" onClick={salir}>Salir</button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-7">
        {salud.data && !salud.data.sqlServer.ok && (
          <div role="alert" className="mb-5 rounded-tarjeta border border-malo-marca bg-malo-fondo p-4 text-sm text-malo-texto">
            <strong>■ SQL Server no está disponible.</strong>
            <pre className="mt-2 whitespace-pre-wrap font-sans">{salud.data.sqlServer.error}</pre>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
