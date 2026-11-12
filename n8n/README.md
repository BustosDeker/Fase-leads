# n8n local (opcional)

n8n solo orquesta tareas alrededor del agente; el cerebro y las reglas siguen en el backend TypeScript. Es opcional y no se agrega como dependencia del repositorio.

## 1. Levantar n8n

Requiere Node 22 y npm:

```bash
npx n8n
# o desde este repositorio:
npm run n8n
```

Abre `http://localhost:5678`. Si n8n corre directamente en la máquina, usa `http://127.0.0.1:3100` para evitar que n8n resuelva `localhost` a IPv6. Si n8n corre en Docker, usa `http://host.docker.internal:3100` porque `127.0.0.1` apunta al contenedor.

## 2. Crear la credencial Header Auth

En la interfaz de n8n:

1. Abre **Credentials** → **Add credential**.
2. Busca y selecciona **Header Auth**.
3. En **Name**, escribe exactamente `INBESTIGA agente`.
4. En **Header Name**, escribe `Authorization`.
5. En **Header Value**, escribe `Bearer <el valor de AGENTE_API_TOKEN del .env del backend>`.
6. Guarda la credencial. El token queda almacenado por n8n y no está escrito en los workflows.

No pongas el token en una URL, nodo Set, JSON exportado ni repositorio.

## 3. Importar y configurar los workflows

Importa desde **Workflows** estos archivos:

- `n8n/workflows/seguimiento-inactividad.json`
- `n8n/workflows/aviso-derivacion.json`

En cada workflow:

1. Abre el nodo **Config**.
2. Confirma o edita `appUrl`; el valor inicial es `http://127.0.0.1:3100`.
   Para Docker en Linux, cambia el valor a `http://host.docker.internal:3100` y configura el contenedor con `host.docker.internal:host-gateway` (el contenedor local `radar-n8n` ya lo tiene).
3. Abre el nodo HTTP (**Ejecutar seguimiento** o **Consultar derivaciones**).
4. En **Authentication**, selecciona **Predefined Credential Type**.
5. En **Credential Type**, selecciona **Header Auth**.
6. Elige la credencial `INBESTIGA agente`.
7. Guarda el workflow.

El workflow de derivaciones conserva el último `escalamiento_id` en Static Data mediante el nodo Code integrado y lo envía como `desde_id`; por eso una ejecución posterior no repite avisos. Los nodos de correo se importan desactivados y no tienen credenciales.

## 4. Comprobar el backend antes de ejecutar

Desde la misma máquina donde corre n8n:

```bash
curl -i http://127.0.0.1:3100/api/salud
curl -i -H "Authorization: Bearer $AGENTE_API_TOKEN" \
  "http://127.0.0.1:3100/api/agente/derivaciones/pendientes?desde_id=0"
```

En PowerShell:

```powershell
curl.exe -i http://127.0.0.1:3100/api/salud
curl.exe -i -H "Authorization: Bearer $env:AGENTE_API_TOKEN" `
  "http://127.0.0.1:3100/api/agente/derivaciones/pendientes?desde_id=0"
```

La segunda petición debe devolver 200 con el token correcto. Sin token o con token incorrecto debe devolver 401. Si aparece `ECONNREFUSED`, levanta primero el backend y comprueba que escucha en `127.0.0.1:3100`.

Desde el contenedor n8n puedes comprobar la conectividad así:

```bash
docker exec radar-n8n wget -qO- http://host.docker.internal:3100/
```

Debe devolver la página de INBESTIGA. Si falla, verifica que el backend escuche en `0.0.0.0:3100`.

## 5. Ejecutar y evitar duplicados

Pulsa **Execute workflow** para una prueba manual. Cuando n8n sea el único scheduler, deja en el `.env` del backend:

```text
SEGUIMIENTO_INTERNO=false
```

Si no quieres instalar n8n, usa el scheduler local con `SEGUIMIENTO_INTERNO=true` y `SEGUIMIENTO_CADA_MIN=15`. No actives ambos mecanismos al mismo tiempo.

En producción usa una URL accesible desde n8n, HTTPS, un `AGENTE_API_TOKEN` distinto por entorno y credenciales administradas por n8n.

Los workflows solo usan nodos integrados de n8n: Schedule Trigger, Set, HTTP Request, IF, Code y Email Send. Las copias locales fueron verificadas en n8n 2.x; los avisos de correo permanecen desactivados.
