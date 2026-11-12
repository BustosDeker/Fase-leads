// Evidencias para la sustentación: cada dato se calcula en el momento contra SQL Server.
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { fechaHora } from '../formato';
import { Aviso, Bloque, Chip, Encabezado, Tabla } from '../components/ui';
import { useSesion } from '../components/Sesion';
import { INDICADORES } from '../../shared/indicadores';

type F = Record<string, any>;

/** Nombre de negocio de cada medida (la UI no muestra códigos internos). La BD devuelve «M2 diagnostico_oportuno». */
const NOMBRES: Record<string, { indicador: string; etiqueta: string }> = Object.fromEntries(INDICADORES.flatMap((k) => [
  [k.numerador.medida, { indicador: k.nombre, etiqueta: k.numerador.etiqueta }], [k.denominador.medida, { indicador: k.nombre, etiqueta: k.denominador.etiqueta }]]));
const codigo = (m: string) => m.trim().split(/\s+/)[0];
const nombreMedida = (m: string) => { const n = NOMBRES[codigo(m)]; return n ? `${n.indicador}: ${n.etiqueta}` : 'Medida'; };
/** «M2 <= M1» → «Diagnóstico oportuno: diagnósticos a tiempo ≤ solicitudes maduras». */
const nombreRegla = (r: string) => { const [a, b] = r.split('<=').map(codigo); const x = NOMBRES[a], y = NOMBRES[b];
  return x && y ? `${x.indicador}: ${x.etiqueta} ≤ ${y.etiqueta}` : 'Regla de coherencia'; };

function Comprobacion({ ok, texto, detalle }: { ok: boolean; texto: string; detalle?: string }) {
  return (
    <li className="flex items-start gap-2 border-b border-linea py-2 text-sm">
      <span className="shrink-0 whitespace-nowrap"><Chip tono={ok ? 'bueno' : 'malo'}>{ok ? '● Cumple' : '■ No cumple'}</Chip></span>
      <span><span className="font-medium">{texto}</span>{detalle && <span className="block nota">{detalle}</span>}</span>
    </li>
  );
}

