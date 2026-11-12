// Integración de seguimiento: cada prueba crea y limpia su propio escenario.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cerrarPools, oltp, sql } from '../src/db.js';
import { enTransaccion } from '../src/negocio/oportunidad.js';
import { ejecutarSeguimiento } from '../src/agente/seguimiento.js';

process.env.LLM_PROVIDER = 'mock';
process.env.SEGUIMIENTO_DESCARTAR_AUTOMATICO = 'false';
const AHORA = new Date('2026-11-12T15:00:00.000Z'); // 10:00 en Lima

interface Opciones { canal?: 'SIMULADOR' | 'WHATSAPP'; consentimiento?: boolean; controlHumano?: boolean; derivacionPendiente?: boolean; ventanaExpirada?: boolean; intentos?: number }
interface Fixture { contactoId: number; buyerId: number; leadId: number; oportunidadId: number; conversacionId: number; plantillas: Array<{ id: number; aprobada: boolean; fecha: Date | null }> }

async function crearFixture(ahora: Date, o: Opciones = {}): Promise<Fixture> {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const edad = o.intentos && o.intentos >= 2 ? 73 : 25;
  const cliente = new Date(ahora.getTime() - edad * 3600_000);
  const bot = new Date(cliente.getTime() + 60_000);
  const ventana = o.ventanaExpirada ? new Date(cliente.getTime() + 23 * 3600_000) : new Date(ahora.getTime() + 2 * 3600_000);
  const plantillas: Fixture['plantillas'] = [];
  const ids = await enTransaccion(await oltp(), async (tx) => {
    const contacto = await new sql.Request(tx).input('n', sql.VarChar, `Prueba ${sufijo}`).input('a', sql.VarChar, 'Seguimiento')
      .input('cons', sql.Bit, o.consentimiento !== false).query(`
        INSERT dbo.CONTACTO (nombres, apellidos, consentimiento_contacto, fecha_consentimiento, no_contactar, es_demo)
        OUTPUT INSERTED.contacto_id VALUES (@n, @a, @cons, CASE WHEN @cons = 1 THEN SYSDATETIME() ELSE NULL END, 0, 1)`);
    const contactoId = Number(contacto.recordset[0].contacto_id);
    const buyer = await new sql.Request(tx).input('c', sql.Int, contactoId).query("INSERT dbo.BUYER (contacto_id, estado) OUTPUT INSERTED.buyer_id VALUES (@c, 'ACTIVO')");
    const buyerId = Number(buyer.recordset[0].buyer_id);
    const lead = await new sql.Request(tx).input('b', sql.Int, buyerId).query("INSERT dbo.LEAD (buyer_id, prioridad, estado) OUTPUT INSERTED.lead_id VALUES (@b, 'MEDIA', 'EN_NEGOCIACION')");
    const leadId = Number(lead.recordset[0].lead_id);
    const op = await new sql.Request(tx).input('l', sql.Int, leadId).input('f', sql.DateTime2, cliente).query("INSERT dbo.OPORTUNIDAD_COMERCIAL (lead_id, fecha_inicio, estado, es_demo) OUTPUT INSERTED.oportunidad_id VALUES (@l, @f, 'ABIERTA', 1)");
    const oportunidadId = Number(op.recordset[0].oportunidad_id);
    const conv = await new sql.Request(tx).input('c', sql.Int, contactoId).input('o', sql.Int, oportunidadId).input('canal', sql.VarChar, o.canal ?? 'SIMULADOR')
      .input('chat', sql.VarChar, `sim:prueba-${sufijo}`).input('f', sql.DateTime2, ahora).input('v', sql.DateTime2, ventana)
      .input('estado', sql.VarChar, o.controlHumano ? 'DERIVADA' : 'ABIERTA').input('humano', sql.Bit, o.controlHumano ?? false)
      .query(`INSERT dbo.CONVERSACION (contacto_id, oportunidad_id, fecha_inicio, ventana_hasta, estado, canal_mensajeria, chat_id, control_humano)
              OUTPUT INSERTED.conversacion_id VALUES (@c, @o, @f, @v, @estado, @canal, @chat, @humano)`);
    const conversacionId = Number(conv.recordset[0].conversacion_id);
    await new sql.Request(tx).input('c', sql.Int, conversacionId).input('f1', sql.DateTime2, cliente).input('f2', sql.DateTime2, bot).query(`
      INSERT dbo.MENSAJE (conversacion_id, emisor, fecha_hora, tipo, contenido, dentro_ventana) VALUES (@c, 'CLIENTE', @f1, 'TEXTO', 'Necesito orientación para mi tesis.', 1);
      INSERT dbo.MENSAJE (conversacion_id, emisor, fecha_hora, tipo, contenido, dentro_ventana) VALUES (@c, 'BOT', @f2, 'TEXTO', 'Quedo atento a tu respuesta.', 1);`);
    for (let i = 0; i < (o.intentos ?? 0); i++) {
      await new sql.Request(tx).input('l', sql.Int, leadId).input('op', sql.Int, oportunidadId).input('f', sql.DateTime2, new Date(ahora.getTime() - ((o.intentos ?? 0) - i) * 3600_000))
        .query("INSERT dbo.SEGUIMIENTO_LEAD (lead_id, oportunidad_id, fecha_accion, resultado, siguiente_accion) VALUES (@l, @op, @f, 'ENVIADO', 'Esperar respuesta del estudiante')");
    }
    if (o.derivacionPendiente) await new sql.Request(tx).input('c', sql.Int, conversacionId).input('l', sql.Int, leadId)
      .query("INSERT dbo.ESCALAMIENTO (conversacion_id, lead_id, motivo, destino_rol, estado, resumen_entregado) VALUES (@c, @l, 'RIESGO_ABANDONO', 'ESPECIALISTA', 'PENDIENTE', 1)");
    if (o.ventanaExpirada) {
      const p = await new sql.Request(tx).query("SELECT plantilla_msg_id, aprobada_meta, fecha_aprobacion FROM dbo.PLANTILLA_MENSAJE WHERE activa = 1 AND aprobada_meta = 1 AND categoria IN ('PROPUESTA', 'OTRO')");
      for (const x of p.recordset) plantillas.push({ id: Number(x.plantilla_msg_id), aprobada: Boolean(x.aprobada_meta), fecha: x.fecha_aprobacion ? new Date(x.fecha_aprobacion) : null });
      if (plantillas.length) await new sql.Request(tx).query("UPDATE dbo.PLANTILLA_MENSAJE SET aprobada_meta = 0, fecha_aprobacion = NULL WHERE activa = 1 AND aprobada_meta = 1 AND categoria IN ('PROPUESTA', 'OTRO')");
    }
    return { contactoId, buyerId, leadId, oportunidadId, conversacionId };
  });
  return { ...ids, plantillas };
}

