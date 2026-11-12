// Suscripción a los eventos en vivo del servidor (SSE). Reconecta solo si se cae la conexión.
import { useEffect, useRef } from 'react';

export type Manejadores = Record<string, (datos: any) => void>;

export function useLiveEvents(manejadores: Manejadores) {
  const ref = useRef(manejadores);
  ref.current = manejadores;
  useEffect(() => {
    const fuente = new EventSource('/api/eventos');
    const tipos = Object.keys(ref.current);
    const oyentes = tipos.map((tipo) => {
      const f = (e: MessageEvent) => {
        try { ref.current[tipo]?.(JSON.parse(e.data)); } catch { /* evento mal formado: se ignora */ }
      };
      fuente.addEventListener(tipo, f as EventListener);
      return [tipo, f] as const;
    });
    return () => {
      for (const [tipo, f] of oyentes) fuente.removeEventListener(tipo, f as EventListener);
      fuente.close();
    };
    // Los tipos se fijan al montar; los manejadores se leen siempre de la referencia actual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
