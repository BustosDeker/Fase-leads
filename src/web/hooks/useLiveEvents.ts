// Suscripción a los eventos en vivo del servidor (SSE).
// UNA sola conexión EventSource por pestaña, compartida por todos los componentes: los navegadores
// limitan a ~6 conexiones HTTP/1.1 por servidor, y una conexión por componente agotaba ese límite
// (las peticiones siguientes quedaban en espera). La conexión se cierra al salir de la página.
import { useEffect, useRef } from 'react';

export type Manejadores = Record<string, (datos: any) => void>;

let fuente: EventSource | null = null;
const suscriptores = new Map<string, Set<(datos: any) => void>>();
const tiposRegistrados = new Set<string>();

function conexion(): EventSource {
  if (!fuente || fuente.readyState === EventSource.CLOSED) {
    fuente = new EventSource('/api/eventos');
    tiposRegistrados.clear();
  }
  return fuente;
}

function registrarTipo(tipo: string) {
  const f = conexion();
  if (tiposRegistrados.has(tipo)) return;
  tiposRegistrados.add(tipo);
  f.addEventListener(tipo, ((e: MessageEvent) => {
    let datos: unknown;
    try { datos = JSON.parse(e.data); } catch { return; }
    for (const fn of suscriptores.get(tipo) ?? []) fn(datos);
  }) as EventListener);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { fuente?.close(); fuente = null; tiposRegistrados.clear(); });
}

export function useLiveEvents(manejadores: Manejadores) {
  const ref = useRef(manejadores);
  ref.current = manejadores;
  useEffect(() => {
    const propios: [string, (d: any) => void][] = Object.keys(ref.current).map((tipo) => [tipo, (d: any) => ref.current[tipo]?.(d)]);
    for (const [tipo, fn] of propios) {
      if (!suscriptores.has(tipo)) suscriptores.set(tipo, new Set());
      suscriptores.get(tipo)!.add(fn);
      registrarTipo(tipo);
    }
    return () => { for (const [tipo, fn] of propios) suscriptores.get(tipo)?.delete(fn); };
    // Los tipos se fijan al montar; los manejadores se leen siempre de la referencia actual.
  }, []);
}
