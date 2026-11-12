import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { autorizar } from '../src/server/auth.js';
import { rutasAuth } from '../src/server/auth.js';
import { autenticarSeguimiento, rutasAgente } from '../src/server/rutas-agente.js';

function respuesta() {
  let estado = 200;
  let cuerpo: unknown;
  return { reply: { code: (n: number) => ({ send: (x: unknown) => { estado = n; cuerpo = x; } }) }, estado: () => estado, cuerpo: () => cuerpo };
}

test('seguimiento sin Authorization responde 401', () => {
  const previo = process.env.AGENTE_API_TOKEN;
  process.env.AGENTE_API_TOKEN = 'token-de-prueba';
  try {
    const r = respuesta();
    assert.equal(autenticarSeguimiento({ headers: {} }, r.reply), false);
    assert.equal(r.estado(), 401);
  } finally { process.env.AGENTE_API_TOKEN = previo; }
});

test('seguimiento rechaza token incorrecto', () => {
  const previo = process.env.AGENTE_API_TOKEN;
  process.env.AGENTE_API_TOKEN = 'token-correcto';
  try {
    const r = respuesta();
    assert.equal(autenticarSeguimiento({ headers: { authorization: 'Bearer equivocado' } }, r.reply), false);
    assert.equal(r.estado(), 401);
  } finally { process.env.AGENTE_API_TOKEN = previo; }
});

test('sin AGENTE_API_TOKEN no acepta Bearer vacío ni cualquier cabecera', () => {
  const previo = process.env.AGENTE_API_TOKEN;
  delete process.env.AGENTE_API_TOKEN;
  try {
    for (const authorization of ['', 'Bearer ', 'Bearer cualquier-valor']) {
      const r = respuesta();
      assert.equal(autenticarSeguimiento({ headers: { authorization } }, r.reply), false);
      assert.equal(r.estado(), 401);
    }
  } finally { process.env.AGENTE_API_TOKEN = previo; }
});

test('token correcto pasa la validación de los endpoints de seguimiento', () => {
  const previo = process.env.AGENTE_API_TOKEN;
  process.env.AGENTE_API_TOKEN = 'token-correcto';
  try {
    const r = respuesta();
    assert.equal(autenticarSeguimiento({ headers: { authorization: 'Bearer token-correcto' } }, r.reply), true);
    assert.equal(r.estado(), 200);
  } finally { process.env.AGENTE_API_TOKEN = previo; }
});

test('las demás rutas /api/agente y /api siguen exigiendo sesión', () => {
  assert.deepEqual(autorizar('GET', '/api/agente/estado', null), { ok: false, estado: 401, error: 'Inicia sesión para continuar.' });
  assert.deepEqual(autorizar('GET', '/api/conversaciones', null), { ok: false, estado: 401, error: 'Inicia sesión para continuar.' });
  assert.deepEqual(autorizar('GET', '/api/agente/seguimiento/candidatos', null), { ok: true });
});

test('endpoint de derivaciones valida token y pagina desde_id sin repetir avisos', async () => {
  const anteriores = { token: process.env.AGENTE_API_TOKEN, session: process.env.SESSION_SECRET };
  process.env.AGENTE_API_TOKEN = 'token-derivaciones';
  process.env.SESSION_SECRET = 'secreto-de-prueba-para-tests';
  const app = Fastify();
  const datos = [
    { escalamiento_id: 11, fecha: new Date('2026-01-01T10:00:00Z'), motivo: 'RIESGO_ABANDONO', estudiante: 'Ana Prueba', resumen: 'Pendiente' },
    { escalamiento_id: 12, fecha: new Date('2026-01-01T10:05:00Z'), motivo: 'CLIENTE_PIDE_ESPECIALISTA', estudiante: 'Luis Prueba', resumen: 'Solicitó asesor' },
    { escalamiento_id: 13, fecha: new Date('2026-01-01T10:10:00Z'), motivo: 'BOT_NO_RESPONDE', estudiante: 'Eva Prueba', resumen: null },
  ];
  rutasAuth(app);
  rutasAgente(app, { listarDerivacionesPendientes: async (desde = 0) => datos.filter((x) => x.escalamiento_id > desde).slice(0, 100) });
  try {
    const sinToken = await app.inject({ method: 'GET', url: '/api/agente/derivaciones/pendientes' });
    assert.equal(sinToken.statusCode, 401);
    const conToken = await app.inject({ method: 'GET', url: '/api/agente/derivaciones/pendientes?desde_id=11', headers: { authorization: 'Bearer token-derivaciones' } });
    assert.equal(conToken.statusCode, 200);
    const cuerpo = conToken.json();
    assert.deepEqual(cuerpo.derivaciones.map((x: any) => x.escalamiento_id), [12, 13]);
    assert.equal(cuerpo.siguiente_desde_id, 13);
    const siguiente = await app.inject({ method: 'GET', url: '/api/agente/derivaciones/pendientes?desde_id=13', headers: { authorization: 'Bearer token-derivaciones' } });
    assert.equal(siguiente.statusCode, 200);
    assert.deepEqual(siguiente.json().derivaciones, []);
    assert.equal(siguiente.json().siguiente_desde_id, 13);
  } finally {
    await app.close();
    process.env.AGENTE_API_TOKEN = anteriores.token;
    process.env.SESSION_SECRET = anteriores.session;
  }
});
