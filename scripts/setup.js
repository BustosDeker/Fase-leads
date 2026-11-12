#!/usr/bin/env node
// npm run setup  [-- --sin-openwa]
// Prepara el proyecto en cualquier SO (Windows, Linux, macOS) sin Docker:
//   1. verifica Node >= 22   2. crea .env con secretos generados   3. instala dependencias
//   4. clona e instala OpenWA en vendor/OpenWA   5. compila el frontend (si existe)
//   6. prueba SQL Server y, si hay acceso de administrador, ejecuta db:init.
// Este archivo NO usa dependencias externas: corre antes de `npm install`.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIN_OPENWA = process.argv.includes('--sin-openwa');
const OPENWA_REPO = 'https://github.com/Pandaman08/OpenWA.git';
const OPENWA_DIR = path.join(RAIZ, 'vendor', 'OpenWA');
const esWindows = process.platform === 'win32';

const pendientes = [];
const titulo = (t) => console.log(`\n━━ ${t}`);
const ok = (t) => console.log(`  ✔ ${t}`);
const aviso = (t) => { console.log(`  ⚠ ${t}`); pendientes.push(t); };

/** Ejecuta un comando mostrando su salida. En Windows npm/npx son .cmd y requieren shell. */
function ejecutar(cmd, args, cwd = RAIZ) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: esWindows });
  return r.status === 0;
}

// 1. Node -------------------------------------------------------------------
titulo('1/6 Node.js');
const [mayor, menor] = process.versions.node.split('.').map(Number);
if (mayor < 22) {
  console.error(`  ✖ Se requiere Node 22 LTS o superior (tienes ${process.versions.node}). https://nodejs.org`);
  process.exit(1);
}
ok(`Node ${process.versions.node}`);
if (mayor === 22 && menor < 13) aviso('OpenWA pide Node >= 22.13; actualiza Node si su instalación falla.');

// 2. .env -------------------------------------------------------------------
titulo('2/6 Archivo .env');
const envPath = path.join(RAIZ, '.env');
const secreto = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
// Clave SQL que cumple la política de complejidad de SQL Server (mayúscula, minúscula, dígito y símbolo).
const claveSql = () => `Ib${secreto(18)}#9a`;
const AUTO = {
  SESSION_SECRET: () => secreto(32),
  DB_PASSWORD: claveSql,
  OPENWA_WEBHOOK_SECRET: () => secreto(32),
  PAYERS_TOKEN: () => secreto(32),
  BUYERS_TOKEN: () => secreto(32),
};
let env = fs.existsSync(envPath)
  ? fs.readFileSync(envPath, 'utf8')
  : fs.readFileSync(path.join(RAIZ, '.env.example'), 'utf8');
const creado = !fs.existsSync(envPath);
for (const [clave, gen] of Object.entries(AUTO)) {
  const re = new RegExp(`^${clave}=\\s*$`, 'm');
  if (re.test(env)) env = env.replace(re, `${clave}=${gen()}`);
  else if (!new RegExp(`^${clave}=`, 'm').test(env)) env = env.trimEnd() + `
${clave}=${gen()}
`;   // variable nueva en una versión posterior
}
fs.writeFileSync(envPath, env);
ok(creado ? '.env creado desde .env.example (secretos generados)' : '.env existente conservado (secretos vacíos completados)');
const leerVar = (k) => (new RegExp(`^${k}=(.*)$`, 'm').exec(env)?.[1] ?? '').trim();
if (!leerVar('DB_ADMIN_PASSWORD')) aviso('Completa DB_ADMIN_PASSWORD en .env (clave de "sa") y vuelve a ejecutar `npm run setup` o `npm run db:init`.');

// 3. Dependencias -----------------------------------------------------------
titulo('3/6 Dependencias de la app');
const tieneLock = fs.existsSync(path.join(RAIZ, 'package-lock.json'));
if (!ejecutar('npm', [tieneLock ? 'ci' : 'install', '--no-audit', '--no-fund'])) {
  console.error('  ✖ Falló la instalación de dependencias.');
  process.exit(1);
}
ok('dependencias instaladas');

