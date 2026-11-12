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
| E3 · Tablero BI | ✅ (falta «Explicar con IA», va con el agente en E5) |
| E4 · Ficha nominal, pipeline, diagnósticos, cotizador, objeciones, agenda, consentimiento, auditoría | ✅ |
| E5 · Agente Negociador | pendiente |
| E6 · WhatsApp real con OpenWA | pendiente |
| E7 · Stubs de otras fases, simulador de PAYERS, Plataforma | pendiente |
| E8 · Pulido de demo | pendiente |

## Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| «No se pudo abrir una conexión TCP con SQL Server» | TCP/IP deshabilitado o servicio detenido | Ver «Habilitar TCP/IP». |
| «SQL Server rechazó el inicio de sesión de DB_ADMIN_USER» | Clave de `sa` incorrecta o modo mixto desactivado | Revisa `DB_ADMIN_PASSWORD` y la autenticación mixta. |
| «… rechazó el inicio de sesión de DB_USER» | El usuario de la app no existe todavía | `npm run db:init`. |
| Tildes o emojis se ven como `?` | Script abierto o guardado sin UTF-8 | Los `.sql` están en UTF-8 con BOM; `db:init` los lee así. |

## Pendiente / Limitaciones

- Verificado en Windows 11 con SQL Server 2022 Developer y Node 22.16. **Linux y macOS no se han probado todavía**: los scripts son Node puro, pero falta ejecutarlos allí.
- Aún no hay inicio de sesión con roles (admin, asesor, viewer): pendiente para la E8.
- El tablero solo ve lo que cargó el último ETL. Las oportunidades nuevas de la demo aparecen al pulsar «Ejecutar ETL».
- OpenWA usa WhatsApp Web, una **API no oficial**: el número puede quedar restringido. Usa un número dedicado para la demo. El plan B es el Simulador de WhatsApp de la app.
- Los precios, topes, plazos y umbrales son **valores de prueba** pendientes de validación por la gestión del negocio (como indica el informe).
