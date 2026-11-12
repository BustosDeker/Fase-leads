// Elimina SOLO los datos sintéticos (es_demo = 1) y todo lo que depende de ellos, en orden de FK.
// Los contactos reales de la demo (es_demo = 0) y los catálogos no se tocan.
import { mart, oltp, sql } from '../db.js';

const SQL_LIMPIEZA = `
SET XACT_ABORT ON;
SELECT contacto_id INTO #c FROM dbo.CONTACTO WHERE es_demo = 1;
SELECT buyer_id INTO #b FROM dbo.BUYER WHERE contacto_id IN (SELECT contacto_id FROM #c);
SELECT lead_id INTO #l FROM dbo.LEAD WHERE buyer_id IN (SELECT buyer_id FROM #b);
SELECT oportunidad_id INTO #o FROM dbo.OPORTUNIDAD_COMERCIAL WHERE es_demo = 1 OR lead_id IN (SELECT lead_id FROM #l);
SELECT conversacion_id INTO #cv FROM dbo.CONVERSACION WHERE contacto_id IN (SELECT contacto_id FROM #c);
SELECT propuesta_id INTO #p FROM dbo.PROPUESTA WHERE lead_id IN (SELECT lead_id FROM #l) OR oportunidad_id IN (SELECT oportunidad_id FROM #o);

DELETE dbo.AGENTE_TURNO WHERE conversacion_id IN (SELECT conversacion_id FROM #cv) OR oportunidad_id IN (SELECT oportunidad_id FROM #o);
DELETE dbo.ESCALAMIENTO WHERE conversacion_id IN (SELECT conversacion_id FROM #cv) OR lead_id IN (SELECT lead_id FROM #l)
                           OR oportunidad_id IN (SELECT oportunidad_id FROM #o);
DELETE dbo.MENSAJE WHERE conversacion_id IN (SELECT conversacion_id FROM #cv);
DELETE dbo.OPORTUNIDAD_EVENTO WHERE oportunidad_id IN (SELECT oportunidad_id FROM #o);
DELETE dbo.CITA_HISTORIAL WHERE cita_id IN (SELECT cita_id FROM dbo.CITA_VIRTUAL WHERE oportunidad_id IN (SELECT oportunidad_id FROM #o));
DELETE dbo.CITA_VIRTUAL WHERE oportunidad_id IN (SELECT oportunidad_id FROM #o);
DELETE dbo.CONVERSION_PAYER_REF WHERE oportunidad_id IN (SELECT oportunidad_id FROM #o);
DELETE dbo.TRANSFERENCIA_PAYER WHERE oportunidad_id IN (SELECT oportunidad_id FROM #o) OR propuesta_id IN (SELECT propuesta_id FROM #p);
DELETE dbo.SEGUIMIENTO_LEAD WHERE lead_id IN (SELECT lead_id FROM #l) OR propuesta_id IN (SELECT propuesta_id FROM #p);
DELETE dbo.OBJECION WHERE propuesta_id IN (SELECT propuesta_id FROM #p);
DELETE dbo.RESPUESTA_PROPUESTA WHERE propuesta_id IN (SELECT propuesta_id FROM #p);
DELETE dbo.PROPUESTA_AJUSTE WHERE propuesta_id IN (SELECT propuesta_id FROM #p);
DELETE dbo.PROPUESTA_ENTREGABLE WHERE propuesta_id IN (SELECT propuesta_id FROM #p);
DELETE dbo.PROPUESTA WHERE propuesta_id IN (SELECT propuesta_id FROM #p);
DELETE dbo.DIAGNOSTICO WHERE lead_id IN (SELECT lead_id FROM #l);
DELETE dbo.PERFIL_NEGOCIACION WHERE lead_id IN (SELECT lead_id FROM #l);
DELETE dbo.RESPONSABLE_PAGO WHERE lead_id IN (SELECT lead_id FROM #l);
DELETE dbo.CONVERSACION WHERE conversacion_id IN (SELECT conversacion_id FROM #cv);
DELETE dbo.OPORTUNIDAD_COMERCIAL WHERE oportunidad_id IN (SELECT oportunidad_id FROM #o);
DELETE dbo.LEAD WHERE lead_id IN (SELECT lead_id FROM #l);
DELETE dbo.INTERACCION_CAPTACION WHERE buyer_id IN (SELECT buyer_id FROM #b);
DELETE dbo.DESCARGA_CONTENIDO WHERE buyer_id IN (SELECT buyer_id FROM #b);
DELETE dbo.SEGUIMIENTO_BUYER WHERE buyer_id IN (SELECT buyer_id FROM #b);
DELETE dbo.BUYER WHERE buyer_id IN (SELECT buyer_id FROM #b);
UPDATE dbo.PERFIL_ACADEMICO SET recomendado_por_contacto_id = NULL WHERE recomendado_por_contacto_id IN (SELECT contacto_id FROM #c);
DELETE dbo.PERFIL_ACADEMICO WHERE contacto_id IN (SELECT contacto_id FROM #c);
DELETE dbo.CONSENTIMIENTO_HISTORIAL WHERE contacto_id IN (SELECT contacto_id FROM #c);
DELETE dbo.CONTACTO WHERE contacto_id IN (SELECT contacto_id FROM #c);
SELECT contactos = (SELECT COUNT(*) FROM #c), oportunidades = (SELECT COUNT(*) FROM #o);`;

export async function limpiarDatosDemo(): Promise<{ contactos: number; oportunidades: number }> {
  const tx = new sql.Transaction(await oltp());
  await tx.begin();
  try {
    const r = await new sql.Request(tx).query(SQL_LIMPIEZA);
    await tx.commit();
    return r.recordset[0];
  } catch (e) {
    try { await tx.rollback(); } catch { /* conservar el error original */ }
    throw e;
  }
}

/**
 * Vacía hechos y dimensiones del data mart (es 100 % derivado del OLTP). Se usa tras borrar datos
 * sintéticos: el MERGE del Anexo C solo inserta miembros, y sin esto quedarían estudiantes huérfanos.
 * La bitácora ETL_EJECUCION se conserva. El siguiente `npm run etl` reconstruye todo.
 */
export async function vaciarDataMart(): Promise<void> {
  await (await mart()).request().query(`
    DELETE dbo.Hecho_Recuperacion_Objecion; DELETE dbo.Hecho_Oportunidad; DELETE dbo.Hecho_Diagnostico;
    DELETE dbo.Dim_Objecion; DELETE dbo.Dim_Canal_Captacion; DELETE dbo.Dim_Asesor; DELETE dbo.Dim_Servicio;
    DELETE dbo.Dim_Investigacion; DELETE dbo.Dim_Ubicacion; DELETE dbo.Dim_Estudiante; DELETE dbo.Dim_Tiempo;`);
}

export async function contarDatosDemo(): Promise<number> {
  const r = await (await oltp()).request().query('SELECT COUNT(*) AS n FROM dbo.CONTACTO WHERE es_demo = 1');
  return r.recordset[0].n;
}
