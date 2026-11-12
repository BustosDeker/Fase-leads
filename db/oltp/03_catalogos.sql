/*==============================================================================
 03_catalogos.sql - Catalogos iniciales de INBESTIGA_TESIS para la app (IDEMPOTENTE).
 Se insertan solo los registros que faltan (clave natural), por lo que puede
 ejecutarse varias veces. Todos los valores son de configuracion de prueba:
 precios, topes y reglas deben ser validados por la gestion del negocio.

 Nota: NO combinar con simulacion_informe/02_OLTP_Poblamiento_LEADS.sql, que
 inserta sus propios catalogos con IDs fijos sobre una base vacia
 (ver `npm run seed -- --informe`).
==============================================================================*/
USE INBESTIGA_TESIS;
GO
SET NOCOUNT ON;
GO

/*------------------------------------------------------------------ Universidades */
INSERT INTO dbo.UNIVERSIDAD (nombre, tipo, departamento, distrito, norma_citacion, atendida)
SELECT v.nombre, v.tipo, v.departamento, v.distrito, v.norma, 1
FROM (VALUES
    (N'Universidad Nacional de Trujillo',          'PUBLICA', N'La Libertad', N'Trujillo',  'APA'),
    (N'Universidad Privada Antenor Orrego',        'PRIVADA', N'La Libertad', N'Trujillo',  'APA'),
    (N'Universidad César Vallejo',                 'PRIVADA', N'La Libertad', N'Trujillo',  'APA'),
    (N'Universidad Privada del Norte',             'PRIVADA', N'La Libertad', N'Trujillo',  'APA'),
    (N'Universidad Nacional Mayor de San Marcos',  'PUBLICA', N'Lima',        N'Lima',      'APA'),
    (N'Universidad Nacional de Cajamarca',         'PUBLICA', N'Cajamarca',   N'Cajamarca', 'Vancouver')
) v(nombre, tipo, departamento, distrito, norma)
WHERE NOT EXISTS (SELECT 1 FROM dbo.UNIVERSIDAD u WHERE u.nombre = v.nombre);
GO

/*------------------------------------------------------------------ Carreras */
INSERT INTO dbo.CARRERA (nombre, facultad, atendida)
SELECT v.nombre, v.facultad, 1
FROM (VALUES
    (N'Ingeniería de Sistemas',              N'Facultad de Ingeniería'),
    (N'Ingeniería Industrial',               N'Facultad de Ingeniería'),
    (N'Ingeniería Civil',                    N'Facultad de Ingeniería'),
    (N'Administración',                      N'Facultad de Ciencias Económicas'),
    (N'Contabilidad y Finanzas',             N'Facultad de Ciencias Económicas'),
    (N'Economía',                            N'Facultad de Ciencias Económicas'),
    (N'Derecho y Ciencias Políticas',        N'Facultad de Derecho y Ciencias Políticas'),
    (N'Enfermería',                          N'Facultad de Enfermería'),
    (N'Medicina',                            N'Facultad de Medicina'),
    (N'Educación Primaria',                  N'Facultad de Educación y Ciencias de la Comunicación'),
    (N'Ciencias de la Comunicación',         N'Facultad de Educación y Ciencias de la Comunicación'),
    (N'Psicología',                          N'Facultad de Ciencias Sociales')
) v(nombre, facultad)
WHERE NOT EXISTS (SELECT 1 FROM dbo.CARRERA c WHERE c.nombre = v.nombre);
GO

/*------------------------------------------------------------------ Canales y campanias */
INSERT INTO dbo.CANAL (nombre, tipo, plataforma)
SELECT v.nombre, v.tipo, v.plataforma
FROM (VALUES
    (N'Redes sociales (Instagram)', N'Redes sociales',           N'Instagram'),
    (N'Redes sociales (TikTok)',    N'Redes sociales',           N'TikTok'),
    (N'Redes sociales (Facebook)',  N'Redes sociales',           N'Facebook'),
    (N'Convenio universitario',     N'Convenios universitarios', N'Correo institucional'),
    (N'Referidos',                  N'Referidos',                N'Boca a boca'),
    (N'WhatsApp directo',           N'Mensajería directa',       N'WhatsApp')
) v(nombre, tipo, plataforma)
WHERE NOT EXISTS (SELECT 1 FROM dbo.CANAL c WHERE c.nombre = v.nombre);
GO

