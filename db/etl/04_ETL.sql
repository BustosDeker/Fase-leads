/*==============================================================================
 04_ETL.sql - ETL INBESTIGA_TESIS -> INBESTIGA_MART (Anexo C). Se ejecuta COMPLETO como un solo lote.
 Requiere: 01_OLTP_ER.sql, 02_OLTP_Poblamiento_LEADS.sql y 03_DataMart_DDL.sql.
 Guardar/abrir como UTF-8 con BOM.
==============================================================================*/
USE INBESTIGA_TESIS;
SET LANGUAGE Spanish;   -- nombres de mes y dia en espanol (DATENAME) y semana iniciada en lunes
SET NOCOUNT ON;
-- Se ejecuta como un único lote (sin separadores GO) para que @Corte y los plazos permanezcan vigentes en todas las cargas.
-- Parámetros de medición (propuestos; deben ser validados con la gestión del negocio)
DECLARE @Corte DATETIME2 = '2026-04-30T23:59:59';
DECLARE @WD INT = 48;   -- horas: entrega del diagnóstico (K1)
DECLARE @WQ INT = 2;    -- horas: primera propuesta desde la aptitud (K2)
DECLARE @WA INT = 30;   -- días: aceptación (K3) y recuperación (K4)
DECLARE @WC INT = 60;   -- días: confirmación PAYERS (K5)
 
---------------------------------------------------------------- A. DIMENSIONES (MERGE)
-- A.1 Dim_Tiempo: todas las fechas de los procesos de LEADS + miembro «No aplica»
MERGE INBESTIGA_MART.dbo.Dim_Tiempo AS dim USING
(SELECT Anual = YEAR(f.Fecha), Trimestre = DATENAME(YY, f.Fecha) + 'T' + DATENAME(QQ, f.Fecha),
        NumeroMes = MONTH(f.Fecha), Mes = DATENAME(MM, f.Fecha), Semana = DATEPART(WK, f.Fecha),
        Dia = DAY(f.Fecha), DiaSemana = DATENAME(DW, f.Fecha), Fecha = f.Fecha
 FROM (SELECT Fecha = CAST('19000101' AS DATE)
       UNION SELECT CAST(fecha_inicio AS DATE)        FROM OPORTUNIDAD_COMERCIAL
       UNION SELECT CAST(fecha_apta_cotizar AS DATE)  FROM OPORTUNIDAD_COMERCIAL WHERE fecha_apta_cotizar IS NOT NULL
       UNION SELECT CAST(fecha_solicitud AS DATE)     FROM DIAGNOSTICO
       UNION SELECT CAST(fecha_presentacion AS DATE)  FROM PROPUESTA
       UNION SELECT CAST(fecha_registro AS DATE)      FROM OBJECION) AS f) AS oltp
ON oltp.Fecha = dim.idFecha
WHEN NOT MATCHED THEN
    INSERT (Anual, Trimestre, NumeroMes, Mes, Semana, Dia, DiaSemana, idFecha)
    VALUES (Anual, Trimestre, NumeroMes, Mes, Semana, Dia, DiaSemana, Fecha);
-- A.2 Dim_Estudiante (perfil heredado de BUYERS; tipo 1: se actualiza con el perfil vigente; miembro 0 «Sin perfil académico»)
MERGE INBESTIGA_MART.dbo.Dim_Estudiante AS dim USING
(SELECT Estudiante = co.nombres + ' ' + co.apellidos, Carrera = ca.nombre, Facultad = ca.facultad,
        EtapaAcademica = pa.etapa_academica,
        GrupoEtapa = CASE WHEN pa.etapa_academica IN ('CICLO_IX', 'CICLO_X') THEN 'Ciclos IX–X'
                          WHEN pa.etapa_academica = 'EGRESADO' THEN 'Egresado'
                          WHEN pa.etapa_academica = 'BACHILLER' THEN 'Bachiller' ELSE 'Otras etapas' END,
        idContacto = pa.contacto_id
 FROM PERFIL_ACADEMICO pa
      INNER JOIN CONTACTO co ON co.contacto_id = pa.contacto_id
      INNER JOIN CARRERA ca ON ca.carrera_id = pa.carrera_id
 UNION ALL SELECT 'Sin perfil académico', 'Sin perfil académico', NULL, 'Sin perfil académico', 'Sin perfil', 0) AS oltp
