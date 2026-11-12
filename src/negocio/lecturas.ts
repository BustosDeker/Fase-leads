// Consultas de lectura del OLTP para las pantallas operativas de LEADS (todas parametrizadas).
import { oltp, sql } from '../db.js';

const rs = (r: sql.IResult<any>) => r.recordsets as sql.IRecordSet<any>[];

/** Autocompletado: por nombre, apellido, WhatsApp, o identificador (lead, buyer, contacto, oportunidad). */
export async function buscarLeads(texto: string) {
  const t = texto.trim();
  const num = /^\d{1,9}$/.test(t) ? Number(t) : null;
  const r = await (await oltp()).request().input('t', sql.NVarChar, `%${t}%`).input('n', sql.Int, num).query(`
    SELECT TOP 12 l.lead_id, l.buyer_id, co.contacto_id, co.nombres, co.apellidos, co.whatsapp, co.whatsapp_habilitado,
           co.consentimiento_contacto, co.no_contactar, co.es_demo, ca.nombre AS carrera,
           (SELECT TOP 1 estado FROM dbo.OPORTUNIDAD_COMERCIAL o WHERE o.lead_id = l.lead_id ORDER BY o.fecha_inicio DESC) AS estado
    FROM dbo.LEAD l JOIN dbo.BUYER b ON b.buyer_id = l.buyer_id JOIN dbo.CONTACTO co ON co.contacto_id = b.contacto_id
    LEFT JOIN dbo.PERFIL_ACADEMICO pa ON pa.contacto_id = co.contacto_id LEFT JOIN dbo.CARRERA ca ON ca.carrera_id = pa.carrera_id
    WHERE (co.nombres + ' ' + co.apellidos) LIKE @t OR co.whatsapp LIKE @t
       OR (@n IS NOT NULL AND (l.lead_id = @n OR l.buyer_id = @n OR co.contacto_id = @n
           OR EXISTS (SELECT 1 FROM dbo.OPORTUNIDAD_COMERCIAL o WHERE o.lead_id = l.lead_id AND o.oportunidad_id = @n)))
    ORDER BY co.es_demo, co.apellidos, co.nombres`);
  return r.recordset;
}

