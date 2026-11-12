// Listas para datos 100 % ficticios. Las combinaciones nombre + apellidos son aleatorias
// y no corresponden a personas reales; los teléfonos y correos son inventados.
export const NOMBRES_F = ['Ana', 'María', 'Lucía', 'Valeria', 'Camila', 'Daniela', 'Fernanda', 'Sofía', 'Andrea', 'Ximena',
  'Paola', 'Carolina', 'Rosa', 'Milagros', 'Katherine', 'Diana', 'Gabriela', 'Alejandra', 'Fiorella', 'Melissa', 'Jimena', 'Mariana'];
export const NOMBRES_M = ['Luis', 'José', 'Carlos', 'Jorge', 'Miguel', 'Diego', 'Renzo', 'Kevin', 'Bruno', 'Andrés', 'Sebastián',
  'Fernando', 'Ricardo', 'Álvaro', 'Gustavo', 'Martín', 'Joel', 'Piero', 'Christian', 'Marco', 'Raúl', 'Eduardo'];
export const APELLIDOS = ['Quispe', 'Flores', 'Rodríguez', 'Sánchez', 'García', 'Rojas', 'Díaz', 'Torres', 'Vásquez', 'Castillo',
  'Ramírez', 'Mendoza', 'Chávez', 'Gutiérrez', 'Vargas', 'Reyes', 'Cruz', 'Ruiz', 'Paredes', 'Alvarado', 'Valverde', 'Cabrera',
  'Gamboa', 'Polo', 'Rebaza', 'Asmat', 'Plasencia', 'Zavaleta', 'Lozano', 'Ibáñez', 'Rengifo', 'Salazar', 'León', 'Chuquimango'];

export const SEDES: Record<string, string[]> = {
  'Universidad Nacional de Trujillo': ['Ciudad Universitaria', 'Sede Valle Jequetepeque', 'Sede Huamachuco'],
  'Universidad Privada Antenor Orrego': ['Campus Trujillo', 'Filial Piura'],
  'Universidad César Vallejo': ['Campus Trujillo', 'Campus Chiclayo', 'Campus Lima Norte'],
  'Universidad Privada del Norte': ['Sede Trujillo El Molino', 'Sede Cajamarca'],
  'Universidad Nacional Mayor de San Marcos': ['Ciudad Universitaria'],
  'Universidad Nacional de Cajamarca': ['Sede Cajamarca'],
};

/** Temas de tesis por área (con {lugar}); se completan al azar. */
export const TEMAS: Record<string, string[]> = {
  ing: ['Sistema web para la gestión de inventarios en una mype de {lugar}', 'Modelo de machine learning para predecir la deserción estudiantil en {lugar}',
    'Aplicación de Lean Manufacturing para reducir mermas en una empresa de {lugar}', 'Evaluación estructural de viviendas autoconstruidas en {lugar}'],
  eco: ['Influencia del marketing digital en las ventas de mypes de {lugar}', 'Cultura organizacional y desempeño laboral en una municipalidad de {lugar}',
    'Gestión de cuentas por cobrar y liquidez en una empresa comercial de {lugar}', 'Impacto del crédito agrícola en productores de {lugar}'],
  sal: ['Nivel de conocimiento sobre anemia en madres de niños menores de 3 años en {lugar}', 'Factores asociados a la adherencia al tratamiento de hipertensión en {lugar}',
    'Estrés académico y estrategias de afrontamiento en estudiantes de {lugar}'],
  soc: ['Eficacia de las medidas de protección en casos de violencia familiar en {lugar}', 'Estrategias lúdicas y comprensión lectora en estudiantes de primaria de {lugar}',
    'Uso de redes sociales y opinión pública en jóvenes de {lugar}'],
};
export const LUGARES = ['Trujillo', 'La Esperanza', 'El Porvenir', 'Víctor Larco', 'Huanchaco', 'Chepén', 'Pacasmayo', 'Cajamarca', 'Chiclayo', 'Virú'];
export const LIMITACIONES = ['Poco tiempo por trabajo', 'Dificultad con el marco metodológico', 'Necesita apoyo en el análisis estadístico',
  'Observaciones previas del jurado', 'Falta de acceso a la población de estudio', 'Dudas en la redacción de antecedentes'];
export const MOTIVOS_DESCARTE = ['Sin respuesta tras seguimiento', 'Eligió hacerlo por su cuenta', 'Contrató otro servicio', 'Pospone su tesis',
  'Sin presupuesto por ahora'];

export function areaDeCarrera(carrera: string): keyof typeof TEMAS {
  if (/Ingenier/.test(carrera)) return 'ing';
  if (/Administraci|Contabilidad|Econom/.test(carrera)) return 'eco';
  if (/Enfermer|Medicina|Psicolog/.test(carrera)) return 'sal';
  return 'soc';
}
