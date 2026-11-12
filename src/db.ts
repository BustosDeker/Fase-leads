// Pools de conexión de la app (usuario de mínimos privilegios). Uno por base.
import sql from 'mssql';
import { configMssql, BD_OLTP, BD_MART } from './config.js';

let poolOltp: sql.ConnectionPool | null = null;
let poolMart: sql.ConnectionPool | null = null;

export async function oltp(): Promise<sql.ConnectionPool> {
  if (!poolOltp?.connected) poolOltp = await new sql.ConnectionPool(configMssql({ database: BD_OLTP })).connect();
  return poolOltp;
}

export async function mart(): Promise<sql.ConnectionPool> {
  if (!poolMart?.connected) poolMart = await new sql.ConnectionPool(configMssql({ database: BD_MART })).connect();
  return poolMart;
}

export async function cerrarPools() {
  await Promise.allSettled([poolOltp?.close(), poolMart?.close()]);
  poolOltp = poolMart = null;
}

export { sql };
