// «Explicar este tablero» (Agente Plataforma): resumen en lenguaje simple de los indicadores con los filtros actuales.
import { useMutation } from '@tanstack/react-query';
import { api } from '../api';

interface Explicacion { texto: string; origen: string; modelo?: string; aviso?: string }

export function ExplicarTablero({ filtros }: { filtros: Record<string, string> }) {
  const m = useMutation({ mutationFn: () => api.post<Explicacion>('/api/tablero/explicar', filtros) });
  return (
    <section className="tarjeta no-imprimir p-4" aria-label="Explicación del tablero">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="titulo-seccion">Explicar este tablero</h2>
          <p className="nota">Resumen en lenguaje simple con las cifras visibles y los filtros actuales. No usa datos fuera del data mart.</p>
        </div>
        <button className="boton-claro" disabled={m.isPending} onClick={() => m.mutate()}>{m.isPending ? 'Preparando…' : m.data ? 'Volver a explicar' : 'Explicar'}</button>
      </div>
      {m.isError && <p role="alert" className="mt-3 text-sm text-malo-texto">■ {(m.error as Error).message}</p>}
      {m.data && (
        <div className="mt-3 rounded-lg bg-fondo p-3">
          <p className="whitespace-pre-line text-sm leading-relaxed text-tinta">{m.data.texto}</p>
          <p className="nota mt-2">{m.data.origen === 'reglas' ? 'Generado por reglas a partir de las cifras del tablero.' : `Redactado con IA (${m.data.modelo}) y verificado contra las cifras del tablero.`}
            {m.data.aviso ? ` ${m.data.aviso}` : ''}</p>
        </div>
      )}
    </section>
  );
}
