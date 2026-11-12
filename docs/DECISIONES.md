# Decisiones de diseño e inconsistencias encontradas

Registro de las decisiones tomadas al implementar la Fase 2 · LEADS. Cada una indica la razón para que el equipo (y el docente) puedan revisarla.

## 1. Fuentes de verdad

| Archivo del equipo | Ubicación en el repo | Uso |
|---|---|---|
| `01_OLTP_ER.sql` (DDL v2, 59 tablas + Anexo A) | `db/oltp/01_OLTP_ER.sql` | Se ejecuta **sin cambios**. |
| `02_OLTP_Poblamiento_LEADS.sql` (datos de prueba del informe) | `db/oltp/simulacion_informe/` | Conjunto de prueba opcional (E2: `npm run seed -- --informe`). |
| `03_DataMart_DDL.sql` (Anexo B) | `db/dm/03_DataMart_DDL.sql` | Se ejecuta **sin cambios**. |
| `04_ETL.sql` (Anexo C) | `db/etl/04_ETL.sql` | Fuente del ETL de la app (E2). |
| `05_Conciliacion_Reportes.sql` (Anexo D) | `db/reports/05_Conciliacion_Reportes.sql` | Consultas R1–R4. Sus comentarios de «valores esperados» se refieren a los datos de prueba del informe y no se usan para validar. |
| Informe `LEADS_FASE2_FINAL_revisado_v2.docx` | `docs/informe/` | Requisitos (tablas 1–33). |

## 2. Diferencias entre el prompt y los scripts (se respetan los scripts)

| Tema | Prompt | Scripts / informe | Decisión |
|---|---|---|---|
| Nombre del data mart | `DM_LEADS` | `INBESTIGA_MART` | Se usa **`INBESTIGA_MART`**: el ETL y el Anexo D lo referencian literalmente (`INBESTIGA_MART.dbo.…`). |
| Nombres de plazos | `@WC`=2 h, `@WP`=60 d | `@WQ`=2 h, `@WC`=60 d | Se usan **los del script**: `@WD`=48 h, `@WQ`=2 h, `@WA`=30 d, `@WC`=60 d. En la UI solo se muestran como «plazo de diagnóstico», «plazo de cotización», etc. |
| Idempotencia de `db:init` | idempotente | `01` y `03` hacen `DROP DATABASE` | `db:init` solo ejecuta `01`/`03` si la base **no existe** (o con `--reset`). La ampliación y los catálogos de la app son idempotentes y se aplican siempre. |
| OLTP recreado con data mart conservado | — | Las dimensiones guardan IDs del OLTP (`idServicio`, `idAsesor`…) y su `MERGE` solo inserta | Si se recrea el OLTP, `db:init` **recrea también el data mart** para no dejar miembros con IDs obsoletos. |

## 3. Ampliación del OLTP para la app (`db/oltp/02_ampliacion_app.sql`)

No se modifica ninguna tabla de BUYERS ni ninguna regla del informe. Lo que se agrega:

| Cambio | Motivo |
|---|---|
| `CONTACTO.es_demo`, `OPORTUNIDAD_COMERCIAL.es_demo` | Separar los datos sintéticos de los generados en la demo en vivo (`npm run seed:reset`). |
| `MENSAJE.contenido` pasa de `VARCHAR(2000)` a `NVARCHAR(2000)` | **Inconsistencia:** los mensajes de WhatsApp traen emojis y `VARCHAR` con intercalación `Modern_Spanish_CI_AS` los convierte en `?`. |
| `MENSAJE.id_externo` (único filtrado) | Evitar procesar dos veces el mismo mensaje si OpenWA reintenta el webhook. |
| `CONVERSACION.canal_mensajeria`, `chat_id`, `oportunidad_id`, `control_humano`, `asesor_control_id` | Bandeja de conversaciones, simulador y «Tomar control humano / Devolver al agente». |
| `CONTACTO.fecha_revocacion` + tabla `CONSENTIMIENTO_HISTORIAL` | Ley 29733: registro de otorgamiento y revocación con su evidencia. |
| `PERFIL_NEGOCIACION.presupuesto_orientativo` | La tabla 4 del informe incluye «presupuesto orientativo» en el perfil de negociación y el DDL v2 no tenía la columna. |
| `CK_ESCALAMIENTO_MOTIVO` ampliado: `PRECIO_NO_CONFIGURADO`, `EXCEPCION_CONTRACTUAL`, `CONSULTA_ACADEMICA_COMPLEJA`, `INCERTIDUMBRE_AGENTE`, `POSIBLE_INYECCION` | La tabla 7 del informe («Derivación humana») menciona motivos que el `CHECK` original no admitía. Se conservan los 7 motivos originales. |
| `ESCALAMIENTO.resumen` | El DDL tenía `resumen_entregado BIT` pero no dónde guardar el resumen para el especialista. |
| `OBJECION.respuesta_agente` + tabla `CATALOGO_OBJECION` | Catálogo editable de objeciones (grupo, tipo, palabras clave, respuesta base, criterio de escalamiento). Los textos de `grupo` y `tipo` coinciden con `OBJECION`, que es lo que lee el ETL. |
| `TRANSICION_ESTADO_OPORTUNIDAD` + trigger `TR_OPORTUNIDAD_TRANSICION` | Transiciones de la tabla 6 validadas **en la BD** (además del `CHECK` de estados). El trigger actúa solo en `UPDATE`: los poblamientos insertan el estado final directamente. |
| `OPORTUNIDAD_EVENTO` | Línea de tiempo de la ficha nominal (cada transición y evento con fecha y origen). |
| `AGENTE_TURNO` | Auditoría del agente: mensaje de entrada/salida, tools invocadas, latencia, proveedor y modelo, sospecha de inyección. |
| Índices de apoyo | Búsqueda por nombre, agenda por asesor y oportunidades por lead. |

Inconsistencia corregida durante la verificación: el nombre de restricción `FK_CONV_OPORT` ya lo usa el Anexo A en `CONVERSION_PAYER_REF`; la FK nueva de `CONVERSACION` se llama `FK_CONVERSACION_OPORT`.

Resultado: `INBESTIGA_TESIS` = 59 (DDL v2) + 5 (Anexo A) + 5 (app) = **69 tablas**.

## 4. Data mart (`db/dm/03b_ampliacion_app.sql`)

Solo se agrega `ETL_EJECUCION` (bitácora: hora, duración, parámetros, filas por tabla, oportunidades sintéticas vs. reales) para la franja de estado del tablero. Las 8 dimensiones y los 3 hechos del Anexo B no se tocan. Resultado: **12 tablas**.

## 5. Catálogos (`db/oltp/03_catalogos.sql`)

- Universidades reales de la región (UNT, UPAO, UCV, UPN, UNMSM, UNC) y 12 carreras con su facultad. Son datos públicos, no personales.
- Canales: Instagram, TikTok, Facebook, convenio universitario, referidos y WhatsApp directo (este último es el origen de los contactos que escriben en la demo).
- **El «Agente IA» no es una fila de `ASESOR`.** Es `asesor_id = NULL` en el OLTP y el miembro 0 de `Dim_Asesor`, como define el informe.
- Tarifas: `precio_base` = precio de referencia × factor de la carrera; `precio_minimo` = 80 %; tope de descuento de 15 % (paquetes completos) o 10 % (resto). **Son valores de prueba que debe validar la gestión.**
- Nombres de asesores ficticios.
- El catálogo **no** se combina con `simulacion_informe/02_OLTP_Poblamiento_LEADS.sql`, porque ese script inserta sus propios catálogos con IDs fijos sobre una base vacía.

## 6. Seguridad de la conexión

- `DB_ADMIN_USER` (sa) solo se usa en `db:init` (y en la carga del escenario del informe, que necesita `IDENTITY_INSERT`).
- La app usa `inbestiga_app` con `db_datareader` + `db_datawriter` + `EXECUTE` en ambas bases. Su clave la genera `setup` en `.env`.
- `CREATE LOGIN` no admite parámetros: la sentencia se arma en el servidor con `QUOTENAME(@clave, '''')`, sin concatenar la clave en JavaScript.

## 7. Stack

- El backend corre con `tsx` (TypeScript sin paso de compilación) para no agregar un build al servidor. El frontend sí se compila con Vite en `setup`.
- Los scripts de `scripts/` son JavaScript ESM. `setup.js` no tiene dependencias porque corre antes de `npm install`.

## 8. Criterio de validación: el data mart debe coincidir con el OLTP

Las cifras del informe (Tabla 24 y tablas 25–33) son **datos de prueba**. La fuente de verdad es la base implementada. Por eso la validación compara cada hecho del data mart con lo que se calcula directamente sobre el OLTP del que se puebla. **Nunca se compara contra valores fijos del informe.**