ON oltp.idContacto = dim.idContacto
WHEN MATCHED THEN
    UPDATE SET Estudiante = oltp.Estudiante, Carrera = oltp.Carrera, Facultad = oltp.Facultad,
               EtapaAcademica = oltp.EtapaAcademica, GrupoEtapa = oltp.GrupoEtapa
WHEN NOT MATCHED THEN
    INSERT (Estudiante, Carrera, Facultad, EtapaAcademica, GrupoEtapa, idContacto)
    VALUES (oltp.Estudiante, oltp.Carrera, oltp.Facultad, oltp.EtapaAcademica, oltp.GrupoEtapa, oltp.idContacto);
-- A.3 Dim_Investigacion (combinaciones observadas en los diagnósticos + «Sin diagnóstico»)
MERGE INBESTIGA_MART.dbo.Dim_Investigacion AS dim USING
(SELECT DISTINCT
        Enfoque = CASE x.TipoTesis WHEN 'DESCRIPTIVA' THEN 'No experimental' WHEN 'CORRELACIONAL' THEN 'No experimental'
                                   WHEN 'EXPERIMENTAL' THEN 'Experimental' WHEN 'APLICADA' THEN 'Aplicada / tecnológica'
                                   ELSE 'No declarado' END,
        PerfilInvestigacion = x.TipoTesis + ' | ' + x.RangoAvance + ' | ' + x.EmpresaAplicacion,
        x.TipoTesis, x.RangoAvance, x.EmpresaAplicacion
 FROM (SELECT TipoTesis = ISNULL(d.tipo_tesis, 'NO DECLARADO'),
              RangoAvance = CASE WHEN d.avance_declarado IS NULL THEN 'No declarado'
                                 WHEN d.avance_declarado <= 25 THEN '0–25 %'
                                 WHEN d.avance_declarado <= 50 THEN '26–50 %' ELSE '> 50 %' END,
              EmpresaAplicacion = CASE d.tiene_empresa_aplicacion WHEN 1 THEN 'Con empresa' WHEN 0 THEN 'Sin empresa'
                                       ELSE 'No declarado' END
       FROM DIAGNOSTICO d
       UNION ALL SELECT 'SIN DIAGNÓSTICO', 'Sin diagnóstico', 'Sin diagnóstico') x) AS oltp
ON oltp.TipoTesis = dim.TipoTesis AND oltp.RangoAvance = dim.RangoAvance AND oltp.EmpresaAplicacion = dim.EmpresaAplicacion
WHEN NOT MATCHED THEN
    INSERT (PerfilInvestigacion, Enfoque, TipoTesis, RangoAvance, EmpresaAplicacion)
    VALUES (PerfilInvestigacion, Enfoque, TipoTesis, RangoAvance, EmpresaAplicacion);
-- A.4 Dim_Servicio (servicio ofertado + miembro 0 «Sin propuesta presentada»)
MERGE INBESTIGA_MART.dbo.Dim_Servicio AS dim USING
(SELECT Familia = s.familia, TipoServicio = s.tipo_servicio, Paquete = s.paquete, Modalidad = s.modalidad,
        Servicio = s.nombre, idServicio = s.servicio_id
 FROM SERVICIO s
 UNION ALL SELECT 'Sin propuesta presentada', 'N/A', NULL, NULL, 'Sin propuesta presentada', 0) AS oltp
ON oltp.idServicio = dim.idServicio
WHEN NOT MATCHED THEN
    INSERT (Familia, TipoServicio, Paquete, Modalidad, Servicio, idServicio)
    VALUES (Familia, TipoServicio, Paquete, Modalidad, Servicio, idServicio);
-- A.5 Dim_Asesor (+ miembro 0 para el agente IA)
MERGE INBESTIGA_MART.dbo.Dim_Asesor AS dim USING
(SELECT Rol = a.rol, Equipo = a.equipo, Especialidad = a.especialidad, Asesor = a.nombre, idAsesor = a.asesor_id
 FROM ASESOR a
 UNION ALL SELECT 'BOT', 'Agente IA', 'Atención automatizada', 'Agente IA (sin asesor humano)', 0) AS oltp
