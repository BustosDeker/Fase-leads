// Proveedor OpenAI (Chat Completions con function calling) vía HTTP, sin SDK adicional.
// No verificado con una clave real en este entorno (ver README «Pendiente/Limitaciones»).
import { MAX_RONDAS_HERRAMIENTAS, type PeticionAgente, type ProveedorLLM } from '../tipos.js';

export function proveedorOpenAI(apiKey: string, modelo: string): ProveedorLLM {
  return {
    nombre: 'openai',
    modelo,
    async responder(p: PeticionAgente) {
      const tools = p.herramientas.map((h) => ({ type: 'function', function: { name: h.nombre, description: h.descripcion, parameters: h.esquema } }));
      const mensajes: any[] = [
        { role: 'system', content: p.sistema + '\n\nSituación actual:\n' + p.contexto },
        ...p.historial.map((m) => ({ role: m.rol, content: m.texto })),
      ];
      for (let ronda = 0; ronda <= MAX_RONDAS_HERRAMIENTAS; ronda++) {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: modelo, messages: mensajes, tools, tool_choice: ronda < MAX_RONDAS_HERRAMIENTAS ? 'auto' : 'none' }),
          signal: AbortSignal.timeout(90_000),
        });
        if (!res.ok) throw new Error(`OpenAI respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const msg = (await res.json()).choices?.[0]?.message;
        if (!msg) throw new Error('OpenAI no devolvió mensaje.');
        if (!msg.tool_calls?.length) return String(msg.content ?? '').trim();
        mensajes.push(msg);
        for (const t of msg.tool_calls) {
          let entrada: unknown = {};
          try { entrada = JSON.parse(t.function.arguments || '{}'); } catch { /* el validador de la herramienta lo rechazará */ }
          mensajes.push({ role: 'tool', tool_call_id: t.id, content: await p.ejecutar(t.function.name, entrada) });
        }
      }
      throw new Error('Se alcanzó el máximo de rondas de herramientas.');
    },
  };
}
