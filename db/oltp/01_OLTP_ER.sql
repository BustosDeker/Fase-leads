/*==============================================================================
 01_OLTP_ER.sql  -  Modelo entidad-relacion transaccional de INBESTIGA_TESIS
 Parte 1: DDL base INBESTIGA_TESIS v2 (59 tablas, claves, CHECK, indices y vista).
 Parte 2: ampliacion de LEADS (Anexo A del informe): OPORTUNIDAD_COMERCIAL, CITA_VIRTUAL,
          CITA_HISTORIAL, TRANSFERENCIA_PAYER, CONVERSION_PAYER_REF y la columna oportunidad_id
          en PERFIL_NEGOCIACION, DIAGNOSTICO, PROPUESTA, SEGUIMIENTO_LEAD y ESCALAMIENTO.
 ATENCION: elimina y recrea la base INBESTIGA_TESIS. Guardar/abrir como UTF-8 con BOM.
==============================================================================*/
/*==============================================================================
 INBESTIGA_TESIS  -  BASE TRANSACCIONAL (OLTP)  -  VERSION 2  -  SOLO ESTRUCTURA
 Startup de asesoria de tesis con agente IA por WhatsApp - Metodologia IMPULSE
 (BUYERS -> LEADS -> PAYERS -> CUSTOMERS)

 Contenido: base de datos, 59 tablas (bloques A a G), indices (bloque H) y la
 vista v_MargenCustomer (bloque J). NO incluye datos: el poblamiento esta en
 el script INBESTIGA_TESIS_02_POBLAMIENTO.sql.

 ATENCION: el script elimina la base INBESTIGA_TESIS si ya existe.
 Guardar/abrir el archivo como UTF-8 (con BOM) para ver bien las tildes.
==============================================================================
==============================================================================*/

USE master;
GO

IF DB_ID('INBESTIGA_TESIS') IS NOT NULL
BEGIN
    ALTER DATABASE INBESTIGA_TESIS SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE INBESTIGA_TESIS;
END
GO

CREATE DATABASE INBESTIGA_TESIS;
GO

USE INBESTIGA_TESIS;
GO

-- Necesario para columnas calculadas persistidas e indices filtrados (sqlcmd los trae en OFF)
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO


/*==============================================================================
 BLOQUE A. CATALOGOS Y CONFIGURACION (los edita el administrador)
==============================================================================*/

CREATE TABLE UNIVERSIDAD (
    universidad_id      INT IDENTITY(1,1) PRIMARY KEY,
    nombre              VARCHAR(150) NOT NULL,
    tipo                VARCHAR(20)  NULL,
    departamento        VARCHAR(100) NULL,
    distrito            VARCHAR(100) NULL,
    norma_citacion      VARCHAR(50)  NULL,                 -- APA, Vancouver, ISO segun reglamento
    atendida            BIT NOT NULL DEFAULT 1,            -- cobertura de la startup
    CONSTRAINT CK_UNIVERSIDAD_TIPO CHECK (tipo IS NULL OR tipo IN ('PUBLICA','PRIVADA'))
);
GO

CREATE TABLE CARRERA (
    carrera_id          INT IDENTITY(1,1) PRIMARY KEY,
    nombre              VARCHAR(120) NOT NULL,
    facultad            VARCHAR(120) NULL,
    atendida            BIT NOT NULL DEFAULT 1             -- cobertura de la startup
);
GO

CREATE TABLE CONTACTO (
    contacto_id             INT IDENTITY(1,1) PRIMARY KEY,
    nombres                 VARCHAR(100) NOT NULL,
    apellidos               VARCHAR(100) NOT NULL,
    whatsapp                VARCHAR(20)  NULL,
    correo                  VARCHAR(150) NULL,
    consentimiento_contacto BIT NOT NULL DEFAULT 0,        -- Ley 29733
    fecha_consentimiento    DATETIME2 NULL,
    no_contactar            BIT NOT NULL DEFAULT 0,        -- el estudiante pidio dejar de recibir mensajes
    fecha_registro          DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    estado                  VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
    CONSTRAINT CK_CONTACTO_ESTADO CHECK (estado IN ('ACTIVO','INACTIVO','BAJA'))
);
GO

CREATE TABLE CANAL (
    canal_id            INT IDENTITY(1,1) PRIMARY KEY,
    nombre              VARCHAR(80) NOT NULL,
    tipo                VARCHAR(50) NULL,
    plataforma          VARCHAR(80) NULL
);
GO

CREATE TABLE CAMPANIA (                                    -- anuncio de origen y su inversion
    campania_id         INT IDENTITY(1,1) PRIMARY KEY,
    canal_id            INT NOT NULL,
    nombre              VARCHAR(150) NOT NULL,
    fecha_inicio        DATE NOT NULL,
    fecha_fin           DATE NULL,
    inversion           DECIMAL(12,2) NOT NULL DEFAULT 0,  -- COSTO de captacion
    CONSTRAINT FK_CAMPANIA_CANAL FOREIGN KEY (canal_id) REFERENCES CANAL(canal_id)
);
GO

CREATE TABLE SERVICIO (
    servicio_id         INT IDENTITY(1,1) PRIMARY KEY,
    familia             VARCHAR(60)  NULL,
    nombre              VARCHAR(120) NOT NULL,
    tipo_servicio       VARCHAR(20)  NOT NULL DEFAULT 'PROYECTO',
    paquete             VARCHAR(100) NULL,
    modalidad           VARCHAR(50)  NULL,
    precio_referencia   DECIMAL(10,2) NOT NULL DEFAULT 0,  -- el precio real sale de TARIFA
    activo              BIT NOT NULL DEFAULT 1,
    CONSTRAINT CK_SERVICIO_TIPO CHECK (tipo_servicio IN
        ('DIAGNOSTICO','PROYECTO','INFORME','COMPLETO','COMPLEMENTARIO'))
);
GO

CREATE TABLE ASESOR (                                      -- dos roles: comercial y academico
    asesor_id           INT IDENTITY(1,1) PRIMARY KEY,
    nombre              VARCHAR(150) NOT NULL,
    rol                 VARCHAR(20)  NOT NULL DEFAULT 'ACADEMICO',
    equipo              VARCHAR(80)  NULL,
    especialidad        VARCHAR(120) NULL,
    capacidad_maxima    INT NULL,                          -- clientes simultaneos (para la asignacion)
    estado              VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
    CONSTRAINT CK_ASESOR_ROL CHECK (rol IN ('COMERCIAL','ACADEMICO'))
);
GO

CREATE TABLE ASESOR_CARRERA (                              -- carreras que cubre cada especialista
    asesor_id           INT NOT NULL,
    carrera_id          INT NOT NULL,
    CONSTRAINT PK_ASESOR_CARRERA PRIMARY KEY (asesor_id, carrera_id),
    CONSTRAINT FK_ASESOR_CARRERA_ASESOR  FOREIGN KEY (asesor_id)  REFERENCES ASESOR(asesor_id),
    CONSTRAINT FK_ASESOR_CARRERA_CARRERA FOREIGN KEY (carrera_id) REFERENCES CARRERA(carrera_id)
);
GO

CREATE TABLE PERFIL_ACADEMICO (
    perfil_academico_id INT IDENTITY(1,1) PRIMARY KEY,
    contacto_id         INT NOT NULL UNIQUE,
    universidad_id      INT NOT NULL,
    carrera_id          INT NOT NULL,
    etapa_academica     VARCHAR(50) NOT NULL,
    ciclo               VARCHAR(20) NULL,
    sede                VARCHAR(100) NULL,
    tipo_investigacion  VARCHAR(100) NULL,
    avance              DECIMAL(5,2) NULL,
    recomendado_por_contacto_id INT NULL,                  -- "si lo recomendaron"
    CONSTRAINT FK_PERFIL_CONTACTO
        FOREIGN KEY (contacto_id) REFERENCES CONTACTO(contacto_id),
    CONSTRAINT FK_PERFIL_UNIVERSIDAD
        FOREIGN KEY (universidad_id) REFERENCES UNIVERSIDAD(universidad_id),
    CONSTRAINT FK_PERFIL_CARRERA
        FOREIGN KEY (carrera_id) REFERENCES CARRERA(carrera_id),
    CONSTRAINT FK_PERFIL_RECOMENDADO
        FOREIGN KEY (recomendado_por_contacto_id) REFERENCES CONTACTO(contacto_id),
    CONSTRAINT CK_PERFIL_AVANCE
        CHECK (avance IS NULL OR avance BETWEEN 0 AND 100),
    CONSTRAINT CK_PERFIL_ETAPA
        CHECK (etapa_academica IN ('CICLO_IX','CICLO_X','EGRESADO','BACHILLER'))
);
GO

CREATE TABLE PLANTILLA_MENSAJE (                           -- plantillas aprobadas por Meta (fuera de la ventana)
    plantilla_msg_id    INT IDENTITY(1,1) PRIMARY KEY,
    nombre              VARCHAR(100) NOT NULL,
    categoria           VARCHAR(30)  NOT NULL,
    texto               VARCHAR(1000) NULL,
    aprobada_meta       BIT NOT NULL DEFAULT 0,
    fecha_aprobacion    DATE NULL,
    activa              BIT NOT NULL DEFAULT 1,
    CONSTRAINT CK_PLANTILLA_MSG_CAT CHECK (categoria IN
        ('SEGUIMIENTO_BUYER','PROPUESTA','COBRANZA','SESION','HITO','OTRO'))
);
GO

