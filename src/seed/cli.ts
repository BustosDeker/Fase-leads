// CLI del generador de datos sintéticos.
//   npm run seed        -> genera los datos si aún no existen (semilla fija: siempre los mismos)
//   npm run seed:reset  -> borra SOLO los datos sintéticos (es_demo = 1) y los vuelve a generar
//   npm run seed -- --limpiar  -> solo borra los datos sintéticos
// Después ejecuta `npm run etl` para que el tablero los vea.
import { cerrarPools } from '../db.js';
import { explicarErrorSql } from '../diagnostico-sql.js';
import { FIN_DATOS, INICIO_DATOS, SEMILLA, generarSeed } from './generar.js';
import { contarDatosDemo, limpiarDatosDemo, vaciarDataMart } from './limpiar.js';

const flag = (f: string) => process.argv.includes(f);

async function main() {
  const existentes = await contarDatosDemo();
  if (flag('--reset') || flag('--limpiar')) {
    const r = await limpiarDatosDemo();
    await vaciarDataMart();
    console.log(`✔ Datos sintéticos eliminados: ${r.contactos} contactos, ${r.oportunidades} oportunidades (los datos de la demo en vivo se conservan). Data mart vaciado: ejecuta \`npm run etl\` para reconstruirlo.`);
    if (flag('--limpiar')) return;
  } else if (existentes > 0) {
    console.log(`Ya existen ${existentes} contactos sintéticos. Usa \`npm run seed:reset\` para regenerarlos.`);
    return;
  }
  console.log(`Generando datos sintéticos (semilla ${SEMILLA}, ${INICIO_DATOS.toLocaleDateString('es-PE')} – ${FIN_DATOS.toLocaleDateString('es-PE')})…`);
  const r = await generarSeed();
  console.log(`✔ ${r.contactos} contactos/BUYERS, ${r.leads} LEADS, ${r.oportunidades} oportunidades · ${r.inserts} inserciones en ${(r.ms / 1000).toFixed(1)} s`);
  console.log('  Oportunidades por estado: ' + Object.entries(r.porEstado).sort().map(([e, n]) => `${e}=${n}`).join(', '));
  console.log('Siguiente paso: npm run etl');
}

main()
  .catch((e) => {
    console.error('✖ ' + (e?.code ? explicarErrorSql(e) : e?.message ?? e));
    process.exitCode = 1;
  })
  .finally(cerrarPools);
