import type { UsoTokens } from '../tipos.js';

export class ErrorProveedorIA extends Error {
  constructor(public readonly proveedor: string, public readonly status: number | null, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorProveedorIA';
  }
}

export function errorHttp(proveedor: string, status: number): ErrorProveedorIA {
  return new ErrorProveedorIA(proveedor, status, `${proveedor} respondió HTTP ${status}.`);
}

export function sumarUso(a: UsoTokens, entrada: unknown, salida: unknown): UsoTokens {
  const inN = Number(entrada) || 0;
  const outN = Number(salida) || 0;
  return { entrada: a.entrada + inN, salida: a.salida + outN, total: a.total + inN + outN };
}

export async function fetchConReintentos(peticion: () => Promise<Response>): Promise<Response> {
  for (let intento = 0; intento <= 2; intento++) {
    const respuesta = await peticion();
    if (respuesta.status !== 429 && respuesta.status < 500) return respuesta;
    if (intento === 2) return respuesta;
    const retryAfter = respuesta.headers.get('retry-after');
    const esperaIndicada = retryAfter == null ? 0 : /^\d+(?:\.\d+)?$/.test(retryAfter.trim())
      ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now());
    await new Promise((resolve) => setTimeout(resolve, Math.max(250 * 2 ** intento, esperaIndicada)));
  }
  throw new Error('No se pudo completar la solicitud al proveedor.');
}

export function usoEstimado(textos: string[]): UsoTokens {
  const entrada = Math.ceil(textos.join('\n').length / 4);
  return { entrada, salida: 0, total: entrada };
}
