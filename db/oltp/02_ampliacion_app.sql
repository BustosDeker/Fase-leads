/*==============================================================================
 02_ampliacion_app.sql - Ampliacion del OLTP INBESTIGA_TESIS para la APLICACION
 (se ejecuta DESPUES de 01_OLTP_ER.sql; es IDEMPOTENTE: puede repetirse).

 No modifica tablas de BUYERS ni las reglas del informe. Agrega lo que la app
 necesita para operar el Agente Negociador y que el DDL v2 + Anexo A no traen.
 Cada cambio esta justificado en docs/DECISIONES.md (seccion "Ampliacion OLTP").

   1. es_demo en CONTACTO y OPORTUNIDAD_COMERCIAL (datos sinteticos vs. demo real)
   2. MENSAJE.contenido -> NVARCHAR (WhatsApp trae emojis) + id_externo para no duplicar
   3. CONVERSACION: canal de mensajeria, chat_id, oportunidad y control humano
   4. CONTACTO.fecha_revocacion + CONSENTIMIENTO_HISTORIAL (Ley 29733)
   5. PERFIL_NEGOCIACION.presupuesto_orientativo (tabla 4 del informe)
   6. ESCALAMIENTO: motivos adicionales (sec. 4.4.2) y resumen en texto
   7. OBJECION.respuesta_agente + CATALOGO_OBJECION (editable)
   8. TRANSICION_ESTADO_OPORTUNIDAD + OPORTUNIDAD_EVENTO + trigger de validacion
   9. AGENTE_TURNO (auditoria: mensaje, tools, latencia, modelo)
==============================================================================*/
USE INBESTIGA_TESIS;
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/*------------------------------------------------------------------ 1. es_demo */
IF COL_LENGTH('dbo.CONTACTO', 'es_demo') IS NULL
    ALTER TABLE dbo.CONTACTO ADD es_demo BIT NOT NULL CONSTRAINT DF_CONTACTO_ES_DEMO DEFAULT 0;
GO
IF COL_LENGTH('dbo.CONTACTO', 'whatsapp_habilitado') IS NULL
    ALTER TABLE dbo.CONTACTO ADD whatsapp_habilitado BIT NOT NULL
        CONSTRAINT DF_CONTACTO_WHATSAPP_HABILITADO DEFAULT 0;
GO
IF COL_LENGTH('dbo.OPORTUNIDAD_COMERCIAL', 'es_demo') IS NULL
    ALTER TABLE dbo.OPORTUNIDAD_COMERCIAL ADD es_demo BIT NOT NULL CONSTRAINT DF_OPORT_ES_DEMO DEFAULT 0;
GO

/*------------------------------------------------------------------ 2. MENSAJE */
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.MENSAJE')
           AND name = 'contenido' AND system_type_id = TYPE_ID('varchar'))
    ALTER TABLE dbo.MENSAJE ALTER COLUMN contenido NVARCHAR(2000) NULL;
GO
IF COL_LENGTH('dbo.MENSAJE', 'id_externo') IS NULL
    ALTER TABLE dbo.MENSAJE ADD id_externo VARCHAR(120) NULL;          -- id del mensaje en OpenWA
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_MENSAJE_ID_EXTERNO')
    CREATE UNIQUE INDEX UX_MENSAJE_ID_EXTERNO ON dbo.MENSAJE(id_externo) WHERE id_externo IS NOT NULL;
GO

/*------------------------------------------------------------------ 3. CONVERSACION */
IF COL_LENGTH('dbo.CONVERSACION', 'canal_mensajeria') IS NULL
    ALTER TABLE dbo.CONVERSACION ADD canal_mensajeria VARCHAR(15) NOT NULL
        CONSTRAINT DF_CONV_CANAL_MSG DEFAULT 'WHATSAPP'
        CONSTRAINT CK_CONV_CANAL_MSG CHECK (canal_mensajeria IN ('WHATSAPP','SIMULADOR','HISTORICO'));
GO
IF COL_LENGTH('dbo.CONVERSACION', 'chat_id') IS NULL
    ALTER TABLE dbo.CONVERSACION ADD chat_id VARCHAR(60) NULL;         -- 51XXXXXXXXX@c.us o sim:<id>
