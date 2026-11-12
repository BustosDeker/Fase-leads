# MANUAL DE USUARIO

**INBESTIGA · Fase 2 LEADS (metodología IMPULSE)**
Aplicación web con Agente de IA para la negociación de asesoría de tesis por WhatsApp, con tablero de inteligencia de negocios

Curso: Inteligencia de Negocios · Ingeniería de Sistemas · UNT

---

## ÍNDICE GENERAL

> La numeración de páginas se agrega al convertir el documento a Word.

**A) PANTALLA DE INGRESO**
- A.1 Pantalla «Ingresar»
- A.2 Cierre de sesión y roles

**B) TABLERO BI**
- B.1 Tablero de gestión de LEADS
- B.2 Ejecutar ETL y Ajustes
- B.3 Explicar este tablero

**C) OPERACIÓN DE LEADS**
- C.1 Ficha nominal
- C.2 Conversaciones
- C.3 Pipeline
- C.4 Diagnósticos
- C.5 Cotizador
- C.6 Objeciones y escalamientos
- C.7 Agenda
- C.8 Consentimiento
- C.9 Auditoría

**D) INTEGRACIÓN CON OTRAS FASES**
- D.1 BUYERS
- D.2 PAYERS
- D.3 CUSTOMERS y TURNED
- D.4 Agente Plataforma

---

## INFORMACIÓN GENERAL

**Menú lateral.** Todas las pantallas se abren desde el menú oscuro de la izquierda, titulado «Embudo IMPULSE»: 1 BUYERS, 2 LEADS (con sus submenús: Ficha nominal, Conversaciones, Pipeline, Diagnósticos, Cotizador, Objeciones y escalamientos, Agenda, Consentimiento, Tablero BI y Auditoría), 3 PAYERS, 4 CUSTOMERS y 5 TURNED. Debajo aparecen «Agente Plataforma», «Evidencias» y «Guion de demo». En celular el menú se pliega con el botón «Menú».

**Pie del menú.** Muestra el estado de WhatsApp y de SQL Server, el usuario con su rol y el botón «Salir».

**Estados de una oportunidad.** Una oportunidad avanza por: Abierta → En diagnóstico → Apta para cotizar → En negociación → Aceptada → Transferida a PAYERS → Confirmada por PAYERS. En cualquier momento puede quedar como Descartada. La base de datos valida que solo se hagan los cambios de estado permitidos.

**Datos de prueba.** Los registros generados por el simulador o por el generador de datos se marcan como «Dato de prueba» o «Prueba».

**Colores.** Los estados se muestran siempre con símbolo y texto: ● bueno / ▲ regular o pendiente / ■ malo o vencido.

---

## A) PANTALLA DE INGRESO

### A.1 Pantalla «Ingresar»

> **[Figura 01 · Pantalla «Ingresar» — insertar captura]**

Es la primera pantalla de la aplicación. Muestra el nombre INBESTIGA, «Metodología IMPULSE · Fase LEADS» y dos campos: **Usuario** y **Clave**. Al pulsar **Ingresar** el sistema valida las credenciales.

Reglas:
- Los usuarios y sus roles los define el administrador del sistema en la configuración del servidor; no existe pantalla de registro.
- Tras 5 intentos fallidos desde la misma dirección en un minuto, el sistema pide esperar un minuto antes de volver a intentar.
- La sesión dura 12 horas; después hay que ingresar de nuevo.
- Si el servidor no responde, la pantalla muestra el aviso correspondiente.

### A.2 Cierre de sesión y roles

> **[Figura 02 · Pie del menú con usuario, rol y botón «Salir» — insertar captura]**

Al pie del menú lateral se ve el usuario y su rol. El botón **Salir** cierra la sesión y vuelve a «Ingresar».

| Rol | Qué puede hacer |
|---|---|
| Administrador | Todo, incluido «Ejecutar ETL» y conectar o desvincular WhatsApp. |
| Asesor | Operar todas las pantallas de LEADS, excepto las acciones exclusivas del administrador. |
| Solo consulta | Ver las pantallas y usar «Explicar este tablero». No puede registrar ni modificar nada. |

Si un rol intenta una acción no permitida, el sistema muestra un aviso (por ejemplo, «Esta acción es solo para el rol administrador»).

---

## B) TABLERO BI

### B.1 Tablero de gestión de LEADS

> **[Figura 03 · Tablero de gestión de LEADS — insertar captura]**

