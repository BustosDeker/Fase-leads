// Cliente HTTP de la API. Los errores del servidor llegan con { error, detalle } y se muestran tal cual.
export class ErrorApi extends Error {
  constructor(public estado: number, mensaje: string, public detalle?: unknown) { super(mensaje); }
}

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  } catch {
    throw new ErrorApi(0, 'No se pudo conectar con la aplicación. ¿Está corriendo `npm start`?');
  }
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErrorApi(r.status, cuerpo.error ?? `Error ${r.status}`, cuerpo.detalle);
  return cuerpo as T;
}

export const api = {
  get: <T>(url: string, params?: Record<string, string | number | undefined | null>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
    const s = q.toString();
    return pedir<T>(s ? `${url}?${s}` : url);
  },
  post: <T>(url: string, cuerpo?: unknown) => pedir<T>(url, { method: 'POST', body: JSON.stringify(cuerpo ?? {}) }),
};

// ---------------------------------------------------------------- tipos de respuesta
export interface Celda { num: number; den: number }
export interface Salud {
  sqlServer: { ok: boolean; error?: string; oportunidades?: number; contactos?: number };
  whatsapp: { estado: string };
}
export interface EjecucionEtl {
  etl_id: number; inicio: string; fin: string | null; duracion_ms: number | null; estado?: string; corte: string;
  wd_horas: number; wq_horas: number; wa_dias: number; wc_dias: number; filas_dimensiones: number | null; filas_hechos: number | null;
  detalle_json: string | null; oportunidades_demo: number | null; oportunidades_reales: number | null; error?: string | null;
}
export interface EstadoEtl { enCurso: boolean; ultima: EjecucionEtl | null; ultimaOk: EjecucionEtl | null }
export interface Plazos { wdHoras: number; wqHoras: number; waDias: number; wcDias: number }
export interface Kpis { totales: Record<'K1' | 'K2' | 'K3' | 'K4' | 'K5', Celda>; plazos: Plazos }
export interface OpcionesFiltros { gruposEtapa: string[]; canales: string[]; asesores: string[]; rango: { minimo: string | null; maximo: string | null } }
export interface Reporte {
  jerarquia: { id: string; etiqueta: string; niveles: { id: string; etiqueta: string }[] };
  nivel: number; ruta: string[]; aplica: Record<string, boolean>; hayMasNiveles: boolean;
  filas: { miembro: string; celdas: Partial<Record<string, Celda | null>> }[];
}
export interface PuntoTendencia { mes: string; num: number; den: number }
export interface Accion { codigo: string; indicador: string; estado: 'MALO' | 'REGULAR'; texto: string; decision: string }
