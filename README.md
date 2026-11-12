# INBESTIGA · Fase 2 LEADS (metodología IMPULSE)

Aplicación web de la fase **LEADS** de INBESTIGA (asesoría de tesis con Agente IA): el **Agente Negociador** atiende por WhatsApp (OpenWA) o por un simulador, registra cada acción en el **OLTP** de SQL Server, un **ETL** carga el **data mart** (3 hechos, 8 dimensiones) y el **tablero BI** muestra los indicadores.

> Curso Inteligencia de Negocios · Ing. de Sistemas · UNT. Docente: Dr. Mendoza Rivera Ricardo Darío.
> Autores: Bustos Vega, Ronaldo · Paz Romero, Álvaro Joseph.

## Instalación en 3 pasos (sin Docker)

```bash
git clone <url-del-repo> inbestiga-leads && cd inbestiga-leads
npm run setup      # crea .env, instala dependencias, instala OpenWA, compila el frontend y crea las bases
npm start          # levanta la app + OpenWA y abre el navegador
```

La primera vez, `setup` crea el `.env` y te pide **un único dato**: `DB_ADMIN_PASSWORD` (la clave de `sa`). Complétalo y vuelve a ejecutar `npm run setup`. Los demás secretos se generan automáticamente.

### Requisitos previos

| Requisito | Versión | Notas |
|---|---|---|
| Node.js | 22 LTS (≥ 22.13 para OpenWA) | https://nodejs.org |
| Git | cualquiera | para clonar OpenWA |
| SQL Server | 2019/2022 **Express o Developer**, instalación nativa | Windows, o Linux con el paquete `mssql-server` |

**SQL Server debe tener autenticación mixta y TCP/IP habilitado** (el driver de Node se conecta por TCP).

#### Habilitar TCP/IP en Windows

Opción gráfica: *SQL Server Configuration Manager* → *Configuración de red de SQL Server* → *Protocolos de MSSQLSERVER* → **TCP/IP: Habilitado**. En *Propiedades → Direcciones IP → IPAll*, deja *Puertos dinámicos TCP* vacío y pon *Puerto TCP* = `1433`. Después reinicia el servicio.

Opción por consola (PowerShell **como administrador**, instancia por defecto de SQL Server 2022 = `MSSQL16`):

```powershell
$base = 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\MSSQL16.MSSQLSERVER\MSSQLServer\SuperSocketNetLib\Tcp'
Set-ItemProperty $base -Name Enabled -Value 1
Set-ItemProperty "$base\IPAll" -Name TcpPort -Value '1433'
Set-ItemProperty "$base\IPAll" -Name TcpDynamicPorts -Value ''
Restart-Service MSSQLSERVER -Force
```

(En SQL Server 2019 la carpeta es `MSSQL15.MSSQLSERVER`; en Express, `MSSQL16.SQLEXPRESS`.)

#### Autenticación mixta

SSMS → clic derecho en el servidor → *Propiedades → Seguridad* → **Modo de autenticación de SQL Server y Windows**. Habilita el login `sa` con una clave y reinicia el servicio.

#### Linux (Ubuntu)

