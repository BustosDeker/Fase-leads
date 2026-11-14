// Pasarela de pago SIMULADA: la abre el estudiante desde el enlace que el agente envía por WhatsApp.
// Página pública (sin sesión del panel): el token de la URL es su propia credencial de un solo uso.
// El plan (contado o cuotas) ya quedó fijado al generar el enlace; aquí solo se elige el medio de pago.
// Nada de lo que se escribe aquí (tarjeta, "escaneo" de Yape) se envía a ningún lado: solo confirma la simulación.
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ErrorApi } from '../api';

interface DatosPago {
  estadoEnlace: 'ENVIADO' | 'PAGADO' | 'EXPIRADO' | 'ANULADO'; estadoOportunidad: string;
  servicio: string; monto: number; cuotaActual: number; totalCuotas: number;
  nombres: string; apellidos: string; whatsapp: string; correo: string | null;
  medios: { id: number; nombre: string }[];
}

const soles = (n: number) => `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tipoMedio = (nombre: string): 'TARJETA' | 'YAPE' | 'TRANSFERENCIA' =>
  /yape/i.test(nombre) ? 'YAPE' : /transferencia|dep[oó]sito/i.test(nombre) ? 'TRANSFERENCIA' : 'TARJETA';

function Tarjeta({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[440px] rounded-2xl border border-linea bg-white p-6 text-center shadow-sm">{children}</div>;
}

/** QR decorativo (no es un código real: solo ilustra la simulación). Determinista por token, para que no "parpadee" al re-renderizar. */
function QrFalso({ semilla }: { semilla: string }) {
  const N = 17;
  const celdas = useMemo(() => {
    let h = 0; for (let i = 0; i < semilla.length; i++) h = (h * 31 + semilla.charCodeAt(i)) >>> 0;
    const azar = () => { h = (h * 1103515245 + 12345) >>> 0; return (h >>> 8) / 0x1000000; };
    const enFinder = (x: number, y: number) => [[0, 0], [N - 7, 0], [0, N - 7]].some(([fx, fy]) =>
      x >= fx && x < fx + 7 && y >= fy && y < fy + 7);
    const esFinderNegro = (x: number, y: number) => [[0, 0], [N - 7, 0], [0, N - 7]].some(([fx, fy]) => {
      const lx = x - fx, ly = y - fy; if (lx < 0 || lx > 6 || ly < 0 || ly > 6) return false;
      const borde = lx === 0 || lx === 6 || ly === 0 || ly === 6; const centro = lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4;
      return borde || centro;
    });
    const filas: boolean[][] = [];
    for (let y = 0; y < N; y++) { const fila: boolean[] = [];
      for (let x = 0; x < N; x++) fila.push(enFinder(x, y) ? esFinderNegro(x, y) : azar() > 0.55);
      filas.push(fila);
    }
    return filas;
  }, [semilla]);
  const tam = 180, celda = tam / N;
  return (
    <svg viewBox={`0 0 ${tam} ${tam}`} width={tam} height={tam} role="img" aria-label="Código QR de demostración (no escaneable)">
      <rect width={tam} height={tam} fill="white" />
      {celdas.map((fila, y) => fila.map((negro, x) => negro &&
        <rect key={`${x}-${y}`} x={x * celda} y={y * celda} width={celda} height={celda} fill="#1a1a2e" />))}
    </svg>
  );
}

export function PaginaPago() {
  const { token } = useParams();
  const q = useQuery({ queryKey: ['pago', token], enabled: !!token, retry: false,
    queryFn: () => api.get<DatosPago>(`/api/pago/${token}`) });
  const [medioPagoId, setMedioPagoId] = useState<number | ''>('');
  const [tarjeta, setTarjeta] = useState({ numero: '', vencimiento: '', cvv: '', titular: '' });
  const pagar = useMutation({ mutationFn: () => api.post(`/api/pago/${token}/confirmar`, { medioPagoId }) });
  const rechazar = useMutation({ mutationFn: () => api.post(`/api/pago/${token}/rechazar`, {}) });

  if (q.isLoading) return <div className="flex min-h-screen items-center justify-center nota">Cargando…</div>;
  if (q.isError || !q.data) {
    const noEncontrado = q.error instanceof ErrorApi && q.error.estado === 404;
    return <div className="flex min-h-screen items-center justify-center bg-fondo px-5"><Tarjeta>
      <h1 className="text-lg font-bold">{noEncontrado ? 'Enlace no encontrado' : 'No se pudo cargar el pago'}</h1>
      <p className="mt-2 text-sm text-tinta-2">{noEncontrado ? 'Este enlace de pago no existe o ya venció. Escríbenos por WhatsApp para que te enviemos uno nuevo.' : (q.error as Error)?.message}</p>
    </Tarjeta></div>;
  }
  const d = q.data;
  const esCuotas = d.totalCuotas > 1;

  if (pagar.isSuccess || d.estadoEnlace === 'PAGADO') {
    return <div className="flex min-h-screen items-center justify-center bg-fondo px-5"><Tarjeta>
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-bueno-fondo text-2xl text-bueno-texto">✓</div>
      <h1 className="mt-4 text-lg font-bold">¡Pago confirmado!</h1>
      <p className="mt-2 text-sm text-tinta-2">Gracias, {d.nombres}. Registramos tu pago de {soles(d.monto)}{esCuotas ? ` (cuota ${d.cuotaActual} de ${d.totalCuotas})` : ''} por «{d.servicio}».
        {esCuotas && d.cuotaActual < d.totalCuotas ? ' Te escribiremos por WhatsApp cuando corresponda tu próxima cuota.' : ' En breve te contactamos por WhatsApp para coordinar el inicio.'}</p>
    </Tarjeta></div>;
  }
  if (rechazar.isSuccess || d.estadoEnlace === 'ANULADO') {
    return <div className="flex min-h-screen items-center justify-center bg-fondo px-5"><Tarjeta>
      <h1 className="text-lg font-bold">Pago no realizado</h1>
      <p className="mt-2 text-sm text-tinta-2">No se hizo ningún cargo. Si cambias de opinión, escríbenos por WhatsApp y retomamos tu asesoría.</p>
    </Tarjeta></div>;
  }
  if (d.estadoEnlace === 'EXPIRADO') {
    return <div className="flex min-h-screen items-center justify-center bg-fondo px-5"><Tarjeta>
      <h1 className="text-lg font-bold">Enlace vencido</h1>
      <p className="mt-2 text-sm text-tinta-2">Este enlace de pago ya venció. Escríbenos por WhatsApp para que te enviemos uno nuevo.</p>
    </Tarjeta></div>;
  }

  const medioElegido = d.medios.find((m) => m.id === medioPagoId);
  const tipo = medioElegido ? tipoMedio(medioElegido.nombre) : null;
  const tarjetaCompleta = tarjeta.numero.replace(/\s/g, '').length >= 12 && tarjeta.vencimiento.length >= 4 && tarjeta.cvv.length >= 3 && tarjeta.titular.trim().length > 2;
  const listoParaPagar = tipo === 'TARJETA' ? tarjetaCompleta : !!tipo;
  const puedeRechazar = d.estadoOportunidad !== 'PAYER_CONFIRMADO'; // ya es payer: esto es una cuota siguiente, no la decisión inicial

  return (
    <div className="min-h-screen bg-fondo px-5 py-10">
      <div className="mx-auto grid max-w-[1000px] grid-cols-1 gap-8 lg:grid-cols-[1fr_1.2fr]">
        {/* ------------------------------------------------------------ resumen */}
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm text-tinta-2">Tienes un pago pendiente de <strong className="text-tinta">INBESTIGA</strong></p>
            <div className="mt-3 rounded-2xl border border-linea bg-white p-5">
              <h2 className="font-bold">Detalle de tu compra</h2>
              <p className="mt-1 text-sm text-tinta-2">{d.servicio} — Asesoría de tesis INBESTIGA.</p>
              {esCuotas && <p className="mt-1 text-sm text-tinta-2">Cuota {d.cuotaActual} de {d.totalCuotas}</p>}
              <div className="mt-4 border-t border-linea pt-4">
                <span className="etiqueta-campo">Monto a pagar</span>
                <div className="mt-1 text-3xl font-bold tabular-nums">{soles(d.monto)}</div>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-linea bg-white p-5">
            <h2 className="font-bold">Tus datos</h2>
            <dl className="mt-2 flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-tinta-3">Nombre</dt><dd className="text-right font-medium">{d.nombres} {d.apellidos}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-tinta-3">WhatsApp</dt><dd className="text-right font-medium">+{d.whatsapp}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-tinta-3">Correo</dt><dd className="truncate text-right font-medium">{d.correo ?? '—'}</dd></div>
            </dl>
          </div>
          <p className="text-xs text-tinta-3">Pasarela de demostración: no procesa pagos reales ni guarda datos de tarjeta.</p>
        </div>

        {/* ------------------------------------------------------------ medio de pago */}
        <div className="rounded-2xl border border-linea bg-white p-5">
          <h2 className="font-bold">¿Cómo quieres pagar?</h2>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {d.medios.map((m) => {
              const t = tipoMedio(m.nombre);
              const activo = medioPagoId === m.id;
              return (
                <button key={m.id} type="button" onClick={() => setMedioPagoId(m.id)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 text-center transition-colors ${
                    activo ? 'border-tinta bg-fondo' : 'border-linea hover:border-tinta/40'}`}>
                  <span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white ${
                    t === 'YAPE' ? 'bg-[#5e2d8f]' : t === 'TRANSFERENCIA' ? 'bg-tinta-2' : 'bg-tinta'}`}>
                    {t === 'YAPE' ? 'Y' : t === 'TRANSFERENCIA' ? 'B' : 'T'}
                  </span>
                  <span className="text-xs font-medium leading-tight">{m.nombre}</span>
                </button>
              );
            })}
          </div>

          {tipo === 'TARJETA' && (
            <div className="mt-5 flex flex-col gap-3 border-t border-linea pt-5">
              <p className="text-xs text-tinta-3">Datos de prueba: no ingreses el número de una tarjeta real.</p>
              <label><span className="etiqueta-campo">Número de tarjeta</span>
                <input className="campo" inputMode="numeric" maxLength={19} placeholder="4111 1111 1111 1111" value={tarjeta.numero}
                  onChange={(e) => setTarjeta({ ...tarjeta, numero: e.target.value.replace(/[^\d ]/g, '') })} /></label>
              <div className="grid grid-cols-2 gap-3">
                <label><span className="etiqueta-campo">Vencimiento</span>
                  <input className="campo" placeholder="MM/AA" maxLength={5} value={tarjeta.vencimiento}
                    onChange={(e) => setTarjeta({ ...tarjeta, vencimiento: e.target.value })} /></label>
                <label><span className="etiqueta-campo">CVV</span>
                  <input className="campo" inputMode="numeric" maxLength={4} placeholder="123" value={tarjeta.cvv}
                    onChange={(e) => setTarjeta({ ...tarjeta, cvv: e.target.value.replace(/\D/g, '') })} /></label>
              </div>
              <label><span className="etiqueta-campo">Nombre del titular</span>
                <input className="campo" placeholder="Como figura en la tarjeta" value={tarjeta.titular}
                  onChange={(e) => setTarjeta({ ...tarjeta, titular: e.target.value })} /></label>
            </div>
          )}

          {tipo === 'YAPE' && (
            <div className="mt-5 flex flex-col items-center gap-3 border-t border-linea pt-5 text-center">
              <p className="text-sm text-tinta-2">Escanea este código con tu app Yape</p>
              <div className="rounded-xl border-4 border-[#5e2d8f] p-2"><QrFalso semilla={token ?? 'demo'} /></div>
              <p className="text-lg font-bold tabular-nums">{soles(d.monto)}</p>
              <p className="text-xs text-tinta-3">Código de demostración: no es escaneable de verdad. Cuando «pagues» en tu app, presiona el botón de abajo.</p>
            </div>
          )}

          {tipo === 'TRANSFERENCIA' && (
            <div className="mt-5 flex flex-col gap-2 border-t border-linea pt-5">
              <p className="text-sm text-tinta-2">Transfiere el monto exacto a esta cuenta y luego confirma:</p>
              <dl className="flex flex-col gap-1.5 rounded-xl bg-fondo p-3 text-sm">
                <div className="flex justify-between"><dt className="text-tinta-3">Banco</dt><dd className="font-medium">BCP</dd></div>
                <div className="flex justify-between"><dt className="text-tinta-3">Titular</dt><dd className="font-medium">INBESTIGA S.A.C. (demo)</dd></div>
                <div className="flex justify-between"><dt className="text-tinta-3">Cuenta</dt><dd className="font-medium tabular-nums">194-2457896-0-45</dd></div>
                <div className="flex justify-between"><dt className="text-tinta-3">CCI</dt><dd className="font-medium tabular-nums">002-194-002457896045-18</dd></div>
              </dl>
              <p className="text-xs text-tinta-3">Cuenta de demostración: no transfieras dinero real.</p>
            </div>
          )}

          {pagar.isError && <p role="alert" className="mt-3 rounded-lg border border-malo-marca/30 bg-malo-fondo px-3 py-2 text-sm text-malo-texto">■ {(pagar.error as Error).message}</p>}
          {tipo && (
            <button className="boton-negro mt-5 w-full" disabled={!listoParaPagar || pagar.isPending} onClick={() => pagar.mutate()}>
              {pagar.isPending ? 'Procesando…' : tipo === 'YAPE' ? 'Ya escaneé y pagué' : tipo === 'TRANSFERENCIA' ? 'Ya transferí, confirmar pago' : `Pagar ${soles(d.monto)}`}
            </button>
          )}
          {puedeRechazar && (
            <button type="button" className="mt-3 w-full text-center text-sm text-tinta-3 underline-offset-2 hover:underline" disabled={rechazar.isPending}
              onClick={() => { if (window.confirm('¿Seguro que no deseas pagar por ahora? Se descartará tu oportunidad.')) rechazar.mutate(); }}>
              No deseo pagar por ahora
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
