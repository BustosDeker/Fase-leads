// Proveedor Google Gemini (generateContent con function calling) vía HTTP.
// No verificado con una clave real en este entorno (ver README «Pendiente/Limitaciones»).
import { MAX_RONDAS_HERRAMIENTAS, type PeticionAgente, type ProveedorLLM } from '../tipos.js';

/** Gemini acepta un subconjunto de JSON Schema: se quita additionalProperties. */
function esquemaGemini(e: any): any {
  if (Array.isArray(e)) return e.map(esquemaGemini);
  if (!e || typeof e !== 'object') return e;
  const { additionalProperties: _x, ...resto } = e;
  return Object.fromEntries(Object.entries(resto).map(([k, v]) => [k, esquemaGemini(v)]));
}

export function proveedorGemini(apiKey: string, modelo: string): ProveedorLLM {
  return {
    nombre: 'gemini',
    modelo,
    async responder(p: PeticionAgente) {
      const declaraciones = p.herramientas.map((h) => {
        const params = esquemaGemini(h.esquema);
        return { name: h.nombre, description: h.descripcion, ...(Object.keys(params.properties ?? {}).length ? { parameters: params } : {}) };
      });
      const contenidos: any[] = p.historial.map((m) => ({ role: m.rol === 'assistant' ? 'model' : 'user', parts: [{ text: m.texto }] }));
      for (let ronda = 0; ronda <= MAX_RONDAS_HERRAMIENTAS; ronda++) {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: p.sistema + '\n\nSituación actual:\n' + p.contexto }] },
            contents: contenidos,
            tools: [{ functionDeclarations: declaraciones }],
            toolConfig: { functionCallingConfig: { mode: ronda < MAX_RONDAS_HERRAMIENTAS ? 'AUTO' : 'NONE' } },
          }),
          signal: AbortSignal.timeout(90_000),
        });
        if (!res.ok) throw new Error(`Gemini respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const contenido = (await res.json()).candidates?.[0]?.content;
        const partes: any[] = contenido?.parts ?? [];
        const llamadas = partes.filter((x) => x.functionCall);
        if (!llamadas.length) return partes.map((x) => x.text ?? '').join('').trim();
        contenidos.push(contenido);
        const respuestas = [];
        for (const l of llamadas) {
          const r = await p.ejecutar(l.functionCall.name, l.functionCall.args ?? {});
          respuestas.push({ functionResponse: { name: l.functionCall.name, response: { resultado: JSON.parse(r) } } });
        }
        contenidos.push({ role: 'user', parts: respuestas });
      }
      throw new Error('Se alcanzó el máximo de rondas de herramientas.');
    },
  };
}