Se abre desde **LEADS › Tablero BI** y es la pantalla de inicio. Lee solo del data mart, es decir, de lo que cargó el último ETL; por eso las oportunidades nuevas aparecen después de ejecutar el ETL (ver B.2).

Contenido, de arriba hacia abajo:

1. **Cabecera.** Título, la etiqueta «Datos simulados» (si la última carga incluye datos de prueba) y los botones «Ajustes» y «Ejecutar ETL».
2. **Franja de estado del ETL.** Fecha y hora de la última carga correcta, duración, número de dimensiones y hechos con sus filas. Si la última ejecución falló, lo indica y aclara que se revirtió.
3. **Filtros.** *Fecha de corte* (solo lectura; se cambia en «Ajustes»), *Cohorte desde*, *Cohorte hasta*, *Grupo de etapa*, *Canal* y *Asesor*. Los filtros activos se ven como etiquetas «Filtrando por», que se quitan con ✕. Los filtros quedan en la dirección de la página, así que el enlace filtrado se puede compartir.
4. **Cinco tarjetas de indicadores**, cada una con su semáforo (Bueno, Regular, Malo o «Sin datos»):

| Indicador | Qué mide | Regular desde | Bueno desde |
|---|---|---|---|
| Diagnóstico oportuno | Solicitudes de diagnóstico entregadas dentro del plazo | 75 % | 90 % |
| Cotización oportuna | Oportunidades aptas que reciben su primera propuesta a tiempo | 75 % | 90 % |
| Aceptación de propuestas | Primeras propuestas aceptadas en el plazo | 20 % | 35 % |
| Recuperación de objeciones | Objeciones principales recuperadas | 15 % | 30 % |
| Conversión a PAYERS | Oportunidades confirmadas por PAYERS | 10 % | 20 % |

5. **Embudo y tendencia.** El embudo muestra los totales de cada indicador; la gráfica de tendencia se puede cambiar de indicador.
6. **Indicadores por dimensión.** Tabla con selector de dimensión; al hacer clic en una fila se baja de nivel (drill-down). Botones **Exportar CSV** y **Exportar PDF**.
7. **Acciones sugeridas · Agente Plataforma.** Recomendaciones basadas en las cifras visibles.

Reglas:
- Cada indicador es un cociente de sumas (suma de casos logrados entre suma de casos medibles). Si no hay casos medibles se muestra «Sin datos», nunca 0 %.
- Los plazos de medición se muestran bajo los filtros: diagnóstico 48 h, cotización 2 h, aceptación 30 días, recuperación de objeciones 30 días y conversión a PAYERS 60 días (valores por defecto; se cambian en «Ajustes»).
- Los umbrales del semáforo son valores de prueba que debe validar la gestión del negocio.

### B.2 Ejecutar ETL y Ajustes

> **[Figura 04 · Panel «Parámetros de medición» — insertar captura]**

**Ejecutar ETL** vuelve a cargar el data mart desde la base transaccional. Mientras corre muestra el paso en curso (preparando, dimensiones, hechos, conteo). Es una acción exclusiva del **administrador**.

**Ajustes** abre el panel «Parámetros de medición»:
- *Fecha de corte* (si se deja vacía se usa el momento actual).
- *Diagnóstico (horas)*, *Cotización (horas)*, *Aceptación y recuperación (días)* y *Conversión a PAYERS (días)*.
- **Restablecer** devuelve los valores por defecto; **Ejecutar con estos valores** lanza la carga.

Qué activa internamente: la carga se hace en una sola transacción. Si algo falla, se revierte completa y el tablero conserva la carga anterior. Cada ejecución queda registrada (parámetros, duración y filas cargadas).

### B.3 Explicar este tablero

> **[Figura 05 · Sección «Explicar este tablero» con resultado — insertar captura]**

Al pulsar **Explicar**, el sistema redacta un resumen en lenguaje simple con las cifras visibles y los filtros actuales. Solo usa datos del data mart. Debajo del texto se indica si fue generado por reglas o redactado con IA y verificado contra las cifras. El botón cambia a **Volver a explicar**. Está disponible para todos los roles, incluido «Solo consulta».

---

## C) OPERACIÓN DE LEADS

### C.1 Ficha nominal

> **[Figura 06 · Ficha nominal — oportunidades recientes — insertar captura]**
> **[Figura 07 · Ficha nominal de un estudiante, pestaña «Resumen» — insertar captura]**

