// Generador de datos sintéticos DETERMINISTA para el OLTP (npm run seed).
// Simula BUYERS -> LEAD -> OPORTUNIDAD y cada paso de LEADS con fechas consecutivas y
// respetando la máquina de estados. NO fuerza ningún indicador: los resultados salen
// de probabilidades distintas por canal, asesor, servicio y tipo de objeción.
// Todo se marca con es_demo = 1 (CONTACTO y OPORTUNIDAD_COMERCIAL) y va en una transacción.
import { oltp, sql } from '../db.js';
import { cotizar, type Regla, type Tarifa, type Extra } from '../negocio/precios.js';
import { Azar, masDias, masHoras } from './prng.js';
import { APELLIDOS, LIMITACIONES, LUGARES, MOTIVOS_DESCARTE, NOMBRES_F, NOMBRES_M, SEDES, TEMAS, areaDeCarrera } from './textos.js';

export const SEMILLA = 20260511;
/** Ventana fija de los datos (no depende de "hoy": así el seed es reproducible). */
export const INICIO_DATOS = new Date(2026, 4, 1, 8, 0);     // 01/05/2026
export const FIN_DATOS = new Date(2026, 10, 10, 21, 0);     // 10/11/2026 21:00
const N_BUYERS = 260;
const N_LEADS = 212;

// ---------------------------------------------------------------- inserción parametrizada
type Valor = string | number | boolean | Date | null | undefined;
let nInserts = 0;
async function ins(tx: sql.Transaction, tabla: string, fila: Record<string, Valor>, idCol?: string): Promise<number> {
  const req = new sql.Request(tx);
  const cols = Object.keys(fila);
  cols.forEach((c, i) => {
    const v = fila[c];
    if (v instanceof Date) req.input(`p${i}`, sql.DateTime2, v);
    else if (typeof v === 'boolean') req.input(`p${i}`, sql.Bit, v);
    else if (typeof v === 'number') req.input(`p${i}`, Number.isInteger(v) ? sql.Int : sql.Decimal(12, 2), v);
    else req.input(`p${i}`, sql.NVarChar, v ?? null);
  });
  const out = idCol ? ` OUTPUT INSERTED.${idCol} AS id` : '';
  const r = await req.query(`INSERT dbo.${tabla} (${cols.join(', ')})${out} VALUES (${cols.map((_, i) => `@p${i}`).join(', ')})`);
  nInserts++;
  return idCol ? r.recordset[0].id : 0;
}

// ---------------------------------------------------------------- catálogos (vienen de db/oltp/03_catalogos.sql)
async function cargarCatalogos(tx: sql.Transaction) {
  const q = async (s: string) => (await new sql.Request(tx).query(s)).recordset;
  // Secuencial: una transacción de mssql admite una sola consulta a la vez.
  const consultas = [
    'SELECT universidad_id AS id, nombre FROM dbo.UNIVERSIDAD',
    'SELECT carrera_id AS id, nombre FROM dbo.CARRERA',
    'SELECT canal_id AS id, nombre FROM dbo.CANAL',
    'SELECT campania_id AS id, canal_id, nombre, fecha_inicio, fecha_fin FROM dbo.CAMPANIA',
    "SELECT servicio_id AS id, nombre, tipo_servicio FROM dbo.SERVICIO WHERE tipo_servicio <> 'DIAGNOSTICO'",
    'SELECT asesor_id AS id, nombre, rol FROM dbo.ASESOR',
    'SELECT tarifa_id, servicio_id, carrera_id, precio_base, precio_minimo, tope_descuento_pct FROM dbo.TARIFA WHERE activo = 1',
    'SELECT regla_id, nombre, tipo, factor, valor_condicion, umbral_dias, porcentaje FROM dbo.REGLA_PRECIO WHERE activa = 1',
    "SELECT entregable_id, nombre, precio_extra FROM dbo.ENTREGABLE WHERE tipo_entregable = 'EXTRA' AND activo = 1",
    'SELECT servicio_id, entregable_id, cantidad_incluida FROM dbo.SERVICIO_ENTREGABLE',
    'SELECT grupo, tipo, respuesta_base FROM dbo.CATALOGO_OBJECION WHERE activo = 1',
  ];
  const res: any[][] = [];
  for (const c of consultas) res.push(await q(c));
  const [universidades, carreras, canales, campanias, servicios, asesores, tarifas, reglas, extras, servEnt, objeciones] = res;
  if (!servicios.length || !tarifas.length || !asesores.length) throw new Error('Faltan catálogos: ejecuta primero npm run db:init.');
  const id = (lista: any[], nombre: string) => {
    const x = lista.find((e) => e.nombre === nombre);
    if (!x) throw new Error(`No existe en el catálogo: ${nombre}`);
    return x.id as number;
  };
  return {
    universidades, carreras, canales, campanias, servicios, asesores, objeciones, servEnt, id,
    tarifa: (servicioId: number, carreraId: number): Tarifa | undefined => {
      const t = tarifas.find((x: any) => x.servicio_id === servicioId && x.carrera_id === carreraId);
      return t && { tarifaId: t.tarifa_id, precioBase: Number(t.precio_base), precioMinimo: Number(t.precio_minimo), topeDescuentoPct: Number(t.tope_descuento_pct) };
    },
    reglas: reglas.map((r: any): Regla => ({ reglaId: r.regla_id, nombre: r.nombre, tipo: r.tipo, factor: r.factor,
      valorCondicion: r.valor_condicion, umbralDias: r.umbral_dias, porcentaje: Number(r.porcentaje) })),
    extras: extras.map((e: any): Extra => ({ entregableId: e.entregable_id, nombre: e.nombre, cantidad: 1, precioUnitario: Number(e.precio_extra) })),
  };
}