CREATE TABLE ENTREGABLE (
    entregable_id       INT IDENTITY(1,1) PRIMARY KEY,
    nombre              VARCHAR(150) NOT NULL,
    tipo_entregable     VARCHAR(20)  NOT NULL,             -- ESTANDAR / PARAMETRO / EXTRA
    descripcion         VARCHAR(300) NULL,
    precio_extra        DECIMAL(10,2) NULL,                -- solo para tipo EXTRA
    activo              BIT NOT NULL DEFAULT 1,
    CONSTRAINT CK_ENTREGABLE_TIPO CHECK (tipo_entregable IN ('ESTANDAR','PARAMETRO','EXTRA'))
);
GO

CREATE TABLE SERVICIO_ENTREGABLE (                         -- que incluye cada servicio y con que parametros
    servicio_id         INT NOT NULL,
    entregable_id       INT NOT NULL,
    cantidad_incluida   INT NULL,                          -- rondas, simulacros, reportes, propuestas
    umbral_pct          DECIMAL(5,2) NULL,                 -- umbral objetivo (similitud o IA)
    frecuencia_dias     INT NULL,
    duracion_min        INT NULL,
    precio_unidad_extra DECIMAL(10,2) NULL,                -- costo de una ronda o unidad extra
    CONSTRAINT PK_SERVICIO_ENTREGABLE PRIMARY KEY (servicio_id, entregable_id),
    CONSTRAINT FK_SERV_ENTREG_SERVICIO   FOREIGN KEY (servicio_id)   REFERENCES SERVICIO(servicio_id),
    CONSTRAINT FK_SERV_ENTREG_ENTREGABLE FOREIGN KEY (entregable_id) REFERENCES ENTREGABLE(entregable_id)
);
GO

CREATE TABLE TARIFA (                                      -- precio base, minimo y tope por carrera y etapa
    tarifa_id           INT IDENTITY(1,1) PRIMARY KEY,
    servicio_id         INT NOT NULL,
    carrera_id          INT NOT NULL,
    etapa_academica     VARCHAR(50) NULL,                  -- NULL = aplica a todas las etapas
    precio_base         DECIMAL(10,2) NOT NULL,
    precio_minimo       DECIMAL(10,2) NOT NULL,
    tope_descuento_pct  DECIMAL(5,2)  NOT NULL,
    vigente_desde       DATE NOT NULL,
    vigente_hasta       DATE NULL,
    activo              BIT NOT NULL DEFAULT 1,
    CONSTRAINT FK_TARIFA_SERVICIO FOREIGN KEY (servicio_id) REFERENCES SERVICIO(servicio_id),
    CONSTRAINT FK_TARIFA_CARRERA  FOREIGN KEY (carrera_id)  REFERENCES CARRERA(carrera_id),
    CONSTRAINT CK_TARIFA_MINIMO   CHECK (precio_minimo >= 0 AND precio_minimo <= precio_base),
    CONSTRAINT CK_TARIFA_TOPE     CHECK (tope_descuento_pct BETWEEN 0 AND 100)
);
GO

CREATE TABLE REGLA_PRECIO (                                -- recargos y descuentos del motor de precios
    regla_id            INT IDENTITY(1,1) PRIMARY KEY,
    nombre              VARCHAR(120) NOT NULL,
    tipo                VARCHAR(10)  NOT NULL,
    factor              VARCHAR(20)  NOT NULL,
    valor_condicion     VARCHAR(100) NULL,                 -- ej. UNT, CICLO_X, CONTADO
    umbral_dias         INT NULL,                          -- ej. urgencia: menos de 15 dias
    porcentaje          DECIMAL(5,2) NOT NULL,
    vigente_desde       DATE NOT NULL,
    vigente_hasta       DATE NULL,
    activa              BIT NOT NULL DEFAULT 1,
    CONSTRAINT CK_REGLA_TIPO   CHECK (tipo IN ('DESCUENTO','RECARGO')),
    CONSTRAINT CK_REGLA_FACTOR CHECK (factor IN
        ('UNIVERSIDAD','CICLO','AVANCE','FORMA_PAGO','TIPO_TESIS','URGENCIA','PROMOCION')),
    CONSTRAINT CK_REGLA_PCT    CHECK (porcentaje BETWEEN 0 AND 100)
);
GO

CREATE TABLE META (                                        -- para los reportes real vs meta
    meta_id             INT IDENTITY(1,1) PRIMARY KEY,
    periodo             DATE NOT NULL,                     -- primer dia del mes
    fase                VARCHAR(15) NOT NULL,
    indicador           VARCHAR(80) NOT NULL,
    carrera_id          INT NULL,                          -- NULL = meta general
    valor_meta          DECIMAL(14,2) NOT NULL,
    CONSTRAINT FK_META_CARRERA FOREIGN KEY (carrera_id) REFERENCES CARRERA(carrera_id),
    CONSTRAINT CK_META_FASE CHECK (fase IN ('BUYERS','LEADS','PAYERS','CUSTOMERS'))
);
GO


/*==============================================================================
 BLOQUE B. AGENTE IA: CONVERSACION, MENSAJE, ESCALAMIENTO
 Registra como el bot maneja al cliente (tiempo de primera respuesta, resueltas
 sin humano, derivaciones) y respeta la regla de la ventana de WhatsApp.
==============================================================================*/

CREATE TABLE CONVERSACION (
    conversacion_id     INT IDENTITY(1,1) PRIMARY KEY,
    contacto_id         INT NOT NULL,
    canal_id            INT NULL,
    campania_id         INT NULL,                          -- anuncio de origen (clic a WhatsApp)
    fecha_inicio        DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    fecha_ultimo_mensaje_cliente DATETIME2 NULL,
    tipo_ventana        VARCHAR(20) NOT NULL DEFAULT 'SERVICIO_24H',
    ventana_hasta       DATETIME2 NULL,                    -- fin del texto libre permitido
    estado              VARCHAR(20) NOT NULL DEFAULT 'ABIERTA',
    resuelta_sin_humano BIT NULL,
    fecha_cierre        DATETIME2 NULL,
    CONSTRAINT FK_CONVERSACION_CONTACTO FOREIGN KEY (contacto_id) REFERENCES CONTACTO(contacto_id),
    CONSTRAINT FK_CONVERSACION_CANAL    FOREIGN KEY (canal_id)    REFERENCES CANAL(canal_id),
    CONSTRAINT FK_CONVERSACION_CAMPANIA FOREIGN KEY (campania_id) REFERENCES CAMPANIA(campania_id),
    CONSTRAINT CK_CONVERSACION_VENTANA CHECK (tipo_ventana IN ('SERVICIO_24H','ANUNCIO_72H')),
    CONSTRAINT CK_CONVERSACION_ESTADO  CHECK (estado IN ('ABIERTA','CERRADA','DERIVADA'))
);
GO

CREATE TABLE MENSAJE (
    mensaje_id          INT IDENTITY(1,1) PRIMARY KEY,
    conversacion_id     INT NOT NULL,
    emisor              VARCHAR(15) NOT NULL,
    asesor_id           INT NULL,                          -- si escribio una persona
    fecha_hora          DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    tipo                VARCHAR(15) NOT NULL DEFAULT 'TEXTO',
    plantilla_msg_id    INT NULL,
    contenido           VARCHAR(2000) NULL,
    dentro_ventana      BIT NOT NULL DEFAULT 1,
    CONSTRAINT FK_MENSAJE_CONVERSACION FOREIGN KEY (conversacion_id) REFERENCES CONVERSACION(conversacion_id),
    CONSTRAINT FK_MENSAJE_ASESOR       FOREIGN KEY (asesor_id)       REFERENCES ASESOR(asesor_id),
    CONSTRAINT FK_MENSAJE_PLANTILLA    FOREIGN KEY (plantilla_msg_id) REFERENCES PLANTILLA_MENSAJE(plantilla_msg_id),
    CONSTRAINT CK_MENSAJE_EMISOR CHECK (emisor IN ('CLIENTE','BOT','ESPECIALISTA','ADMIN')),
    CONSTRAINT CK_MENSAJE_TIPO   CHECK (tipo IN ('TEXTO','PLANTILLA','ARCHIVO','ENLACE_PAGO','AUDIO')),
    -- Una plantilla debe indicar cual es
    CONSTRAINT CK_MENSAJE_PLANTILLA CHECK (tipo <> 'PLANTILLA' OR plantilla_msg_id IS NOT NULL),
    -- Regla WhatsApp: fuera de la ventana solo se envian plantillas aprobadas
    CONSTRAINT CK_MENSAJE_VENTANA CHECK (dentro_ventana = 1 OR tipo = 'PLANTILLA' OR emisor = 'CLIENTE')
);
GO


/*==============================================================================
 BLOQUE C. FASE 1 - BUYERS
==============================================================================*/

