import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { proveedorGroq } from '../src/agente/proveedores/groq.js';
import type { PeticionAgente } from '../src/agente/tipos.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function peticion(historial: PeticionAgente['historial'] = [{ rol: 'user', texto: 'Consulta del estudiante' }]): PeticionAgente {
  return {
    sistema: 'Reglas', contexto: 'Contexto', historial, sospechaInyeccion: false, datos: {} as any,
    herramientas: [{ nombre: 'consultar_catalogo', descripcion: 'Consulta el catálogo', esquema: { type: 'object', properties: { carrera: { type: 'string' } } } }],
    ejecutar: async (_nombre, entrada) => JSON.stringify({ ok: true, entrada }),
  };
}

test('Groq usa endpoint compatible, tools y lee tool_calls', async () => {
  const cuerpos: any[] = [];
  let llamada = 0;
  globalThis.fetch = (async (_url, init) => {
    cuerpos.push(JSON.parse(String(init?.body)));
    llamada++;
    if (llamada === 1) return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'consultar_catalogo', arguments: '{"carrera":"sistemas"}' } }] } }], usage: { prompt_tokens: 10, completion_tokens: 3 } }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Respuesta basada en la herramienta.' } }], usage: { prompt_tokens: 12, completion_tokens: 5 } }), { status: 200 });
  }) as typeof fetch;
  const p = proveedorGroq('gsk-prueba-no-real', 'llama-3.3-70b-versatile');
  const respuesta = await p.responder(peticion());
  assert.equal(respuesta, 'Respuesta basada en la herramienta.');
  assert.equal(llamada, 2);
  assert.equal(cuerpos[0].model, 'llama-3.3-70b-versatile');
  assert.equal(cuerpos[0].tools[0].function.name, 'consultar_catalogo');
  assert.equal(cuerpos[0].tool_choice, 'auto');
  assert.equal('response_format' in cuerpos[0], false);
  assert.equal(cuerpos[1].messages.at(-1).role, 'tool');
  assert.deepEqual(p.uso, { entrada: 22, salida: 8, total: 30 });
});

test('Groq reintenta 429 hasta dos veces y conserva retry-after', async () => {
  let llamadas = 0;
  const esperas: number[] = [];
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: (...args: any[]) => void, ms?: number, ...args: any[]) => { esperas.push(Number(ms)); fn(...args); return 0 as any; }) as typeof setTimeout;
  globalThis.fetch = (async () => {
    llamadas++;
    if (llamadas < 3) return new Response('limitado', { status: 429, headers: { 'retry-after': '7' } });
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: {} }), { status: 200 });
  }) as typeof fetch;
  try {
    await proveedorGroq('gsk-prueba-no-real', 'llama-3.3-70b-versatile').responder(peticion());
  } finally { globalThis.setTimeout = originalSetTimeout; }
  assert.equal(llamadas, 3);
  assert.deepEqual(esperas, [7000, 7000]);
});

test('Groq recorta el historial una vez ante límite de tokens', async () => {
  const cuerpos: any[] = [];
  let llamadas = 0;
  globalThis.fetch = (async (_url, init) => {
    cuerpos.push(JSON.parse(String(init?.body)));
    llamadas++;
    if (llamadas === 1) return new Response('demasiados tokens', { status: 413 });
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'historial recortado' } }], usage: {} }), { status: 200 });
  }) as typeof fetch;
  const h = Array.from({ length: 20 }, (_, i) => ({ rol: i % 2 ? 'assistant' as const : 'user' as const, texto: `mensaje ${i}` }));
  const respuesta = await proveedorGroq('gsk-prueba-no-real', 'llama-3.3-70b-versatile').responder(peticion(h));
  assert.equal(respuesta, 'historial recortado');
  assert.equal(llamadas, 2);
  assert.ok(cuerpos[1].messages.length < cuerpos[0].messages.length);
});

test('el error HTTP de Groq no expone la clave ni el cuerpo', async () => {
  const clave = 'gsk_super_secreta_no_debe_aparecer';
  globalThis.fetch = (async () => new Response(`body privado ${clave}`, { status: 401 })) as typeof fetch;
  await assert.rejects(
    () => proveedorGroq(clave, 'llama-3.3-70b-versatile').responder(peticion()),
    (e: any) => e.message === 'Groq respondió HTTP 401.' && !e.message.includes(clave) && !e.message.includes('body privado'),
  );
});

test('argumentos de herramienta mal formados vuelven como validación al modelo', async () => {
  let llamada = 0;
  let entradaRecibida: unknown;
  globalThis.fetch = (async () => {
    llamada++;
    if (llamada === 1) return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call_mal', type: 'function', function: { name: 'consultar_catalogo', arguments: '{mal formado' } }] } }], usage: {} }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Necesito corregir los datos.' } }], usage: {} }), { status: 200 });
  }) as typeof fetch;
  const respuesta = await proveedorGroq('gsk-prueba-no-real', 'llama-3.3-70b-versatile').responder({
    ...peticion(), ejecutar: async (_nombre, entrada) => { entradaRecibida = entrada; return JSON.stringify({ ok: false, error: 'Entrada inválida' }); },
  });
  assert.equal(respuesta, 'Necesito corregir los datos.');
  assert.deepEqual(entradaRecibida, {});
});