// ---------------------------------------------------------------- perfiles de comportamiento (supuestos de simulación)
// Ajustes aditivos sobre las probabilidades base; producen diferencias creíbles entre segmentos.
const PERFIL_CANAL: Record<string, { peso: number; diag: number; cot: number; acep: number }> = {
  'Redes sociales (Instagram)': { peso: 25, diag: -0.10, cot: -0.12, acep: 0.00 },
  'Redes sociales (TikTok)':    { peso: 20, diag: -0.16, cot: -0.15, acep: -0.10 },
  'Redes sociales (Facebook)':  { peso: 14, diag: -0.04, cot: -0.05, acep: -0.03 },
  'Convenio universitario':     { peso: 20, diag: 0.03, cot: 0.05, acep: 0.12 },
  'Referidos':                  { peso: 13, diag: 0.02, cot: 0.00, acep: 0.18 },
  'WhatsApp directo':           { peso: 8, diag: 0.00, cot: 0.00, acep: 0.05 },
};
const ASESOR_ACADEMICO_POR_AREA: Record<string, string> = {
  ing: 'Mariela Torres Vega', eco: 'Jorge Paredes León', sal: 'Lucía Fernández Arce', soc: 'Ricardo Gamboa Cruz',
};
/** Probabilidad de entregar el diagnóstico en ≤ 48 h según quién lo hace (null = Agente IA). */
const P_DIAG_A_TIEMPO: Record<string, number> = {
  'Agente IA': 0.94, 'Mariela Torres Vega': 0.74, 'Jorge Paredes León': 0.70, 'Lucía Fernández Arce': 0.56, 'Ricardo Gamboa Cruz': 0.66,
};
/** Probabilidad de cotizar en ≤ 2 h desde la aptitud según el responsable de la oportunidad. */
const P_COT_A_TIEMPO: Record<string, number> = {
  'Agente IA': 0.92, 'Carla Rojas Benites': 0.80, 'Diego Salinas Ruiz': 0.72, 'Mariela Torres Vega': 0.62,
  'Jorge Paredes León': 0.60, 'Lucía Fernández Arce': 0.52, 'Ricardo Gamboa Cruz': 0.58,
};
const GRUPOS_OBJECION: [string, number, number][] = [ // grupo, peso, probabilidad de recuperación
  ['Precio', 34, 0.42], ['Presupuesto', 12, 0.15], ['Plazo', 11, 0.46], ['Confianza / garantías', 12, 0.33],
  ['Autonomía', 6, 0.10], ['Competencia', 8, 0.24], ['Decisión de terceros', 11, 0.47], ['Alcance', 6, 0.30],
];
const SERVICIO_POR_ETAPA: Record<string, [string, number][]> = {
  CICLO_IX: [['Asesoría de proyecto de tesis', 50], ['Asesoría integral de tesis – paquete completo', 30], ['Asesoría integral de tesis – plan acompañamiento', 20]],
  CICLO_X: [['Asesoría de proyecto de tesis', 30], ['Asesoría integral de tesis – paquete completo', 40], ['Asesoría integral de tesis – plan acompañamiento', 30]],
  EGRESADO: [['Asesoría de informe final', 30], ['Asesoría integral de tesis – paquete completo', 30], ['Revisión y correcciones de tesis', 25], ['Preparación de sustentación', 15]],
  BACHILLER: [['Asesoría de informe final', 30], ['Revisión y correcciones de tesis', 35], ['Preparación de sustentación', 20], ['Asesoría integral de tesis – paquete completo', 15]],
};
const AJUSTE_SERVICIO: Record<string, number> = {
  'Revisión y correcciones de tesis': 0.12, 'Preparación de sustentación': 0.10, 'Asesoría de proyecto de tesis': 0.04,
  'Asesoría integral de tesis – paquete completo': -0.06, 'Asesoría integral de tesis – plan acompañamiento': -0.02, 'Asesoría de informe final': 0.0,
};

export interface ResumenSeed { contactos: number; buyers: number; leads: number; oportunidades: number; inserts: number; ms: number; porEstado: Record<string, number> }