/** Ficha nominal completa (bloques de la tabla 5 del informe). */
export async function fichaNominal(leadId: number) {
  const r = await (await oltp()).request().input('l', sql.Int, leadId).query(`
    -- 0 identidad + lead + perfil académico + canal de origen (BUYERS: solo lectura)
    SELECT l.lead_id, l.buyer_id, l.fecha_lead, l.prioridad, l.estado AS estado_lead,
           co.contacto_id, co.nombres, co.apellidos, co.whatsapp, co.correo, co.consentimiento_contacto, co.fecha_consentimiento,
           co.no_contactar, co.fecha_revocacion, co.estado AS estado_contacto, co.es_demo, co.whatsapp_habilitado,
           u.nombre AS universidad, u.tipo AS tipo_universidad, ca.nombre AS carrera, ca.facultad, pa.sede, pa.ciclo, pa.etapa_academica,
           pa.tipo_investigacion, pa.avance,
           cn.nombre AS canal, cn.tipo AS tipo_canal, cn.plataforma, cp.nombre AS campania, si.nombre AS servicio_interes,
           b.necesidad_inicial, b.fecha_buyer
    FROM dbo.LEAD l JOIN dbo.BUYER b ON b.buyer_id = l.buyer_id JOIN dbo.CONTACTO co ON co.contacto_id = b.contacto_id
    LEFT JOIN dbo.PERFIL_ACADEMICO pa ON pa.contacto_id = co.contacto_id
    LEFT JOIN dbo.UNIVERSIDAD u ON u.universidad_id = pa.universidad_id LEFT JOIN dbo.CARRERA ca ON ca.carrera_id = pa.carrera_id
    LEFT JOIN dbo.CANAL cn ON cn.canal_id = b.canal_captacion_id LEFT JOIN dbo.CAMPANIA cp ON cp.campania_id = b.campania_id
    LEFT JOIN dbo.SERVICIO si ON si.servicio_id = b.servicio_interes_id
    WHERE l.lead_id = @l;
    -- 1 oportunidades
    SELECT o.oportunidad_id, o.estado, o.fecha_inicio, o.fecha_apta_cotizar, o.fecha_cierre, o.motivo_cierre, o.es_demo,
           ISNULL(a.nombre, 'Agente IA') AS responsable
    FROM dbo.OPORTUNIDAD_COMERCIAL o LEFT JOIN dbo.ASESOR a ON a.asesor_id = o.asesor_responsable_id
    WHERE o.lead_id = @l ORDER BY o.fecha_inicio DESC;
    -- 2 perfil de negociación (versionado)
    SELECT perfil_negociacion_id, oportunidad_id, version, disponibilidad, horario, fecha_limite, nivel_confianza,
           necesidad_acompanamiento, presupuesto_orientativo, completo, fecha_registro
    FROM dbo.PERFIL_NEGOCIACION WHERE lead_id = @l ORDER BY fecha_registro DESC;
    -- 3 diagnósticos
    SELECT d.diagnostico_id, d.oportunidad_id, d.fecha_solicitud, d.fecha_entrega, d.estado, d.tema_tesis, d.tipo_tesis,
           d.avance_declarado, d.limitaciones, d.tiene_empresa_aplicacion, d.requiere_derivacion, d.resumen, ISNULL(a.nombre, 'Agente IA') AS asesor
    FROM dbo.DIAGNOSTICO d LEFT JOIN dbo.ASESOR a ON a.asesor_id = d.asesor_id WHERE d.lead_id = @l ORDER BY d.fecha_solicitud DESC;
    -- 4 responsable de pago / decisión
    SELECT responsable_pago_id, tipo_responsable, tipo_relacion, segmento, nombre, participa_decision FROM dbo.RESPONSABLE_PAGO WHERE lead_id = @l;
    -- 5 propuestas
    SELECT p.propuesta_id, p.oportunidad_id, p.version, p.fecha_presentacion, p.precio_base, p.monto_extras, p.recargo, p.descuento,
           p.precio_final, p.precio_minimo_aplicado, p.tope_descuento_aplicado, p.vigencia_hasta, p.estado, p.generada_por, s.nombre AS servicio
    FROM dbo.PROPUESTA p JOIN dbo.SERVICIO s ON s.servicio_id = p.servicio_id WHERE p.lead_id = @l ORDER BY p.oportunidad_id, p.version;
    -- 6 respuestas
    SELECT r.respuesta_id, r.propuesta_id, r.fecha_respuesta, r.tipo_respuesta, r.observacion
    FROM dbo.RESPUESTA_PROPUESTA r JOIN dbo.PROPUESTA p ON p.propuesta_id = r.propuesta_id WHERE p.lead_id = @l ORDER BY r.fecha_respuesta;
    -- 7 objeciones
    SELECT ob.objecion_id, ob.propuesta_id, p.oportunidad_id, p.version, ob.grupo, ob.tipo, ob.descripcion, ob.fecha_registro,
           ob.veces_repetida, ob.escalada, ob.estado, ob.resultado, ob.respuesta_agente
    FROM dbo.OBJECION ob JOIN dbo.PROPUESTA p ON p.propuesta_id = ob.propuesta_id WHERE p.lead_id = @l ORDER BY ob.fecha_registro;
    -- 8 escalamientos
    SELECT e.escalamiento_id, e.oportunidad_id, e.fecha, e.motivo, e.destino_rol, e.estado, e.fecha_atencion, e.resumen, a.nombre AS asesor
    FROM dbo.ESCALAMIENTO e LEFT JOIN dbo.ASESOR a ON a.asesor_id = e.asesor_id WHERE e.lead_id = @l ORDER BY e.fecha DESC;
    -- 9 citas
    SELECT c.cita_id, c.oportunidad_id, c.inicio, c.fin, c.medio, c.estado, a.nombre AS asesor
    FROM dbo.CITA_VIRTUAL c JOIN dbo.OPORTUNIDAD_COMERCIAL o ON o.oportunidad_id = c.oportunidad_id LEFT JOIN dbo.ASESOR a ON a.asesor_id = c.asesor_id
    WHERE o.lead_id = @l ORDER BY c.inicio DESC;
    -- 10 seguimientos
    SELECT s.seguimiento_lead_id, s.oportunidad_id, s.fecha_accion, s.resultado, s.siguiente_accion, ISNULL(a.nombre, 'Agente IA') AS responsable
    FROM dbo.SEGUIMIENTO_LEAD s LEFT JOIN dbo.ASESOR a ON a.asesor_id = s.asesor_id WHERE s.lead_id = @l ORDER BY s.fecha_accion DESC;
    -- 11 transferencias y conversiones
    SELECT t.transferencia_id, t.oportunidad_id, t.propuesta_id, t.fecha_envio, t.estado, t.idempotency_key,
           c.event_id, c.fecha_confirmacion
    FROM dbo.TRANSFERENCIA_PAYER t JOIN dbo.OPORTUNIDAD_COMERCIAL o ON o.oportunidad_id = t.oportunidad_id
    LEFT JOIN dbo.CONVERSION_PAYER_REF c ON c.oportunidad_id = t.oportunidad_id WHERE o.lead_id = @l;
    -- 12 línea de tiempo
    SELECT e.evento_id, e.oportunidad_id, e.fecha, e.estado_anterior, e.estado_nuevo, e.evento, e.origen, e.detalle
    FROM dbo.OPORTUNIDAD_EVENTO e JOIN dbo.OPORTUNIDAD_COMERCIAL o ON o.oportunidad_id = e.oportunidad_id
    WHERE o.lead_id = @l ORDER BY e.fecha DESC, e.evento_id DESC;
    -- 13 consentimiento
    SELECT h.consentimiento_id, h.fecha, h.accion, h.medio, h.finalidad, h.evidencia
    FROM dbo.CONSENTIMIENTO_HISTORIAL h JOIN dbo.BUYER b ON b.contacto_id = h.contacto_id JOIN dbo.LEAD l ON l.buyer_id = b.buyer_id
    WHERE l.lead_id = @l ORDER BY h.fecha DESC;`);
  const x = rs(r);
  if (!x[0][0]) return null;
  return {
    persona: x[0][0], oportunidades: x[1], perfiles: x[2], diagnosticos: x[3], responsables: x[4], propuestas: x[5],
    respuestas: x[6], objeciones: x[7], escalamientos: x[8], citas: x[9], seguimientos: x[10], transferencias: x[11],
    eventos: x[12], consentimientos: x[13],
  };
}

