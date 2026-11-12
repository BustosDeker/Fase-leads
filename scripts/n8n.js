#!/usr/bin/env node
// Lanzador opcional de n8n. n8n se instala/ejecuta con npx, no se agrega al repo.
import { spawn } from 'node:child_process';

const comando = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const proceso = spawn(comando, ['n8n', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});
proceso.on('error', (error) => {
  console.error(`No se pudo ejecutar n8n mediante npx: ${error.message}`);
  console.error('Instala Node 22/npm y prueba manualmente: npx n8n');
  process.exitCode = 1;
});
proceso.on('exit', (codigo, senal) => {
  if (senal) console.error(`n8n terminó por la señal ${senal}.`);
  process.exitCode = codigo ?? 1;
});
