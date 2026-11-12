# Decisiones de diseño e inconsistencias encontradas

Registro de las decisiones tomadas al implementar la Fase 2 · LEADS. Cada una indica la razón para que el equipo (y el docente) puedan revisarla.

## 1. Fuentes de verdad

| Archivo del equipo | Ubicación en el repo | Uso |
|---|---|---|
| `01_OLTP_ER.sql` (DDL v2, 59 tablas + Anexo A) | `db/oltp/01_OLTP_ER.sql` | Se ejecuta **sin cambios**. |
| `02_OLTP_Poblamiento_LEADS.sql` (simulación del informe) | `db/oltp/simulacion_informe/` | Escenario opcional que reproduce la Tabla 24 (E2: `npm run seed -- --informe`). |
| `03_DataMart_DDL.sql` (Anexo B) | `db/dm/03_DataMart_DDL.sql` | Se ejecuta **sin cambios**. |
| `04_ETL.sql` (Anexo C) | `db/etl/04_ETL.sql` | Fuente del ETL de la app (E2). |
| `05_Conciliacion_Reportes.sql` (Anexo D) | `db/reports/05_Conciliacion_Reportes.sql` | Consultas R1–R4 y conciliación. |
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

## 8. Verificación de los scripts del informe (ejecutados en SQL Server 2022)

El informe (Tabla 24, nota) dice que los scripts de los anexos «no se han ejecutado». Se ejecutaron en este orden sobre una base limpia: `01_OLTP_ER.sql` → `simulacion_informe/02_OLTP_Poblamiento_LEADS.sql` → `03_DataMart_DDL.sql` → `04_ETL.sql` → `05_Conciliacion_Reportes.sql`. Los resultados fueron:

| Control | Esperado (informe) | Obtenido |
|---|---|---|
| Poblamiento: oportunidades, diagnósticos, propuestas, objeciones, transferencias, conversiones | 200, 180, 141, 50, 54, 36 | 200, 180, 141, 50, 54, 36 ✔ |
| Tabla 24 · Hecho_Diagnostico M1·M2 | 180 · 144 | 180 · 144 ✔ |
| Tabla 24 · Hecho_Oportunidad M3…M8 | 150·120·135·54·200·36 | 150·120·135·54·200·36 ✔ |
| Tabla 24 · Hecho_Recuperacion_Objecion M9·M10 | 50 · 20 | 50 · 20 ✔ |
| Tablas 25–27 (K1 por GrupoEtapa, Equipo, TipoUniversidad) | 77,1/81,5/82,2 · 90,0/64,3 · 82,0/77,5 | idénticos ✔ |
| Tablas 29–30 (K2, K3, K5 por TipoCanal y Familia) | 83,3/43,6/22,5 · 77,8/37,5/15,0 · 87,5/35,0 · 90,9/47,3 · 0,0 | idénticos ✔ |
| Tablas 31–32 (K4 por Grupo y Familia) | 28,6/41,7/44,4/40,9 · 34,4/50,0 | idénticos ✔ |
| R4.1 · Citas solapadas | 0 | **1** ✖ |
| R4.2–R4.4 | 0, 0, 0 | 0, 0, 0 ✔ |
| R4.5 · Transferencias sin confirmación | 18 | 18 ✔ |

**Inconsistencia en el poblamiento simulado:** las citas 6 (oportunidad 24, REALIZADA) y 11 (oportunidad 34, NO_ASISTIO) del asesor 2 tienen el mismo horario (22/01/2026, 10:00–10:45). R4.1 excluye solo las canceladas, así que las reporta como solapadas. Hay dos formas de corregirlo: mover una de las dos citas en `02_OLTP_Poblamiento_LEADS.sql` (recomendado) o cambiar el texto del informe a «1 solapamiento detectado». No se modificó el script del equipo; la decisión queda para los autores. En la app, la tool `agendar_cita` impide crear solapamientos nuevos.
