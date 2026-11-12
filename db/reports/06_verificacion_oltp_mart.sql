/*==============================================================================
 06_verificacion_oltp_mart.sql - Verificacion interna OLTP <-> data mart (no es pantalla de la app).

 Recalcula M1..M10 DIRECTAMENTE desde INBESTIGA_TESIS, una fila por unidad de
 conteo y sin pasar por las dimensiones, y compara con SUM() de los hechos de
 INBESTIGA_MART. No usa valores esperados fijos: vale para cualquier dato.

 Debe ejecutarse con los MISMOS parametros que la ultima carga del ETL
 (por CLI: npm run etl:verify los toma de ETL_EJECUCION).
 Detecta: unidades perdidas en los JOIN con dimensiones, duplicados por versiones
 o respuestas, y errores de madurez/ventana.
==============================================================================*/
USE INBESTIGA_TESIS;
SET NOCOUNT ON;
DECLARE @Corte DATETIME2 = '2026-04-30T23:59:59';
DECLARE @WD INT = 48;   -- horas
DECLARE @WQ INT = 2;    -- horas
DECLARE @WA INT = 30;   -- dias
DECLARE @WC INT = 60;   -- dias

DECLARE @oltp TABLE (medida VARCHAR(40) PRIMARY KEY, valor INT);

-- M1, M2: primera solicitud de diagnostico de cada oportunidad
WITH primera AS (
    SELECT o.oportunidad_id, d.fecha_solicitud, d.fecha_entrega, d.estado
    FROM OPORTUNIDAD_COMERCIAL o
    CROSS APPLY (SELECT TOP 1 x.fecha_solicitud, x.fecha_entrega, x.estado
                 FROM DIAGNOSTICO x WHERE x.oportunidad_id = o.oportunidad_id
                 ORDER BY x.fecha_solicitud, x.diagnostico_id) d)
INSERT @oltp
SELECT 'M1 diagnostico_solicitud_madura', COUNT(CASE WHEN DATEADD(HOUR, @WD, fecha_solicitud) <= @Corte THEN 1 END) FROM primera
UNION ALL
SELECT 'M2 diagnostico_oportuno', COUNT(CASE WHEN DATEADD(HOUR, @WD, fecha_solicitud) <= @Corte AND estado = 'ENTREGADO'
                                              AND fecha_entrega <= DATEADD(HOUR, @WD, fecha_solicitud) THEN 1 END) FROM primera;

-- M3..M8: una fila por oportunidad (las versiones y respuestas se reducen con MIN)
WITH op AS (
    SELECT o.oportunidad_id, o.fecha_inicio, o.fecha_apta_cotizar,
           primera_prop = (SELECT MIN(p.fecha_presentacion) FROM PROPUESTA p WHERE p.oportunidad_id = o.oportunidad_id),
           primera_acep = (SELECT MIN(r.fecha_respuesta) FROM RESPUESTA_PROPUESTA r
                           INNER JOIN PROPUESTA p ON p.propuesta_id = r.propuesta_id
                           WHERE p.oportunidad_id = o.oportunidad_id AND r.tipo_respuesta = 'ACEPTA'),
           confirmacion = (SELECT MIN(c.fecha_confirmacion) FROM CONVERSION_PAYER_REF c WHERE c.oportunidad_id = o.oportunidad_id)
    FROM OPORTUNIDAD_COMERCIAL o)
INSERT @oltp
SELECT 'M3 oportunidad_apta_madura', COUNT(CASE WHEN DATEADD(HOUR, @WQ, fecha_apta_cotizar) <= @Corte THEN 1 END) FROM op
UNION ALL
SELECT 'M4 cotizacion_oportuna', COUNT(CASE WHEN DATEADD(HOUR, @WQ, fecha_apta_cotizar) <= @Corte
                                             AND primera_prop <= DATEADD(HOUR, @WQ, fecha_apta_cotizar) THEN 1 END) FROM op
UNION ALL
SELECT 'M5 cotizacion_madura', COUNT(CASE WHEN DATEADD(DAY, @WA, primera_prop) <= @Corte THEN 1 END) FROM op
UNION ALL
SELECT 'M6 aceptacion_30d', COUNT(CASE WHEN DATEADD(DAY, @WA, primera_prop) <= @Corte
                                        AND primera_acep <= DATEADD(DAY, @WA, primera_prop) THEN 1 END) FROM op
UNION ALL
SELECT 'M7 cohorte_madura', COUNT(CASE WHEN DATEADD(DAY, @WC, fecha_inicio) <= @Corte THEN 1 END) FROM op
UNION ALL
SELECT 'M8 conversion_60d', COUNT(CASE WHEN DATEADD(DAY, @WC, fecha_inicio) <= @Corte
                                        AND confirmacion <= DATEADD(DAY, @WC, fecha_inicio) THEN 1 END) FROM op;