CREATE TABLE BUYER (
    buyer_id            INT IDENTITY(1,1) PRIMARY KEY,
    contacto_id         INT NOT NULL UNIQUE,
    canal_captacion_id  INT NULL,
    campania_id         INT NULL,
    servicio_interes_id INT NULL,
    necesidad_inicial   VARCHAR(200) NULL,
    fecha_buyer         DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    estado              VARCHAR(30) NOT NULL DEFAULT 'ACTIVO',
    CONSTRAINT FK_BUYER_CONTACTO
        FOREIGN KEY (contacto_id) REFERENCES CONTACTO(contacto_id),
    CONSTRAINT FK_BUYER_CANAL
        FOREIGN KEY (canal_captacion_id) REFERENCES CANAL(canal_id),
    CONSTRAINT FK_BUYER_CAMPANIA
        FOREIGN KEY (campania_id) REFERENCES CAMPANIA(campania_id),
    CONSTRAINT FK_BUYER_SERVICIO
        FOREIGN KEY (servicio_interes_id) REFERENCES SERVICIO(servicio_id),
    CONSTRAINT CK_BUYER_ESTADO CHECK (estado IN
        ('ACTIVO','SIN_COBERTURA','NO_CONTACTAR','PERDIDO','CONVERTIDO'))
);
GO

CREATE TABLE CONTENIDO (
    contenido_id        INT IDENTITY(1,1) PRIMARY KEY,
    servicio_id         INT NULL,
    tipo_contenido      VARCHAR(60) NOT NULL,
    tema                VARCHAR(150) NULL,
    titulo              VARCHAR(180) NOT NULL,
    CONSTRAINT FK_CONTENIDO_SERVICIO
        FOREIGN KEY (servicio_id) REFERENCES SERVICIO(servicio_id)
);
GO

CREATE TABLE INTERACCION_CAPTACION (
    interaccion_id      INT IDENTITY(1,1) PRIMARY KEY,
    buyer_id            INT NOT NULL,
    canal_id            INT NULL,
    contenido_id        INT NULL,
    fecha_interaccion   DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    tipo_interaccion    VARCHAR(60) NOT NULL,
    es_valor            BIT NOT NULL DEFAULT 0,
    CONSTRAINT FK_INTERACCION_BUYER
        FOREIGN KEY (buyer_id) REFERENCES BUYER(buyer_id),
    CONSTRAINT FK_INTERACCION_CANAL
        FOREIGN KEY (canal_id) REFERENCES CANAL(canal_id),
    CONSTRAINT FK_INTERACCION_CONTENIDO
        FOREIGN KEY (contenido_id) REFERENCES CONTENIDO(contenido_id)
);
GO

CREATE TABLE DESCARGA_CONTENIDO (
    descarga_id         INT IDENTITY(1,1) PRIMARY KEY,
    buyer_id            INT NOT NULL,
    contenido_id        INT NOT NULL,
    fecha_descarga      DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_DESCARGA_BUYER
        FOREIGN KEY (buyer_id) REFERENCES BUYER(buyer_id),
    CONSTRAINT FK_DESCARGA_CONTENIDO
        FOREIGN KEY (contenido_id) REFERENCES CONTENIDO(contenido_id)
);
GO

CREATE TABLE SEGUIMIENTO_BUYER (                           -- recordatorios a las 24 h, 72 h y 7 dias
    seguimiento_buyer_id INT IDENTITY(1,1) PRIMARY KEY,
    buyer_id             INT NOT NULL,
    canal_id             INT NULL,
    plantilla_msg_id     INT NULL,
    intento_nro          INT NOT NULL DEFAULT 1,
    intervalo_horas      INT NULL,
    fecha_ejecucion      DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    resultado            VARCHAR(100) NULL,
    CONSTRAINT FK_SEGUIMIENTO_BUYER
        FOREIGN KEY (buyer_id) REFERENCES BUYER(buyer_id),
    CONSTRAINT FK_SEGUIMIENTO_BUYER_CANAL
        FOREIGN KEY (canal_id) REFERENCES CANAL(canal_id),
    CONSTRAINT FK_SEGUIMIENTO_BUYER_PLANTILLA
        FOREIGN KEY (plantilla_msg_id) REFERENCES PLANTILLA_MENSAJE(plantilla_msg_id)
);
GO


/*==============================================================================
 BLOQUE D. FASE 2 - LEADS
==============================================================================*/

CREATE TABLE LEAD (
    lead_id             INT IDENTITY(1,1) PRIMARY KEY,
    buyer_id            INT NOT NULL UNIQUE,
    fecha_lead          DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    prioridad           VARCHAR(20) NULL,
    estado              VARCHAR(30) NOT NULL DEFAULT 'EN_NEGOCIACION',
    CONSTRAINT FK_LEAD_BUYER
        FOREIGN KEY (buyer_id) REFERENCES BUYER(buyer_id)
);
GO

CREATE TABLE ESCALAMIENTO (                                -- cuando entra una persona (especialista, admin)
    escalamiento_id     INT IDENTITY(1,1) PRIMARY KEY,
    conversacion_id     INT NOT NULL,
    lead_id             INT NULL,
    fecha               DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    motivo              VARCHAR(40) NOT NULL,
    destino_rol         VARCHAR(20) NOT NULL DEFAULT 'ESPECIALISTA',
    asesor_id           INT NULL,
    fecha_atencion      DATETIME2 NULL,
    resumen_entregado   BIT NOT NULL DEFAULT 1,            -- resumen automatico para el especialista
    estado              VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    CONSTRAINT FK_ESCALAMIENTO_CONVERSACION FOREIGN KEY (conversacion_id) REFERENCES CONVERSACION(conversacion_id),
    CONSTRAINT FK_ESCALAMIENTO_LEAD   FOREIGN KEY (lead_id)   REFERENCES LEAD(lead_id),
    CONSTRAINT FK_ESCALAMIENTO_ASESOR FOREIGN KEY (asesor_id) REFERENCES ASESOR(asesor_id),
    CONSTRAINT CK_ESCALAMIENTO_MOTIVO CHECK (motivo IN
        ('CLIENTE_PIDE_ESPECIALISTA','BOT_NO_RESPONDE','FUERA_COBERTURA','OBJECION_REPETIDA',
         'DESCUENTO_EXCEDE_TOPE','RECLAMO_PAGO','RIESGO_ABANDONO')),
    CONSTRAINT CK_ESCALAMIENTO_DESTINO CHECK (destino_rol IN ('ESPECIALISTA','ADMIN','COORDINACION')),
    CONSTRAINT CK_ESCALAMIENTO_ESTADO CHECK (estado IN ('PENDIENTE','ATENDIDO','CERRADO'))
);
GO

CREATE TABLE PERFIL_NEGOCIACION (
    perfil_negociacion_id INT IDENTITY(1,1) PRIMARY KEY,
    lead_id               INT NOT NULL,
    version               INT NOT NULL DEFAULT 1,
    disponibilidad        VARCHAR(150) NULL,
    horario               VARCHAR(100) NULL,
    fecha_limite          DATE NULL,
    nivel_confianza       TINYINT NULL,
    necesidad_acompanamiento VARCHAR(300) NULL,
    completo              BIT NOT NULL DEFAULT 0,
    fecha_registro        DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_PERFIL_NEGOCIACION_LEAD
        FOREIGN KEY (lead_id) REFERENCES LEAD(lead_id),
    CONSTRAINT CK_PERFIL_NEG_CONFIANZA
        CHECK (nivel_confianza IS NULL OR nivel_confianza BETWEEN 1 AND 5)
);
GO

CREATE TABLE RESPONSABLE_PAGO (
    responsable_pago_id INT IDENTITY(1,1) PRIMARY KEY,
    lead_id             INT NOT NULL,
    tipo_responsable    VARCHAR(30) NULL,                  -- el propio estudiante, familiar, empresa
    tipo_relacion       VARCHAR(50) NULL,
    segmento            VARCHAR(50) NULL,
    nombre              VARCHAR(150) NULL,
    telefono            VARCHAR(20) NULL,
    participa_decision  BIT NOT NULL DEFAULT 0,
    CONSTRAINT FK_RESPONSABLE_PAGO_LEAD
        FOREIGN KEY (lead_id) REFERENCES LEAD(lead_id)
);
GO

CREATE TABLE SEGUIMIENTO_LEAD (
    seguimiento_lead_id INT IDENTITY(1,1) PRIMARY KEY,
    lead_id             INT NOT NULL,
    propuesta_id        INT NULL,
    asesor_id           INT NULL,
    canal_id            INT NULL,
    plantilla_msg_id    INT NULL,
    fecha_accion        DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    resultado           VARCHAR(120) NULL,
    siguiente_accion    VARCHAR(300) NULL,
    CONSTRAINT FK_SEGUIMIENTO_LEAD_LEAD
        FOREIGN KEY (lead_id) REFERENCES LEAD(lead_id),
    CONSTRAINT FK_SEGUIMIENTO_LEAD_ASESOR
        FOREIGN KEY (asesor_id) REFERENCES ASESOR(asesor_id),
    CONSTRAINT FK_SEGUIMIENTO_LEAD_CANAL
        FOREIGN KEY (canal_id) REFERENCES CANAL(canal_id),
    CONSTRAINT FK_SEGUIMIENTO_LEAD_PLANTILLA
        FOREIGN KEY (plantilla_msg_id) REFERENCES PLANTILLA_MENSAJE(plantilla_msg_id)
);
GO

