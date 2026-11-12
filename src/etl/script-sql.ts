// Carga los scripts SQL del equipo (fuente única de verdad) y los prepara para ejecutarse
// con parámetros reales (sp_executesql) en vez de los DECLARE fijos del archivo.
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ } from '../config.js';

export const PARAMETROS_ETL = ['Corte', 'WD', 'WQ', 'WA', 'WC'] as const;

/**
 * Lee un .sql y elimina las líneas `USE …;` y `DECLARE @Corte/@WD/@WQ/@WA/@WC …;`.
 * Falla si el script ya no declara los cinco parámetros: así detectamos que el
 * archivo del equipo cambió y la app no lo ejecuta "a ciegas".
 */
export function cargarScriptParametrizado(rutaRelativa: string): string {
  const texto = fs.readFileSync(path.join(RAIZ, rutaRelativa), 'utf8').replace(/^﻿/, '');
  const encontrados = new Set<string>();
  const lineas = texto.split(/\r?\n/).filter((linea) => {
    if (/^\s*USE\s+\[?\w+\]?\s*;?\s*$/i.test(linea)) return false;
    const m = /^\s*DECLARE\s+@(Corte|WD|WQ|WA|WC)\b/i.exec(linea);
    if (m) {
      encontrados.add(m[1].toUpperCase());
      return false;
    }
    if (/^\s*GO\s*$/i.test(linea)) throw new Error(`${rutaRelativa} contiene GO: debe ejecutarse como un único lote.`);
    return true;
  });
  const faltan = PARAMETROS_ETL.filter((p) => !encontrados.has(p.toUpperCase()));
  if (faltan.length) throw new Error(`${rutaRelativa} ya no declara ${faltan.map((f) => '@' + f).join(', ')}.`);
  return lineas.join('\n');
}

/** Divide el ETL del Anexo C en sus dos secciones: A (dimensiones, MERGE) y B (hechos). */
export function seccionesEtl(): { dimensiones: string; hechos: string } {
  const sqlEtl = cargarScriptParametrizado('db/etl/04_ETL.sql');
  const marca = /^-+\s*B\.\s*HECHOS.*$/m;
  const m = marca.exec(sqlEtl);
  if (!m) throw new Error('No se encontró la sección «B. HECHOS» en db/etl/04_ETL.sql.');
  const cabecera = 'SET LANGUAGE Spanish; SET NOCOUNT ON;\n'; // la sección B también usa nombres de fecha
  return { dimensiones: sqlEtl.slice(0, m.index), hechos: cabecera + sqlEtl.slice(m.index) };
}
