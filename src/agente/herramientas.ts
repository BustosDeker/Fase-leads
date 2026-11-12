// Herramientas del Agente Negociador. Cada una valida su entrada (zod), opera SOLO sobre la oportunidad
// de la conversación en curso (el modelo nunca elige ids de otras personas) y reutiliza las reglas de
// src/negocio (máquina de estados, motor de precios, agenda). Las escrituras van en transacción.
import { z } from 'zod';
import { oltp, sql } from '../db.js';
import { agendarCita } from '../negocio/agenda.js';
import { solicitarDiagnostico } from '../negocio/diagnostico.js';
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

const parametrosCotizacion = {
  servicio_id: { type: 'integer', description: 'Id del servicio (de la lista de servicios cotizables).' },
  forma_pago: { type: 'string', enum: ['CONTADO', 'CUOTAS'], description: 'Forma de pago que prefiere el estudiante.' },
  aplicar_promocion: { type: 'boolean', description: 'true solo si el estudiante califica a una promoción vigente que el sistema reconoce.' },
  descuento_negociado_pct: { type: 'number', description: 'Descuento adicional negociado (%). 0 si no lo pidió. El sistema verifica tope y precio mínimo.' },
};
const entradaCotizacion = z.object({
  servicio_id: z.number().int().positive(),
  forma_pago: z.enum(['CONTADO', 'CUOTAS']).default('CUOTAS'),
  aplicar_promocion: z.boolean().default(false),
  descuento_negociado_pct: z.number().min(0).max(100).default(0),
});
const solicitud = (cx: ContextoAgente, e: z.infer<typeof entradaCotizacion>) => ({
  oportunidadId: exigirOportunidad(cx).oportunidadId, servicioId: e.servicio_id, formaPago: e.forma_pago,
  aplicarPromocion: e.aplicar_promocion, descuentoNegociadoPct: e.descuento_negociado_pct, extras: [],
});

