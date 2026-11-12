// Pruebas de integración con SQL Server (se omiten si no hay conexión).
// - ETL + verificación OLTP <-> data mart (sin valores fijos esperados)
// - Idempotencia del ETL: repetirlo con el mismo @Corte no cambia filas ni sumas
// - Reglas en la BD: transiciones de estado, tope/mínimo de precio, idempotencia de la transferencia
// Al final se restaura el data mart con los parámetros de la última carga previa.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { cerrarPools, mart, oltp, sql } from '../src/db.js';
import { ejecutarEtl, ultimaEjecucionOk } from '../src/etl/ejecutar.js';
import { verificarOltpMart } from '../src/etl/verificar.js';
import type { ParametrosEtl } from '../src/etl/parametros.js';

let disponible = true;
let previo: ParametrosEtl | null = null;
const CORTE: ParametrosEtl = { corte: new Date(2026, 9, 15, 12, 0), wdHoras: 48, wqHoras: 2, waDias: 30, wcDias: 60 };
const opciones = () => ({ skip: disponible ? false : 'SQL Server no disponible (ejecuta npm run db:init)' });

before(async () => {
  try {
    await (await oltp()).request().query('SELECT 1');
    previo = await ultimaEjecucionOk();
  } catch {
    disponible = false;
  }
});

after(async () => {
  if (disponible && previo) await ejecutarEtl(previo, { origen: 'TEST' });
  await cerrarPools();
});

/** Ejecuta `fn` dentro de una transacción que SIEMPRE se revierte. */
async function enTransaccionRevertida(fn: (req: () => sql.Request) => Promise<void>) {
  const tx = new sql.Transaction(await oltp());
  await tx.begin();
  try { await fn(() => new sql.Request(tx)); }
  finally { try { await tx.rollback(); } catch { /* un error de trigger ya revirtió la transacción */ } }
}

async function sumasHechos() {
  const r = await (await mart()).request().query(`
    SELECT (SELECT COUNT(*) FROM dbo.Hecho_Diagnostico) f1, (SELECT COUNT(*) FROM dbo.Hecho_Oportunidad) f2,
           (SELECT COUNT(*) FROM dbo.Hecho_Recuperacion_Objecion) f3,
           (SELECT SUM(diagnostico_solicitud_madura) + 10 * SUM(diagnostico_oportuno) FROM dbo.Hecho_Diagnostico) s1,
           (SELECT SUM(cohorte_madura) + 7 * SUM(conversion_60d) + 3 * SUM(cotizacion_madura) FROM dbo.Hecho_Oportunidad) s2,
           (SELECT SUM(objecion_principal_madura) + 5 * SUM(objecion_recuperada_30d) FROM dbo.Hecho_Recuperacion_Objecion) s3`);
  return r.recordset[0];
}

test('ETL + verificación: el data mart coincide con el OLTP', opciones(), async (t) => {
  if (!disponible) return t.skip('SQL Server no disponible (ejecuta npm run db:init)');
  const r = await ejecutarEtl(CORTE, { origen: 'TEST' });
  assert.ok(r.ok, r.error);
  const v = await verificarOltpMart(CORTE);
  for (const m of v.medidas) assert.equal(m.mart, m.oltp, `${m.medida}: OLTP ${m.oltp} ≠ mart ${m.mart}`);
  for (const c of v.coherencia) assert.equal(c.cumple, 'SI', `${c.regla}: ${c.num} > ${c.den}`);
});

test('ETL idempotente: repetir con el mismo @Corte no cambia filas ni sumas', opciones(), async (t) => {
  if (!disponible) return t.skip('SQL Server no disponible (ejecuta npm run db:init)');
  await ejecutarEtl(CORTE, { origen: 'TEST' });
  const a = await sumasHechos();
  await ejecutarEtl(CORTE, { origen: 'TEST' });
  assert.deepEqual(await sumasHechos(), a);
});

test('la BD rechaza transiciones de estado no permitidas', opciones(), async (t) => {
  if (!disponible) return t.skip('SQL Server no disponible (ejecuta npm run db:init)');
  await enTransaccionRevertida(async (req) => {
    const r = await req().query(`
      INSERT dbo.CONTACTO (nombres, apellidos, es_demo) VALUES (N'Prueba', N'Automática', 1);
      INSERT dbo.BUYER (contacto_id) VALUES (SCOPE_IDENTITY());
      INSERT dbo.LEAD (buyer_id) VALUES (SCOPE_IDENTITY());
      INSERT dbo.OPORTUNIDAD_COMERCIAL (lead_id, fecha_inicio, es_demo) OUTPUT INSERTED.oportunidad_id AS id VALUES (SCOPE_IDENTITY(), SYSDATETIME(), 1);`);
    const id = r.recordset[0].id;
    await req().input('id', sql.Int, id).query(`UPDATE dbo.OPORTUNIDAD_COMERCIAL SET estado = 'EN_DIAGNOSTICO' WHERE oportunidad_id = @id`);
    await assert.rejects(
      req().input('id', sql.Int, id).query(`UPDATE dbo.OPORTUNIDAD_COMERCIAL SET estado = 'PAYER_CONFIRMADO' WHERE oportunidad_id = @id`),
      /no permitida/);
  });
});

test('la BD rechaza descuentos sobre el tope y precios bajo el mínimo', opciones(), async (t) => {
  if (!disponible) return t.skip('SQL Server no disponible (ejecuta npm run db:init)');
  await enTransaccionRevertida(async (req) => {
    const base = await req().query(`SELECT TOP 1 l.lead_id, t.servicio_id FROM dbo.LEAD l CROSS JOIN dbo.TARIFA t`);
    if (!base.recordset.length) return; // sin leads aún
    const { lead_id, servicio_id } = base.recordset[0];
    const insertar = (descuento: number, minimo: number) => req()
      .input('l', sql.Int, lead_id).input('s', sql.Int, servicio_id).input('d', sql.Decimal(10, 2), descuento).input('m', sql.Decimal(10, 2), minimo)
      .query(`INSERT dbo.PROPUESTA (lead_id, servicio_id, precio_base, descuento, precio_minimo_aplicado, tope_descuento_aplicado)
              VALUES (@l, @s, 1000, @d, @m, 10)`);
    await assert.rejects(insertar(150, 0), /CK_PROPUESTA_TOPE/);   // 15 % > tope 10 %
    await assert.rejects(insertar(50, 990), /CK_PROPUESTA_MINIMO/); // 950 < mínimo 990
  });
});

test('la transferencia a PAYERS se emite una sola vez (idempotency_key única)', opciones(), async (t) => {
  if (!disponible) return t.skip('SQL Server no disponible (ejecuta npm run db:init)');
  await enTransaccionRevertida(async (req) => {
    const p = await req().query(`SELECT TOP 1 propuesta_id, oportunidad_id FROM dbo.PROPUESTA WHERE oportunidad_id IS NOT NULL`);
    if (!p.recordset.length) return;
    const { propuesta_id, oportunidad_id } = p.recordset[0];
    const emitir = () => req().input('o', sql.Int, oportunidad_id).input('p', sql.Int, propuesta_id)
      .query(`INSERT dbo.TRANSFERENCIA_PAYER (oportunidad_id, propuesta_id, idempotency_key) VALUES (@o, @p, 'TEST-IDEMPOTENCIA')`);
    await emitir();
    await assert.rejects(emitir(), /UQ_TRANSF_KEY/);
  });
});
