# Cambios frontend pendientes

No se modifica `src/web/**` en este prompt.

La API de lecturas agrega el campo opcional `enlace` en las citas de:

- `GET /api/leads/:leadId/ficha` → bloque `citas[]`.
- `GET /api/agenda` → cada elemento de `citas[]`.

El componente de ficha/agendamiento puede mostrar el enlace cuando no sea `null`. Si es `null`, debe mostrar que el asesor lo enviará antes de la reunión. Las respuestas existentes siguen siendo válidas porque el campo es opcional.
