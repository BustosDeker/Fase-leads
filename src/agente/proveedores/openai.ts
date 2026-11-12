// Adaptador para APIs compatibles con OpenAI Chat Completions (OpenAI y Groq).
import { MAX_RONDAS_HERRAMIENTAS, type PeticionAgente, type ProveedorLLM, type UsoTokens } from '../tipos.js';
import { errorHttp, fetchConReintentos, sumarUso } from './comun.js';

export interface OpcionesOpenAICompatible {
  baseUrl?: string;
  nombreProveedor?: 'openai' | 'groq';
  recortarPorLimiteTokens?: boolean;
}

function recortarHistorial(historial: PeticionAgente['historial']) {
  const corto = historial.slice(-12);
  while (corto.length && corto[0].rol !== 'user') corto.shift();
  return corto;
}

export function proveedorOpenAI(apiKey: string, modelo: string, opciones: OpcionesOpenAICompatible = {}): ProveedorLLM {
  const baseUrl = (opciones.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const nombreProveedor = opciones.nombreProveedor ?? 'openai';
  let uso: UsoTokens | undefined;
  return {
    nombre: nombreProveedor,
    modelo,
    get uso() { return uso; },
    async responder(p: PeticionAgente) {
      uso = { entrada: 0, salida: 0, total: 0 };
      const tools = p.herramientas.map((h) => ({ type: 'function', function: { name: h.nombre, description: h.descripcion, parameters: h.esquema } }));
      let historial = p.historial;
      let recorteRealizado = false;
      const mensajes: any[] = [
        { role: 'system', content: p.sistema + '\n\nSituación actual:\n' + p.contexto },
        ...historial.map((m) => ({ role: m.rol, content: m.texto })),
      ];
      for (let ronda = 0; ronda <= MAX_RONDAS_HERRAMIENTAS; ronda++) {
        const res = await fetchConReintentos(() => fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          // Solo campos de Chat Completions; no se envían campos específicos de Groq.
          body: JSON.stringify({ model: modelo, messages: mensajes, ...(tools.length ? { tools, tool_choice: ronda < MAX_RONDAS_HERRAMIENTAS ? 'auto' : 'none' } : {}) }),
          signal: AbortSignal.timeout(90_000),
        }));
        if ((res.status === 413 || res.status === 429) && opciones.recortarPorLimiteTokens && !recorteRealizado) {
          recorteRealizado = true;
          historial = recortarHistorial(historial);
          mensajes.splice(0, mensajes.length, { role: 'system', content: p.sistema + '\n\nSituación actual:\n' + p.contexto },
            ...historial.map((m) => ({ role: m.rol, content: m.texto })));
          ronda = -1;
          continue;
        }
        if (!res.ok) throw errorHttp(nombreProveedor === 'groq' ? 'Groq' : 'OpenAI', res.status);
        const json: any = await res.json();
        uso = sumarUso(uso, json.usage?.prompt_tokens, json.usage?.completion_tokens);
        const msg = json.choices?.[0]?.message;
        if (!msg) throw new Error(`${nombreProveedor === 'groq' ? 'Groq' : 'OpenAI'} no devolvió mensaje.`);
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
