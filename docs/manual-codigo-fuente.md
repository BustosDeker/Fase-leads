# MANUAL DE APLICACIÓN DEL CÓDIGO FUENTE

**INBESTIGA · Fase 2 LEADS (metodología IMPULSE)**
Aplicación web con Agente de IA para la negociación de asesoría de tesis por WhatsApp, con tablero de inteligencia de negocios

Curso: Inteligencia de Negocios · Ingeniería de Sistemas · UNT

---

## CONTENIDO GENERAL

> Las opciones son las mismas del Manual de Usuario. La numeración de páginas se agrega al convertir el documento a Word.

**A. PANTALLA DE INGRESO**
- A.1 Pantalla «Ingresar»
- A.2 Cierre de sesión y roles

**B. TABLERO BI**
- B.1 Tablero de gestión de LEADS
- B.2 Ejecutar ETL y Ajustes
- B.3 Explicar este tablero

**C. OPERACIÓN DE LEADS**
- C.1 Ficha nominal
- C.2 Conversaciones
- C.3 Pipeline
- C.4 Diagnósticos
- C.5 Cotizador
- C.6 Objeciones y escalamientos
- C.7 Agenda
- C.8 Consentimiento
- C.9 Auditoría

**D. INTEGRACIÓN CON OTRAS FASES**
- D.1 BUYERS
- D.2 PAYERS
- D.3 CUSTOMERS y TURNED
- D.4 Agente Plataforma

---

## INFORMACIÓN GENERAL

**Organización del código** (ver README):

| Carpeta | Contenido |
|---|---|
| `src/web/` | Frontend React: `pages/` (una por pantalla), `components/`, `hooks/`, `api.ts`. |
| `src/server/` | Rutas de la API (Fastify): `auth`, `rutas-leads`, `rutas-tablero`, `rutas-agente`, `rutas-whatsapp`, `rutas-integraciones`, `rutas-evidencias`. |
| `src/negocio/` | Reglas de negocio compartidas por las pantallas y el agente. |
| `src/agente/` | Motor del Agente Negociador, herramientas, guardas y proveedores de IA. |
| `src/etl/`, `src/kpi/` | Ejecución del ETL y consultas del tablero sobre el data mart. |
| `src/integraciones/` | Contratos con BUYERS y PAYERS. |
| `src/shared/` | Definición de indicadores y jerarquías, compartida por servidor y frontend. |
| `db/` | Scripts SQL: OLTP, data mart, ETL y reportes. |

**Convenciones.** Cada pantalla del frontend consulta la API con TanStack Query (`api.get` / `api.post`). Las escrituras del servidor van dentro de una transacción (`enTransaccion`) y, al terminar, publican un evento `oltp` por SSE para que las pantallas abiertas se refresquen. Las consultas SQL son parametrizadas.

**Los fragmentos son extractos** del código real; los puntos suspensivos (`…`) indican partes omitidas. Cada pantalla es la misma del Manual de Usuario (misma numeración de figuras).

---

## A. PANTALLA DE INGRESO

### A.1 Pantalla «Ingresar»

> **[Figura 01 · Pantalla «Ingresar» — misma captura del Manual de Usuario]**

**Descripción:** componente `Ingreso` y ruta `POST /api/auth/login`. Valida usuario y clave, limita los intentos y emite una cookie firmada.

`src/web/components/Sesion.tsx`

```tsx
function Ingreso({ alEntrar, aviso }: { alEntrar: () => void; aviso: string | null }) {
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const entrar = useMutation({ mutationFn: () => api.post<Usuario>('/api/auth/login', { usuario, clave }), onSuccess: alEntrar });
  return (
    <div className="flex min-h-screen items-center justify-center bg-fondo px-4">
      <form className="tarjeta w-full max-w-sm p-6" onSubmit={(e) => { e.preventDefault(); entrar.mutate(); }}>
        <h1 className="titulo-seccion mb-3">Ingresar</h1>
        <label className="mb-3 block"><span className="etiqueta-campo">Usuario</span>
          <input className="campo" autoComplete="username" value={usuario} onChange={(e) => setUsuario(e.target.value)} required autoFocus /></label>
        <label className="mb-4 block"><span className="etiqueta-campo">Clave</span>
          <input className="campo" type="password" autoComplete="current-password" value={clave} onChange={(e) => setClave(e.target.value)} required /></label>
        {(entrar.error || aviso) && <p role="alert" className="mb-3 text-sm text-malo-texto">■ {entrar.error ? (entrar.error as Error).message : aviso}</p>}
        <button className="boton-negro w-full" disabled={entrar.isPending}>{entrar.isPending ? 'Ingresando…' : 'Ingresar'}</button>
      </form>
    </div>
  );
}
```

`src/server/auth.ts`

