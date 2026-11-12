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

function Ingreso({ alEntrar, aviso }: { alEntrar: () => void; aviso: string | null }) {
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const entrar = useMutation({ mutationFn: () => api.post<Usuario>('/api/auth/login', { usuario, clave }), onSuccess: alEntrar });
  return (
    <div className="flex min-h-screen items-center justify-center bg-fondo px-4">
      <form className="tarjeta w-full max-w-sm p-6" onSubmit={(e) => { e.preventDefault(); entrar.mutate(); }}>
        <div className="mb-5">
          <div className="text-xl font-bold tracking-wide">INBESTIGA</div>
          <div className="nota">Metodología IMPULSE · Fase LEADS</div>
        </div>
        <h1 className="titulo-seccion mb-3">Ingresar</h1>
        <label className="mb-3 block"><span className="etiqueta-campo">Usuario</span>
          <input className="campo" autoComplete="username" value={usuario} onChange={(e) => setUsuario(e.target.value)} required autoFocus /></label>
        <label className="mb-4 block"><span className="etiqueta-campo">Clave</span>
          <input className="campo" type="password" autoComplete="current-password" value={clave} onChange={(e) => setClave(e.target.value)} required /></label>
        {(entrar.error || aviso) && <p role="alert" className="mb-3 text-sm text-malo-texto">■ {entrar.error ? (entrar.error as Error).message : aviso}</p>}
        <button className="boton-negro w-full" disabled={entrar.isPending}>{entrar.isPending ? 'Ingresando…' : 'Ingresar'}</button>
        <p className="nota mt-4">Los usuarios y roles se definen en <code>APP_USERS</code> del archivo <code>.env</code>.</p>
      </form>
    </div>
  );
}
