// Acciones sugeridas del Agente Plataforma: se construyen SOLO con cifras devueltas por SQL
// (data mart) y se ligan a la decisión de la tabla 10 del informe. No se inventa ningún dato.
import { INDICADORES, cocienteDeSumas, semaforo, type CodigoKpi } from '../shared/indicadores.js';
import { reportePorDimension, totalesKpi, type Filtros } from './consultas.js';

export interface Accion { codigo: CodigoKpi; indicador: string; estado: 'MALO' | 'REGULAR'; texto: string; decision: string }

const pct = (x: number) => `${x.toLocaleString('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

/** Descripción de los casos que no cumplen, con los plazos de la última carga. */
function fallas(c: CodigoKpi, plazos: { wdHoras: number; wqHoras: number; waDias: number; wcDias: number }) {
  return {
    K1: `diagnósticos entregados fuera de ${plazos.wdHoras} h o sin entregar`,
    K2: `oportunidades aptas sin propuesta en ${plazos.wqHoras} h`,
    K3: `propuestas sin aceptación en ${plazos.waDias} días`,
    K4: `objeciones no recuperadas en ${plazos.waDias} días`,
    K5: `oportunidades sin confirmación de PAYERS en ${plazos.wcDias} días`,
  }[c];
}

export async function accionesSugeridas(f: Filtros, plazos: { wdHoras: number; wqHoras: number; waDias: number; wcDias: number }): Promise<Accion[]> {
  const totales = await totalesKpi(f);
  const acciones: Accion[] = [];
  for (const k of INDICADORES) {
    const { num, den } = totales[k.codigo];
    const valor = cocienteDeSumas(num, den);
    const estado = semaforo(k, valor);
    if (estado !== 'MALO' && estado !== 'REGULAR') continue;
    const noCumplen = den - num;
    // ¿Dónde se concentran los casos que no cumplen? Por canal y por asesor (dimensiones de los tres hechos).
    const porCanal = (await reportePorDimension(f, 'canal', 1, [])).filas
      .map((r) => ({ m: r.miembro, c: r.celdas[k.codigo] })).filter((x) => x.c && x.c.den > 0)
      .map((x) => ({ m: x.m, fallas: x.c!.den - x.c!.num })).sort((a, b) => b.fallas - a.fallas);
    const porAsesor = (await reportePorDimension(f, 'asesor', 1, [])).filas
      .map((r) => ({ m: r.miembro, c: r.celdas[k.codigo] })).filter((x) => x.c && x.c.den >= 5)
      .map((x) => ({ m: x.m, valor: cocienteDeSumas(x.c!.num, x.c!.den)!, den: x.c!.den })).sort((a, b) => a.valor - b.valor);

    let texto = `${noCumplen} de ${den} ${fallas(k.codigo, plazos)} (${k.nombre}: ${pct(valor!)}).`;
    const top = porCanal.slice(0, 2).filter((x) => x.fallas > 0);
    if (top.length && noCumplen > 0) {
      const suma = top.reduce((s, x) => s + x.fallas, 0);
      texto += ` ${top.map((x) => x.m).join(' y ')} concentran ${suma} (${pct((100 * suma) / noCumplen)}).`;
    }
    if (porAsesor.length >= 2) {
      const peor = porAsesor[0];
      texto += ` El valor más bajo por responsable es ${peor.m}: ${pct(peor.valor)} sobre ${peor.den} casos.`;
    }
    acciones.push({ codigo: k.codigo, indicador: k.nombre, estado, texto, decision: k.decision });
  }
  return acciones.sort((a, b) => (a.estado === b.estado ? 0 : a.estado === 'MALO' ? -1 : 1));
}
