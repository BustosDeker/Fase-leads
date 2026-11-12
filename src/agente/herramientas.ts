// Herramientas del Agente Negociador. Cada una valida su entrada (zod), opera SOLO sobre la oportunidad
// de la conversación en curso (el modelo nunca elige ids de otras personas) y reutiliza las reglas de
// src/negocio (máquina de estados, motor de precios, agenda). Las escrituras van en transacción.
import { z } from 'zod';
import { oltp, sql } from '../db.js';
import { agendarCita, cambiarEstadoCita, reprogramarCita } from '../negocio/agenda.js';
import { calificarAptitud, entregarDiagnostico, faltantesDiagnostico, solicitarDiagnostico } from '../negocio/diagnostico.js';
import { ErrorNegocio, enTransaccion, oportunidadBloqueada, registrarEvento, transicionar } from '../negocio/oportunidad.js';
import { presentarPropuesta, simularCotizacion } from '../negocio/propuestas.js';
import { catalogos, type ContextoAgente } from './contexto.js';
import { buscarCarrera, buscarUniversidad, extraerTemaTesis, HERRAMIENTAS_SIN_CONSENTIMIENTO } from './guardas.js';
import type { HerramientaLLM } from './tipos.js';

export const MOTIVOS_ESCALAMIENTO = ['CLIENTE_PIDE_ESPECIALISTA', 'FUERA_COBERTURA', 'OBJECION_REPETIDA', 'DESCUENTO_EXCEDE_TOPE', 'RECLAMO_PAGO',
  'RIESGO_ABANDONO', 'PRECIO_NO_CONFIGURADO', 'EXCEPCION_CONTRACTUAL', 'CONSULTA_ACADEMICA_COMPLEJA', 'INCERTIDUMBRE_AGENTE', 'POSIBLE_INYECCION'] as const;

interface Herramienta<T extends z.ZodTypeAny> {
  def: HerramientaLLM;
  entrada: T;
  ejecutar(cx: ContextoAgente, e: z.infer<T>): Promise<unknown>;
}
const h = <T extends z.ZodTypeAny>(x: Herramienta<T>) => x;

const objeto = (props: Record<string, unknown>, requeridos: string[]) => ({ type: 'object', properties: props, required: requeridos, additionalProperties: false });
const medio = (cx: ContextoAgente) => (cx.canal === 'WHATSAPP' ? 'WHATSAPP' : 'SIMULADOR');

function exigirOportunidad(cx: ContextoAgente) {
  if (!cx.oportunidadId || !cx.leadId) throw new ErrorNegocio('La conversación no tiene una oportunidad comercial asociada.');
  return { oportunidadId: cx.oportunidadId, leadId: cx.leadId };
}

async function guardarFechaLimiteDiagnostico(tx: sql.Transaction, cx: ContextoAgente, fechaLimite: string | null) {
  const { oportunidadId, leadId } = exigirOportunidad(cx);
  await new sql.Request(tx).input('l', sql.Int, leadId).input('o', sql.Int, oportunidadId)
    .input('f', sql.Date, fechaLimite).input('p', sql.Decimal(10, 2), cx.preferencias?.presupuesto ?? null)
    .input('d', sql.VarChar(150), cx.preferencias?.disponibilidad ?? null).query(`
      INSERT dbo.PERFIL_NEGOCIACION (lead_id, oportunidad_id, version, fecha_limite, presupuesto_orientativo, disponibilidad, completo)
      SELECT @l, @o, ISNULL(MAX(version), 0) + 1, @f, @p, @d,
        CASE WHEN @f IS NOT NULL AND @d IS NOT NULL THEN 1 ELSE 0 END
      FROM dbo.PERFIL_NEGOCIACION WITH (UPDLOCK, HOLDLOCK) WHERE oportunidad_id = @o`);
}

const parametrosCotizacion = {
  servicio_id: { type: 'integer', description: 'Id del servicio (de la lista de servicios cotizables).' },
  forma_pago: { type: 'string', enum: ['CONTADO', 'CUOTAS'], description: 'Forma de pago que prefiere el estudiante.' },
  aplicar_promocion: { type: 'boolean', description: 'true solo si el estudiante califica a una promoción vigente que el sistema reconoce.' },
  descuento_negociado_pct: { type: 'number', description: 'Descuento adicional negociado (%). 0 si no lo pidió. El sistema verifica tope y precio mínimo.' },
  extras: { type: 'array', items: { type: 'object', properties: {
    entregable_id: { type: 'integer', description: 'Id de un extra devuelto por detalle_servicio.' },
    cantidad: { type: 'integer', minimum: 1, maximum: 10 },
  }, required: ['entregable_id', 'cantidad'], additionalProperties: false }, description: 'Solo extras devueltos por detalle_servicio.' },
};
export const esquemaEntradaCotizacion = z.object({
  servicio_id: z.number().int().positive(),
  forma_pago: z.enum(['CONTADO', 'CUOTAS']).default('CUOTAS'),
  aplicar_promocion: z.boolean().default(false),
  descuento_negociado_pct: z.number().min(0).max(100).default(0),
  extras: z.array(z.object({ entregable_id: z.number().int().positive(), cantidad: z.number().int().min(1).max(10) })).max(10).default([]),
});
const entradaCotizacion = esquemaEntradaCotizacion;
const solicitud = (cx: ContextoAgente, e: z.infer<typeof entradaCotizacion>) => ({
  oportunidadId: exigirOportunidad(cx).oportunidadId, servicioId: e.servicio_id, formaPago: e.forma_pago,
  aplicarPromocion: e.aplicar_promocion, descuentoNegociadoPct: e.descuento_negociado_pct,
  extras: e.extras.map((x) => ({ entregableId: x.entregable_id, cantidad: x.cantidad })),
});

function datosDiagnostico(cx: ContextoAgente) {
  const d = cx.diagnostico;
  return d ? { tema: d.tema, tipoTesis: d.tipoTesis, avance: d.avance, tieneEmpresa: d.tieneEmpresa,
    limitaciones: d.limitaciones, fechaLimite: cx.preferencias?.fechaLimite ?? null } : null;
}

function resumenDiagnostico(cx: ContextoAgente) {
  const d = cx.diagnostico!;
  const empresa = d.tieneEmpresa ? 'sí' : 'no';
  return `Tema: ${d.tema}; tipo: ${d.tipoTesis}; avance declarado: ${d.avance}%; empresa o institución: ${empresa}; ` +
    `limitaciones: ${d.limitaciones}; fecha límite: ${cx.preferencias?.fechaLimite}.`;
}

async function hayTarifaVigente(cx: ContextoAgente) {
  if (!cx.perfil) return false;
  const r = await (await oltp()).request().input('c', sql.Int, cx.perfil.carreraId).input('e', sql.VarChar(50), cx.perfil.etapa).query(`
    SELECT TOP 1 tarifa_id FROM dbo.TARIFA WHERE carrera_id = @c AND activo = 1
      AND (etapa_academica IS NULL OR etapa_academica = @e)
      AND vigente_desde <= CAST(SYSDATETIME() AS DATE) AND (vigente_hasta IS NULL OR vigente_hasta >= CAST(SYSDATETIME() AS DATE))`);
  return !!r.recordset[0];
}