/** Pipeline: todas las oportunidades con datos para el kanban. */
export async function pipeline() {
  const r = await (await oltp()).request().query(`
    SELECT o.oportunidad_id, o.lead_id, o.estado, o.fecha_inicio, o.es_demo, co.nombres + ' ' + co.apellidos AS estudiante,
           ISNULL(a.nombre, 'Agente IA') AS responsable, cn.nombre AS canal, ca.nombre AS carrera,
           CASE WHEN pa.etapa_academica IN ('CICLO_IX','CICLO_X') THEN 'Ciclos IX–X' WHEN pa.etapa_academica = 'EGRESADO' THEN 'Egresado'
                WHEN pa.etapa_academica = 'BACHILLER' THEN 'Bachiller' ELSE 'Sin perfil' END AS grupo_etapa,
           (SELECT MAX(fecha) FROM dbo.OPORTUNIDAD_EVENTO e WHERE e.oportunidad_id = o.oportunidad_id AND e.estado_nuevo IS NOT NULL) AS desde,
           (SELECT TOP 1 precio_final FROM dbo.PROPUESTA p WHERE p.oportunidad_id = o.oportunidad_id ORDER BY version DESC) AS precio,
           (SELECT MAX(version) FROM dbo.PROPUESTA p WHERE p.oportunidad_id = o.oportunidad_id) AS version
    FROM dbo.OPORTUNIDAD_COMERCIAL o JOIN dbo.LEAD l ON l.lead_id = o.lead_id JOIN dbo.BUYER b ON b.buyer_id = l.buyer_id
    JOIN dbo.CONTACTO co ON co.contacto_id = b.contacto_id LEFT JOIN dbo.ASESOR a ON a.asesor_id = o.asesor_responsable_id
    LEFT JOIN dbo.CANAL cn ON cn.canal_id = b.canal_captacion_id
    LEFT JOIN dbo.PERFIL_ACADEMICO pa ON pa.contacto_id = co.contacto_id LEFT JOIN dbo.CARRERA ca ON ca.carrera_id = pa.carrera_id
    ORDER BY o.fecha_inicio DESC`);
  return r.recordset;
}