Muestra todos los datos de un estudiante a partir de su nombre. Sin estudiante elegido aparece la lista **Oportunidades recientes** (con búsqueda por estudiante, carrera o número y filtro por estado); al hacer clic en una fila se abre su ficha. También se puede buscar con el cuadro superior por nombre, WhatsApp o identificador.

**Cabecera de la ficha:** nombre, estado, etiquetas («Dato de prueba», «N pendientes»), datos clave (WhatsApp, carrera, universidad, responsable, propuesta vigente, días desde el inicio) y la barra de avance por estados. Si el estudiante tiene varias oportunidades, un selector permite elegir una. Botones: **Cotizar** (solo si la oportunidad está Apta para cotizar o En negociación), **Agendar cita** y **Eliminar lead**.

**Pestañas:**
- **Resumen:** Identidad y contacto (con **Editar contacto**), Contexto académico y Canal de origen (solo lectura, vienen de BUYERS), Preferencias y disponibilidad, Decisión y responsable de pago, y Estado de la oportunidad (con **Descartar**).
- **Diagnóstico:** solicitud y entrega con semáforo del plazo de 48 h. Botones **Registrar solicitud**, **Registrar entrega** y **Marcar apta para cotizar**.
- **Propuestas y objeciones:** versiones de propuesta con precio, vigencia y respuesta; objeciones y escalamientos registrados.
- **Actividad:** línea de tiempo con filtro por origen (Agente IA, Asesor, Sistema, PAYERS) y panel «Agenda y seguimiento».
- **Consentimiento:** historial de consentimientos con enlace a «Gestionar consentimiento».

Reglas:
- **Editar contacto:** el WhatsApp debe llevar código de país (por ejemplo 51). Cambiarlo no altera el consentimiento, pero obliga a volver a habilitar WhatsApp desde Conversaciones.
- **Registrar solicitud:** solo con la oportunidad Abierta y sin diagnóstico previo; la oportunidad pasa a En diagnóstico.
- **Registrar entrega:** requiere un resumen de al menos 10 caracteres.
- **Marcar apta para cotizar:** solo si la oportunidad está En diagnóstico y ya tiene un diagnóstico entregado.
- **Descartar:** pide un motivo; no está disponible si la oportunidad ya está Descartada o Confirmada por PAYERS.
- **Eliminar lead:** pide confirmación, no se puede deshacer y borra conversaciones e historial comercial. Se bloquea si el lead tiene pagos, órdenes de pago u honorarios.
- La ficha se actualiza en vivo cuando el agente o un asesor registra algo.

### C.2 Conversaciones

> **[Figura 08 · Conversaciones: panel de WhatsApp, bandeja y chat — insertar captura]**
> **[Figura 09 · Auditoría de turnos del agente — insertar captura]**

Es la bandeja del Agente Negociador. Se compone de:

- **Franja del agente:** indica el proveedor en uso («Modo sin IA (reglas)», Claude, OpenAI o Gemini).
- **Panel WhatsApp:** estado de la conexión y botones **Conectar WhatsApp** (muestra un código QR para vincular el teléfono desde WhatsApp › Dispositivos vinculados), **Mostrar QR**, **Desvincular** y **Detalles**. Conectar y desvincular son acciones del administrador.
- **Bandeja:** búsqueda y filtros por canal (Simulador o WhatsApp) y por bandeja: *Con el agente*, *Con una persona*, *Derivación pendiente* y *Cerradas*. Cada conversación muestra el último mensaje y etiquetas de estado.
- **Nueva conversación de prueba:** permite iniciar una conversación como un estudiante nuevo o con un lead existente; se registra como dato de prueba.
- **Escribir primero por WhatsApp:** permite que el agente envíe el primer mensaje a un lead.
- **Chat de la conversación:** mensajes del estudiante, del agente y de los asesores; casillas «Escribir como asesor» y «Ver acciones del agente»; botones **Ver ficha**, **Tomar el control** y **Devolver al agente**.
- **Derivaciones a una persona** y **Auditoría de turnos del agente:** por cada turno, proveedor, tiempo de respuesta, herramientas usadas con su resultado y alertas («Posible manipulación», «Respuesta corregida», «Con error»).

