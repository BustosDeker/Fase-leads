// Agente en modo «mock»: reglas + máquina de estados, sin internet ni clave de API.
// Usa EXACTAMENTE las mismas herramientas (y por tanto las mismas validaciones y auditoría) que el modo con IA;
// solo cambia cómo se interpreta el mensaje: con patrones de texto en lugar de un modelo de lenguaje.
import { catalogos } from '../contexto.js';
import { buscarCarrera, buscarUniversidad, detectarEtapa, extraerAvance, extraerEstadoEmpresa, extraerFechaLimite,
  extraerLimitaciones, extraerSede, extraerTemaTesis, extraerTipoTesis, normalizar } from '../guardas.js';
import type { PeticionAgente, ProveedorLLM } from '../tipos.js';

const soles = (n: number) => `S/ ${Number(n).toFixed(2)}`;
const hay = (t: string, r: RegExp) => r.test(t);
const ultimoDato = <T>(textos: string[], extraer: (texto: string) => T | null): T | null => {
  for (const texto of [...textos].reverse()) {
    const dato = extraer(texto);
    if (dato !== null) return dato;
  }
  return null;
};

function respuestaTrasPregunta(historial: PeticionAgente['historial'], pregunta: RegExp): string | null {
  let ultimaPregunta: string | null = null;
  let respuesta: string | null = null;
  for (const mensaje of historial) {
    if (mensaje.rol === 'assistant') {
      ultimaPregunta = mensaje.texto;
    } else if (ultimaPregunta && pregunta.test(normalizar(ultimaPregunta))) {
      respuesta = mensaje.texto;
      ultimaPregunta = null;
    } else {
      ultimaPregunta = null;
    }
  }
  return respuesta;
}

function recogerSede(historial: PeticionAgente['historial'], textos: string[]): string | null {
  const sede = ultimoDato(textos, extraerSede);
  if (sede) return sede;
  const respuesta = respuestaTrasPregunta(historial, /\b(sede|campus)\b/);
  if (!respuesta) return null;
  if (/^(no se|no aplica|ninguna|sin sede)[.! ]*$/i.test(normalizar(respuesta.trim()))) return 'No especificada';
  return respuesta.trim().replace(/[.!?]+$/, '').slice(0, 100) || null;
}

function recogerTipoTesis(historial: PeticionAgente['historial'], textos: string[]) {
  const tipo = ultimoDato(textos, extraerTipoTesis);
  if (tipo) return tipo;
  const respuesta = respuestaTrasPregunta(historial, /\b(tipo|investigaci[oó]n)\b/);
  if (!respuesta) return null;
  const indicado = extraerTipoTesis(respuesta);
  if (indicado) return indicado;
  return /^(no se|no lo se|aun no|todavia no)[.! ]*$/i.test(normalizar(respuesta.trim())) ? 'NO_DEFINIDO' as const : null;
}

function recogerEmpresa(historial: PeticionAgente['historial'], textos: string[]): boolean | null {
  const empresa = ultimoDato(textos, extraerEstadoEmpresa);
  if (empresa !== null) return empresa;
  const respuesta = respuestaTrasPregunta(historial, /\b(empresa|instituci[oó]n)\b/);
  if (!respuesta) return null;
  if (/^(si|claro|asi es|correcto)[.! ]*$/i.test(normalizar(respuesta.trim()))) return true;
  if (/^(no|ninguna|no tengo|no cuento)[.! ]*$/i.test(normalizar(respuesta.trim()))) return false;
  return null;
}

function recogerLimitaciones(historial: PeticionAgente['historial'], textos: string[]): string | null {
  const limitaciones = ultimoDato(textos, extraerLimitaciones);
  if (limitaciones) return limitaciones;
  const respuesta = respuestaTrasPregunta(historial, /\b(limitaciones|dificultades|obst[aá]culos|problemas)\b/);
  if (!respuesta) return null;
  return extraerLimitaciones(respuesta) ?? (/^(ninguna|ninguno|no|no tengo|no aplica)[.! ]*$/i.test(normalizar(respuesta.trim()))
    ? 'Ninguna indicada' : respuesta.trim().slice(0, 300) || null);
}

function respuestaNegativaFecha(historial: PeticionAgente['historial']): boolean {
  const respuesta = respuestaTrasPregunta(historial, /\b(fecha|entrega|sustentaci[oó]n)\b/);
  return !!respuesta && /^(no|no se|aun no|todavia no|no la tengo|no esta definida)[.! ]*$/i.test(normalizar(respuesta.trim()));
}