```ts
app.post('/api/auth/login', async (req, reply) => {
  const ip = req.ip;
  const i = intentos.get(ip);
  if (i && Date.now() - i.desde < 60_000 && i.n >= 5) return reply.code(429).send({ error: 'Demasiados intentos. Espera un minuto.' });
  const { usuario, clave } = z.object({ usuario: z.string().trim().toLowerCase().min(1).max(60), clave: z.string().min(1).max(200) }).parse(req.body);
  const u = usuarios().get(usuario);
  if (!u || !igual(clave, u.clave)) {
    intentos.set(ip, i && Date.now() - i.desde < 60_000 ? { n: i.n + 1, desde: i.desde } : { n: 1, desde: Date.now() });
    return reply.code(401).send({ error: 'Usuario o clave incorrectos.' });
  }
  intentos.delete(ip);
  const s: Sesion = { usuario, rol: u.rol, exp: Date.now() + VIGENCIA_MS };
  reply.header('Set-Cookie', `${COOKIE}=${crearToken(s)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${VIGENCIA_MS / 1000}`);
  return { usuario, rol: u.rol };
});
```

### A.2 Cierre de sesión y roles

> **[Figura 02 · Pie del menú con usuario, rol y botón «Salir» — misma captura del Manual de Usuario]**

**Descripción:** `salir` cierra la sesión; `autorizar` decide, por rol, si una petición está permitida.

`src/web/components/Sesion.tsx`

```tsx
export const NOMBRE_ROL: Record<Usuario['rol'], string> = { admin: 'Administrador', asesor: 'Asesor', viewer: 'Solo consulta' };
const salir = async () => { await api.post('/api/auth/logout').catch(() => undefined); cliente.clear(); window.location.assign('/'); };
```

`src/server/auth.ts`

```ts
const PUBLICAS = new Set(['/api/auth/login', '/api/auth/yo', '/api/buyers', '/api/payers/confirmacion', '/api/whatsapp/webhook']);
const SOLO_ADMIN = [/^\/api\/etl\/ejecutar$/, /^\/api\/whatsapp\/(conectar|desconectar)$/];
const VIEWER_POST = new Set(['/api/auth/logout', '/api/tablero/explicar']);

export function autorizar(metodo: string, ruta: string, s: Sesion | null): { ok: true } | { ok: false; estado: 401 | 403; error: string } {
  if (!ruta.startsWith('/api/') || PUBLICAS.has(ruta)) return { ok: true };
  if (!s) return { ok: false, estado: 401, error: 'Inicia sesión para continuar.' };
  if (SOLO_ADMIN.some((r) => r.test(ruta)) && s.rol !== 'admin') return { ok: false, estado: 403, error: 'Esta acción es solo para el rol administrador.' };
  if (s.rol === 'viewer' && metodo !== 'GET' && !VIEWER_POST.has(ruta)) return { ok: false, estado: 403, error: 'Tu rol solo permite consultar (sin cambios).' };
  return { ok: true };
}
```

---

## B. TABLERO BI

### B.1 Tablero de gestión de LEADS

> **[Figura 03 · Tablero de gestión de LEADS — misma captura del Manual de Usuario]**

**Descripción:** la página arma filtros, tarjetas, embudo, tendencia y reporte; el servidor calcula cada indicador como cociente de sumas sobre el data mart.

`src/web/pages/Tablero.tsx`

```tsx
const { f, fijar, activos, limpiar } = useFiltros({ desde: '', hasta: '', grupoEtapa: '', canal: '', asesor: '' });
const kpis = useQuery({ queryKey: ['kpis', filtros], queryFn: () => api.get<Kpis>('/api/tablero/kpis', filtros) });
…
<section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-label="Indicadores">
  {INDICADORES.map((k) => {
    const c = kpis.data?.totales[k.codigo];
    return c ? <KpiCard key={k.codigo} def={k} num={c.num} den={c.den} />
      : <div key={k.codigo} className="tarjeta h-56 animate-pulse" aria-hidden />;
  })}
</section>
<ExplicarTablero filtros={filtros} />
<div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
  {kpis.data ? <EmbudoChart totales={kpis.data.totales} /> : <div className="tarjeta h-80 animate-pulse" aria-hidden />}
  <TendenciaChart filtros={filtros} kpi={kpiTendencia} onKpi={setKpiTendencia} />
</div>
<ReporteDimension filtros={filtros} />
<AccionesSugeridas filtros={filtros} />
```

`src/shared/indicadores.ts` (definición de un indicador, cociente de sumas y semáforo)

```ts
{ codigo: 'K1', nombre: 'Diagnóstico oportuno', hecho: 'Hecho_Diagnostico', claveTiempo: 'KeyTiempo',
  numerador: { medida: 'M2', columna: 'diagnostico_oportuno', etiqueta: 'diagnósticos a tiempo' },
  denominador: { medida: 'M1', columna: 'diagnostico_solicitud_madura', etiqueta: 'solicitudes maduras' },
  regularDesde: 75, buenoDesde: 90, … },

export function cocienteDeSumas(numerador: number, denominador: number): number | null {
  if (!denominador) return null;
  return (100 * numerador) / denominador;
}
```

`src/server/rutas-tablero.ts`

```ts
app.get('/api/tablero/kpis', async (req) => {
  const f = esquemaFiltros.parse(req.query);
  return { totales: await totalesKpi(f), plazos: await plazosVigentes() };
});
app.get('/api/tablero/reporte', async (req) => { … return reportePorDimension(f, p.jerarquia, p.nivel, ruta); });
app.get('/api/tablero/tendencia', async (req) => { … return tendenciaMensual(esquemaFiltros.parse(q), kpi); });
```

`src/kpi/consultas.ts` (filtros validados y columnas de listas blancas)

```ts
export const esquemaFiltros = z.object({
  desde: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  grupoEtapa: z.string().max(40).optional(),
  canal: z.string().max(80).optional(),
  asesor: z.string().max(150).optional(),
});
```

### B.2 Ejecutar ETL y Ajustes

> **[Figura 04 · Panel «Parámetros de medición» — misma captura del Manual de Usuario]**

**Descripción:** `BotonEtl` lanza la carga con los parámetros del panel; el servidor ejecuta el ETL en una sola transacción y registra la ejecución.

`src/web/components/EtlRunner.tsx`

```tsx
const m = useMutation({
  mutationFn: () => api.post<{ ok: boolean; error?: string }>('/api/etl/ejecutar', {
    ...p, corte: p.corte ? new Date(p.corte).toISOString() : undefined,
  }),
  onSettled: () => { setPaso(null); cliente.invalidateQueries(); },
});
…
<button className="boton-claro" onClick={() => setAjustes(!ajustes)} aria-expanded={ajustes}>Ajustes</button>
<button className="boton-negro min-w-[150px]" onClick={() => m.mutate()} disabled={m.isPending}>
  {m.isPending ? 'Ejecutando…' : 'Ejecutar ETL'}
</button>
```

`src/server/rutas-tablero.ts`

```ts
app.post('/api/etl/ejecutar', async (req, reply) => {
  if (etlEnCurso) return reply.code(409).send({ error: 'Ya hay una carga del data mart en curso.' });
  const cuerpo = z.object({ corte: z.string().optional(), wdHoras: z.number().optional(), wqHoras: z.number().optional(),
    waDias: z.number().optional(), wcDias: z.number().optional() }).parse(req.body ?? {});
  const p = esquemaParametrosEtl.parse({ ...parametrosPorDefecto(), ...Object.fromEntries(Object.entries(cuerpo).filter(([, v]) => v != null && v !== '')) });
  etlEnCurso = true;
  publicar('etl', { paso: 'inicio' });
  try {
    const r = await ejecutarEtl(p, { origen: 'APP', alPaso: (paso) => publicar('etl', { paso }) });
    publicar('etl', { paso: 'terminado', ok: r.ok });
    return r;
  } finally { etlEnCurso = false; }
});
```

`src/etl/ejecutar.ts`

```ts
const tx = new sql.Transaction(poolOltp);
try {
  await tx.begin();
  aviso('dimensiones');
  await conParametros(new sql.Request(tx), p).query(dimensiones);
  aviso('hechos');
  await conParametros(new sql.Request(tx), p).query(hechos);
  aviso('conteo');
  …
  await tx.commit();
  …
} catch (e: any) {
  try { await tx.rollback(); } catch { /* la transacción pudo no haber empezado */ }
  …
  await poolMart.request().input('id', sql.Int, etlId).input('ms', sql.Int, duracionMs).input('err', sql.NVarChar, error)
    .query(`UPDATE dbo.ETL_EJECUCION SET fin = SYSDATETIME(), duracion_ms = @ms, estado = 'ERROR', error = @err WHERE etl_id = @id`);
}
```

### B.3 Explicar este tablero

> **[Figura 05 · Sección «Explicar este tablero» con resultado — misma captura del Manual de Usuario]**

**Descripción:** el botón llama a la API; el servidor arma el resumen por reglas o con IA y descarta el texto de la IA si cita una cifra que no está en el tablero.

`src/web/components/ExplicarTablero.tsx`

```tsx
const m = useMutation({ mutationFn: () => api.post<Explicacion>('/api/tablero/explicar', filtros) });
…
<button className="boton-claro" disabled={m.isPending} onClick={() => m.mutate()}>{m.isPending ? 'Preparando…' : m.data ? 'Volver a explicar' : 'Explicar'}</button>
```

`src/agente/explicar.ts`

```ts
const prov = obtenerProveedor();
if (prov.nombre === 'mock') return { texto: porReglas, origen: 'reglas' as const };
…
const citados = texto.match(/\d+(?:,\d)?\s?%/g) ?? [];
const ajenos = citados.filter((c) => !permitidos.has(c.replace(/\s?%/, ' %')));
if (ajenos.length || !texto.trim()) return { texto: porReglas, origen: 'reglas' as const, aviso: 'La explicación con IA citó cifras que no están en el tablero; se muestra la explicación por reglas.' };
return { texto: texto.trim(), origen: prov.nombre, modelo: prov.modelo };
```

`src/server/rutas-agente.ts`

```ts
app.post('/api/tablero/explicar', async (req) => explicarTablero(esquemaFiltros.parse(req.body ?? {}), await plazos()));
```

---

## C. OPERACIÓN DE LEADS

### C.1 Ficha nominal

> **[Figura 06 y 07 · Ficha nominal — mismas capturas del Manual de Usuario]**

**Descripción:** la página consulta la ficha completa de un lead y ofrece las acciones de diagnóstico, descarte, edición de contacto y eliminación. La transición de estados se valida en `transicionar`.

`src/web/pages/Ficha.tsx`

```tsx
const q = useQuery({ queryKey: ['ficha', leadId], enabled: !!leadId, queryFn: () => api.get<Ficha>(`/api/leads/${leadId}/ficha`) });
const accion = useMutation({
  mutationFn: ({ url, cuerpo }: { url: string; cuerpo?: unknown }) => api.post(url, cuerpo),
  onSuccess: () => cliente.invalidateQueries({ queryKey: ['ficha', leadId] }),
});
…
{op && ['APTA_PARA_COTIZAR', 'EN_NEGOCIACION'].includes(op.estado) && <Link className="boton-negro" to={`/leads/cotizador?op=${op.oportunidad_id}`}>Cotizar</Link>}
…
{op?.estado === 'EN_DIAGNOSTICO' && diags.some((d) => d.estado === 'ENTREGADO') && (
  <button className="boton-negro" disabled={accion.isPending} onClick={() => accion.mutate({ url: `/api/oportunidades/${opId}/aptitud` })}>Marcar apta para cotizar</button>
)}
```

`src/server/rutas-leads.ts` (ficha, descarte y eliminación)

```ts
app.get('/api/leads/:leadId/ficha', async (req, reply) => {
  const { leadId } = z.object({ leadId: id }).parse(req.params);
  const f = await L.fichaNominal(leadId);
  return f ?? reply.code(404).send({ error: 'No existe ese lead.' });
});
app.post('/api/oportunidades/:id/descartar', async (req) => {
  const { id: o } = z.object({ id }).parse(req.params);
  const { motivo } = z.object({ motivo: z.string().trim().min(3).max(120) }).parse(req.body);
  await enTransaccion(await oltp(), (tx) => transicionar(tx, o, 'DESCARTADA', 'HUMANO', motivo));
  await avisar(o, 'descarte');
  return { ok: true };
});
app.delete('/api/leads/:leadId', async (req) => {
  …
  if (row.tiene_registros_financieros)
    throw new ErrorNegocio('No se puede eliminar este lead porque tiene registros de pago o honorarios. Conserva su historial financiero.', 409);
  …
});
```

`src/negocio/diagnostico.ts` (reglas de diagnóstico y aptitud)

```ts
if (!['ABIERTA', 'EN_DIAGNOSTICO'].includes(op.estado)) throw new ErrorNegocio(`La oportunidad ya está en ${op.estado}.`);
…
if (op.estado === 'ABIERTA') await transicionar(tx, s.oportunidadId, 'EN_DIAGNOSTICO', origen);
…
if (op.estado !== 'EN_DIAGNOSTICO') throw new ErrorNegocio(`Solo una oportunidad en diagnóstico puede calificarse (estado: ${op.estado}).`);
…
if (!d.recordset[0].n) throw new ErrorNegocio('Falta un diagnóstico entregado: la aptitud solo se registra con información suficiente.');
await transicionar(tx, oportunidadId, 'APTA_PARA_COTIZAR', origen, 'Requisitos mínimos verificados');
```

`src/negocio/oportunidad.ts` (máquina de estados)

```ts
export async function transicionar(tx: sql.Transaction, oportunidadId: number, nuevo: EstadoOportunidad, origen: Origen, detalle?: string) {
  const op = await oportunidadBloqueada(tx, oportunidadId);
  if (op.estado === nuevo) return op.estado;
  const t = await new sql.Request(tx).input('o', sql.VarChar, op.estado).input('d', sql.VarChar, nuevo)
    .query('SELECT evento FROM dbo.TRANSICION_ESTADO_OPORTUNIDAD WHERE estado_origen = @o AND estado_destino = @d');
  if (!t.recordset[0]) throw new ErrorNegocio(`No se puede pasar de ${op.estado} a ${nuevo}.`);
  …
  await registrarEvento(tx, oportunidadId, t.recordset[0].evento, origen, detalle, op.estado, nuevo);
  return nuevo;
}
```

### C.2 Conversaciones

> **[Figura 08 y 09 · Conversaciones y auditoría de turnos — mismas capturas del Manual de Usuario]**

**Descripción:** la pantalla lista conversaciones, permite escribir (como estudiante en el simulador o como asesor) y tomar o devolver el control. El motor del agente decide si responde, ejecuta el turno y audita todo.

`src/web/pages/Conversaciones.tsx`

```tsx
const enviar = useMutation({
  mutationFn: (t: string) => comoAsesor || !esSim
    ? api.post(`/api/conversaciones/${c.conversacion_id}/mensajes`, { texto: t, asesorId })
    : api.post<F>(`/api/simulador/conversaciones/${c.conversacion_id}/mensajes`, { texto: t }),
  onSuccess: () => { setTexto(''); refrescar(); },
});
const tomar = useMutation({ mutationFn: () => api.post(`/api/conversaciones/${c.conversacion_id}/tomar`, { asesorId }), onSuccess: refrescar });
const devolver = useMutation({ mutationFn: () => api.post(`/api/conversaciones/${c.conversacion_id}/devolver`), onSuccess: refrescar });
…
// Escribir primero por WhatsApp (el agente envía la plantilla de primer contacto)
const iniciar = useMutation({
  mutationFn: (leadId: number) => api.post<F>('/api/whatsapp/iniciar', { leadId }),
  onSuccess: (r) => { abrirConversacion(r.conversacionId); cliente.invalidateQueries({ queryKey: ['conversaciones'] }); },
});
```

`src/server/rutas-agente.ts`

```ts
app.post('/api/simulador/conversaciones/:id/mensajes', async (req, reply) => {
  …
  return procesarMensajeEntrante(c, texto);
});
app.post('/api/conversaciones/:id/mensajes', async (req, reply) => {
  …
  if (det.conversacion.no_contactar) return reply.code(409).send({ error: 'El estudiante revocó su consentimiento: no se le puede escribir.' });
  …
  if (!det.conversacion.control_humano) await tomarControl(c, asesorId);   // escribir como persona implica tomar el control
  await guardarMensaje(c, 'ESPECIALISTA', texto, { asesorId });
  if (det.conversacion.canal_mensajeria === 'WHATSAPP') { … await enviarPorCanal(c, texto); }
  …
});
```

`src/agente/motor.ts` (turno del agente)

```ts
export function procesarMensajeEntrante(conversacionId: number, texto: string, idExterno?: string | null): Promise<ResultadoTurno> {
  return enCola(conversacionId, async () => {
    const entradaId = await guardarMensaje(conversacionId, 'CLIENTE', texto, { idExterno });
    if (!entradaId) return { respondio: false, motivo: 'Mensaje duplicado (ya procesado).', mensajeEntradaId: null };
    const cx = await cargarContexto(conversacionId);
    if (cx.controlHumano || cx.estadoConversacion === 'DERIVADA') return { respondio: false, motivo: 'La conversación está a cargo de una persona.', mensajeEntradaId: entradaId };
    if (cx.noContactar && !FRASE_RECONSENTIMIENTO.test(texto)) return { respondio: false, motivo: 'El estudiante revocó su consentimiento (no contactar).', mensajeEntradaId: entradaId };
    const prov = obtenerProveedor();
    const sospecha = detectarInyeccion(texto);
    …
    respuesta = await prov.responder({
      sistema: promptSistema(cat), contexto: contextoComoTexto(cx, sospecha), historial: await historial(conversacionId),
      herramientas: definiciones(), ejecutar: (n, e) => ejecutarHerramienta(cx, n, e, bitacora), datos: cx, sospechaInyeccion: sospecha,
    });
    …
    const revision = revisarSalida(respuesta, permitidos);
    const salidaId = await guardarMensaje(conversacionId, 'BOT', revision.texto);
    … // INSERT dbo.AGENTE_TURNO (proveedor, modelo, latencia, herramientas, sospecha_inyeccion, error)
  });
}
```

`src/agente/guardas.ts` (el precio nunca lo escribe el modelo)

```ts
export function revisarSalida(texto: string, montosPermitidos: number[]): RevisionSalida {
  …
  const fuera = montosEn(t).filter((m) => !montosPermitidos.some((p) => Math.abs(p - m) < 0.01));
  if (fuera.length) {
    obs.push(`La respuesta citaba montos que no salieron del motor de precios (${fuera.map((x) => 'S/ ' + x.toFixed(2)).join(', ')}).`);
    return { bloqueada: true, observaciones: obs,
      texto: 'Para no darte un monto incorrecto, prefiero confirmarlo con el sistema de precios. En un momento te comparto la cifra exacta o te escribe un especialista.' };
  }
  …
}
```

`src/server/rutas-whatsapp.ts` (conexión, primer contacto y webhook firmado)

```ts
app.post('/api/whatsapp/conectar', async () => conectar());
app.post('/api/whatsapp/iniciar', async (req) => {
  const { leadId } = z.object({ leadId: z.number().int().positive() }).parse(req.body);
  return iniciarConversacionConLead(leadId, (req as any).sesion?.usuario ?? null);
});
…
sub.post('/api/whatsapp/webhook', async (req, reply) => {
  const firma = req.headers['x-openwa-signature'];
  if (!firmaValida((req as any).cuerpoCrudo ?? '', Array.isArray(firma) ? firma[0] : firma)) {
    req.log.warn('webhook de WhatsApp con firma inválida: descartado');
    return reply.code(401).send({ error: 'Firma inválida.' });
  }
  …
  setImmediate(() => { manejarEvento(evento).then(…).catch(…); });   // responde de inmediato; el turno sigue en segundo plano
  return { recibido: true };
});
```

`src/server/rutas-leads.ts` (habilitar WhatsApp: exige consentimiento vigente)

```ts
if (habilitado && (numero.length < 9 || numero.length > 15))
  throw new ErrorNegocio('Registra un número de WhatsApp válido, con código de país.', 409);
if (habilitado && (!c.consentimiento_contacto || c.no_contactar))
  throw new ErrorNegocio('Solo puedes habilitar WhatsApp si el contacto tiene consentimiento vigente.', 409);
await new sql.Request(tx).input('c', sql.Int, c.contacto_id).input('h', sql.Bit, habilitado)
  .query('UPDATE dbo.CONTACTO SET whatsapp_habilitado = @h WHERE contacto_id = @c');
```

### C.3 Pipeline

> **[Figura 10 y 11 · Pipeline en vista Tablero y Lista — mismas capturas del Manual de Usuario]**

**Descripción:** el frontend filtra y ordena en el navegador las oportunidades que devuelve `/api/pipeline`; los filtros viven en la URL.

`src/web/pages/Pipeline.tsx`

```tsx
const { f, fijar, activos } = useFiltros({ vista: 'tablero', texto: '', asesor: '', canal: '', etapa: '', datos: '', cerradas: '', orden: 'recientes' });
const filtradas = useMemo(() => datos.filter((o) =>
  (!f.asesor || o.responsable === f.asesor) && (!f.canal || o.canal === f.canal) && (!f.etapa || o.grupo_etapa === f.etapa) &&
  (!f.datos || (f.datos === 'prueba' ? o.es_demo : !o.es_demo)) && coincide(f.texto, o.estudiante, o.carrera, o.oportunidad_id))
  .sort(ORDENES[f.orden] ?? ORDENES.recientes), [datos, f.asesor, f.canal, f.etapa, f.datos, f.texto, f.orden]);
const verCerradas = f.cerradas === '1';
const columnas = ORDEN_ESTADOS.filter((e) => verCerradas || (e !== 'DESCARTADA' && e !== 'PAYER_CONFIRMADO'));
```

`src/negocio/lecturas.ts`

```ts
export async function pipeline() {
  const r = await (await oltp()).request().query(`
    SELECT o.oportunidad_id, o.lead_id, o.estado, o.fecha_inicio, o.es_demo, co.nombres + ' ' + co.apellidos AS estudiante,
           ISNULL(a.nombre, 'Agente IA') AS responsable, cn.nombre AS canal, ca.nombre AS carrera,
           CASE WHEN pa.etapa_academica IN ('CICLO_IX','CICLO_X') THEN 'Ciclos IX–X' WHEN pa.etapa_academica = 'EGRESADO' THEN 'Egresado'
                WHEN pa.etapa_academica = 'BACHILLER' THEN 'Bachiller' ELSE 'Sin perfil' END AS grupo_etapa,
           (SELECT MAX(fecha) FROM dbo.OPORTUNIDAD_EVENTO e WHERE e.oportunidad_id = o.oportunidad_id AND e.estado_nuevo IS NOT NULL) AS desde,
           (SELECT TOP 1 precio_final FROM dbo.PROPUESTA p WHERE p.oportunidad_id = o.oportunidad_id ORDER BY version DESC) AS precio,
           …
    FROM dbo.OPORTUNIDAD_COMERCIAL o JOIN dbo.LEAD l ON l.lead_id = o.lead_id …
    ORDER BY o.fecha_inicio DESC`);
  return r.recordset;
}
```

### C.4 Diagnósticos

> **[Figura 12 · Diagnósticos de tesis — misma captura del Manual de Usuario]**

**Descripción:** la consulta calcula la situación de cada diagnóstico (a tiempo, tarde, en plazo, vencido) según el plazo en horas.

`src/web/pages/Diagnosticos.tsx`

```tsx
const SIT: Record<Dx['situacion'], { t: string; corto: string; tono: 'bueno' | 'malo' | 'regular' }> = {
  VENCIDO: { t: '■ Pendiente y vencido', corto: 'Vencidos', tono: 'malo' },
  EN_PLAZO: { t: '▲ Pendiente dentro del plazo', corto: 'Pendientes en plazo', tono: 'regular' },
  A_TIEMPO: { t: '● Entregado a tiempo', corto: 'Entregados a tiempo', tono: 'bueno' },
  TARDE: { t: '■ Entregado fuera de plazo', corto: 'Entregados tarde', tono: 'malo' },
};
const q = useQuery({ queryKey: ['diagnosticos', plazo], queryFn: () => api.get<Dx[]>('/api/diagnosticos', { plazo }) });
```

`src/negocio/lecturas.ts`

```ts
DATEDIFF(MINUTE, d.fecha_solicitud, ISNULL(d.fecha_entrega, SYSDATETIME())) / 60.0 AS horas,
CASE WHEN d.fecha_entrega IS NOT NULL AND d.fecha_entrega <= DATEADD(HOUR, @h, d.fecha_solicitud) THEN 'A_TIEMPO'
     WHEN d.fecha_entrega IS NOT NULL THEN 'TARDE'
     WHEN SYSDATETIME() <= DATEADD(HOUR, @h, d.fecha_solicitud) THEN 'EN_PLAZO' ELSE 'VENCIDO' END AS situacion
```

`src/server/rutas-leads.ts`

```ts
app.get('/api/diagnosticos', async (req) => {
  const { plazo } = z.object({ plazo: z.coerce.number().int().min(1).max(720).default(48) }).parse(req.query);
  return L.diagnosticos(plazo);
});
app.post('/api/diagnosticos/:id/entregar', async (req) => {
  const { id: d } = z.object({ id }).parse(req.params);
  const { resumen } = z.object({ resumen: z.string().trim().min(10).max(4000) }).parse(req.body);
  const r = await enTransaccion(await oltp(), (tx) => entregarDiagnostico(tx, d, resumen, 'HUMANO'));
  await avisar(r.oportunidadId, 'diagnostico');
  return r;
});
```

### C.5 Cotizador

> **[Figura 13 y 14 · Cotizador — mismas capturas del Manual de Usuario]**

**Descripción:** el frontend simula la cotización con cada cambio y presenta una versión nueva; el motor de precios (función pura) aplica reglas, tope de descuento y precio mínimo.

`src/web/pages/Cotizador.tsx`

```tsx
const sim = useQuery({ queryKey: ['simular', solicitud], enabled: !!opId && !!s.servicioId,
  queryFn: () => api.post<{ cotizacion: Cotizacion; bloqueada: boolean; motivosBloqueo: string[]; avisos: string[] }>('/api/cotizador/simular', solicitud) });
const presentar = useMutation({
  mutationFn: () => api.post<{ version: number; precioFinal: number }>('/api/cotizador/presentar', solicitud),
  onSuccess: () => { cliente.invalidateQueries({ queryKey: ['cotizador', opId] }); setS((x) => ({ ...x, descuentoNegociadoPct: 0 })); },
});
…
<button className="boton-negro mt-3 w-full" disabled={!editable || sim.data.bloqueada || presentar.isPending}
  onClick={() => presentar.mutate()}>{presentar.isPending ? 'Registrando…' : `Presentar versión ${siguiente}`}</button>
```

`src/negocio/precios.ts`

```ts
export function cotizar(t: Tarifa, reglas: Regla[], c: ContextoCotizacion, extras: Extra[] = []): Cotizacion {
  const base = cent(t.precioBase);
  const montoExtras = cent(extras.reduce((s, e) => s + e.cantidad * e.precioUnitario, 0));
  const recargos: Ajuste[] = reglas.filter((r) => r.tipo === 'RECARGO' && reglaAplica(r, c)).map(…);
  const descuentos: Ajuste[] = reglas.filter((r) => r.tipo === 'DESCUENTO' && reglaAplica(r, c)).map(…);
  if (c.descuentoNegociadoPct && c.descuentoNegociadoPct > 0) {
    descuentos.push({ reglaId: null, tipo: 'DESCUENTO', concepto: 'Ajuste negociado', porcentaje: c.descuentoNegociadoPct,
      monto: cent(base * c.descuentoNegociadoPct / 100) });
  }
  const recargo = cent(recargos.reduce((s, a) => s + a.monto, 0));
  // Límite efectivo del descuento: el menor entre el tope y lo que deja el precio en el mínimo.
  const limiteTope = piso(base * t.topeDescuentoPct / 100);
  const limiteMinimo = piso(base + montoExtras + recargo - t.precioMinimo);
  let disponible = Math.max(0, Math.min(limiteTope, limiteMinimo));
  for (const d of descuentos) {               // se respetan en orden; el exceso se recorta
    const monto = piso(Math.min(d.monto, disponible));
    if (monto < d.monto && d.reglaId === null) negociadoExcede = true;
    …
  }
  …
  return { …, precioFinal: cent(base + montoExtras + recargo - descuento), …, negociadoExcede };
}
```

`src/negocio/propuestas.ts` (bloqueo y versionado)

```ts
if (!['APTA_PARA_COTIZAR', 'EN_NEGOCIACION'].includes(opo.estado))
  throw new ErrorNegocio(`Solo se cotiza una oportunidad apta o en negociación (estado actual: ${opo.estado}).`);
…
if (sim.bloqueada) throw new ErrorNegocio(`Propuesta bloqueada: ${sim.motivosBloqueo.join(' ')}`);
…
if (opo.estado === 'APTA_PARA_COTIZAR') await transicionar(tx, s.oportunidadId, 'EN_NEGOCIACION', op.origen, `Versión ${version}`);
```

`src/server/rutas-leads.ts`

```ts
app.post('/api/cotizador/simular', async (req) => simularCotizacion(await oltp(), esquemaSolicitudCotizacion.parse(req.body)));
app.post('/api/cotizador/presentar', async (req) => {
  const s = esquemaSolicitudCotizacion.parse(req.body);
  const r = await enTransaccion(await oltp(), async (tx) => {
    const resp = await new sql.Request(tx).input('o', sql.Int, s.oportunidadId)
      .query('SELECT asesor_responsable_id AS a FROM dbo.OPORTUNIDAD_COMERCIAL WHERE oportunidad_id = @o');
    return presentarPropuesta(tx, s, { origen: 'HUMANO', asesorId: resp.recordset[0]?.a ?? null });
  });
  await avisar(s.oportunidadId, 'propuesta');
  return r;
});
```

### C.6 Objeciones y escalamientos

> **[Figura 15 y 16 · Objeciones y escalamientos — mismas capturas del Manual de Usuario]**

**Descripción:** tres vistas (cola, objeciones y catálogo) alimentadas por una sola consulta; «Marcar atendido» registra la fecha de atención.

`src/web/pages/Objeciones.tsx`

```tsx
const resultadoDe = (o: F) => (o.estado === 'RESUELTA' ? 'recuperada' : o.escalada ? 'escalada' : 'pendiente');
const q = useQuery({ queryKey: ['objeciones'], queryFn: () => api.get<{ objeciones: F[]; escalamientos: F[]; catalogo: F[] }>('/api/objeciones') });
const atender = useMutation({ mutationFn: (id: number) => api.post(`/api/escalamientos/${id}/atender`), onSuccess: () => cliente.invalidateQueries({ queryKey: ['objeciones'] }) });
const pendientes = useMemo(() => esc.filter((e) => !e.fecha_atencion && (!f.destino || e.destino_rol === f.destino)
  && coincide(f.texto, e.estudiante, e.motivo, e.resumen)), [esc, f.destino, f.texto]);
```

`src/server/rutas-leads.ts`

```ts
app.get('/api/objeciones', async () => L.objecionesYEscalamientos());
app.post('/api/escalamientos/:id/atender', async (req) => {
  const { id: e } = z.object({ id }).parse(req.params);
  const r = await (await oltp()).request().input('e', sql.Int, e).query(`
    UPDATE dbo.ESCALAMIENTO SET fecha_atencion = SYSDATETIME(), estado = 'ATENDIDO'
    OUTPUT INSERTED.oportunidad_id WHERE escalamiento_id = @e AND fecha_atencion IS NULL`);
  await avisar(r.recordset[0]?.oportunidad_id ?? null, 'escalamiento');
  return { ok: !!r.recordset[0] };
});
```

### C.7 Agenda

> **[Figura 17 · Agenda de citas virtuales — misma captura del Manual de Usuario]**

**Descripción:** vista semanal y alta de citas; el servidor rechaza solapamientos por asesor con bloqueo de rango y valida el ciclo de estados.

`src/web/pages/Agenda.tsx`

```tsx
const SIGUIENTE: Record<string, string[]> = { SOLICITADA: ['CONFIRMADA', 'CANCELADA'], CONFIRMADA: ['REALIZADA', 'NO_ASISTIO', 'CANCELADA'] };
const crear = useMutation({
  mutationFn: () => api.post<{ citaId: number }>('/api/agenda/citas', { ...nueva, inicio: new Date(nueva.inicio).toISOString() }),
  onSuccess: () => cliente.invalidateQueries({ queryKey: ['agenda'] }),
});
const estado = useMutation({
  mutationFn: ({ id, e }: { id: number; e: string }) => api.post(`/api/agenda/citas/${id}/estado`, { estado: e, causa: `Marcada como ${NOMBRE[e].toLowerCase()} por el asesor` }),
  onSuccess: () => cliente.invalidateQueries({ queryKey: ['agenda'] }),
});
```

`src/negocio/agenda.ts`

```ts
const TRANSICIONES_CITA: Record<string, string[]> = {
  SOLICITADA: ['CONFIRMADA', 'CANCELADA'], CONFIRMADA: ['REALIZADA', 'NO_ASISTIO', 'CANCELADA'],
  REALIZADA: [], CANCELADA: [], NO_ASISTIO: [],
};
async function haySolapamiento(tx: sql.Transaction, asesorId: number, inicio: Date, fin: Date, excluirCita?: number) {
  const r = await new sql.Request(tx).input('a', sql.Int, asesorId).input('i', sql.DateTime2, inicio).input('f', sql.DateTime2, fin)
    .input('x', sql.Int, excluirCita ?? null)
    .query(`SELECT TOP 1 cita_id, inicio, fin FROM dbo.CITA_VIRTUAL WITH (UPDLOCK, HOLDLOCK)
            WHERE asesor_id = @a AND estado <> 'CANCELADA' AND inicio < @f AND @i < fin AND (@x IS NULL OR cita_id <> @x)`);
  return r.recordset[0] as { cita_id: number; inicio: Date; fin: Date } | undefined;
}
export async function agendarCita(tx: sql.Transaction, c: z.infer<typeof esquemaCita>, origen: Origen) {
  const fin = new Date(c.inicio.getTime() + c.duracionMin * 60_000);
  if (c.inicio.getTime() < Date.now() - 60_000) throw new ErrorNegocio('No se puede agendar en el pasado.');
  const choque = await haySolapamiento(tx, c.asesorId, c.inicio, fin);
  if (choque) throw new ErrorNegocio(`El asesor ya tiene la cita #${choque.cita_id} en ese horario. Elige otro horario.`, 409);
  …
}
```

### C.8 Consentimiento

> **[Figura 18 · Consentimiento y privacidad — misma captura del Manual de Usuario]**

**Descripción:** otorgar o revocar el consentimiento actualiza el contacto y deja un registro con fecha y evidencia en el historial (Ley 29733).

`src/web/pages/Consentimiento.tsx`

```tsx
const estadoDe = (c: C) => (c.no_contactar ? 'revocado' : c.consentimiento_contacto ? 'vigente' : 'sin');
const cambiar = useMutation({
  mutationFn: ({ id, accion }: { id: number; accion: 'OTORGA' | 'REVOCA' }) =>
    api.post(`/api/contactos/${id}/consentimiento`, { accion, evidencia: accion === 'REVOCA' ? 'Revocado desde el panel a pedido del titular' : 'Otorgado desde el panel con confirmación del titular' }),
  onSuccess: () => cliente.invalidateQueries({ queryKey: ['consentimientos'] }),
});
```

`src/server/rutas-leads.ts`

```ts
app.post('/api/contactos/:id/consentimiento', async (req) => {
  const { id: c } = z.object({ id }).parse(req.params);
  const b = z.object({ accion: z.enum(['OTORGA', 'REVOCA']), evidencia: z.string().trim().min(3).max(300) }).parse(req.body);
  await enTransaccion(await oltp(), async (tx) => {
    await new sql.Request(tx).input('c', sql.Int, c).input('r', sql.Bit, b.accion === 'REVOCA').query(`
      UPDATE dbo.CONTACTO SET consentimiento_contacto = CASE WHEN @r = 1 THEN 0 ELSE 1 END, no_contactar = @r,
             whatsapp_habilitado = CASE WHEN @r = 1 THEN 0 ELSE whatsapp_habilitado END,
             fecha_revocacion = CASE WHEN @r = 1 THEN SYSDATETIME() ELSE NULL END,
             fecha_consentimiento = CASE WHEN @r = 0 THEN SYSDATETIME() ELSE fecha_consentimiento END,
             estado = CASE WHEN @r = 1 THEN 'BAJA' ELSE 'ACTIVO' END
      WHERE contacto_id = @c`);
    await new sql.Request(tx).input('c', sql.Int, c).input('a', sql.VarChar, b.accion).input('e', sql.NVarChar, b.evidencia).query(`
      INSERT dbo.CONSENTIMIENTO_HISTORIAL (contacto_id, accion, medio, finalidad, evidencia)
      VALUES (@c, @a, 'PANEL', N'Información y asesoría comercial de tesis', @e)`);
  });
  publicar('oltp', { tipo: 'consentimiento' });
  return { ok: true };
});
```

### C.9 Auditoría

> **[Figura 19 · Auditoría operativa del agente — misma captura del Manual de Usuario]**

**Descripción:** cinco controles calculados en vivo sobre la base transaccional; no modifican datos.

`src/web/pages/Auditoria.tsx`

```tsx
const controles = a ? [
  { t: 'Agenda y atención', d: 'Citas solapadas por asesor (excluye canceladas)', n: a.solapamientos.length },
  { t: 'Trazabilidad comercial', d: 'Propuestas sin ninguna respuesta registrada', n: a.sinRespuesta.length, alerta: false },
  { t: 'Reglas económicas', d: 'Descuento sobre el tope o precio bajo el mínimo', n: a.fueraDeLimites.length },
  { t: 'Escalamiento humano', d: 'Casos pendientes de atención', n: a.escalamientosPendientes.length },
  { t: 'Conciliación con PAYERS', d: 'Acuerdos transferidos sin confirmación (evita doble contabilización)', n: a.sinConfirmacionPayers.length, alerta: false },
] : [];
```

`src/negocio/lecturas.ts`

```ts
export async function auditoria() {
  const r = await (await oltp()).request().query(`
    SELECT a.asesor_id, s.nombre AS asesor, a.cita_id AS cita_1, b.cita_id AS cita_2, …
    FROM dbo.CITA_VIRTUAL a INNER JOIN dbo.CITA_VIRTUAL b
         ON b.asesor_id = a.asesor_id AND b.cita_id > a.cita_id AND a.inicio < b.fin AND b.inicio < a.fin
    …
    WHERE a.estado <> 'CANCELADA' AND b.estado <> 'CANCELADA';
    SELECT p.propuesta_id, … FROM dbo.PROPUESTA p LEFT JOIN dbo.RESPUESTA_PROPUESTA r ON r.propuesta_id = p.propuesta_id
    WHERE r.respuesta_id IS NULL ORDER BY p.fecha_presentacion DESC;
    SELECT propuesta_id, … FROM dbo.PROPUESTA
    WHERE descuento > precio_base * tope_descuento_aplicado / 100.0 OR precio_final < precio_minimo_aplicado;
    SELECT e.escalamiento_id, … FROM dbo.ESCALAMIENTO e WHERE e.fecha_atencion IS NULL ORDER BY e.fecha;
    SELECT t.oportunidad_id, … FROM dbo.TRANSFERENCIA_PAYER t … LEFT JOIN dbo.CONVERSION_PAYER_REF c ON c.oportunidad_id = t.oportunidad_id
    WHERE c.conversion_id IS NULL ORDER BY t.fecha_envio;`);
  …
}
```

---

## D. INTEGRACIÓN CON OTRAS FASES

### D.1 BUYERS

> **[Figura 20 · BUYERS → LEADS — misma captura del Manual de Usuario]**

**Descripción:** el simulador de la pantalla usa la misma lógica que el contrato real; sin consentimiento, el lead se rechaza y el registro es idempotente por WhatsApp.

`src/web/pages/Fases.tsx`

```tsx
const crear = useMutation({ mutationFn: () => api.post<F>('/api/simulador/buyers', {
  nombres: f.nombres, apellidos: f.apellidos, whatsapp: f.whatsapp, canal: f.canal || undefined, universidad: f.universidad || undefined,
  carrera: f.carrera || undefined, etapa: f.etapa || undefined, consentimiento: { otorgado: true, evidencia: f.evidencia } }) });
