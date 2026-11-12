#!/usr/bin/env node
// npm run db:init  [-- --reset]     ·  npm run db:informe (recrea y carga los datos de prueba del informe)
// Crea (si no existen) INBESTIGA_TESIS (OLTP) e INBESTIGA_MART (data mart), aplica la
// ampliación de la app, carga los catálogos y crea el usuario SQL de mínimos privilegios.
// Es idempotente: sin --reset no borra datos. Usa DB_ADMIN_USER (sa) solo aquí.
import path from 'node:path';
import sql from 'mssql';
import { config, configMssql, RAIZ, BD_OLTP, BD_MART } from '../src/config.js';
import { abrirConexionScript, ejecutarArchivo } from './lib/sql-runner.js';
import { explicarErrorSql } from '../src/diagnostico-sql.js';

// --informe: recrea ambas bases y carga simulacion_informe/02_OLTP_Poblamiento_LEADS.sql (datos de
// prueba del informe, con sus propios catálogos de IDs fijos) en lugar de 03_catalogos.sql.
const INFORME = process.argv.includes('--informe');
const RESET = INFORME || process.argv.includes('--reset');
const ruta = (...p) => path.join(RAIZ, 'db', ...p);

const ARCHIVOS = {
  oltpBase: ruta('oltp', '01_OLTP_ER.sql'),          // DDL v2 (59 tablas) + Anexo A
  oltpApp: ruta('oltp', '02_ampliacion_app.sql'),     // ampliación de la app (idempotente)
  catalogos: ruta('oltp', '03_catalogos.sql'),        // catálogos (idempotente)
  informe: ruta('oltp', 'simulacion_informe', '02_OLTP_Poblamiento_LEADS.sql'), // datos de prueba del informe
  martBase: ruta('dm', '03_DataMart_DDL.sql'),        // Anexo B: 8 dimensiones + 3 hechos
  martApp: ruta('dm', '03b_ampliacion_app.sql'),      // bitácora del ETL (idempotente)
};

const paso = (t) => console.log(`\n▶ ${t}`);
const ok = (t) => console.log(`  ✔ ${t}`);

async function existeBd(pool, nombre) {
  const r = await pool.request().input('n', sql.NVarChar, nombre).query('SELECT DB_ID(@n) AS id');
  return r.recordset[0].id !== null;
}

async function contarTablas(pool, bd) {
  const r = await pool.request().query(`SELECT COUNT(*) AS n FROM [${bd}].sys.tables WHERE is_ms_shipped = 0`);
  return r.recordset[0].n;
}

/** Crea o sincroniza el login de la app y lo da de alta en ambas bases con mínimos privilegios. */
async function asegurarUsuarioApp(pool) {
  const { usuario, clave } = config.db;
  if (!/^[A-Za-z_][A-Za-z0-9_]{2,63}$/.test(usuario)) throw new Error('DB_USER tiene caracteres no permitidos.');
  if (!clave) throw new Error('DB_PASSWORD está vacío en .env (npm run setup lo genera automáticamente).');
  // CREATE LOGIN no admite parámetros: se arma con QUOTENAME del lado del servidor (sin concatenar en JS).
  await pool.request()
    .input('u', sql.NVarChar, usuario)
    .input('p', sql.NVarChar, clave)
    .batch(`
      DECLARE @q NVARCHAR(MAX);
      IF SUSER_ID(@u) IS NULL
        SET @q = N'CREATE LOGIN ' + QUOTENAME(@u) + N' WITH PASSWORD = ' + QUOTENAME(@p, '''') +
                 N', DEFAULT_DATABASE = [${BD_OLTP}], CHECK_EXPIRATION = OFF;';
      ELSE
        SET @q = N'ALTER LOGIN ' + QUOTENAME(@u) + N' WITH PASSWORD = ' + QUOTENAME(@p, '''') + N';';
      EXEC sys.sp_executesql @q;`);
  for (const bd of [BD_OLTP, BD_MART]) {
    await pool.request().input('u', sql.NVarChar, usuario).batch(`
      USE [${bd}];
      DECLARE @q NVARCHAR(MAX) = N'';
      IF USER_ID(@u) IS NULL SET @q += N'CREATE USER ' + QUOTENAME(@u) + N' FOR LOGIN ' + QUOTENAME(@u) + N';';
      SET @q += N'ALTER ROLE db_datareader ADD MEMBER ' + QUOTENAME(@u) + N';';
      SET @q += N'ALTER ROLE db_datawriter ADD MEMBER ' + QUOTENAME(@u) + N';';
      SET @q += N'GRANT EXECUTE TO ' + QUOTENAME(@u) + N';';
      EXEC sys.sp_executesql @q;`);
  }
}