CREATE TABLE DIAGNOSTICO (                                 -- diagnostico hecho en el chat
    diagnostico_id      INT IDENTITY(1,1) PRIMARY KEY,
    lead_id             INT NOT NULL,
    asesor_id           INT NULL,
    fecha_solicitud     DATETIME2 NOT NULL,
    fecha_entrega       DATETIME2 NULL,
    estado              VARCHAR(30) NOT NULL DEFAULT 'SOLICITADO',
    tema_tesis          VARCHAR(250) NULL,
    tipo_tesis          VARCHAR(60)  NULL,                 -- descriptiva, experimental, etc.
    avance_declarado    DECIMAL(5,2) NULL,
    limitaciones        VARCHAR(300) NULL,
    tiene_empresa_aplicacion BIT NULL,
    requiere_derivacion BIT NOT NULL DEFAULT 0,
    resumen             VARCHAR(MAX) NULL,
    CONSTRAINT FK_DIAGNOSTICO_LEAD
        FOREIGN KEY (lead_id) REFERENCES LEAD(lead_id),
    CONSTRAINT FK_DIAGNOSTICO_ASESOR
        FOREIGN KEY (asesor_id) REFERENCES ASESOR(asesor_id),
    CONSTRAINT CK_DIAGNOSTICO_AVANCE
        CHECK (avance_declarado IS NULL OR avance_declarado BETWEEN 0 AND 100)
);
GO

CREATE TABLE PROPUESTA (
    propuesta_id        INT IDENTITY(1,1) PRIMARY KEY,
    lead_id             INT NOT NULL,
    servicio_id         INT NOT NULL,
    tarifa_id           INT NULL,
    asesor_id           INT NULL,
    generada_por        VARCHAR(15) NOT NULL DEFAULT 'BOT',
    version             INT NOT NULL DEFAULT 1,
    fecha_presentacion  DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    precio_base         DECIMAL(10,2) NOT NULL,
    monto_extras        DECIMAL(10,2) NOT NULL DEFAULT 0,
    descuento           DECIMAL(10,2) NOT NULL DEFAULT 0,
    recargo             DECIMAL(10,2) NOT NULL DEFAULT 0,
    precio_final AS (precio_base + monto_extras + recargo - descuento) PERSISTED,
    -- Foto de los limites vigentes cuando se presento (el historial no cambia)
    precio_minimo_aplicado  DECIMAL(10,2) NOT NULL DEFAULT 0,
    tope_descuento_aplicado DECIMAL(5,2)  NOT NULL DEFAULT 0,
    vigencia_hasta      DATE NULL,
    estado              VARCHAR(30) NOT NULL DEFAULT 'PRESENTADA',
    CONSTRAINT FK_PROPUESTA_LEAD
        FOREIGN KEY (lead_id) REFERENCES LEAD(lead_id),
    CONSTRAINT FK_PROPUESTA_SERVICIO
        FOREIGN KEY (servicio_id) REFERENCES SERVICIO(servicio_id),
    CONSTRAINT FK_PROPUESTA_TARIFA
        FOREIGN KEY (tarifa_id) REFERENCES TARIFA(tarifa_id),
    CONSTRAINT FK_PROPUESTA_ASESOR
        FOREIGN KEY (asesor_id) REFERENCES ASESOR(asesor_id),
    CONSTRAINT CK_PROPUESTA_GENERADA CHECK (generada_por IN ('BOT','ESPECIALISTA')),
    CONSTRAINT CK_PROPUESTA_ESTADO CHECK (estado IN
        ('PRESENTADA','ACEPTADA','RECHAZADA','VENCIDA','REEMPLAZADA')),
    -- Reglas que ni el bot ni el especialista pueden romper
    CONSTRAINT CK_PROPUESTA_TOPE
        CHECK (descuento <= precio_base * tope_descuento_aplicado / 100.0),
    CONSTRAINT CK_PROPUESTA_MINIMO
        CHECK ((precio_base + monto_extras + recargo - descuento) >= precio_minimo_aplicado)
);
GO

ALTER TABLE SEGUIMIENTO_LEAD
ADD CONSTRAINT FK_SEGUIMIENTO_LEAD_PROPUESTA
    FOREIGN KEY (propuesta_id) REFERENCES PROPUESTA(propuesta_id);
GO

CREATE TABLE PROPUESTA_AJUSTE (                            -- desglose de cada recargo o descuento
    ajuste_id           INT IDENTITY(1,1) PRIMARY KEY,
    propuesta_id        INT NOT NULL,
    regla_id            INT NULL,
    tipo                VARCHAR(10) NOT NULL,
    concepto            VARCHAR(120) NOT NULL,
    porcentaje          DECIMAL(5,2) NULL,
    monto               DECIMAL(10,2) NOT NULL,
    CONSTRAINT FK_AJUSTE_PROPUESTA FOREIGN KEY (propuesta_id) REFERENCES PROPUESTA(propuesta_id),
    CONSTRAINT FK_AJUSTE_REGLA     FOREIGN KEY (regla_id)     REFERENCES REGLA_PRECIO(regla_id),
    CONSTRAINT CK_AJUSTE_TIPO CHECK (tipo IN ('DESCUENTO','RECARGO'))
);
GO

CREATE TABLE PROPUESTA_ENTREGABLE (                        -- extras elegidos por el cliente
    propuesta_id        INT NOT NULL,
    entregable_id       INT NOT NULL,
    cantidad            INT NOT NULL DEFAULT 1,
    precio_unitario     DECIMAL(10,2) NOT NULL DEFAULT 0,
    es_extra            BIT NOT NULL DEFAULT 0,
    CONSTRAINT PK_PROPUESTA_ENTREGABLE PRIMARY KEY (propuesta_id, entregable_id),
    CONSTRAINT FK_PROP_ENTREG_PROPUESTA  FOREIGN KEY (propuesta_id)  REFERENCES PROPUESTA(propuesta_id),
    CONSTRAINT FK_PROP_ENTREG_ENTREGABLE FOREIGN KEY (entregable_id) REFERENCES ENTREGABLE(entregable_id)
);
GO

CREATE TABLE RESPUESTA_PROPUESTA (
    respuesta_id        INT IDENTITY(1,1) PRIMARY KEY,
    propuesta_id        INT NOT NULL,
    fecha_respuesta     DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    tipo_respuesta      VARCHAR(30) NOT NULL,
    observacion         VARCHAR(500) NULL,
    CONSTRAINT FK_RESPUESTA_PROPUESTA
        FOREIGN KEY (propuesta_id) REFERENCES PROPUESTA(propuesta_id),
    CONSTRAINT CK_RESPUESTA_TIPO CHECK (tipo_respuesta IN
        ('ACEPTA','RECHAZA','CONTRAOFERTA','PIDE_ESPECIALISTA','SIN_RESPUESTA'))
);
GO

CREATE TABLE OBJECION (
    objecion_id         INT IDENTITY(1,1) PRIMARY KEY,
    propuesta_id        INT NOT NULL,
    grupo               VARCHAR(40) NULL,
    tipo                VARCHAR(60) NOT NULL,              -- precio, confianza, plagio/IA, plazo, consulta familiar
    descripcion         VARCHAR(500) NULL,
    fecha_registro      DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    veces_repetida      INT NOT NULL DEFAULT 1,            -- si llega a 2 sin resolverse, se escala
    escalada            BIT NOT NULL DEFAULT 0,
    estado              VARCHAR(30) NOT NULL DEFAULT 'PENDIENTE',
    fecha_resolucion    DATETIME2 NULL,
    resultado           VARCHAR(120) NULL,
    CONSTRAINT FK_OBJECION_PROPUESTA
        FOREIGN KEY (propuesta_id) REFERENCES PROPUESTA(propuesta_id)
);
GO


/*==============================================================================
 BLOQUE E. FASE 3 - PAYERS
==============================================================================*/

CREATE TABLE MODALIDAD_PAGO (
    modalidad_pago_id   INT IDENTITY(1,1) PRIMARY KEY,
    nombre              VARCHAR(50) NOT NULL,
    numero_cuotas       TINYINT NOT NULL DEFAULT 1,
    es_contado          BIT NOT NULL DEFAULT 0,
    condicion           VARCHAR(100) NULL
);
GO

CREATE TABLE MEDIO_PAGO (
    medio_pago_id       INT IDENTITY(1,1) PRIMARY KEY,
    metodo              VARCHAR(50) NOT NULL,
    proveedor           VARCHAR(60) NULL,
    canal               VARCHAR(50) NULL,
    monto_maximo        DECIMAL(10,2) NULL,                -- ej. Yape (verificar vigencia)
    verificacion        VARCHAR(10) NOT NULL DEFAULT 'PASARELA',
    activo              BIT NOT NULL DEFAULT 1,
    CONSTRAINT CK_MEDIO_PAGO_VERIF CHECK (verificacion IN ('PASARELA','MANUAL'))
);
GO

CREATE TABLE PLANTILLA_CONTRATO (
    plantilla_contrato_id INT IDENTITY(1,1) PRIMARY KEY,
    nombre              VARCHAR(100) NOT NULL,
    version             INT NOT NULL DEFAULT 1,
    clausulas_variables VARCHAR(500) NULL,                 -- plazos, penalidades
    vigente_desde       DATE NOT NULL,
    activa              BIT NOT NULL DEFAULT 1
);
GO

CREATE TABLE CONTRATO (
    contrato_id         INT IDENTITY(1,1) PRIMARY KEY,
    propuesta_id        INT NOT NULL UNIQUE,
    plantilla_contrato_id INT NOT NULL,
    fecha_generacion    DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    fecha_confirmacion  DATETIME2 NULL,
    plazo_dias          INT NULL,
    penalidad_pct       DECIMAL(5,2) NULL,
    estado              VARCHAR(20) NOT NULL DEFAULT 'GENERADO',
    CONSTRAINT FK_CONTRATO_PROPUESTA FOREIGN KEY (propuesta_id) REFERENCES PROPUESTA(propuesta_id),
    CONSTRAINT FK_CONTRATO_PLANTILLA FOREIGN KEY (plantilla_contrato_id)
        REFERENCES PLANTILLA_CONTRATO(plantilla_contrato_id),
    CONSTRAINT CK_CONTRATO_ESTADO CHECK (estado IN ('GENERADO','CONFIRMADO','ANULADO'))
);
GO

