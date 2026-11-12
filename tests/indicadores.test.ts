// Pruebas de los indicadores: cociente de sumas, «Sin datos» y semáforo con los umbrales del informe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agregar, cocienteDeSumas, indicador, INDICADORES, semaforo } from '../src/shared/indicadores.js';

test('denominador 0 => Sin datos (null), no 0 %', () => {
  assert.equal(cocienteDeSumas(0, 0), null);
  assert.equal(semaforo(indicador('K1'), null), 'SIN_DATOS');
});

test('el total es cociente de sumas, no promedio de porcentajes', () => {
  // Segmento A: 9/10 = 90 %, segmento B: 10/100 = 10 %. Promedio de porcentajes = 50 % (incorrecto).
  const total = agregar([{ num: 9, den: 10 }, { num: 10, den: 100 }]);
  assert.equal(total.num, 19);
  assert.equal(total.den, 110);
  assert.ok(Math.abs(total.valor! - (100 * 19) / 110) < 1e-9); // 17,27 %
  assert.notEqual(Math.round(total.valor!), 50);
});

test('umbrales de la hoja de gestión (Regular desde / Bueno desde)', () => {
  const esperados: Record<string, [number, number]> = { K1: [75, 90], K2: [75, 90], K3: [20, 35], K4: [15, 30], K5: [10, 20] };
  for (const k of INDICADORES) assert.deepEqual([k.regularDesde, k.buenoDesde], esperados[k.codigo]);
  const k3 = indicador('K3');
  assert.equal(semaforo(k3, 35), 'BUENO');
  assert.equal(semaforo(k3, 34.9), 'REGULAR');
  assert.equal(semaforo(k3, 20), 'REGULAR');
  assert.equal(semaforo(k3, 19.9), 'MALO');
});

test('los nombres de negocio no contienen códigos internos', () => {
  for (const k of INDICADORES) assert.doesNotMatch(k.nombre, /\b[KMDR]\d+\b|AD\d/);
});
