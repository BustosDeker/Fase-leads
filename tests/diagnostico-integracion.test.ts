// Integración de diagnóstico y aptitud. Se omite si SQL Server o un lead apto para la prueba no están disponibles.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { cargarContexto } from '../src/agente/contexto.js';
import { escalar } from '../src/agente/herramientas.js';
import { calificarAptitud, entregarDiagnostico, faltantesDiagnostico, solicitarDiagnostico } from '../src/negocio/diagnostico.js';
import { enTransaccion } from '../src/negocio/oportunidad.js';
import { cerrarPools, oltp, sql } from '../src/db.js';

let oportunidadId: number | null = null;
let leadId: number | null = null;
let conversacionId: number | null = null;
let disponible = true;

before(async () => {
  try {
    const r = await (await oltp()).request().query(`
      SELECT TOP 1 o.oportunidad_id, o.lead_id, cv.conversacion_id
      FROM dbo.OPORTUNIDAD_COMERCIAL o
      JOIN dbo.CONVERSACION cv ON cv.oportunidad_id = o.oportunidad_id
      JOIN dbo.CONTACTO c ON c.contacto_id = cv.contacto_id
      JOIN dbo.PERFIL_ACADEMICO pa ON pa.contacto_id = c.contacto_id
      WHERE o.estado = 'ABIERTA' AND c.consentimiento_contacto = 1 AND pa.carrera_id IS NOT NULL
      ORDER BY o.oportunidad_id`);
    oportunidadId = r.recordset[0]?.oportunidad_id ?? null;
    leadId = r.recordset[0]?.lead_id ?? null;
    conversacionId = r.recordset[0]?.conversacion_id ?? null;
    if (!oportunidadId) disponible = false;
  } catch { disponible = false; }
});

after(async () => { await cerrarPools(); });

test('faltantesDiagnostico exige los seis mínimos y acepta datos completos', () => {
  assert.deepEqual(faltantesDiagnostico({ tema: null, tipoTesis: null, avance: null, tieneEmpresa: null, limitaciones: null, fechaLimite: null }), [
    'tema de tesis', 'tipo de investigación', 'avance declarado', 'si cuenta con empresa o institución', 'limitaciones', 'fecha límite',
  ]);
  assert.deepEqual(faltantesDiagnostico({ tema: 'Sistema de inventario', tipoTesis: 'APLICADA', avance: 40, tieneEmpresa: false,
    limitaciones: 'Ninguna indicada', fechaLimite: '2026-12-01' }), []);
});

test('entrega diagnóstico, inicia aptitud y revierte la integración completa al terminar', async (t) => {
  if (!disponible) return t.skip('SQL Server o un lead ABIERTA con perfil no disponibles');
  const tx = new sql.Transaction(await oltp());
  await tx.begin();
  try {
    const perfil = await new sql.Request(tx).input('o', sql.Int, oportunidadId).input('l', sql.Int, leadId).query(`
      INSERT dbo.PERFIL_NEGOCIACION (lead_id, oportunidad_id, version, fecha_limite, disponibilidad, completo)
      SELECT @l, @o, ISNULL(MAX(version), 0) + 1, DATEADD(DAY, 30, CAST(SYSDATETIME() AS DATE)), 'tardes', 1
      FROM dbo.PERFIL_NEGOCIACION WHERE oportunidad_id = @o;
      SELECT SCOPE_IDENTITY() AS id;`);
    assert.ok(perfil.recordset[0]);
    const d = await solicitarDiagnostico(tx, { oportunidadId: oportunidadId!, temaTesis: 'Sistema de inventario', tipoTesis: 'APLICADA',
      avanceDeclarado: 40, tieneEmpresaAplicacion: false, limitaciones: 'Ninguna indicada' }, null, 'AGENTE');
    const entregado = await entregarDiagnostico(tx, d.diagnostico_id,
      'Tema: Sistema de inventario; tipo: APLICADA; avance declarado: 40%; empresa o institución: no; limitaciones: Ninguna indicada; fecha límite registrada.',
      'AGENTE', oportunidadId!);
    assert.ok(entregado.fechaEntrega);
    assert.equal(entregado.oportunidadId, oportunidadId);
    await calificarAptitud(tx, oportunidadId!, 'AGENTE');
    const estado = await new sql.Request(tx).input('o', sql.Int, oportunidadId).query('SELECT estado, fecha_apta_cotizar FROM dbo.OPORTUNIDAD_COMERCIAL WHERE oportunidad_id = @o');
    assert.equal(estado.recordset[0].estado, 'APTA_PARA_COTIZAR');
    assert.ok(estado.recordset[0].fecha_apta_cotizar);
  } finally {
    await tx.rollback();
  }
});

test('transiciones inválidas y aptitud sin diagnóstico entregado son rechazadas', async (t) => {
  if (!disponible) return t.skip('SQL Server o un lead ABIERTA con perfil no disponibles');
  const tx = new sql.Transaction(await oltp());
  await tx.begin();
  try {
    await assert.rejects(() => calificarAptitud(tx, oportunidadId!, 'AGENTE'), /diagnóstico entregado|Solo una oportunidad/);
  } finally {
    await tx.rollback();
  }
});

test('la derivación guarda un resumen estructurado de máximo 1000 caracteres', async (t) => {
  if (!disponible) return t.skip('SQL Server o un lead ABIERTA con perfil no disponibles');
  const cx = await cargarContexto(conversacionId!);
  const creado = await escalar(cx, 'CONSULTA_ACADEMICA_COMPLEJA', 'Detalle de prueba '.repeat(100));
  try {
    const r = await (await oltp()).request().input('e', sql.Int, creado.escalamientoId)
      .query('SELECT resumen FROM dbo.ESCALAMIENTO WHERE escalamiento_id = @e');
    assert.ok(r.recordset[0].resumen.length <= 1000);
    assert.match(r.recordset[0].resumen, /Estudiante:|Carrera\/universidad\/etapa:|Tema\/avance:|Motivo:|Último mensaje:/);
  } finally {
    await enTransaccion(await oltp(), (tx) => new sql.Request(tx).input('e', sql.Int, creado.escalamientoId).input('c', sql.Int, conversacionId)
      .input('o', sql.Int, oportunidadId).query(`
        DELETE FROM dbo.ESCALAMIENTO WHERE escalamiento_id = @e;
        DELETE FROM dbo.OPORTUNIDAD_EVENTO WHERE oportunidad_id = @o AND evento = 'ESCALAMIENTO'
          AND detalle LIKE N'Estudiante:%';
        UPDATE dbo.CONVERSACION SET estado = 'ABIERTA', control_humano = 0, resuelta_sin_humano = NULL WHERE conversacion_id = @c`));
  }
});
