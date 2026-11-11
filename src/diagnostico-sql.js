// Traduce errores de conexión de SQL Server a pasos concretos (sin mostrar secretos).
import { config } from './config.js';

export function explicarErrorSql(e, { admin = false } = {}) {
  const codigo = e?.code || e?.originalError?.code || '';
  const msg = String(e?.message || e);
  const quien = admin ? `DB_ADMIN_USER (${config.db.adminUsuario})` : `DB_USER (${config.db.usuario})`;
  const destino = config.db.instancia
    ? `${config.db.servidor}\\${config.db.instancia}`
    : `${config.db.servidor}:${config.db.puerto}`;

  if (codigo === 'ESOCKET' || codigo === 'ETIMEOUT' || /ECONNREFUSED|Failed to connect|timeout/i.test(msg)) {
    return [
      `No se pudo abrir una conexión TCP con SQL Server en ${destino}.`,
      'Pasos:',
      '  1. Verifica que el servicio esté iniciado (Windows: services.msc → "SQL Server (MSSQLSERVER)"; Linux: systemctl status mssql-server).',
      '  2. Habilita TCP/IP: SQL Server Configuration Manager → Configuración de red → Protocolos → TCP/IP = Habilitado;',
      '     en "Direcciones IP" → IPAll → Puerto TCP = 1433; luego reinicia el servicio (ver README, "Habilitar TCP/IP").',
      '  3. Si usas una instancia con nombre (p. ej. SQLEXPRESS) define DB_INSTANCE y arranca "SQL Server Browser", o fija el puerto.',
    ].join('\n');
  }
  if (codigo === 'ELOGIN' || /Login failed|Error de inicio de sesión/i.test(msg)) {
    return [
      `SQL Server rechazó el inicio de sesión de ${quien}.`,
      admin
        ? '  · Revisa DB_ADMIN_PASSWORD en .env y que la autenticación SQL (modo mixto) esté activa.'
        : '  · Ejecuta `npm run db:init`: crea el usuario de la app con la clave de DB_PASSWORD.',
    ].join('\n');
  }
  return `Error de SQL Server: ${msg}`;
}