ON oltp.idAsesor = dim.idAsesor
WHEN NOT MATCHED THEN
    INSERT (Rol, Equipo, Especialidad, Asesor, idAsesor) VALUES (Rol, Equipo, Especialidad, Asesor, idAsesor);
-- A.6 Dim_Canal_Captacion (canal y campaña heredados de BUYERS + miembro «Sin canal»)
MERGE INBESTIGA_MART.dbo.Dim_Canal_Captacion AS dim USING
(SELECT TipoCanal = c.tipo, Plataforma = c.plataforma, Canal = c.nombre,
        Campania = ISNULL(cp.nombre, 'Sin campaña'), idCanal = c.canal_id, idCampania = ISNULL(cp.campania_id, 0)
 FROM CANAL c LEFT JOIN CAMPANIA cp ON cp.canal_id = c.canal_id
 UNION SELECT c.tipo, c.plataforma, c.nombre, 'Sin campaña', c.canal_id, 0 FROM CANAL c
 UNION ALL SELECT 'Sin canal', NULL, 'Sin canal', 'Sin campaña', 0, 0) AS oltp
ON oltp.idCanal = dim.idCanal AND oltp.idCampania = dim.idCampania
WHEN NOT MATCHED THEN
    INSERT (TipoCanal, Plataforma, Canal, Campania, idCanal, idCampania)
    VALUES (TipoCanal, Plataforma, Canal, Campania, idCanal, idCampania);
-- A.7 Dim_Objecion
MERGE INBESTIGA_MART.dbo.Dim_Objecion AS dim USING
(SELECT DISTINCT Grupo = ISNULL(o.grupo, 'SIN GRUPO'), Tipo = o.tipo,
        idObjecion = ISNULL(o.grupo, 'SIN GRUPO') + '/' + o.tipo
 FROM OBJECION o) AS oltp
ON oltp.idObjecion = dim.idObjecion
WHEN NOT MATCHED THEN
    INSERT (Grupo, Tipo, idObjecion) VALUES (Grupo, Tipo, idObjecion);
 
-- A.8 Dim_Ubicacion (sede y universidad del perfil académico + miembro 0 «Sin ubicación»)
MERGE INBESTIGA_MART.dbo.Dim_Ubicacion AS dim USING
(SELECT DISTINCT Sede = ISNULL(pa.sede, 'Sin sede registrada'), Universidad = un.nombre, TipoUniversidad = CASE un.tipo WHEN 'PUBLICA' THEN 'Pública' WHEN 'PRIVADA' THEN 'Privada' ELSE un.tipo END,
        idUniversidad = un.universidad_id
 FROM PERFIL_ACADEMICO pa INNER JOIN UNIVERSIDAD un ON un.universidad_id = pa.universidad_id
 UNION ALL SELECT 'Sin ubicación', 'Sin ubicación', 'Sin ubicación', 0) AS oltp
ON oltp.idUniversidad = dim.idUniversidad AND oltp.Sede = dim.Sede
WHEN MATCHED THEN
    UPDATE SET Universidad = oltp.Universidad, TipoUniversidad = oltp.TipoUniversidad
WHEN NOT MATCHED THEN
    INSERT (Sede, Universidad, TipoUniversidad, idUniversidad)
    VALUES (oltp.Sede, oltp.Universidad, oltp.TipoUniversidad, oltp.idUniversidad);
---------------------------------------------------------------- B. HECHOS (DELETE + INSERT … SELECT)
-- B.1 Hecho_Diagnostico (AD1): primera solicitud de diagnóstico por oportunidad
DELETE FROM INBESTIGA_MART.dbo.Hecho_Diagnostico;
WITH dx AS (
    SELECT d.*, rn = ROW_NUMBER() OVER (PARTITION BY d.oportunidad_id ORDER BY d.fecha_solicitud, d.diagnostico_id)
    FROM DIAGNOSTICO d WHERE d.oportunidad_id IS NOT NULL)