async function main() {
  console.log('INBESTIGA · inicialización de bases de datos' + (RESET ? ' (--reset: se recrean ambas bases)' : ''));
  if (!config.db.adminClave) {
    console.error('\n✖ Falta DB_ADMIN_PASSWORD en .env (clave del usuario administrador, normalmente "sa").');
    console.error('  Solo se usa en este script para crear las bases y el usuario de la app.');
    process.exit(1);
  }

  paso('Conectando como administrador a master');
  let pool;
  try {
    pool = await abrirConexionScript(configMssql({ admin: true, database: 'master' }));
  } catch (e) {
    console.error('\n✖ ' + explicarErrorSql(e, { admin: true }));
    process.exit(1);
  }
  const v = await pool.request().query("SELECT SERVERPROPERTY('ProductVersion') AS v, SERVERPROPERTY('Edition') AS e");
  ok(`SQL Server ${v.recordset[0].v} · ${v.recordset[0].e}`);

  // --- OLTP ---------------------------------------------------------------
  const oltpExiste = await existeBd(pool, BD_OLTP);
  // Si el OLTP se recrea, el data mart también: sus dimensiones guardan IDs del OLTP anterior.
  const recrearOltp = RESET || !oltpExiste;
  paso(`OLTP ${BD_OLTP}`);
  if (recrearOltp) {
    const n = await ejecutarArchivo(pool, ARCHIVOS.oltpBase);
    ok(`01_OLTP_ER.sql ejecutado (${n} lotes): DDL v2 + ampliación de LEADS (Anexo A)`);
    if (INFORME) {
      await ejecutarArchivo(pool, ARCHIVOS.informe);
      ok('02_OLTP_Poblamiento_LEADS.sql cargado (datos de prueba del informe)');
    }
  } else {
    ok('ya existe: se conserva (usa --reset para recrearla)');
  }
  await ejecutarArchivo(pool, ARCHIVOS.oltpApp);
  ok('02_ampliacion_app.sql aplicado (idempotente)');
  // El escenario del informe trae catálogos propios con IDs fijos: no se mezclan con los de la app.
  const esInforme = INFORME || (await pool.request().query(
    `SELECT COUNT(*) AS n FROM [${BD_OLTP}].dbo.UNIVERSIDAD WHERE nombre = N'Universidad Nacional Demo 1'`)).recordset[0].n > 0;
  if (!esInforme) {
    await ejecutarArchivo(pool, ARCHIVOS.catalogos);
    ok('03_catalogos.sql aplicado (idempotente)');
  } else ok('03_catalogos.sql omitido: el escenario del informe trae sus propios catálogos');

  // --- Data mart ----------------------------------------------------------
  paso(`Data mart ${BD_MART}`);
  await pool.request().query('USE master');
  const martExiste = await existeBd(pool, BD_MART);
  if (recrearOltp || !martExiste) {
    const n = await ejecutarArchivo(pool, ARCHIVOS.martBase);
    ok(`03_DataMart_DDL.sql ejecutado (${n} lotes): 8 dimensiones + 3 hechos (Anexo B)`);
  } else {
    ok('ya existe: se conserva');
  }
  await ejecutarArchivo(pool, ARCHIVOS.martApp);
  ok('03b_ampliacion_app.sql aplicado (bitácora del ETL)');

  // --- Usuario de la app -------------------------------------------------
  paso(`Usuario de la app (${config.db.usuario}): db_datareader + db_datawriter + EXECUTE`);
  await pool.request().query('USE master');
  await asegurarUsuarioApp(pool);
  ok('login y usuarios listos en ambas bases');

  // --- Verificación -------------------------------------------------------
  paso('Verificación');
  const tOltp = await contarTablas(pool, BD_OLTP);
  const tMart = await contarTablas(pool, BD_MART);
  const cat = await pool.request().query(`
    SELECT (SELECT COUNT(*) FROM [${BD_OLTP}].dbo.UNIVERSIDAD)       AS universidades,
           (SELECT COUNT(*) FROM [${BD_OLTP}].dbo.CARRERA)           AS carreras,
           (SELECT COUNT(*) FROM [${BD_OLTP}].dbo.CANAL)             AS canales,
           (SELECT COUNT(*) FROM [${BD_OLTP}].dbo.CAMPANIA)          AS campanias,
           (SELECT COUNT(*) FROM [${BD_OLTP}].dbo.SERVICIO)          AS servicios,
           (SELECT COUNT(*) FROM [${BD_OLTP}].dbo.ASESOR)            AS asesores,
           (SELECT COUNT(*) FROM [${BD_OLTP}].dbo.TARIFA)            AS tarifas,
           (SELECT COUNT(*) FROM [${BD_OLTP}].dbo.REGLA_PRECIO)      AS reglas_precio,
           (SELECT COUNT(*) FROM [${BD_OLTP}].dbo.ENTREGABLE)        AS entregables,
           (SELECT COUNT(*) FROM [${BD_OLTP}].dbo.CATALOGO_OBJECION) AS tipos_objecion,
           (SELECT COUNT(*) FROM [${BD_OLTP}].dbo.TRANSICION_ESTADO_OPORTUNIDAD) AS transiciones,
           (SELECT COUNT(*) FROM [${BD_OLTP}].dbo.OPORTUNIDAD_COMERCIAL)        AS oportunidades`);
  ok(`${BD_OLTP}: ${tOltp} tablas`);
  ok(`${BD_MART}: ${tMart} tablas`);
  ok('catálogos: ' + Object.entries(cat.recordset[0]).map(([k, n]) => `${k}=${n}`).join(', '));
  await pool.close();

  // Prueba final con el usuario de la app (mínimos privilegios), que es el que usa el servidor.
  try {
    const app = await abrirConexionScript(configMssql({ database: BD_MART }));
    await app.request().query('SELECT TOP 1 1 AS ok FROM dbo.Dim_Tiempo UNION ALL SELECT 1');
    await app.close();
    ok(`conexión con el usuario de la app (${config.db.usuario}) verificada`);
  } catch (e) {
    console.error('\n✖ ' + explicarErrorSql(e));
    process.exit(1);
  }
  console.log('\nListo. Siguiente paso: npm run seed (datos sintéticos) y npm run etl.');
}

main().catch((e) => {
  console.error('\n✖ ' + (e?.message || e));
  process.exit(1);
});