/** Diagnósticos con su plazo (semáforo de 48 h por defecto). */
export async function diagnosticos(plazoHoras: number) {
  const r = await (await oltp()).request().input('h', sql.Int, plazoHoras).query(`
    SELECT d.diagnostico_id, d.oportunidad_id, d.lead_id, d.fecha_solicitud, d.fecha_entrega, d.estado, d.tema_tesis, d.tipo_tesis,
           d.requiere_derivacion, ISNULL(a.nombre, 'Agente IA') AS asesor, co.nombres + ' ' + co.apellidos AS estudiante, o.estado AS estado_oportunidad,
           DATEDIFF(MINUTE, d.fecha_solicitud, ISNULL(d.fecha_entrega, SYSDATETIME())) / 60.0 AS horas,
           CASE WHEN d.fecha_entrega IS NOT NULL AND d.fecha_entrega <= DATEADD(HOUR, @h, d.fecha_solicitud) THEN 'A_TIEMPO'
                WHEN d.fecha_entrega IS NOT NULL THEN 'TARDE'
                WHEN SYSDATETIME() <= DATEADD(HOUR, @h, d.fecha_solicitud) THEN 'EN_PLAZO' ELSE 'VENCIDO' END AS situacion
    FROM dbo.DIAGNOSTICO d LEFT JOIN dbo.ASESOR a ON a.asesor_id = d.asesor_id
    JOIN dbo.OPORTUNIDAD_COMERCIAL o ON o.oportunidad_id = d.oportunidad_id JOIN dbo.LEAD l ON l.lead_id = d.lead_id
    JOIN dbo.BUYER b ON b.buyer_id = l.buyer_id JOIN dbo.CONTACTO co ON co.contacto_id = b.contacto_id
    ORDER BY CASE WHEN d.fecha_entrega IS NULL THEN 0 ELSE 1 END, d.fecha_solicitud DESC`);
  return r.recordset;
}

export async function objecionesYEscalamientos() {
  const r = await (await oltp()).request().query(`
    SELECT ob.objecion_id, ob.grupo, ob.tipo, ob.fecha_registro, ob.veces_repetida, ob.escalada, ob.estado, ob.resultado, ob.respuesta_agente,
           p.oportunidad_id, p.lead_id, p.version, co.nombres + ' ' + co.apellidos AS estudiante
    FROM dbo.OBJECION ob JOIN dbo.PROPUESTA p ON p.propuesta_id = ob.propuesta_id JOIN dbo.LEAD l ON l.lead_id = p.lead_id
    JOIN dbo.BUYER b ON b.buyer_id = l.buyer_id JOIN dbo.CONTACTO co ON co.contacto_id = b.contacto_id
    ORDER BY ob.fecha_registro DESC;
    SELECT e.escalamiento_id, e.oportunidad_id, e.lead_id, e.fecha, e.motivo, e.destino_rol, e.estado, e.fecha_atencion, e.resumen,
           a.nombre AS asesor, co.nombres + ' ' + co.apellidos AS estudiante
    FROM dbo.ESCALAMIENTO e LEFT JOIN dbo.ASESOR a ON a.asesor_id = e.asesor_id LEFT JOIN dbo.LEAD l ON l.lead_id = e.lead_id
    LEFT JOIN dbo.BUYER b ON b.buyer_id = l.buyer_id LEFT JOIN dbo.CONTACTO co ON co.contacto_id = b.contacto_id
    ORDER BY CASE WHEN e.fecha_atencion IS NULL THEN 0 ELSE 1 END, e.fecha DESC;
    SELECT grupo, tipo, palabras_clave, respuesta_base, criterio_escalamiento, max_repeticiones, activo FROM dbo.CATALOGO_OBJECION ORDER BY grupo;`);
  const x = rs(r);
  return { objeciones: x[0], escalamientos: x[1], catalogo: x[2] };
}

export async function consentimientos() {
  const r = await (await oltp()).request().query(`
    SELECT co.contacto_id, l.lead_id, co.nombres + ' ' + co.apellidos AS nombre, co.whatsapp, co.consentimiento_contacto,
           co.fecha_consentimiento, co.no_contactar, co.fecha_revocacion, co.estado, co.es_demo,
           (SELECT COUNT(*) FROM dbo.CONSENTIMIENTO_HISTORIAL h WHERE h.contacto_id = co.contacto_id) AS registros
    FROM dbo.CONTACTO co LEFT JOIN dbo.BUYER b ON b.contacto_id = co.contacto_id LEFT JOIN dbo.LEAD l ON l.buyer_id = b.buyer_id
    ORDER BY co.no_contactar DESC, co.apellidos`);
  return r.recordset;
}

