// CLI del ETL.
//   npm run etl                 -> carga con @Corte = ahora y plazos por defecto
//   npm run etl -- --corte=2026-10-31T23:59:59 --wd=48 --wq=2 --wa=30 --wc=60
//   npm run etl:verify          -> compara M1..M10 del OLTP con el data mart (parámetros de la última carga)
import { cerrarPools } from '../db.js';
import { explicarErrorSql } from '../diagnostico-sql.js';
import { ejecutarEtl, ultimaEjecucionOk } from './ejecutar.js';
import { esquemaParametrosEtl, parametrosPorDefecto } from './parametros.js';
import { verificarOltpMart } from './verificar.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const fmt = (d: Date) => d.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'medium' });

async function etl() {
  const def = parametrosPorDefecto();
  const p = esquemaParametrosEtl.parse({
    corte: arg('corte') ?? def.corte, wdHoras: arg('wd') ?? def.wdHoras, wqHoras: arg('wq') ?? def.wqHoras,
    waDias: arg('wa') ?? def.waDias, wcDias: arg('wc') ?? def.wcDias,
  });
  console.log(`ETL · corte ${fmt(p.corte)} · plazos: diagnóstico ${p.wdHoras} h, cotización ${p.wqHoras} h, ` +
    `aceptación/recuperación ${p.waDias} d, conversión ${p.wcDias} d`);
  const r = await ejecutarEtl(p, { origen: 'CLI', alPaso: (paso) => paso !== 'inicio' && paso !== 'fin' && console.log(`  … ${paso}`) });
  if (!r.ok) throw new Error(`El ETL falló y se revirtió (ejecución ${r.etlId}): ${r.error}`);
  console.log(`✔ ETL #${r.etlId} correcto en ${r.duracionMs} ms · dimensiones: ${r.filasDimensiones} filas · hechos: ${r.filasHechos} filas`);
  for (const [t, n] of Object.entries(r.detalle)) console.log(`    ${t.padEnd(28)} ${n}`);
  console.log(`  oportunidades en el OLTP: ${r.oportunidadesDemo} sintéticas + ${r.oportunidadesReales} de la demo`);
}

async function verificar() {
  const ult = await ultimaEjecucionOk();
  if (!ult) throw new Error('No hay ninguna carga correcta del ETL. Ejecuta primero: npm run etl');
  console.log(`Verificación OLTP ↔ data mart · ETL #${ult.etlId} · corte ${fmt(ult.corte)}`);
  const v = await verificarOltpMart(ult);
  console.log('  Medida                              OLTP    Mart   Resultado');
  for (const m of v.medidas) console.log(`  ${m.medida.padEnd(34)} ${String(m.oltp).padStart(6)}  ${String(m.mart).padStart(6)}   ${m.resultado}`);
  console.log('  Coherencia (numerador ⊆ denominador):');
  for (const c of v.coherencia) console.log(`    ${c.regla.padEnd(10)} ${c.cumple}  (${c.num} ≤ ${c.den})`);
  console.log(v.ok ? '✔ El data mart coincide con el OLTP.' : '✖ Hay diferencias entre el data mart y el OLTP.');
  if (!v.ok) process.exitCode = 1;
}

(process.argv.includes('--verificar') ? verificar() : etl())
  .catch((e) => {
    console.error('✖ ' + (e?.code ? explicarErrorSql(e) : e?.message ?? e));
    process.exitCode = 1;
  })
  .finally(cerrarPools);