const tipoEtiqueta = (tipo: string) => tipo === 'NO_DEFINIDO' ? 'aún no definido' : tipo.toLowerCase();

export function proveedorMock(): ProveedorLLM {
  return { nombre: 'mock', modelo: 'reglas-v1', responder };
}

async function responder(p: PeticionAgente): Promise<string> {
  const cx = p.datos;
  const usuario = p.historial.filter((m) => m.rol === 'user');
  const ultimo = usuario[usuario.length - 1]?.texto ?? '';
  const t = normalizar(ultimo);
  const llamar = async (n: string, e: unknown = {}) => JSON.parse(await p.ejecutar(n, e)) as any;

  if (p.sospechaInyeccion) {
    if (cx.mensajesSospechosos >= 1) {
      await llamar('escalar_a_humano', { motivo: 'POSIBLE_INYECCION', resumen: `Mensajes que intentan cambiar las reglas del agente. Último: ${ultimo.slice(0, 300)}` });
      return 'Solo puedo ayudarte con tu asesoría de tesis en las condiciones vigentes. Una persona del equipo continuará esta conversación.';
    }
    return 'Solo puedo ayudarte con información y propuestas de tu asesoría de tesis, con las condiciones vigentes. ¿Seguimos con tu caso?';
  }
  if (hay(t, /no (me|nos) (escriban|escribas|contacten|contactes)|dar(me)? de baja|\brevoco\b|retiro mi consentimiento|elimin\w+ mis datos|ya no quiero (recibir|que me)/)) {
    await llamar('registrar_consentimiento', { acepta: false, frase_del_estudiante: ultimo });
    return 'Entendido. Registré tu decisión y no volveremos a escribirte. Si en el futuro deseas retomar tu asesoría, puedes escribirnos. ¡Éxitos con tu tesis!';
  }
  if (hay(t, /\bespecialista\b|asesor (humano|real)|una persona|hablar con alguien|\bhumano\b/)) {
    await llamar('escalar_a_humano', { motivo: 'CLIENTE_PIDE_ESPECIALISTA', resumen: `El estudiante pidió hablar con una persona. Estado: ${cx.estado}. Mensaje: ${ultimo.slice(0, 300)}` });
    return 'Claro. Ya derivé tu caso a un especialista del equipo; te escribirá por este mismo chat en breve.';
  }

  // 1. Consentimiento (Ley 29733)
  if (!cx.consentimiento) {
    const acepta = hay(t, /\b(si|acepto|aceptar|de acuerdo|autorizo|ok|okey|claro|dale|esta bien|conforme)\b/) && !hay(t, /\bno\b/);
    if (acepta && usuario.length > 1) {
      await llamar('registrar_consentimiento', { acepta: true, frase_del_estudiante: ultimo });
      return `¡Gracias, ${cx.nombres}! Para orientarte, cuéntame: ¿en qué universidad y carrera estudias, y en qué etapa estás (IX ciclo, X ciclo, egresado o bachiller)?`;
    }
    if (hay(t, /^\s*no\b|no acepto|no autorizo/) && usuario.length > 1)
      return 'Respeto tu decisión. Sin tu autorización no puedo registrar tus datos ni prepararte una propuesta. Si cambias de opinión, escríbeme «Sí, acepto».';
    return `¡Hola, ${cx.nombres}! Soy el asistente virtual de INBESTIGA y te ayudo con tu asesoría de tesis. ` +
      'Para orientarte necesito tratar tus datos (nombre, universidad, carrera y datos de tu tesis) solo para atender tu asesoría, conforme a la Ley 29733. ' +
      '¿Aceptas? Responde «Sí, acepto» para continuar.';
  }

  // 2. Perfil académico (se juntan los últimos mensajes: el estudiante puede darlo por partes)
  if (!cx.perfil) {
    const cat = await catalogos();
    const textos = usuario.map((m) => m.texto);
    const junto = textos.join(' ');
    const u = buscarUniversidad(junto, cat), c = buscarCarrera(junto, cat), e = detectarEtapa(junto);
    if (u && c && e) {
      const sede = recogerSede(p.historial, textos);
      if (!sede) return 'Gracias. ¿En qué sede o campus estudias? Si no aplica o no lo sabes, dime eso.';
      const r = await llamar('registrar_perfil_academico', { universidad: u.nombre, carrera: c.nombre, etapa: e, sede });
      if (r.fuera_de_cobertura) {
        await llamar('escalar_a_humano', { motivo: 'FUERA_COBERTURA', resumen: `${c.nombre} · ${u.nombre}: fuera de la cobertura actual.` });
        return 'Por ahora esa universidad o carrera está fuera de nuestra cobertura habitual. Derivé tu caso a una persona del equipo para revisar si podemos ayudarte.';
      }
      if (r.ok) return `Perfecto: ${r.carrera} en la ${r.universidad}, sede ${sede}${e === 'CICLO_IX' ? ', IX ciclo' : e === 'CICLO_X' ? ', X ciclo' : ''}. Para empezar con tu diagnóstico, ¿cuál es el tema o problema concreto que quieres investigar? Si aún no lo tienes definido, dímelo.`;
    }
    if (!u && !c && !e && usuario.length <= 1)   // primer mensaje (p. ej. respuesta al saludo del agente)
      return `¡Hola, ${cx.nombres}! Para orientarte, cuéntame: ¿en qué universidad y carrera estudias, y en qué etapa estás (IX ciclo, X ciclo, egresado o bachiller)?`;
    const falta = [!u && 'tu universidad', !c && 'tu carrera', !e && 'tu etapa (IX ciclo, X ciclo, egresado o bachiller)'].filter(Boolean);
    return `Gracias. Me falta saber ${falta.join(', ').replace(/, ([^,]*)$/, ' y $1')}.`;
  }

  switch (cx.estado) {
    case 'ABIERTA': {
      const textos = usuario.map((m) => m.texto);
      const tema = ultimoDato(textos, extraerTemaTesis);
      if (!tema) return 'Para evitar registrar un dato incorrecto, todavía me falta el tema concreto de tu tesis. ¿Qué problema o relación quieres investigar? Si aún no lo definiste, dímelo y vemos cómo continuar.';
      const tipo = recogerTipoTesis(p.historial, textos);
      const avance = ultimoDato(textos, extraerAvance);
      const empresa = recogerEmpresa(p.historial, textos);
      const fechaDetectada = ultimoDato(textos, extraerFechaLimite);
      const fechaLimite = typeof fechaDetectada === 'string' && fechaDetectada !== 'NO_DEFINIDA'
        ? fechaDetectada : cx.preferencias?.fechaLimite ?? null;
      const fechaRespondida = fechaDetectada !== null || !!cx.preferencias?.fechaLimite || respuestaNegativaFecha(p.historial);
      const limitaciones = recogerLimitaciones(p.historial, textos);
      if (!tipo) return '¿Qué tipo de investigación es: descriptiva, correlacional, experimental o aplicada? Si aún no lo sabes, dime “no lo sé”.';
      if (avance === null) return '¿Qué porcentaje de avance aproximado tienes? Puedes responder, por ejemplo, 10%.';
      if (empresa === null) return '¿Cuentas con una empresa o institución donde aplicar la tesis? Puedes responder sí o no.';
      if (!fechaRespondida) return '¿Para qué fecha tienes prevista la entrega o sustentación? Indícame día, mes y año; si aún no la tienes, dime que no está definida.';
      if (!limitaciones) return '¿Qué limitaciones o dificultades tienes para realizar la investigación? Si no tienes ninguna, dime “ninguna”.';
      const r = await llamar('solicitar_diagnostico', { tema_tesis: tema, tipo_tesis: tipo, avance_declarado: avance,
        tiene_empresa_aplicacion: empresa, fecha_limite: fechaLimite, limitaciones });
      if (!r.ok) return `No pude registrar la solicitud porque falta validar un dato: ${r.error ?? 'revisa la información'}.`;
      return 'Listo, registré tu solicitud de diagnóstico. Un especialista revisará tu caso y te lo entregará en un máximo de 48 horas; con eso te comparto una propuesta a tu medida.';
    }
    case 'EN_DIAGNOSTICO': {
      if (cx.diagnostico?.estado !== 'ENTREGADO') {
        const textos = usuario.map((m) => m.texto);
        const tema = ultimoDato(textos, extraerTemaTesis) ?? extraerTemaTesis(cx.diagnostico?.tema ?? '');
        if (!tema) return 'Tu solicitud sigue pendiente y detecté que todavía falta un tema concreto de tesis. ¿Qué problema o relación quieres investigar? No quiero registrar como tema tus datos de universidad o ciclo.';
        const tipo = recogerTipoTesis(p.historial, textos) ?? (cx.diagnostico?.tipoTesis as ReturnType<typeof extraerTipoTesis>) ?? null;
        const avance = ultimoDato(textos, extraerAvance) ?? cx.diagnostico?.avance ?? null;
        const empresa = recogerEmpresa(p.historial, textos) ?? cx.diagnostico?.tieneEmpresa ?? null;
        const fechaDetectada = ultimoDato(textos, extraerFechaLimite);
        const fechaLimite = typeof fechaDetectada === 'string' && fechaDetectada !== 'NO_DEFINIDA'
          ? fechaDetectada : cx.preferencias?.fechaLimite ?? null;
        const fechaRespondida = fechaDetectada !== null || !!cx.preferencias?.fechaLimite || respuestaNegativaFecha(p.historial);
        const limitaciones = recogerLimitaciones(p.historial, textos) ?? cx.diagnostico?.limitaciones ?? null;
        if (!tipo) return 'Para completar la ficha del especialista, ¿qué tipo de investigación es: descriptiva, correlacional, experimental o aplicada? Si no lo sabes, dime “no lo sé”.';
        if (avance === null) return 'Para completar la ficha del especialista, ¿qué porcentaje de avance aproximado tienes?';
        if (empresa === null) return '¿Cuentas con una empresa o institución donde aplicar tu investigación? Puedes responder sí o no.';
        if (!fechaRespondida) return '¿Para qué fecha tienes prevista la entrega o sustentación? Indícame día, mes y año; si no está definida, dime eso.';
        if (!limitaciones) return '¿Qué limitaciones o dificultades tienes? Si no tienes ninguna, dime “ninguna”.';
        const r = await llamar('actualizar_diagnostico_pendiente', { tema_tesis: tema, tipo_tesis: tipo,
          avance_declarado: avance, tiene_empresa_aplicacion: empresa, fecha_limite: fechaLimite, limitaciones });
        if (!r.ok) return `No pude completar la información del diagnóstico: ${r.error ?? 'revisa los datos'}.`;
        return 'Gracias, completé la información que me diste para el especialista. Tu diagnóstico sigue pendiente de revisión y te lo compartiré en un máximo de 48 horas.';
      }
      return cx.diagnostico?.estado === 'ENTREGADO'
        ? 'Tu diagnóstico ya está listo y estamos verificando los requisitos para preparar tu propuesta. Te escribo apenas esté.'
        : 'Tu diagnóstico está en revisión por un especialista (plazo máximo de 48 horas desde tu solicitud). Te aviso apenas esté listo.';
    }
    case 'APTA_PARA_COTIZAR':
      return presentar(cx, t, llamar, 0);
    case 'EN_NEGOCIACION': {
      if (hay(t, /\b(acepto|aceptamos|contrato|contratar|lo tomo|me quedo con|cerramos|vamos con)\b/) && !hay(t, /\bno\b/)) {
        const r = await llamar('registrar_respuesta_propuesta', { respuesta: 'ACEPTA', observacion: ultimo.slice(0, 300) });
        if (r.ok) return '¡Excelente decisión! Registré tu aceptación. El área de pagos te enviará el contrato y el enlace de pago por este medio. Cualquier duda, aquí estoy.';
      }
      const pct = /(\d{1,2}(?:[.,]\d)?)\s*%/.exec(ultimo);
      if (pct && hay(t, /descuento|rebaja|menos|baj/)) {
        const n = Number(pct[1].replace(',', '.'));
        const sim = await llamar('simular_cotizacion', { servicio_id: cx.propuesta?.servicioId, forma_pago: hay(t, /contado/) ? 'CONTADO' : 'CUOTAS', descuento_negociado_pct: n });
        if (sim.bloqueada) {
          await llamar('escalar_a_humano', { motivo: 'DESCUENTO_EXCEDE_TOPE', resumen: `Pide ${n}% de descuento sobre ${cx.propuesta?.servicio}; excede el tope o el precio mínimo.` });
          return `Un descuento del ${n}% supera lo que puedo ofrecerte. Derivé tu pedido a coordinación para que lo revisen; te escribirán por aquí.`;
        }
        return presentar(cx, t, llamar, n);
      }
      if (hay(t, /\b(cita|reunion|llamada|videollamada|zoom|meet)\b/)) {
        const hs = await llamar('consultar_horarios');
        if (!hs.horarios?.length) return 'Por ahora no hay horarios libres esta semana; te escribirá un asesor para coordinar.';
        const medio = hay(t, /zoom/) ? 'Zoom' : hay(t, /llamada/) ? 'Llamada de WhatsApp' : 'Google Meet';
        const r = await llamar('agendar_cita', { inicio: hs.horarios[0], medio });
        if (r.ok) return `Te agendé una cita virtual de 45 minutos con un asesor el ${new Date(r.inicio).toLocaleString('es-PE', { dateStyle: 'full', timeStyle: 'short' })} por ${medio}. Si prefieres otro horario, dime cuál.`;
        return 'No pude agendar ese horario. ¿Te parece si un asesor te escribe para coordinar?';
      }
      if (hay(t, /\bcontado\b|\bcuotas\b/)) return presentar(cx, t, llamar, 0);
      const cat = await catalogos();
      const obj = cat.objeciones.find((o) => o.claves.some((k) => t.includes(normalizar(k))));
      if (obj) {
        const r = await llamar('registrar_objecion', { grupo: obj.grupo, tipo: obj.tipo, descripcion: ultimo.slice(0, 500), respuesta_dada: obj.respuesta });
        if (r.escalada) return 'Entiendo tu preocupación. Para darte una respuesta a tu medida, derivé tu caso a una persona del equipo; te escribirá por este chat.';
        return obj.respuesta;
      }
      const pr = cx.propuesta;
      return pr ? `Tu propuesta vigente es ${pr.servicio} por ${soles(pr.precioFinal)}${pr.vigenciaHasta ? `, válida hasta el ${new Date(pr.vigenciaHasta).toLocaleDateString('es-PE')}` : ''}. ¿Tienes alguna duda o deseas aceptarla? También puedo agendarte una cita virtual opcional con un asesor.`
        : '¿En qué más te puedo ayudar con tu propuesta?';
    }
    case 'ACEPTADA': case 'TRANSFERIDA': case 'PAYER_CONFIRMADO':
      return 'Tu propuesta ya fue aceptada. El área de pagos te enviará (o ya te envió) el contrato y el enlace de pago por este medio. ¿Te ayudo con algo más?';
    case 'DESCARTADA':
      return 'Tu solicitud anterior quedó cerrada. Si deseas retomarla, cuéntame y un asesor te ayudará.';
    default:
      return 'Gracias por escribirnos. ¿En qué te puedo ayudar con tu tesis?';
  }
}