CREATE TABLE ORDEN_PAGO (
    orden_pago_id       INT IDENTITY(1,1) PRIMARY KEY,
    propuesta_id        INT NOT NULL UNIQUE,
    contrato_id         INT NULL,
    responsable_pago_id INT NULL,
    modalidad_pago_id   INT NOT NULL,
    fecha_creacion      DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    monto_comprometido  DECIMAL(10,2) NOT NULL,
    moneda              CHAR(3) NOT NULL DEFAULT 'PEN',
    estado              VARCHAR(30) NOT NULL DEFAULT 'PENDIENTE',
    CONSTRAINT FK_ORDEN_PROPUESTA
        FOREIGN KEY (propuesta_id) REFERENCES PROPUESTA(propuesta_id),
    CONSTRAINT FK_ORDEN_CONTRATO
        FOREIGN KEY (contrato_id) REFERENCES CONTRATO(contrato_id),
    CONSTRAINT FK_ORDEN_RESPONSABLE
        FOREIGN KEY (responsable_pago_id) REFERENCES RESPONSABLE_PAGO(responsable_pago_id),
    CONSTRAINT FK_ORDEN_MODALIDAD
        FOREIGN KEY (modalidad_pago_id) REFERENCES MODALIDAD_PAGO(modalidad_pago_id),
    CONSTRAINT CK_ORDEN_ESTADO CHECK (estado IN
        ('PENDIENTE','ENLACE_ENVIADO','PARCIAL','PAGADA','VENCIDA','ANULADA'))
);
GO

CREATE TABLE CUOTA_PAGO (
    cuota_id            INT IDENTITY(1,1) PRIMARY KEY,
    orden_pago_id       INT NOT NULL,
    numero_cuota        TINYINT NOT NULL,
    porcentaje          DECIMAL(5,2) NULL,                 -- ej. 30, 40, 30
    monto_programado    DECIMAL(10,2) NOT NULL,
    condicion           VARCHAR(20) NOT NULL DEFAULT 'FECHA',
    fecha_vencimiento   DATE NULL,                         -- nula si depende de un hito
    estado              VARCHAR(30) NOT NULL DEFAULT 'PENDIENTE',
    CONSTRAINT FK_CUOTA_ORDEN
        FOREIGN KEY (orden_pago_id) REFERENCES ORDEN_PAGO(orden_pago_id),
    CONSTRAINT CK_CUOTA_CONDICION CHECK (condicion IN ('INICIAL','AL_ENTREGAR_HITO','FECHA')),
    CONSTRAINT CK_CUOTA_FECHA CHECK (condicion <> 'FECHA' OR fecha_vencimiento IS NOT NULL),
    CONSTRAINT CK_CUOTA_ESTADO CHECK (estado IN
        ('PENDIENTE','ENLACE_ENVIADO','PAGADA','VENCIDA','ANULADA'))
);
GO

CREATE TABLE ENLACE_PAGO (                                 -- enlace generado en la pasarela
    enlace_id           INT IDENTITY(1,1) PRIMARY KEY,
    orden_pago_id       INT NOT NULL,
    cuota_id            INT NULL,
    medio_pago_id       INT NULL,
    referencia_externa  VARCHAR(120) NULL,
    fecha_envio         DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    fecha_expiracion    DATETIME2 NULL,
    estado              VARCHAR(20) NOT NULL DEFAULT 'ENVIADO',
    CONSTRAINT FK_ENLACE_ORDEN FOREIGN KEY (orden_pago_id) REFERENCES ORDEN_PAGO(orden_pago_id),
    CONSTRAINT FK_ENLACE_CUOTA FOREIGN KEY (cuota_id)      REFERENCES CUOTA_PAGO(cuota_id),
    CONSTRAINT FK_ENLACE_MEDIO FOREIGN KEY (medio_pago_id) REFERENCES MEDIO_PAGO(medio_pago_id),
    CONSTRAINT CK_ENLACE_ESTADO CHECK (estado IN ('ENVIADO','PAGADO','EXPIRADO','ANULADO'))
);
GO

CREATE TABLE PAGO (
    pago_id             INT IDENTITY(1,1) PRIMARY KEY,
    orden_pago_id       INT NOT NULL,
    cuota_id            INT NULL,
    medio_pago_id       INT NOT NULL,
    fecha_inicio        DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    fecha_confirmacion  DATETIME2 NULL,
    monto_pagado        DECIMAL(10,2) NOT NULL,
    comision_pasarela   DECIMAL(10,2) NOT NULL DEFAULT 0,  -- COSTO de cobrar
    referencia          VARCHAR(120) NULL,
    metodo_verificacion VARCHAR(10) NULL,
    verificado_por_asesor_id INT NULL,                     -- en transferencia o deposito
    estado              VARCHAR(30) NOT NULL DEFAULT 'PENDIENTE',
    CONSTRAINT FK_PAGO_ORDEN
        FOREIGN KEY (orden_pago_id) REFERENCES ORDEN_PAGO(orden_pago_id),
    CONSTRAINT FK_PAGO_CUOTA
        FOREIGN KEY (cuota_id) REFERENCES CUOTA_PAGO(cuota_id),
    CONSTRAINT FK_PAGO_MEDIO
        FOREIGN KEY (medio_pago_id) REFERENCES MEDIO_PAGO(medio_pago_id),
    CONSTRAINT FK_PAGO_VERIFICADOR
        FOREIGN KEY (verificado_por_asesor_id) REFERENCES ASESOR(asesor_id),
    CONSTRAINT CK_PAGO_VERIF CHECK (metodo_verificacion IS NULL OR metodo_verificacion IN ('WEBHOOK','MANUAL')),
    CONSTRAINT CK_PAGO_ESTADO CHECK (estado IN ('PENDIENTE','CONFIRMADO','RECHAZADO','ANULADO'))
);
GO

CREATE TABLE EVENTO_WEBHOOK (                              -- aviso automatico de la pasarela
    evento_id           INT IDENTITY(1,1) PRIMARY KEY,
    pago_id             INT NULL,
    proveedor           VARCHAR(60) NOT NULL,
    tipo_evento         VARCHAR(80) NOT NULL,
    fecha_recepcion     DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    procesado           BIT NOT NULL DEFAULT 0,
    detalle             VARCHAR(1000) NULL,
    CONSTRAINT FK_WEBHOOK_PAGO FOREIGN KEY (pago_id) REFERENCES PAGO(pago_id)
);
GO

CREATE TABLE ALERTA_COBRANZA (                             -- recordatorios a las 4 h y 24 h
    alerta_cobranza_id  INT IDENTITY(1,1) PRIMARY KEY,
    orden_pago_id       INT NOT NULL,
    cuota_id            INT NULL,
    plantilla_msg_id    INT NULL,
    fecha_envio         DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    secuencia           INT NOT NULL DEFAULT 1,
    tipo                VARCHAR(60) NOT NULL,
    resultado           VARCHAR(120) NULL,
    escalado            BIT NOT NULL DEFAULT 0,
    CONSTRAINT FK_ALERTA_COBRANZA_ORDEN
        FOREIGN KEY (orden_pago_id) REFERENCES ORDEN_PAGO(orden_pago_id),
    CONSTRAINT FK_ALERTA_COBRANZA_CUOTA
        FOREIGN KEY (cuota_id) REFERENCES CUOTA_PAGO(cuota_id),
    CONSTRAINT FK_ALERTA_COBRANZA_PLANTILLA
        FOREIGN KEY (plantilla_msg_id) REFERENCES PLANTILLA_MENSAJE(plantilla_msg_id)
);
GO

CREATE TABLE PAYER (
    payer_id            INT IDENTITY(1,1) PRIMARY KEY,
    lead_id             INT NOT NULL UNIQUE,
    orden_pago_id       INT NOT NULL UNIQUE,
    fecha_payer         DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    estado              VARCHAR(30) NOT NULL DEFAULT 'ACTIVO',
    CONSTRAINT FK_PAYER_LEAD
        FOREIGN KEY (lead_id) REFERENCES LEAD(lead_id),
    CONSTRAINT FK_PAYER_ORDEN
        FOREIGN KEY (orden_pago_id) REFERENCES ORDEN_PAGO(orden_pago_id)
);
GO


/*==============================================================================
 BLOQUE F. FASE 4 - CUSTOMERS
==============================================================================*/

CREATE TABLE CUSTOMER (
    customer_id         INT IDENTITY(1,1) PRIMARY KEY,
    payer_id            INT NOT NULL UNIQUE,
    fecha_activacion    DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    estado_servicio     VARCHAR(30) NOT NULL DEFAULT 'ACTIVO',
    CONSTRAINT FK_CUSTOMER_PAYER
        FOREIGN KEY (payer_id) REFERENCES PAYER(payer_id),
    CONSTRAINT CK_CUSTOMER_ESTADO CHECK (estado_servicio IN
        ('ACTIVO','PAUSADO','EN_RIESGO','CERRADO'))
);
GO

