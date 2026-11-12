// Proveedor Claude (Anthropic) con el SDK oficial y bucle manual de herramientas
// (control fino: auditoría de cada llamada y tope de rondas por turno).
import Anthropic from '@anthropic-ai/sdk';
import { MAX_RONDAS_HERRAMIENTAS, type PeticionAgente, type ProveedorLLM } from '../tipos.js';

export function proveedorAnthropic(apiKey: string, modelo = 'claude-opus-5-5', esfuerzo: 'low' | 'medium' | 'high' = 'medium'): ProveedorLLM {
  const cliente = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 2 });
  return {
    nombre: 'anthropic',
    modelo,
    async responder(p: PeticionAgente) {
      const tools: Anthropic.Beta.BetaTool[] = p.herramientas.map((h) => ({
        name: h.nombre, description: h.descripcion, input_schema: h.esquema as Anthropic.Beta.BetaTool.InputSchema,
      }));
      const mensajes: Anthropic.Beta.BetaMessageParam[] = p.historial.map((m) => ({ role: m.rol, content: m.texto }));
      for (let ronda = 0; ronda <= MAX_RONDAS_HERRAMIENTAS; ronda++) {
        const r = await cliente.beta.messages.create({
          model: modelo,
          max_tokens: 8000,
          // Si el modelo declina por política, el servidor reintenta con el modelo de respaldo por defecto.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: esfuerzo },
          system: [
            { type: 'text', text: p.sistema, cache_control: { type: 'ephemeral' } },   // reglas fijas: cacheables
            { type: 'text', text: p.contexto },                                        // situación del turno
          ],
          tools,
          // Última ronda: se obliga a responder con texto (sin más herramientas).
          tool_choice: ronda < MAX_RONDAS_HERRAMIENTAS ? { type: 'auto' } : { type: 'none' },
          messages: mensajes,
        });
        if (r.stop_reason === 'refusal') throw new Error('El modelo declinó responder (refusal).');
        const llamadas = r.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
        if (r.stop_reason !== 'tool_use' || !llamadas.length) {
          return r.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
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