Reglas y funcionamiento interno:
- El agente solo atiende a contactos con **consentimiento vigente** (Ley 29733). Sin consentimiento solo puede pedirlo, consultar la situación o derivar a una persona.
- El agente nunca escribe primero por iniciativa propia. **Escribir primero** exige: WhatsApp conectado, número registrado, consentimiento vigente y la casilla «Habilitar WhatsApp para este lead» marcada por un asesor. Se pide confirmación antes de enviar y se usa una plantilla de primer contacto que explica cómo pedir que no le escriban más.
- Los precios los calcula el sistema; si el agente redactara un monto que no proviene del cotizador, la respuesta se reemplaza por un mensaje seguro y el turno queda anotado.
- **Tomar el control** detiene al agente: desde ese momento solo escribe el asesor. **Devolver al agente** lo reactiva. Una derivación también detiene al agente hasta que el asesor devuelva la conversación.
- En conversaciones reales de WhatsApp solo puede escribir un asesor; en las del simulador se puede escribir como estudiante.
- Si el contacto revocó su consentimiento, el campo de mensaje queda deshabilitado para el asesor.
- El diagnóstico y la aptitud los realiza siempre una persona; el agente solo solicita el diagnóstico.

### C.3 Pipeline

> **[Figura 10 · Pipeline en vista «Tablero» — insertar captura]**
> **[Figura 11 · Pipeline en vista «Lista» — insertar captura]**

Muestra todas las oportunidades. Con el selector **Vista** se alterna entre **▦ Tablero** (una columna por estado, con cantidad y monto) y **☰ Lista** (tabla ordenable con días en el estado y monto).

Filtros: búsqueda, Responsable, Canal, Grupo de etapa, Datos (solo reales o solo de prueba), Ordenar por (más recientes, más días en el estado, mayor monto, nombre) y la casilla «Ver descartadas y confirmadas». Sobre la tabla se resume el total de oportunidades, las abiertas y el monto en propuestas abiertas.

Reglas: por defecto no se muestran las oportunidades Descartadas ni Confirmadas por PAYERS. Una tarjeta con 7 o más días en el mismo estado se marca con ▲. Al hacer clic en una tarjeta o fila se abre la Ficha nominal. Los filtros quedan en la dirección de la página.

### C.4 Diagnósticos

> **[Figura 12 · Diagnósticos de tesis — insertar captura]**

Lista las solicitudes de diagnóstico con su situación respecto al plazo. Las cuatro tarjetas superiores funcionan como filtro: *Vencidos*, *Pendientes en plazo*, *Entregados a tiempo* y *Entregados tarde*. Filtros adicionales: búsqueda, Situación, Responsable y **Plazo de entrega (horas)** (48 por defecto).

La tabla muestra estudiante y tema, fecha de solicitud, fecha de entrega, horas transcurridas, situación del plazo, responsable y estado de la oportunidad.

Funcionamiento: esta pantalla es de seguimiento; al hacer clic en una fila se abre la Ficha nominal, donde se registra la entrega del diagnóstico y se califica la aptitud (ver C.1). Cambiar el plazo aquí solo cambia la forma de verlo; no modifica los plazos del tablero.

### C.5 Cotizador

> **[Figura 13 · Cotizador: oportunidades listas para cotizar — insertar captura]**
> **[Figura 14 · Cotizador: nueva versión, desglose y versiones presentadas — insertar captura]**

Sin oportunidad elegida muestra **Oportunidades listas para cotizar** (Apta para cotizar o En negociación, con pestañas «Sin propuesta aún» y «En negociación»). Una oportunidad Apta con 2 o más días de espera se marca con ■.

Al elegir una oportunidad se muestra:
- **Nueva versión (vN):** *Servicio*, *Forma de pago* (en cuotas o al contado), *Ajuste negociado (%)*, casilla *Aplicar promoción de temporada* y lista de *Extras*. Se indica el precio mínimo y el tope de descuento del servicio.
- **Desglose:** precio base, extras, recargos, descuentos (con la regla aplicada) y precio final, calculados en el servidor. Si ya hay una versión vigente, compara contra ella.
- **Presentar versión N:** registra la propuesta.
- **Versiones presentadas:** cada versión con su desglose, vigencia y respuesta; la vigente se resalta.

