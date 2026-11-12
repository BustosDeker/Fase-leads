# MEMORIA DESCRIPTIVA

**INBESTIGA · Fase 2 LEADS (metodología IMPULSE)**
Aplicación web con Agente de IA para la negociación de asesoría de tesis por WhatsApp, con tablero de inteligencia de negocios

Curso: Inteligencia de Negocios · Ingeniería de Sistemas · UNT

---

## TÍTULO DEL SOFTWARE

Aplicación web con Agente de IA para la negociación de asesoría de tesis por WhatsApp y tablero BI de la fase LEADS (INBESTIGA · metodología IMPULSE).

---

## 1. Problema que resuelve

INBESTIGA ofrece asesoría de tesis a estudiantes universitarios. Antes de contratar, cada interesado (lead) debe pasar por una negociación: recibir un diagnóstico de su tesis, una cotización, resolver sus dudas y aceptar una propuesta. Cuando este proceso depende solo de personas, aparecen problemas como:

- **Demoras en la atención.** El diagnóstico y la primera cotización deben entregarse en plazos concretos (48 h y 2 h por defecto) y no hay una forma sencilla de saber qué casos están por vencer o ya vencieron.
- **Negociación inconsistente.** Los precios, descuentos y condiciones los fija cada persona, con el riesgo de ofrecer montos por debajo del mínimo o descuentos sobre el tope permitido.
- **Información dispersa.** Los datos del estudiante, sus conversaciones, propuestas y objeciones quedan repartidos en chats y notas, sin un historial único ni trazabilidad.
- **Falta de indicadores.** La gestión no puede medir cuántos leads reciben su diagnóstico a tiempo, cuántas propuestas se aceptan, cuántas objeciones se recuperan ni cuántos llegan a la fase de pago, para decidir qué mejorar.
- **Riesgos de privacidad.** Escribir a una persona sin su consentimiento incumple la Ley 29733 (Protección de Datos Personales).

La aplicación resuelve esto con un **Agente Negociador de IA** que atiende por WhatsApp aplicando reglas de negocio fijas (consentimiento primero, precios calculados por el sistema, derivación a una persona cuando corresponde), registra cada acción en una base transaccional y alimenta un **tablero BI** con cinco indicadores de gestión.

---

## 2. Funcionalidad (para qué sirve)

La aplicación actúa como el puente entre el interesado captado (fase BUYERS) y la contratación (fase PAYERS). Permite:

- **Atender por WhatsApp o por un simulador** a cada lead con un agente de IA que pide el consentimiento, registra su perfil académico y sus preferencias, solicita el diagnóstico, presenta propuestas, responde objeciones, agenda citas y registra la aceptación.
- **Mantener la ficha nominal de cada estudiante**, con su línea de tiempo, propuestas versionadas, objeciones, citas y consentimientos.
- **Dar control a los asesores:** pueden tomar el control de una conversación, entregar diagnósticos, calificar la aptitud, cotizar con reglas de precio y atender los casos derivados por el agente.
- **Medir la gestión:** un proceso ETL carga un data mart con 3 tablas de hechos y 8 dimensiones, y el tablero BI muestra cinco indicadores con semáforo, embudo, tendencia, reporte por dimensión con detalle por niveles y acciones sugeridas.
- **Auditar:** cada turno del agente queda registrado (herramientas usadas, tiempos, alertas de manipulación) y la pantalla de Auditoría detecta citas solapadas, descuentos fuera de tope y casos sin atender.
- **Integrar las fases vecinas:** recibe leads de BUYERS, entrega los acuerdos aceptados a PAYERS y recibe su confirmación.

Como elemento distintivo, el agente **no puede inventar precios ni actuar fuera de sus reglas**: usa herramientas controladas por el servidor, solo opera sobre la oportunidad de la conversación en curso y toda cifra monetaria de su respuesta debe provenir del cotizador.

### Módulos de la aplicación

| Módulo | Contenido |
|---|---|
| A) Ingreso | Inicio de sesión con usuario y clave, y tres roles: Administrador, Asesor y Solo consulta. |
| B) Tablero BI | Tablero de gestión de LEADS, Ejecutar ETL con sus parámetros de medición y «Explicar este tablero». |
| C) Operación de LEADS | Ficha nominal, Conversaciones (con conexión de WhatsApp, simulador y control humano), Pipeline, Diagnósticos, Cotizador, Objeciones y escalamientos, Agenda, Consentimiento y Auditoría. |
| D) Integración | BUYERS, PAYERS, CUSTOMERS y TURNED (informativas) y Agente Plataforma. |
| Apoyo | Evidencias (validación de que el data mart coincide con la base transaccional, permisos y pruebas) y Guion de demo. |

---

## 3. Arquitectura del software

### 3.1 Diagrama de arquitectura