async function limpiar(f: Fixture) {
  await enTransaccion(await oltp(), async (tx) => {
    await new sql.Request(tx).input('c', sql.Int, f.conversacionId).input('o', sql.Int, f.oportunidadId).input('l', sql.Int, f.leadId).input('b', sql.Int, f.buyerId).input('ct', sql.Int, f.contactoId).query(`
      DELETE dbo.AGENTE_TURNO WHERE conversacion_id = @c OR oportunidad_id = @o;
      DELETE dbo.ESCALAMIENTO WHERE conversacion_id = @c OR lead_id = @l;
      DELETE dbo.SEGUIMIENTO_LEAD WHERE oportunidad_id = @o OR lead_id = @l;
      DELETE dbo.MENSAJE WHERE conversacion_id = @c;
      DELETE dbo.OPORTUNIDAD_EVENTO WHERE oportunidad_id = @o;
      DELETE dbo.CONVERSACION WHERE conversacion_id = @c;
      DELETE dbo.OPORTUNIDAD_COMERCIAL WHERE oportunidad_id = @o;
      DELETE dbo.LEAD WHERE lead_id = @l;
      DELETE dbo.BUYER WHERE buyer_id = @b;
      DELETE dbo.CONTACTO WHERE contacto_id = @ct;`);
    for (const p of f.plantillas) await new sql.Request(tx).input('p', sql.Int, p.id).input('a', sql.Bit, p.aprobada).input('f', sql.Date, p.fecha)
      .query('UPDATE dbo.PLANTILLA_MENSAJE SET aprobada_meta = @a, fecha_aprobacion = @f WHERE plantilla_msg_id = @p');
  });
}
async function conFixture(ahora: Date, opciones: Opciones, fn: (f: Fixture) => Promise<void>) { const f = await crearFixture(ahora, opciones); try { await fn(f); } finally { await limpiar(f); } }
async function conteos(f: Fixture) {
  const r = await (await oltp()).request().input('c', sql.Int, f.conversacionId).input('o', sql.Int, f.oportunidadId).input('a', sql.DateTime2, AHORA).query(`
    SELECT (SELECT COUNT(*) FROM dbo.MENSAJE WHERE conversacion_id = @c AND emisor = 'BOT' AND fecha_hora >= @a) mensajes,
           (SELECT COUNT(*) FROM dbo.SEGUIMIENTO_LEAD WHERE oportunidad_id = @o) seguimientos,
           (SELECT COUNT(*) FROM dbo.OPORTUNIDAD_EVENTO WHERE oportunidad_id = @o) eventos`);
  return r.recordset[0] as { mensajes: number; seguimientos: number; eventos: number };
}

