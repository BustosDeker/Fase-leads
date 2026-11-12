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