```
                    ┌──────────────────────────────┐
   Estudiante  ───▶ │  WhatsApp (teléfono vinculado)│
                    └──────────────┬───────────────┘
                                   │ WhatsApp Web (API no oficial)
                                   ▼
                    ┌──────────────────────────────┐
                    │  OpenWA (proceso aparte,      │
                    │  puerto 2785)                 │
                    └──────────────┬───────────────┘
                                   │ webhook firmado ▲ envío de texto (HTTP)
                                   ▼                 │
┌─────────────┐  HTTP/SSE  ┌─────────────────────────────────────────────┐
│  Navegador  │◀──────────▶│  Servidor de la aplicación (Node.js, Fastify,│
│ React (SPA) │            │  puerto 3100)                                │
│ Tablero BI, │            │  · Autenticación por sesión y roles          │
│ pantallas   │            │  · Rutas API (leads, tablero, agente, ETL…)  │
└─────────────┘            │  · Lógica de negocio (estados, precios,      │
                           │    diagnóstico, agenda, propuestas)          │
┌─────────────┐  Bearer    │  · Agente Negociador (motor + herramientas   │
│ BUYERS /    │───────────▶│    + guardas) ──▶ proveedor de IA:           │
│ PAYERS      │◀───────────│    Claude · OpenAI · Gemini · mock           │
└─────────────┘            │  · ETL (ejecuta db/etl/04_ETL.sql)           │
                           └───────────────┬─────────────────────────────┘
                                           │ TCP 1433 (driver mssql)
                                           ▼
                           ┌─────────────────────────────────────────────┐
                           │  SQL Server                                  │
                           │  INBESTIGA_TESIS (OLTP, 69 tablas)           │
                           │        │  ETL (una transacción)              │
                           │        ▼                                     │
                           │  INBESTIGA_MART (data mart, 12 tablas:       │
                           │  3 hechos + 8 dimensiones + bitácora ETL)    │
                           └─────────────────────────────────────────────┘
```

Flujo principal: el estudiante escribe por WhatsApp → OpenWA avisa al servidor mediante un webhook firmado → el motor del agente verifica reglas (consentimiento, control humano, duplicados), arma el contexto desde el OLTP y consulta al proveedor de IA → las herramientas escriben en el OLTP → la respuesta vuelve por OpenWA al estudiante. El tablero BI no lee el OLTP: lee el data mart, que solo cambia al ejecutar el ETL.

### 3.2 Lenguajes de programación

- **TypeScript:** lenguaje del servidor (lógica de negocio, agente, ETL, generador de datos) y del frontend.
- **JavaScript (ESM):** scripts de instalación y arranque (`setup`, `start`, `db-init`).
- **SQL (T-SQL):** definición de las bases, ETL, catálogos, reportes de conciliación y verificación.

### 3.3 Base de datos

- **SQL Server 2019/2022 (Express o Developer)**, con autenticación mixta y TCP/IP habilitado.
- **INBESTIGA_TESIS (OLTP):** 59 tablas del modelo del informe + 5 del Anexo A + 5 de ampliación de la aplicación = 69 tablas. Valida los cambios de estado de las oportunidades con un trigger y reglas `CHECK` (tope de descuento, precio mínimo, ventana de mensajes).
- **INBESTIGA_MART (data mart):** 3 tablas de hechos (diagnóstico, oportunidad y recuperación de objeciones), 8 dimensiones y la bitácora `ETL_EJECUCION`.
- **Seguridad:** la aplicación usa un usuario propio con permisos de lectura, escritura y ejecución; la cuenta de administración solo se usa al crear las bases.

### 3.4 Backend

- **Node.js 22 y Fastify 5:** servidor HTTP que expone la API y sirve el frontend compilado.
- **Módulos principales:**
  - `server/`: rutas por área (leads, tablero, agente, WhatsApp, integraciones, evidencias), autenticación por cookie firmada (HMAC-SHA256, 12 horas) con autorización por rol, y eventos en tiempo real (SSE).
  - `negocio/`: reglas compartidas por las pantallas y por el agente (transiciones de estado, diagnóstico, cotización versionada, agenda, motor de precios).
  - `agente/`: motor del Agente Negociador, prompt, herramientas, guardas de seguridad y proveedores (Claude mediante el SDK oficial, OpenAI, Gemini y modo `mock` por reglas).
  - `whatsapp/`: cliente de la API HTTP de OpenWA.
  - `etl/` y `kpi/`: ejecución del ETL, verificación OLTP ↔ data mart y consultas del tablero.
  - `integraciones/`: contratos con BUYERS y PAYERS, protegidos con token.
  - `seed/`: generador determinista de datos de prueba.
- **mssql** (acceso a SQL Server) y **zod** (validación de datos de entrada).

### 3.5 Frontend

- **React 18** con **Vite** (compilación), **React Router** (navegación), **TanStack Query** (consultas y actualización en vivo) y **Tailwind CSS** (estilos).
- **Recharts** para las gráficas del tablero.
- Interfaz en español, con menú lateral del embudo IMPULSE, adaptable a celular.

### 3.6 Servicios externos

- **OpenWA:** puerta de enlace de WhatsApp (se instala y arranca junto con la aplicación). Usa WhatsApp Web, una API no oficial.
- **Proveedor de IA (opcional):** Claude (Anthropic), OpenAI o Gemini. Sin clave, la aplicación funciona en modo `mock` (reglas).

### 3.7 Requisitos de ejecución

Windows (verificado en Windows 11), Node.js 22 LTS, Git y SQL Server. Instalación con `npm run setup` y arranque con `npm start`.

---

## PENDIENTE DE VERIFICAR

- Funcionamiento con IA real (Claude, OpenAI, Gemini): solo el modo `mock` está verificado de punta a punta, según el README.
- Prueba de WhatsApp real con un teléfono vinculado.
- Ejecución en Linux y macOS (solo verificado en Windows).
- Validación de precios, topes, plazos y umbrales por la gestión del negocio.
- Datos del equipo (integrantes): los completa el equipo.
