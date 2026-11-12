// Control de sesión: si no hay sesión válida se muestra el ingreso; si la hay, la app con el usuario y su rol.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ErrorApi } from '../api';

export interface Usuario { usuario: string; rol: 'admin' | 'asesor' | 'viewer' }
const Contexto = createContext<{ yo: Usuario; salir: () => void } | null>(null);
export const useSesion = () => useContext(Contexto)!;
export const NOMBRE_ROL: Record<Usuario['rol'], string> = { admin: 'Administrador', asesor: 'Asesor', viewer: 'Solo consulta' };

export function ConSesion({ children }: { children: ReactNode }) {
  const cliente = useQueryClient();
  const yo = useQuery({ queryKey: ['yo'], retry: false, staleTime: Infinity, queryFn: () => api.get<Usuario>('/api/auth/yo') });
  useEffect(() => {
    const vencida = () => cliente.invalidateQueries({ queryKey: ['yo'] });
    window.addEventListener('sesion-expirada', vencida);
    return () => window.removeEventListener('sesion-expirada', vencida);
  }, [cliente]);
  const salir = async () => { await api.post('/api/auth/logout').catch(() => undefined); cliente.clear(); window.location.assign('/'); };

  if (yo.isLoading) return <div className="flex min-h-screen items-center justify-center nota">Cargando…</div>;
  if (yo.isError || !yo.data) {
    const sinServidor = yo.error instanceof ErrorApi && yo.error.estado === 0;
    return <Ingreso aviso={sinServidor ? (yo.error as Error).message : null} alEntrar={() => { cliente.clear(); yo.refetch(); }} />;
  }
  return <Contexto.Provider value={{ yo: yo.data, salir }}>{children}</Contexto.Provider>;
}

const ICONO = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const IconoUsuario = () => <svg viewBox="0 0 24 24" className="h-5 w-5" {...ICONO}><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" /></svg>;
const IconoCandado = () => <svg viewBox="0 0 24 24" className="h-5 w-5" {...ICONO}><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
const IconoOjo = () => <svg viewBox="0 0 24 24" className="h-5 w-5" {...ICONO}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>;
const IconoOjoCerrado = () => <svg viewBox="0 0 24 24" className="h-5 w-5" {...ICONO}><path d="M3 3l18 18" /><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a10 10 0 0 0 4.2-.9" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>;

const PASOS_EMBUDO = [
  ['1', 'BUYERS', 'Capta y entrega al estudiante interesado'],
  ['2', 'LEADS', 'Conversa, diagnostica, cotiza y negocia'],
  ['3', 'PAYERS', 'Confirma la contratación y el pago'],
];

function Ingreso({ alEntrar, aviso }: { alEntrar: () => void; aviso: string | null }) {
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [ver, setVer] = useState(false);
  const [mayusculas, setMayusculas] = useState(false);
  const entrar = useMutation({ mutationFn: () => api.post<Usuario>('/api/auth/login', { usuario, clave }), onSuccess: alEntrar });
  const mensaje = entrar.error ? (entrar.error as Error).message : aviso;
  return (
    <div className="grid min-h-screen bg-fondo lg:grid-cols-[1.05fr_1fr]">
      {/* Panel de marca */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-menu p-12 text-white lg:flex">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full border border-white/10" />
        <div aria-hidden className="pointer-events-none absolute -right-8 -top-8 h-48 w-48 rounded-full border border-white/10" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full border border-white/10" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-base font-extrabold text-tinta">I</span>
          <span className="text-lg font-bold tracking-[0.2em]">INBESTIGA</span>
        </div>
        <div className="relative max-w-md">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-menu-texto">Metodología IMPULSE</p>
          <h2 className="text-4xl font-bold leading-tight">Cada estudiante, acompañado hasta su tesis.</h2>
          <p className="mt-4 text-sm leading-relaxed text-menu-texto">Gestiona leads, conversaciones, diagnósticos y propuestas de asesoría en un solo lugar.</p>
          <ol className="mt-10 flex flex-col gap-5">
            {PASOS_EMBUDO.map(([n, t, d]) => (
              <li key={n} className="flex items-center gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/25 text-sm font-semibold">{n}</span>
                <span><span className="block text-sm font-semibold tracking-wide">{t}</span><span className="block text-xs text-menu-texto">{d}</span></span>
              </li>
            ))}
          </ol>
        </div>
        <p className="relative text-xs text-menu-texto">© {new Date().getFullYear()} INBESTIGA · Fase LEADS</p>
      </aside>

      {/* Formulario */}
      <main className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-tinta text-base font-extrabold text-white">I</span>
            <span className="text-lg font-bold tracking-[0.2em]">INBESTIGA</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-tinta">Bienvenido</h1>
          <p className="mb-8 mt-2 text-sm text-tinta-3">Ingresa con tu usuario para continuar.</p>

          <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); entrar.mutate(); }}>
            <label className="block">
              <span className="etiqueta-campo !text-sm !text-tinta-2">Usuario</span>
              <span className="relative block">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-tinta-3"><IconoUsuario /></span>
                <input className="campo !min-h-[48px] !pl-11" autoComplete="username" placeholder="Tu usuario" value={usuario}
                  onChange={(e) => setUsuario(e.target.value)} required autoFocus />
              </span>
            </label>

            <label className="block">
              <span className="etiqueta-campo !text-sm !text-tinta-2">Contraseña</span>
              <span className="relative block">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-tinta-3"><IconoCandado /></span>
                <input className="campo !min-h-[48px] !pl-11 !pr-12" type={ver ? 'text' : 'password'} autoComplete="current-password" placeholder="Tu contraseña"
                  value={clave} onChange={(e) => setClave(e.target.value)} onKeyUp={(e) => setMayusculas(e.getModifierState('CapsLock'))} required />
                <button type="button" onClick={() => setVer(!ver)} aria-pressed={ver} aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  title={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute inset-y-0 right-1 my-1 flex w-10 items-center justify-center rounded-md text-tinta-3 transition-colors hover:bg-fondo hover:text-tinta">
                  {ver ? <IconoOjoCerrado /> : <IconoOjo />}
                </button>
              </span>
              {mayusculas && <span className="mt-1.5 block text-xs text-regular-texto">▲ Bloq Mayús está activado</span>}
            </label>

            {mensaje && <p role="alert" className="rounded-lg border border-malo-marca/30 bg-malo-fondo px-3 py-2 text-sm text-malo-texto">■ {mensaje}</p>}

            <button className="boton-negro !min-h-[48px] w-full text-base shadow-sm" disabled={entrar.isPending}>
              {entrar.isPending ? 'Ingresando…' : 'Ingresar'}
            </button>
          </form>

          <p className="mt-8 text-center text-xs text-tinta-3">¿Problemas para ingresar? Consulta con el administrador del sistema.</p>
        </div>
      </main>
    </div>
  );
}