GO
IF COL_LENGTH('dbo.CONVERSACION', 'oportunidad_id') IS NULL
    ALTER TABLE dbo.CONVERSACION ADD oportunidad_id INT NULL
        CONSTRAINT FK_CONVERSACION_OPORT REFERENCES dbo.OPORTUNIDAD_COMERCIAL(oportunidad_id);  -- FK_CONV_OPORT ya existe (Anexo A)
GO
IF COL_LENGTH('dbo.CONVERSACION', 'control_humano') IS NULL
    ALTER TABLE dbo.CONVERSACION ADD control_humano BIT NOT NULL CONSTRAINT DF_CONV_CTRL_HUMANO DEFAULT 0;
GO
IF COL_LENGTH('dbo.CONVERSACION', 'asesor_control_id') IS NULL
    ALTER TABLE dbo.CONVERSACION ADD asesor_control_id INT NULL
        CONSTRAINT FK_CONV_ASESOR_CTRL REFERENCES dbo.ASESOR(asesor_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CONVERSACION_CHAT')
    CREATE INDEX IX_CONVERSACION_CHAT ON dbo.CONVERSACION(chat_id, estado);
GO

/*------------------------------------------------------------------ 4. Consentimiento */
IF COL_LENGTH('dbo.CONTACTO', 'fecha_revocacion') IS NULL
    ALTER TABLE dbo.CONTACTO ADD fecha_revocacion DATETIME2 NULL;
GO
IF OBJECT_ID('dbo.CONSENTIMIENTO_HISTORIAL') IS NULL
CREATE TABLE dbo.CONSENTIMIENTO_HISTORIAL (
    consentimiento_id   INT IDENTITY(1,1) PRIMARY KEY,
    contacto_id         INT NOT NULL,
    fecha               DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    accion              VARCHAR(10) NOT NULL,
    medio               VARCHAR(20) NOT NULL,                          -- WHATSAPP, SIMULADOR, PANEL, BUYERS
    finalidad           NVARCHAR(200) NULL,
    evidencia           NVARCHAR(300) NULL,                            -- texto que expresa la voluntad
    CONSTRAINT FK_CONSENT_CONTACTO FOREIGN KEY (contacto_id) REFERENCES dbo.CONTACTO(contacto_id),
    CONSTRAINT CK_CONSENT_ACCION CHECK (accion IN ('OTORGA','REVOCA'))
);
GO

/*------------------------------------------------------------------ 5. PERFIL_NEGOCIACION */
IF COL_LENGTH('dbo.PERFIL_NEGOCIACION', 'presupuesto_orientativo') IS NULL
    ALTER TABLE dbo.PERFIL_NEGOCIACION ADD presupuesto_orientativo DECIMAL(10,2) NULL;
GO

/*------------------------------------------------------------------ 6. ESCALAMIENTO */
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ESCALAMIENTO_MOTIVO'
           AND definition NOT LIKE '%PRECIO_NO_CONFIGURADO%')
    ALTER TABLE dbo.ESCALAMIENTO DROP CONSTRAINT CK_ESCALAMIENTO_MOTIVO;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ESCALAMIENTO_MOTIVO')
    ALTER TABLE dbo.ESCALAMIENTO ADD CONSTRAINT CK_ESCALAMIENTO_MOTIVO CHECK (motivo IN
        ('CLIENTE_PIDE_ESPECIALISTA','BOT_NO_RESPONDE','FUERA_COBERTURA','OBJECION_REPETIDA',
         'DESCUENTO_EXCEDE_TOPE','RECLAMO_PAGO','RIESGO_ABANDONO',
         -- agregados (informe 4.4.2 "Derivacion humana" y 6.1 del prompt)
         'PRECIO_NO_CONFIGURADO','EXCEPCION_CONTRACTUAL','CONSULTA_ACADEMICA_COMPLEJA',
         'INCERTIDUMBRE_AGENTE','POSIBLE_INYECCION'));
GO
IF COL_LENGTH('dbo.ESCALAMIENTO', 'resumen') IS NULL
    ALTER TABLE dbo.ESCALAMIENTO ADD resumen NVARCHAR(1000) NULL;       -- resumen para el especialista
GO

/*------------------------------------------------------------------ 7. Objeciones */
IF COL_LENGTH('dbo.OBJECION', 'respuesta_agente') IS NULL
    ALTER TABLE dbo.OBJECION ADD respuesta_agente NVARCHAR(1000) NULL;
