// Auditoría operativa (sección 4.14.4 del informe; sobre el OLTP, sin indicadores nuevos).
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { fecha, fechaHora } from '../formato';
import { Aviso, Bloque, Chip, Encabezado, Tabla, soles } from '../components/ui';

type F = Record<string, any>;
interface Auditoria { solapamientos: F[]; sinRespuesta: F[]; fueraDeLimites: F[]; escalamientosPendientes: F[]; sinConfirmacionPayers: F[] }

function Estado({ n, alerta = true }: { n: number; alerta?: boolean }) {
  return n === 0 ? <Chip tono="bueno">● Sin hallazgos</Chip> : <Chip tono={alerta ? 'malo' : 'regular'}>{alerta ? '■' : '▲'} {n} por revisar</Chip>;
}

export function Auditoria() {
  const navegar = useNavigate();
  const q = useQuery({ queryKey: ['auditoria'], queryFn: () => api.get<Auditoria>('/api/auditoria') });
  const a = q.data;
  const ir = (f: F) => f.lead_id && navegar(`/leads/ficha?lead=${f.lead_id}&op=${f.oportunidad_id ?? f.oportunidad_1 ?? ''}`);
  const controles = a ? [
    { t: 'Agenda y atención', d: 'Citas solapadas por asesor (excluye canceladas)', n: a.solapamientos.length },
    { t: 'Trazabilidad comercial', d: 'Propuestas sin ninguna respuesta registrada', n: a.sinRespuesta.length, alerta: false },
    { t: 'Reglas económicas', d: 'Descuento sobre el tope o precio bajo el mínimo', n: a.fueraDeLimites.length },
    { t: 'Escalamiento humano', d: 'Casos pendientes de atención', n: a.escalamientosPendientes.length },
    { t: 'Conciliación con PAYERS', d: 'Acuerdos transferidos sin confirmación (evita doble contabilización)', n: a.sinConfirmacionPayers.length, alerta: false },
  ] : [];

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <Encabezado ruta="Auditoría" titulo="Auditoría operativa del agente">
        <span className="nota">Fuente: base transaccional (en vivo)</span>
      </Encabezado>
      {q.isError && <Aviso>{(q.error as Error).message}</Aviso>}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {controles.map((c) => (
          <article key={c.t} className="tarjeta p-4">
            <h2 className="text-sm font-semibold">{c.t}</h2>
            <p className="nota mt-1 min-h-[32px]">{c.d}</p>
            <div className="mt-2 text-3xl font-bold">{c.n}</div>
            <div className="mt-1"><Estado n={c.n} alerta={c.alerta !== false} /></div>
          </article>
        ))}
      </section>

      {a && (
        <>
          <Bloque titulo="Citas solapadas" origen="CITA_VIRTUAL">
            <Tabla filas={a.solapamientos} clave={(f) => `${f.cita_1}-${f.cita_2}`} vacio="● Sin solapamientos."
              columnas={[{ titulo: 'Asesor', celda: (f) => f.asesor }, { titulo: 'Citas', celda: (f) => `#${f.cita_1} (${f.estado_1}) y #${f.cita_2} (${f.estado_2})` },
                { titulo: 'Horario', celda: (f) => `${fechaHora(f.inicio)} – ${new Date(f.fin).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}` },
                { titulo: 'Oportunidades', celda: (f) => `#${f.oportunidad_1} y #${f.oportunidad_2}` }]} />
          </Bloque>
          <Bloque titulo="Reglas económicas" origen="PROPUESTA (tope de descuento y precio mínimo aplicados)">
            <Tabla filas={a.fueraDeLimites} clave={(f) => f.propuesta_id} vacio="● Todas las propuestas respetan tope y mínimo." alClic={ir}
              columnas={[{ titulo: 'Propuesta', celda: (f) => `#${f.propuesta_id}` }, { titulo: 'Precio base', derecha: true, celda: (f) => soles(f.precio_base) },
                { titulo: 'Descuento', derecha: true, celda: (f) => soles(f.descuento) }, { titulo: 'Tope', derecha: true, celda: (f) => `${Number(f.tope_descuento_aplicado)} %` },
                { titulo: 'Final / mínimo', derecha: true, celda: (f) => `${soles(f.precio_final)} / ${soles(f.precio_minimo_aplicado)}` }]} />
          </Bloque>
          <Bloque titulo="Escalamientos pendientes" origen="ESCALAMIENTO (fecha_atencion vacía)">
            <Tabla filas={a.escalamientosPendientes} clave={(f) => f.escalamiento_id} vacio="● Sin pendientes." alClic={ir}
              columnas={[{ titulo: 'Fecha', celda: (f) => fechaHora(f.fecha) }, { titulo: 'Motivo', celda: (f) => f.motivo.replaceAll('_', ' ').toLowerCase() },
                { titulo: 'Destino', celda: (f) => f.destino_rol.toLowerCase() }, { titulo: 'Resumen', celda: (f) => <span className="text-tinta-2">{f.resumen}</span> }]} />
          </Bloque>
          <Bloque titulo="Conciliación con PAYERS" origen="TRANSFERENCIA_PAYER sin CONVERSION_PAYER_REF">
            <Tabla filas={a.sinConfirmacionPayers} clave={(f) => f.oportunidad_id} vacio="● Todas las transferencias están confirmadas." alClic={ir} maxFilas={15}
              columnas={[{ titulo: 'Oportunidad', celda: (f) => `#${f.oportunidad_id}` }, { titulo: 'Propuesta', celda: (f) => `#${f.propuesta_id}` },
                { titulo: 'Enviada', celda: (f) => fechaHora(f.fecha_envio) }, { titulo: 'Días esperando', derecha: true, celda: (f) => f.dias }]} />
          </Bloque>
          <Bloque titulo="Propuestas sin respuesta" origen="PROPUESTA sin RESPUESTA_PROPUESTA">
            <Tabla filas={a.sinRespuesta} clave={(f) => f.propuesta_id} vacio="● Todas tienen respuesta." alClic={ir} maxFilas={15}
              columnas={[{ titulo: 'Propuesta', celda: (f) => `#${f.propuesta_id} · v${f.version}` }, { titulo: 'Presentada', celda: (f) => fechaHora(f.fecha_presentacion) },
                { titulo: 'Vigencia', celda: (f) => fecha(f.vigencia_hasta) }, { titulo: 'Estado', celda: (f) => f.estado },
                { titulo: 'Precio', derecha: true, celda: (f) => soles(f.precio_final) }]} />
          </Bloque>
        </>
      )}
    </div>
  );
}