INSERT INBESTIGA_MART.dbo.Hecho_Diagnostico
(KeyTiempo, KeyEstudiante, KeyUbicacion, KeyInvestigacion, KeyAsesor, KeyCanalCaptacion, diagnostico_solicitud_madura, diagnostico_oportuno)
SELECT dt.KeyTiempo, de.KeyEstudiante, du.KeyUbicacion, di.KeyInvestigacion, da.KeyAsesor, dc.KeyCanalCaptacion,
       diagnostico_solicitud_madura = SUM(CASE WHEN DATEADD(HOUR, @WD, x.fecha_solicitud) <= @Corte THEN 1 ELSE 0 END),
       diagnostico_oportuno = SUM(CASE WHEN DATEADD(HOUR, @WD, x.fecha_solicitud) <= @Corte
                                        AND x.estado = 'ENTREGADO' AND x.fecha_entrega <= DATEADD(HOUR, @WD, x.fecha_solicitud)
                                       THEN 1 ELSE 0 END)
FROM dx x
     INNER JOIN LEAD l  ON l.lead_id  = x.lead_id
     INNER JOIN BUYER b ON b.buyer_id = l.buyer_id
     LEFT JOIN PERFIL_ACADEMICO pf ON pf.contacto_id = b.contacto_id   -- perfil vigente (puede faltar)
     INNER JOIN INBESTIGA_MART.dbo.Dim_Tiempo dt      ON dt.idFecha = CAST(x.fecha_solicitud AS DATE)
     INNER JOIN INBESTIGA_MART.dbo.Dim_Estudiante de   -- 0 = «Sin perfil académico»
            ON de.idContacto = ISNULL(pf.contacto_id, 0)
     INNER JOIN INBESTIGA_MART.dbo.Dim_Ubicacion du    -- 0 = «Sin ubicación»
            ON du.idUniversidad = ISNULL(pf.universidad_id, 0)
           AND du.Sede = CASE WHEN pf.contacto_id IS NULL THEN 'Sin ubicación' ELSE ISNULL(pf.sede, 'Sin sede registrada') END
     INNER JOIN INBESTIGA_MART.dbo.Dim_Investigacion di
            ON di.TipoTesis = ISNULL(x.tipo_tesis, 'NO DECLARADO')
           AND di.RangoAvance = CASE WHEN x.avance_declarado IS NULL THEN 'No declarado' WHEN x.avance_declarado <= 25 THEN '0–25 %'
                                     WHEN x.avance_declarado <= 50 THEN '26–50 %' ELSE '> 50 %' END
           AND di.EmpresaAplicacion = CASE x.tiene_empresa_aplicacion WHEN 1 THEN 'Con empresa' WHEN 0 THEN 'Sin empresa' ELSE 'No declarado' END
     INNER JOIN INBESTIGA_MART.dbo.Dim_Asesor da      ON da.idAsesor = ISNULL(x.asesor_id, 0)
     INNER JOIN INBESTIGA_MART.dbo.Dim_Canal_Captacion dc
            ON dc.idCanal = ISNULL(b.canal_captacion_id, 0) AND dc.idCampania = ISNULL(b.campania_id, 0)
WHERE x.rn = 1
GROUP BY dt.KeyTiempo, de.KeyEstudiante, du.KeyUbicacion, di.KeyInvestigacion, da.KeyAsesor, dc.KeyCanalCaptacion;
-- B.2 Hecho_Oportunidad (AD2): parte de TODAS las oportunidades; las versiones no multiplican filas
DELETE FROM INBESTIGA_MART.dbo.Hecho_Oportunidad;
WITH fp AS (   -- primera propuesta presentada de cada oportunidad
    SELECT p.*, rn = ROW_NUMBER() OVER (PARTITION BY p.oportunidad_id ORDER BY p.fecha_presentacion, p.propuesta_id)
    FROM PROPUESTA p WHERE p.oportunidad_id IS NOT NULL),
ac AS (        -- primera aceptación formal de cualquier versión
    SELECT p.oportunidad_id, fecha_aceptacion = MIN(r.fecha_respuesta)
    FROM RESPUESTA_PROPUESTA r INNER JOIN PROPUESTA p ON p.propuesta_id = r.propuesta_id
    WHERE r.tipo_respuesta = 'ACEPTA' AND p.oportunidad_id IS NOT NULL GROUP BY p.oportunidad_id),