/** Registra un escalamiento y pasa la conversación a control humano (el agente deja de responder). */
export async function escalar(cx: ContextoAgente, motivo: (typeof MOTIVOS_ESCALAMIENTO)[number] | 'BOT_NO_RESPONDE', resumen: string) {
  const destino = ['DESCUENTO_EXCEDE_TOPE', 'OBJECION_REPETIDA', 'EXCEPCION_CONTRACTUAL'].includes(motivo) ? 'COORDINACION'
    : motivo === 'RECLAMO_PAGO' ? 'ADMIN' : 'ESPECIALISTA';
  return enTransaccion(await oltp(), async (tx) => {
    const r = await new sql.Request(tx).input('c', sql.Int, cx.conversacionId).input('l', sql.Int, cx.leadId).input('o', sql.Int, cx.oportunidadId)
      .input('m', sql.VarChar, motivo).input('d', sql.VarChar, destino).input('r', sql.NVarChar, resumen.slice(0, 1000))
      .query(`INSERT dbo.ESCALAMIENTO (conversacion_id, lead_id, oportunidad_id, motivo, destino_rol, resumen_entregado, estado, resumen)
              OUTPUT INSERTED.escalamiento_id VALUES (@c, @l, @o, @m, @d, 1, 'PENDIENTE', @r);
              UPDATE dbo.CONVERSACION SET estado = 'DERIVADA', control_humano = 1, resuelta_sin_humano = 0 WHERE conversacion_id = @c;`);
    if (cx.oportunidadId) await registrarEvento(tx, cx.oportunidadId, 'ESCALAMIENTO', 'AGENTE', `${motivo}: ${resumen.slice(0, 300)}`);
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
        propuesta: n.propuesta, servicios: n.servicios, citaProxima: n.citaProxima, objecionesPendientes: n.objecionesPendientes };
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
          : `UPDATE dbo.CONTACTO SET consentimiento_contacto = 0, no_contactar = 1, fecha_revocacion = SYSDATETIME() WHERE contacto_id = @c`);
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
      esquema: objeto({ universidad: { type: 'string' }, carrera: { type: 'string' }, etapa: { type: 'string', enum: ['CICLO_IX', 'CICLO_X', 'EGRESADO', 'BACHILLER'] } }, ['universidad', 'carrera', 'etapa']) },
    entrada: z.object({ universidad: z.string().min(2).max(150), carrera: z.string().min(2).max(120), etapa: z.enum(['CICLO_IX', 'CICLO_X', 'EGRESADO', 'BACHILLER']) }),
    async ejecutar(cx, e) {
      const cat = await catalogos();
      const u = buscarUniversidad(e.universidad, cat), c = buscarCarrera(e.carrera, cat);
      if (!u || !c) return { ok: false, error: `No reconozco ${!u ? 'la universidad' : 'la carrera'}.`,
        universidades_atendidas: cat.universidades.filter((x) => x.atendida).map((x) => x.nombre), carreras_atendidas: cat.carreras.filter((x) => x.atendida).map((x) => x.nombre) };
      if (!u.atendida || !c.atendida) return { ok: false, fuera_de_cobertura: true, error: `${!u.atendida ? u.nombre : c.nombre} está fuera de la cobertura actual: corresponde escalar con motivo FUERA_COBERTURA.` };
      await enTransaccion(await oltp(), async (tx) => {
        await new sql.Request(tx).input('c', sql.Int, cx.contactoId).input('u', sql.Int, u.id).input('ca', sql.Int, c.id).input('e', sql.VarChar, e.etapa).query(`
          MERGE dbo.PERFIL_ACADEMICO AS d USING (SELECT @c AS contacto_id) s ON d.contacto_id = s.contacto_id
          WHEN MATCHED THEN UPDATE SET universidad_id = @u, carrera_id = @ca, etapa_academica = @e
          WHEN NOT MATCHED THEN INSERT (contacto_id, universidad_id, carrera_id, etapa_academica) VALUES (@c, @u, @ca, @e);`);
        if (cx.oportunidadId) await registrarEvento(tx, cx.oportunidadId, 'PERFIL_ACADEMICO_REGISTRADO', 'AGENTE', `${c.nombre} · ${u.nombre} · ${e.etapa}`);
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
    def: { nombre: 'solicitar_diagnostico', descripcion: 'Registra la solicitud de diagnóstico solo cuando el estudiante haya indicado un tema concreto de tesis. No uses frases de avance, empresa o respuestas genéricas como tema. Si falta el tema, pregúntalo y espera. Un especialista entrega el diagnóstico en un máximo de 48 horas; recién después se puede cotizar. Requiere perfil académico registrado.',
      esquema: objeto({ tema_tesis: { type: 'string' }, tipo_tesis: { type: 'string', enum: ['DESCRIPTIVA', 'CORRELACIONAL', 'EXPERIMENTAL', 'APLICADA'] },
        avance_declarado: { type: 'number', description: 'Porcentaje 0–100.' }, tiene_empresa_aplicacion: { type: 'boolean' }, limitaciones: { type: 'string' } }, ['tema_tesis']) },
    entrada: z.object({ tema_tesis: z.string().min(3).max(250), tipo_tesis: z.enum(['DESCRIPTIVA', 'CORRELACIONAL', 'EXPERIMENTAL', 'APLICADA']).optional(),
      avance_declarado: z.number().min(0).max(100).optional(), tiene_empresa_aplicacion: z.boolean().optional(), limitaciones: z.string().max(300).optional() }),
    async ejecutar(cx, e) {
      const { oportunidadId } = exigirOportunidad(cx);
      if (!cx.perfil) return { ok: false, error: 'Primero registra universidad, carrera y etapa.' };
      if (!extraerTemaTesis(e.tema_tesis)) return { ok: false, error: 'Falta un tema concreto de tesis. Pregúntaselo al estudiante antes de registrar el diagnóstico.' };
      if (cx.diagnostico && cx.diagnostico.estado !== 'ENTREGADO') return { ok: false, error: 'Ya hay un diagnóstico en curso.', diagnostico: cx.diagnostico };
      const r = await enTransaccion(await oltp(), (tx) => solicitarDiagnostico(tx, { oportunidadId, temaTesis: e.tema_tesis, tipoTesis: e.tipo_tesis,
        avanceDeclarado: e.avance_declarado, tieneEmpresaAplicacion: e.tiene_empresa_aplicacion, limitaciones: e.limitaciones }, null, 'AGENTE'));
      return { ok: true, diagnosticoId: r.diagnostico_id, plazo: 'máximo 48 horas', siguiente: 'Un especialista revisa y entrega el diagnóstico; luego se cotiza.' };
    },
  }),
  actualizar_diagnostico_pendiente: h({
    def: { nombre: 'actualizar_diagnostico_pendiente', descripcion: 'Completa con información nueva del estudiante un diagnóstico que ya está pendiente. Úsala cuando se registró sin tema concreto o el estudiante aporte ahora el tema. No inventes información; si aún falta el tema, pregúntalo primero.',
      esquema: objeto({ tema_tesis: { type: 'string' }, tipo_tesis: { type: 'string', enum: ['DESCRIPTIVA', 'CORRELACIONAL', 'EXPERIMENTAL', 'APLICADA'] },
        avance_declarado: { type: 'number', description: 'Porcentaje 0–100.' }, tiene_empresa_aplicacion: { type: 'boolean' }, limitaciones: { type: 'string' } }, ['tema_tesis']) },
    entrada: z.object({ tema_tesis: z.string().min(3).max(250), tipo_tesis: z.enum(['DESCRIPTIVA', 'CORRELACIONAL', 'EXPERIMENTAL', 'APLICADA']).optional(),
      avance_declarado: z.number().min(0).max(100).optional(), tiene_empresa_aplicacion: z.boolean().optional(), limitaciones: z.string().max(300).optional() }),
    async ejecutar(cx, e) {
      const { oportunidadId } = exigirOportunidad(cx);
      if (!cx.diagnostico || cx.diagnostico.estado === 'ENTREGADO') return { ok: false, error: 'No hay un diagnóstico pendiente que se pueda completar.' };
      const tema = extraerTemaTesis(e.tema_tesis);
      if (!tema) return { ok: false, error: 'Falta un tema concreto de tesis. Pregúntaselo al estudiante antes de actualizar.' };
      await enTransaccion(await oltp(), async (tx) => {
        const r = await new sql.Request(tx).input('d', sql.Int, cx.diagnostico!.id).input('o', sql.Int, oportunidadId)
          .input('t', sql.NVarChar(250), tema).input('tt', sql.VarChar, e.tipo_tesis ?? null)
          .input('av', sql.Decimal(5, 2), e.avance_declarado ?? null).input('em', sql.Bit, e.tiene_empresa_aplicacion ?? null)
          .input('li', sql.NVarChar(300), e.limitaciones ?? null).query(`
            UPDATE dbo.DIAGNOSTICO
            SET tema_tesis = @t, tipo_tesis = COALESCE(@tt, tipo_tesis), avance_declarado = COALESCE(@av, avance_declarado),
                tiene_empresa_aplicacion = COALESCE(@em, tiene_empresa_aplicacion), limitaciones = COALESCE(@li, limitaciones)
            OUTPUT INSERTED.diagnostico_id
            WHERE diagnostico_id = @d AND oportunidad_id = @o AND estado <> 'ENTREGADO'`);
        if (!r.recordset[0]) throw new ErrorNegocio('El diagnóstico ya no está pendiente o no pertenece a esta oportunidad.');
        await registrarEvento(tx, oportunidadId, 'DIAGNOSTICO_ACTUALIZADO', 'AGENTE', `Se completó la información del tema: ${tema.slice(0, 250)}`);
      });
      return { ok: true, diagnosticoId: cx.diagnostico.id, siguiente: 'La solicitud sigue pendiente de revisión por el especialista.' };
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
      return { ok: true, citaId: r.citaId, inicio: fechaLocalIso(inicio), medio: e.medio, duracion: '45 minutos' };
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
      'presentar_propuesta', 'registrar_respuesta_propuesta'].includes(nombre)) {
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