// 4. OpenWA -----------------------------------------------------------------
titulo('4/6 OpenWA (WhatsApp, proceso aparte)');
if (SIN_OPENWA || /^false$/i.test(leerVar('OPENWA_ENABLED'))) {
  ok('omitido (--sin-openwa u OPENWA_ENABLED=false): la demo usará el Simulador de WhatsApp');
} else {
  if (!fs.existsSync(path.join(OPENWA_DIR, 'package.json'))) {
    fs.mkdirSync(path.dirname(OPENWA_DIR), { recursive: true });
    if (!ejecutar('git', ['clone', '--depth', '1', OPENWA_REPO, OPENWA_DIR])) {
      aviso('No se pudo clonar OpenWA (¿git instalado y con internet?). La app funciona con el simulador.');
    }
  } else {
    ok('vendor/OpenWA ya existe');
  }
  if (fs.existsSync(path.join(OPENWA_DIR, 'package.json'))) {
    const owEnv = path.join(OPENWA_DIR, '.env');
    if (!fs.existsSync(owEnv)) {
      fs.copyFileSync(path.join(OPENWA_DIR, '.env.minimal'), owEnv);
      ok('vendor/OpenWA/.env creado desde .env.minimal (SQLite, sin Redis ni Docker)');
    }
    // Ajustes para la app: el webhook va a localhost (la protección SSRF de OpenWA sigue activa para todo lo demás)
    // y la sesión vinculada se reconecta sola al reiniciar.
    let owTexto = fs.readFileSync(owEnv, 'utf8');
    const fijar = (clave, valor) => {
      const linea = `${clave}=${valor}`;
      owTexto = new RegExp(`^${clave}=.*$`, 'm').test(owTexto) ? owTexto.replace(new RegExp(`^${clave}=.*$`, 'm'), linea) : owTexto.trimEnd() + '\n' + linea + '\n';
    };
    fijar('SSRF_ALLOWED_HOSTS', 'localhost');
    fijar('AUTO_START_SESSIONS', 'true');
    fijar('RESOLVE_LID_TO_PHONE', 'true');   // remitentes @lid: OpenWA agrega senderPhone (lo usa la lista de números permitidos)
    fs.writeFileSync(owEnv, owTexto);
    ok('vendor/OpenWA/.env: webhook a localhost permitido y reconexión automática');
    if (!fs.existsSync(path.join(OPENWA_DIR, 'node_modules'))) {
      console.log('  Instalando OpenWA (descarga Chromium para whatsapp-web.js; puede tardar varios minutos)…');
      if (!ejecutar('npm', ['ci', '--no-audit', '--no-fund'], OPENWA_DIR)) aviso('Falló `npm ci` en vendor/OpenWA.');
    } else ok('dependencias de OpenWA ya instaladas');
    if (!fs.existsSync(path.join(OPENWA_DIR, 'dist', 'main.js'))) {
      if (!ejecutar('npm', ['run', 'build'], OPENWA_DIR)) aviso('Falló la compilación de OpenWA (`npm run build`).');
      else ok('OpenWA compilado');
    } else ok('OpenWA ya compilado');
  }
}

// 5. Frontend ---------------------------------------------------------------
titulo('5/6 Frontend React (vite build)');
if (fs.existsSync(path.join(RAIZ, 'src', 'web', 'index.html'))) {
  if (!ejecutar('npm', ['run', 'build'])) aviso('Falló la compilación del frontend (`npm run build`).');
  else ok('frontend compilado en dist/');
} else {
  ok('aún no hay frontend (se agrega en la etapa E3)');
}

// 6. SQL Server -------------------------------------------------------------
titulo('6/6 SQL Server');
if (leerVar('DB_ADMIN_PASSWORD')) {
  if (ejecutar('node', ['scripts/db-init.js'])) {
    ok('bases de datos listas');
    // Datos sintéticos (solo si aún no existen: el seed es idempotente) y primera carga del data mart.
    if (ejecutar('npm', ['run', '-s', 'seed']) && ejecutar('npm', ['run', '-s', 'etl'])) ok('datos de prueba cargados y data mart poblado');
    else aviso('El seed o el ETL no terminaron: revisa el mensaje anterior.');
  } else aviso('db:init no terminó: revisa el mensaje anterior (TCP/IP, credenciales).');
} else {
  ok('se omite db:init hasta que completes DB_ADMIN_PASSWORD');
}

// Resumen ------------------------------------------------------------------
titulo('Resumen');
if (pendientes.length === 0) console.log('  Todo listo. Ejecuta: npm start');
else {
  console.log('  Pendiente:');
  for (const p of pendientes) console.log(`   • ${p}`);
}
