// Integración de catálogo, extras y agenda. Se omite si SQL Server no responde.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { cargarContexto } from '../src/agente/contexto.js';
import { ejecutarHerramienta } from '../src/agente/herramientas.js';
import { agendarCita, cambiarEstadoCita, reprogramarCita } from '../src/negocio/agenda.js';
import { cerrarPools, oltp, sql } from '../src/db.js';

let conversacionId: number | null = null;
let disponible = true;

before(async () => {
  try {
    const r = await (await oltp()).request().query(`
      SELECT TOP 1 cv.conversacion_id
      FROM dbo.CONVERSACION cv JOIN dbo.CONTACTO c ON c.contacto_id = cv.contacto_id
      JOIN dbo.PERFIL_ACADEMICO pa ON pa.contacto_id = c.contacto_id
      WHERE cv.oportunidad_id IS NOT NULL AND c.consentimiento_contacto = 1 AND pa.carrera_id IS NOT NULL
      ORDER BY cv.conversacion_id`);
    conversacionId = r.recordset[0]?.conversacion_id ?? null;
    if (!conversacionId) disponible = false;
  } catch { disponible = false; }
});

after(async () => { await cerrarPools(); });

const opciones = () => ({ skip: disponible ? false : 'SQL Server o datos ficticios no disponibles' });

test('consultar_catalogo y detalle_servicio exponen tarifa pública y alcance', opciones(), async (t) => {
  if (!disponible) return t.skip('SQL Server o datos ficticios no disponibles');
  const cx = await cargarContexto(conversacionId!);
  const bitacora: any[] = [];
  const catalogo = JSON.parse(await ejecutarHerramienta(cx, 'consultar_catalogo', {}, bitacora));
  assert.equal(catalogo.ok, true);
  assert.ok(catalogo.servicios.length > 0);
  assert.equal('precio_minimo' in catalogo.servicios[0], false);
  assert.equal('tope_descuento_pct' in catalogo.servicios[0], false);

  const detalle = JSON.parse(await ejecutarHerramienta(cx, 'detalle_servicio', { servicio_id: catalogo.servicios[0].id }, bitacora));
  assert.equal(detalle.ok, true);
  assert.ok(detalle.entregables.length > 0);
  assert.ok(detalle.extras.length > 0);
  assert.ok(detalle.limites_alcance.length > 0);
});

test('simular_cotizacion valida y calcula extras del catálogo', opciones(), async (t) => {
  if (!disponible) return t.skip('SQL Server o datos ficticios no disponibles');
  const cx = await cargarContexto(conversacionId!);
  const bitacora: any[] = [];
  const catalogo = JSON.parse(await ejecutarHerramienta(cx, 'consultar_catalogo', {}, bitacora));
  const detalle = JSON.parse(await ejecutarHerramienta(cx, 'detalle_servicio', { servicio_id: catalogo.servicios[0].id }, bitacora));
  const extra = detalle.extras[0];
  const simulacion = JSON.parse(await ejecutarHerramienta(cx, 'simular_cotizacion', {
    servicio_id: catalogo.servicios[0].id, extras: [{ entregable_id: extra.entregable_id, cantidad: 2 }], forma_pago: 'CUOTAS',
  }, bitacora));
  assert.equal(simulacion.bloqueada, false);
  assert.equal(simulacion.extras_detalle[0].entregable_id, extra.entregable_id);
  assert.equal(simulacion.extras, extra.precio_unidad_extra * 2);
});

test('agenda guarda enlace, reprograma, rechaza solapamiento y cancela', opciones(), async (t) => {
  if (!disponible) return t.skip('SQL Server o datos ficticios no disponibles');
  const cx = await cargarContexto(conversacionId!);
  const antesMeet = process.env.CITA_ENLACE_GOOGLE_MEET;
  process.env.CITA_ENLACE_GOOGLE_MEET = 'https://meet.google.com/sala-prueba';
  try {
    const tx = new sql.Transaction(await oltp());
    await tx.begin();
    try {
      const base = new Date(Date.now() + 365 * 86_400_000);
      base.setHours(10, 0, 0, 0);
      const asesores = await new sql.Request(tx).query("SELECT TOP 1 asesor_id FROM dbo.ASESOR WHERE rol = 'COMERCIAL' AND estado = 'ACTIVO'");
      const asesorId = asesores.recordset[0]?.asesor_id;
      assert.ok(asesorId);
      const a = await agendarCita(tx, { oportunidadId: cx.oportunidadId!, asesorId, inicio: base, duracionMin: 45, medio: 'Google Meet' }, 'AGENTE');
      assert.equal(a.enlace, 'https://meet.google.com/sala-prueba');
      const b = await agendarCita(tx, { oportunidadId: cx.oportunidadId!, asesorId, inicio: new Date(base.getTime() + 2 * 3_600_000), duracionMin: 45, medio: 'Google Meet' }, 'AGENTE');
      const reprogramada = await reprogramarCita(tx, a.citaId, new Date(base.getTime() + 3_600_000), 45, 'AGENTE');
      assert.equal(reprogramada?.enlace, 'https://meet.google.com/sala-prueba');
      await assert.rejects(() => reprogramarCita(tx, a.citaId, new Date(base.getTime() + 2 * 3_600_000), 45, 'AGENTE'), /ya tiene la cita/);
      const cancelada = await cambiarEstadoCita(tx, b.citaId, 'CANCELADA', 'Prueba de integración', 'AGENTE');
      assert.equal(cancelada?.estado, 'CANCELADA');
    } finally {
      try { await tx.rollback(); } catch { /* la transacción de prueba ya pudo revertirse */ }
    }
  } finally {
    if (antesMeet === undefined) delete process.env.CITA_ENLACE_GOOGLE_MEET;
    else process.env.CITA_ENLACE_GOOGLE_MEET = antesMeet;
  }
});