Reglas:
- Solo se cotiza una oportunidad Apta para cotizar o En negociación.
- Los descuentos automáticos se limitan al tope y se avisa. Si el **ajuste negociado** pedido a mano supera el tope o deja el precio por debajo del mínimo, la propuesta queda **bloqueada** («Propuesta bloqueada») y el botón se deshabilita: hay que reducir el ajuste o derivar el caso a una persona.
- Si la carrera del estudiante no tiene tarifa configurada, el sistema indica que corresponde derivar a una persona.
- La vigencia de cada propuesta es de 7 días desde su presentación.
- Cada cambio genera una versión nueva; al presentarla, la anterior queda como reemplazada y, si la oportunidad estaba Apta para cotizar, pasa a En negociación.
- Los precios, topes y mínimos de los catálogos son valores de prueba pendientes de validación por la gestión del negocio.

### C.6 Objeciones y escalamientos

> **[Figura 15 · Objeciones y escalamientos: «Cola de atención» — insertar captura]**
> **[Figura 16 · Pestañas «Objeciones» y «Catálogo de respuestas» — insertar captura]**

Tiene tres secciones:
- **Cola de atención:** casos que esperan a una persona, cada uno con motivo, destino, fecha, estudiante y el resumen preparado por el agente. Botones **Marcar atendido** y **Ver ficha**. Filtro «Derivado a».
- **Objeciones:** objeciones registradas, clasificadas por grupo y tipo, con la respuesta del agente y su resultado (● Recuperada, ▲ Pendiente, ■ Escalada con número de repeticiones). Filtros por grupo y resultado.
- **Catálogo de respuestas:** respuesta base respaldada y criterio de escalamiento de cada objeción. Es de solo lectura en la pantalla.

Funcionamiento: el agente deriva un caso cuando no hay precio configurado, hay excepciones contractuales, una consulta académica compleja, un descuento fuera de tope o una objeción que se repite. Al derivar, el agente se detiene hasta que un asesor devuelva la conversación (ver C.2). Marcar un caso como atendido registra su fecha de atención.

### C.7 Agenda

> **[Figura 17 · Agenda de citas virtuales (vista semanal) — insertar captura]**

Muestra las citas virtuales de la semana en siete columnas (lunes a domingo). Botones de navegación: **‹ Semana anterior**, **Hoy**, **Semana siguiente ›** y **Última cita registrada**. Filtros: Asesor, Estado y Medio (Google Meet, Zoom o Llamada de WhatsApp).

Cada cita indica horario, estudiante (con enlace a su ficha), asesor, medio y estado. Un selector **Cambiar estado…** permite avanzar la cita.

**Agendar cita:** se indica el número de oportunidad, el asesor, el inicio, la duración (15 a 180 minutos, 45 por defecto) y el medio, y se pulsa **Agendar**.

Reglas:
- Las citas son opcionales: la conversación puede continuar por WhatsApp.
- El sistema impide crear una cita que se solape con otra del mismo asesor; las citas canceladas no cuentan.
- Ciclo de estados: Solicitada → Confirmada → Realizada / No asistió / Cancelada (una cita Solicitada solo puede pasar a Confirmada o Cancelada).
- Si existen citas solapadas (por datos anteriores), se resaltan y se avisa que se revisen en Auditoría.

### C.8 Consentimiento

> **[Figura 18 · Consentimiento y privacidad — insertar captura]**

Gestiona el consentimiento de contacto de cada persona según la Ley 29733. Los botones superiores filtran por estado: *Todos*, *● Vigentes*, *▲ Sin consentimiento* y *■ Revocados*. También hay búsqueda por nombre o WhatsApp y filtro por tipo de datos.

Para cada contacto se muestra su estado con fecha, el número de registros y las acciones **Revocar** (o **Nuevo consentimiento** si ya está revocado) y **Ficha**.

Reglas:
- Revocar pide confirmación; desde ese momento el agente deja de escribirle.
- **Nuevo consentimiento** debe registrarse solo con la confirmación expresa de la persona.
- Cada cambio se guarda en un historial con fecha, medio y evidencia.

### C.9 Auditoría

> **[Figura 19 · Auditoría operativa del agente — insertar captura]**

Revisa en vivo, sobre la base transaccional, cinco controles. Cada tarjeta muestra la cantidad de hallazgos («Sin hallazgos» o «N por revisar»):

| Control | Qué detecta |
|---|---|
| Agenda y atención | Citas solapadas por asesor (sin contar las canceladas) |
| Trazabilidad comercial | Propuestas sin ninguna respuesta registrada |
| Reglas económicas | Descuento sobre el tope o precio bajo el mínimo |
| Escalamiento humano | Casos pendientes de atención |
| Conciliación con PAYERS | Acuerdos transferidos sin confirmación |