function recortar(texto: string | null | undefined, maximo: number) {
  const limpio = String(texto ?? 'No registrado').replace(/\s+/g, ' ').trim();
  return limpio.length <= maximo ? limpio : `${limpio.slice(0, Math.max(0, maximo - 1)).trimEnd()}…`;
}

async function resumenDerivacion(tx: sql.Transaction, cx: ContextoAgente, motivo: string, detalle: string) {
  const ultimo = await new sql.Request(tx).input('c', sql.Int, cx.conversacionId).query(`
    SELECT TOP 1 contenido FROM dbo.MENSAJE WHERE conversacion_id = @c AND emisor = 'CLIENTE'
    ORDER BY fecha_hora DESC, mensaje_id DESC`);
  const estudiante = `${cx.nombres} ${cx.apellidos}`.trim();
  const academico = cx.perfil ? `${cx.perfil.carrera} / ${cx.perfil.universidad} / ${cx.perfil.etapa}` : 'No registrado';
  const diagnostico = cx.diagnostico ? `${cx.diagnostico.tema ?? 'No registrado'} / avance ${cx.diagnostico.avance ?? 'No registrado'}%` : 'No registrado';
  const propuesta = cx.propuesta ? `${cx.propuesta.servicio}, versión ${cx.propuesta.version}, S/ ${cx.propuesta.precioFinal.toFixed(2)}` : 'No hay propuesta vigente';
  const objeciones = cx.objecionesPendientes.length ? cx.objecionesPendientes.map((o) => `${o.tipo} (${o.veces})`).join(', ') : 'Ninguna pendiente';
  return [
    `Estudiante: ${recortar(estudiante, 90)}`,
    `Carrera/universidad/etapa: ${recortar(academico, 170)}`,
    `Tema/avance: ${recortar(diagnostico, 180)}`,
    `Propuesta vigente: ${recortar(propuesta, 150)}`,
    `Objeciones: ${recortar(objeciones, 130)}`,
    `Motivo: ${recortar(motivo, 80)}`,
    `Último mensaje: ${recortar(ultimo.recordset[0]?.contenido ?? detalle, 210)}`,
    `Detalle: ${recortar(detalle, 150)}`,
  ].join('\n').slice(0, 1000);
}

async function citaDeOportunidad(tx: sql.Transaction, oportunidadId: number, citaId: number) {
  const r = await new sql.Request(tx).input('c', sql.Int, citaId).input('o', sql.Int, oportunidadId)
    .query('SELECT cita_id, oportunidad_id FROM dbo.CITA_VIRTUAL WITH (UPDLOCK) WHERE cita_id = @c AND oportunidad_id = @o');
  if (!r.recordset[0]) throw new ErrorNegocio('La cita no existe o no pertenece a esta oportunidad.', 404);
}

function respuestaCita(c: any, notaSinEnlace = 'El asesor enviará el enlace antes de la reunión.') {
  return { ok: true, citaId: c?.cita_id, inicio: fechaLocalIso(new Date(c?.inicio)), fin: fechaLocalIso(new Date(c?.fin)),
    medio: c?.medio, enlace: c?.enlace ?? null, nota: c?.enlace ? undefined : notaSinEnlace };
}

/** Registra un escalamiento y pasa la conversación a control humano (el agente deja de responder). */
export async function escalar(cx: ContextoAgente, motivo: (typeof MOTIVOS_ESCALAMIENTO)[number] | 'BOT_NO_RESPONDE', resumen: string) {
  const destino = ['DESCUENTO_EXCEDE_TOPE', 'OBJECION_REPETIDA', 'EXCEPCION_CONTRACTUAL'].includes(motivo) ? 'COORDINACION'
    : motivo === 'RECLAMO_PAGO' ? 'ADMIN' : 'ESPECIALISTA';
  return enTransaccion(await oltp(), async (tx) => {
    const resumenEstructurado = await resumenDerivacion(tx, cx, motivo, resumen);
    const r = await new sql.Request(tx).input('c', sql.Int, cx.conversacionId).input('l', sql.Int, cx.leadId).input('o', sql.Int, cx.oportunidadId)
      .input('m', sql.VarChar, motivo).input('d', sql.VarChar, destino).input('r', sql.NVarChar, resumenEstructurado)
      .query(`INSERT dbo.ESCALAMIENTO (conversacion_id, lead_id, oportunidad_id, motivo, destino_rol, resumen_entregado, estado, resumen)
              OUTPUT INSERTED.escalamiento_id VALUES (@c, @l, @o, @m, @d, 1, 'PENDIENTE', @r);
              UPDATE dbo.CONVERSACION SET estado = 'DERIVADA', control_humano = 1, resuelta_sin_humano = 0 WHERE conversacion_id = @c;`);
    if (cx.oportunidadId) await registrarEvento(tx, cx.oportunidadId, 'ESCALAMIENTO', 'AGENTE', resumenEstructurado.slice(0, 300));
    return { escalamientoId: r.recordset[0].escalamiento_id as number, destino };
  });
}