```

`src/server/rutas-integraciones.ts`

```ts
app.post('/api/buyers', async (req, reply) => {
  if (!tokenValido(req.headers.authorization, process.env.BUYERS_TOKEN)) return reply.code(401).send({ error: 'Token de BUYERS no válido.' });
  const r = await registrarLeadDesdeBuyers(esquemaLeadBuyers.parse(req.body));
  avisar(r.oportunidadId, r.leadId, 'buyers');
  return reply.code(r.creado ? 201 : 200).send(r);
});
```

`src/integraciones/integraciones.ts`

```ts
consentimiento: z.object({
  otorgado: z.literal(true, { errorMap: () => ({ message: 'Sin consentimiento de datos (Ley 29733) no se puede registrar el lead.' }) }),
  fecha: z.coerce.date().optional(),
  evidencia: z.string().trim().min(3).max(300),
}),
…
export async function registrarLeadDesdeBuyers(d: z.infer<typeof esquemaLeadBuyers>) {
  …
  if (previo.recordset[0]) return { creado: false, leadId: previo.recordset[0].lead_id as number, oportunidadId: previo.recordset[0].oportunidad_id as number | null };
  …
  // INSERT CONTACTO → CONSENTIMIENTO_HISTORIAL → BUYER → LEAD → OPORTUNIDAD_COMERCIAL ('ABIERTA')
}