dx AS (        -- diagnóstico de referencia: la primera solicitud
    SELECT d.oportunidad_id, d.tipo_tesis, d.avance_declarado, d.tiene_empresa_aplicacion,
           rn = ROW_NUMBER() OVER (PARTITION BY d.oportunidad_id ORDER BY d.fecha_solicitud, d.diagnostico_id)
    FROM DIAGNOSTICO d WHERE d.oportunidad_id IS NOT NULL)
INSERT INBESTIGA_MART.dbo.Hecho_Oportunidad
(KeyTiempoInicio, KeyTiempoApta, KeyTiempoPropuesta, KeyEstudiante, KeyUbicacion, KeyInvestigacion, KeyServicio, KeyAsesor, KeyCanalCaptacion,
 oportunidad_apta_madura, cotizacion_oportuna, cotizacion_madura, aceptacion_30d, cohorte_madura, conversion_60d)
SELECT t1.KeyTiempo, t2.KeyTiempo, t3.KeyTiempo, de.KeyEstudiante, du.KeyUbicacion, di.KeyInvestigacion, ds.KeyServicio, da.KeyAsesor, dc.KeyCanalCaptacion,
  oportunidad_apta_madura = SUM(CASE WHEN o.fecha_apta_cotizar IS NOT NULL
                                      AND DATEADD(HOUR, @WQ, o.fecha_apta_cotizar) <= @Corte THEN 1 ELSE 0 END),
  cotizacion_oportuna = SUM(CASE WHEN o.fecha_apta_cotizar IS NOT NULL AND DATEADD(HOUR, @WQ, o.fecha_apta_cotizar) <= @Corte
                                  AND f.fecha_presentacion IS NOT NULL
                                  AND f.fecha_presentacion <= DATEADD(HOUR, @WQ, o.fecha_apta_cotizar) THEN 1 ELSE 0 END),
  cotizacion_madura = SUM(CASE WHEN f.fecha_presentacion IS NOT NULL
                                AND DATEADD(DAY, @WA, f.fecha_presentacion) <= @Corte THEN 1 ELSE 0 END),
  aceptacion_30d = SUM(CASE WHEN f.fecha_presentacion IS NOT NULL AND DATEADD(DAY, @WA, f.fecha_presentacion) <= @Corte
                             AND a.fecha_aceptacion IS NOT NULL
                             AND a.fecha_aceptacion <= DATEADD(DAY, @WA, f.fecha_presentacion) THEN 1 ELSE 0 END),
  cohorte_madura = SUM(CASE WHEN DATEADD(DAY, @WC, o.fecha_inicio) <= @Corte THEN 1 ELSE 0 END),
  conversion_60d = SUM(CASE WHEN DATEADD(DAY, @WC, o.fecha_inicio) <= @Corte AND cv.fecha_confirmacion IS NOT NULL
                             AND cv.fecha_confirmacion <= DATEADD(DAY, @WC, o.fecha_inicio) THEN 1 ELSE 0 END)
