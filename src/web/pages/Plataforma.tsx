// Agente Plataforma: vista transversal del embudo IMPULSE (BUYERS → LEADS → PAYERS → CUSTOMERS),
// actividad del Agente Negociador en los últimos 7 días y estado de los servicios.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Aviso, Bloque, Chip, Encabezado, NOMBRE_ESTADO, ORDEN_ESTADOS } from '../components/ui';
import { useSesion } from '../components/Sesion';

type F = Record<string, any>;
const motivo = (m: string) => m.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

const NOMBRE_PROVEEDOR: Record<string, string> = { mock: 'Sin IA (reglas)', anthropic: 'Anthropic (Claude)', openai: 'OpenAI', gemini: 'Gemini (Google)', groq: 'Groq' };

/** Un slot de proveedor (principal o de respaldo): edita proveedor, modelo y API key sin tocar .env. */
function SlotProveedor({ slot, titulo, nota, inicial }: { slot: 'PRIMARIO' | 'SECUNDARIO'; titulo: string; nota: string; inicial: F }) {
  const cliente = useQueryClient();
  const [proveedor, setProveedor] = useState(inicial.proveedor);
  const [modelo, setModelo] = useState(inicial.modelo ?? '');
  const [apiKey, setApiKey] = useState('');
  const [activo, setActivo] = useState(inicial.activo);
  const [editandoKey, setEditandoKey] = useState(!inicial.keyConfigurada);
  const guardar = useMutation({
    mutationFn: () => api.post(`/api/agente/configuracion/${slot}`, { proveedor, modelo: modelo || undefined, apiKey: apiKey || undefined, activo }),
    onSuccess: () => { setApiKey(''); setEditandoKey(false); cliente.invalidateQueries({ queryKey: ['configuracion-agente'] }); },
  });
  const quitarClave = useMutation({
    mutationFn: () => api.delete(`/api/agente/configuracion/${slot}/clave`),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['configuracion-agente'] }),
  });
  return (
    <Bloque titulo={titulo} origen={nota}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); guardar.mutate(); }}>
        <label><span className="etiqueta-campo">Proveedor</span>
          <select className="campo" value={proveedor} onChange={(e) => setProveedor(e.target.value)}>
            {Object.entries(NOMBRE_PROVEEDOR).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select></label>
        {proveedor !== 'mock' && <>
          <label><span className="etiqueta-campo">Modelo (opcional: usa el de por defecto si lo dejas vacío)</span>
            <input className="campo" value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="p. ej. claude-haiku-5-5" /></label>
          <div>
            <span className="etiqueta-campo flex items-center gap-2">API key
              {inicial.keyConfigurada && <Chip tono="bueno">● Activa · termina en {inicial.keySufijo}</Chip>}</span>
            {editandoKey ? (
              <input className="campo" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Pega aquí tu API key" autoComplete="off" autoFocus={inicial.keyConfigurada} />
            ) : (
              <div className="flex items-center gap-2">
                <input className="campo flex-1" value={`•••• •••• •••• ${inicial.keySufijo}`} readOnly disabled />
                <button type="button" className="boton-claro shrink-0" onClick={() => setEditandoKey(true)}>Cambiar</button>
              </div>
            )}
          </div>
        </>}
        <label className="flex min-h-[36px] items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-black" checked={activo} onChange={(e) => setActivo(e.target.checked)} />Activo</label>
        {guardar.isError && <Aviso>{(guardar.error as Error).message}</Aviso>}
        <div className="flex flex-wrap gap-2">
          <button className="boton-negro" disabled={guardar.isPending}>{guardar.isPending ? 'Guardando…' : 'Guardar'}</button>
          {inicial.keyConfigurada && <button type="button" className="boton-claro border-malo-marca text-malo-texto" disabled={quitarClave.isPending}
            onClick={() => { if (window.confirm('¿Quitar la API key guardada de este proveedor? Se desactivará el slot.')) quitarClave.mutate(); }}>Quitar clave</button>}
        </div>
      </form>
    </Bloque>
  );
}

export function Plataforma() {
  const navegar = useNavigate();
  const { yo } = useSesion();
  const q = useQuery({ queryKey: ['plataforma'], queryFn: () => api.get<F>('/api/plataforma/resumen'), refetchInterval: 30_000 });
  const configAgente = useQuery({ queryKey: ['configuracion-agente'], enabled: yo.rol === 'admin',
    queryFn: () => api.get<{ slots: F[] }>('/api/agente/configuracion') });
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

        {yo.rol === 'admin' && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {configAgente.isError && <Aviso>{(configAgente.error as Error).message}</Aviso>}
            {!configAgente.data ? <div className="tarjeta h-64 animate-pulse lg:col-span-2" aria-hidden /> : configAgente.data.slots.map((s: F) => (
              <SlotProveedor key={s.slot} slot={s.slot} inicial={s}
                titulo={s.slot === 'PRIMARIO' ? 'Proveedor de IA · principal' : 'Proveedor de IA · de respaldo'}
                nota={s.slot === 'PRIMARIO' ? 'Si lo dejas sin configurar, se usa LLM_PROVIDER del .env como siempre.'
                  : 'Opcional: si el principal no responde en 60 s o falla, se usa este en su lugar para ese turno.'} />
            ))}
          </div>
        )}
      </>}
    </div>
  );
}