export function tokenValido(cabecera: string | undefined, esperado: string | undefined): boolean {
  if (!esperado || !cabecera?.startsWith('Bearer ')) return false;
  const a = Buffer.from(crypto.createHash('sha256').update(cabecera.slice(7)).digest('hex'));
  const b = Buffer.from(crypto.createHash('sha256').update(esperado).digest('hex'));
  return crypto.timingSafeEqual(a, b);
}
```

### D.2 PAYERS

> **[Figura 21 · LEADS → PAYERS — misma captura del Manual de Usuario]**

**Descripción:** transferir envía el acuerdo aceptado con una clave de idempotencia; confirmar registra el evento de PAYERS una sola vez.

`src/web/pages/Fases.tsx`

```tsx
const transferir = useMutation({ mutationFn: (o: number) => api.post<F>(`/api/oportunidades/${o}/transferir`), onSuccess: refrescar });
const confirmar = useMutation({ mutationFn: (o: number) => api.post<F>(`/api/simulador/payers/${o}/confirmar`), onSuccess: refrescar });
```

`src/integraciones/integraciones.ts`

```ts
export async function transferirAPayers(oportunidadId: number, origen: Origen) {
  const r = await enTransaccion(await oltp(), async (tx) => {
    const op = await oportunidadBloqueada(tx, oportunidadId);
    if (op.estado !== 'ACEPTADA') throw new ErrorNegocio(`Solo se transfiere una oportunidad ACEPTADA (estado actual: ${op.estado}).`);
    …
    const clave = `leads-op${oportunidadId}-v${prop.version}`;
    await new sql.Request(tx)…query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.TRANSFERENCIA_PAYER WHERE idempotency_key = @k)
        INSERT dbo.TRANSFERENCIA_PAYER (oportunidad_id, propuesta_id, idempotency_key, estado) VALUES (@o, @p, @k, 'ENVIADA')`);
    await transicionar(tx, oportunidadId, 'TRANSFERIDA', origen, `Acuerdo v${prop.version} enviado a PAYERS`);
    …
  });
  …
}

export async function confirmarDesdePayers(c: z.infer<typeof esquemaConfirmacionPayers>) {
  return enTransaccion(await oltp(), async (tx) => {
    const dup = await new sql.Request(tx).input('e', sql.VarChar, c.event_id)
      .query('SELECT oportunidad_id FROM dbo.CONVERSION_PAYER_REF WITH (UPDLOCK, HOLDLOCK) WHERE event_id = @e');
    if (dup.recordset[0]) return { duplicado: true, oportunidadId: dup.recordset[0].oportunidad_id as number };
    …
    if (op.estado !== 'TRANSFERIDA') throw new ErrorNegocio(`Solo se confirma una oportunidad TRANSFERIDA (estado actual: ${op.estado}).`, 409);
    …
    await transicionar(tx, c.oportunidad_id, 'PAYER_CONFIRMADO', 'PAYERS', `Evento ${c.event_id}`);
    return { duplicado: false, oportunidadId: c.oportunidad_id };
  });
}
```

`src/server/rutas-integraciones.ts`

```ts
app.post('/api/payers/confirmacion', async (req, reply) => {
  if (!tokenValido(req.headers.authorization, process.env.PAYERS_TOKEN)) return reply.code(401).send({ error: 'Token de PAYERS no válido.' });
  const r = await confirmarDesdePayers(esquemaConfirmacionPayers.parse(req.body));
  if (!r.duplicado) avisar(r.oportunidadId, null, 'payers');
  return r;
});
```

### D.3 CUSTOMERS y TURNED

> **[Figura 22 · CUSTOMERS / TURNED — misma captura del Manual de Usuario]**

**Descripción:** pantalla informativa; no tiene lógica de servidor.

`src/web/pages/Fases.tsx`

```tsx
export function Fase() {
  const { fase } = useParams();
  if (fase === 'buyers') return <Buyers />;
  if (fase === 'payers') return <Payers />;
  const info = fase === 'customers'
    ? { t: 'CUSTOMERS', d: 'Acompañamiento del estudiante ya contratado: asignación del asesor académico, sesiones, hitos del cronograma, observaciones de la universidad y reportes de calidad.' }
    : { t: 'TURNED', d: 'Cierre del servicio y fidelización: encuesta de satisfacción, certificado de garantía y referidos que vuelven a BUYERS.' };
  …
}
```

### D.4 Agente Plataforma

> **[Figura 23 · Agente Plataforma — misma captura del Manual de Usuario]**

**Descripción:** una sola ruta entrega el embudo, la actividad del agente en 7 días, las derivaciones pendientes y el estado de los servicios; la página se actualiza cada 30 segundos.

`src/web/pages/Plataforma.tsx`

```tsx
const q = useQuery({ queryKey: ['plataforma'], queryFn: () => api.get<F>('/api/plataforma/resumen'), refetchInterval: 30_000 });
const etapas = d ? [
  { t: 'BUYERS', n: d.embudo.buyers, nota: 'interesados captados', a: '/fase/buyers' },
  { t: 'LEADS', n: d.embudo.leads, nota: 'en negociación', a: '/leads/pipeline' },
  { t: 'Aceptadas', n: d.embudo.aceptadas + d.embudo.transferidas + d.embudo.payers_confirmados, nota: 'propuestas aceptadas', a: '/fase/payers' },
  { t: 'PAYERS', n: d.embudo.payers_confirmados, nota: 'contrataciones confirmadas', a: '/fase/payers' },
  { t: 'CUSTOMERS', n: d.embudo.customers, nota: 'en acompañamiento', a: '/fase/customers' },
] : [];
```

`src/server/rutas-integraciones.ts`

```ts
app.get('/api/plataforma/resumen', async () => {
  const r = await (await oltp()).request().query(`
    SELECT (SELECT COUNT(*) FROM dbo.BUYER) AS buyers, (SELECT COUNT(*) FROM dbo.LEAD) AS leads,
           (SELECT COUNT(*) FROM dbo.OPORTUNIDAD_COMERCIAL WHERE estado = 'ACEPTADA') AS aceptadas, …
    SELECT COUNT(*) AS turnos, AVG(CAST(latencia_ms AS FLOAT)) AS latencia_media, …
    FROM dbo.AGENTE_TURNO WHERE fecha >= DATEADD(DAY, -7, SYSDATETIME());
    SELECT motivo, COUNT(*) AS n FROM dbo.ESCALAMIENTO WHERE estado = 'PENDIENTE' GROUP BY motivo ORDER BY n DESC; …`);
  const [emb, est, ag, esc, conv] = r.recordsets as any[];
  return { embudo: emb[0], estados: est, agente: { ...ag[0], ...estadoAgente() }, escalamientosPendientes: esc, conversacionesAbiertas: conv, whatsapp: estadoWhatsApp() };
});
```

---

## PENDIENTE DE VERIFICAR

- Capturas de pantalla (las mismas del Manual de Usuario).
- Fragmentos de `herramientas.ts`, `contexto.ts` y los proveedores de IA (Claude, OpenAI, Gemini, mock): no se detallan aquí; se describen en la Memoria Descriptiva. Falta decidir si se incluyen como anexo.
- Scripts SQL (`db/oltp`, `db/dm`, `db/etl`, `db/reports`): no se incluyen porque no son pantallas; falta decidir si se agregan como anexo.
- Las consultas de `src/kpi/consultas.ts` para el reporte por dimensión y la tendencia solo se citan de forma parcial.
- Funcionamiento con IA real y con WhatsApp real: según el README, aún no verificado.