FROM OPORTUNIDAD_COMERCIAL o
     INNER JOIN LEAD l  ON l.lead_id  = o.lead_id
     INNER JOIN BUYER b ON b.buyer_id = l.buyer_id
     LEFT JOIN PERFIL_ACADEMICO pf ON pf.contacto_id = b.contacto_id   -- perfil vigente (puede faltar)
     LEFT JOIN fp f  ON f.oportunidad_id = o.oportunidad_id AND f.rn = 1
     LEFT JOIN ac a  ON a.oportunidad_id = o.oportunidad_id
     LEFT JOIN dx x  ON x.oportunidad_id = o.oportunidad_id AND x.rn = 1
     LEFT JOIN CONVERSION_PAYER_REF cv ON cv.oportunidad_id = o.oportunidad_id
     INNER JOIN INBESTIGA_MART.dbo.Dim_Tiempo t1 ON t1.idFecha = CAST(o.fecha_inicio AS DATE)
     INNER JOIN INBESTIGA_MART.dbo.Dim_Tiempo t2 ON t2.idFecha = ISNULL(CAST(o.fecha_apta_cotizar AS DATE), '19000101')
     INNER JOIN INBESTIGA_MART.dbo.Dim_Tiempo t3 ON t3.idFecha = ISNULL(CAST(f.fecha_presentacion AS DATE), '19000101')
     INNER JOIN INBESTIGA_MART.dbo.Dim_Estudiante de   -- 0 = «Sin perfil académico»
            ON de.idContacto = ISNULL(pf.contacto_id, 0)
     INNER JOIN INBESTIGA_MART.dbo.Dim_Ubicacion du    -- 0 = «Sin ubicación»
            ON du.idUniversidad = ISNULL(pf.universidad_id, 0)
           AND du.Sede = CASE WHEN pf.contacto_id IS NULL THEN 'Sin ubicación' ELSE ISNULL(pf.sede, 'Sin sede registrada') END
     INNER JOIN INBESTIGA_MART.dbo.Dim_Investigacion di
            ON di.TipoTesis = CASE WHEN x.oportunidad_id IS NULL THEN 'SIN DIAGNÓSTICO' ELSE ISNULL(x.tipo_tesis, 'NO DECLARADO') END
           AND di.RangoAvance = CASE WHEN x.oportunidad_id IS NULL THEN 'Sin diagnóstico'
                                     WHEN x.avance_declarado IS NULL THEN 'No declarado' WHEN x.avance_declarado <= 25 THEN '0–25 %'
                                     WHEN x.avance_declarado <= 50 THEN '26–50 %' ELSE '> 50 %' END
           AND di.EmpresaAplicacion = CASE WHEN x.oportunidad_id IS NULL THEN 'Sin diagnóstico'
                                           WHEN x.tiene_empresa_aplicacion = 1 THEN 'Con empresa'
                                           WHEN x.tiene_empresa_aplicacion = 0 THEN 'Sin empresa' ELSE 'No declarado' END
     INNER JOIN INBESTIGA_MART.dbo.Dim_Servicio ds   ON ds.idServicio = ISNULL(f.servicio_id, 0)   -- servicio ofertado; 0 = sin propuesta
     INNER JOIN INBESTIGA_MART.dbo.Dim_Asesor da     ON da.idAsesor = ISNULL(o.asesor_responsable_id, 0)
     INNER JOIN INBESTIGA_MART.dbo.Dim_Canal_Captacion dc
            ON dc.idCanal = ISNULL(b.canal_captacion_id, 0) AND dc.idCampania = ISNULL(b.campania_id, 0)
GROUP BY t1.KeyTiempo, t2.KeyTiempo, t3.KeyTiempo, de.KeyEstudiante, du.KeyUbicacion, di.KeyInvestigacion, ds.KeyServicio, da.KeyAsesor, dc.KeyCanalCaptacion;
-- B.3 Hecho_Recuperacion_Objecion (AD3): primera objeción por oportunidad, con su diagnóstico de referencia
DELETE FROM INBESTIGA_MART.dbo.Hecho_Recuperacion_Objecion;
WITH ob AS (   -- la recuperación se evalúa por objeción antes de agregar (no se agrega una subconsulta)
    SELECT o.objecion_id, p.oportunidad_id, p.servicio_id, o.grupo, o.tipo, o.fecha_registro,
           rn = ROW_NUMBER() OVER (PARTITION BY p.oportunidad_id ORDER BY o.fecha_registro, o.objecion_id),
           recuperada = CASE WHEN EXISTS
                (SELECT 1 FROM RESPUESTA_PROPUESTA r INNER JOIN PROPUESTA p2 ON p2.propuesta_id = r.propuesta_id
                 WHERE p2.oportunidad_id = p.oportunidad_id AND r.tipo_respuesta = 'ACEPTA'
                   AND r.fecha_respuesta > o.fecha_registro AND r.fecha_respuesta <= DATEADD(DAY, @WA, o.fecha_registro))
                THEN 1 ELSE 0 END
    FROM OBJECION o INNER JOIN PROPUESTA p ON p.propuesta_id = o.propuesta_id
    WHERE p.oportunidad_id IS NOT NULL),
dx AS (        -- diagnóstico de referencia: la primera solicitud de la oportunidad
    SELECT d.oportunidad_id, d.tipo_tesis, d.avance_declarado, d.tiene_empresa_aplicacion,
           rn = ROW_NUMBER() OVER (PARTITION BY d.oportunidad_id ORDER BY d.fecha_solicitud, d.diagnostico_id)
    FROM DIAGNOSTICO d WHERE d.oportunidad_id IS NOT NULL)