Instala `mssql-server` según la guía oficial de Microsoft y ejecuta `sudo /opt/mssql/bin/mssql-conf setup`. TCP 1433 y el modo mixto vienen activos por defecto.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run setup` | Verifica Node, crea `.env`, instala dependencias y OpenWA, compila el frontend, ejecuta `db:init`, genera los datos de prueba y hace la primera carga del data mart. |
| `npm start` | Levanta la app (puerto `PORT`, 3100 por defecto) y OpenWA (2785), y abre el navegador. |
| `npm run db:init` | Crea `INBESTIGA_TESIS` e `INBESTIGA_MART` si no existen, aplica la ampliación de la app, carga los catálogos y crea el usuario `inbestiga_app`. Es idempotente. |
| `npm run db:reset` | **Borra y recrea** ambas bases (vacías, con catálogos). |
| `npm run db:informe` | **Borra y recrea** ambas bases con los datos de prueba del informe (luego: `npm run etl -- --corte=2026-04-30T23:59:59`). |
| `npm run seed` | Genera los datos sintéticos deterministas (si aún no existen). |
| `npm run seed:reset` | Borra solo los datos sintéticos (`es_demo = 1`), vacía el data mart y los vuelve a generar. |
| `npm run etl` | Carga el data mart (dimensiones con `MERGE`, hechos con limpieza total). Opciones: `-- --corte=AAAA-MM-DDTHH:MM:SS --wd=48 --wq=2 --wa=30 --wc=60`. |
| `npm run etl:verify` | Verificación interna: recalcula M1–M10 desde el OLTP y los compara con el data mart (no es pantalla de la app). |
| `npm test` | Pruebas automáticas (unitarias y de integración con SQL Server). |

## Agente Negociador IA

El proveedor se configura únicamente en `.env`. Si se selecciona `gemini`, el valor recomendado es `LLM_MODEL=gemini-2.5-flash`; si se selecciona `anthropic`, el valor recomendado es `LLM_MODEL=claude-haiku-5-5`. Si falta la clave, el sistema avisa y usa `mock` para no bloquear la aplicación.

### Gemini con cuota gratuita

1. Crea una clave en [Google AI Studio](https://aistudio.google.com/apikey).
2. Copia `.env.example` a `.env` y configura:

   ```env
   LLM_PROVIDER=gemini
   LLM_MODEL=gemini-2.5-flash
   GEMINI_API_KEY=tu_clave_de_gemini
   ```

3. Ejecuta `npm run agente:probar`.

La cuota gratuita de Gemini puede usar los prompts y respuestas para mejorar productos de Google. En pruebas gratuitas usa únicamente nombres, temas y conversaciones ficticias; no envíes datos personales ni tesis reales. La tarifa pagada y el tratamiento de datos dependen de la modalidad y pueden cambiar.

### Claude Haiku 5.5

1. Crea una clave en [Claude Console](https://console.anthropic.com/settings/keys).
2. Configura `.env`:

   ```env
   LLM_PROVIDER=anthropic
   LLM_MODEL=claude-haiku-5-5
   LLM_EFFORT=medium
   LLM_ANTHROPIC_FALLBACK=false
   ANTHROPIC_API_KEY=tu_clave_de_anthropic
   ```

3. Ejecuta `npm run agente:probar`.

El fallback beta de Anthropic está desactivado por defecto porque depende de soporte vigente de la API. Los precios son orientativos: Haiku 5.5 parte aproximadamente de US$0.10 por millón de tokens de entrada y US$0.50 por millón de salida; revisa la documentación de Anthropic antes de usarlo en producción.

### Probar con Groq

1. Crea una clave en la [consola oficial de Groq](https://console.groq.com/keys).
2. Copia `.env.example` a `.env` y pega la clave en `GROQ_API_KEY`.
3. Deja `LLM_PROVIDER=groq`; con `LLM_MODEL=` se usa `openai/gpt-oss-20b`, que Groq documenta con soporte de herramientas. `llama-3.3-70b-versatile` fue retirado por Groq el 16/08/2026.
4. Ejecuta `npm run agente:probar` y prueba una conversación desde el simulador.

La API compatible usa `https://api.groq.com/openai/v1`. La capa gratuita tiene límites por organización y modelo (RPM, RPD, TPM y TPD); Groq indica que los valores exactos de cada organización se consultan en la consola y que pueden variar. Si se exceden, la API responde 429. La documentación pública muestra una tabla base del plan Developer, no una cifra universal de Free, por lo que el proyecto no fija números obsoletos. Groq indica que las inferencias no se retienen por defecto, pero puede conservar entradas/salidas hasta 30 días para fiabilidad o abuso; ZDR se puede activar en Data Controls y Customer Data no se usa para entrenar salvo permiso explícito. En pruebas usa únicamente datos ficticios; consulta [Your Data](https://console.groq.com/docs/your-data), los [términos de Groq](https://groq.com/terms-of-use) y su [política de privacidad](https://groq.com/privacy-policy) antes de enviar información real.

### Catálogo y citas del agente

El agente consulta `consultar_catalogo` antes de hablar de servicios o precios y `detalle_servicio` para entregar incluidos, límites y extras. Los extras seleccionados se validan contra la base antes de simular o presentar una propuesta; no se muestran al agente el precio mínimo ni el tope interno.

Las citas son opcionales y pueden cancelarse o reprogramarse. Configura, solo si tienes una sala fija real, `CITA_ENLACE_GOOGLE_MEET` o `CITA_ENLACE_ZOOM` en `.env`. El enlace se guarda y se comunica únicamente cuando está configurado; de lo contrario se informa que el asesor lo enviará antes de la reunión. Nunca se genera una URL ficticia.

### Probar el seguimiento en local

Configura `AGENTE_API_TOKEN` y, únicamente para pruebas locales, `AGENTE_PERMITIR_TIEMPO_SIMULADO=true`. Las plantillas sembradas tienen `aprobada_meta=0`; para probar un envío fuera de la ventana de WhatsApp debes aprobarlas con Meta o marcarlas manualmente en una base de pruebas.

PowerShell:

```powershell
$h = @{ Authorization = "Bearer $env:AGENTE_API_TOKEN" }
$ahora = "2026-11-12T15:00:00-05:00"
Invoke-RestMethod -Uri "http://localhost:3100/api/agente/seguimiento/candidatos?ahora=$ahora" -Headers $h
Invoke-RestMethod -Method Post -Uri http://localhost:3100/api/agente/seguimiento/ejecutar -Headers $h -ContentType 'application/json' -Body (@{ dryRun = $true; ahora = $ahora } | ConvertTo-Json)
Invoke-RestMethod -Method Post -Uri http://localhost:3100/api/agente/seguimiento/ejecutar -Headers $h -ContentType 'application/json' -Body (@{ ahora = $ahora } | ConvertTo-Json)
```