INSERT INTO dbo.CAMPANIA (canal_id, nombre, fecha_inicio, fecha_fin, inversion)
SELECT c.canal_id, v.nombre, v.ini, v.fin, v.inversion
FROM (VALUES
    (N'Redes sociales (Instagram)', N'Tesis sin estrés – Instagram (may–jul)',  '2026-05-01', '2026-07-31', 1800.00),
    (N'Redes sociales (Instagram)', N'Sustenta en 2026 – Instagram (ago–nov)',  '2026-08-01', '2026-11-30', 2100.00),
    (N'Redes sociales (TikTok)',    N'Tips de tesis – TikTok (may–jul)',        '2026-05-01', '2026-07-31', 1500.00),
    (N'Redes sociales (TikTok)',    N'Reto 30 días – TikTok (ago–nov)',         '2026-08-01', '2026-11-30', 1700.00),
    (N'Redes sociales (Facebook)',  N'Asesoría integral – Facebook (2026)',     '2026-05-01', '2026-11-30', 1200.00),
    (N'Convenio universitario',     N'Convenio facultades 2026-I',              '2026-04-01', '2026-07-31',    0.00),
    (N'Convenio universitario',     N'Convenio facultades 2026-II',             '2026-08-01', NULL,            0.00)
) v(canal, nombre, ini, fin, inversion)
INNER JOIN dbo.CANAL c ON c.nombre = v.canal
WHERE NOT EXISTS (SELECT 1 FROM dbo.CAMPANIA x WHERE x.nombre = v.nombre);
GO

/*------------------------------------------------------------------ Servicios */
INSERT INTO dbo.SERVICIO (familia, nombre, tipo_servicio, paquete, modalidad, precio_referencia, activo)
SELECT v.familia, v.nombre, v.tipo, v.paquete, v.modalidad, v.precio, 1
FROM (VALUES
    (N'Asesoría integral de tesis', N'Asesoría integral de tesis – paquete completo',     'COMPLETO',       N'Completo',        N'Virtual', 2400.00),
    (N'Asesoría integral de tesis', N'Asesoría integral de tesis – plan acompañamiento',  'COMPLETO',       N'Acompañamiento',  N'Virtual', 1900.00),
    (N'Asesoría por etapa',         N'Asesoría de proyecto de tesis',                     'PROYECTO',       N'Proyecto',        N'Virtual', 1100.00),
    (N'Asesoría por etapa',         N'Asesoría de informe final',                         'INFORME',        N'Informe final',   N'Virtual', 1400.00),
    (N'Revisión y correcciones',    N'Revisión y correcciones de tesis',                  'INFORME',        N'Revisión',        N'Virtual',  650.00),
    (N'Servicios complementarios',  N'Preparación de sustentación',                       'COMPLEMENTARIO', N'Sustentación',    N'Virtual',  450.00),
    (N'Servicios complementarios',  N'Diagnóstico de tesis',                              'DIAGNOSTICO',    N'Diagnóstico',     N'Virtual',    0.00)
) v(familia, nombre, tipo, paquete, modalidad, precio)
WHERE NOT EXISTS (SELECT 1 FROM dbo.SERVICIO s WHERE s.nombre = v.nombre);
GO

