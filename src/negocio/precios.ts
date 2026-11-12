// Motor de precios de LEADS (informe, tabla 7): precio final = base + extras + recargos − descuentos.
// Función pura (sin BD): la usan el generador de datos y la tool `cotizar` del agente.
// Reglas que nunca se rompen: descuento ≤ base × tope% (CK_PROPUESTA_TOPE) y final ≥ mínimo (CK_PROPUESTA_MINIMO).

export interface Tarifa { tarifaId: number; precioBase: number; precioMinimo: number; topeDescuentoPct: number }
export interface Regla {
  reglaId: number; nombre: string; tipo: 'DESCUENTO' | 'RECARGO';
  factor: 'UNIVERSIDAD' | 'CICLO' | 'AVANCE' | 'FORMA_PAGO' | 'TIPO_TESIS' | 'URGENCIA' | 'PROMOCION';
  valorCondicion: string | null; umbralDias: number | null; porcentaje: number;
}
export interface Extra { entregableId: number; nombre: string; cantidad: number; precioUnitario: number }
export interface ContextoCotizacion {
  universidad?: string | null;
  etapaAcademica?: string | null;
  avance?: number | null;
  tipoTesis?: string | null;
  formaPago?: 'CONTADO' | 'CUOTAS';
  diasHastaFechaLimite?: number | null;
  aplicarPromocion?: boolean;
  /** Descuento adicional negociado (p. ej. tras una objeción de precio), en % del precio base. */
  descuentoNegociadoPct?: number;
}
export interface Ajuste { reglaId: number | null; tipo: 'DESCUENTO' | 'RECARGO'; concepto: string; porcentaje: number; monto: number }
export interface Cotizacion {
  tarifaId: number; precioBase: number; montoExtras: number; recargo: number; descuento: number; precioFinal: number;
  precioMinimo: number; topeDescuentoPct: number; ajustes: Ajuste[]; extras: Extra[];
  /** Avisos visibles para el cotizador cuando se recortó un descuento para respetar tope o mínimo. */
  avisos: string[];
  /** true si lo recortado fue el AJUSTE NEGOCIADO (pedido por una persona): esa propuesta debe bloquearse.
   *  Los descuentos automáticos de las reglas se acotan al tope sin bloquear. */
  negociadoExcede: boolean;
}

const cent = (x: number) => Math.round(x * 100) / 100;
const piso = (x: number) => Math.floor(x * 100 + 1e-6) / 100;

/** ¿La regla aplica al contexto? */
export function reglaAplica(r: Regla, c: ContextoCotizacion): boolean {
  switch (r.factor) {
    case 'UNIVERSIDAD': return !!c.universidad && c.universidad === r.valorCondicion;
    case 'CICLO': return !!c.etapaAcademica && c.etapaAcademica === r.valorCondicion;
    case 'AVANCE': {
      const m = /^>(\d+)$/.exec(r.valorCondicion ?? '');
      return m !== null && c.avance != null && c.avance > Number(m[1]);
    }
    case 'FORMA_PAGO': return c.formaPago === r.valorCondicion;
    case 'TIPO_TESIS': return !!c.tipoTesis && c.tipoTesis === r.valorCondicion;
    case 'URGENCIA': return c.diasHastaFechaLimite != null && r.umbralDias != null && c.diasHastaFechaLimite < r.umbralDias;
    case 'PROMOCION': return !!c.aplicarPromocion;
  }
}

export function cotizar(t: Tarifa, reglas: Regla[], c: ContextoCotizacion, extras: Extra[] = []): Cotizacion {
  const avisos: string[] = [];
  const base = cent(t.precioBase);
  const montoExtras = cent(extras.reduce((s, e) => s + e.cantidad * e.precioUnitario, 0));

  const recargos: Ajuste[] = reglas.filter((r) => r.tipo === 'RECARGO' && reglaAplica(r, c))
    .map((r) => ({ reglaId: r.reglaId, tipo: 'RECARGO', concepto: r.nombre, porcentaje: r.porcentaje, monto: cent(base * r.porcentaje / 100) }));
  const descuentos: Ajuste[] = reglas.filter((r) => r.tipo === 'DESCUENTO' && reglaAplica(r, c))
    .map((r) => ({ reglaId: r.reglaId, tipo: 'DESCUENTO', concepto: r.nombre, porcentaje: r.porcentaje, monto: cent(base * r.porcentaje / 100) }));
  if (c.descuentoNegociadoPct && c.descuentoNegociadoPct > 0) {
    descuentos.push({ reglaId: null, tipo: 'DESCUENTO', concepto: 'Ajuste negociado', porcentaje: c.descuentoNegociadoPct,
      monto: cent(base * c.descuentoNegociadoPct / 100) });
  }
  const recargo = cent(recargos.reduce((s, a) => s + a.monto, 0));

  // Límite efectivo del descuento: el menor entre el tope y lo que deja el precio en el mínimo.
  const limiteTope = piso(base * t.topeDescuentoPct / 100);
  const limiteMinimo = piso(base + montoExtras + recargo - t.precioMinimo);
  let disponible = Math.max(0, Math.min(limiteTope, limiteMinimo));
  const aplicados: Ajuste[] = [];
  let negociadoExcede = false;
  for (const d of descuentos) {               // se respetan en orden; el exceso se recorta
    const monto = piso(Math.min(d.monto, disponible));
    if (monto < d.monto && d.reglaId === null) negociadoExcede = true;
    if (monto < d.monto) avisos.push(`«${d.concepto}» recortado de S/ ${d.monto.toFixed(2)} a S/ ${monto.toFixed(2)} ` +
      (limiteTope <= limiteMinimo ? `(tope de descuento ${t.topeDescuentoPct} %).` : `(precio mínimo S/ ${t.precioMinimo.toFixed(2)}).`));
    if (monto > 0) aplicados.push({ ...d, monto, porcentaje: cent(monto * 100 / base) });
    disponible = cent(disponible - monto);
  }
  const descuento = cent(aplicados.reduce((s, a) => s + a.monto, 0));
  return {
    tarifaId: t.tarifaId, precioBase: base, montoExtras, recargo, descuento,
    precioFinal: cent(base + montoExtras + recargo - descuento),
    precioMinimo: t.precioMinimo, topeDescuentoPct: t.topeDescuentoPct,
    ajustes: [...recargos, ...aplicados], extras, avisos, negociadoExcede,
  };
}

/** Validación independiente (la usan las pruebas y la auditoría): ¿respeta tope y mínimo? */
export function validarLimites(q: Pick<Cotizacion, 'precioBase' | 'montoExtras' | 'recargo' | 'descuento' | 'precioMinimo' | 'topeDescuentoPct'>) {
  const errores: string[] = [];
  if (q.descuento > q.precioBase * q.topeDescuentoPct / 100 + 1e-9) errores.push('El descuento supera el tope permitido.');
  if (q.precioBase + q.montoExtras + q.recargo - q.descuento < q.precioMinimo - 1e-9) errores.push('El precio final queda por debajo del mínimo.');
  return errores;
}