export async function generarSeed(): Promise<ResumenSeed> {
  const t0 = Date.now();
  nInserts = 0;
  const az = new Azar(SEMILLA);
  const pool = await oltp();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const cat = await cargarCatalogos(tx);
    const porEstado: Record<string, number> = {};
    const nombreAsesor = (id: number | null) => (id == null ? 'Agente IA' : cat.asesores.find((a: any) => a.id === id)!.nombre);
    const ocupacion = new Map<number, number[]>(); // asesor -> inicios de cita (ms) para evitar solapamientos
    const telefonos = new Set<string>();
    let nOport = 0;
    let nContactos = 0;

    for (let i = 0; i < N_BUYERS; i++) {
      // ---------------- BUYERS (identidad y perfil; LEADS solo los referencia)
      const mujer = az.si(0.56);
      const nombres = az.elegir(mujer ? NOMBRES_F : NOMBRES_M);
      const apellidos = `${az.elegir(APELLIDOS)} ${az.elegir(APELLIDOS)}`;
      let tel: string;
      do tel = `519${String(az.ent(0, 99_999_999)).padStart(8, '0')}`; while (telefonos.has(tel));
      telefonos.add(tel);
      const esLead = i < N_LEADS;
      const inicio1 = new Date(INICIO_DATOS.getTime() + az.sig() * (masDias(FIN_DATOS, -5).getTime() - INICIO_DATOS.getTime()));
      inicio1.setHours(az.ent(8, 22), az.ent(0, 59), 0, 0);
      const fechaBuyer = masHoras(inicio1, -az.real(12, 240));
      const registro = masHoras(fechaBuyer, -az.real(0, 2));
      const canalNombre = az.ponderado(Object.entries(PERFIL_CANAL).map(([n, p]) => [n, p.peso] as const));
      const canalId = cat.id(cat.canales, canalNombre);
      const campania = cat.campanias.find((c: any) => c.canal_id === canalId && new Date(c.fecha_inicio) <= fechaBuyer &&
        (!c.fecha_fin || masDias(new Date(c.fecha_fin), 1) > fechaBuyer));
      const usarCampania = campania && az.si(0.8);

      const contactoId = await ins(tx, 'CONTACTO', {
        nombres, apellidos, whatsapp: tel,
        correo: `${nombres}.${apellidos.split(' ')[0]}${i + 1}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() + '@correo.demo',
        consentimiento_contacto: true, fecha_consentimiento: registro, no_contactar: false, fecha_registro: registro, estado: 'ACTIVO', es_demo: true,
      }, 'contacto_id');
      nContactos++;
      await ins(tx, 'CONSENTIMIENTO_HISTORIAL', { contacto_id: contactoId, fecha: registro, accion: 'OTORGA', medio: 'BUYERS',
        finalidad: 'Información y asesoría comercial de tesis', evidencia: 'Aceptó el contacto al dejar sus datos (dato sintético)' });

      const univ = az.ponderado(cat.universidades.map((u: any) => [u, u.nombre === 'Universidad Nacional de Trujillo' ? 38 : 12] as const));
      const carrera = az.elegir(cat.carreras) as any;
      const etapa = az.ponderado([['CICLO_IX', 22], ['CICLO_X', 28], ['EGRESADO', 32], ['BACHILLER', 18]] as const);
      const avancePerfil = etapa === 'CICLO_IX' ? az.ent(0, 30) : etapa === 'CICLO_X' ? az.ent(10, 60) : az.ent(20, 90);
      const tipoInv = az.ponderado([['DESCRIPTIVA', 30], ['CORRELACIONAL', 35], ['EXPERIMENTAL', 15], ['APLICADA', 20]] as const);
      const tienePerfil = az.si(0.95); // ~5 % sin perfil académico (miembro «Sin perfil académico»)
      if (tienePerfil) {
        await ins(tx, 'PERFIL_ACADEMICO', {
          contacto_id: contactoId, universidad_id: univ.id, carrera_id: carrera.id, etapa_academica: etapa,
          ciclo: etapa === 'CICLO_IX' ? 'IX' : etapa === 'CICLO_X' ? 'X' : null,
          sede: az.si(0.9) ? az.elegir(SEDES[univ.nombre] ?? ['Sede principal']) : null,
          tipo_investigacion: az.si(0.85) ? tipoInv : null, avance: az.si(0.9) ? avancePerfil : null,
        });
      }
      const servInteres = az.ponderado(SERVICIO_POR_ETAPA[etapa].map(([n, w]) => [n, w] as const));
      const buyerId = await ins(tx, 'BUYER', {
        contacto_id: contactoId, canal_captacion_id: canalId, campania_id: usarCampania ? campania.id : null,
        servicio_interes_id: cat.id(cat.servicios, servInteres), necesidad_inicial: 'Asesoría de tesis', fecha_buyer: fechaBuyer, estado: 'ACTIVO',
      }, 'buyer_id');
      if (!esLead) continue;

      // ---------------- LEAD (una sola vez por BUYER)
      const leadId = await ins(tx, 'LEAD', { buyer_id: buyerId, fecha_lead: inicio1, prioridad: az.ponderado([['ALTA', 35], ['MEDIA', 45], ['BAJA', 20]] as const), estado: 'EN_NEGOCIACION' }, 'lead_id');
      const tipoResp = az.ponderado([['ESTUDIANTE', 58], ['FAMILIAR', 36], ['EMPRESA', 6]] as const);
      await ins(tx, 'RESPONSABLE_PAGO', {
        lead_id: leadId, tipo_responsable: tipoResp, tipo_relacion: tipoResp === 'FAMILIAR' ? az.elegir(['Madre', 'Padre', 'Hermano(a)', 'Pareja']) : tipoResp === 'EMPRESA' ? 'Empleador' : 'Propio',
        segmento: tipoResp === 'EMPRESA' ? 'Corporativo' : 'Personal', nombre: tipoResp === 'ESTUDIANTE' ? `${nombres} ${apellidos}` : `${az.elegir([...NOMBRES_F, ...NOMBRES_M])} ${apellidos.split(' ')[0]} (ficticio)`,
        telefono: null, participa_decision: tipoResp !== 'ESTUDIANTE',
      });
      const pc = PERFIL_CANAL[canalNombre];
      const area = areaDeCarrera(carrera.nombre);
      const contexto = { contactoId, leadId, canalId, campaniaId: usarCampania ? campania.id : null, univ, carrera, etapa, avancePerfil, tipoInv, pc, area };

      let inicio = inicio1;
      let estadoLead = 'EN_NEGOCIACION';
      for (let ciclo = 1; ciclo <= 2; ciclo++) {
        const r = await simularOportunidad(tx, az, cat, contexto, inicio, ciclo, ocupacion, nombreAsesor);
        nOport++;
        porEstado[r.estado] = (porEstado[r.estado] ?? 0) + 1;
        estadoLead = r.estado === 'PAYER_CONFIRMADO' ? 'CONVERTIDO' : r.estado === 'DESCARTADA' ? 'DESCARTADO' : 'EN_NEGOCIACION';
        // Un lead descartado puede reabrir un nuevo ciclo de negociación meses después (LEAD 1:N OPORTUNIDAD).
        if (!(r.estado === 'DESCARTADA' && r.ultimoEvento && az.si(0.22))) break;
        inicio = masDias(r.ultimoEvento, az.real(30, 80));
        if (inicio > masDias(FIN_DATOS, -5)) break;
      }
      await new sql.Request(tx).input('e', sql.VarChar, estadoLead).input('id', sql.Int, leadId).query('UPDATE dbo.LEAD SET estado = @e WHERE lead_id = @id');

      // ~4 % revoca el consentimiento después de su última interacción (Ley 29733)
      if (az.si(0.04)) {
        const fRev = masDias(inicio, az.real(3, 20));
        if (fRev < FIN_DATOS) {
          await new sql.Request(tx).input('id', sql.Int, contactoId).input('f', sql.DateTime2, fRev).query(
            `UPDATE dbo.CONTACTO SET consentimiento_contacto = 0, no_contactar = 1, whatsapp_habilitado = 0, fecha_revocacion = @f, estado = 'BAJA' WHERE contacto_id = @id;
             UPDATE dbo.BUYER SET estado = 'NO_CONTACTAR' WHERE contacto_id = @id;`);
          await ins(tx, 'CONSENTIMIENTO_HISTORIAL', { contacto_id: contactoId, fecha: fRev, accion: 'REVOCA', medio: 'WHATSAPP',
            finalidad: 'Información y asesoría comercial de tesis', evidencia: 'Escribió «BAJA» (dato sintético)' });
        }
      }
    }
    await tx.commit();
    return { contactos: nContactos, buyers: N_BUYERS, leads: N_LEADS, oportunidades: nOport, inserts: nInserts, ms: Date.now() - t0, porEstado };
  } catch (e) {
    try { await tx.rollback(); } catch { /* conservar el error original */ }
    throw e;
  }
}

// ---------------------------------------------------------------- una oportunidad completa
async function simularOportunidad(
  tx: sql.Transaction, az: Azar, cat: Awaited<ReturnType<typeof cargarCatalogos>>, cx: any, inicio: Date, ciclo: number,
  ocupacion: Map<number, number[]>, nombreAsesor: (id: number | null) => string,
): Promise<{ estado: string; ultimoEvento: Date | null }> {
  const ok = (d: Date | null | undefined): d is Date => !!d && d <= FIN_DATOS; // solo existe lo ocurrido antes del fin de datos
  const eventos: { fecha: Date; anterior: string | null; nuevo: string | null; evento: string; detalle?: string }[] = [];

  // Responsable de la oportunidad: ~52 % solo el Agente IA (asesor NULL = miembro 0 «Agente IA»)
  const academico = cat.id(cat.asesores, ASESOR_ACADEMICO_POR_AREA[cx.area]);
  const responsable: number | null = az.ponderado([
    [null, 52], [cat.id(cat.asesores, 'Carla Rojas Benites'), 18],
    [cat.id(cat.asesores, 'Diego Salinas Ruiz'), cx.pc === PERFIL_CANAL['Convenio universitario'] ? 22 : 8], [academico, 14],
  ] as const);
  const nombreResp = nombreAsesor(responsable);

  // La oportunidad nace ABIERTA y avanza con UPDATE por cada transición: así el trigger
  // TR_OPORTUNIDAD_TRANSICION valida también los datos sintéticos.
  const oportunidadId = await ins(tx, 'OPORTUNIDAD_COMERCIAL', {
    lead_id: cx.leadId, asesor_responsable_id: responsable, fecha_inicio: inicio, estado: 'ABIERTA', es_demo: true,
  }, 'oportunidad_id');
  cx.oportunidadId = oportunidadId;
  let estado = 'ABIERTA';
  const transicion = async (fecha: Date, nuevo: string, evento: string, detalle?: string) => {
    eventos.push({ fecha, anterior: estado, nuevo, evento, detalle });
    await new sql.Request(tx).input('e', sql.VarChar, nuevo).input('id', sql.Int, oportunidadId)
      .query('UPDATE dbo.OPORTUNIDAD_COMERCIAL SET estado = @e WHERE oportunidad_id = @id');
    estado = nuevo;
  };
  const hito = (fecha: Date, evento: string, detalle?: string) => eventos.push({ fecha, anterior: null, nuevo: null, evento, detalle });
  eventos.push({ fecha: inicio, anterior: null, nuevo: 'ABIERTA', evento: 'OPORTUNIDAD_ABIERTA', detalle: ciclo > 1 ? 'Reapertura: nuevo ciclo de negociación' : 'Solicitud expresa de información' });

  // Perfil de negociación (versionado): solo lo que no viene de BUYERS
  const fechaLimite = masDias(inicio, az.ent(10, 120));
  await ins(tx, 'PERFIL_NEGOCIACION', {
    lead_id: cx.leadId, oportunidad_id: oportunidadId, version: ciclo, disponibilidad: az.elegir(['Tardes y fines de semana', 'Mañanas', 'Noches entre semana', 'Fines de semana']),
    horario: az.elegir(['18:00–21:00', '09:00–12:00', '19:00–22:00', '15:00–18:00']), fecha_limite: fechaLimite,
    nivel_confianza: az.ent(2, 5), necesidad_acompanamiento: az.elegir(LIMITACIONES), completo: true,
    fecha_registro: masHoras(inicio, az.real(0.1, 1)), presupuesto_orientativo: az.si(0.7) ? az.elegir([500, 800, 1200, 1500, 2000, 2500]) : null,
  });

  // ---------------- 1. Diagnóstico
  let fSolicitud: Date | null = az.si(0.93) ? masHoras(inicio, az.real(0.2, 30)) : null;
  if (!ok(fSolicitud)) fSolicitud = null;
  const derivado = az.si(responsable == null ? 0.2 : 0.75); // derivación a especialista
  const asesorDiag: number | null = derivado ? academico : null;
  let fEntrega: Date | null = null;
  let diag: any = null;
  if (fSolicitud) {
    await transicion(fSolicitud, 'EN_DIAGNOSTICO', 'DIAGNOSTICO_SOLICITADO');
    const pTiempo = P_DIAG_A_TIEMPO[nombreAsesor(asesorDiag)] + cx.pc.diag;
    if (az.si(0.95)) fEntrega = az.si(pTiempo) ? masHoras(fSolicitud, az.real(1, 46.5)) : masHoras(fSolicitud, az.real(50, 140));
    if (!ok(fEntrega)) fEntrega = null;
    const tipoTesis = az.si(0.94) ? (az.si(0.7) ? cx.tipoInv : az.elegir(['DESCRIPTIVA', 'CORRELACIONAL', 'EXPERIMENTAL', 'APLICADA'])) : null;
    diag = {
      tipoTesis, avance: az.si(0.93) ? Math.min(100, Math.max(0, cx.avancePerfil + az.ent(-10, 10))) : null,
      empresa: az.si(0.9) ? az.si(cx.area === 'ing' || cx.area === 'eco' ? 0.55 : 0.2) : null,
    };
    await ins(tx, 'DIAGNOSTICO', {
      lead_id: cx.leadId, oportunidad_id: oportunidadId, asesor_id: asesorDiag, fecha_solicitud: fSolicitud, fecha_entrega: fEntrega,
      estado: fEntrega ? 'ENTREGADO' : 'SOLICITADO',
      tema_tesis: az.elegir(TEMAS[cx.area]).replace('{lugar}', az.elegir(LUGARES)), tipo_tesis: diag.tipoTesis,
      avance_declarado: diag.avance, limitaciones: az.elegir(LIMITACIONES),
      tiene_empresa_aplicacion: diag.empresa, requiere_derivacion: derivado,
      resumen: fEntrega ? (derivado ? 'Diagnóstico elaborado por el asesor especialista tras derivación del agente.' : 'Diagnóstico generado en el chat por el Agente IA.') : null,
    });
    if (fEntrega) hito(fEntrega, 'DIAGNOSTICO_ENTREGADO', derivado ? `Entregado por ${nombreAsesor(asesorDiag)}` : 'Entregado por el Agente IA');
  }

  // ---------------- 2. Aptitud para cotizar (inicia el plazo de K2)
  let fApta: Date | null = fEntrega && az.si(0.87) ? masHoras(fEntrega, az.real(0.05, 6)) : null;
  if (!ok(fApta)) fApta = null;
  if (fApta) await transicion(fApta, 'APTA_PARA_COTIZAR', 'APTITUD_VERIFICADA');

  // ---------------- Cita virtual opcional (~30 %), sin solapamientos por asesor
  if (fEntrega && az.si(0.3)) await crearCita(tx, az, cx, fEntrega, responsable ?? academico, ocupacion);

  // ---------------- 3. Propuesta versionada
  let fPropuesta: Date | null = null;
  const servicioNombre = az.ponderado(SERVICIO_POR_ETAPA[cx.etapa].map(([n, w]) => [n, w] as const));
  const servicioId = cat.id(cat.servicios, servicioNombre);
  const tarifa = cat.tarifa(servicioId, cx.carrera.id);
  if (fApta && tarifa && az.si(0.91)) {
    const pTiempo = P_COT_A_TIEMPO[nombreResp] + cx.pc.cot;
    fPropuesta = az.si(pTiempo) ? masHoras(fApta, az.real(0.1, 1.95)) : masHoras(fApta, az.real(2.5, 70));
    if (!ok(fPropuesta)) fPropuesta = null;
  }
  let ultimoEvento: Date | null = eventos[eventos.length - 1].fecha;
  if (fPropuesta && tarifa) {
    const ctx = {
      universidad: cx.univ.nombre, etapaAcademica: cx.etapa, avance: diag?.avance, tipoTesis: diag?.tipoTesis,
      formaPago: az.si(0.4) ? 'CONTADO' as const : 'CUOTAS' as const,
      diasHastaFechaLimite: (fechaLimite.getTime() - fPropuesta.getTime()) / 86_400_000, aplicarPromocion: az.si(0.3),
    };
    const extras = az.si(0.25) ? [az.elegir(cat.extras)] : [];
    const versiones: { id: number; fecha: Date; estado: string }[] = [];
    const presentar = async (fecha: Date, version: number, negociadoPct = 0) => {
      const q = cotizar(tarifa, cat.reglas, { ...ctx, descuentoNegociadoPct: negociadoPct }, extras);
      const id = await ins(tx, 'PROPUESTA', {
        lead_id: cx.leadId, oportunidad_id: oportunidadId, servicio_id: servicioId, tarifa_id: q.tarifaId, asesor_id: responsable,
        generada_por: responsable == null ? 'BOT' : 'ESPECIALISTA', version, fecha_presentacion: fecha,
        precio_base: q.precioBase, monto_extras: q.montoExtras, descuento: q.descuento, recargo: q.recargo,
        precio_minimo_aplicado: q.precioMinimo, tope_descuento_aplicado: q.topeDescuentoPct,
        vigencia_hasta: masDias(fecha, 7), estado: 'PRESENTADA',
      }, 'propuesta_id');
      for (const a of q.ajustes) await ins(tx, 'PROPUESTA_AJUSTE', { propuesta_id: id, regla_id: a.reglaId, tipo: a.tipo, concepto: a.concepto, porcentaje: a.porcentaje, monto: a.monto });
      for (const se of cat.servEnt.filter((x: any) => x.servicio_id === servicioId))
        await ins(tx, 'PROPUESTA_ENTREGABLE', { propuesta_id: id, entregable_id: se.entregable_id, cantidad: se.cantidad_incluida ?? 1, precio_unitario: 0, es_extra: false });
      for (const e of extras) await ins(tx, 'PROPUESTA_ENTREGABLE', { propuesta_id: id, entregable_id: e.entregableId, cantidad: e.cantidad, precio_unitario: e.precioUnitario, es_extra: true });
      versiones.push({ id, fecha, estado: 'PRESENTADA' });
      hito(fecha, `PROPUESTA_V${version}`, `S/ ${q.precioFinal.toFixed(2)} · ${servicioNombre}`);
      return id;
    };
    await presentar(fPropuesta, 1);
    await transicion(fPropuesta, 'EN_NEGOCIACION', 'PRIMERA_PROPUESTA_PRESENTADA');

    // ---------------- 4. Objeción, ajuste y respuesta
    const pAceptar = 0.31 + cx.pc.acep + (AJUSTE_SERVICIO[servicioNombre] ?? 0) + (responsable == null ? 0 : 0.04);
    let aceptada: Date | null = null;
    let rechazada: Date | null = null;
    if (az.si(0.42)) {
      const [grupo, , pRecupera] = az.ponderado(GRUPOS_OBJECION.map((g) => [g, g[1]] as const));
      const tipoCat = cat.objeciones.find((o: any) => o.grupo === grupo);
      const fObj = masHoras(fPropuesta, az.real(2, 96));
      if (ok(fObj)) {
        const recuperada = az.si(pRecupera + cx.pc.acep / 2);
        const repetida = !recuperada && az.si(0.3);
        const objPropuesta = versiones[0].id;
        let fV2: Date | null = null;
        if (['Precio', 'Presupuesto', 'Competencia', 'Alcance'].includes(grupo) && az.si(0.6)) {
          await ins(tx, 'RESPUESTA_PROPUESTA', { propuesta_id: objPropuesta, fecha_respuesta: fObj, tipo_respuesta: 'CONTRAOFERTA', observacion: `Objeción: ${grupo.toLowerCase()}` });
          fV2 = masHoras(fObj, az.real(0.5, 30));
          if (ok(fV2)) {
            versiones[0].estado = 'REEMPLAZADA';
            await presentar(fV2, 2, az.elegir([3, 5, 8]));   // ajuste dentro del tope (el motor recorta si excede)
          } else fV2 = null;
        }
        const fResolucion = recuperada ? masHoras(fV2 ?? fObj, az.real(2, 26 * 24)) : null;
        await ins(tx, 'OBJECION', {
          propuesta_id: objPropuesta, grupo, tipo: tipoCat?.tipo ?? grupo, descripcion: null, fecha_registro: fObj,
          veces_repetida: repetida ? 2 : 1, escalada: repetida, estado: ok(fResolucion) ? 'RESUELTA' : 'PENDIENTE',
          fecha_resolucion: ok(fResolucion) ? fResolucion : null, resultado: ok(fResolucion) ? 'Aceptó la propuesta' : null,
          respuesta_agente: tipoCat?.respuesta_base ?? null,
        });
        hito(fObj, 'OBJECION_REGISTRADA', grupo);
        if (repetida || (grupo === 'Precio' && az.si(0.15))) {
          await escalar(tx, az, cx, masHoras(fObj, az.real(0.1, 24)), repetida ? 'OBJECION_REPETIDA' : 'DESCUENTO_EXCEDE_TOPE', 'COORDINACION',
            `Objeción de ${grupo.toLowerCase()} ${repetida ? 'repetida sin resolver' : 'con pedido de descuento mayor al tope'}.`, responsable ?? cat.id(cat.asesores, 'Carla Rojas Benites'));
        }
        if (recuperada) aceptada = fResolucion;
        else if (az.si(0.45)) rechazada = masHoras(fObj, az.real(24, 240));
      }
    } else if (az.si(pAceptar)) {
      // 85 % dentro de la ventana de 30 días; el resto acepta tarde (no cuenta para la aceptación en 30 días)
      aceptada = az.si(0.85) ? masHoras(fPropuesta, az.real(2, 28 * 24)) : masDias(fPropuesta, az.real(31, 55));
    } else if (az.si(0.4)) {
      rechazada = masHoras(fPropuesta, az.real(24, 12 * 24));
    }

    const vigente = versiones[versiones.length - 1];
    if (ok(aceptada)) {
      await ins(tx, 'RESPUESTA_PROPUESTA', { propuesta_id: vigente.id, fecha_respuesta: aceptada, tipo_respuesta: 'ACEPTA', observacion: `Aceptación expresa de la versión ${versiones.length}` });
      vigente.estado = 'ACEPTADA';
      await transicion(aceptada, 'ACEPTADA', 'ACEPTACION_EXPRESA', `Versión ${versiones.length}`);
      // ---------------- 5. Transferencia a PAYERS (una sola vez) y confirmación externa
      const fTransf = masHoras(aceptada, az.real(0.05, 3));
      if (ok(fTransf)) {
        await ins(tx, 'TRANSFERENCIA_PAYER', { oportunidad_id: oportunidadId, propuesta_id: vigente.id, fecha_envio: fTransf, idempotency_key: `SEED-${cx.leadId}-${ciclo}`, estado: 'ENVIADA' });
        await transicion(fTransf, 'TRANSFERIDA', 'ACUERDO_TRANSFERIDO_A_PAYERS');
        const r = az.sig();
        const fConf = r < 0.70 ? masDias(fTransf, az.real(1, 25)) : r < 0.80 ? masDias(fTransf, az.real(40, 75)) : null;
        if (ok(fConf)) {
          await ins(tx, 'CONVERSION_PAYER_REF', { oportunidad_id: oportunidadId, event_id: `EVT-SEED-${cx.leadId}-${ciclo}`, fecha_confirmacion: fConf, orden_pago_ref: null });
          await transicion(fConf, 'PAYER_CONFIRMADO', 'CONFIRMACION_PAYERS', 'Confirmación externa validada (dato sintético)');
        }
      }
    } else if (ok(rechazada)) {
      await ins(tx, 'RESPUESTA_PROPUESTA', { propuesta_id: vigente.id, fecha_respuesta: rechazada, tipo_respuesta: 'RECHAZA', observacion: null });
      vigente.estado = 'RECHAZADA';
      await transicion(rechazada, 'DESCARTADA', 'DESCARTE', 'Rechazó la propuesta');
    } else {
      // Sin respuesta: seguimiento permitido y, vencida la vigencia, se registra SIN_RESPUESTA (no siempre)
      for (let k = 1; k <= 2; k++) {
        const fSeg = masDias(vigente.fecha, k * az.real(2, 4));
        if (!ok(fSeg)) break;
        await ins(tx, 'SEGUIMIENTO_LEAD', { lead_id: cx.leadId, oportunidad_id: oportunidadId, propuesta_id: vigente.id, asesor_id: responsable, canal_id: cx.canalId,
          fecha_accion: fSeg, resultado: az.elegir(['Sin respuesta', 'Lo está evaluando', 'Pidió más información']), siguiente_accion: k === 1 ? 'Segundo recordatorio en 3 días' : 'Cerrar si no responde' });
        hito(fSeg, 'SEGUIMIENTO', `Recordatorio ${k}`);
      }
      const fVence = masDias(vigente.fecha, 7);
      if (ok(fVence) && az.si(0.7)) {
        await ins(tx, 'RESPUESTA_PROPUESTA', { propuesta_id: vigente.id, fecha_respuesta: fVence, tipo_respuesta: 'SIN_RESPUESTA', observacion: 'Venció la vigencia' });
        vigente.estado = 'VENCIDA';
      } else if (ok(fVence)) vigente.estado = 'VENCIDA';
    }
    for (const v of versiones) if (v.estado !== 'PRESENTADA')
      await new sql.Request(tx).input('e', sql.VarChar, v.estado).input('id', sql.Int, v.id).query('UPDATE dbo.PROPUESTA SET estado = @e WHERE propuesta_id = @id');
  }

  // ---------------- Descarte por inactividad (estados intermedios estancados)
  ultimoEvento = eventos.reduce((m, e) => (e.fecha > m ? e.fecha : m), eventos[0].fecha);
  if (['ABIERTA', 'EN_DIAGNOSTICO', 'APTA_PARA_COTIZAR', 'EN_NEGOCIACION'].includes(estado)) {
    const fDesc = masDias(ultimoEvento, az.real(18, 35));
    if (ok(fDesc) && az.si(0.7)) await transicion(fDesc, 'DESCARTADA', 'DESCARTE', az.elegir(MOTIVOS_DESCARTE));
  }
  ultimoEvento = eventos.reduce((m, e) => (e.fecha > m ? e.fecha : m), eventos[0].fecha);
  const cierre = estado === 'DESCARTADA' || estado === 'PAYER_CONFIRMADO' ? ultimoEvento : null;
  const motivoCierre = estado === 'DESCARTADA' ? eventos.filter((e) => e.evento === 'DESCARTE').pop()?.detalle ?? null
    : estado === 'PAYER_CONFIRMADO' ? 'Contratación confirmada por PAYERS' : null;

  await new sql.Request(tx).input('id', sql.Int, oportunidadId).input('apta', sql.DateTime2, fApta)
    .input('cierre', sql.DateTime2, cierre).input('motivo', sql.NVarChar, motivoCierre)
    .query('UPDATE dbo.OPORTUNIDAD_COMERCIAL SET fecha_apta_cotizar = @apta, fecha_cierre = @cierre, motivo_cierre = @motivo WHERE oportunidad_id = @id');
  for (const e of eventos.sort((a, b) => a.fecha.getTime() - b.fecha.getTime()))
    await ins(tx, 'OPORTUNIDAD_EVENTO', { oportunidad_id: oportunidadId, fecha: e.fecha, estado_anterior: e.anterior, estado_nuevo: e.nuevo, evento: e.evento, origen: 'SEED', detalle: e.detalle ?? null });
  return { estado, ultimoEvento };
}

// ---------------------------------------------------------------- auxiliares
async function conversacionDe(tx: sql.Transaction, cx: any): Promise<number> {
  if (cx.conversacionId) return cx.conversacionId;
  cx.conversacionId = await ins(tx, 'CONVERSACION', {
    contacto_id: cx.contactoId, canal_id: cx.canalId, campania_id: cx.campaniaId, estado: 'CERRADA', canal_mensajeria: 'HISTORICO',
    chat_id: `hist:${cx.contactoId}`, resuelta_sin_humano: false, oportunidad_id: cx.oportunidadId,
  }, 'conversacion_id');
  return cx.conversacionId;
}

async function escalar(tx: sql.Transaction, az: Azar, cx: any, fecha: Date, motivo: string, destino: string, resumen: string, asesorId: number) {
  if (fecha > FIN_DATOS) return;
  const conv = await conversacionDe(tx, cx);
  const fAtencion = masHoras(fecha, az.real(1, 36));
  const atendido = fAtencion <= FIN_DATOS && az.si(0.9);
  await ins(tx, 'ESCALAMIENTO', {
    conversacion_id: conv, lead_id: cx.leadId, oportunidad_id: cx.oportunidadId, fecha, motivo, destino_rol: destino, asesor_id: asesorId,
    fecha_atencion: atendido ? fAtencion : null, resumen_entregado: true, estado: atendido ? 'ATENDIDO' : 'PENDIENTE', resumen,
  });
}

/** Cita opcional de 45 min en horario laboral; si el asesor ya está ocupado se corre una hora. */
async function crearCita(tx: sql.Transaction, az: Azar, cx: any, despuesDe: Date, asesorId: number, ocupacion: Map<number, number[]>) {
  const inicio = masHoras(despuesDe, az.real(4, 72));
  inicio.setMinutes(0, 0, 0);
  if (inicio.getHours() < 9) inicio.setHours(9);
  if (inicio.getHours() > 19) { inicio.setDate(inicio.getDate() + 1); inicio.setHours(10); }
  const ocupadas = ocupacion.get(asesorId) ?? [];
  while (ocupadas.some((t) => Math.abs(t - inicio.getTime()) < 45 * 60_000)) inicio.setHours(inicio.getHours() + 1);
  const fin = new Date(inicio.getTime() + 45 * 60_000);
  const fSolicitada = masHoras(inicio, -az.real(20, 48));
  if (fSolicitada > FIN_DATOS) return;
  ocupadas.push(inicio.getTime());
  ocupacion.set(asesorId, ocupadas);
  const confirmada = masHoras(fSolicitada, az.real(1, 12));
  const resultado = inicio > FIN_DATOS ? (confirmada <= FIN_DATOS ? 'CONFIRMADA' : 'SOLICITADA')
    : az.ponderado([['REALIZADA', 72], ['NO_ASISTIO', 14], ['CANCELADA', 14]] as const);
  const citaId = await ins(tx, 'CITA_VIRTUAL', {
    oportunidad_id: cx.oportunidadId, asesor_id: asesorId, inicio, fin, medio: az.elegir(['Google Meet', 'Zoom', 'Llamada de WhatsApp']),
    estado: resultado, fecha_confirmacion: resultado === 'SOLICITADA' ? null : confirmada,
  }, 'cita_id');
  await ins(tx, 'CITA_HISTORIAL', { cita_id: citaId, fecha_cambio: fSolicitada, estado_anterior: null, estado_nuevo: 'SOLICITADA', causa: 'Ofrecida por el agente y aceptada por el estudiante' });
  if (resultado !== 'SOLICITADA') await ins(tx, 'CITA_HISTORIAL', { cita_id: citaId, fecha_cambio: confirmada, estado_anterior: 'SOLICITADA', estado_nuevo: 'CONFIRMADA', causa: 'Confirmada por el estudiante' });
  if (!['SOLICITADA', 'CONFIRMADA'].includes(resultado)) await ins(tx, 'CITA_HISTORIAL', { cita_id: citaId, fecha_cambio: resultado === 'CANCELADA' ? masHoras(inicio, -3) : fin,
    estado_anterior: 'CONFIRMADA', estado_nuevo: resultado, causa: resultado === 'CANCELADA' ? 'Cancelada por el estudiante' : 'Registrado por el asesor' });
}
