// Generador pseudoaleatorio determinista (mulberry32): misma semilla => mismos datos.
export class Azar {
  private s: number;
  constructor(semilla: number) { this.s = semilla >>> 0; }

  /** Número en [0, 1). */
  sig(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Real uniforme en [a, b). */
  real(a: number, b: number) { return a + (b - a) * this.sig(); }
  /** Entero uniforme en [a, b]. */
  ent(a: number, b: number) { return Math.floor(this.real(a, b + 1)); }
  /** true con probabilidad p (acotada a [0, 1]). */
  si(p: number) { return this.sig() < Math.min(1, Math.max(0, p)); }
  elegir<T>(xs: readonly T[]): T { return xs[Math.floor(this.sig() * xs.length)]; }
  /** Elección ponderada: [[valor, peso], ...]. */
  ponderado<T>(pares: readonly (readonly [T, number])[]): T {
    const total = pares.reduce((s, [, w]) => s + w, 0);
    let r = this.sig() * total;
    for (const [v, w] of pares) if ((r -= w) < 0) return v;
    return pares[pares.length - 1][0];
  }
}

const HORA = 3600_000;
export const masHoras = (d: Date, h: number) => new Date(d.getTime() + h * HORA);
export const masDias = (d: Date, dias: number) => masHoras(d, dias * 24);
