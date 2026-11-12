// Agente Plataforma: vista transversal del embudo IMPULSE (BUYERS → LEADS → PAYERS → CUSTOMERS),
// actividad del Agente Negociador en los últimos 7 días y estado de los servicios.
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Aviso, Bloque, Chip, Encabezado, NOMBRE_ESTADO, ORDEN_ESTADOS } from '../components/ui';

type F = Record<string, any>;
const motivo = (m: string) => m.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

export function Plataforma() {
  const navegar = useNavigate();
  const q = useQuery({ queryKey: ['plataforma'], queryFn: () => api.get<F>('/api/plataforma/resumen'), refetchInterval: 30_000 });
  const d = q.data;
  const etapas = d ? [
    { t: 'BUYERS', n: d.embudo.buyers, nota: 'interesados captados', a: '/fase/buyers' },
    { t: 'LEADS', n: d.embudo.leads, nota: 'en negociación', a: '/leads/pipeline' },
    { t: 'Aceptadas', n: d.embudo.aceptadas + d.embudo.transferidas + d.embudo.payers_confirmados, nota: 'propuestas aceptadas', a: '/fase/payers' },
    { t: 'PAYERS', n: d.embudo.payers_confirmados, nota: 'contrataciones confirmadas', a: '/fase/payers' },
    { t: 'CUSTOMERS', n: d.embudo.customers, nota: 'en acompañamiento', a: '/fase/customers' },
  ] : [];
  const maximo = Math.max(1, ...etapas.map((e) => e.n));
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <Encabezado fase="PLATAFORMA" ruta="Agente Plataforma" titulo="Agente Plataforma" />
      {q.isError && <Aviso>{(q.error as Error).message}</Aviso>}
      {!d ? <div className="tarjeta h-64 animate-pulse" aria-hidden /> : <>
        <Bloque titulo="Embudo IMPULSE" origen="Conteos actuales del OLTP (todas las fechas, incluye datos de prueba)">
          <ol className="flex flex-col gap-2">
            {etapas.map((e) => (
              <li key={e.t}>
                <button className="grid w-full grid-cols-[110px_1fr_auto] items-center gap-3 text-left text-sm hover:opacity-80" onClick={() => navegar(e.a)}>
                  <span className="font-semibold">{e.t}</span>
                  <span className="h-6 rounded bg-fondo"><span className="block h-6 rounded bg-tinta" style={{ width: `${Math.max(1, (e.n / maximo) * 100)}%` }} /></span>
                  <span className="w-44 text-right"><strong>{e.n.toLocaleString('es-PE')}</strong> <span className="nota">{e.nota}</span></span>
                </button>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {ORDEN_ESTADOS.map((e) => { const n = d.estados.find((x: F) => x.estado === e)?.n ?? 0;
              return <Chip key={e} tono="neutro">{NOMBRE_ESTADO[e]}: {n}</Chip>; })}
          </div>
        </Bloque>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Bloque titulo="Agente Negociador · 7 días" origen={`${d.agente.proveedor === 'mock' ? 'Modo sin IA (reglas)' : d.agente.modelo}`}>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="nota">Turnos</dt><dd className="text-xl font-bold">{d.agente.turnos}</dd></div>
              <div><dt className="nota">Conversaciones</dt><dd className="text-xl font-bold">{d.agente.conversaciones}</dd></div>
              <div><dt className="nota">Latencia media</dt><dd className="text-xl font-bold">{d.agente.latencia_media ? `${Math.round(d.agente.latencia_media)} ms` : '—'}</dd></div>
              <div><dt className="nota">Con error</dt><dd className="text-xl font-bold">{d.agente.con_error ?? 0}</dd></div>
              <div className="col-span-2"><dt className="nota">Intentos de manipulación detectados</dt><dd className="text-xl font-bold">{d.agente.sospechas ?? 0}</dd></div>
            </dl>
            <button className="boton-claro mt-4" onClick={() => navegar('/leads/conversaciones')}>Ver conversaciones</button>
          </Bloque>
          <Bloque titulo="Derivaciones pendientes" origen="Casos que esperan a una persona">
            {d.escalamientosPendientes.length === 0 ? <p className="nota">● No hay derivaciones pendientes.</p> : (
              <ul className="flex flex-col gap-1.5 text-sm">{d.escalamientosPendientes.map((e: F) => (
                <li key={e.motivo} className="flex justify-between gap-2 border-b border-linea pb-1"><span>{motivo(e.motivo)}</span><strong>{e.n}</strong></li>))}</ul>)}
            <button className="boton-claro mt-4" onClick={() => navegar('/leads/objeciones')}>Ir a la cola</button>
          </Bloque>
          <Bloque titulo="Servicios" origen="Estado al momento de abrir la página">
            <ul className="flex flex-col gap-2 text-sm">
              <li className="flex justify-between gap-2"><span>SQL Server</span><Chip tono="bueno">● Conectado</Chip></li>
              <li className="flex justify-between gap-2"><span>WhatsApp (OpenWA)</span>
                <Chip tono={d.whatsapp.estado === 'CONECTADO' ? 'bueno' : d.whatsapp.estado === 'SIN_CONEXION' || d.whatsapp.estado === 'ERROR' ? 'malo' : 'apagado'}>
                  {d.whatsapp.estado === 'CONECTADO' ? '● Conectado' : d.whatsapp.estado === 'SIN_CONEXION' ? '■ Apagado' : '– ' + d.whatsapp.estado.toLowerCase().replace('_', ' ')}</Chip></li>
              <li className="flex justify-between gap-2"><span>Conversaciones abiertas</span>
                <span>{d.conversacionesAbiertas.map((c: F) => `${c.canal === 'SIMULADOR' ? 'Simulador' : 'WhatsApp'}: ${c.n}`).join(' · ') || '0'}</span></li>
            </ul>
            <button className="boton-claro mt-4" onClick={() => navegar('/leads/tablero')}>Tablero BI y «Explicar este tablero»</button>
          </Bloque>
        </div>
      </>}
    </div>
  );
}
