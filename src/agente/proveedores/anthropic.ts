// Proveedor Claude (Anthropic) con el SDK oficial y bucle manual de herramientas
// (control fino: auditoría de cada llamada y tope de rondas por turno).
import Anthropic from '@anthropic-ai/sdk';
import { MAX_RONDAS_HERRAMIENTAS, type PeticionAgente, type ProveedorLLM, type UsoTokens } from '../tipos.js';
import { ErrorProveedorIA, sumarUso } from './comun.js';

const MODELOS_CON_EFFORT = new Set([
  'claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2',
  'claude-fable-5-1', 'claude-fable-5', 'claude-mythos-5-2', 'claude-mythos-5-1', 'claude-mythos-5',
]);

export function proveedorAnthropic(apiKey: string, modelo = 'claude-haiku-5-5', esfuerzo: 'low' | 'medium' | 'high' = 'medium', fallback = false): ProveedorLLM {
  const cliente = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 2 });
  let uso: UsoTokens | undefined;
  return {
    nombre: 'anthropic',
    modelo,
    get uso() { return uso; },
    async responder(p: PeticionAgente) {
      uso = { entrada: 0, salida: 0, total: 0 };
      const tools: Anthropic.Beta.BetaTool[] = p.herramientas.map((h) => ({
        name: h.nombre, description: h.descripcion, input_schema: h.esquema as Anthropic.Beta.BetaTool.InputSchema,
      }));
      const mensajes: Anthropic.Beta.BetaMessageParam[] = p.historial.map((m) => ({ role: m.rol, content: m.texto }));
      for (let ronda = 0; ronda <= MAX_RONDAS_HERRAMIENTAS; ronda++) {
        const solicitud: Record<string, unknown> = {
          model: modelo,
          max_tokens: 8000,
          system: [
            { type: 'text', text: p.sistema, cache_control: { type: 'ephemeral' } },   // reglas fijas: cacheables
            { type: 'text', text: p.contexto },                                        // situación del turno
          ],
          ...(tools.length ? { tools,
            // Última ronda: se obliga a responder con texto (sin más herramientas).
            tool_choice: ronda < MAX_RONDAS_HERRAMIENTAS ? { type: 'auto' } : { type: 'none' } } : {}),
          messages: mensajes,
        };
        if (MODELOS_CON_EFFORT.has(modelo)) solicitud.output_config = { effort: esfuerzo };
        if (fallback) {
          solicitud.betas = ['server-side-fallback-2026-07-01'];
          solicitud.fallbacks = 'default';
        }
        let r: any;
        try {
          r = fallback
            ? await (cliente.beta.messages.create as any)(solicitud)
            : await (cliente.messages.create as any)(solicitud);
        } catch (e: any) {
          const status = Number.isInteger(e?.status) ? e.status : null;
          throw new ErrorProveedorIA('Anthropic', status, status ? `Anthropic respondió HTTP ${status}.` : 'Anthropic no pudo completar la solicitud.');
        }
        uso = sumarUso(uso, r.usage?.input_tokens, r.usage?.output_tokens);
        if (r.stop_reason === 'refusal') throw new Error('El modelo declinó responder (refusal).');
        const llamadas = (r.content as any[]).filter((b: any): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
        if (r.stop_reason !== 'tool_use' || !llamadas.length) {
          return (r.content as any[]).filter((b: any): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b: any) => b.text).join('\n').trim();
        }
        mensajes.push({ role: 'assistant', content: r.content });
        const resultados: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const t of llamadas) {
          const res = await p.ejecutar(t.name, t.input);
          resultados.push({ type: 'tool_result', tool_use_id: t.id, content: res, is_error: res.includes('"ok":false') });
        }
        mensajes.push({ role: 'user', content: resultados });   // todos los resultados en un solo mensaje
      }
      throw new Error('Se alcanzó el máximo de rondas de herramientas.');
    },
  };
}
