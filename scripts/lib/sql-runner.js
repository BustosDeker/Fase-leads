// Ejecuta archivos .sql de SQL Server desde Node, partiendo por los separadores GO
// (igual que sqlcmd/SSMS). Usa UNA sola conexión para que USE, SET IDENTITY_INSERT
// y las variables de sesión se mantengan entre lotes.
import fs from 'node:fs';
import sql from 'mssql';

/** Lee un .sql (UTF-8 con o sin BOM) y lo divide en lotes por líneas `GO`. */
export function leerLotes(archivo) {
  const texto = fs.readFileSync(archivo, 'utf8').replace(/^﻿/, '');
  const lotes = [];
  let actual = [];
  for (const linea of texto.split(/\r?\n/)) {
    const m = /^\s*GO(?:\s+(\d+))?\s*(?:--.*)?$/i.exec(linea);
    if (m) {
      const repeticiones = m[1] ? Number(m[1]) : 1;
      const lote = actual.join('\n').trim();
      if (lote) for (let i = 0; i < repeticiones; i++) lotes.push(lote);
      actual = [];
    } else {
      actual.push(linea);
    }
  }
  const resto = actual.join('\n').trim();
  if (resto) lotes.push(resto);
  return lotes;
}

/** Abre una conexión exclusiva (pool de 1) para correr scripts. */
export async function abrirConexionScript(configMssql) {
  const pool = new sql.ConnectionPool({ ...configMssql, pool: { max: 1, min: 0 } });
  await pool.connect();
  return pool;
}

/**
 * Ejecuta un archivo .sql completo.
 * @param {sql.ConnectionPool} pool  conexión exclusiva
 * @param {string} archivo
 * @param {{ verbose?: boolean, alResultado?: (recordsets: any[]) => void }} [op]
 */
export async function ejecutarArchivo(pool, archivo, op = {}) {
  const lotes = leerLotes(archivo);
  let n = 0;
  for (const lote of lotes) {
    n++;
    const req = pool.request();
    if (op.verbose) req.on('info', (i) => console.log('   [sql]', i.message));
    try {
      const r = await req.batch(lote);
      if (op.alResultado && r.recordsets?.length) op.alResultado(r.recordsets);
    } catch (e) {
      const extracto = lote.split('\n').slice(0, 6).join('\n');
      const err = new Error(
        `Error en ${archivo} (lote ${n}/${lotes.length}): ${e.message}\n--- inicio del lote ---\n${extracto}\n---`,
      );
      err.cause = e;
      throw err;
    }
  }
  return lotes.length;
}
