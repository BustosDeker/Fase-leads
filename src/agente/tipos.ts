// Tipos comunes del Agente Negociador (independientes del proveedor de IA).

/** Mensaje del historial tal como lo ve el modelo: el estudiante (user) o el lado de INBESTIGA (assistant). */
export interface MensajeHistorial { rol: 'user' | 'assistant'; texto: string }

/** Herramienta expuesta al modelo: nombre, descripción y esquema JSON de sus parámetros. */
export interface HerramientaLLM { nombre: string; descripcion: string; esquema: Record<string, unknown> }

export interface PeticionAgente {
  sistema: string;                 // reglas fijas (cacheables)
  contexto: string;                // situación actual del estudiante (cambia en cada turno)
  historial: MensajeHistorial[];   // termina con el mensaje del estudiante
  herramientas: HerramientaLLM[];
  /** Ejecuta una herramienta y devuelve el resultado serializado (JSON). Nunca lanza: los errores vuelven como texto. */
  ejecutar: (nombre: string, entrada: unknown) => Promise<string>;
  /** Datos estructurados del contexto (los usa el modo mock, que no interpreta lenguaje natural con IA). */
  datos: import('./contexto.js').ContextoAgente;
  sospechaInyeccion: boolean;
}

export interface ProveedorLLM {
  nombre: 'anthropic' | 'openai' | 'gemini' | 'mock';
  modelo: string;
  responder(p: PeticionAgente): Promise<string>;
}

/** Cantidad máxima de rondas de herramientas por turno (evita bucles y costos descontrolados). */
export const MAX_RONDAS_HERRAMIENTAS = 6;