curl:

```bash
export AGENTE_API_TOKEN='tu_token_local'
curl -H "Authorization: Bearer $AGENTE_API_TOKEN" 'http://localhost:3100/api/agente/seguimiento/candidatos?ahora=2026-11-12T15%3A00%3A00-05%3A00'
curl -X POST -H "Authorization: Bearer $AGENTE_API_TOKEN" -H 'Content-Type: application/json' -d '{"dryRun":true,"ahora":"2026-11-12T15:00:00-05:00"}' http://localhost:3100/api/agente/seguimiento/ejecutar
curl -X POST -H "Authorization: Bearer $AGENTE_API_TOKEN" -H 'Content-Type: application/json' -d '{"ahora":"2026-11-12T15:00:00-05:00"}' http://localhost:3100/api/agente/seguimiento/ejecutar
```

Si no hay respuesta después de los intentos, el comportamiento seguro es derivar con `RIESGO_ABANDONO`; `SEGUIMIENTO_DESCARTAR_AUTOMATICO=true` permite cerrar la oportunidad como `DESCARTADA`.

### Guía rápida del agente

1. Copia `.env.example` a `.env` y configura `DB_*`, `AGENTE_API_TOKEN` y un proveedor (`mock` para validar la lógica local o una clave real para IA).
2. Ejecuta `npm run agente:probar` para un smoke test de tres mensajes.
3. Ejecuta `LLM_PROVIDER=mock npm run agente:evaluar` (PowerShell: `$env:LLM_PROVIDER='mock'; npm run agente:evaluar`) para validar los escenarios deterministas sin consumir cuota. Con IA real se intentan los doce casos.
4. Para seguimiento local activa `AGENTE_PERMITIR_TIEMPO_SIMULADO=true` y usa los comandos de la sección de seguimiento; n8n es opcional y se importa desde `n8n/workflows/`.

### n8n opcional en local

n8n solo orquesta tareas alrededor del agente y no es necesario para ejecutar la aplicación. Para usar los workflows locales, ejecuta `npm run n8n` (equivalente a `npx n8n`), abre `http://localhost:5678` e importa los archivos de [`n8n/workflows/`](./n8n/workflows/). En cada workflow edita el nodo `Config` si el backend no está en `http://127.0.0.1:3100` y selecciona la credencial n8n Header Auth `INBESTIGA agente`; no se usan `$env` ni tokens dentro del JSON. El workflow de derivaciones conserva el último `escalamiento_id` en Static Data y consulta `/api/agente/derivaciones/pendientes?desde_id=...`. Los pasos exactos y las comprobaciones con `curl` están en [`n8n/README.md`](./n8n/README.md).

Deja `SEGUIMIENTO_INTERNO=false` cuando n8n sea el scheduler. Si no quieres instalar n8n, puedes activar `SEGUIMIENTO_INTERNO=true` y `SEGUIMIENTO_CADA_MIN=15` para que el backend ejecute el seguimiento localmente. Los avisos de correo se importan desactivados y no contienen credenciales.

### Pruebas y uso

`npm run agente:probar` crea una conversación simulada ficticia, envía tres mensajes, muestra respuestas, herramientas, latencia y tokens, y termina con código distinto de cero si falla el proveedor o la conexión local. `npm run agente:evaluar` ejecuta doce escenarios guionados con fixtures ficticias y las limpia por IDs al terminar. En mock omite con aviso los casos que dependen de interpretación lingüística; con Groq usa preferentemente 2–3 casos de muestra porque doce conversaciones pueden agotar el TPM gratuito. `npm run n8n` inicia el orquestador opcional mediante `npx n8n`.

El agente puede entregar un diagnóstico completo con `entregar_diagnostico` y verificar la aptitud con `calificar_aptitud`; esta última herramienta registra el inicio del plazo de cotización. Se deriva a una persona si el diagnóstico requiere revisión, no existe tarifa vigente o la consulta académica es compleja.

El agente agrupa mensajes consecutivos durante `AGENTE_DEBOUNCE_MS` milisegundos (4000 por defecto; `0` lo desactiva), conserva un resumen efímero en memoria cada `AGENTE_RESUMEN_CADA` mensajes (20 por defecto) y limita a `AGENTE_MAX_TURNOS_HORA` turnos automáticos por hora (30 por defecto). Los audios, stickers, imágenes y documentos reciben una respuesta de cortesía sin llamar al modelo; `TRANSCRIPCION_AUDIO=true` permite transcribir audios que incluyan datos multimedia y exista `GEMINI_API_KEY`, sin guardar el binario.