/*------------------------------------------------------------------ Asesores (ficticios) */
-- El «Agente IA» NO es una fila de ASESOR: es el miembro 0 de Dim_Asesor (asesor_id NULL en el OLTP).
INSERT INTO dbo.ASESOR (nombre, rol, equipo, especialidad, capacidad_maxima, estado)
SELECT v.nombre, v.rol, v.equipo, v.especialidad, v.capacidad, 'ACTIVO'
FROM (VALUES
    (N'Carla Rojas Benites',    'COMERCIAL', N'Equipo comercial',        N'Negociación y propuestas',       40),
    (N'Diego Salinas Ruiz',     'COMERCIAL', N'Equipo comercial',        N'Convenios universitarios',       35),
    (N'Mariela Torres Vega',    'ACADEMICO', N'Asesores especialistas',  N'Ingeniería y tecnología',        25),
    (N'Jorge Paredes León',     'ACADEMICO', N'Asesores especialistas',  N'Ciencias económicas',            25),
    (N'Lucía Fernández Arce',   'ACADEMICO', N'Asesores especialistas',  N'Ciencias de la salud',           20),
    (N'Ricardo Gamboa Cruz',    'ACADEMICO', N'Asesores especialistas',  N'Derecho y ciencias sociales',    20)
) v(nombre, rol, equipo, especialidad, capacidad)
WHERE NOT EXISTS (SELECT 1 FROM dbo.ASESOR a WHERE a.nombre = v.nombre);
GO

INSERT INTO dbo.ASESOR_CARRERA (asesor_id, carrera_id)
SELECT a.asesor_id, c.carrera_id
FROM (VALUES
    (N'Mariela Torres Vega',  N'Ingeniería de Sistemas'), (N'Mariela Torres Vega',  N'Ingeniería Industrial'),
    (N'Mariela Torres Vega',  N'Ingeniería Civil'),
    (N'Jorge Paredes León',   N'Administración'),         (N'Jorge Paredes León',   N'Contabilidad y Finanzas'),
    (N'Jorge Paredes León',   N'Economía'),
    (N'Lucía Fernández Arce', N'Enfermería'),             (N'Lucía Fernández Arce', N'Medicina'),
    (N'Lucía Fernández Arce', N'Psicología'),
    (N'Ricardo Gamboa Cruz',  N'Derecho y Ciencias Políticas'), (N'Ricardo Gamboa Cruz', N'Educación Primaria'),
    (N'Ricardo Gamboa Cruz',  N'Ciencias de la Comunicación')
) v(asesor, carrera)
INNER JOIN dbo.ASESOR a  ON a.nombre = v.asesor
INNER JOIN dbo.CARRERA c ON c.nombre = v.carrera
WHERE NOT EXISTS (SELECT 1 FROM dbo.ASESOR_CARRERA x WHERE x.asesor_id = a.asesor_id AND x.carrera_id = c.carrera_id);
GO

/*------------------------------------------------------------------ Tarifas (servicio x carrera) */
-- precio_base = precio_referencia x factor de la carrera (redondeado a 10); minimo = 80 %; tope de descuento 10–15 %.
INSERT INTO dbo.TARIFA (servicio_id, carrera_id, etapa_academica, precio_base, precio_minimo, tope_descuento_pct, vigente_desde, vigente_hasta, activo)
SELECT s.servicio_id, c.carrera_id, NULL,
       base.precio_base,
       CAST(ROUND(base.precio_base * 0.80, -1) AS DECIMAL(10,2)),
       CASE WHEN s.tipo_servicio IN ('COMPLETO') THEN 15.00 ELSE 10.00 END,
       '2026-01-01', NULL, 1
FROM dbo.SERVICIO s
CROSS JOIN dbo.CARRERA c
CROSS APPLY (SELECT factor = CASE
                 WHEN c.nombre IN (N'Medicina') THEN 1.25
                 WHEN c.nombre LIKE N'Ingeniería%' THEN 1.10
                 WHEN c.nombre IN (N'Educación Primaria', N'Ciencias de la Comunicación') THEN 0.90
                 ELSE 1.00 END) f
