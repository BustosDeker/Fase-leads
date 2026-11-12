import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/web/api.js';

test('DELETE no envía Content-Type JSON sin cuerpo', async () => {
  const originalFetch = globalThis.fetch;
  let solicitud: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    solicitud = init;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await api.delete('/api/leads/1');
    assert.equal(solicitud?.method, 'DELETE');
    assert.equal(solicitud?.body, undefined);
    assert.equal(new Headers(solicitud?.headers).has('Content-Type'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('POST conserva el cuerpo y el Content-Type JSON', async () => {
  const originalFetch = globalThis.fetch;
  let solicitud: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    solicitud = init;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await api.post('/api/leads/1/whatsapp', { habilitado: true });
    assert.equal(solicitud?.method, 'POST');
    assert.equal(solicitud?.body, JSON.stringify({ habilitado: true }));
    assert.equal(new Headers(solicitud?.headers).get('Content-Type'), 'application/json');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
