// Conexión de WhatsApp (OpenWA): estado, botón para conectar y QR para vincular el teléfono.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useLiveEvents } from '../hooks/useLiveEvents';
import { Aviso, Chip } from './ui';

interface EstadoWA { estado: string; telefono: string | null; nombre: string | null; detalle: string | null; sesion: string;
  numerosPermitidos: number; fraseActivacion: string; webhookListo: boolean; qr?: string | null; errorEnvio?: string }

const ETIQUETA: Record<string, [string, 'bueno' | 'regular' | 'malo' | 'apagado']> = {
  CONECTADO: ['● Conectado', 'bueno'], ESPERANDO_QR: ['▲ Esperando que escanees el QR', 'regular'], CONECTANDO: ['▲ Conectando…', 'regular'],
  DESCONECTADO: ['– Desconectado', 'apagado'], SIN_CONEXION: ['■ OpenWA no está corriendo', 'malo'], ERROR: ['■ Con error', 'malo'],
  NO_CONFIGURADO: ['– No configurado', 'apagado'],
};

export function ConexionWhatsApp() {
  const cliente = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const est = useQuery({ queryKey: ['whatsapp'], queryFn: () => api.get<EstadoWA>('/api/whatsapp/estado'), refetchInterval: 30_000 });
  const e = est.data?.estado;
  const qr = useQuery({ queryKey: ['whatsapp-qr'], enabled: abierto && (e === 'ESPERANDO_QR' || e === 'CONECTANDO'),
    queryFn: () => api.get<EstadoWA>('/api/whatsapp/qr'), refetchInterval: 15_000 });   // el QR de WhatsApp se renueva cada ~20 s
  useLiveEvents({ whatsapp: () => { cliente.invalidateQueries({ queryKey: ['whatsapp'] }); cliente.invalidateQueries({ queryKey: ['whatsapp-qr'] }); } });
  const conectar = useMutation({ mutationFn: () => api.post<EstadoWA>('/api/whatsapp/conectar'),
    onSuccess: () => { setAbierto(true); cliente.invalidateQueries({ queryKey: ['whatsapp'] }); cliente.invalidateQueries({ queryKey: ['whatsapp-qr'] }); } });
  const desconectar = useMutation({ mutationFn: () => api.post('/api/whatsapp/desconectar'), onSuccess: () => cliente.invalidateQueries({ queryKey: ['whatsapp'] }) });
  const [texto, tono] = ETIQUETA[e ?? ''] ?? ['…', 'apagado'];
  const d = est.data;

  return (
    <section className="tarjeta p-4" aria-label="Conexión de WhatsApp">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="titulo-seccion">WhatsApp</h2>
          <Chip tono={tono}>{texto}</Chip>
          {d?.telefono && <span className="nota">Número vinculado: +{d.telefono}{d.nombre ? ` (${d.nombre})` : ''}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {(e === 'DESCONECTADO' || e === 'ERROR') &&
            <button className="boton-negro" disabled={conectar.isPending} onClick={() => conectar.mutate()}>{conectar.isPending ? 'Iniciando…' : 'Conectar WhatsApp'}</button>}
          {(e === 'ESPERANDO_QR' || e === 'CONECTANDO') && !abierto && <button className="boton-negro" onClick={() => setAbierto(true)}>Mostrar QR</button>}
          {e === 'CONECTADO' && <button className="boton-claro" disabled={desconectar.isPending}
            onClick={() => window.confirm('¿Desvincular el teléfono? Habrá que escanear el QR de nuevo.') && desconectar.mutate()}>Desvincular</button>}
          <button className="boton-claro" onClick={() => setAbierto(!abierto)}>{abierto ? 'Ocultar detalles' : 'Detalles'}</button>
        </div>
      </div>
      {(conectar.error || desconectar.error) && <div className="mt-3"><Aviso>{((conectar.error ?? desconectar.error) as Error).message}</Aviso></div>}
      {abierto && d && (
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-[auto_1fr]">
          {(e === 'ESPERANDO_QR' || e === 'CONECTANDO') && (
            <div className="flex flex-col items-center gap-2">
              {qr.data?.qr ? <img src={qr.data.qr} alt="Código QR para vincular WhatsApp" className="h-56 w-56 rounded-lg border border-linea" />
                : <div className="flex h-56 w-56 items-center justify-center rounded-lg border border-linea nota">Generando QR…</div>}
              <p className="nota max-w-56 text-center">WhatsApp › Dispositivos vinculados › Vincular un dispositivo.</p>
            </div>
          )}
          <ul className="flex flex-col gap-1.5 text-sm text-tinta-2">
            {d.detalle && <li>ⓘ {d.detalle}</li>}
            {d.errorEnvio && <li className="text-malo-texto">■ Último envío fallido: {d.errorEnvio}</li>}
            <li>• El agente responde solo a <strong>{d.numerosPermitidos}</strong> número(s) de la lista permitida (WHATSAPP_ALLOWLIST en .env).
              {d.numerosPermitidos === 0 && <span className="text-regular-texto"> ▲ La lista está vacía: agrega tu número (con 51, sin +) y reinicia.</span>}</li>
            <li>• La primera vez, el estudiante debe escribir: «{d.fraseActivacion}». El agente nunca escribe primero.</li>
            <li>• Se ignoran grupos, estados, mensajes propios y mensajes de hace más de 10 minutos.</li>
            <li>• Webhook firmado: {d.webhookListo ? '● registrado' : '– pendiente'} · sesión «{d.sesion}».</li>
            <li>• OpenWA usa WhatsApp Web (API no oficial): usa un número dedicado para la demo.</li>
          </ul>
        </div>
      )}
    </section>
  );
}
