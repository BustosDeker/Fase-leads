/*==============================================================================
 05_Conciliacion_Reportes.sql - Parte 1: conciliacion y reportes R1 a R3 sobre INBESTIGA_MART (Anexo D).
 Los valores esperados son los de la simulacion (Tablas 24 a 32). Guardar/abrir como UTF-8 con BOM.
==============================================================================*/
USE INBESTIGA_MART;
GO
-- Valores esperados bajo la simulación del capítulo (no son resultados de una ejecución).
SELECT M1 = SUM(diagnostico_solicitud_madura), M2 = SUM(diagnostico_oportuno),            -- 180, 144
       K1 = CAST(100.0 * SUM(diagnostico_oportuno) / NULLIF(SUM(diagnostico_solicitud_madura), 0) AS DECIMAL(5,1))
FROM Hecho_Diagnostico;
 
SELECT M3 = SUM(oportunidad_apta_madura), M4 = SUM(cotizacion_oportuna), M5 = SUM(cotizacion_madura),
       M6 = SUM(aceptacion_30d), M7 = SUM(cohorte_madura), M8 = SUM(conversion_60d)       -- 150, 120, 135, 54, 200, 36
FROM Hecho_Oportunidad;
 
SELECT M9 = SUM(objecion_principal_madura), M10 = SUM(objecion_recuperada_30d),            -- 50, 20
       K4 = CAST(100.0 * SUM(objecion_recuperada_30d) / NULLIF(SUM(objecion_principal_madura), 0) AS DECIMAL(5,1))
FROM Hecho_Recuperacion_Objecion;
 
-- R1: K1 por GrupoEtapa (AD1)
SELECT e.GrupoEtapa, M1 = SUM(h.diagnostico_solicitud_madura), M2 = SUM(h.diagnostico_oportuno),
       K1 = CAST(100.0 * SUM(h.diagnostico_oportuno) / NULLIF(SUM(h.diagnostico_solicitud_madura), 0) AS DECIMAL(5,1))
FROM Hecho_Diagnostico h INNER JOIN Dim_Estudiante e ON e.KeyEstudiante = h.KeyEstudiante
GROUP BY e.GrupoEtapa;
 
-- R1: K1 por Equipo (AD1, Tabla 26)
SELECT a.Equipo, M1 = SUM(h.diagnostico_solicitud_madura), M2 = SUM(h.diagnostico_oportuno),
       K1 = CAST(100.0 * SUM(h.diagnostico_oportuno) / NULLIF(SUM(h.diagnostico_solicitud_madura), 0) AS DECIMAL(5,1))
FROM Hecho_Diagnostico h INNER JOIN Dim_Asesor a ON a.KeyAsesor = h.KeyAsesor
GROUP BY a.Equipo;
 
-- R1: K1 por TipoUniversidad (AD1, Tabla 27)
SELECT u.TipoUniversidad, M1 = SUM(h.diagnostico_solicitud_madura), M2 = SUM(h.diagnostico_oportuno),
       K1 = CAST(100.0 * SUM(h.diagnostico_oportuno) / NULLIF(SUM(h.diagnostico_solicitud_madura), 0) AS DECIMAL(5,1))
FROM Hecho_Diagnostico h INNER JOIN Dim_Ubicacion u ON u.KeyUbicacion = h.KeyUbicacion
GROUP BY u.TipoUniversidad;
 
-- R2: K2, K3 y K5 globales (AD2)
SELECT K2 = CAST(100.0 * SUM(cotizacion_oportuna) / NULLIF(SUM(oportunidad_apta_madura), 0) AS DECIMAL(5,1)),
       K3 = CAST(100.0 * SUM(aceptacion_30d) / NULLIF(SUM(cotizacion_madura), 0) AS DECIMAL(5,1)),
       K5 = CAST(100.0 * SUM(conversion_60d) / NULLIF(SUM(cohorte_madura), 0) AS DECIMAL(5,1))
FROM Hecho_Oportunidad;
 
-- R2 por TipoCanal (AD2, Tabla 29)
SELECT c.TipoCanal,
       K2 = CAST(100.0 * SUM(h.cotizacion_oportuna) / NULLIF(SUM(h.oportunidad_apta_madura), 0) AS DECIMAL(5,1)),
       K3 = CAST(100.0 * SUM(h.aceptacion_30d)      / NULLIF(SUM(h.cotizacion_madura), 0)       AS DECIMAL(5,1)),
       K5 = CAST(100.0 * SUM(h.conversion_60d)      / NULLIF(SUM(h.cohorte_madura), 0)          AS DECIMAL(5,1))
FROM Hecho_Oportunidad h INNER JOIN Dim_Canal_Captacion c ON c.KeyCanalCaptacion = h.KeyCanalCaptacion
GROUP BY c.TipoCanal;
 