CREATE TABLE ASIGNACION_ASESOR (                           -- el asesor debe tener rol ACADEMICO
    asignacion_id       INT IDENTITY(1,1) PRIMARY KEY,
    customer_id         INT NOT NULL,
    asesor_id           INT NOT NULL,
    fecha_asignacion    DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    motivo              VARCHAR(100) NULL,                 -- carrera, especialidad, carga
    estado              VARCHAR(30) NOT NULL DEFAULT 'ACTIVA',
    CONSTRAINT FK_ASIGNACION_CUSTOMER
        FOREIGN KEY (customer_id) REFERENCES CUSTOMER(customer_id),
    CONSTRAINT FK_ASIGNACION_ASESOR
        FOREIGN KEY (asesor_id) REFERENCES ASESOR(asesor_id)
);
GO

CREATE TABLE SESION (
    sesion_id           INT IDENTITY(1,1) PRIMARY KEY,
    customer_id         INT NOT NULL,
    asesor_id           INT NOT NULL,
    numero              INT NOT NULL,
    tipo                VARCHAR(50) NULL,                  -- asesoria, simulacro, revision
    modalidad           VARCHAR(30) NULL,
    fecha_agendada      DATETIME2 NOT NULL,
    fecha_realizada     DATETIME2 NULL,
    duracion_min        INT NULL,
    estado              VARCHAR(30) NOT NULL DEFAULT 'PROGRAMADA',
    avance_revisado     VARCHAR(500) NULL,
    acuerdos            VARCHAR(500) NULL,
    CONSTRAINT FK_SESION_CUSTOMER
        FOREIGN KEY (customer_id) REFERENCES CUSTOMER(customer_id),
    CONSTRAINT FK_SESION_ASESOR
        FOREIGN KEY (asesor_id) REFERENCES ASESOR(asesor_id)
);
GO

CREATE TABLE REPROGRAMACION_SESION (
    reprogramacion_id   INT IDENTITY(1,1) PRIMARY KEY,
    sesion_id           INT NOT NULL,
    fecha_anterior      DATETIME2 NOT NULL,
    fecha_nueva         DATETIME2 NOT NULL,
    fecha_registro      DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    solicitado_por      VARCHAR(15) NULL,
    motivo              VARCHAR(300) NULL,
    CONSTRAINT FK_REPROGRAMACION_SESION
        FOREIGN KEY (sesion_id) REFERENCES SESION(sesion_id),
    CONSTRAINT CK_REPROG_SOLICITA CHECK (solicitado_por IS NULL OR solicitado_por IN ('ESTUDIANTE','ASESOR'))
);
GO

CREATE TABLE HITO_CRONOGRAMA (
    hito_id             INT IDENTITY(1,1) PRIMARY KEY,
    customer_id         INT NOT NULL,
    entregable_id       INT NULL,
    nombre              VARCHAR(150) NOT NULL,
    tipo_entregable     VARCHAR(60) NULL,
    capitulo            VARCHAR(100) NULL,
    fecha_pactada       DATE NOT NULL,
    fecha_entrega_real  DATE NULL,
    estado              VARCHAR(30) NOT NULL DEFAULT 'PENDIENTE',
    evidencia           VARCHAR(300) NULL,
    CONSTRAINT FK_HITO_CUSTOMER
        FOREIGN KEY (customer_id) REFERENCES CUSTOMER(customer_id),
    CONSTRAINT FK_HITO_ENTREGABLE
        FOREIGN KEY (entregable_id) REFERENCES ENTREGABLE(entregable_id)
);
GO

-- La cuota se liga al hito que la dispara (el hito nace despues, en CUSTOMERS)
ALTER TABLE CUOTA_PAGO ADD hito_id INT NULL;
GO
ALTER TABLE CUOTA_PAGO
ADD CONSTRAINT FK_CUOTA_HITO FOREIGN KEY (hito_id) REFERENCES HITO_CRONOGRAMA(hito_id);
GO

CREATE TABLE OBSERVACION_UNIVERSITARIA (                   -- observaciones del asesor de la universidad
    observacion_id      INT IDENTITY(1,1) PRIMARY KEY,
    customer_id         INT NOT NULL,
    hito_id             INT NULL,
    ronda               INT NOT NULL DEFAULT 1,
    fecha_recepcion     DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    fecha_levantamiento DATETIME2 NULL,
    descripcion         VARCHAR(500) NULL,
    es_ronda_extra      BIT NOT NULL DEFAULT 0,            -- fuera de las rondas incluidas
    monto_extra         DECIMAL(10,2) NULL,
    estado              VARCHAR(20) NOT NULL DEFAULT 'RECIBIDA',
    CONSTRAINT FK_OBSERVACION_CUSTOMER FOREIGN KEY (customer_id) REFERENCES CUSTOMER(customer_id),
    CONSTRAINT FK_OBSERVACION_HITO     FOREIGN KEY (hito_id)     REFERENCES HITO_CRONOGRAMA(hito_id),
    CONSTRAINT CK_OBSERVACION_ESTADO CHECK (estado IN ('RECIBIDA','EN_LEVANTAMIENTO','LEVANTADA'))
);
GO

CREATE TABLE ALERTA_SERVICIO (
    alerta_servicio_id  INT IDENTITY(1,1) PRIMARY KEY,
    customer_id         INT NOT NULL,
    sesion_id           INT NULL,
    hito_id             INT NULL,
    plantilla_msg_id    INT NULL,
    fecha               DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    tipo                VARCHAR(60) NOT NULL,
    resultado           VARCHAR(120) NULL,
    CONSTRAINT FK_ALERTA_SERVICIO_CUSTOMER
        FOREIGN KEY (customer_id) REFERENCES CUSTOMER(customer_id),
    CONSTRAINT FK_ALERTA_SERVICIO_SESION
        FOREIGN KEY (sesion_id) REFERENCES SESION(sesion_id),
    CONSTRAINT FK_ALERTA_SERVICIO_HITO
        FOREIGN KEY (hito_id) REFERENCES HITO_CRONOGRAMA(hito_id),
    CONSTRAINT FK_ALERTA_SERVICIO_PLANTILLA
        FOREIGN KEY (plantilla_msg_id) REFERENCES PLANTILLA_MENSAJE(plantilla_msg_id)
);
GO

CREATE TABLE EVALUACION_RIESGO (
    evaluacion_riesgo_id INT IDENTITY(1,1) PRIMARY KEY,
    customer_id          INT NOT NULL,
    fecha                 DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    motivo                VARCHAR(200) NOT NULL,
    riesgo_confirmado     BIT NOT NULL DEFAULT 0,
    accion                VARCHAR(300) NULL,
    CONSTRAINT FK_EVALUACION_RIESGO_CUSTOMER
        FOREIGN KEY (customer_id) REFERENCES CUSTOMER(customer_id)
);
GO

CREATE TABLE CIERRE_SERVICIO (
    cierre_id           INT IDENTITY(1,1) PRIMARY KEY,
    customer_id         INT NOT NULL UNIQUE,
    fecha_cierre        DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    resultado           VARCHAR(100) NULL,
    observacion         VARCHAR(500) NULL,
    CONSTRAINT FK_CIERRE_CUSTOMER
        FOREIGN KEY (customer_id) REFERENCES CUSTOMER(customer_id)
);
GO

CREATE TABLE ENCUESTA_SATISFACCION (
    encuesta_id         INT IDENTITY(1,1) PRIMARY KEY,
    cierre_id           INT NOT NULL UNIQUE,
    fecha_envio         DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    fecha_respuesta     DATETIME2 NULL,
    puntaje             TINYINT NULL,
    comentario          VARCHAR(500) NULL,
    CONSTRAINT FK_ENCUESTA_CIERRE
        FOREIGN KEY (cierre_id) REFERENCES CIERRE_SERVICIO(cierre_id),
    CONSTRAINT CK_ENCUESTA_PUNTAJE
        CHECK (puntaje IS NULL OR puntaje BETWEEN 1 AND 5)
);
GO

CREATE TABLE CERTIFICADO_GARANTIA (
    certificado_id      INT IDENTITY(1,1) PRIMARY KEY,
    cierre_id           INT NOT NULL UNIQUE,
    fecha_emision       DATE NOT NULL,
    vigente_hasta       DATE NOT NULL,
    CONSTRAINT FK_CERTIFICADO_CIERRE FOREIGN KEY (cierre_id) REFERENCES CIERRE_SERVICIO(cierre_id)
);
GO


/*==============================================================================
 BLOQUE G. COSTOS (MEJORA): Turnitin, honorarios de especialistas
 Permite medir margen por cliente, carrera o universidad. Antes no se modelaba.
==============================================================================*/

CREATE TABLE LICENCIA_HERRAMIENTA (                        -- licencia de Turnitin u otra herramienta
    licencia_id         INT IDENTITY(1,1) PRIMARY KEY,
    proveedor           VARCHAR(60) NOT NULL,
    producto            VARCHAR(80) NOT NULL,
    tipo_reporte        VARCHAR(15) NOT NULL,
    periodicidad        VARCHAR(15) NOT NULL,
    costo_periodo       DECIMAL(10,2) NOT NULL,
    cupo_reportes       INT NULL,                          -- reportes incluidos por periodo
    -- Costo de un reporte: costo del periodo entre el cupo (o el costo directo si es por reporte)
    costo_por_reporte AS (CAST(CASE WHEN periodicidad = 'POR_REPORTE' THEN costo_periodo
                                    ELSE costo_periodo / NULLIF(cupo_reportes, 0) END
                               AS DECIMAL(10,4))) PERSISTED,
    vigente_desde       DATE NOT NULL,
    vigente_hasta       DATE NULL,
    activa              BIT NOT NULL DEFAULT 1,
    CONSTRAINT CK_LICENCIA_TIPO CHECK (tipo_reporte IN ('SIMILITUD','IA','AMBOS')),
    CONSTRAINT CK_LICENCIA_PERIODO CHECK (periodicidad IN ('MENSUAL','ANUAL','POR_REPORTE'))
);
GO