-- M9, M10: primera objecion de cada oportunidad y aceptacion posterior dentro de @WA
WITH obj AS (
    SELECT o.oportunidad_id, ob.fecha_registro,
           -- primera aceptacion posterior a la objecion (cualquier version de la oportunidad)
           acep_posterior = (SELECT MIN(r.fecha_respuesta) FROM RESPUESTA_PROPUESTA r
                             INNER JOIN PROPUESTA p ON p.propuesta_id = r.propuesta_id
                             WHERE p.oportunidad_id = o.oportunidad_id AND r.tipo_respuesta = 'ACEPTA'
                               AND r.fecha_respuesta > ob.fecha_registro)
    FROM OPORTUNIDAD_COMERCIAL o
    CROSS APPLY (SELECT TOP 1 x.fecha_registro FROM OBJECION x
                 INNER JOIN PROPUESTA p ON p.propuesta_id = x.propuesta_id
                 WHERE p.oportunidad_id = o.oportunidad_id
                 ORDER BY x.fecha_registro, x.objecion_id) ob)
INSERT @oltp
SELECT 'M9 objecion_principal_madura', COUNT(CASE WHEN DATEADD(DAY, @WA, fecha_registro) <= @Corte THEN 1 END) FROM obj
UNION ALL
SELECT 'M10 objecion_recuperada_30d', COUNT(CASE WHEN DATEADD(DAY, @WA, fecha_registro) <= @Corte
                                                  AND acep_posterior <= DATEADD(DAY, @WA, fecha_registro) THEN 1 END)
FROM obj;

-- Sumas del data mart
DECLARE @mart TABLE (medida VARCHAR(40) PRIMARY KEY, valor INT);
INSERT @mart
SELECT v.medida, v.valor
FROM (SELECT M1 = SUM(diagnostico_solicitud_madura), M2 = SUM(diagnostico_oportuno) FROM INBESTIGA_MART.dbo.Hecho_Diagnostico) h
CROSS APPLY (VALUES ('M1 diagnostico_solicitud_madura', ISNULL(h.M1, 0)), ('M2 diagnostico_oportuno', ISNULL(h.M2, 0))) v(medida, valor)
UNION ALL
SELECT v.medida, v.valor
FROM (SELECT M3 = SUM(oportunidad_apta_madura), M4 = SUM(cotizacion_oportuna), M5 = SUM(cotizacion_madura),
             M6 = SUM(aceptacion_30d), M7 = SUM(cohorte_madura), M8 = SUM(conversion_60d)
      FROM INBESTIGA_MART.dbo.Hecho_Oportunidad) h
CROSS APPLY (VALUES ('M3 oportunidad_apta_madura', ISNULL(h.M3, 0)), ('M4 cotizacion_oportuna', ISNULL(h.M4, 0)),
                    ('M5 cotizacion_madura', ISNULL(h.M5, 0)), ('M6 aceptacion_30d', ISNULL(h.M6, 0)),
                    ('M7 cohorte_madura', ISNULL(h.M7, 0)), ('M8 conversion_60d', ISNULL(h.M8, 0))) v(medida, valor)
UNION ALL
SELECT v.medida, v.valor
FROM (SELECT M9 = SUM(objecion_principal_madura), M10 = SUM(objecion_recuperada_30d)
      FROM INBESTIGA_MART.dbo.Hecho_Recuperacion_Objecion) h
CROSS APPLY (VALUES ('M9 objecion_principal_madura', ISNULL(h.M9, 0)), ('M10 objecion_recuperada_30d', ISNULL(h.M10, 0))) v(medida, valor);

-- Resultado: una fila por medida
SELECT o.medida, oltp = o.valor, mart = m.valor,
       resultado = CASE WHEN o.valor = m.valor THEN 'COINCIDE' ELSE 'DIFERENCIA' END
FROM @oltp o INNER JOIN @mart m ON m.medida = o.medida
ORDER BY CAST(SUBSTRING(o.medida, 2, CHARINDEX(' ', o.medida) - 2) AS INT);

-- Coherencia: cada numerador es subconjunto de su denominador (en el OLTP)
SELECT regla, cumple = CASE WHEN num <= den THEN 'SI' ELSE 'NO' END, num, den
FROM (SELECT 'M2 <= M1' regla, (SELECT valor FROM @oltp WHERE medida LIKE 'M2 %') num, (SELECT valor FROM @oltp WHERE medida LIKE 'M1 %') den
      UNION ALL SELECT 'M4 <= M3', (SELECT valor FROM @oltp WHERE medida LIKE 'M4 %'), (SELECT valor FROM @oltp WHERE medida LIKE 'M3 %')
      UNION ALL SELECT 'M6 <= M5', (SELECT valor FROM @oltp WHERE medida LIKE 'M6 %'), (SELECT valor FROM @oltp WHERE medida LIKE 'M5 %')
      UNION ALL SELECT 'M8 <= M7', (SELECT valor FROM @oltp WHERE medida LIKE 'M8 %'), (SELECT valor FROM @oltp WHERE medida LIKE 'M7 %')
      UNION ALL SELECT 'M10 <= M9', (SELECT valor FROM @oltp WHERE medida LIKE 'M10 %'), (SELECT valor FROM @oltp WHERE medida LIKE 'M9 %')) x;
