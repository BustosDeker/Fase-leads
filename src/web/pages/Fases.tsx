// Fases vecinas del embudo IMPULSE: BUYERS (entrega leads a LEADS), PAYERS (recibe acuerdos y confirma),
// CUSTOMERS y TURNED (fuera del alcance de este proyecto). Cada una muestra su contrato con LEADS y un simulador.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fecha, fechaHora } from '../formato';
import { useLiveEvents } from '../hooks/useLiveEvents';
import { Aviso, Bloque, CampoBusqueda, Chip, Encabezado, Iniciales, Segmentos, Tabla, coincide, soles, useFiltros } from '../components/ui';

type F = Record<string, any>;

export function Fase() {
  const { fase } = useParams();
  if (fase === 'buyers') return <Buyers />;
  if (fase === 'payers') return <Payers />;
  const info = fase === 'customers'
    ? { t: 'CUSTOMERS', d: 'Acompañamiento del estudiante ya contratado: asignación del asesor académico, sesiones, hitos del cronograma, observaciones de la universidad y reportes de calidad.' }
    : { t: 'TURNED', d: 'Cierre del servicio y fidelización: encuesta de satisfacción, certificado de garantía y referidos que vuelven a BUYERS.' };
  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-5">
      <Encabezado fase={info.t} ruta="Resumen" titulo={info.t} />
      <Bloque titulo="Fuera del alcance de este proyecto" origen="Metodología IMPULSE · fase a cargo de otro equipo">
        <p className="text-sm text-tinta-2">{info.d}</p>
        <p className="mt-3 text-sm text-tinta-2">LEADS entrega a PAYERS los acuerdos aceptados; PAYERS confirma la contratación y, desde ahí, el estudiante pasa a {info.t === 'CUSTOMERS' ? 'esta fase' : 'CUSTOMERS y luego a esta fase'}. Las tablas de la base de datos ya existen en el modelo del informe, pero sus pantallas las construye el equipo responsable.</p>
      </Bloque>
    </div>
  );
}

// ------------------------------------------------------------------ BUYERS
const ETAPAS: [string, string][] = [['CICLO_IX', 'IX ciclo'], ['CICLO_X', 'X ciclo'], ['EGRESADO', 'Egresado'], ['BACHILLER', 'Bachiller']];
const TIPOS_TESIS: [string, string][] = [['DESCRIPTIVA', 'Descriptiva'], ['CORRELACIONAL', 'Correlacional'], ['EXPERIMENTAL', 'Experimental'], ['APLICADA', 'Aplicada'], ['NO_DEFINIDO', 'Aún no definido']];
const nombreOpcion = (opciones: [string, string][], v: string) => opciones.find(([val]) => val === v)?.[1] ?? null;

/** Selector de una opción como chips (más directo que un <select> cuando hay pocas alternativas). */
function Chips({ valor, alCambiar, opciones }: { valor: string; alCambiar: (v: string) => void; opciones: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {opciones.map(([v, t]) => (
        <button key={v} type="button" aria-pressed={valor === v} onClick={() => alCambiar(valor === v ? '' : v)}
          className={`min-h-[36px] rounded-full border px-3 text-sm font-medium transition-colors ${
            valor === v ? 'border-tinta bg-tinta text-white' : 'border-linea-fuerte bg-white text-tinta-2 hover:border-tinta hover:text-tinta'}`}>
          {t}
        </button>
      ))}
    </div>
  );
}

