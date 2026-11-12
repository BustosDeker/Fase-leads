#!/usr/bin/env node
// npm run dev — desarrollo: API con recarga (tsx watch) + Vite (http://localhost:5173, proxy de /api).
import { spawn } from 'node:child_process';

const esWindows = process.platform === 'win32';
const procesos = [
  ['api', '36', 'npx', ['tsx', 'watch', 'src/server/index.ts']],
  ['web', '35', 'npx', ['vite']],
].map(([nombre, color, cmd, args]) => {
  const p = spawn(cmd, args, { shell: esWindows, env: process.env });
  const prefijo = `\x1b[${color}m[${nombre}]\x1b[0m `;
  for (const flujo of ['stdout', 'stderr'])
    p[flujo].on('data', (d) => d.toString().split(/\r?\n/).filter((l) => l.trim()).forEach((l) => process[flujo].write(prefijo + l + '\n')));
  return p;
});
const detener = () => { for (const p of procesos) p.kill(); process.exit(0); };
process.on('SIGINT', detener);
process.on('SIGTERM', detener);
