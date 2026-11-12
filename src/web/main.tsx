// Punto de entrada del frontend (React 18 + React Router + TanStack Query).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './index.css';
import { Layout } from './components/Layout';
import { Tablero } from './pages/Tablero';
import { Pendiente } from './pages/Pendiente';

const cliente = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } } });

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <QueryClientProvider client={cliente}>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Navigate to="/leads/tablero" replace />} />
            <Route path="/leads" element={<Navigate to="/leads/tablero" replace />} />
            <Route path="/leads/tablero" element={<Tablero />} />
            <Route path="*" element={<Pendiente />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
