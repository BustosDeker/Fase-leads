// «Explicar este tablero»: resume en lenguaje simple los indicadores visibles con los filtros actuales.
// Solo usa cifras del data mart. Si la IA cita un porcentaje que no está en los datos, se descarta su
// texto y se usa la explicación por reglas (nunca se muestra una cifra inventada).
import { accionesSugeridas } from '../kpi/acciones.js';
import { totalesKpi, type Filtros } from '../kpi/consultas.js';
import { cocienteDeSumas, ETIQUETA_SEMAFORO, INDICADORES, semaforo } from '../shared/indicadores.js';
import { obtenerProveedor } from './motor.js';

type Plazos = { wdHoras: number; wqHoras: number; waDias: number; wcDias: number };
const pct = (x: number) => `${x.toLocaleString('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

export async function explicarTablero(f: Filtros, plazos: Plazos) {
  const totales = await totalesKpi(f);
  const filas = INDICADORES.map((k) => {
    const { num, den } = totales[k.codigo];
    const v = cocienteDeSumas(num, den);
    const s = semaforo(k, v);
    return { indicador: k.nombre, valor: v, texto: v == null ? 'sin datos' : pct(v), casos: `${num} de ${den}`, estado: ETIQUETA_SEMAFORO[s].texto,
      meta: `bueno desde ${k.buenoDesde} %, regular desde ${k.regularDesde} %`, pregunta: k.pregunta, decision: k.decision };
  });
  const acciones = await accionesSugeridas(f, plazos);
  const porReglas = textoPorReglas(filas, acciones.map((a) => a.texto));
  const prov = obtenerProveedor();
  if (prov.nombre === 'mock') return { texto: porReglas, origen: 'reglas' as const };

  const permitidos = new Set(filas.flatMap((x) => [x.texto, `${x.valor?.toFixed(0)} %`]).concat(acciones.flatMap((a) => a.texto.match(/\d+(?:,\d)?\s?%/g) ?? [])));
  try {
    const texto = await prov.responder({
      sistema: 'Eres el Agente Plataforma de INBESTIGA. Explicas tableros de indicadores a un equipo comercial no técnico, en español, en 4 a 6 viñetas cortas (•). '
        + 'Usa SOLO las cifras del JSON, escritas exactamente igual (por ejemplo «82,4 %»). No inventes causas: si sugieres algo, apóyate en las acciones sugeridas. '
        + 'No uses códigos internos ni términos técnicos de bases de datos.',
      contexto: `Plazos: diagnóstico ${plazos.wdHoras} h, cotización ${plazos.wqHoras} h, aceptación ${plazos.waDias} días, conversión ${plazos.wcDias} días.`,
      historial: [{ rol: 'user', texto: 'Explica este tablero:\n' + JSON.stringify({ indicadores: filas, acciones_sugeridas: acciones.map((a) => a.texto) }) }],
      herramientas: [], ejecutar: async () => '{"ok":false}', datos: undefined as never, sospechaInyeccion: false,
    });
    const citados = texto.match(/\d+(?:,\d)?\s?%/g) ?? [];
    const ajenos = citados.filter((c) => !permitidos.has(c.replace(/\s?%/, ' %')));
    if (ajenos.length || !texto.trim()) return { texto: porReglas, origen: 'reglas' as const, aviso: 'La explicación con IA citó cifras que no están en el tablero; se muestra la explicación por reglas.' };
    return { texto: texto.trim(), origen: prov.nombre, modelo: prov.modelo };
  } catch (e: any) {
    return { texto: porReglas, origen: 'reglas' as const, aviso: `No se pudo usar la IA (${String(e?.message ?? e).slice(0, 120)}).` };
  }
}

function textoPorReglas(filas: { indicador: string; valor: number | null; texto: string; casos: string; estado: string; decision: string }[], acciones: string[]) {
  const l: string[] = [];
  const conDatos = filas.filter((x) => x.valor != null);
  if (!conDatos.length) return '• Con los filtros elegidos todavía no hay casos maduros para medir. Prueba otro periodo o ejecuta la carga del data mart.';
  const bien = conDatos.filter((x) => x.estado === ETIQUETA_SEMAFORO.BUENO.texto).map((x) => `${x.indicador} (${x.texto})`);
  const mal = conDatos.filter((x) => x.estado === ETIQUETA_SEMAFORO.MALO.texto);
  const regular = conDatos.filter((x) => x.estado === ETIQUETA_SEMAFORO.REGULAR.texto);
  if (bien.length) l.push(`• Van bien: ${bien.join(', ')}.`);
  for (const x of mal) l.push(`• Requiere atención: ${x.indicador} está en ${x.texto} (${x.casos} casos). ${x.decision}`);
  for (const x of regular) l.push(`• En observación: ${x.indicador} está en ${x.texto} (${x.casos} casos).`);
  for (const a of acciones.slice(0, 2)) l.push(`• ${a}`);
  const sin = filas.filter((x) => x.valor == null).map((x) => x.indicador);
  if (sin.length) l.push(`• Sin datos suficientes en este periodo: ${sin.join(', ')}.`);
  return l.join('\n');
}