CREATE TABLE REPORTE_CALIDAD (                             -- similitud e IA de cada entregable
    reporte_id          INT IDENTITY(1,1) PRIMARY KEY,
    customer_id         INT NOT NULL,
    hito_id             INT NOT NULL,
    licencia_id         INT NOT NULL,
    fecha_reporte       DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    tipo                VARCHAR(15) NOT NULL DEFAULT 'AMBOS',
    porcentaje_similitud DECIMAL(5,2) NULL,
    porcentaje_ia       DECIMAL(5,2) NULL,
    umbral_similitud    DECIMAL(5,2) NULL,                 -- umbral vigente al emitir el reporte
    umbral_ia           DECIMAL(5,2) NULL,
    costo_asignado      DECIMAL(10,4) NOT NULL DEFAULT 0,  -- COSTO del reporte (historico)
    cumple_umbral AS (CASE WHEN (porcentaje_similitud IS NULL OR umbral_similitud IS NULL
                                 OR porcentaje_similitud <= umbral_similitud)
                            AND (porcentaje_ia IS NULL OR umbral_ia IS NULL
                                 OR porcentaje_ia <= umbral_ia)
                           THEN 1 ELSE 0 END) PERSISTED,
    CONSTRAINT FK_REPORTE_CUSTOMER FOREIGN KEY (customer_id) REFERENCES CUSTOMER(customer_id),
    CONSTRAINT FK_REPORTE_HITO     FOREIGN KEY (hito_id)     REFERENCES HITO_CRONOGRAMA(hito_id),
    CONSTRAINT FK_REPORTE_LICENCIA FOREIGN KEY (licencia_id) REFERENCES LICENCIA_HERRAMIENTA(licencia_id),
    CONSTRAINT CK_REPORTE_TIPO CHECK (tipo IN ('SIMILITUD','IA','AMBOS')),
    CONSTRAINT CK_REPORTE_PCT CHECK (
        (porcentaje_similitud IS NULL OR porcentaje_similitud BETWEEN 0 AND 100) AND
        (porcentaje_ia IS NULL OR porcentaje_ia BETWEEN 0 AND 100))
);
GO

CREATE TABLE HONORARIO_TARIFA (                            -- cuanto cobra cada especialista por concepto
    honorario_tarifa_id INT IDENTITY(1,1) PRIMARY KEY,
    asesor_id           INT NOT NULL,
    concepto            VARCHAR(20) NOT NULL,
    monto               DECIMAL(10,2) NOT NULL,
    vigente_desde       DATE NOT NULL,
    vigente_hasta       DATE NULL,
    CONSTRAINT FK_HONORARIO_TARIFA_ASESOR FOREIGN KEY (asesor_id) REFERENCES ASESOR(asesor_id),
    CONSTRAINT CK_HONORARIO_TARIFA_CONCEPTO CHECK (concepto IN
        ('DIAGNOSTICO','SESION','HITO','SIMULACRO','REVISION'))
);
GO

CREATE TABLE HONORARIO (                                   -- honorario devengado y pagado
    honorario_id        INT IDENTITY(1,1) PRIMARY KEY,
    asesor_id           INT NOT NULL,
    customer_id         INT NULL,
    lead_id             INT NULL,                          -- diagnosticos antes de ser cliente
    sesion_id           INT NULL,
    hito_id             INT NULL,
    diagnostico_id      INT NULL,
    concepto            VARCHAR(20) NOT NULL,
    monto               DECIMAL(10,2) NOT NULL,
    fecha_devengo       DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    fecha_pago          DATETIME2 NULL,
    estado              VARCHAR(15) NOT NULL DEFAULT 'DEVENGADO',
    CONSTRAINT FK_HONORARIO_ASESOR      FOREIGN KEY (asesor_id)      REFERENCES ASESOR(asesor_id),
    CONSTRAINT FK_HONORARIO_CUSTOMER    FOREIGN KEY (customer_id)    REFERENCES CUSTOMER(customer_id),
    CONSTRAINT FK_HONORARIO_LEAD        FOREIGN KEY (lead_id)        REFERENCES LEAD(lead_id),
    CONSTRAINT FK_HONORARIO_SESION      FOREIGN KEY (sesion_id)      REFERENCES SESION(sesion_id),
    CONSTRAINT FK_HONORARIO_HITO        FOREIGN KEY (hito_id)        REFERENCES HITO_CRONOGRAMA(hito_id),
    CONSTRAINT FK_HONORARIO_DIAGNOSTICO FOREIGN KEY (diagnostico_id) REFERENCES DIAGNOSTICO(diagnostico_id),
    CONSTRAINT CK_HONORARIO_CONCEPTO CHECK (concepto IN
        ('DIAGNOSTICO','SESION','HITO','SIMULACRO','REVISION')),
    CONSTRAINT CK_HONORARIO_ESTADO CHECK (estado IN ('DEVENGADO','PAGADO','ANULADO')),
    CONSTRAINT CK_HONORARIO_DESTINO CHECK (customer_id IS NOT NULL OR lead_id IS NOT NULL)
);
GO


/*==============================================================================
 BLOQUE H. INDICES UTILES PARA ETL Y KPI
==============================================================================*/

CREATE UNIQUE INDEX UX_CONTACTO_WHATSAPP ON CONTACTO(whatsapp) WHERE whatsapp IS NOT NULL;

CREATE INDEX IX_CONVERSACION_CONTACTO ON CONVERSACION(contacto_id, fecha_inicio);
CREATE INDEX IX_MENSAJE_CONVERSACION_FECHA ON MENSAJE(conversacion_id, fecha_hora);
CREATE INDEX IX_ESCALAMIENTO_FECHA ON ESCALAMIENTO(conversacion_id, fecha);

CREATE INDEX IX_BUYER_FECHA ON BUYER(fecha_buyer);
CREATE INDEX IX_INTERACCION_BUYER_FECHA ON INTERACCION_CAPTACION(buyer_id, fecha_interaccion);
CREATE INDEX IX_DESCARGA_BUYER_FECHA ON DESCARGA_CONTENIDO(buyer_id, fecha_descarga);
CREATE INDEX IX_SEGUIMIENTO_BUYER_FECHA ON SEGUIMIENTO_BUYER(buyer_id, fecha_ejecucion);

CREATE INDEX IX_DIAGNOSTICO_LEAD_FECHA ON DIAGNOSTICO(lead_id, fecha_solicitud);
CREATE INDEX IX_PROPUESTA_LEAD_FECHA ON PROPUESTA(lead_id, fecha_presentacion);
CREATE INDEX IX_RESPUESTA_PROPUESTA_FECHA ON RESPUESTA_PROPUESTA(propuesta_id, fecha_respuesta);
CREATE INDEX IX_OBJECION_PROPUESTA_FECHA ON OBJECION(propuesta_id, fecha_registro);

CREATE INDEX IX_ORDEN_FECHA ON ORDEN_PAGO(fecha_creacion);
CREATE INDEX IX_CUOTA_ORDEN ON CUOTA_PAGO(orden_pago_id, fecha_vencimiento);
CREATE INDEX IX_PAGO_ORDEN_FECHA ON PAGO(orden_pago_id, fecha_confirmacion);
CREATE INDEX IX_ALERTA_COBRANZA_FECHA ON ALERTA_COBRANZA(orden_pago_id, fecha_envio);

CREATE INDEX IX_CUSTOMER_FECHA ON CUSTOMER(fecha_activacion);
CREATE INDEX IX_ASIGNACION_CUSTOMER_FECHA ON ASIGNACION_ASESOR(customer_id, fecha_asignacion);
CREATE INDEX IX_SESION_CUSTOMER_FECHA ON SESION(customer_id, fecha_agendada);
CREATE INDEX IX_HITO_CUSTOMER_FECHA ON HITO_CRONOGRAMA(customer_id, fecha_pactada);
CREATE INDEX IX_OBSERVACION_CUSTOMER ON OBSERVACION_UNIVERSITARIA(customer_id, ronda);

CREATE INDEX IX_REPORTE_CALIDAD_HITO ON REPORTE_CALIDAD(hito_id, fecha_reporte);
CREATE INDEX IX_HONORARIO_CUSTOMER ON HONORARIO(customer_id, fecha_devengo);
CREATE INDEX IX_HONORARIO_ASESOR ON HONORARIO(asesor_id, fecha_devengo);
GO


/*==============================================================================
 BLOQUE J. VISTA DE MARGEN POR CLIENTE (usa los costos nuevos)
 margen = ingresos confirmados - comision de pasarela - honorarios - costo Turnitin
 (el honorario de diagnostico previo a la compra queda en el lead, no en el customer)
==============================================================================*/

CREATE VIEW dbo.v_MargenCustomer AS
SELECT x.customer_id,
       x.ingresos,
       x.comision_pasarela,
       x.honorarios,
       x.costo_turnitin,
       margen = x.ingresos - x.comision_pasarela - x.honorarios - x.costo_turnitin