export const HERRAMIENTAS = {
  consultar_situacion: h({
    def: { nombre: 'consultar_situacion', descripcion: 'Devuelve la situación actualizada del estudiante: consentimiento, estado de la oportunidad, perfil, diagnóstico, propuesta vigente, servicios cotizables y cita próxima. Úsala después de registrar algo si necesitas confirmar el nuevo estado.', esquema: objeto({}, []) },
    entrada: z.object({}).passthrough(),
    async ejecutar(cx) {
      const { cargarContexto } = await import('./contexto.js');
      const n = await cargarContexto(cx.conversacionId);
      return { consentimiento: n.consentimiento, estado: n.estado, perfil: n.perfil, preferencias: n.preferencias, diagnostico: n.diagnostico,
        propuesta: n.propuesta, citaProxima: n.citaProxima, objecionesPendientes: n.objecionesPendientes };
    },
  }),

  consultar_catalogo: h({
    def: { nombre: 'consultar_catalogo', descripcion: 'Lista servicios activos con tarifa vigente para la carrera y etapa del estudiante. Devuelve solo precio base público; no devuelve precio mínimo ni tope de descuento.',
      esquema: objeto({}, []) },
    entrada: z.object({}).passthrough(),
    async ejecutar(cx) {
      const { oportunidadId } = exigirOportunidad(cx);
      if (!cx.perfil) return { ok: false, error: 'Falta carrera o etapa académica para consultar una tarifa.' };
      const r = await (await oltp()).request().input('o', sql.Int, oportunidadId).input('c', sql.Int, cx.perfil.carreraId)
        .input('e', sql.VarChar(50), cx.perfil.etapa).query(`
          WITH vigentes AS (
            SELECT t.*, ROW_NUMBER() OVER (PARTITION BY t.servicio_id ORDER BY CASE WHEN t.etapa_academica = @e THEN 0 ELSE 1 END,
              t.vigente_desde DESC, t.tarifa_id DESC) AS rn
            FROM dbo.TARIFA t
            WHERE t.activo = 1 AND t.carrera_id = @c AND (t.etapa_academica IS NULL OR t.etapa_academica = @e)
              AND t.vigente_desde <= CAST(SYSDATETIME() AS DATE)
              AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= CAST(SYSDATETIME() AS DATE))
          )
          SELECT s.servicio_id, s.nombre, s.familia, s.paquete, s.modalidad, s.tipo_servicio, v.precio_base
          FROM dbo.SERVICIO s JOIN vigentes v ON v.servicio_id = s.servicio_id AND v.rn = 1
          WHERE s.activo = 1 ORDER BY s.familia, s.nombre`);
      if (!r.recordset.length) {
        await escalar(cx, 'PRECIO_NO_CONFIGURADO', `No hay tarifa vigente para carrera ${cx.perfil.carreraId}, etapa ${cx.perfil.etapa}.`);
        return { ok: false, error: 'No hay tarifa vigente para la carrera y etapa del estudiante. Se derivó a una persona.' };
      }
      return { ok: true, servicios: r.recordset.map((x: any) => ({ id: x.servicio_id, nombre: x.nombre, familia: x.familia,
        paquete: x.paquete, modalidad: x.modalidad, tipo: x.tipo_servicio, precio_base: Number(x.precio_base) })) };
    },
  }),

  detalle_servicio: h({
    def: { nombre: 'detalle_servicio', descripcion: 'Devuelve entregables, límites y extras de un servicio del catálogo para esta oportunidad. Solo usa datos de la base.',
      esquema: objeto({ servicio_id: { type: 'integer', description: 'Id devuelto por consultar_catalogo.' } }, ['servicio_id']) },
    entrada: z.object({ servicio_id: z.number().int().positive() }),
    async ejecutar(cx, e) {
      const { oportunidadId } = exigirOportunidad(cx);
      const r = await (await oltp()).request().input('o', sql.Int, oportunidadId).input('s', sql.Int, e.servicio_id)
        .input('c', sql.Int, cx.perfil?.carreraId ?? 0).input('et', sql.VarChar(50), cx.perfil?.etapa ?? null).query(`
          SELECT s.servicio_id, s.nombre, s.familia, s.paquete, s.modalidad, s.tipo_servicio, s.precio_referencia,
                 se.entregable_id, se.cantidad_incluida, se.umbral_pct, se.frecuencia_dias, se.duracion_min,
                 e.nombre AS entregable, e.tipo_entregable, e.descripcion, e.precio_extra, se.precio_unidad_extra
          FROM dbo.SERVICIO s
          LEFT JOIN dbo.SERVICIO_ENTREGABLE se ON se.servicio_id = s.servicio_id
          LEFT JOIN dbo.ENTREGABLE e ON e.entregable_id = se.entregable_id AND e.tipo_entregable <> 'EXTRA'
          WHERE s.servicio_id = @s AND s.activo = 1
            AND EXISTS (SELECT 1 FROM dbo.TARIFA t WHERE t.servicio_id = s.servicio_id AND t.carrera_id = @c AND t.activo = 1
              AND (t.etapa_academica IS NULL OR t.etapa_academica = @et)
              AND t.vigente_desde <= CAST(SYSDATETIME() AS DATE) AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= CAST(SYSDATETIME() AS DATE)))
          ORDER BY se.entregable_id;
          SELECT e.entregable_id, e.nombre AS entregable, e.descripcion, e.precio_extra,
                 COALESCE(se.precio_unidad_extra, e.precio_extra) AS precio_unidad_extra
          FROM dbo.ENTREGABLE e
          LEFT JOIN dbo.SERVICIO_ENTREGABLE se ON se.entregable_id = e.entregable_id AND se.servicio_id = @s
          WHERE e.tipo_entregable = 'EXTRA' AND e.activo = 1
          ORDER BY e.entregable_id`);
      const recordsets = r.recordsets as sql.IRecordSet<any>[];
      const filas = recordsets[0], extrasCatalogo = recordsets[1];
      if (!filas.length) return { ok: false, error: 'Ese servicio no está disponible con tarifa vigente para esta oportunidad.' };
      const first = filas[0];
      return { ok: true, servicio: { id: first.servicio_id, nombre: first.nombre, familia: first.familia, paquete: first.paquete,
        modalidad: first.modalidad, tipo: first.tipo_servicio },
        entregables: filas.filter((x: any) => x.tipo_entregable && x.tipo_entregable !== 'EXTRA').map((x: any) => ({
          entregable_id: x.entregable_id, nombre: x.entregable, cantidad_incluida: x.cantidad_incluida, descripcion: x.descripcion,
          umbral_pct: x.umbral_pct, frecuencia_dias: x.frecuencia_dias, duracion_min: x.duracion_min })),
        extras: extrasCatalogo.map((x: any) => ({ entregable_id: x.entregable_id,
          nombre: x.entregable, descripcion: x.descripcion, precio_unidad_extra: Number(x.precio_unidad_extra ?? x.precio_extra) })),
        limites_alcance: filas.filter((x: any) => x.tipo_entregable && x.tipo_entregable !== 'EXTRA').map((x: any) => ({
          entregable_id: x.entregable_id, cantidad_incluida: x.cantidad_incluida, umbral_pct: x.umbral_pct,
          frecuencia_dias: x.frecuencia_dias, duracion_min: x.duracion_min })) };
    },
  }),

  registrar_consentimiento: h({
    def: { nombre: 'registrar_consentimiento', descripcion: 'Registra que el estudiante OTORGA o REVOCA su consentimiento para el tratamiento de sus datos personales (Ley 29733). Úsala solo cuando el estudiante lo expresa claramente; guarda su frase textual como evidencia.',
      esquema: objeto({ acepta: { type: 'boolean', description: 'true = otorga; false = revoca o no acepta.' }, frase_del_estudiante: { type: 'string', description: 'Texto literal con el que lo expresó.' } }, ['acepta', 'frase_del_estudiante']) },
    entrada: z.object({ acepta: z.boolean(), frase_del_estudiante: z.string().min(1).max(300) }),
    async ejecutar(cx, e) {
      await enTransaccion(await oltp(), async (tx) => {
        await new sql.Request(tx).input('c', sql.Int, cx.contactoId).input('a', sql.Bit, e.acepta).query(e.acepta
          ? `UPDATE dbo.CONTACTO SET consentimiento_contacto = 1, fecha_consentimiento = SYSDATETIME(), no_contactar = 0, fecha_revocacion = NULL, estado = 'ACTIVO' WHERE contacto_id = @c`
          : `UPDATE dbo.CONTACTO SET consentimiento_contacto = 0, no_contactar = 1, whatsapp_habilitado = 0, fecha_revocacion = SYSDATETIME() WHERE contacto_id = @c`);
        await new sql.Request(tx).input('c', sql.Int, cx.contactoId).input('ac', sql.VarChar, e.acepta ? 'OTORGA' : 'REVOCA').input('m', sql.VarChar, medio(cx))
          .input('f', sql.NVarChar, 'Atención comercial de asesoría de tesis por WhatsApp').input('ev', sql.NVarChar, e.frase_del_estudiante.slice(0, 300))
          .query('INSERT dbo.CONSENTIMIENTO_HISTORIAL (contacto_id, accion, medio, finalidad, evidencia) VALUES (@c, @ac, @m, @f, @ev)');
        if (!e.acepta) await new sql.Request(tx).input('c', sql.Int, cx.conversacionId).query(`UPDATE dbo.CONVERSACION SET estado = 'CERRADA', fecha_cierre = SYSDATETIME() WHERE conversacion_id = @c`);
        if (cx.oportunidadId) await registrarEvento(tx, cx.oportunidadId, e.acepta ? 'CONSENTIMIENTO_OTORGADO' : 'CONSENTIMIENTO_REVOCADO', 'AGENTE', e.frase_del_estudiante.slice(0, 200));
      });
      return { ok: true, consentimiento: e.acepta ? 'OTORGADO' : 'REVOCADO', nota: e.acepta ? 'Ya puedes pedir sus datos académicos.' : 'No vuelvas a escribirle; despídete confirmando la baja.' };
    },
  }),

  registrar_perfil_academico: h({
    def: { nombre: 'registrar_perfil_academico', descripcion: 'Guarda universidad, carrera y etapa académica del estudiante. Acepta nombres o siglas (p. ej. "UNT", "Ingeniería de Sistemas"). Si no se reconoce alguno, devuelve las opciones atendidas.',
      esquema: objeto({ universidad: { type: 'string' }, carrera: { type: 'string' }, etapa: { type: 'string', enum: ['CICLO_IX', 'CICLO_X', 'EGRESADO', 'BACHILLER'] },
        sede: { type: 'string', description: 'Sede/campus indicado por el estudiante.' } }, ['universidad', 'carrera', 'etapa']) },
    entrada: z.object({ universidad: z.string().min(2).max(150), carrera: z.string().min(2).max(120),
      etapa: z.enum(['CICLO_IX', 'CICLO_X', 'EGRESADO', 'BACHILLER']), sede: z.string().max(100).optional() }),
    async ejecutar(cx, e) {
      const cat = await catalogos();
      const u = buscarUniversidad(e.universidad, cat), c = buscarCarrera(e.carrera, cat);
      if (!u || !c) return { ok: false, error: `No reconozco ${!u ? 'la universidad' : 'la carrera'}.`,
        universidades_atendidas: cat.universidades.filter((x) => x.atendida).map((x) => x.nombre), carreras_atendidas: cat.carreras.filter((x) => x.atendida).map((x) => x.nombre) };
      if (!u.atendida || !c.atendida) return { ok: false, fuera_de_cobertura: true, error: `${!u.atendida ? u.nombre : c.nombre} está fuera de la cobertura actual: corresponde escalar con motivo FUERA_COBERTURA.` };
      await enTransaccion(await oltp(), async (tx) => {
        const ciclo = e.etapa === 'CICLO_IX' ? 'IX' : e.etapa === 'CICLO_X' ? 'X' : null;
        await new sql.Request(tx).input('c', sql.Int, cx.contactoId).input('u', sql.Int, u.id).input('ca', sql.Int, c.id)
          .input('e', sql.VarChar, e.etapa).input('ci', sql.VarChar(20), ciclo).input('s', sql.VarChar(100), e.sede ?? null).query(`
          MERGE dbo.PERFIL_ACADEMICO AS d USING (SELECT @c AS contacto_id) s ON d.contacto_id = s.contacto_id
          WHEN MATCHED THEN UPDATE SET universidad_id = @u, carrera_id = @ca, etapa_academica = @e, ciclo = @ci, sede = @s
          WHEN NOT MATCHED THEN INSERT (contacto_id, universidad_id, carrera_id, etapa_academica, ciclo, sede) VALUES (@c, @u, @ca, @e, @ci, @s);`);
        if (cx.oportunidadId) await registrarEvento(tx, cx.oportunidadId, 'PERFIL_ACADEMICO_REGISTRADO', 'AGENTE',
          `${c.nombre} · ${u.nombre} · ${e.etapa}${ciclo ? ` · ciclo ${ciclo}` : ''}${e.sede ? ` · sede ${e.sede}` : ''}`);
      });
      return { ok: true, universidad: u.nombre, carrera: c.nombre, etapa: e.etapa };
    },
  }),

  registrar_preferencias: h({
    def: { nombre: 'registrar_preferencias', descripcion: 'Guarda (como nueva versión del perfil de negociación) la fecha límite de sustentación o entrega, el presupuesto orientativo en soles y la disponibilidad horaria. La fecha límite influye en recargos por urgencia del motor de precios.',
      esquema: objeto({ fecha_limite: { type: 'string', description: 'AAAA-MM-DD' }, presupuesto_orientativo: { type: 'number' }, disponibilidad: { type: 'string' } }, []) },
    entrada: z.object({ fecha_limite: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), presupuesto_orientativo: z.number().min(0).max(100000).optional(), disponibilidad: z.string().max(150).optional() }),
    async ejecutar(cx, e) {
      const { oportunidadId, leadId } = exigirOportunidad(cx);
      await enTransaccion(await oltp(), async (tx) => {
        await new sql.Request(tx).input('l', sql.Int, leadId).input('o', sql.Int, oportunidadId)
          .input('f', sql.Date, e.fecha_limite ?? cx.preferencias?.fechaLimite ?? null)
          .input('p', sql.Decimal(10, 2), e.presupuesto_orientativo ?? cx.preferencias?.presupuesto ?? null)
          .input('d', sql.VarChar, (e.disponibilidad ?? cx.preferencias?.disponibilidad ?? null)?.slice(0, 150) ?? null).query(`
          INSERT dbo.PERFIL_NEGOCIACION (lead_id, oportunidad_id, version, fecha_limite, presupuesto_orientativo, disponibilidad, completo)
          SELECT @l, @o, ISNULL(MAX(version), 0) + 1, @f, @p, @d, CASE WHEN @f IS NOT NULL AND @d IS NOT NULL THEN 1 ELSE 0 END
          FROM dbo.PERFIL_NEGOCIACION WITH (UPDLOCK, HOLDLOCK) WHERE oportunidad_id = @o`);
        await registrarEvento(tx, oportunidadId, 'PERFIL_NEGOCIACION_ACTUALIZADO', 'AGENTE', JSON.stringify(e).slice(0, 300));
      });
      return { ok: true };
    },
  }),

  solicitar_diagnostico: h({
    def: { nombre: 'solicitar_diagnostico', descripcion: 'Registra el diagnóstico solo cuando el estudiante haya indicado explícitamente un tema, tipo de tesis, avance, si tiene empresa/institución, fecha de entrega o que aún no está definida, y limitaciones (o que no tiene). Nunca infieras datos ni uses datos de universidad/carrera como tema. Guarda la fecha límite y los datos del diagnóstico en una sola transacción.',
      esquema: objeto({ tema_tesis: { type: 'string' }, tipo_tesis: { type: 'string', enum: ['DESCRIPTIVA', 'CORRELACIONAL', 'EXPERIMENTAL', 'APLICADA', 'NO_DEFINIDO'] },
        avance_declarado: { type: 'number', description: 'Porcentaje 0–100.' }, tiene_empresa_aplicacion: { type: 'boolean' },
        fecha_limite: { type: ['string', 'null'], description: 'Fecha AAAA-MM-DD; null solo si el estudiante dijo que aún no la tiene definida.' },
        limitaciones: { type: 'string', description: 'Limitaciones declaradas o "Ninguna indicada".' } },
      ['tema_tesis', 'tipo_tesis', 'avance_declarado', 'tiene_empresa_aplicacion', 'fecha_limite', 'limitaciones']) },
    entrada: z.object({ tema_tesis: z.string().min(3).max(250),
      tipo_tesis: z.enum(['DESCRIPTIVA', 'CORRELACIONAL', 'EXPERIMENTAL', 'APLICADA', 'NO_DEFINIDO']),
      avance_declarado: z.number().min(0).max(100), tiene_empresa_aplicacion: z.boolean(),
      fecha_limite: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), limitaciones: z.string().trim().min(2).max(300) }),
    async ejecutar(cx, e) {
      const { oportunidadId } = exigirOportunidad(cx);
      if (!cx.perfil) return { ok: false, error: 'Primero registra universidad, carrera y etapa.' };
      if (!extraerTemaTesis(e.tema_tesis)) return { ok: false, error: 'Falta un tema concreto de tesis. Pregúntaselo al estudiante antes de registrar el diagnóstico.' };
      if (cx.diagnostico && cx.diagnostico.estado !== 'ENTREGADO') return { ok: false, error: 'Ya hay un diagnóstico en curso.', diagnostico: cx.diagnostico };
      const r = await enTransaccion(await oltp(), async (tx) => {
        await guardarFechaLimiteDiagnostico(tx, cx, e.fecha_limite);
        return solicitarDiagnostico(tx, { oportunidadId, temaTesis: e.tema_tesis, tipoTesis: e.tipo_tesis,
          avanceDeclarado: e.avance_declarado, tieneEmpresaAplicacion: e.tiene_empresa_aplicacion, limitaciones: e.limitaciones }, null, 'AGENTE');
      });
      return { ok: true, diagnosticoId: r.diagnostico_id, plazo: 'máximo 48 horas', siguiente: 'Un especialista revisa y entrega el diagnóstico; luego se cotiza.' };
    },
  }),
  actualizar_diagnostico_pendiente: h({
    def: { nombre: 'actualizar_diagnostico_pendiente', descripcion: 'Completa un diagnóstico pendiente con el tema explícito, tipo de tesis, avance, empresa/institución, fecha límite (o null si el estudiante confirmó que no está definida) y limitaciones declaradas. Nunca inventes ni uses universidad/carrera como tema; pregunta por cualquier dato faltante.',
      esquema: objeto({ tema_tesis: { type: 'string' }, tipo_tesis: { type: 'string', enum: ['DESCRIPTIVA', 'CORRELACIONAL', 'EXPERIMENTAL', 'APLICADA', 'NO_DEFINIDO'] },
        avance_declarado: { type: 'number', description: 'Porcentaje 0–100.' }, tiene_empresa_aplicacion: { type: 'boolean' },
        fecha_limite: { type: ['string', 'null'], description: 'Fecha AAAA-MM-DD o null si confirmó que no está definida.' },
        limitaciones: { type: 'string', description: 'Limitaciones declaradas o "Ninguna indicada".' } },
      ['tema_tesis', 'tipo_tesis', 'avance_declarado', 'tiene_empresa_aplicacion', 'fecha_limite', 'limitaciones']) },
    entrada: z.object({ tema_tesis: z.string().min(3).max(250),
      tipo_tesis: z.enum(['DESCRIPTIVA', 'CORRELACIONAL', 'EXPERIMENTAL', 'APLICADA', 'NO_DEFINIDO']),
      avance_declarado: z.number().min(0).max(100), tiene_empresa_aplicacion: z.boolean(),
      fecha_limite: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), limitaciones: z.string().trim().min(2).max(300) }),
    async ejecutar(cx, e) {
      const { oportunidadId } = exigirOportunidad(cx);
      if (!cx.diagnostico || cx.diagnostico.estado === 'ENTREGADO') return { ok: false, error: 'No hay un diagnóstico pendiente que se pueda completar.' };
      const tema = extraerTemaTesis(e.tema_tesis);
      if (!tema) return { ok: false, error: 'Falta un tema concreto de tesis. Pregúntaselo al estudiante antes de actualizar.' };
      await enTransaccion(await oltp(), async (tx) => {
        await guardarFechaLimiteDiagnostico(tx, cx, e.fecha_limite);
        const r = await new sql.Request(tx).input('d', sql.Int, cx.diagnostico!.id).input('o', sql.Int, oportunidadId)
          .input('t', sql.NVarChar(250), tema).input('tt', sql.VarChar, e.tipo_tesis)
          .input('av', sql.Decimal(5, 2), e.avance_declarado).input('em', sql.Bit, e.tiene_empresa_aplicacion)
          .input('li', sql.NVarChar(300), e.limitaciones).query(`
            UPDATE dbo.DIAGNOSTICO
            SET tema_tesis = @t, tipo_tesis = @tt, avance_declarado = @av,
                tiene_empresa_aplicacion = @em, limitaciones = @li
            OUTPUT INSERTED.diagnostico_id
            WHERE diagnostico_id = @d AND oportunidad_id = @o AND estado <> 'ENTREGADO'`);
        if (!r.recordset[0]) throw new ErrorNegocio('El diagnóstico ya no está pendiente o no pertenece a esta oportunidad.');
        await registrarEvento(tx, oportunidadId, 'DIAGNOSTICO_ACTUALIZADO', 'AGENTE', `Se completó la información del tema: ${tema.slice(0, 250)}`);
      });
      return { ok: true, diagnosticoId: cx.diagnostico.id, siguiente: 'La solicitud sigue pendiente de revisión por el especialista.' };
    },
  }),

  entregar_diagnostico: h({
    def: { nombre: 'entregar_diagnostico', descripcion: 'Entrega el diagnóstico de esta oportunidad cuando todos sus datos están completos y no requiere derivación. Registra fecha_entrega y devuelve un resumen basado únicamente en los datos guardados.',
      esquema: objeto({}, []) },
    entrada: z.object({}).passthrough(),
    async ejecutar(cx) {
      const { oportunidadId } = exigirOportunidad(cx);
      const d = datosDiagnostico(cx);
      if (!d) return { ok: false, faltan: ['diagnóstico solicitado'] };
      if (cx.diagnostico!.estado === 'ENTREGADO') return { ok: false, error: 'El diagnóstico ya fue entregado.', diagnosticoId: cx.diagnostico!.id };
      if (cx.diagnostico!.requiereDerivacion) {
        await escalar(cx, 'CONSULTA_ACADEMICA_COMPLEJA', 'El diagnóstico requiere revisión de una persona especialista antes de entregarse.');
        return { ok: false, derivado: true, error: 'El diagnóstico requiere revisión de un especialista; se derivó la conversación.' };
      }
      const faltan = faltantesDiagnostico(d);
      if (faltan.length) return { ok: false, faltan, error: 'Completa esos datos antes de entregar el diagnóstico.' };
      const resumen = resumenDiagnostico(cx);
      const r = await enTransaccion(await oltp(), (tx) => entregarDiagnostico(tx, cx.diagnostico!.id, resumen, 'AGENTE', oportunidadId));
      return { ok: true, diagnosticoId: cx.diagnostico!.id, fecha_entrega: r.fechaEntrega, horas_desde_solicitud: Number(r.horas.toFixed(2)), resumen,
        siguiente: 'Verificar requisitos mínimos con calificar_aptitud antes de cotizar.' };
    },
  }),

  calificar_aptitud: h({
    def: { nombre: 'calificar_aptitud', descripcion: 'Verifica los requisitos mínimos y pasa la oportunidad de EN_DIAGNOSTICO a APTA_PARA_COTIZAR. No cotiza ni expone precios internos.',
      esquema: objeto({}, []) },
    entrada: z.object({}).passthrough(),
    async ejecutar(cx) {
      const { oportunidadId } = exigirOportunidad(cx);
      if (cx.estado !== 'EN_DIAGNOSTICO') return { ok: false, error: `La aptitud solo se verifica en EN_DIAGNOSTICO; estado actual: ${cx.estado ?? 'sin estado'}.` };
      const d = datosDiagnostico(cx);
      if (!d || cx.diagnostico!.estado !== 'ENTREGADO') return { ok: false, faltan: ['diagnóstico entregado'] };
      if (cx.diagnostico!.requiereDerivacion) {
        await escalar(cx, 'CONSULTA_ACADEMICA_COMPLEJA', 'El diagnóstico requiere evaluación de una persona; el agente no puede calificar la aptitud.');
        return { ok: false, derivado: true, error: 'La aptitud será revisada por un especialista.' };
      }
      const faltan = faltantesDiagnostico(d);
      if (faltan.length) return { ok: false, faltan, error: 'Faltan requisitos mínimos para calificar la aptitud.' };
      if (!cx.perfil) return { ok: false, faltan: ['universidad, carrera y etapa académica'] };
      if (!await hayTarifaVigente(cx)) {
        await escalar(cx, 'PRECIO_NO_CONFIGURADO', `No hay tarifa vigente para ${cx.perfil.carrera} en la etapa ${cx.perfil.etapa}.`);
        return { ok: false, derivado: true, error: 'No hay tarifa vigente para esta carrera y etapa; se derivó a una persona.' };
      }
      await enTransaccion(await oltp(), (tx) => calificarAptitud(tx, oportunidadId, 'AGENTE'));
      return { ok: true, estado: 'APTA_PARA_COTIZAR', siguiente: 'Ya se puede consultar el catálogo y cotizar.' };
    },
  }),

  simular_cotizacion: h({
    def: { nombre: 'simular_cotizacion', descripcion: 'Calcula una cotización SIN guardarla (motor de precios: base + extras + recargos − descuentos, con tope de descuento y precio mínimo). Úsala para responder "¿cuánto cuesta?" o para evaluar un descuento pedido antes de presentarlo. Si "bloqueada" es true, el descuento pedido excede lo permitido: no lo ofrezcas.',
      esquema: objeto(parametrosCotizacion, ['servicio_id']) },
    entrada: entradaCotizacion,
    async ejecutar(cx, e) {
      const s = await simularCotizacion(await oltp(), solicitud(cx, e));
      const q = s.cotizacion;
      return { servicio: s.servicio.nombre, precio_base: q.precioBase, extras: q.montoExtras, recargos: q.recargo, descuentos: q.descuento,
        extras_detalle: q.extras.map((x) => ({ entregable_id: x.entregableId, nombre: x.nombre, cantidad: x.cantidad, precio_unidad: x.precioUnitario })),
        precio_final: q.precioFinal, ajustes: q.ajustes.map((a) => ({ concepto: a.concepto, tipo: a.tipo, monto: a.monto })),
        bloqueada: s.bloqueada, avisos: s.avisos };
    },
  }),

  presentar_propuesta: h({
    def: { nombre: 'presentar_propuesta', descripcion: 'Presenta formalmente una propuesta (nueva versión, vigencia de 7 días). Solo con la oportunidad apta para cotizar o en negociación. Si el descuento excede lo permitido, falla: entonces escala con motivo DESCUENTO_EXCEDE_TOPE.',
      esquema: objeto(parametrosCotizacion, ['servicio_id']) },
    entrada: entradaCotizacion,
    async ejecutar(cx, e) {
      const r = await enTransaccion(await oltp(), (tx) => presentarPropuesta(tx, solicitud(cx, e), { origen: 'AGENTE', asesorId: null }));
      const q = r.cotizacion;
      return { ok: true, version: r.version, precio_final: r.precioFinal, precio_base: q.precioBase, extras: q.montoExtras, recargos: q.recargo,
        extras_detalle: q.extras.map((x) => ({ entregable_id: x.entregableId, nombre: x.nombre, cantidad: x.cantidad, precio_unidad: x.precioUnitario })),
        descuentos: q.descuento, ajustes: q.ajustes.map((a) => ({ concepto: a.concepto, tipo: a.tipo, monto: a.monto })), vigencia: '7 días' };
    },
  }),

  registrar_objecion: h({
    def: { nombre: 'registrar_objecion', descripcion: 'Registra una objeción del estudiante sobre la propuesta vigente (grupo y tipo del catálogo de objeciones) y la respuesta que le diste. Si la misma objeción se repite hasta el máximo del catálogo, el sistema escala automáticamente.',
      esquema: objeto({ grupo: { type: 'string' }, tipo: { type: 'string' }, descripcion: { type: 'string', description: 'Lo que dijo el estudiante, resumido.' }, respuesta_dada: { type: 'string' } }, ['grupo', 'tipo', 'descripcion', 'respuesta_dada']) },
    entrada: z.object({ grupo: z.string().max(40), tipo: z.string().max(60), descripcion: z.string().max(500), respuesta_dada: z.string().max(1000) }),
    async ejecutar(cx, e) {
      const { oportunidadId } = exigirOportunidad(cx);
      if (!cx.propuesta) return { ok: false, error: 'No hay una propuesta vigente: responde la duda sin registrarla como objeción.' };
      const cat = (await catalogos()).objeciones.find((o) => o.grupo === e.grupo && o.tipo === e.tipo)
        ?? (await catalogos()).objeciones.find((o) => o.tipo === e.tipo);
      const max = cat?.maxRepeticiones ?? 2;
      const r = await enTransaccion(await oltp(), async (tx) => {
        const prev = await new sql.Request(tx).input('o', sql.Int, oportunidadId).input('t', sql.VarChar, cat?.tipo ?? e.tipo).query(`
          SELECT TOP 1 ob.objecion_id, ob.veces_repetida FROM dbo.OBJECION ob WITH (UPDLOCK) JOIN dbo.PROPUESTA p ON p.propuesta_id = ob.propuesta_id
          WHERE p.oportunidad_id = @o AND ob.tipo = @t AND ob.estado = 'PENDIENTE' ORDER BY ob.fecha_registro DESC`);
        if (prev.recordset[0]) {
          const veces = prev.recordset[0].veces_repetida + 1;
          await new sql.Request(tx).input('id', sql.Int, prev.recordset[0].objecion_id).input('v', sql.Int, veces).input('esc', sql.Bit, veces >= max)
            .input('r', sql.NVarChar, e.respuesta_dada).query('UPDATE dbo.OBJECION SET veces_repetida = @v, escalada = @esc, respuesta_agente = @r WHERE objecion_id = @id');
          await registrarEvento(tx, oportunidadId, 'OBJECION_REPETIDA', 'AGENTE', `${cat?.tipo ?? e.tipo} (${veces})`);
          return { veces };
        }
        await new sql.Request(tx).input('p', sql.Int, cx.propuesta!.id).input('g', sql.VarChar, cat?.grupo ?? e.grupo).input('t', sql.VarChar, cat?.tipo ?? e.tipo)
          .input('d', sql.VarChar, e.descripcion.slice(0, 500)).input('r', sql.NVarChar, e.respuesta_dada)
          .query(`INSERT dbo.OBJECION (propuesta_id, grupo, tipo, descripcion, veces_repetida, escalada, estado, respuesta_agente) VALUES (@p, @g, @t, @d, 1, 0, 'PENDIENTE', @r)`);
        await registrarEvento(tx, oportunidadId, 'OBJECION_REGISTRADA', 'AGENTE', cat?.tipo ?? e.tipo);
        return { veces: 1 };
      });
      if (r.veces >= max) {
        await escalar(cx, 'OBJECION_REPETIDA', `La objeción "${cat?.tipo ?? e.tipo}" se repitió ${r.veces} veces sin resolverse. Último mensaje: ${e.descripcion}`);
        return { ok: true, veces: r.veces, escalada: true, nota: 'Se derivó a una persona: avisa al estudiante que un especialista le escribirá.' };
      }
      return { ok: true, veces: r.veces, escalada: false, respuesta_respaldada: cat?.respuesta ?? null };
    },
  }),

  registrar_respuesta_propuesta: h({
    def: { nombre: 'registrar_respuesta_propuesta', descripcion: 'Registra la respuesta del estudiante a la propuesta vigente. ACEPTA solo con aceptación expresa (la oportunidad pasa a ACEPTADA y se coordina el pago con el área de pagos). RECHAZA si la descarta. CONTRAOFERTA si propone otras condiciones.',
      esquema: objeto({ respuesta: { type: 'string', enum: ['ACEPTA', 'RECHAZA', 'CONTRAOFERTA'] }, observacion: { type: 'string' } }, ['respuesta']) },
    entrada: z.object({ respuesta: z.enum(['ACEPTA', 'RECHAZA', 'CONTRAOFERTA']), observacion: z.string().max(500).optional() }),
    async ejecutar(cx, e) {
      const { oportunidadId } = exigirOportunidad(cx);
      if (!cx.propuesta) return { ok: false, error: 'No hay una propuesta vigente.' };
      await enTransaccion(await oltp(), async (tx) => {
        const op = await oportunidadBloqueada(tx, oportunidadId);
        await new sql.Request(tx).input('p', sql.Int, cx.propuesta!.id).input('t', sql.VarChar, e.respuesta).input('o', sql.VarChar, e.observacion?.slice(0, 500) ?? null)
          .query('INSERT dbo.RESPUESTA_PROPUESTA (propuesta_id, tipo_respuesta, observacion) VALUES (@p, @t, @o)');
        if (e.respuesta === 'ACEPTA') {
          if (op.estado !== 'EN_NEGOCIACION') throw new ErrorNegocio(`La oportunidad está en ${op.estado}; no se puede aceptar.`);
          await new sql.Request(tx).input('p', sql.Int, cx.propuesta!.id).query(`UPDATE dbo.PROPUESTA SET estado = 'ACEPTADA' WHERE propuesta_id = @p`);
          await new sql.Request(tx).input('o', sql.Int, oportunidadId).query(`UPDATE dbo.OBJECION SET estado = 'RESUELTA', fecha_resolucion = SYSDATETIME(), resultado = 'Aceptó la propuesta'
            WHERE estado = 'PENDIENTE' AND propuesta_id IN (SELECT propuesta_id FROM dbo.PROPUESTA WHERE oportunidad_id = @o)`);
          await transicionar(tx, oportunidadId, 'ACEPTADA', 'AGENTE', `Aceptó la versión ${cx.propuesta!.version}`);
        } else if (e.respuesta === 'RECHAZA') {
          await new sql.Request(tx).input('p', sql.Int, cx.propuesta!.id).query(`UPDATE dbo.PROPUESTA SET estado = 'RECHAZADA' WHERE propuesta_id = @p AND estado = 'PRESENTADA'`);
          await registrarEvento(tx, oportunidadId, 'PROPUESTA_RECHAZADA', 'AGENTE', e.observacion ?? null);
        } else await registrarEvento(tx, oportunidadId, 'CONTRAOFERTA', 'AGENTE', e.observacion ?? null);
      });
      // Acuerdo aceptado: se transfiere a PAYERS de inmediato (si falla, queda para reintentar desde la pantalla PAYERS).
      if (e.respuesta === 'ACEPTA') {
        try { const { transferirAPayers } = await import('../integraciones/integraciones.js'); await transferirAPayers(oportunidadId, 'AGENTE'); }
        catch (err) { console.error('[agente] transferencia a PAYERS pendiente:', (err as Error).message); }
      }
      return { ok: true, respuesta: e.respuesta, siguiente: e.respuesta === 'ACEPTA' ? 'El área de pagos (PAYERS) le enviará el contrato y el enlace de pago; tú no pides datos de pago.' : null };
    },
  }),

  consultar_horarios: h({
    def: { nombre: 'consultar_horarios', descripcion: 'Devuelve hasta 5 horarios libres (45 min, días hábiles de 9:00 a 19:00) del asesor comercial para una cita virtual OPCIONAL.', esquema: objeto({}, []) },
    entrada: z.object({}).passthrough(),
    async ejecutar(cx) {
      exigirOportunidad(cx);
      const asesorId = await asesorComercial(cx);
      const r = await (await oltp()).request().input('a', sql.Int, asesorId).query(`
        SELECT inicio, fin FROM dbo.CITA_VIRTUAL WHERE asesor_id = @a AND estado <> 'CANCELADA' AND fin > SYSDATETIME() AND inicio < DATEADD(DAY, 8, SYSDATETIME())`);
      const ocupadas = r.recordset.map((x: any) => [new Date(x.inicio).getTime(), new Date(x.fin).getTime()]);
      const libres: string[] = [];
      const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 2);
      for (let i = 0; i < 24 * 8 && libres.length < 5; i++, d.setHours(d.getHours() + 1)) {
        if (d.getDay() === 0 || d.getHours() < 9 || d.getHours() > 18) continue;
        const ini = d.getTime(), fin = ini + 45 * 60_000;
        if (ocupadas.some(([a, b]) => ini < b && a < fin)) continue;
        libres.push(fechaLocalIso(d));
      }
      return { asesor_id: asesorId, horarios: libres, medios: ['Google Meet', 'Zoom', 'Llamada de WhatsApp'], nota: 'Fechas en hora de Perú (AAAA-MM-DDTHH:mm).' };
    },
  }),

  agendar_cita: h({
    def: { nombre: 'agendar_cita', descripcion: 'Agenda una cita virtual opcional con el asesor comercial en un horario que el estudiante eligió (usa uno de consultar_horarios). El sistema rechaza solapamientos.',
      esquema: objeto({ inicio: { type: 'string', description: 'AAAA-MM-DDTHH:mm en hora de Perú.' }, medio: { type: 'string', enum: ['Google Meet', 'Zoom', 'Llamada de WhatsApp'] } }, ['inicio']) },
    entrada: z.object({ inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/), medio: z.enum(['Google Meet', 'Zoom', 'Llamada de WhatsApp']).default('Google Meet') }),
    async ejecutar(cx, e) {
      const { oportunidadId } = exigirOportunidad(cx);
      const asesorId = await asesorComercial(cx);
      const inicio = new Date(e.inicio.slice(0, 16));          // hora local del servidor = hora de Perú
      const r = await enTransaccion(await oltp(), (tx) => agendarCita(tx, { oportunidadId, asesorId, inicio, duracionMin: 45, medio: e.medio }, 'AGENTE'));
      return { ok: true, citaId: r.citaId, inicio: fechaLocalIso(inicio), medio: e.medio, duracion: '45 minutos', enlace: r.enlace,
        nota: r.enlace ? undefined : 'El asesor enviará el enlace antes de la reunión.' };
    },
  }),

  cancelar_cita: h({
    def: { nombre: 'cancelar_cita', descripcion: 'Cancela una cita futura de esta oportunidad. Registra historial y evento.',
      esquema: objeto({ cita_id: { type: 'integer' }, causa: { type: 'string' } }, ['cita_id']) },
    entrada: z.object({ cita_id: z.number().int().positive(), causa: z.string().trim().min(3).max(300).default('Cancelada por el estudiante') }),
    async ejecutar(cx, e) {
      const { oportunidadId } = exigirOportunidad(cx);
      const r = await enTransaccion(await oltp(), async (tx) => {
        await citaDeOportunidad(tx, oportunidadId, e.cita_id);
        const cita = await cambiarEstadoCita(tx, e.cita_id, 'CANCELADA', e.causa, 'AGENTE');
        return cita;
      });
      return { ok: true, citaId: e.cita_id, estado: r?.estado ?? 'CANCELADA' };
    },
  }),

  reprogramar_cita: h({
    def: { nombre: 'reprogramar_cita', descripcion: 'Reprograma una cita solicitada o confirmada de esta oportunidad. Rechaza horarios solapados y registra historial y evento.',
      esquema: objeto({ cita_id: { type: 'integer' }, inicio: { type: 'string', description: 'AAAA-MM-DDTHH:mm en hora de Perú.' }, duracion_min: { type: 'integer', minimum: 15, maximum: 180 } }, ['cita_id', 'inicio']) },
    entrada: z.object({ cita_id: z.number().int().positive(), inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/), duracion_min: z.number().int().min(15).max(180).default(45) }),
    async ejecutar(cx, e) {
      const { oportunidadId } = exigirOportunidad(cx);
      const inicio = new Date(e.inicio.slice(0, 16));
      const r = await enTransaccion(await oltp(), async (tx) => {
        await citaDeOportunidad(tx, oportunidadId, e.cita_id);
        return reprogramarCita(tx, e.cita_id, inicio, e.duracion_min, 'AGENTE');
      });
      return respuestaCita(r, 'El asesor enviará el enlace antes de la reunión.');
    },
  }),

  escalar_a_humano: h({
    def: { nombre: 'escalar_a_humano', descripcion: 'Deriva la conversación a una persona del equipo (especialista, coordinación o administración) con un resumen. Después de esto el agente deja de responder hasta que un asesor devuelva el control.',
      esquema: objeto({ motivo: { type: 'string', enum: [...MOTIVOS_ESCALAMIENTO] }, resumen: { type: 'string', description: 'Resumen breve para la persona que atenderá.' } }, ['motivo', 'resumen']) },
    entrada: z.object({ motivo: z.enum(MOTIVOS_ESCALAMIENTO), resumen: z.string().min(5).max(1000) }),
    async ejecutar(cx, e) {
      const r = await escalar(cx, e.motivo, e.resumen);
      return { ok: true, destino: r.destino, nota: 'Avisa al estudiante que una persona del equipo continuará la conversación.' };
    },
  }),
} as const;