`db/reports/06_verificacion_oltp_mart.sql` (lo usarán `npm run etl:verify` y las pruebas):
- Recalcula M1–M10 desde `INBESTIGA_TESIS`, una fila por unidad de conteo, **sin pasar por las dimensiones ni reutilizar las consultas del ETL**.
- Lo compara con `SUM()` de cada hecho en `INBESTIGA_MART`. Así detecta unidades perdidas en los `INNER JOIN` con dimensiones, duplicados por versiones o respuestas y errores de madurez o ventana.
- Comprueba que cada numerador sea subconjunto de su denominador (M2 ≤ M1, M4 ≤ M3, M6 ≤ M5, M8 ≤ M7, M10 ≤ M9).

**Prueba realizada (SQL Server 2022, `sqlcmd`):** se cargó como dato de prueba `simulacion_informe/02_OLTP_Poblamiento_LEADS.sql`, se ejecutó el ETL del Anexo C sin cambios y se verificó con dos fechas de corte distintas:

| Medida | `@Corte` 30/04/2026 · OLTP = mart | `@Corte` 15/02/2026 · OLTP = mart |
|---|---|---|
| M1 · M2 | 180 · 144 ✔ | 180 · 144 ✔ |
| M3 · M4 | 150 · 120 ✔ | 150 · 120 ✔ |
| M5 · M6 | 135 · 54 ✔ | 53 · 21 ✔ |
| M7 · M8 | 200 · 36 ✔ | 0 · 0 ✔ |
| M9 · M10 | 50 · 20 ✔ | 18 · 8 ✔ |

Las 10 medidas coinciden en ambos cortes y se cumplen las 5 reglas de subconjunto. El ETL del Anexo C carga el data mart de forma consistente con el OLTP. Después de la prueba se restauraron las bases al estado limpio que espera `db:init`.

**Auditoría R4.1 (dato de prueba, no es un defecto):** con ese poblamiento, la consulta de citas solapadas devuelve 1 caso (asesor 2, citas 6 y 11, 22/01/2026 10:00–10:45, en estado REALIZADA y NO_ASISTIO). La auditoría funciona como se espera: detecta lo que hay en los datos. En la app, la tool `agendar_cita` impide crear solapamientos nuevos.

## 9. Rendimiento del ETL: `OPTION (FORCE ORDER)` en los tres hechos (cambio en `04_ETL.sql`)

**Problema detectado al ejecutar:** con apenas 229 oportunidades, el ETL del Anexo C tardaba entre 8 y 35 s y el tiempo variaba entre ejecuciones. Al medir por sentencia se vio que las dimensiones tardan milisegundos y los hechos B.1–B.3 segundos. El plan real de B.3 mostró un `Table Spool` ejecutado 52 288 veces, que generaba 12,9 millones de filas: el optimizador combinaba las dimensiones entre sí **antes** de unir `PERFIL_ACADEMICO`. La causa es que las condiciones `de.idContacto = ISNULL(pf.contacto_id, 0)` dependen de un `LEFT JOIN`, y con ellas el optimizador estima mal cuántas filas habrá. Agregar índices o `OPTION (RECOMPILE)` lo empeoraba.

**Corrección:** se agregó `OPTION (FORCE ORDER)` al final de los tres `INSERT … SELECT` de hechos. El `FROM` del Anexo C ya estaba escrito en el orden correcto (primero las tablas del OLTP, después las dimensiones), y la sugerencia solo obliga al optimizador a respetarlo. **No cambia qué filas se cargan ni sus sumas**: la verificación OLTP ↔ data mart da los mismos valores.

| Medición (mismos datos) | Antes | Después |
|---|---|---|
| B.1 · B.2 · B.3 (sqlcmd) | 1,5 s · 0,03–26 s · 7,7 s | 0,02 s · 0,03–0,07 s · 0,01–0,03 s |
| ETL completo desde la app | 9–35 s | 0,2–1,5 s |

Se recomienda incorporar el cambio al Anexo C del informe.

## 10. Generador de datos sintéticos (`npm run seed`)

