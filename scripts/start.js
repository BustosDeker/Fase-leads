#!/usr/bin/env node
// npm start — levanta la app INBESTIGA y OpenWA (si está instalado y habilitado) con logs
// prefijados, y abre el navegador. Ctrl+C detiene ambos procesos. Sin dependencias externas.
import 'dotenv/config';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OPENWA_DIR = path.join(RAIZ, 'vendor', 'OpenWA');
const esWindows = process.platform === 'win32';
const PUERTO = process.env.PORT || 3000;
const procesos = [];

function lanzar(nombre, color, cmd, args, cwd) {
  const p = spawn(cmd, args, { cwd, shell: esWindows, env: process.env });
  const prefijo = `\x1b[${color}m[${nombre}]\x1b[0m `;
  const volcar = (flujo) => (datos) => {
    for (const linea of datos.toString().split(/\r?\n/)) if (linea.trim()) flujo.write(prefijo + linea + '\n');
  };
  p.stdout.on('data', volcar(process.stdout));
  p.stderr.on('data', volcar(process.stderr));
  p.on('exit', (c) => console.log(`${prefijo}terminó (código ${c})`));
  procesos.push(p);
  return p;
}

function abrirNavegador(url) {
  const [cmd, args] = esWindows ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

// OpenWA: proceso independiente (NestJS). Se usa el build si existe; si no, `nest start`.
const openwaHabilitado = !/^false$/i.test(process.env.OPENWA_ENABLED || '');
if (openwaHabilitado && fs.existsSync(path.join(OPENWA_DIR, 'node_modules'))) {
  const script = fs.existsSync(path.join(OPENWA_DIR, 'dist', 'main.js')) ? 'start:prod' : 'start';
  lanzar('openwa', '32', 'npm', ['run', script], OPENWA_DIR);
} else {
  console.log('[start] OpenWA no está instalado o está deshabilitado: la demo usará el Simulador de WhatsApp.');
}

lanzar('app', '36', 'npx', ['tsx', 'src/server/index.ts'], RAIZ);

if (!/^false$/i.test(process.env.OPEN_BROWSER || '')) setTimeout(() => abrirNavegador(`http://localhost:${PUERTO}`), 2500);

const detener = () => {
  for (const p of procesos) if (!p.killed) p.kill();
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGINT', detener);
process.on('SIGTERM', detener);
