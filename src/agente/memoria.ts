// Resumen efímero de apoyo para el agente. No es fuente de verdad ni se persiste en SQL Server.
const cache = new Map<number, { resumen: string; mensajes: number }>();

export function leerResumenMemoria(conversacionId: number): string | null {
  return cache.get(conversacionId)?.resumen ?? null;
}

export function leerMarcaMemoria(conversacionId: number): number {
  return cache.get(conversacionId)?.mensajes ?? 0;
}

export function guardarResumenMemoria(conversacionId: number, resumen: string, mensajes: number) {
  cache.set(conversacionId, { resumen, mensajes });
}

/** Útil para pruebas y para evitar conservar una conversación que ya no está activa. */
export function borrarResumenMemoria(conversacionId: number) {
  cache.delete(conversacionId);
}