export function Evidencias() {
  const { yo } = useSesion();
  const q = useQuery({ queryKey: ['evidencias'], queryFn: () => api.get<F>('/api/evidencias'), staleTime: 0 });
  const pruebas = useMutation({ mutationFn: () => api.post<F>('/api/evidencias/pruebas') });
  const d = q.data;
  const v = d?.verificacion;
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <Encabezado fase="PLATAFORMA" ruta="Evidencias" titulo="Evidencias verificables">
        <button className="boton-claro" disabled={q.isFetching} onClick={() => q.refetch()}>{q.isFetching ? 'Verificando…' : 'Volver a verificar'}</button>
      </Encabezado>
      <p className="nota -mt-2">Todo se calcula en este momento contra SQL Server; nada está escrito a mano.</p>
      {q.isError && <Aviso>{(q.error as Error).message}</Aviso>}
      {!d ? <div className="tarjeta h-64 animate-pulse" aria-hidden /> : <>
        <Bloque titulo="Data mart = base transaccional" origen={d.etl ? `Recalcula cada medida desde el OLTP con los parámetros de la última carga (${fechaHora(d.etl.inicio)}) y la compara con el data mart` : 'Aún no hay una carga del data mart'}>
          {!v ? <p className="nota">Ejecuta la carga del data mart desde el Tablero BI.</p>
            : 'error' in v ? <Aviso>{v.error}</Aviso> : <>
              <div className="mb-3"><Chip tono={v.ok ? 'bueno' : 'malo'}>{v.ok ? `● Coinciden ${v.medidas.length} de ${v.medidas.length} medidas y todas las reglas` : '■ Hay diferencias'}</Chip></div>
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                <Tabla filas={v.medidas} clave={(m: F) => m.medida} columnas={[
                  { titulo: 'Medida', celda: (m: F) => nombreMedida(m.medida) },
                  { titulo: 'OLTP', derecha: true, celda: (m: F) => m.oltp },
                  { titulo: 'Data mart', derecha: true, celda: (m: F) => m.mart },
                  { titulo: 'Resultado', celda: (m: F) => <Chip tono={m.resultado === 'COINCIDE' ? 'bueno' : 'malo'}>{m.resultado === 'COINCIDE' ? '● Coincide' : '■ Diferencia'}</Chip> },
                ]} />
                <Tabla filas={v.coherencia} clave={(c: F) => c.regla} columnas={[
                  { titulo: 'Regla de coherencia (lo cumplido no supera lo medido)', celda: (c: F) => nombreRegla(c.regla) },
                  { titulo: 'Casos', derecha: true, celda: (c: F) => `${c.num} / ${c.den}` },
                  { titulo: 'Resultado', celda: (c: F) => <Chip tono={c.cumple === 'SI' ? 'bueno' : 'malo'}>{c.cumple === 'SI' ? '● Cumple' : '■ No cumple'}</Chip> },
                ]} />
              </div>
            </>}
        </Bloque>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Bloque titulo="Seguridad de la base de datos" origen={`Permisos reales del usuario con el que se conecta la app (${d.privilegios.login})`}>
            <ul>
              <Comprobacion ok={!d.privilegios.sysadmin} texto="La app no se conecta como administrador del servidor" detalle="«sa» solo se usa en la inicialización (db:init)." />
              <Comprobacion ok={!d.privilegios.db_owner} texto="La app no es dueña de la base de datos" />
              <Comprobacion ok={!d.privilegios.puede_crear_tablas && !d.privilegios.puede_crear_usuarios} texto="La app no puede crear tablas ni usuarios" />
              <Comprobacion ok={!!d.privilegios.lector && !!d.privilegios.escritor} texto="Solo lectura y escritura de datos (mínimo privilegio)" />
            </ul>
          </Bloque>
          <Bloque titulo="Reglas de negocio en la base de datos" origen="Restricciones y triggers que impiden datos inválidos aunque se salte la app">
            <ul>
              <Comprobacion ok={d.integridad.trigger_estados === 1} texto="La máquina de estados se valida en la base de datos" detalle={`${d.integridad.transiciones_permitidas} transiciones permitidas; cualquier otra es rechazada.`} />
              <Comprobacion ok={d.integridad.checks_precio === 2 && d.integridad.propuestas_fuera_de_limites === 0} texto="Ninguna propuesta supera el tope de descuento ni baja del precio mínimo" detalle={`${d.integridad.propuestas_fuera_de_limites} propuestas fuera de límites.`} />
              <Comprobacion ok={d.integridad.citas_solapadas === 0} texto="Ningún asesor tiene citas superpuestas" />
              <Comprobacion ok={d.integridad.mensajes_tras_revocar === 0} texto="No se escribió a nadie después de revocar su consentimiento" detalle={`${d.integridad.contactos_no_contactar} contactos con «no contactar».`} />
            </ul>
          </Bloque>
        </div>

        <Bloque titulo="Agente Negociador" origen="Auditoría de todos los turnos registrados">
          <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3 xl:grid-cols-6">
            {[['Turnos', d.agente.turnos], ['Latencia media', d.agente.latencia_media ? `${Math.round(d.agente.latencia_media)} ms` : '—'], ['Con error', d.agente.con_error],
              ['Manipulación detectada', d.agente.sospechas], ['Respuestas corregidas', d.agente.respuestas_corregidas], ['Acciones bloqueadas sin consentimiento', d.agente.bloqueos_por_consentimiento]]
              .map(([k, val]) => <div key={k as string}><dt className="nota">{k}</dt><dd className="text-xl font-bold">{val}</dd></div>)}
          </dl>
          <p className="nota mt-3">Proveedores usados: {d.proveedores.map((p: F) => `${p.proveedor_llm === 'mock' ? 'modo sin IA' : p.proveedor_llm} (${p.n})`).join(' · ') || 'ninguno todavía'}.</p>
        </Bloque>

        <Bloque titulo="Pruebas automáticas" origen="Ejecuta npm test en el servidor (motor de precios, indicadores, barreras del agente y conciliación con la base de datos)"
          accion={yo.rol === 'admin' ? <button className="boton-negro" disabled={pruebas.isPending} onClick={() => pruebas.mutate()}>{pruebas.isPending ? 'Ejecutando… (hasta 1 min)' : 'Ejecutar pruebas'}</button>
            : <span className="nota">Solo el administrador puede ejecutarlas.</span>}>
          {pruebas.isError && <Aviso>{(pruebas.error as Error).message}</Aviso>}
          {pruebas.data && <>
            <div className="mb-3"><Chip tono={pruebas.data.ok ? 'bueno' : 'malo'}>{pruebas.data.ok ? '● ' : '■ '}{pruebas.data.pasaron} pasaron · {pruebas.data.fallaron} fallaron · {(pruebas.data.duracionMs / 1000).toFixed(1)} s</Chip></div>
            <ul className="grid grid-cols-1 gap-1 text-sm md:grid-cols-2">{pruebas.data.pruebas.map((p: F, i: number) => <li key={i}>{p.ok ? '●' : '■'} {p.nombre}</li>)}</ul>
          </>}
        </Bloque>
      </>}
    </div>
  );
}