## Estructura

```
db/oltp/      01_OLTP_ER.sql (DDL v2 + Anexo A) · 02_ampliacion_app.sql · 03_catalogos.sql
              simulacion_informe/02_OLTP_Poblamiento_LEADS.sql (escenario del informe)
db/dm/        03_DataMart_DDL.sql (Anexo B) · 03b_ampliacion_app.sql (bitácora del ETL)
db/etl/       04_ETL.sql (Anexo C)
db/reports/   05_Conciliacion_Reportes.sql (Anexo D) · 06_verificacion_oltp_mart.sql (verificación interna)
scripts/      setup.js · start.js · db-init.js · lib/sql-runner.js (ejecuta .sql partiendo por GO)
src/          config.js · db.ts · server/ (Fastify) · etl/ (ejecutar, verificar, CLI) · seed/ (generador determinista)
              negocio/precios.ts (motor de precios) · shared/indicadores.ts (KPI, umbrales, semáforo)
tests/        pruebas node:test (unitarias e integración)
docs/         DECISIONES.md · informe/
vendor/       OpenWA (lo clona setup; no se versiona)
```

## Estado por etapas

| Etapa | Estado |
|---|---|
| E1 · Base: repo, setup, conexión, `db:init` | ✅ (ver «Pendiente / Limitaciones») |
| E2 · Seed + ETL + `etl:verify` | ✅ |
| E3 · Tablero BI (incluye «Explicar este tablero») | ✅ |
| E4 · Ficha nominal, pipeline, diagnósticos, cotizador, objeciones, agenda, consentimiento, auditoría | ✅ |
| E5 · Agente Negociador + simulador de WhatsApp + pantalla Conversaciones | ✅ (modo mock verificado; ver «Pendiente / Limitaciones») |
| E6 · WhatsApp real con OpenWA (QR, webhook firmado, números permitidos, control humano) | ✅ (falta la prueba con un teléfono real: ver «Pendiente / Limitaciones») |
| E7 · Integración BUYERS → LEADS → PAYERS (con token), simuladores, fases CUSTOMERS/TURNED y Agente Plataforma | ✅ |
| E8 · Ingreso con roles, Evidencias, guion `/demo` y README final | ✅ |

## Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| «No se pudo abrir una conexión TCP con SQL Server» | TCP/IP deshabilitado o servicio detenido | Ver «Habilitar TCP/IP». |
| «SQL Server rechazó el inicio de sesión de DB_ADMIN_USER» | Clave de `sa` incorrecta o modo mixto desactivado | Revisa `DB_ADMIN_PASSWORD` y la autenticación mixta. |
| «… rechazó el inicio de sesión de DB_USER» | El usuario de la app no existe todavía | `npm run db:init`. |
| OpenWA responde «Session is already started» | La sesión ya tiene un motor activo aunque su estado guardado parezca detenido | No desvincules el teléfono; la app consulta el estado activo y continúa la conexión. |
| Tildes o emojis se ven como `?` | Script abierto o guardado sin UTF-8 | Los `.sql` están en UTF-8 con BOM; `db:init` los lee así. |

## Pendiente / Limitaciones

- Verificado en Windows 11 con SQL Server 2022 Developer y Node 22.16. **Linux y macOS no se han probado todavía**: los scripts son Node puro, pero falta ejecutarlos allí.
- El agente con IA real (Claude, OpenAI, Gemini) **no se ha probado con una clave en este entorno**: solo el modo `mock` está verificado de punta a punta. Los adaptadores de OpenAI y Gemini usan sus API HTTP documentadas, pero pueden necesitar ajustes.
- En modo `mock` el agente entiende frases típicas (consentimiento, universidad/carrera/etapa, tema y avance, contado/cuotas, descuento con %, cita, aceptación, objeciones del catálogo); fuera de eso responde de forma genérica.
- CUSTOMERS y TURNED son pantallas informativas: sus módulos los construyen otros equipos.
- El tablero solo ve lo que cargó el último ETL. Las oportunidades nuevas de la demo aparecen al pulsar «Ejecutar ETL».
- **WhatsApp real no se probó con un teléfono vinculado** en este entorno: sí se verificó que OpenWA crea la sesión y el QR, que entrega avisos a la app con una firma válida (prueba de webhook de OpenWA) y las reglas de entrada (firma, números permitidos, frase de activación, grupos y duplicados) con avisos firmados simulados. Falta escanear el QR y conversar desde un número real.
- OpenWA usa WhatsApp Web, una **API no oficial**: el número puede quedar restringido. Usa un número dedicado para la demo. El plan B es el Simulador de WhatsApp de la app.
- Los precios, topes, plazos y umbrales son **valores de prueba** pendientes de validación por la gestión del negocio (como indica el informe).
