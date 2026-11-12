// Groq usa el formato Chat Completions compatible con OpenAI.
import type { ProveedorLLM } from '../tipos.js';
import { proveedorOpenAI } from './openai.js';

export const GROQ_BASE_URL_POR_DEFECTO = 'https://api.groq.com/openai/v1';

export function proveedorGroq(apiKey: string, modelo: string, baseUrl = process.env.GROQ_BASE_URL || GROQ_BASE_URL_POR_DEFECTO): ProveedorLLM {
  return proveedorOpenAI(apiKey, modelo, { baseUrl, nombreProveedor: 'groq', recortarPorLimiteTokens: true });
}