/** Presenta (o re-presenta) la propuesta con la forma de pago y el descuento indicados, y la explica. */
async function presentar(cx: PeticionAgente['datos'], t: string, llamar: (n: string, e?: unknown) => Promise<any>, descuento: number) {
  if (!cx.servicios.length) {
    await llamar('escalar_a_humano', { motivo: 'PRECIO_NO_CONFIGURADO', resumen: `No hay tarifa vigente para ${cx.perfil?.carrera}.` });
    return 'Para tu carrera necesito que un especialista prepare la propuesta. Ya derivé tu caso; te escribirá por aquí.';
  }
  const elegido = cx.servicios.find((s) => normalizar(s.nombre).split(/\s+/).some((w) => w.length > 5 && t.includes(w)))
    ?? cx.servicios.find((s) => s.servicioId === cx.propuesta?.servicioId) ?? cx.servicios[0];
  const forma = hay(t, /\bcontado\b/) ? 'CONTADO' : 'CUOTAS';
  const r = await llamar('presentar_propuesta', { servicio_id: elegido.servicioId, forma_pago: forma, descuento_negociado_pct: descuento });
  if (!r.ok) {
    await llamar('escalar_a_humano', { motivo: 'INCERTIDUMBRE_AGENTE', resumen: `No se pudo presentar la propuesta: ${r.error}` });
    return 'No pude generar tu propuesta automáticamente. Derivé tu caso a un asesor para que te la envíe en breve.';
  }
  const lineas = [`Esta es tu propuesta (versión ${r.version}) para ${elegido.nombre}, pago ${forma === 'CONTADO' ? 'al contado' : 'en cuotas'}:`,
    `• Precio base: ${soles(r.precio_base)}`];
  if (r.extras) lineas.push(`• Extras: ${soles(r.extras)}`);
  if (r.recargos) lineas.push(`• Recargos: ${soles(r.recargos)}`);
  if (r.descuentos) lineas.push(`• Descuentos: −${soles(r.descuentos)}`);
  lineas.push(`• Precio final: ${soles(r.precio_final)} (válida por 7 días)`, '¿Deseas aceptarla o tienes alguna duda?');
  return lineas.join('\n');
}
