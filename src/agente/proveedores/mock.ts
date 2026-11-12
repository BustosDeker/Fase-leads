// Agente en modo «mock»: reglas + máquina de estados, sin internet ni clave de API.
// Usa EXACTAMENTE las mismas herramientas (y por tanto las mismas validaciones y auditoría) que el modo con IA;
// solo cambia cómo se interpreta el mensaje: con patrones de texto en lugar de un modelo de lenguaje.
import { catalogos } from '../contexto.js';
import { buscarCarrera, buscarUniversidad, detectarEtapa, normalizar } from '../guardas.js';
import type { PeticionAgente, ProveedorLLM } from '../tipos.js';

const soles = (n: number) => `S/ ${Number(n).toFixed(2)}`;
const hay = (t: string, r: RegExp) => r.test(t);

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
    const junto = usuario.slice(-3).map((m) => m.texto).join(' ');
    const u = buscarUniversidad(junto, cat), c = buscarCarrera(junto, cat), e = detectarEtapa(junto);
    if (u && c && e) {
      const r = await llamar('registrar_perfil_academico', { universidad: u.nombre, carrera: c.nombre, etapa: e });
      if (r.fuera_de_cobertura) {
        await llamar('escalar_a_humano', { motivo: 'FUERA_COBERTURA', resumen: `${c.nombre} · ${u.nombre}: fuera de la cobertura actual.` });
        return 'Por ahora esa universidad o carrera está fuera de nuestra cobertura habitual. Derivé tu caso a una persona del equipo para revisar si podemos ayudarte.';
      }
      if (r.ok) return `Perfecto: ${r.carrera} en la ${r.universidad}. Ahora cuéntame de tu tesis: ¿cuál es el tema, cuánto avance tienes (en %) y si cuentas con una empresa o institución donde aplicarla?`;
    }
    const falta = [!u && 'tu universidad', !c && 'tu carrera', !e && 'tu etapa (IX ciclo, X ciclo, egresado o bachiller)'].filter(Boolean);
    return `Gracias. Me falta saber ${falta.join(', ').replace(/, ([^,]*)$/, ' y $1')}.`;
  }

  switch (cx.estado) {
    case 'ABIERTA': {
      if (ultimo.trim().length < 12) return 'Cuéntame de tu tesis: ¿cuál es el tema, cuánto avance tienes (en %) y si cuentas con una empresa o institución donde aplicarla?';
      const avance = /(\d{1,3})\s*%/.exec(ultimo);
      const empresa = hay(t, /sin empresa|no tengo (empresa|institucion)|aun no tengo/) ? false : hay(t, /empresa|institucion|colegio|hospital|municipalidad|clinica/) ? true : undefined;
      const fecha = /(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(ultimo);
      if (fecha) await llamar('registrar_preferencias', { fecha_limite: `${fecha[3]}-${fecha[2].padStart(2, '0')}-${fecha[1].padStart(2, '0')}` });
      const tema = ultimo.replace(/^.*?(mi tema es|el tema es|tema:)\s*/i, '').split(/[.\n]/)[0].slice(0, 250);
      const r = await llamar('solicitar_diagnostico', { tema_tesis: tema.length >= 3 ? tema : ultimo.slice(0, 250),
        ...(avance ? { avance_declarado: Math.min(100, Number(avance[1])) } : {}), ...(empresa !== undefined ? { tiene_empresa_aplicacion: empresa } : {}) });
      if (!r.ok) return 'Tuve un inconveniente al registrar tu solicitud. ¿Me repites el tema de tu tesis, por favor?';
      return 'Listo, registré tu solicitud de diagnóstico. Un especialista revisará tu caso y te lo entregará en un máximo de 48 horas; con eso te comparto una propuesta a tu medida.';
    }
    case 'EN_DIAGNOSTICO':
      return cx.diagnostico?.estado === 'ENTREGADO'
        ? 'Tu diagnóstico ya está listo y estamos verificando los requisitos para preparar tu propuesta. Te escribo apenas esté.'
        : 'Tu diagnóstico está en revisión por un especialista (plazo máximo de 48 horas desde tu solicitud). Te aviso apenas esté listo.';
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
