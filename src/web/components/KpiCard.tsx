// Tarjeta de indicador: nombre de negocio, porcentaje grande, fracción «num / den etiqueta»,
// semáforo con texto y símbolo, y barra con la posición del valor respecto a los umbrales.
import { cocienteDeSumas, semaforo, type DefinicionKpi } from '../../shared/indicadores';
import { entero, pct } from '../formato';
import { Semaforo } from './Semaforo';

export function KpiCard({ def, num, den }: { def: DefinicionKpi; num: number; den: number }) {
  const valor = cocienteDeSumas(num, den);
  const estado = semaforo(def, valor);
  const pos = valor === null ? null : Math.min(100, Math.max(0, valor));
  return (
    <article className="tarjeta flex flex-col gap-3 p-5" aria-label={`${def.nombre}: ${pct(valor)}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-snug text-tinta">{def.nombre}</h3>
        <Semaforo estado={estado} />
      </div>
      <div>
        <div className={`text-4xl font-bold tracking-tight ${valor === null ? 'text-tinta-3' : 'text-tinta'}`}>{pct(valor)}</div>
        <div className="mt-1 text-xs text-tinta-3">
          {den === 0 ? `Sin ${def.denominador.etiqueta} en el periodo` : <><strong className="text-tinta-2">{entero(num)} / {entero(den)}</strong> {def.denominador.etiqueta}</>}
        </div>
      </div>
      {/* Barra de umbrales: Malo | Regular | Bueno, con marca en el valor actual */}
      <div className="mt-auto" aria-hidden>
        <div className="relative h-2 w-full overflow-hidden rounded-full">
          <div className="absolute inset-y-0 left-0 bg-malo-fondo" style={{ width: `${def.regularDesde}%` }} />
          <div className="absolute inset-y-0 bg-regular-fondo" style={{ left: `${def.regularDesde}%`, width: `${def.buenoDesde - def.regularDesde}%` }} />
          <div className="absolute inset-y-0 right-0 bg-bueno-fondo" style={{ left: `${def.buenoDesde}%` }} />
        </div>
        <div className="relative h-3">
          {pos !== null && <div className="absolute -top-3.5 h-3.5 w-0.5 -translate-x-1/2 rounded bg-tinta" style={{ left: `${pos}%` }} />}
        </div>
        <div className="flex justify-between text-[11px] text-tinta-3">
          <span>Regular desde {def.regularDesde} %</span><span>Bueno desde {def.buenoDesde} %</span>
        </div>
      </div>
      <p className="text-[11px] leading-snug text-tinta-3">{def.numerador.etiqueta} ÷ {def.denominador.etiqueta}</p>
    </article>
  );
}