CROSS APPLY (SELECT precio_base = CAST(ROUND(s.precio_referencia * f.factor, -1) AS DECIMAL(10,2))) base
WHERE s.tipo_servicio <> 'DIAGNOSTICO'
  AND NOT EXISTS (SELECT 1 FROM dbo.TARIFA t WHERE t.servicio_id = s.servicio_id AND t.carrera_id = c.carrera_id);
GO

/*------------------------------------------------------------------ Reglas de precio */
INSERT INTO dbo.REGLA_PRECIO (nombre, tipo, factor, valor_condicion, umbral_dias, porcentaje, vigente_desde, vigente_hasta, activa)
SELECT v.nombre, v.tipo, v.factor, v.valor, v.umbral, v.pct, '2026-01-01', NULL, 1
FROM (VALUES
    (N'Descuento por convenio UNT',           'DESCUENTO', 'UNIVERSIDAD', N'Universidad Nacional de Trujillo', NULL,  5.00),
    (N'Descuento por pago al contado',        'DESCUENTO', 'FORMA_PAGO',  N'CONTADO',                          NULL,  5.00),
    (N'Descuento por avance mayor a 50 %',    'DESCUENTO', 'AVANCE',      N'>50',                              NULL,  5.00),
    (N'Promoción de temporada',               'DESCUENTO', 'PROMOCION',   N'TEMPORADA',                        NULL,  3.00),
    (N'Recargo por urgencia (< 15 días)',     'RECARGO',   'URGENCIA',    NULL,                                15,   15.00),
    (N'Recargo por tesis experimental',       'RECARGO',   'TIPO_TESIS',  N'EXPERIMENTAL',                     NULL, 10.00)
) v(nombre, tipo, factor, valor, umbral, pct)
WHERE NOT EXISTS (SELECT 1 FROM dbo.REGLA_PRECIO r WHERE r.nombre = v.nombre);
GO

/*------------------------------------------------------------------ Entregables */
INSERT INTO dbo.ENTREGABLE (nombre, tipo_entregable, descripcion, precio_extra, activo)
SELECT v.nombre, v.tipo, v.descr, v.precio, 1
FROM (VALUES
    (N'Plan de trabajo y cronograma',           'ESTANDAR',  N'Cronograma de hitos acordado con el estudiante.',            NULL),
    (N'Sesiones de asesoría virtual',           'PARAMETRO', N'Sesiones 1 a 1 por videollamada.',                           NULL),
    (N'Rondas de levantamiento de observaciones','PARAMETRO',N'Rondas incluidas para atender observaciones del jurado.',    NULL),
    (N'Reporte de similitud',                   'PARAMETRO', N'Reporte de similitud con umbral objetivo.',                  NULL),
    (N'Simulacro de sustentación',              'PARAMETRO', N'Ensayo de la sustentación con retroalimentación.',           NULL),
    (N'Ronda extra de observaciones',           'EXTRA',     N'Ronda adicional fuera de las incluidas.',                    150.00),
    (N'Simulacro extra de sustentación',        'EXTRA',     N'Simulacro adicional.',                                       120.00),
    (N'Análisis estadístico (SPSS/R)',          'EXTRA',     N'Procesamiento y reporte estadístico de resultados.',         350.00),
    (N'Traducción del resumen (abstract)',      'EXTRA',     N'Traducción profesional del resumen al inglés.',               80.00)
) v(nombre, tipo, descr, precio)
WHERE NOT EXISTS (SELECT 1 FROM dbo.ENTREGABLE e WHERE e.nombre = v.nombre);
GO

