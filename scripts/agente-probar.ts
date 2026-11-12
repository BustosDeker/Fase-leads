import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Se captura antes de importar config.js (que carga .env), para distinguir una
// variable exportada en la terminal de la que solo proviene del archivo .env.
const providerExportado = process.env.LLM_PROVIDER;
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envTexto = fs.existsSync(path.join(raiz, '.env')) ? fs.readFileSync(path.join(raiz, '.env'), 'utf8') : '';
const providerEnEnv = /^LLM_PROVIDER\s*=\s*([^#\r\n]*)/m.exec(envTexto)?.[1]?.trim() || undefined;
const origenProveedor = providerExportado !== undefined ? 'variable exportada en la terminal' : providerEnEnv ? '.env' : 'valor por defecto (mock)';

const { cerrarPools } = await import('../src/db.js');
const { crearConversacionSimulada } = await import('../src/agente/conversaciones.js');
const { estadoAgente, procesarMensajeEntrante, usoAgente } = await import('../src/agente/motor.js');

const mensajes = [
  'hola, quiero asesoría para mi tesis',
  'sí acepto',
  'estudio Ingeniería de Sistemas en la UNT, soy egresado',
];

async function main() {
  const estado = estadoAgente();
  console.log(`LLM_PROVIDER configurado desde: ${origenProveedor}`);
  console.log(`LLM_PROVIDER solicitado: ${process.env.LLM_PROVIDER || 'mock (por defecto)'}`);
  console.log(`Proveedor activo: ${estado.proveedor}`);
  console.log(`Modelo activo: ${estado.modelo}`);
  if (estado.aviso) console.log(`Aviso: ${estado.aviso}`);

  const conversacion = await crearConversacionSimulada({ nombres: 'Estudiante', apellidos: 'Prueba IA' });
  console.log(`Conversación simulada: ${conversacion.conversacion_id}`);
  for (const texto of mensajes) {
    const resultado = await procesarMensajeEntrante(conversacion.conversacion_id, texto);
    console.log(JSON.stringify({ mensaje: texto, respuesta: resultado.respuesta, herramientas: resultado.herramientas ?? [],
      latenciaMs: resultado.latenciaMs ?? null, tokens: resultado.uso ?? null, motivo: resultado.motivo ?? null }, null, 2));
    if (resultado.proveedorFallo) throw new Error('El proveedor de IA falló durante el turno.');
  }
  console.log('Uso acumulado:', JSON.stringify(usoAgente()));
}

try {
  await main();
} catch (e: any) {
  console.error(`agente:probar falló: ${String(e?.message ?? e).slice(0, 500)}`);
  process.exitCode = 1;
} finally {
  await cerrarPools();
}