/** Encabezado numerado de cada sección del formulario (da la sensación de pasos, sin obligar a navegar entre pantallas). */
function Paso({ n, titulo, nota, completo }: { n: number; titulo: string; nota: string; completo: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold ${
        completo ? 'border-tinta bg-tinta text-white' : 'border-linea-fuerte bg-white text-tinta-3'}`}>{completo ? '✓' : n}</span>
      <span className="text-sm font-semibold">{titulo}</span><span className="nota">{nota}</span>
    </div>
  );
}

const CAMPOS_VACIOS = {
  nombres: '', apellidos: '', whatsapp: '', correo: '', canal: 'Instagram', evidencia: 'Aceptó la política de datos en el formulario',
  universidad: '', carrera: '', etapa: '', sede: '',
  tema: '', tipoTesis: '', avanceDeclarado: '0', tieneEmpresaAplicacion: '', limitaciones: '', fechaLimite: '',
};

function Buyers() {
  const navegar = useNavigate();
  const catAcademico = useQuery({ queryKey: ['catalogos-academicos'], queryFn: () => api.get<{ universidades: string[]; carreras: string[] }>('/api/catalogos/academicos') });
  const [f, setF] = useState(CAMPOS_VACIOS);
  const cambiar = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const tieneTema = f.tema.trim() !== '';
  // Regla de negocio: sin tema de tesis el avance siempre es 0 % — no se pregunta ni se habilita hasta que escriba un tema.
  useEffect(() => { if (!tieneTema && f.avanceDeclarado !== '0') cambiar('avanceDeclarado')('0'); }, [tieneTema]); // eslint-disable-line react-hooks/exhaustive-deps
  const crear = useMutation({ mutationFn: () => api.post<F>('/api/simulador/buyers', {
    nombres: f.nombres, apellidos: f.apellidos, whatsapp: f.whatsapp, correo: f.correo || undefined, canal: f.canal || undefined,
    consentimiento: { otorgado: true, evidencia: f.evidencia },
    universidad: f.universidad, carrera: f.carrera, etapa: f.etapa, sede: f.sede,
    tema: f.tema || undefined, tipoTesis: f.tipoTesis, avanceDeclarado: Number(f.avanceDeclarado),
    tieneEmpresaAplicacion: f.tieneEmpresaAplicacion === 'si', limitaciones: f.limitaciones, fechaLimite: f.fechaLimite,
  }), onSuccess: (r) => navegar(`/leads/ficha?lead=${r.leadId}&op=${r.oportunidadId ?? ''}`) });
  const campo = (k: keyof typeof f, etiqueta: string, extra: F = {}) => (
    <label><span className="etiqueta-campo">{etiqueta}{extra.required && <span className="text-malo-texto"> *</span>}</span>
      <input className="campo" value={f[k]} onChange={(e) => cambiar(k)(e.target.value)} {...extra} /></label>);

  const contactoCompleto = !!(f.nombres.trim().length >= 2 && f.apellidos.trim().length >= 2 && f.whatsapp.trim().length >= 9 && f.evidencia.trim());
  const perfilCompleto = !!(f.universidad.trim() && f.carrera.trim() && f.etapa && f.sede.trim());
  const diagCampos = [f.tipoTesis, f.avanceDeclarado, f.tieneEmpresaAplicacion, f.limitaciones, f.fechaLimite];
  const diagObligCompleto = !!(f.tipoTesis && f.avanceDeclarado !== '' && f.tieneEmpresaAplicacion && f.limitaciones.trim() && f.fechaLimite);
  const diagLlenos = diagCampos.filter((x) => x !== '').length;
  const todoListo = contactoCompleto && perfilCompleto && diagObligCompleto;
  // Progreso por campo obligatorio (no por sección completa): avanza con cada dato, no solo al terminar un bloque entero.
  const CAMPOS_OBLIGATORIOS: (keyof typeof f)[] = ['nombres', 'apellidos', 'whatsapp', 'evidencia', 'universidad', 'carrera', 'etapa', 'sede',
    'tipoTesis', 'avanceDeclarado', 'tieneEmpresaAplicacion', 'fechaLimite', 'limitaciones'];
  const llenos = CAMPOS_OBLIGATORIOS.filter((k) => f[k].trim() !== '').length;
  const avance = Math.round((llenos / CAMPOS_OBLIGATORIOS.length) * 100);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
      <Encabezado fase="BUYERS" ruta="Integración con LEADS" titulo="BUYERS → LEADS" />
      <Bloque titulo="Simulador de BUYERS" accion={<span className="nota text-right">Idempotente por WhatsApp · guarda el consentimiento (Ley 29733) · se marca como dato de prueba</span>}
        origen="El perfil académico y el diagnóstico son obligatorios: así el lead llega completo y el agente de WhatsApp solo confirma el interés antes de cotizar, nunca vuelve a preguntarlos.">
        <div className="mb-4 flex flex-wrap items-center gap-4 rounded-lg border border-linea bg-fondo/60 p-3">
          <Iniciales nombre={(f.nombres || f.apellidos) ? `${f.nombres} ${f.apellidos}` : 'Nuevo estudiante'} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{f.nombres || f.apellidos ? `${f.nombres} ${f.apellidos}` : 'Nombres y apellidos…'}</div>
            <div className="nota truncate">{f.whatsapp ? `+${f.whatsapp}` : 'Sin WhatsApp aún'}{f.universidad ? ` · ${f.universidad}` : ''}{f.carrera ? ` · ${f.carrera}` : ''}{nombreOpcion(ETAPAS, f.etapa) ? ` · ${nombreOpcion(ETAPAS, f.etapa)}` : ''}</div>
          </div>
          <div className="w-full sm:w-56">
            <div className="flex items-center justify-between text-xs text-tinta-3"><span>Listo para enviar</span><span className="tabular-nums">{avance} %</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-tinta transition-all" style={{ width: `${avance}%` }} /></div>
          </div>
          {todoListo && <Chip tono="bueno">● Lista: entra como ABIERTA (para los KPI) con el diagnóstico ya solicitado, para que el agente lo confirme por WhatsApp</Chip>}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); crear.mutate(); }}>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <section className="flex flex-col gap-2.5">
              <Paso n={1} titulo="Contacto y consentimiento" nota="obligatorio" completo={contactoCompleto} />
              {campo('nombres', 'Nombres', { required: true, minLength: 2 })}
              {campo('apellidos', 'Apellidos', { required: true, minLength: 2 })}
              {campo('whatsapp', 'WhatsApp (con 51)', { required: true, inputMode: 'numeric', placeholder: '51987654321' })}
              {campo('correo', 'Correo (opcional)', { type: 'email', placeholder: 'estudiante@correo.com' })}
              <label><span className="etiqueta-campo">Canal de captación</span>
                <input className="campo" list="canales" value={f.canal} onChange={(e) => cambiar('canal')(e.target.value)} /></label>
              <datalist id="canales"><option>Instagram</option><option>TikTok</option><option>Facebook</option><option>Referidos</option><option>Convenio universitario</option></datalist>
              {campo('evidencia', 'Evidencia del consentimiento', { required: true })}
            </section>

            <section className="flex flex-col gap-2.5 lg:border-l lg:border-linea lg:pl-4">
              <Paso n={2} titulo="Perfil académico" nota="obligatorio" completo={perfilCompleto} />
              <label><span className="etiqueta-campo">Universidad<span className="text-malo-texto"> *</span></span>
                <select className="campo" required value={f.universidad} onChange={(e) => cambiar('universidad')(e.target.value)}>
                  <option value="">Elige una universidad…</option>
                  {catAcademico.data?.universidades.map((u) => <option key={u} value={u}>{u}</option>)}
                </select></label>
              <label><span className="etiqueta-campo">Carrera<span className="text-malo-texto"> *</span></span>
                <select className="campo" required value={f.carrera} onChange={(e) => cambiar('carrera')(e.target.value)}>
                  <option value="">Elige una carrera…</option>
                  {catAcademico.data?.carreras.map((c) => <option key={c} value={c}>{c}</option>)}
                </select></label>
              {campo('sede', 'Sede o campus', { required: true, placeholder: 'Sede central…' })}
              <div><span className="etiqueta-campo mb-1 block">Etapa<span className="text-malo-texto"> *</span></span><Chips valor={f.etapa} alCambiar={cambiar('etapa')} opciones={ETAPAS} /></div>
            </section>

            <section className="flex flex-col gap-2.5 lg:border-l lg:border-linea lg:pl-4">
              <Paso n={3} titulo="Diagnóstico de la tesis" nota={`obligatorio · ${diagLlenos}/${diagCampos.length}`} completo={diagObligCompleto} />
              {campo('tema', 'Tema de tesis (opcional si aún no lo define)')}
              {campo('avanceDeclarado', tieneTema ? 'Avance declarado (%)' : 'Avance declarado (sin tema: 0 %)', { required: tieneTema, disabled: !tieneTema, type: 'number', min: 0, max: 100 })}
              <div><span className="etiqueta-campo mb-1 block">Tipo de investigación<span className="text-malo-texto"> *</span></span><Chips valor={f.tipoTesis} alCambiar={cambiar('tipoTesis')} opciones={TIPOS_TESIS} /></div>
              <div><span className="etiqueta-campo mb-1 block">¿Tiene empresa o institución?<span className="text-malo-texto"> *</span></span>
                <Chips valor={f.tieneEmpresaAplicacion} alCambiar={cambiar('tieneEmpresaAplicacion')} opciones={[['si', 'Sí'], ['no', 'No']]} /></div>
              {campo('fechaLimite', 'Fecha límite para entregar', { required: true, type: 'date' })}
              {campo('limitaciones', 'Limitaciones o dificultades', { required: true, placeholder: 'Tiempo, metodología, estadística…' })}
            </section>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-linea pt-4">
            <button className="boton-negro" disabled={crear.isPending || !todoListo}>{crear.isPending ? 'Enviando…' : 'Enviar lead a LEADS'}</button>
            {!todoListo && <span className="nota">Completa los campos marcados con * para habilitar el envío.</span>}
          </div>
        </form>
        {crear.isError && <div className="mt-3"><Aviso>{(crear.error as Error).message}</Aviso></div>}
      </Bloque>
    </div>
  );
}

// ------------------------------------------------------------------ PAYERS
const ESTADO_PAGO: Record<string, { t: string; tono: 'bueno' | 'malo'; simbolo: string }> = {
  PAYER_CONFIRMADO: { t: 'Payer', tono: 'bueno', simbolo: '●' },
  DESCARTADA: { t: 'Rechazada', tono: 'malo', simbolo: '■' },
};

function Payers() {
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const q = useQuery({ queryKey: ['pagos'], queryFn: () => api.get<F[]>('/api/pagos/bandeja') });
  useLiveEvents({ oltp: () => cliente.invalidateQueries({ queryKey: ['pagos'] }) });
  const eliminar = useMutation({ mutationFn: (leadId: number) => api.delete(`/api/leads/${leadId}`),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['pagos'] }) });
  const { f, fijar } = useFiltros({ estado: '', texto: '' });
  const todas = q.data ?? [];
  const cuenta = (e: string) => todas.filter((x) => x.estado_oportunidad === e).length;
  const filas = todas.filter((x) => (!f.estado || x.estado_oportunidad === f.estado) && coincide(f.texto, x.estudiante, x.servicio, x.oportunidad_id));
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <Encabezado fase="PAYERS" ruta="Integración con LEADS" titulo="LEADS → PAYERS" />
      {q.isError && <Aviso>{(q.error as Error).message}</Aviso>}
      {eliminar.isError && <Aviso>{(eliminar.error as Error).message}</Aviso>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Segmentos etiqueta="Estado" valor={f.estado} alCambiar={(v) => fijar({ estado: v })} opciones={[
          { v: '', t: 'Todas', n: todas.length }, { v: 'PAYER_CONFIRMADO', t: 'Payers', n: cuenta('PAYER_CONFIRMADO') },
          { v: 'DESCARTADA', t: 'Rechazadas', n: cuenta('DESCARTADA') }]} />
        <CampoBusqueda valor={f.texto} alCambiar={(v) => fijar({ texto: v })} placeholder="Estudiante, servicio o N.º" />
      </div>
      <Bloque titulo="Bandeja de PAYERS" origen={`${cuenta('PAYER_CONFIRMADO')} payers (pagaron al menos una cuota) · ${cuenta('DESCARTADA')} rechazaron pagar`}>
        <Tabla filas={filas} clave={(x) => x.oportunidad_id} vacio={todas.length ? 'Ninguna coincide con los filtros.' : 'Todavía nadie pagó ni rechazó un enlace de pago.'}
          columnas={[
            { titulo: 'Estudiante', orden: (x) => x.estudiante, celda: (x) => <button className="text-left" onClick={() => navegar(`/leads/ficha?lead=${x.lead_id}&op=${x.oportunidad_id}`)}>
              <div className="font-medium underline-offset-2 hover:underline">{x.estudiante}</div><div className="nota">{x.servicio ?? '—'} · v{x.version ?? '—'}</div></button> },
            { titulo: 'Monto', derecha: true, orden: (x) => Number(x.monto_comprometido), celda: (x) => soles(x.monto_comprometido) },
            { titulo: 'Estado', celda: (x) => { const e = ESTADO_PAGO[x.estado_oportunidad]; return <div className="flex flex-col items-start gap-1">
              <Chip tono={e?.tono ?? 'neutro'}>{e?.simbolo} {e?.t ?? x.estado_oportunidad}</Chip>{x.es_demo && <Chip tono="apagado">Dato de prueba</Chip>}</div>; } },
            { titulo: 'Plan de pago', celda: (x) => !x.orden_pago_id
              ? <span className="nota">Confirmación antigua (sin plan registrado)</span>
              : x.total_cuotas > 1
                ? <span className="nota">Cuota {x.cuotas_pagadas}/{x.total_cuotas} pagada{x.proxima_vence ? ` · próxima ${soles(x.proximo_monto)} vence ${fecha(x.proxima_vence)}` : ' · completó todas sus cuotas'}</span>
                : <span className="nota">Al contado</span> },
            { titulo: 'Último pago', orden: (x) => +new Date(x.fecha_pago ?? 0), celda: (x) => <span className="nota">
              {x.fecha_pago ? `${fechaHora(x.fecha_pago)}${x.medio_pago ? ` · ${x.medio_pago}` : ''}` : '—'}</span> },
            { titulo: '', celda: (x) => (
              <button className="boton-claro border-malo-marca text-malo-texto" disabled={eliminar.isPending}
                onClick={() => { if (window.confirm(`¿Eliminar a ${x.estudiante} y todo su historial (incluido el pago) para volver a probar? Esta acción no se puede deshacer.`)) eliminar.mutate(x.lead_id); }}>
                Eliminar
              </button>
            ) },
          ]} />
      </Bloque>
      <Bloque titulo="Cómo funciona la integración" origen="La pasarela es simulada: no procesa tarjetas reales ni se comunica con un banco">
        <ul className="flex flex-col gap-1 text-sm text-tinta-2">
          <li>• Al aceptar la propuesta, el agente pregunta el plan (contado o cuotas, y en cuántas) y envía el enlace de la primera cuota por WhatsApp.</li>
          <li>• Si no paga en una hora, el sistema le reenvía un recordatorio automático.</li>
          <li>• Con el primer pago ya es un payer, aunque falten cuotas; cada cuota siguiente se cobra con su propio enlace, enviado solo cuando vence su fecha.</li>
          <li>• Si rechaza pagar la primera cuota (en la pasarela o por chat), la oportunidad queda Rechazada y no llega a esta bandeja como payer.</li>
        </ul>
      </Bloque>
    </div>
  );
}