INSERT INBESTIGA_MART.dbo.Hecho_Recuperacion_Objecion
(KeyTiempo, KeyEstudiante, KeyUbicacion, KeyInvestigacion, KeyServicio, KeyAsesor, KeyCanalCaptacion, KeyObjecion,
 objecion_principal_madura, objecion_recuperada_30d)
SELECT dt.KeyTiempo, de.KeyEstudiante, du.KeyUbicacion, di.KeyInvestigacion, ds.KeyServicio, da.KeyAsesor, dc.KeyCanalCaptacion, dob.KeyObjecion,
       objecion_principal_madura = SUM(CASE WHEN DATEADD(DAY, @WA, x.fecha_registro) <= @Corte THEN 1 ELSE 0 END),
       objecion_recuperada_30d   = SUM(CASE WHEN DATEADD(DAY, @WA, x.fecha_registro) <= @Corte AND x.recuperada = 1 THEN 1 ELSE 0 END)
FROM ob x
     INNER JOIN OPORTUNIDAD_COMERCIAL o ON o.oportunidad_id = x.oportunidad_id
     INNER JOIN LEAD l  ON l.lead_id  = o.lead_id
     INNER JOIN BUYER b ON b.buyer_id = l.buyer_id
     LEFT JOIN PERFIL_ACADEMICO pf ON pf.contacto_id = b.contacto_id   -- perfil vigente (puede faltar)
     LEFT JOIN dx g     ON g.oportunidad_id = x.oportunidad_id AND g.rn = 1
     INNER JOIN INBESTIGA_MART.dbo.Dim_Tiempo dt     ON dt.idFecha = CAST(x.fecha_registro AS DATE)
     INNER JOIN INBESTIGA_MART.dbo.Dim_Estudiante de   -- 0 = «Sin perfil académico»
            ON de.idContacto = ISNULL(pf.contacto_id, 0)
     INNER JOIN INBESTIGA_MART.dbo.Dim_Ubicacion du    -- 0 = «Sin ubicación»
            ON du.idUniversidad = ISNULL(pf.universidad_id, 0)
           AND du.Sede = CASE WHEN pf.contacto_id IS NULL THEN 'Sin ubicación' ELSE ISNULL(pf.sede, 'Sin sede registrada') END
     INNER JOIN INBESTIGA_MART.dbo.Dim_Investigacion di
            ON di.TipoTesis = CASE WHEN g.oportunidad_id IS NULL THEN 'SIN DIAGNÓSTICO' ELSE ISNULL(g.tipo_tesis, 'NO DECLARADO') END
           AND di.RangoAvance = CASE WHEN g.oportunidad_id IS NULL THEN 'Sin diagnóstico'
                                     WHEN g.avance_declarado IS NULL THEN 'No declarado' WHEN g.avance_declarado <= 25 THEN '0–25 %'
                                     WHEN g.avance_declarado <= 50 THEN '26–50 %' ELSE '> 50 %' END
           AND di.EmpresaAplicacion = CASE WHEN g.oportunidad_id IS NULL THEN 'Sin diagnóstico'
                                           WHEN g.tiene_empresa_aplicacion = 1 THEN 'Con empresa'
                                           WHEN g.tiene_empresa_aplicacion = 0 THEN 'Sin empresa' ELSE 'No declarado' END
     INNER JOIN INBESTIGA_MART.dbo.Dim_Servicio ds   ON ds.idServicio = ISNULL(x.servicio_id, 0)
     INNER JOIN INBESTIGA_MART.dbo.Dim_Asesor da     ON da.idAsesor = ISNULL(o.asesor_responsable_id, 0)
     INNER JOIN INBESTIGA_MART.dbo.Dim_Canal_Captacion dc
            ON dc.idCanal = ISNULL(b.canal_captacion_id, 0) AND dc.idCampania = ISNULL(b.campania_id, 0)
     INNER JOIN INBESTIGA_MART.dbo.Dim_Objecion dob  ON dob.idObjecion = ISNULL(x.grupo, 'SIN GRUPO') + '/' + x.tipo
WHERE x.rn = 1
GROUP BY dt.KeyTiempo, de.KeyEstudiante, du.KeyUbicacion, di.KeyInvestigacion, ds.KeyServicio, da.KeyAsesor, dc.KeyCanalCaptacion, dob.KeyObjecion;
