/*==============================================================================
 03_DataMart_DDL.sql - Data mart LEADS (modelo estrella): 8 dimensiones y 3 hechos (Anexo B).
 Recrea la base INBESTIGA_MART. Guardar/abrir como UTF-8 con BOM.
==============================================================================*/
USE master;
GO
IF DB_ID('INBESTIGA_MART') IS NOT NULL
BEGIN
    ALTER DATABASE INBESTIGA_MART SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE INBESTIGA_MART;
END
GO
CREATE DATABASE INBESTIGA_MART;
GO
USE INBESTIGA_MART;
GO
CREATE TABLE Dim_Tiempo (
    KeyTiempo   INT IDENTITY(1,1) PRIMARY KEY,
    Anual       INT          NOT NULL,
    Trimestre    VARCHAR(12)     NOT NULL,          -- ej. 2026T1
    NumeroMes   TINYINT      NOT NULL,
    Mes         VARCHAR(12)  NOT NULL,
    Semana      TINYINT      NOT NULL,
    Dia         TINYINT      NOT NULL,
    DiaSemana   VARCHAR(12)  NOT NULL,
    idFecha     DATE         NOT NULL UNIQUE    -- 1900-01-01 = «No aplica»
);
CREATE TABLE Dim_Estudiante (   -- Estudiante > Carrera > Facultad ; Estudiante > EtapaAcademica > GrupoEtapa (tipo 1)
    KeyEstudiante   INT IDENTITY(1,1) PRIMARY KEY,
    Estudiante      VARCHAR(201) NOT NULL,
    Carrera         VARCHAR(120) NOT NULL,
    Facultad        VARCHAR(120) NULL,
    EtapaAcademica  VARCHAR(50)  NOT NULL,
    GrupoEtapa      VARCHAR(20)  NOT NULL,      -- Ciclos IX–X / Egresado / Bachiller / Otras etapas
    idContacto      INT          NOT NULL UNIQUE   -- 0 = «Sin perfil académico»
);
CREATE TABLE Dim_Ubicacion (                    -- Sede > Universidad > TipoUniversidad
    KeyUbicacion    INT IDENTITY(1,1) PRIMARY KEY,
    Sede            VARCHAR(100) NOT NULL,      -- «Sin sede registrada» si el perfil no la indica
    Universidad     VARCHAR(150) NOT NULL,
    TipoUniversidad VARCHAR(20)  NULL,
    idUniversidad   INT          NOT NULL,      -- 0 = «Sin ubicación»
    CONSTRAINT UQ_DimUbicacion UNIQUE (idUniversidad, Sede)
);
CREATE TABLE Dim_Investigacion (                -- PerfilInvestigacion > TipoTesis > Enfoque ; PerfilInvestigacion > RangoAvance ; PerfilInvestigacion > EmpresaAplicacion
    KeyInvestigacion  INT IDENTITY(1,1) PRIMARY KEY,
    PerfilInvestigacion VARCHAR(120) NOT NULL,
    Enfoque           VARCHAR(40) NOT NULL,
    TipoTesis         VARCHAR(60) NOT NULL,
    RangoAvance       VARCHAR(20) NOT NULL,
    EmpresaAplicacion VARCHAR(20) NOT NULL,
    CONSTRAINT UQ_DimInvestigacion UNIQUE (TipoTesis, RangoAvance, EmpresaAplicacion)
);
CREATE TABLE Dim_Servicio (                     -- Servicio > Familia ; Servicio > Paquete ; Servicio > TipoServicio ; Servicio > Modalidad
    KeyServicio  INT IDENTITY(1,1) PRIMARY KEY,
    Familia      VARCHAR(60)  NULL,
    TipoServicio VARCHAR(20)  NOT NULL,
    Paquete      VARCHAR(100) NULL,
    Modalidad    VARCHAR(50)  NULL,
    Servicio     VARCHAR(120) NOT NULL,
    idServicio   INT          NOT NULL UNIQUE   -- 0 = «Sin propuesta presentada»
);
CREATE TABLE Dim_Asesor (                       -- Asesor > Equipo ; Asesor > Especialidad ; Asesor > Rol
    KeyAsesor    INT IDENTITY(1,1) PRIMARY KEY,
    Rol          VARCHAR(20)  NOT NULL,
    Equipo       VARCHAR(80)  NULL,
    Especialidad VARCHAR(120) NULL,
    Asesor       VARCHAR(150) NOT NULL,
    idAsesor     INT          NOT NULL UNIQUE   -- 0 = agente IA (sin asesor humano)
);
CREATE TABLE Dim_Canal_Captacion (              -- Campania > Canal > TipoCanal ; Campania > Canal > Plataforma
    KeyCanalCaptacion INT IDENTITY(1,1) PRIMARY KEY,
    TipoCanal    VARCHAR(50)  NULL,
    Plataforma   VARCHAR(80)  NULL,
    Canal        VARCHAR(80)  NOT NULL,
    Campania     VARCHAR(150) NOT NULL,
    idCanal      INT          NOT NULL,
    idCampania   INT          NOT NULL,         -- 0 = sin campaña
    CONSTRAINT UQ_DimCanal UNIQUE (idCanal, idCampania)
);
CREATE TABLE Dim_Objecion (                     -- Tipo > Grupo
    KeyObjecion  INT IDENTITY(1,1) PRIMARY KEY,
    Grupo        VARCHAR(40)  NOT NULL,
    Tipo         VARCHAR(60)  NOT NULL,
    idObjecion   VARCHAR(100) NOT NULL UNIQUE   -- Grupo + '/' + Tipo
);
GO
CREATE TABLE Hecho_Diagnostico (                -- AD1
    KeyTiempo         INT NOT NULL,
    KeyEstudiante     INT NOT NULL,
    KeyUbicacion      INT NOT NULL,
    KeyInvestigacion  INT NOT NULL,
    KeyAsesor         INT NOT NULL,
    KeyCanalCaptacion INT NOT NULL,
    diagnostico_solicitud_madura INT NOT NULL,  -- M1
    diagnostico_oportuno         INT NOT NULL,  -- M2
    CONSTRAINT PK_HDiagnostico PRIMARY KEY (KeyTiempo, KeyEstudiante, KeyUbicacion, KeyInvestigacion, KeyAsesor, KeyCanalCaptacion),
    CONSTRAINT FK_HDiag_Tiempo   FOREIGN KEY (KeyTiempo)         REFERENCES Dim_Tiempo(KeyTiempo),
    CONSTRAINT FK_HDiag_Estud    FOREIGN KEY (KeyEstudiante)     REFERENCES Dim_Estudiante(KeyEstudiante),
    CONSTRAINT FK_HDiag_Ubic   FOREIGN KEY (KeyUbicacion)      REFERENCES Dim_Ubicacion(KeyUbicacion),
    CONSTRAINT FK_HDiag_Invest   FOREIGN KEY (KeyInvestigacion)  REFERENCES Dim_Investigacion(KeyInvestigacion),
    CONSTRAINT FK_HDiag_Asesor   FOREIGN KEY (KeyAsesor)         REFERENCES Dim_Asesor(KeyAsesor),
    CONSTRAINT FK_HDiag_Canal    FOREIGN KEY (KeyCanalCaptacion) REFERENCES Dim_Canal_Captacion(KeyCanalCaptacion),
    CONSTRAINT CK_HDiag_M CHECK (diagnostico_oportuno <= diagnostico_solicitud_madura)
);
CREATE TABLE Hecho_Oportunidad (                -- AD2
    KeyTiempoInicio    INT NOT NULL,            -- rol: inicio de la oportunidad (K5)
    KeyTiempoApta      INT NOT NULL,            -- rol: aptitud para cotizar (K2)
    KeyTiempoPropuesta INT NOT NULL,            -- rol: primera propuesta (K3)
    KeyEstudiante      INT NOT NULL,
    KeyUbicacion      INT NOT NULL,
    KeyInvestigacion   INT NOT NULL,
    KeyServicio        INT NOT NULL,
    KeyAsesor          INT NOT NULL,
    KeyCanalCaptacion  INT NOT NULL,
    oportunidad_apta_madura INT NOT NULL,       -- M3
    cotizacion_oportuna     INT NOT NULL,       -- M4
    cotizacion_madura       INT NOT NULL,       -- M5
    aceptacion_30d          INT NOT NULL,       -- M6
    cohorte_madura          INT NOT NULL,       -- M7
    conversion_60d          INT NOT NULL,       -- M8
    CONSTRAINT PK_HOportunidad PRIMARY KEY (KeyTiempoInicio, KeyTiempoApta, KeyTiempoPropuesta, KeyEstudiante, KeyUbicacion,
                                            KeyInvestigacion, KeyServicio, KeyAsesor, KeyCanalCaptacion),
    CONSTRAINT FK_HOp_TInicio   FOREIGN KEY (KeyTiempoInicio)    REFERENCES Dim_Tiempo(KeyTiempo),
    CONSTRAINT FK_HOp_TApta     FOREIGN KEY (KeyTiempoApta)      REFERENCES Dim_Tiempo(KeyTiempo),
    CONSTRAINT FK_HOp_TProp     FOREIGN KEY (KeyTiempoPropuesta) REFERENCES Dim_Tiempo(KeyTiempo),
    CONSTRAINT FK_HOp_Estud     FOREIGN KEY (KeyEstudiante)      REFERENCES Dim_Estudiante(KeyEstudiante),
    CONSTRAINT FK_HOp_Ubic     FOREIGN KEY (KeyUbicacion)      REFERENCES Dim_Ubicacion(KeyUbicacion),
    CONSTRAINT FK_HOp_Invest    FOREIGN KEY (KeyInvestigacion)   REFERENCES Dim_Investigacion(KeyInvestigacion),
    CONSTRAINT FK_HOp_Servicio  FOREIGN KEY (KeyServicio)        REFERENCES Dim_Servicio(KeyServicio),
    CONSTRAINT FK_HOp_Asesor    FOREIGN KEY (KeyAsesor)          REFERENCES Dim_Asesor(KeyAsesor),
    CONSTRAINT FK_HOp_Canal     FOREIGN KEY (KeyCanalCaptacion)  REFERENCES Dim_Canal_Captacion(KeyCanalCaptacion),
    CONSTRAINT CK_HOp_M CHECK (cotizacion_oportuna <= oportunidad_apta_madura AND aceptacion_30d <= cotizacion_madura
                               AND conversion_60d <= cohorte_madura)
);
CREATE TABLE Hecho_Recuperacion_Objecion (      -- AD3
    KeyTiempo         INT NOT NULL,
    KeyEstudiante     INT NOT NULL,
    KeyUbicacion      INT NOT NULL,
    KeyInvestigacion  INT NOT NULL,
    KeyServicio       INT NOT NULL,
    KeyAsesor         INT NOT NULL,
    KeyCanalCaptacion INT NOT NULL,
    KeyObjecion       INT NOT NULL,
    objecion_principal_madura INT NOT NULL,     -- M9
    objecion_recuperada_30d   INT NOT NULL,     -- M10
    CONSTRAINT PK_HRecObj PRIMARY KEY (KeyTiempo, KeyEstudiante, KeyUbicacion, KeyInvestigacion, KeyServicio, KeyAsesor, KeyCanalCaptacion, KeyObjecion),
    CONSTRAINT FK_HRO_Tiempo   FOREIGN KEY (KeyTiempo)         REFERENCES Dim_Tiempo(KeyTiempo),
    CONSTRAINT FK_HRO_Estud    FOREIGN KEY (KeyEstudiante)     REFERENCES Dim_Estudiante(KeyEstudiante),
    CONSTRAINT FK_HRO_Ubic     FOREIGN KEY (KeyUbicacion)      REFERENCES Dim_Ubicacion(KeyUbicacion),
    CONSTRAINT FK_HRO_Invest   FOREIGN KEY (KeyInvestigacion)  REFERENCES Dim_Investigacion(KeyInvestigacion),
    CONSTRAINT FK_HRO_Servicio FOREIGN KEY (KeyServicio)       REFERENCES Dim_Servicio(KeyServicio),
    CONSTRAINT FK_HRO_Asesor   FOREIGN KEY (KeyAsesor)         REFERENCES Dim_Asesor(KeyAsesor),
    CONSTRAINT FK_HRO_Canal    FOREIGN KEY (KeyCanalCaptacion) REFERENCES Dim_Canal_Captacion(KeyCanalCaptacion),
    CONSTRAINT FK_HRO_Objecion FOREIGN KEY (KeyObjecion)       REFERENCES Dim_Objecion(KeyObjecion),
    CONSTRAINT CK_HRO_M CHECK (objecion_recuperada_30d <= objecion_principal_madura)
);
GO
