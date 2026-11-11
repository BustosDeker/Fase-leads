// Configuración única de la app (la usan el servidor y los scripts de scripts/).
// Lee .env de la raíz del repositorio. Nunca imprime secretos.
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Nombres de las bases: fijos porque los scripts SQL del informe los usan literalmente. */
export const BD_OLTP = 'INBESTIGA_TESIS';
export const BD_MART = 'INBESTIGA_MART';

const bool = (v, def = false) => (v === undefined || v === '' ? def : /^(1|true|si|sí|yes)$/i.test(v));
const int = (v, def) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? def : Number(v));

export const config = {
  puerto: int(process.env.PORT, 3000),
  db: {
    servidor: process.env.DB_SERVER || 'localhost',
    puerto: int(process.env.DB_PORT, 1433),
    instancia: process.env.DB_INSTANCE || '',
    encrypt: bool(process.env.DB_ENCRYPT, false),
    confiarCertificado: bool(process.env.DB_TRUST_SERVER_CERTIFICATE, true),
    usuario: process.env.DB_USER || 'inbestiga_app',
    clave: process.env.DB_PASSWORD || '',
    adminUsuario: process.env.DB_ADMIN_USER || 'sa',
    adminClave: process.env.DB_ADMIN_PASSWORD || '',
  },
};

/**
 * Construye la configuración del driver `mssql` (tedious).
 * @param {{ admin?: boolean, database?: string, max?: number }} opciones
 */
export function configMssql({ admin = false, database = BD_OLTP, max = 10 } = {}) {
  const d = config.db;
  /** @type {import('mssql').config} */
  const c = {
    server: d.servidor,
    database,
    user: admin ? d.adminUsuario : d.usuario,
    password: admin ? d.adminClave : d.clave,
    pool: { max, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 8000,
    requestTimeout: 300000,
    options: {
      encrypt: d.encrypt,
      trustServerCertificate: d.confiarCertificado,
      enableArithAbort: true,
      useUTC: false, // las fechas del negocio son hora local de Perú
    },
  };
  // Instancia con nombre (p. ej. SQLEXPRESS) requiere SQL Browser; si no, se usa el puerto.
  if (d.instancia) c.options.instanceName = d.instancia;
  else c.port = d.puerto;
  return c;
}