Debajo se listan los detalles de cada control. Al hacer clic en una fila (cuando corresponde) se abre la ficha del estudiante. Es una pantalla de consulta: no modifica datos.

---

## D) INTEGRACIÓN CON OTRAS FASES

### D.1 BUYERS

> **[Figura 20 · BUYERS → LEADS: contrato y simulador — insertar captura]**

BUYERS es la fase que capta a los interesados y los entrega a LEADS. La pantalla muestra el **Contrato de integración** (ejemplo del envío) y un **Simulador de BUYERS** para enviar un lead de prueba: *Nombres*, *Apellidos*, *WhatsApp (con 51)*, *Canal de captación*, *Universidad*, *Carrera*, *Etapa* (IX ciclo, X ciclo, Egresado, Bachiller) y *Evidencia del consentimiento*. El botón **Enviar lead a LEADS** muestra si se creó el lead o si ese WhatsApp ya existía, con enlace «ver ficha».

Reglas y funcionamiento interno:
- Un lead sin consentimiento es rechazado.
- No se duplica: se reconoce por el número de WhatsApp.
- Al recibirlo se crean el contacto, el buyer, el lead y una oportunidad «Abierta», y se guarda el consentimiento en el historial; si llegan universidad, carrera y etapa reconocibles, también el perfil académico.
- Para que el agente atienda a ese estudiante por WhatsApp, un asesor debe habilitar WhatsApp para ese lead (ver C.2).
- El simulador marca el lead como dato de prueba.

### D.2 PAYERS

> **[Figura 21 · LEADS → PAYERS: bandeja y simulador — insertar captura]**

PAYERS recibe los acuerdos aceptados y confirma la contratación. La bandeja lista las propuestas aceptadas con su precio, estado y seguimiento, y se filtra por **Por transferir**, **Esperando confirmación** y **Confirmadas**, además de búsqueda.

Acciones por fila:
- **Transferir:** envía el acuerdo a PAYERS (estado Aceptada).
- **Simular confirmación:** reproduce la respuesta de PAYERS (estado Transferida); la oportunidad pasa a Confirmada por PAYERS.

Reglas:
- Cuando el estudiante acepta expresamente la propuesta, la transferencia se hace automáticamente; si falla, la oportunidad queda Aceptada y se transfiere desde esta pantalla.
- El envío y la confirmación no se duplican si se repiten.
- LEADS no guarda montos pagados ni medios de pago; solo la referencia de la confirmación.

### D.3 CUSTOMERS y TURNED

> **[Figura 22 · CUSTOMERS / TURNED: pantalla informativa — insertar captura]**

Pantallas informativas. CUSTOMERS corresponde al acompañamiento del estudiante contratado y TURNED al cierre del servicio y la fidelización. Ambas fases están **fuera del alcance** de este proyecto y las desarrolla otro equipo; la pantalla solo explica su relación con LEADS.

### D.4 Agente Plataforma

> **[Figura 23 · Agente Plataforma — insertar captura]**

Vista general del embudo IMPULSE con los conteos actuales de la base transaccional (incluye datos de prueba): BUYERS, LEADS, Aceptadas, PAYERS y CUSTOMERS. Cada fila lleva a su pantalla. Debajo aparecen los conteos por estado de oportunidad y tres bloques:
- **Agente Negociador · 7 días:** turnos, conversaciones, latencia media, turnos con error e intentos de manipulación detectados (botón **Ver conversaciones**).
- **Derivaciones pendientes:** cantidad por motivo (botón **Ir a la cola**).
- **Servicios:** estado de SQL Server y de WhatsApp, y conversaciones abiertas (botón para ir al Tablero BI).

La pantalla se actualiza sola cada 30 segundos.

---

## PENDIENTE DE VERIFICAR

- Capturas de pantalla de todas las figuras (marcadas como «insertar captura»).
- Funcionamiento con IA real (Claude, OpenAI o Gemini): según el README, solo el modo sin IA (reglas) está verificado de punta a punta.
- Conversación real por WhatsApp con un teléfono vinculado: aún no probada según el README.
- Validación de precios, topes, plazos y umbrales por la gestión del negocio.
- Qué acciones concretas de la pantalla Conversaciones y de otras puede ejecutar el rol «Asesor» frente al «Administrador» más allá de «Ejecutar ETL» y conectar o desvincular WhatsApp (el código solo restringe esas dos acciones al administrador).