GO
IF OBJECT_ID('dbo.CATALOGO_OBJECION') IS NULL
CREATE TABLE dbo.CATALOGO_OBJECION (                                   -- editable por el administrador
    catalogo_objecion_id INT IDENTITY(1,1) PRIMARY KEY,
    grupo                VARCHAR(40)  NOT NULL,                        -- mismo texto que OBJECION.grupo
    tipo                 VARCHAR(60)  NOT NULL,                        -- mismo texto que OBJECION.tipo
    palabras_clave       NVARCHAR(400) NULL,                           -- separadas por '|', para el agente mock
    respuesta_base       NVARCHAR(1000) NOT NULL,                      -- informacion respaldada
    criterio_escalamiento NVARCHAR(300) NULL,
    max_repeticiones     INT NOT NULL DEFAULT 2,                       -- al llegar, se escala
    permite_descuento    BIT NOT NULL DEFAULT 0,                       -- solo dentro de TARIFA.tope_descuento_pct
    activo               BIT NOT NULL DEFAULT 1,
    CONSTRAINT UQ_CATALOGO_OBJECION UNIQUE (grupo, tipo)
);
GO

/*------------------------------------------------------------------ 8. Maquina de estados */
IF OBJECT_ID('dbo.TRANSICION_ESTADO_OPORTUNIDAD') IS NULL
CREATE TABLE dbo.TRANSICION_ESTADO_OPORTUNIDAD (
    estado_origen   VARCHAR(30) NOT NULL,
    estado_destino  VARCHAR(30) NOT NULL,
    evento          VARCHAR(60) NOT NULL,
    CONSTRAINT PK_TRANSICION_ESTADO PRIMARY KEY (estado_origen, estado_destino)
);
GO
IF OBJECT_ID('dbo.OPORTUNIDAD_EVENTO') IS NULL
CREATE TABLE dbo.OPORTUNIDAD_EVENTO (                                  -- linea de tiempo de la ficha nominal
    evento_id        INT IDENTITY(1,1) PRIMARY KEY,
    oportunidad_id   INT NOT NULL,
    fecha            DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    estado_anterior  VARCHAR(30) NULL,
    estado_nuevo     VARCHAR(30) NULL,
    evento           VARCHAR(60) NOT NULL,                             -- ej. DIAGNOSTICO_ENTREGADO, PROPUESTA_V2
    origen           VARCHAR(15) NOT NULL DEFAULT 'AGENTE',
    detalle          NVARCHAR(500) NULL,
    CONSTRAINT FK_OPEV_OPORT FOREIGN KEY (oportunidad_id) REFERENCES dbo.OPORTUNIDAD_COMERCIAL(oportunidad_id),
    CONSTRAINT CK_OPEV_ORIGEN CHECK (origen IN ('AGENTE','HUMANO','SISTEMA','PAYERS','SEED'))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OPEV_OPORT_FECHA')
    CREATE INDEX IX_OPEV_OPORT_FECHA ON dbo.OPORTUNIDAD_EVENTO(oportunidad_id, fecha);
GO
-- Valida en la BD que todo cambio de estado sea una transicion permitida (ademas del CHECK de estados).
CREATE OR ALTER TRIGGER dbo.TR_OPORTUNIDAD_TRANSICION ON dbo.OPORTUNIDAD_COMERCIAL
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT UPDATE(estado) RETURN;
    IF EXISTS (
        SELECT 1
        FROM inserted i
        INNER JOIN deleted d ON d.oportunidad_id = i.oportunidad_id
        WHERE i.estado <> d.estado
          AND NOT EXISTS (SELECT 1 FROM dbo.TRANSICION_ESTADO_OPORTUNIDAD t
                          WHERE t.estado_origen = d.estado AND t.estado_destino = i.estado))
    BEGIN
        THROW 51001, N'Transición de estado de la oportunidad no permitida.', 1;
    END
END;
GO

/*------------------------------------------------------------------ 9. Auditoria del agente */
IF OBJECT_ID('dbo.AGENTE_TURNO') IS NULL
CREATE TABLE dbo.AGENTE_TURNO (
    turno_id            INT IDENTITY(1,1) PRIMARY KEY,
    conversacion_id     INT NOT NULL,
    oportunidad_id      INT NULL,
    mensaje_entrada_id  INT NULL,
    mensaje_salida_id   INT NULL,
    fecha               DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    proveedor_llm       VARCHAR(20) NOT NULL,                          -- anthropic, openai, gemini, mock
    modelo              VARCHAR(80) NULL,
    latencia_ms         INT NULL,
    tools_json          NVARCHAR(MAX) NULL,                            -- tools invocadas, parametros y resultado
    sospecha_inyeccion  BIT NOT NULL DEFAULT 0,
    error               NVARCHAR(1000) NULL,
    CONSTRAINT FK_TURNO_CONV   FOREIGN KEY (conversacion_id)    REFERENCES dbo.CONVERSACION(conversacion_id),
    CONSTRAINT FK_TURNO_OPORT  FOREIGN KEY (oportunidad_id)     REFERENCES dbo.OPORTUNIDAD_COMERCIAL(oportunidad_id),
    CONSTRAINT FK_TURNO_MSG_IN FOREIGN KEY (mensaje_entrada_id) REFERENCES dbo.MENSAJE(mensaje_id),
    CONSTRAINT FK_TURNO_MSG_OUT FOREIGN KEY (mensaje_salida_id) REFERENCES dbo.MENSAJE(mensaje_id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_TURNO_CONV_FECHA')
    CREATE INDEX IX_TURNO_CONV_FECHA ON dbo.AGENTE_TURNO(conversacion_id, fecha);
GO

/*------------------------------------------------------------------ Indices de apoyo a la app */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OPORT_LEAD_ESTADO')
    CREATE INDEX IX_OPORT_LEAD_ESTADO ON dbo.OPORTUNIDAD_COMERCIAL(lead_id, estado);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CITA_ASESOR_INICIO')
    CREATE INDEX IX_CITA_ASESOR_INICIO ON dbo.CITA_VIRTUAL(asesor_id, inicio);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CONTACTO_NOMBRE')
    CREATE INDEX IX_CONTACTO_NOMBRE ON dbo.CONTACTO(apellidos, nombres);
GO

/*================================================================== DATOS BASE DE LA AMPLIACIÓN
 Se cargan aquí (idempotente) para que existan con cualquier poblamiento, incluido el del informe.
==================================================================*/
SET NOCOUNT ON;
GO
/*------------------------------------------------------------------ Catalogo de objeciones */
INSERT INTO dbo.CATALOGO_OBJECION (grupo, tipo, palabras_clave, respuesta_base, criterio_escalamiento, max_repeticiones, permite_descuento)
SELECT v.grupo, v.tipo, v.claves, v.respuesta, v.criterio, v.maxrep, v.desc_ok
FROM (VALUES
    ('Precio', 'Precio alto',
     N'caro|muy caro|precio alto|elevado|cuesta mucho|descuento|rebaja|más barato|mas barato',
     N'Entiendo. El precio incluye las sesiones, las rondas de observaciones y los reportes de similitud indicados en la propuesta. Puedo revisar una versión con un ajuste dentro de las condiciones vigentes o un plan con menos sesiones.',
     N'Si pide un descuento mayor al tope o un precio menor al mínimo, escalar (DESCUENTO_EXCEDE_TOPE).', 2, 1),
    ('Presupuesto', 'Sin presupuesto por ahora',
     N'no tengo dinero|no tengo plata|sin presupuesto|ahora no puedo pagar|más adelante|mas adelante|fin de mes',
     N'Gracias por contármelo. Podemos dejar la propuesta vigente y, si te sirve, revisar un servicio por etapa (solo proyecto o solo informe) que tiene un monto menor.',
     N'Si menciona dificultades de pago o pide fraccionar más allá de lo estándar, escalar a coordinación.', 2, 0),
    ('Plazo', 'Plazo de entrega',
     N'plazo|tiempo|muy lento|demora|urgente|no llego|fecha límite|fecha limite|rápido|rapido',
     N'El cronograma se arma con tu fecha límite. Si es menor a 15 días aplica un recargo por urgencia que te muestro en la propuesta; si no, trabajamos con el plan estándar.',
     N'Si la fecha límite es inviable para el alcance, escalar a un especialista.', 2, 0),
    ('Confianza / garantías', 'Confianza y ética',
     N'confianza|estafa|seguro|garantía|garantia|plagio|copia|ético|etico|me la hacen|hacer mi tesis',
     N'Te acompañamos como asesores: tú eres el autor de tu tesis. Revisamos similitud con reporte y te entregamos observaciones y guía metodológica; no prometemos la aprobación del jurado.',
     N'Si insiste en que se le redacte la tesis completa, explicar el límite ético y escalar a coordinación.', 2, 0),
    ('Autonomía', 'Lo haré por mi cuenta',
     N'lo haré solo|lo hare solo|yo solo|por mi cuenta|no necesito|puedo solo',
     N'¡Me parece muy bien! Si te ayuda, el diagnóstico gratuito ya te deja una ruta clara. Y si más adelante quieres solo una revisión puntual, también la ofrecemos.',
     NULL, 2, 0),
    ('Competencia', 'Oferta de la competencia',
     N'otra empresa|otro asesor|más barato en|mas barato en|me ofrecieron|competencia|otro lugar',
     N'Es válido comparar. Te sugiero revisar qué incluye cada oferta: número de sesiones, rondas de observaciones, reporte de similitud y simulacros. Te detallo los nuestros para que compares con la misma base.',
     N'Si pide igualar un precio externo por debajo del mínimo, escalar (DESCUENTO_EXCEDE_TOPE).', 2, 0),
    ('Decisión de terceros', 'Consulta con familia o pareja',
     N'mis papás|mis papas|mi mamá|mi mama|mi papá|mi papa|mi pareja|consultar|lo converso|lo pienso',
     N'Claro, es una decisión importante. Te dejo el resumen de la propuesta para compartirlo; si quieres, podemos agendar una llamada corta con quien te apoya en la decisión.',
     NULL, 2, 0),
    ('Alcance', 'Entregables incluidos',
     N'qué incluye|que incluye|incluye|entregables|alcance|cuántas sesiones|cuantas sesiones',
     N'La propuesta detalla los entregables: sesiones, rondas de observaciones, reportes de similitud y simulacros. Si necesitas algo adicional, lo agrego como extra con su precio.',
     N'Si pide entregables no catalogados, escalar (EXCEPCION_CONTRACTUAL).', 2, 0)
) v(grupo, tipo, claves, respuesta, criterio, maxrep, desc_ok)
WHERE NOT EXISTS (SELECT 1 FROM dbo.CATALOGO_OBJECION c WHERE c.grupo = v.grupo AND c.tipo = v.tipo);
GO

/*------------------------------------------------------------------ Transiciones permitidas (informe, tabla 6) */
INSERT INTO dbo.TRANSICION_ESTADO_OPORTUNIDAD (estado_origen, estado_destino, evento)
SELECT v.o, v.d, v.e
FROM (VALUES
    ('ABIERTA',           'EN_DIAGNOSTICO',    'DIAGNOSTICO_SOLICITADO'),
    ('EN_DIAGNOSTICO',    'APTA_PARA_COTIZAR', 'APTITUD_VERIFICADA'),
    ('APTA_PARA_COTIZAR', 'EN_NEGOCIACION',    'PRIMERA_PROPUESTA_PRESENTADA'),
    ('EN_NEGOCIACION',    'ACEPTADA',          'ACEPTACION_EXPRESA'),
    ('ACEPTADA',          'TRANSFERIDA',       'ACUERDO_TRANSFERIDO_A_PAYERS'),
    ('TRANSFERIDA',       'PAYER_CONFIRMADO',  'CONFIRMACION_PAYERS'),
    ('ABIERTA',           'DESCARTADA',        'DESCARTE'),
    ('EN_DIAGNOSTICO',    'DESCARTADA',        'DESCARTE'),
    ('APTA_PARA_COTIZAR', 'DESCARTADA',        'DESCARTE'),
    ('EN_NEGOCIACION',    'DESCARTADA',        'DESCARTE'),
    ('ACEPTADA',          'DESCARTADA',        'DESCARTE'),
    ('TRANSFERIDA',       'DESCARTADA',        'DESCARTE')
) v(o, d, e)
WHERE NOT EXISTS (SELECT 1 FROM dbo.TRANSICION_ESTADO_OPORTUNIDAD t WHERE t.estado_origen = v.o AND t.estado_destino = v.d);
GO
