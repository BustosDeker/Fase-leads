// Inicio de sesión con roles (sin dependencias): usuarios de APP_USERS en .env, cookie firmada con
// HMAC-SHA256 (SESSION_SECRET), HttpOnly y SameSite=Lax, vigencia de 12 horas.
// Roles: admin (todo), asesor (opera LEADS; no ejecuta el ETL ni vincula WhatsApp), viewer (solo consulta).
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

export type Rol = 'admin' | 'asesor' | 'viewer';
export interface Sesion { usuario: string; rol: Rol; exp: number }

const COOKIE = 'inb_sesion';
const VIGENCIA_MS = 12 * 3_600_000;

function usuarios(): Map<string, { clave: string; rol: Rol }> {
  const m = new Map<string, { clave: string; rol: Rol }>();
  for (const x of (process.env.APP_USERS || '').split(',')) {
    const [u, c, r] = x.split(':').map((s) => s?.trim());
    if (u && c && ['admin', 'asesor', 'viewer'].includes(r)) m.set(u.toLowerCase(), { clave: c, rol: r as Rol });
  }
  return m;
}

function secreto(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('Falta SESSION_SECRET en .env (lo genera `npm run setup`).');
  return s;
}
const firmar = (datos: string) => crypto.createHmac('sha256', secreto()).update(datos).digest('base64url');
const igual = (a: string, b: string) => {
  const x = crypto.createHash('sha256').update(a).digest(), y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x, y);
};

export function crearToken(s: Sesion): string {
  const datos = Buffer.from(JSON.stringify(s)).toString('base64url');
  return `${datos}.${firmar(datos)}`;
}

export function leerToken(token: string | undefined): Sesion | null {
  if (!token) return null;
  const [datos, firma] = token.split('.');
  if (!datos || !firma || !igual(firma, firmar(datos))) return null;
  try {
    const s = JSON.parse(Buffer.from(datos, 'base64url').toString()) as Sesion;
    return s.exp > Date.now() && usuarios().get(s.usuario)?.rol === s.rol ? s : null;   // un usuario quitado de .env pierde la sesión
  } catch { return null; }
}

function cookieDe(req: FastifyRequest): string | undefined {
  const c = req.headers.cookie ?? '';
  for (const parte of c.split(';')) { const [k, ...v] = parte.trim().split('='); if (k === COOKIE) return decodeURIComponent(v.join('=')); }
  return undefined;
}

// Rutas que no usan la sesión: tienen su propia autenticación (token Bearer o firma HMAC) o son el login.
const PUBLICAS = new Set(['/api/auth/login', '/api/auth/yo', '/api/buyers', '/api/payers/confirmacion', '/api/whatsapp/webhook',
  '/api/agente/seguimiento/candidatos', '/api/agente/seguimiento/ejecutar', '/api/agente/cobranza/candidatos', '/api/agente/cobranza/ejecutar',
  '/api/agente/cuotas/ejecutar', '/api/agente/derivaciones/pendientes']);
// Acciones de administración.
const SOLO_ADMIN = [/^\/api\/etl\/ejecutar$/, /^\/api\/whatsapp\/(conectar|desconectar)$/, /^\/api\/agente\/configuracion(\/.*)?$/];
// Lo único que un viewer puede hacer además de consultar.
const VIEWER_POST = new Set(['/api/auth/logout', '/api/tablero/explicar']);

/** Decide si una petición está permitida. Exportado para las pruebas. */
export function autorizar(metodo: string, ruta: string, s: Sesion | null): { ok: true } | { ok: false; estado: 401 | 403; error: string } {
  // El estudiante abre /api/pago/<token>... desde WhatsApp, sin sesión en el panel: el token es su propia credencial.
  if (!ruta.startsWith('/api/') || PUBLICAS.has(ruta) || ruta.startsWith('/api/pago/')) return { ok: true };
  if (!s) return { ok: false, estado: 401, error: 'Inicia sesión para continuar.' };
  if (SOLO_ADMIN.some((r) => r.test(ruta)) && s.rol !== 'admin') return { ok: false, estado: 403, error: 'Esta acción es solo para el rol administrador.' };
  if (s.rol === 'viewer' && metodo !== 'GET' && !VIEWER_POST.has(ruta)) return { ok: false, estado: 403, error: 'Tu rol solo permite consultar (sin cambios).' };
  return { ok: true };
}

const intentos = new Map<string, { n: number; desde: number }>();

export function rutasAuth(app: FastifyInstance) {
  secreto();   // falla al arrancar si no hay secreto, no en el primer login
  app.decorateRequest('sesion', null);
  app.addHook('onRequest', async (req, reply) => {
    const ruta = req.url.split('?')[0];
    const s = leerToken(cookieDe(req));
    (req as any).sesion = s;
    const r = autorizar(req.method, ruta, s);
    if (!r.ok) return reply.code(r.estado).send({ error: r.error });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const ip = req.ip;
    const i = intentos.get(ip);
    if (i && Date.now() - i.desde < 60_000 && i.n >= 5) return reply.code(429).send({ error: 'Demasiados intentos. Espera un minuto.' });
    const { usuario, clave } = z.object({ usuario: z.string().trim().toLowerCase().min(1).max(60), clave: z.string().min(1).max(200) }).parse(req.body);
    const u = usuarios().get(usuario);
    if (!u || !igual(clave, u.clave)) {
      intentos.set(ip, i && Date.now() - i.desde < 60_000 ? { n: i.n + 1, desde: i.desde } : { n: 1, desde: Date.now() });
      return reply.code(401).send({ error: 'Usuario o clave incorrectos.' });
    }
    intentos.delete(ip);
    const s: Sesion = { usuario, rol: u.rol, exp: Date.now() + VIGENCIA_MS };
    reply.header('Set-Cookie', `${COOKIE}=${crearToken(s)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${VIGENCIA_MS / 1000}`);
    return { usuario, rol: u.rol };
  });
  app.post('/api/auth/logout', async (_req, reply) => {
    reply.header('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return { ok: true };
  });
  app.get('/api/auth/yo', async (req, reply) => {
    const s = (req as any).sesion as Sesion | null;
    return s ? { usuario: s.usuario, rol: s.rol } : reply.code(401).send({ error: 'Sin sesión.' });
  });
}
