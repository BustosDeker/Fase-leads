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
import { Ficha } from './pages/Ficha';
import { Pipeline } from './pages/Pipeline';
import { Cotizador } from './pages/Cotizador';
import { Agenda } from './pages/Agenda';
import { Diagnosticos } from './pages/Diagnosticos';
import { Objeciones } from './pages/Objeciones';
import { Consentimiento } from './pages/Consentimiento';
import { Auditoria } from './pages/Auditoria';
import { Conversaciones } from './pages/Conversaciones';

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
            <Route path="/leads/ficha" element={<Ficha />} />
            <Route path="/leads/pipeline" element={<Pipeline />} />
            <Route path="/leads/cotizador" element={<Cotizador />} />
            <Route path="/leads/agenda" element={<Agenda />} />
            <Route path="/leads/diagnosticos" element={<Diagnosticos />} />
            <Route path="/leads/objeciones" element={<Objeciones />} />
            <Route path="/leads/consentimiento" element={<Consentimiento />} />
            <Route path="/leads/auditoria" element={<Auditoria />} />
            <Route path="/leads/conversaciones" element={<Conversaciones />} />
            <Route path="*" element={<Pendiente />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