export type NombreHerramienta = keyof typeof HERRAMIENTAS;
export const definiciones = (): HerramientaLLM[] => Object.values(HERRAMIENTAS).map((x) => x.def);

function fechaLocalIso(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Asesor comercial de la oportunidad, o el comercial activo con menos citas próximas. */
async function asesorComercial(cx: ContextoAgente): Promise<number> {
  const r = await (await oltp()).request().input('o', sql.Int, cx.oportunidadId).query(`
    SELECT TOP 1 a.asesor_id FROM dbo.ASESOR a
    LEFT JOIN dbo.OPORTUNIDAD_COMERCIAL o ON o.oportunidad_id = @o AND o.asesor_responsable_id = a.asesor_id
    WHERE a.rol = 'COMERCIAL' AND a.estado = 'ACTIVO'
    ORDER BY CASE WHEN o.oportunidad_id IS NULL THEN 1 ELSE 0 END,
             (SELECT COUNT(*) FROM dbo.CITA_VIRTUAL c WHERE c.asesor_id = a.asesor_id AND c.estado <> 'CANCELADA' AND c.inicio > SYSDATETIME()), a.asesor_id`);
  if (!r.recordset[0]) throw new ErrorNegocio('No hay asesores comerciales activos.');
  return r.recordset[0].asesor_id;
}

export interface LlamadaHerramienta { herramienta: string; entrada: unknown; ok: boolean; resultado: unknown; ms: number }

/**
 * Ejecuta una herramienta con todas las validaciones. Nunca lanza: devuelve el error como resultado
 * para que el modelo pueda explicarlo o escalar. Registra la llamada en `bitacora` (auditoría del turno).
 */
export async function ejecutarHerramienta(cx: ContextoAgente, nombre: string, entrada: unknown, bitacora: LlamadaHerramienta[]): Promise<string> {
  const t0 = Date.now();
  let ok = false, resultado: unknown;
  try {
    const herr = (HERRAMIENTAS as Record<string, Herramienta<z.ZodTypeAny>>)[nombre];
    if (!herr) throw new ErrorNegocio(`Herramienta desconocida: ${nombre}.`);
    if (!cx.consentimiento && !HERRAMIENTAS_SIN_CONSENTIMIENTO.has(nombre))
      throw new ErrorNegocio('Sin consentimiento de datos del estudiante: primero pídelo y regístralo con registrar_consentimiento.');
    resultado = await herr.ejecutar(cx, herr.entrada.parse(entrada ?? {}));
    ok = !(resultado && typeof resultado === 'object' && (resultado as any).ok === false);
    // Mantiene el contexto al día dentro del mismo turno (p. ej. tras otorgar consentimiento).
    if (ok && ['registrar_consentimiento', 'registrar_perfil_academico', 'solicitar_diagnostico', 'actualizar_diagnostico_pendiente',
      'entregar_diagnostico', 'calificar_aptitud',
      'presentar_propuesta', 'registrar_respuesta_propuesta', 'agendar_cita', 'cancelar_cita', 'reprogramar_cita'].includes(nombre)) {
      const { cargarContexto } = await import('./contexto.js');
      Object.assign(cx, await cargarContexto(cx.conversacionId));
    }
  } catch (e: any) {
    resultado = { ok: false, error: e instanceof z.ZodError ? 'Parámetros no válidos: ' + e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      : e instanceof ErrorNegocio ? e.message : 'Error interno al ejecutar la herramienta.' };
    if (!(e instanceof ErrorNegocio) && !(e instanceof z.ZodError)) console.error(`[agente] ${nombre}:`, e);
  }
  bitacora.push({ herramienta: nombre, entrada, ok, resultado, ms: Date.now() - t0 });
  return JSON.stringify(resultado);
}
