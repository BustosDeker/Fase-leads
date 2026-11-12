// Definición única de los indicadores de LEADS (informe, tabla 8). La comparten backend y frontend.
// En la UI SOLO se muestran los nombres de negocio; los códigos K1..K5 / M1..M10 viven aquí y en la BD.

export type CodigoKpi = 'K1' | 'K2' | 'K3' | 'K4' | 'K5';
export type Semaforo = 'BUENO' | 'REGULAR' | 'MALO' | 'SIN_DATOS';

export interface DefinicionKpi {
  codigo: CodigoKpi;
  nombre: string;              // nombre de negocio (UI)
  numerador: { medida: string; columna: string; etiqueta: string };
  denominador: { medida: string; columna: string; etiqueta: string };
  hecho: 'Hecho_Diagnostico' | 'Hecho_Oportunidad' | 'Hecho_Recuperacion_Objecion';
  /** Rol de Dim_Tiempo que define la cohorte (Hecho_Oportunidad tiene tres). */
  claveTiempo: 'KeyTiempo' | 'KeyTiempoInicio' | 'KeyTiempoApta' | 'KeyTiempoPropuesta';
  regularDesde: number;        // % (inclusive)
  buenoDesde: number;          // % (inclusive)
  decision: string;            // decisión habilitada (tabla 10)
  pregunta: string;
}

export const INDICADORES: readonly DefinicionKpi[] = [
  { codigo: 'K1', nombre: 'Diagnóstico oportuno', hecho: 'Hecho_Diagnostico', claveTiempo: 'KeyTiempo',
    numerador: { medida: 'M2', columna: 'diagnostico_oportuno', etiqueta: 'diagnósticos a tiempo' },
    denominador: { medida: 'M1', columna: 'diagnostico_solicitud_madura', etiqueta: 'solicitudes maduras' },
    regularDesde: 75, buenoDesde: 90,
    pregunta: '¿Qué estudiantes reciben el diagnóstico dentro del plazo?',
    decision: 'Priorizar solicitudes y reforzar la atención especializada.' },
  { codigo: 'K2', nombre: 'Cotización oportuna', hecho: 'Hecho_Oportunidad', claveTiempo: 'KeyTiempoApta',
    numerador: { medida: 'M4', columna: 'cotizacion_oportuna', etiqueta: 'cotizaciones a tiempo' },
    denominador: { medida: 'M3', columna: 'oportunidad_apta_madura', etiqueta: 'oportunidades aptas maduras' },
    regularDesde: 75, buenoDesde: 90,
    pregunta: '¿Qué oportunidades aptas reciben una primera propuesta a tiempo?',
    decision: 'Resolver cuellos de botella y revisar tarifas y catálogo.' },
  { codigo: 'K3', nombre: 'Aceptación de propuestas', hecho: 'Hecho_Oportunidad', claveTiempo: 'KeyTiempoPropuesta',
    numerador: { medida: 'M6', columna: 'aceptacion_30d', etiqueta: 'aceptadas en el plazo' },
    denominador: { medida: 'M5', columna: 'cotizacion_madura', etiqueta: 'primeras propuestas maduras' },
    regularDesde: 20, buenoDesde: 35,
    pregunta: '¿Qué propuestas presentadas se aceptan?',
    decision: 'Ajustar alcance, argumentos y condiciones comerciales.' },
  { codigo: 'K4', nombre: 'Recuperación de objeciones', hecho: 'Hecho_Recuperacion_Objecion', claveTiempo: 'KeyTiempo',
    numerador: { medida: 'M10', columna: 'objecion_recuperada_30d', etiqueta: 'objeciones recuperadas' },
    denominador: { medida: 'M9', columna: 'objecion_principal_madura', etiqueta: 'objeciones principales maduras' },
    regularDesde: 15, buenoDesde: 30,
    pregunta: '¿Qué objeciones se recuperan?',
    decision: 'Mejorar respuestas y criterios de derivación.' },
  { codigo: 'K5', nombre: 'Conversión a PAYERS', hecho: 'Hecho_Oportunidad', claveTiempo: 'KeyTiempoInicio',
    numerador: { medida: 'M8', columna: 'conversion_60d', etiqueta: 'confirmadas por PAYERS' },
    denominador: { medida: 'M7', columna: 'cohorte_madura', etiqueta: 'oportunidades maduras' },
    regularDesde: 10, buenoDesde: 20,
    pregunta: '¿Qué oportunidades llegan efectivamente a PAYERS?',
    decision: 'Conciliar acuerdos, transferencias y confirmaciones.' },
];

export const indicador = (c: CodigoKpi) => INDICADORES.find((k) => k.codigo === c)!;

/** Valor del indicador como COCIENTE DE SUMAS. Denominador 0 => null («Sin datos»), nunca 0 %. */
export function cocienteDeSumas(numerador: number, denominador: number): number | null {
  if (!denominador) return null;
  return (100 * numerador) / denominador;
}

/** Combina segmentos correctamente: suma numeradores y denominadores; NO promedia porcentajes. */
export function agregar(segmentos: { num: number; den: number }[]): { num: number; den: number; valor: number | null } {
  const num = segmentos.reduce((s, x) => s + x.num, 0);
  const den = segmentos.reduce((s, x) => s + x.den, 0);
  return { num, den, valor: cocienteDeSumas(num, den) };
}

export function semaforo(def: Pick<DefinicionKpi, 'regularDesde' | 'buenoDesde'>, valor: number | null): Semaforo {
  if (valor === null) return 'SIN_DATOS';
  if (valor >= def.buenoDesde) return 'BUENO';
  if (valor >= def.regularDesde) return 'REGULAR';
  return 'MALO';
}

/** Texto + símbolo del estado (accesible: no depende solo del color). */
export const ETIQUETA_SEMAFORO: Record<Semaforo, { texto: string; simbolo: string }> = {
  BUENO: { texto: 'Bueno', simbolo: '●' },
  REGULAR: { texto: 'Regular', simbolo: '▲' },
  MALO: { texto: 'Malo', simbolo: '■' },
  SIN_DATOS: { texto: 'Sin datos', simbolo: '–' },
};
