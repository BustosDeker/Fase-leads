// Etiqueta de estado del indicador: color suave + SÍMBOLO + TEXTO (nunca solo color).
import { ETIQUETA_SEMAFORO, type Semaforo as S } from '../../shared/indicadores';

const ESTILO: Record<S, string> = {
  BUENO: 'bg-bueno-fondo text-bueno-texto border-bueno-marca/40',
  REGULAR: 'bg-regular-fondo text-regular-texto border-regular-marca/60',
  MALO: 'bg-malo-fondo text-malo-texto border-malo-marca/40',
  SIN_DATOS: 'bg-fondo text-tinta-3 border-linea-fuerte',
};

export function Semaforo({ estado, compacto = false }: { estado: S; compacto?: boolean }) {
  const e = ETIQUETA_SEMAFORO[estado];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border font-semibold ${ESTILO[estado]} ${
      compacto ? 'px-1.5 py-0 text-[11px]' : 'px-2.5 py-0.5 text-xs'}`}>
      <span aria-hidden>{e.simbolo}</span>{e.texto}
    </span>
  );
}
