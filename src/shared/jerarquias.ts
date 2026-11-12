// Jerarquías del cuadro 4.7 del informe, de lo más general a lo más detallado (orden de drill-down).
// La comparten backend (lista blanca de columnas) y frontend (selector de dimensión).

export type Dimension = 'tiempo' | 'estudiante' | 'ubicacion' | 'investigacion' | 'servicio' | 'asesor' | 'canal' | 'objecion';
export interface Nivel { id: string; etiqueta: string }
export interface Jerarquia { id: string; etiqueta: string; dimension: Dimension; niveles: Nivel[] }

export const JERARQUIAS: readonly Jerarquia[] = [
  { id: 'canal', etiqueta: 'Canal de captación', dimension: 'canal',
    niveles: [{ id: 'TipoCanal', etiqueta: 'Tipo de canal' }, { id: 'Canal', etiqueta: 'Canal' }, { id: 'Campania', etiqueta: 'Campaña' }] },
  { id: 'plataforma', etiqueta: 'Canal por plataforma', dimension: 'canal',
    niveles: [{ id: 'Plataforma', etiqueta: 'Plataforma' }, { id: 'Canal', etiqueta: 'Canal' }, { id: 'Campania', etiqueta: 'Campaña' }] },
  { id: 'tiempo', etiqueta: 'Tiempo (cohorte de cada indicador)', dimension: 'tiempo',
    niveles: [{ id: 'Anual', etiqueta: 'Año' }, { id: 'Trimestre', etiqueta: 'Trimestre' }, { id: 'Mes', etiqueta: 'Mes' }, { id: 'Dia', etiqueta: 'Día' }] },
  { id: 'estudiante', etiqueta: 'Estudiante: facultad y carrera', dimension: 'estudiante',
    niveles: [{ id: 'Facultad', etiqueta: 'Facultad' }, { id: 'Carrera', etiqueta: 'Carrera' }, { id: 'Estudiante', etiqueta: 'Estudiante' }] },
  { id: 'etapa', etiqueta: 'Estudiante: etapa académica', dimension: 'estudiante',
    niveles: [{ id: 'GrupoEtapa', etiqueta: 'Grupo de etapa' }, { id: 'EtapaAcademica', etiqueta: 'Etapa académica' }, { id: 'Estudiante', etiqueta: 'Estudiante' }] },
  { id: 'ubicacion', etiqueta: 'Ubicación', dimension: 'ubicacion',
    niveles: [{ id: 'TipoUniversidad', etiqueta: 'Tipo de universidad' }, { id: 'Universidad', etiqueta: 'Universidad' }, { id: 'Sede', etiqueta: 'Sede' }] },
  { id: 'investigacion', etiqueta: 'Investigación: enfoque y tipo', dimension: 'investigacion',
    niveles: [{ id: 'Enfoque', etiqueta: 'Enfoque' }, { id: 'TipoTesis', etiqueta: 'Tipo de tesis' }, { id: 'PerfilInvestigacion', etiqueta: 'Perfil de investigación' }] },
  { id: 'avance', etiqueta: 'Investigación: avance', dimension: 'investigacion',
    niveles: [{ id: 'RangoAvance', etiqueta: 'Rango de avance' }, { id: 'PerfilInvestigacion', etiqueta: 'Perfil de investigación' }] },
  { id: 'empresa', etiqueta: 'Investigación: empresa de aplicación', dimension: 'investigacion',
    niveles: [{ id: 'EmpresaAplicacion', etiqueta: 'Empresa de aplicación' }, { id: 'PerfilInvestigacion', etiqueta: 'Perfil de investigación' }] },
  { id: 'servicio', etiqueta: 'Servicio ofertado: familia', dimension: 'servicio',
    niveles: [{ id: 'Familia', etiqueta: 'Familia' }, { id: 'Servicio', etiqueta: 'Servicio' }] },
  { id: 'paquete', etiqueta: 'Servicio ofertado: paquete', dimension: 'servicio',
    niveles: [{ id: 'Paquete', etiqueta: 'Paquete' }, { id: 'Servicio', etiqueta: 'Servicio' }] },
  { id: 'asesor', etiqueta: 'Asesor: equipo', dimension: 'asesor',
    niveles: [{ id: 'Equipo', etiqueta: 'Equipo' }, { id: 'Asesor', etiqueta: 'Asesor' }] },
  { id: 'rol', etiqueta: 'Asesor: rol', dimension: 'asesor',
    niveles: [{ id: 'Rol', etiqueta: 'Rol' }, { id: 'Asesor', etiqueta: 'Asesor' }] },
  { id: 'objecion', etiqueta: 'Objeción', dimension: 'objecion',
    niveles: [{ id: 'Grupo', etiqueta: 'Grupo' }, { id: 'Tipo', etiqueta: 'Tipo' }] },
];

export const jerarquia = (id: string) => JERARQUIAS.find((j) => j.id === id);
