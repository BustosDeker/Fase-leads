import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agruparMensajesDebounce, evaluarLimiteTurnos } from '../src/agente/motor.js';
import { borrarResumenMemoria, guardarResumenMemoria, leerResumenMemoria } from '../src/agente/memoria.js';
import { clasificarMultimediaWhatsApp } from '../src/whatsapp/openwa.js';
import { horaPermitidaPeru, horasSeguimiento, intentosPermitidos } from '../src/agente/seguimiento.js';

test('debounce agrupa los mensajes en el orden de llegada', () => {
  assert.equal(agruparMensajesDebounce(['hola', 'quiero asesoría', 'para sistemas']), 'hola\nquiero asesoría\npara sistemas');
});

test('multimedia de WhatsApp se clasifica sin llamar al proveedor', () => {
  assert.deepEqual(clasificarMultimediaWhatsApp('ptt'), { tipo: 'AUDIO', descripcion: '[Nota de voz recibida]' });
  assert.deepEqual(clasificarMultimediaWhatsApp('image'), { tipo: 'ARCHIVO', descripcion: '[Imagen recibida]' });
  assert.deepEqual(clasificarMultimediaWhatsApp('sticker'), { tipo: 'ARCHIVO', descripcion: '[Sticker recibido]' });
  assert.deepEqual(clasificarMultimediaWhatsApp('document'), { tipo: 'ARCHIVO', descripcion: '[Documento recibido]' });
  assert.equal(clasificarMultimediaWhatsApp('chat'), null);
});

test('resumen de memoria se guarda en caché y puede regenerarse', () => {
  guardarResumenMemoria(987654, 'Necesita asesoría de tesis; tono cordial.', 20);
  assert.equal(leerResumenMemoria(987654), 'Necesita asesoría de tesis; tono cordial.');
  borrarResumenMemoria(987654);
  assert.equal(leerResumenMemoria(987654), null);
});

test('límite de turnos elimina fechas antiguas y deriva al alcanzar el máximo', () => {
  const ahora = 10_000_000;
  const r = evaluarLimiteTurnos([ahora - 3_600_001, ahora - 1000, ahora - 500], ahora, 2);
  assert.deepEqual(r.vigentes, [ahora - 1000, ahora - 500]);
  assert.equal(r.excedido, true);
  assert.equal(evaluarLimiteTurnos(r.vigentes, ahora, 3).excedido, false);
});

test('seguimiento usa la cadencia y el máximo configurados', () => {
  const antes = { horas: process.env.SEGUIMIENTO_HORAS, max: process.env.SEGUIMIENTO_MAX_INTENTOS };
  process.env.SEGUIMIENTO_HORAS = '24,72';
  process.env.SEGUIMIENTO_MAX_INTENTOS = '2';
  assert.deepEqual(horasSeguimiento(), [24, 72]);
  assert.equal(intentosPermitidos(), 2);
  if (antes.horas === undefined) delete process.env.SEGUIMIENTO_HORAS; else process.env.SEGUIMIENTO_HORAS = antes.horas;
  if (antes.max === undefined) delete process.env.SEGUIMIENTO_MAX_INTENTOS; else process.env.SEGUIMIENTO_MAX_INTENTOS = antes.max;
});

test('seguimiento respeta 08:00–21:00 de Perú', () => {
  assert.equal(horaPermitidaPeru(new Date('2026-11-12T13:00:00.000Z')), true); // 08:00 Lima
  assert.equal(horaPermitidaPeru(new Date('2026-11-12T02:00:00.000Z')), false); // 21:00 Lima
});