- **Determinista:** semilla fija (`20260511`) y ventana de fechas fija (01/05/2026 – 10/11/2026), así que todas las ejecuciones producen los mismos datos. Se comprobó regenerando todo: las 10 medidas fueron idénticas.
- **Volumen:** 260 contactos/BUYERS, 212 LEADS y 229 oportunidades (algunos leads descartados reabren un segundo ciclo meses después).
- **Coherencia:** cada oportunidad se crea `ABIERTA` y avanza con `UPDATE` por cada transición, así que el trigger de transiciones valida también los datos sintéticos. Las fechas son siempre consecutivas, y precios, topes y mínimos se calculan con el mismo motor que usará el agente (`src/negocio/precios.ts`).
- **Variedad sin forzar cifras:** probabilidades distintas por canal, asesor, servicio y grupo de objeción (constantes en `src/seed/generar.ts`, documentadas como supuestos de simulación). No se fija ningún valor de indicador.
- **Marcado:** `es_demo = 1` en `CONTACTO` y `OPORTUNIDAD_COMERCIAL`. `npm run seed:reset` borra solo esos datos, conserva los creados en la demo en vivo y vacía el data mart, que el siguiente ETL reconstruye. Así no quedan miembros huérfanos en `Dim_Estudiante`, ya que el `MERGE` del Anexo C solo inserta.
- Datos 100 % ficticios: combinaciones aleatorias de nombres, teléfonos `519XXXXXXXX` inventados y correos `@correo.demo`.

## 11. ETL desde la app y la CLI

- La app ejecuta **el mismo archivo** `db/etl/04_ETL.sql` (fuente única). Solo le quita el `USE` y los `DECLARE` de `@Corte/@WD/@WQ/@WA/@WC`, y los pasa como parámetros reales (`sp_executesql`). Si el archivo deja de declarar alguno, la app se niega a ejecutarlo.
- Todo el lote corre en **una transacción**: si algo falla se revierte completo y el tablero nunca ve los hechos a medio cargar. Cada ejecución queda registrada en `ETL_EJECUCION` (parámetros, duración, filas por tabla, oportunidades sintéticas y reales).
- El script usa **un solo plazo `@WA`** para la aceptación y la recuperación de objeciones. El prompt enumeraba cinco plazos («48 h, 2 h, 30 d, 30 d, 60 d»), pero se respetan los cuatro parámetros del Anexo C.
- `npm run etl:verify` ejecuta `06_verificacion_oltp_mart.sql` con los parámetros de la **última carga correcta**.
- `npm run db:informe` recrea las bases con los datos de prueba del informe. `db:init` detecta ese escenario (por la universidad «Universidad Nacional Demo 1») y no le aplica los catálogos de la app. El catálogo de objeciones y las transiciones se cargan en `02_ampliacion_app.sql`, porque deben existir en cualquier escenario.

## 12. Pruebas automáticas (`npm test`)

15 pruebas con `node:test`:
- **Unitarias:** motor de precios (fórmula, tope, mínimo, recargos) e indicadores (cociente de sumas frente a promedio de porcentajes, «Sin datos», umbrales del semáforo, nombres sin códigos internos).
- **Integración con SQL Server:** ETL más verificación OLTP ↔ data mart, idempotencia del ETL, rechazo de transiciones no permitidas, `CK_PROPUESTA_TOPE` y `CK_PROPUESTA_MINIMO`, y unicidad de `idempotency_key`.

Las pruebas de integración usan transacciones revertidas, se omiten con aviso si no hay conexión y al terminar restauran el data mart con los parámetros de la carga anterior.

## 13. Pantallas operativas de LEADS (E4)

- **Lógica de negocio en un solo lugar** (`src/negocio/`): transiciones de estado, diagnóstico y aptitud, cotización versionada y agenda. La usan las pantallas y la usarán las tools del agente (E5), así que un asesor y el agente aplican exactamente las mismas reglas. Cada escritura va en una transacción con `UPDLOCK` sobre la oportunidad, para evitar carreras entre el agente y un asesor.
- **Bloqueo en el cotizador:** los descuentos automáticos de `REGLA_PRECIO` se acotan al tope con un aviso. La propuesta queda **bloqueada** (no se puede presentar; el servidor responde 422) solo cuando el **ajuste negociado** a mano exige más de lo permitido. Así nunca se recorta en silencio lo que pidió una persona.
- **Versionado:** presentar una versión deja la anterior `PRESENTADA` como `REEMPLAZADA` y, si la oportunidad estaba `APTA_PARA_COTIZAR`, la pasa a `EN_NEGOCIACION`.
- **Agenda:** el servidor rechaza un solapamiento por asesor (409) antes de insertar, con bloqueo de rango. Las citas canceladas no cuentan. Los cambios de estado siguen el ciclo SOLICITADA → CONFIRMADA → REALIZADA / NO_ASISTIO / CANCELADA.
- **Menú:** además de lo que pedía la guía visual se agregaron «Diagnósticos», «Objeciones y escalamientos» y «Consentimiento», que son pantallas obligatorias del prompt (4, 6 y 8).
- **Tiempo real:** una sola conexión SSE por pestaña. Al principio cada componente abría la suya y, con varias pestañas o navegaciones, se agotaba el límite de ~6 conexiones del navegador y las páginas quedaban esperando. Cuando hay un evento «oltp», se refrescan las pantallas operativas; el tablero no, porque lee del data mart y solo cambia con el ETL.

