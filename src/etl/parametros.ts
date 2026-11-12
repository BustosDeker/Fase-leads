// Parámetros de medición (informe, tabla 9). Son parámetros de diseño propuestos:
// se fijan antes de cada carga y no cambian durante ella.
import { z } from 'zod';

export const esquemaParametrosEtl = z.object({
  corte: z.coerce.date(),                               // @Corte: fecha de corte (por defecto, ahora)
  wdHoras: z.coerce.number().int().min(1).max(720).default(48), // @WD: entrega del diagnóstico
  wqHoras: z.coerce.number().int().min(1).max(720).default(2),  // @WQ: primera propuesta desde la aptitud
  waDias: z.coerce.number().int().min(1).max(365).default(30),  // @WA: aceptación y recuperación de objeciones
  wcDias: z.coerce.number().int().min(1).max(365).default(60),  // @WC: confirmación de PAYERS
});
export type ParametrosEtl = z.infer<typeof esquemaParametrosEtl>;

export const parametrosPorDefecto = (): ParametrosEtl => ({ corte: new Date(), wdHoras: 48, wqHoras: 2, waDias: 30, wcDias: 60 });