test('candidato válido recibe recordatorio y registra filas', async () => {
  await conFixture(AHORA, {}, async (f) => { const r = await ejecutarSeguimiento({ ahora: AHORA }); assert.equal(r.enviados, 1); const c = await conteos(f); assert.equal(Number(c.mensajes), 1); assert.equal(Number(c.seguimientos), 1); assert.ok(Number(c.eventos) >= 1); });
});
test('dryRun no escribe', async () => {
  await conFixture(AHORA, {}, async (f) => { const antes = await conteos(f); const r = await ejecutarSeguimiento({ ahora: AHORA, simular: true }); assert.equal(r.enviados, 0); assert.deepEqual(await conteos(f), antes); });
});
test('doble ejecución seguida no duplica el intento', async () => {
  await conFixture(AHORA, {}, async (f) => { const [a, b] = await Promise.all([ejecutarSeguimiento({ ahora: AHORA }), ejecutarSeguimiento({ ahora: AHORA })]); assert.equal(a.enviados + b.enviados, 1); const c = await conteos(f); assert.equal(Number(c.mensajes), 1); assert.equal(Number(c.seguimientos), 1); });
});
test('revocado, control humano y derivación pendiente no reciben', async () => {
  for (const opciones of [{ consentimiento: false }, { controlHumano: true }, { derivacionPendiente: true }]) await conFixture(AHORA, opciones, async (f) => { const r = await ejecutarSeguimiento({ ahora: AHORA }); assert.equal(r.enviados, 0); assert.equal(Number((await conteos(f)).mensajes), 0); });
});
test('fuera de 08:00–21:00 no envía', async () => {
  const fuera = new Date('2026-11-12T08:00:00.000Z');
  await conFixture(fuera, {}, async (f) => { const r = await ejecutarSeguimiento({ ahora: fuera }); assert.equal(r.enviados, 0); const x = await (await oltp()).request().input('o', sql.Int, f.oportunidadId).query("SELECT resultado FROM dbo.SEGUIMIENTO_LEAD WHERE oportunidad_id = @o"); assert.equal(x.recordset[0].resultado, 'PROGRAMADO'); assert.equal(Number((await conteos(f)).mensajes), 0); });
});
test('ventana expirada sin plantilla aprobada bloquea y escala', async () => {
  await conFixture(AHORA, { canal: 'WHATSAPP', ventanaExpirada: true }, async (f) => { const r = await ejecutarSeguimiento({ ahora: AHORA }); assert.equal(r.enviados, 0); const s = await (await oltp()).request().input('o', sql.Int, f.oportunidadId).query("SELECT resultado FROM dbo.SEGUIMIENTO_LEAD WHERE oportunidad_id = @o"); assert.equal(s.recordset[0].resultado, 'BLOQUEADO_VENTANA'); const e = await (await oltp()).request().input('c', sql.Int, f.conversacionId).query("SELECT motivo FROM dbo.ESCALAMIENTO WHERE conversacion_id = @c"); assert.equal(e.recordset[0].motivo, 'RIESGO_ABANDONO'); });
});
test('tras el máximo de intentos escala', async () => {
  await conFixture(AHORA, { intentos: 2 }, async (f) => { const r = await ejecutarSeguimiento({ ahora: AHORA }); assert.equal(r.enviados, 0); const e = await (await oltp()).request().input('c', sql.Int, f.conversacionId).query("SELECT motivo FROM dbo.ESCALAMIENTO WHERE conversacion_id = @c"); assert.equal(e.recordset[0].motivo, 'RIESGO_ABANDONO'); });
});

after(async () => { await cerrarPools(); });