INSERT INTO dbo.SERVICIO_ENTREGABLE (servicio_id, entregable_id, cantidad_incluida, umbral_pct, frecuencia_dias, duracion_min, precio_unidad_extra)
SELECT s.servicio_id, e.entregable_id, v.cant, v.umbral, v.frec, v.dur, v.extra
FROM (VALUES
    (N'Asesoría integral de tesis – paquete completo',    N'Plan de trabajo y cronograma',            1,  NULL, NULL, NULL, NULL),
    (N'Asesoría integral de tesis – paquete completo',    N'Sesiones de asesoría virtual',           16,  NULL,    7,   60, 70.00),
    (N'Asesoría integral de tesis – paquete completo',    N'Rondas de levantamiento de observaciones',3,  NULL, NULL, NULL, 150.00),
    (N'Asesoría integral de tesis – paquete completo',    N'Reporte de similitud',                    3, 20.00, NULL, NULL, 40.00),
    (N'Asesoría integral de tesis – paquete completo',    N'Simulacro de sustentación',               2,  NULL, NULL,   45, 120.00),
    (N'Asesoría integral de tesis – plan acompañamiento', N'Plan de trabajo y cronograma',            1,  NULL, NULL, NULL, NULL),
    (N'Asesoría integral de tesis – plan acompañamiento', N'Sesiones de asesoría virtual',           10,  NULL,   10,   60, 70.00),
    (N'Asesoría integral de tesis – plan acompañamiento', N'Rondas de levantamiento de observaciones',2,  NULL, NULL, NULL, 150.00),
    (N'Asesoría integral de tesis – plan acompañamiento', N'Reporte de similitud',                    2, 20.00, NULL, NULL, 40.00),
    (N'Asesoría de proyecto de tesis',                    N'Sesiones de asesoría virtual',            6,  NULL,    7,   60, 70.00),
    (N'Asesoría de proyecto de tesis',                    N'Reporte de similitud',                    1, 20.00, NULL, NULL, 40.00),
    (N'Asesoría de informe final',                        N'Sesiones de asesoría virtual',            8,  NULL,    7,   60, 70.00),
    (N'Asesoría de informe final',                        N'Rondas de levantamiento de observaciones',2,  NULL, NULL, NULL, 150.00),
    (N'Asesoría de informe final',                        N'Reporte de similitud',                    2, 20.00, NULL, NULL, 40.00),
    (N'Revisión y correcciones de tesis',                 N'Rondas de levantamiento de observaciones',1,  NULL, NULL, NULL, 150.00),
    (N'Revisión y correcciones de tesis',                 N'Reporte de similitud',                    1, 20.00, NULL, NULL, 40.00),
    (N'Preparación de sustentación',                      N'Simulacro de sustentación',               2,  NULL, NULL,   45, 120.00)
) v(servicio, entregable, cant, umbral, frec, dur, extra)
INNER JOIN dbo.SERVICIO s   ON s.nombre = v.servicio
INNER JOIN dbo.ENTREGABLE e ON e.nombre = v.entregable
WHERE NOT EXISTS (SELECT 1 FROM dbo.SERVICIO_ENTREGABLE x WHERE x.servicio_id = s.servicio_id AND x.entregable_id = e.entregable_id);
GO

/*------------------------------------------------------------------ Plantillas de mensaje */
INSERT INTO dbo.PLANTILLA_MENSAJE (nombre, categoria, texto, aprobada_meta, fecha_aprobacion, activa)
SELECT v.nombre, v.cat, v.texto, 0, NULL, 1
FROM (VALUES
    (N'Seguimiento de propuesta', 'PROPUESTA', N'Hola {nombre}, ¿pudiste revisar la propuesta v{version}? Sigue vigente hasta el {vigencia}. Si prefieres, coordinamos una llamada.'),
    (N'Recordatorio de cita',     'OTRO',      N'Hola {nombre}, te recordamos tu cita virtual el {fecha} a las {hora}. Enlace: {enlace}.')
) v(nombre, cat, texto)
WHERE NOT EXISTS (SELECT 1 FROM dbo.PLANTILLA_MENSAJE p WHERE p.nombre = v.nombre);
GO

-- El catálogo de objeciones y las transiciones de estado se cargan en 02_ampliacion_app.sql
-- (son parte de la ampliación de la app y deben existir también en el escenario del informe).