export async function agenda(desde: Date, hasta: Date) {
  const r = await (await oltp()).request().input('d', sql.DateTime2, desde).input('h', sql.DateTime2, hasta).query(`
    SELECT c.cita_id, c.oportunidad_id, o.lead_id, c.asesor_id, a.nombre AS asesor, c.inicio, c.fin, c.medio, c.estado,
           co.nombres + ' ' + co.apellidos AS estudiante,
           CASE WHEN c.estado <> 'CANCELADA' AND EXISTS (SELECT 1 FROM dbo.CITA_VIRTUAL x WHERE x.asesor_id = c.asesor_id
                AND x.cita_id <> c.cita_id AND x.estado <> 'CANCELADA' AND x.inicio < c.fin AND c.inicio < x.fin) THEN 1 ELSE 0 END AS solapada
    FROM dbo.CITA_VIRTUAL c JOIN dbo.OPORTUNIDAD_COMERCIAL o ON o.oportunidad_id = c.oportunidad_id
    JOIN dbo.LEAD l ON l.lead_id = o.lead_id JOIN dbo.BUYER b ON b.buyer_id = l.buyer_id JOIN dbo.CONTACTO co ON co.contacto_id = b.contacto_id
    LEFT JOIN dbo.ASESOR a ON a.asesor_id = c.asesor_id
    WHERE c.inicio >= @d AND c.inicio < @h ORDER BY c.inicio;
    SELECT asesor_id, nombre, rol FROM dbo.ASESOR WHERE estado = 'ACTIVO' ORDER BY nombre;
    SELECT MIN(inicio) AS primera, MAX(inicio) AS ultima FROM dbo.CITA_VIRTUAL;`);
  const x = rs(r);
  return { citas: x[0], asesores: x[1], rango: x[2][0] };
}

/** Auditoría operativa R4 (sección 4.14.4 del informe), sobre el OLTP. Mismas reglas que el Anexo D, parte 2. */
export async function auditoria() {
  const r = await (await oltp()).request().query(`
    SELECT a.asesor_id, s.nombre AS asesor, a.cita_id AS cita_1, b.cita_id AS cita_2, a.inicio, a.fin, a.estado AS estado_1, b.estado AS estado_2,
           a.oportunidad_id AS oportunidad_1, b.oportunidad_id AS oportunidad_2
    FROM dbo.CITA_VIRTUAL a INNER JOIN dbo.CITA_VIRTUAL b
         ON b.asesor_id = a.asesor_id AND b.cita_id > a.cita_id AND a.inicio < b.fin AND b.inicio < a.fin
    LEFT JOIN dbo.ASESOR s ON s.asesor_id = a.asesor_id
    WHERE a.estado <> 'CANCELADA' AND b.estado <> 'CANCELADA';
    SELECT p.propuesta_id, p.oportunidad_id, p.lead_id, p.version, p.fecha_presentacion, p.vigencia_hasta, p.estado, p.precio_final
    FROM dbo.PROPUESTA p LEFT JOIN dbo.RESPUESTA_PROPUESTA r ON r.propuesta_id = p.propuesta_id
    WHERE r.respuesta_id IS NULL ORDER BY p.fecha_presentacion DESC;
    SELECT propuesta_id, oportunidad_id, lead_id, precio_base, descuento, tope_descuento_aplicado, precio_final, precio_minimo_aplicado
    FROM dbo.PROPUESTA
    WHERE descuento > precio_base * tope_descuento_aplicado / 100.0 OR precio_final < precio_minimo_aplicado;
    SELECT e.escalamiento_id, e.oportunidad_id, e.lead_id, e.fecha, e.motivo, e.destino_rol, e.resumen
    FROM dbo.ESCALAMIENTO e WHERE e.fecha_atencion IS NULL ORDER BY e.fecha;
    SELECT t.oportunidad_id, o.lead_id, t.propuesta_id, t.fecha_envio, t.estado, DATEDIFF(DAY, t.fecha_envio, SYSDATETIME()) AS dias
    FROM dbo.TRANSFERENCIA_PAYER t JOIN dbo.OPORTUNIDAD_COMERCIAL o ON o.oportunidad_id = t.oportunidad_id
    LEFT JOIN dbo.CONVERSION_PAYER_REF c ON c.oportunidad_id = t.oportunidad_id
    WHERE c.conversion_id IS NULL ORDER BY t.fecha_envio;`);
  const x = rs(r);
  return { solapamientos: x[0], sinRespuesta: x[1], fueraDeLimites: x[2], escalamientosPendientes: x[3], sinConfirmacionPayers: x[4] };
}
