// Pruebas del motor de precios: base + extras + recargos − descuentos, tope y mínimo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cotizar, validarLimites, type Regla, type Tarifa } from '../src/negocio/precios.js';

const tarifa: Tarifa = { tarifaId: 1, precioBase: 2000, precioMinimo: 1600, topeDescuentoPct: 10 };
const R = (id: number, tipo: Regla['tipo'], factor: Regla['factor'], porcentaje: number, valor: string | null = null, umbral: number | null = null): Regla =>
  ({ reglaId: id, nombre: `regla ${id}`, tipo, factor, valorCondicion: valor, umbralDias: umbral, porcentaje });
const reglas = [
  R(1, 'DESCUENTO', 'UNIVERSIDAD', 5, 'Universidad Nacional de Trujillo'),
  R(2, 'DESCUENTO', 'FORMA_PAGO', 5, 'CONTADO'),
  R(3, 'DESCUENTO', 'AVANCE', 5, '>50'),
  R(4, 'RECARGO', 'URGENCIA', 15, null, 15),
  R(5, 'RECARGO', 'TIPO_TESIS', 10, 'EXPERIMENTAL'),
];

test('sin reglas aplicables el precio final es el base', () => {
  const q = cotizar(tarifa, reglas, {});
  assert.equal(q.precioFinal, 2000);
  assert.equal(q.descuento, 0);
  assert.deepEqual(validarLimites(q), []);
});

test('precio final = base + extras + recargos − descuentos', () => {
  const q = cotizar(tarifa, reglas, { tipoTesis: 'EXPERIMENTAL', universidad: 'Universidad Nacional de Trujillo' },
    [{ entregableId: 9, nombre: 'Extra', cantidad: 2, precioUnitario: 150 }]);
  assert.equal(q.montoExtras, 300);
  assert.equal(q.recargo, 200);   // 10 % de 2000
  assert.equal(q.descuento, 100); // 5 % de 2000
  assert.equal(q.precioFinal, 2000 + 300 + 200 - 100);
});

test('los descuentos acumulados se recortan al tope y se avisa', () => {
  const q = cotizar(tarifa, reglas, { universidad: 'Universidad Nacional de Trujillo', formaPago: 'CONTADO', avance: 80, descuentoNegociadoPct: 8 });
  assert.equal(q.descuento, 200);            // tope 10 % de 2000, no 23 %
  assert.ok(q.avisos.length > 0);
  assert.deepEqual(validarLimites(q), []);
});

test('solo el ajuste negociado que excede el límite bloquea; las reglas automáticas se acotan', () => {
  const soloReglas = cotizar(tarifa, reglas, { universidad: 'Universidad Nacional de Trujillo', formaPago: 'CONTADO', avance: 80 });
  assert.equal(soloReglas.descuento, 200);
  assert.equal(soloReglas.negociadoExcede, false);
  const conNegociado = cotizar(tarifa, reglas, { descuentoNegociadoPct: 12 });
  assert.equal(conNegociado.negociadoExcede, true);
  assert.equal(cotizar(tarifa, reglas, { descuentoNegociadoPct: 8 }).negociadoExcede, false);
});

test('nunca queda por debajo del precio mínimo', () => {
  const t: Tarifa = { tarifaId: 2, precioBase: 1000, precioMinimo: 950, topeDescuentoPct: 15 };
  const q = cotizar(t, reglas, { descuentoNegociadoPct: 15 });
  assert.equal(q.precioFinal, 950);
  assert.deepEqual(validarLimites(q), []);
});

test('el recargo por urgencia aplica solo bajo el umbral de días', () => {
  assert.equal(cotizar(tarifa, reglas, { diasHastaFechaLimite: 10 }).recargo, 300);
  assert.equal(cotizar(tarifa, reglas, { diasHastaFechaLimite: 20 }).recargo, 0);
});

test('validarLimites detecta violaciones', () => {
  const base = { precioBase: 1000, montoExtras: 0, recargo: 0, precioMinimo: 800, topeDescuentoPct: 10 };
  assert.equal(validarLimites({ ...base, descuento: 150 }).length, 1);                   // supera el tope
  assert.equal(validarLimites({ ...base, descuento: 100, precioMinimo: 950 }).length, 1); // bajo el mínimo
});