-- R2 por Familia (AD2, Tabla 30); incluye «Sin propuesta presentada»
SELECT s.Familia,
       K2 = CAST(100.0 * SUM(h.cotizacion_oportuna) / NULLIF(SUM(h.oportunidad_apta_madura), 0) AS DECIMAL(5,1)),
       K3 = CAST(100.0 * SUM(h.aceptacion_30d)      / NULLIF(SUM(h.cotizacion_madura), 0)       AS DECIMAL(5,1))
FROM Hecho_Oportunidad h INNER JOIN Dim_Servicio s ON s.KeyServicio = h.KeyServicio
GROUP BY s.Familia;
 
-- Rol de tiempo: cada KPI se filtra por la fecha de su cohorte. Ejemplo: K2 de las oportunidades aptas en enero de 2026
SELECT K2 = CAST(100.0 * SUM(h.cotizacion_oportuna) / NULLIF(SUM(h.oportunidad_apta_madura), 0) AS DECIMAL(5,1))
FROM Hecho_Oportunidad h INNER JOIN Dim_Tiempo t ON t.KeyTiempo = h.KeyTiempoApta   -- K3: KeyTiempoPropuesta; K5: KeyTiempoInicio
WHERE t.Anual = 2026 AND t.NumeroMes = 1;
 
-- R3: K4 por grupo de objeción (AD3)
SELECT o.Grupo, M9 = SUM(h.objecion_principal_madura), M10 = SUM(h.objecion_recuperada_30d),
       K4 = CAST(100.0 * SUM(h.objecion_recuperada_30d) / NULLIF(SUM(h.objecion_principal_madura), 0) AS DECIMAL(5,1))
FROM Hecho_Recuperacion_Objecion h INNER JOIN Dim_Objecion o ON o.KeyObjecion = h.KeyObjecion
GROUP BY o.Grupo;
 
-- R3: K4 por Familia (AD3, Tabla 32)
SELECT s.Familia, M9 = SUM(h.objecion_principal_madura), M10 = SUM(h.objecion_recuperada_30d),
       K4 = CAST(100.0 * SUM(h.objecion_recuperada_30d) / NULLIF(SUM(h.objecion_principal_madura), 0) AS DECIMAL(5,1))
FROM Hecho_Recuperacion_Objecion h INNER JOIN Dim_Servicio s ON s.KeyServicio = h.KeyServicio
GROUP BY s.Familia;

GO

/*==============================================================================
 PARTE 2 - R4: Supervision operativa del agente (sobre el OLTP; no introduce indicadores)
 Valores esperados con el poblamiento simulado: 0, 0, 0, 0 y 18 transferencias por conciliar.
==============================================================================*/
USE INBESTIGA_TESIS;
GO
-- R4.1 Agenda: citas solapadas por asesor (excluye canceladas)
SELECT a.asesor_id, cita_1 = a.cita_id, cita_2 = b.cita_id, a.inicio, a.fin
FROM CITA_VIRTUAL a INNER JOIN CITA_VIRTUAL b
     ON b.asesor_id = a.asesor_id AND b.cita_id > a.cita_id AND a.inicio < b.fin AND b.inicio < a.fin
WHERE a.estado <> 'CANCELADA' AND b.estado <> 'CANCELADA';

-- R4.2 Trazabilidad: propuestas sin ninguna respuesta registrada
SELECT p.propuesta_id, p.oportunidad_id, p.version, p.fecha_presentacion
FROM PROPUESTA p LEFT JOIN RESPUESTA_PROPUESTA r ON r.propuesta_id = p.propuesta_id
WHERE r.respuesta_id IS NULL;

-- R4.3 Reglas economicas: descuento sobre el tope o precio final bajo el minimo aplicado
SELECT propuesta_id, precio_base, descuento, tope_descuento_aplicado, precio_final, precio_minimo_aplicado
FROM PROPUESTA
WHERE descuento > precio_base * tope_descuento_aplicado / 100.0 OR precio_final < precio_minimo_aplicado;

-- R4.4 Escalamiento humano: casos pendientes de atencion
SELECT escalamiento_id, oportunidad_id, fecha, motivo, destino_rol
FROM ESCALAMIENTO WHERE fecha_atencion IS NULL;

-- R4.5 Conciliacion con PAYERS: acuerdos transferidos sin confirmacion (evita doble contabilizacion)
SELECT t.oportunidad_id, t.propuesta_id, t.fecha_envio, t.estado
FROM TRANSFERENCIA_PAYER t LEFT JOIN CONVERSION_PAYER_REF c ON c.oportunidad_id = t.oportunidad_id
WHERE c.conversion_id IS NULL;   -- 18 filas bajo la simulacion
GO
