/*==============================================================================
 03b_ampliacion_app.sql - Metadatos del data mart para la app (IDEMPOTENTE).
 No altera las 8 dimensiones ni los 3 hechos del Anexo B: solo agrega la
 bitacora de ejecuciones del ETL que muestra la franja de estado del tablero.
==============================================================================*/
USE INBESTIGA_MART;
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.ETL_EJECUCION') IS NULL
CREATE TABLE dbo.ETL_EJECUCION (
    etl_id               INT IDENTITY(1,1) PRIMARY KEY,
    inicio               DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    fin                  DATETIME2 NULL,
    duracion_ms          INT NULL,
    estado               VARCHAR(15) NOT NULL DEFAULT 'EN_CURSO',
    corte                DATETIME2 NOT NULL,          -- @Corte
    wd_horas             INT NOT NULL,                -- @WD  (diagnostico, 48 h)
    wq_horas             INT NOT NULL,                -- @WQ  (cotizacion, 2 h)
    wa_dias              INT NOT NULL,                -- @WA  (aceptacion y recuperacion, 30 d)
    wc_dias              INT NOT NULL,                -- @WC  (conversion PAYERS, 60 d)
    filas_dimensiones    INT NULL,
    filas_hechos         INT NULL,
    detalle_json         NVARCHAR(MAX) NULL,          -- filas por tabla
    oportunidades_demo   INT NULL,                    -- origen sintetico (es_demo = 1)
    oportunidades_reales INT NULL,                    -- creadas en la demo en vivo
    origen               VARCHAR(10) NOT NULL DEFAULT 'APP',
    error                NVARCHAR(2000) NULL,
    CONSTRAINT CK_ETL_ESTADO CHECK (estado IN ('EN_CURSO','OK','ERROR')),
    CONSTRAINT CK_ETL_ORIGEN CHECK (origen IN ('APP','CLI','TEST'))
);
GO
