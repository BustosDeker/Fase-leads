// Vite: el frontend vive en src/web y se compila a dist/web, que Fastify sirve en el mismo puerto.
// En desarrollo (npm run dev) Vite corre en 5173 con proxy de /api hacia la app.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import 'dotenv/config';

const API = `http://localhost:${process.env.PORT || 3100}`;

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: { outDir: '../../dist/web', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { port: 5173, proxy: { '/api': { target: API, changeOrigin: true } } },
});