## 14. Agente Negociador (E5)

- **Un solo motor, varios proveedores.** `src/agente/motor.ts` decide si el agente responde (control humano, consentimiento revocado, duplicados), arma el contexto desde el OLTP y llama al proveedor. Claude, OpenAI, Gemini y `mock` reciben las mismas herramientas; `mock` interpreta con reglas pero ejecuta las herramientas igual, así que la auditoría y las validaciones son idénticas.
- **Las herramientas no reciben ids.** Siempre actúan sobre la oportunidad de la conversación en curso: el modelo no puede tocar datos de otra persona aunque se lo pidan.
- **El precio nunca lo escribe el modelo.** La salida se revisa: cualquier monto «S/» que no haya salido de una herramienta en ese turno (o de la propuesta vigente) reemplaza la respuesta por un mensaje seguro y queda anotado en el turno.
- **Consentimiento primero (Ley 29733).** Sin consentimiento solo se permiten pedirlo, consultar la situación o derivar; el servidor rechaza las demás herramientas.
- **Diagnóstico y aptitud siguen siendo humanos.** El agente solicita el diagnóstico; un especialista lo entrega y califica la aptitud en «Diagnósticos». Así la medición de plazos (48 h y 2 h) es real.
- **Derivar detiene al agente.** Un escalamiento pasa la conversación a `DERIVADA` con `control_humano = 1`; el asesor la devuelve desde Conversaciones.
- **Alta de estudiantes desde el chat.** Un número nuevo crea CONTACTO → BUYER → LEAD → OPORTUNIDAD (`ABIERTA`). En el simulador se marcan `es_demo = 1` y `seed:reset` los borra.
- **Claude:** SDK oficial, `claude-opus-5-5` por defecto, esfuerzo `medium` configurable (`LLM_EFFORT`), bloque de reglas cacheado y respaldo de servidor ante una negativa por política (`fallbacks: "default"`).
- **zod 3.24 → 3.25** porque el SDK de Anthropic lo pide como dependencia opcional (misma versión mayor, sin cambios en el código).

## 15. WhatsApp con OpenWA (E6)

- **OpenWA va como proceso aparte** (`vendor/OpenWA`, compilado en `npm run setup`, arrancado por `npm start`). La app solo usa su API HTTP: sesión, QR, envío de texto y webhooks.
- **Webhook a `localhost`.** OpenWA bloquea por defecto los webhooks a direcciones internas (protección SSRF). `setup` agrega `SSRF_ALLOWED_HOSTS=localhost` a `vendor/OpenWA/.env`: la excepción es solo para `localhost` y la protección sigue activa para el resto.
- **Firma.** La app recrea el webhook al arrancar con el secreto de `.env` (OpenWA no permite leer el secreto guardado) y verifica `X-OpenWA-Signature` con comparación de tiempo constante sobre el cuerpo crudo.
- **Quién puede hablar con el agente.** Solo números de `WHATSAPP_ALLOWLIST` (lista vacía = nadie). La primera conversación de un número empieza solo con la frase de activación. Con `RESOLVE_LID_TO_PHONE=true` OpenWA agrega el número real cuando WhatsApp oculta el remitente tras un id de privacidad.
- **Respuesta rápida al webhook.** La app responde 200 de inmediato y procesa el turno en segundo plano (OpenWA espera como máximo 10 s y la IA puede tardar más).
- **Sin ciclos con la UI.** El estado de WhatsApp se publica por SSE solo cuando cambia, y la sincronización con OpenWA se hace como máximo cada 10 s (un primer diseño provocaba un ciclo evento → consulta → evento y OpenWA respondía 429).