FROM (
    SELECT cu.customer_id,
           ingresos = ISNULL((SELECT SUM(pg.monto_pagado)
                              FROM dbo.PAYER py
                              INNER JOIN dbo.PAGO pg ON pg.orden_pago_id = py.orden_pago_id
                              WHERE py.payer_id = cu.payer_id AND pg.estado = 'CONFIRMADO'), 0),
           comision_pasarela = ISNULL((SELECT SUM(pg.comision_pasarela)
                              FROM dbo.PAYER py
                              INNER JOIN dbo.PAGO pg ON pg.orden_pago_id = py.orden_pago_id
                              WHERE py.payer_id = cu.payer_id AND pg.estado = 'CONFIRMADO'), 0),
           honorarios = ISNULL((SELECT SUM(h.monto)
                              FROM dbo.HONORARIO h
                              WHERE h.customer_id = cu.customer_id AND h.estado <> 'ANULADO'), 0),
           costo_turnitin = ISNULL((SELECT SUM(rc.costo_asignado)
                              FROM dbo.REPORTE_CALIDAD rc
                              WHERE rc.customer_id = cu.customer_id), 0)
    FROM dbo.CUSTOMER cu
) x;
GO


/*==============================================================================
 CONSULTA DE VERIFICACION
==============================================================================*/

SELECT t.name AS tabla, SUM(p.rows) AS filas
FROM sys.tables t
INNER JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0,1)
GROUP BY t.name
ORDER BY t.name;
GO


/*============================ PARTE 2. AMPLIACION DE LEADS (Anexo A) ============================*/
USE INBESTIGA_TESIS;
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Ampliación propuesta del OLTP para LEADS (sobre el DDL INBESTIGA_TESIS v2)
CREATE TABLE OPORTUNIDAD_COMERCIAL (
    oportunidad_id        INT IDENTITY(1,1) PRIMARY KEY,
    lead_id               INT NOT NULL,
    asesor_responsable_id INT NULL,                      -- NULL = atendida solo por el agente IA
    fecha_inicio          DATETIME2 NOT NULL,
    fecha_apta_cotizar    DATETIME2 NULL,
    estado                VARCHAR(30) NOT NULL DEFAULT 'ABIERTA',
    fecha_cierre          DATETIME2 NULL,
    motivo_cierre         VARCHAR(120) NULL,
    CONSTRAINT FK_OPORT_LEAD   FOREIGN KEY (lead_id) REFERENCES LEAD(lead_id),
    CONSTRAINT FK_OPORT_ASESOR FOREIGN KEY (asesor_responsable_id) REFERENCES ASESOR(asesor_id),
    CONSTRAINT CK_OPORT_ESTADO CHECK (estado IN ('ABIERTA','EN_DIAGNOSTICO','APTA_PARA_COTIZAR','EN_NEGOCIACION',
                                                 'ACEPTADA','TRANSFERIDA','PAYER_CONFIRMADO','DESCARTADA')),
    CONSTRAINT CK_OPORT_APTA   CHECK (fecha_apta_cotizar IS NULL OR fecha_apta_cotizar >= fecha_inicio)
);
GO
CREATE TABLE CITA_VIRTUAL (
    cita_id            INT IDENTITY(1,1) PRIMARY KEY,
    oportunidad_id     INT NOT NULL,
    asesor_id          INT NULL,
    inicio             DATETIME2 NOT NULL,
    fin                DATETIME2 NOT NULL,
    medio              VARCHAR(30) NOT NULL,
    estado             VARCHAR(20) NOT NULL DEFAULT 'SOLICITADA',
    fecha_confirmacion DATETIME2 NULL,
    CONSTRAINT FK_CITA_OPORT  FOREIGN KEY (oportunidad_id) REFERENCES OPORTUNIDAD_COMERCIAL(oportunidad_id),
    CONSTRAINT FK_CITA_ASESOR FOREIGN KEY (asesor_id) REFERENCES ASESOR(asesor_id),
    CONSTRAINT CK_CITA_HORA   CHECK (inicio < fin),
    CONSTRAINT CK_CITA_ESTADO CHECK (estado IN ('SOLICITADA','CONFIRMADA','REALIZADA','CANCELADA','NO_ASISTIO'))
);
GO
CREATE TABLE CITA_HISTORIAL (
    historial_id    INT IDENTITY(1,1) PRIMARY KEY,
    cita_id         INT NOT NULL,
    fecha_cambio    DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    estado_anterior VARCHAR(20) NULL,
    estado_nuevo    VARCHAR(20) NOT NULL,
    causa           VARCHAR(200) NULL,
    CONSTRAINT FK_CITAH_CITA FOREIGN KEY (cita_id) REFERENCES CITA_VIRTUAL(cita_id)
);
GO
CREATE TABLE TRANSFERENCIA_PAYER (
    transferencia_id INT IDENTITY(1,1) PRIMARY KEY,
    oportunidad_id   INT NOT NULL,
    propuesta_id     INT NOT NULL,                       -- versión aceptada que se transfiere
    fecha_envio      DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    idempotency_key  VARCHAR(64) NOT NULL,
    estado           VARCHAR(20) NOT NULL DEFAULT 'ENVIADA',
    CONSTRAINT FK_TRANSF_OPORT FOREIGN KEY (oportunidad_id) REFERENCES OPORTUNIDAD_COMERCIAL(oportunidad_id),
    CONSTRAINT FK_TRANSF_PROP  FOREIGN KEY (propuesta_id)   REFERENCES PROPUESTA(propuesta_id),
    CONSTRAINT UQ_TRANSF_KEY   UNIQUE (idempotency_key)
);
GO
CREATE TABLE CONVERSION_PAYER_REF (                      -- solo referencia: sin montos ni medios de pago
    conversion_id      INT IDENTITY(1,1) PRIMARY KEY,
    oportunidad_id     INT NOT NULL,
    event_id           VARCHAR(64) NOT NULL,
    fecha_confirmacion DATETIME2 NOT NULL,
    orden_pago_ref     INT NULL,
    CONSTRAINT FK_CONV_OPORT FOREIGN KEY (oportunidad_id) REFERENCES OPORTUNIDAD_COMERCIAL(oportunidad_id),
    CONSTRAINT UQ_CONV_OPORT UNIQUE (oportunidad_id),
    CONSTRAINT UQ_CONV_EVENT UNIQUE (event_id)
);
GO
-- Vínculo de las tablas existentes con la oportunidad
ALTER TABLE PERFIL_NEGOCIACION ADD oportunidad_id INT NULL
    CONSTRAINT FK_PERFILNEG_OPORT REFERENCES OPORTUNIDAD_COMERCIAL(oportunidad_id);
ALTER TABLE DIAGNOSTICO        ADD oportunidad_id INT NULL
    CONSTRAINT FK_DIAG_OPORT REFERENCES OPORTUNIDAD_COMERCIAL(oportunidad_id);
ALTER TABLE PROPUESTA          ADD oportunidad_id INT NULL
    CONSTRAINT FK_PROP_OPORT REFERENCES OPORTUNIDAD_COMERCIAL(oportunidad_id);
ALTER TABLE SEGUIMIENTO_LEAD   ADD oportunidad_id INT NULL
    CONSTRAINT FK_SEGLEAD_OPORT REFERENCES OPORTUNIDAD_COMERCIAL(oportunidad_id);
ALTER TABLE ESCALAMIENTO       ADD oportunidad_id INT NULL
    CONSTRAINT FK_ESCAL_OPORT REFERENCES OPORTUNIDAD_COMERCIAL(oportunidad_id);
GO
-- Migración: una oportunidad inicial por cada LEAD existente y vínculo de sus registros previos
INSERT OPORTUNIDAD_COMERCIAL (lead_id, fecha_inicio, estado)
SELECT l.lead_id, l.fecha_lead, 'ABIERTA' FROM LEAD l
WHERE NOT EXISTS (SELECT 1 FROM OPORTUNIDAD_COMERCIAL o WHERE o.lead_id = l.lead_id);
UPDATE t SET oportunidad_id = o.oportunidad_id FROM PERFIL_NEGOCIACION t
    INNER JOIN OPORTUNIDAD_COMERCIAL o ON o.lead_id = t.lead_id WHERE t.oportunidad_id IS NULL;
UPDATE t SET oportunidad_id = o.oportunidad_id FROM DIAGNOSTICO t
    INNER JOIN OPORTUNIDAD_COMERCIAL o ON o.lead_id = t.lead_id WHERE t.oportunidad_id IS NULL;
UPDATE t SET oportunidad_id = o.oportunidad_id FROM PROPUESTA t
    INNER JOIN OPORTUNIDAD_COMERCIAL o ON o.lead_id = t.lead_id WHERE t.oportunidad_id IS NULL;
UPDATE t SET oportunidad_id = o.oportunidad_id FROM SEGUIMIENTO_LEAD t
    INNER JOIN OPORTUNIDAD_COMERCIAL o ON o.lead_id = t.lead_id WHERE t.oportunidad_id IS NULL;
UPDATE t SET oportunidad_id = o.oportunidad_id FROM ESCALAMIENTO t
    INNER JOIN OPORTUNIDAD_COMERCIAL o ON o.lead_id = t.lead_id WHERE t.oportunidad_id IS NULL;
-- El estado de cada oportunidad migrada debe ajustarse luego según sus registros (diagnóstico, propuesta, aceptación).
GO
-- Número de versión único por oportunidad
CREATE UNIQUE INDEX UX_PROPUESTA_VERSION ON PROPUESTA (oportunidad_id, version) WHERE oportunidad_id IS NOT NULL;
GO
