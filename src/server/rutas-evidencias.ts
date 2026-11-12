// Evidencias verificables para la sustentación: todo se calcula en el momento contra SQL Server
// (nada está escrito a mano). Incluye ejecutar las pruebas automáticas desde la app (solo admin).
import { spawn } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import { RAIZ } from '../config.js';
import { oltp } from '../db.js';
import { ultimaEjecucionOk } from '../etl/ejecutar.js';
import { verificarOltpMart } from '../etl/verificar.js';

let pruebasEnCurso = false;

function ejecutarPruebas(): Promise<{ ok: boolean; pasaron: number; fallaron: number; pruebas: { nombre: string; ok: boolean }[]; duracionMs: number }> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', 'tests/*.test.ts'], { cwd: RAIZ, env: process.env });
    let salida = '';
    p.stdout.on('data', (d) => { salida += d; });
    p.stderr.on('data', (d) => { salida += d; });
    const limite = setTimeout(() => p.kill(), 300_000);
    p.on('close', (codigo) => {
      clearTimeout(limite);
      const pruebas = [...salida.matchAll(/^\s*(not ok|ok) \d+ - (.+)$/gm)].map((m) => ({ nombre: m[2].replace(/\s+#.*$/, ''), ok: m[1] === 'ok' }))
        .filter((x) => !/\.test\.ts$/.test(x.nombre));
      const n = (k: string) => Number(new RegExp(`^# ${k} (\\d+)`, 'm').exec(salida)?.[1] ?? 0);
      resolve({ ok: codigo === 0, pasaron: n('pass'), fallaron: n('fail'), pruebas, duracionMs: Date.now() - t0 });
    });
  });
}

export function rutasEvidencias(app: FastifyInstance) {
  app.get('/api/evidencias', async () => {
    const pool = await oltp();
    const r = await pool.request().query(`
      SELECT SUSER_SNAME() AS login, IS_SRVROLEMEMBER('sysadmin') AS sysadmin, IS_MEMBER('db_owner') AS db_owner,
             IS_MEMBER('db_datareader') AS lector, IS_MEMBER('db_datawriter') AS escritor,
             HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CREATE TABLE') AS puede_crear_tablas,
             HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'ALTER ANY USER') AS puede_crear_usuarios;
      SELECT (SELECT COUNT(*) FROM sys.triggers WHERE name = 'TR_OPORTUNIDAD_TRANSICION') AS trigger_estados,
             (SELECT COUNT(*) FROM dbo.TRANSICION_ESTADO_OPORTUNIDAD) AS transiciones_permitidas,
             (SELECT COUNT(*) FROM sys.check_constraints WHERE name IN ('CK_PROPUESTA_TOPE', 'CK_PROPUESTA_MINIMO')) AS checks_precio,
             (SELECT COUNT(*) FROM dbo.PROPUESTA WHERE descuento > precio_base * tope_descuento_aplicado / 100.0
                OR precio_final < precio_minimo_aplicado) AS propuestas_fuera_de_limites,
             (SELECT COUNT(*) FROM dbo.CITA_VIRTUAL a JOIN dbo.CITA_VIRTUAL b ON a.asesor_id = b.asesor_id AND a.cita_id < b.cita_id
                AND a.estado <> 'CANCELADA' AND b.estado <> 'CANCELADA' AND a.inicio < b.fin AND b.inicio < a.fin) AS citas_solapadas,
             (SELECT COUNT(*) FROM dbo.CONTACTO WHERE no_contactar = 1) AS contactos_no_contactar,
             (SELECT COUNT(*) FROM dbo.MENSAJE m JOIN dbo.CONVERSACION c ON c.conversacion_id = m.conversacion_id JOIN dbo.CONTACTO co ON co.contacto_id = c.contacto_id
                WHERE m.emisor <> 'CLIENTE' AND co.no_contactar = 1 AND co.fecha_revocacion IS NOT NULL AND m.fecha_hora > DATEADD(SECOND, 5, co.fecha_revocacion)
                  AND c.canal_mensajeria <> 'HISTORICO') AS mensajes_tras_revocar;
      SELECT COUNT(*) AS turnos, ISNULL(SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END), 0) AS con_error,
             ISNULL(SUM(CASE WHEN sospecha_inyeccion = 1 THEN 1 ELSE 0 END), 0) AS sospechas,
             ISNULL(SUM(CASE WHEN tools_json LIKE '%"revision":["%' THEN 1 ELSE 0 END), 0) AS respuestas_corregidas,
             ISNULL(SUM(CASE WHEN tools_json LIKE '%Sin consentimiento de datos%' THEN 1 ELSE 0 END), 0) AS bloqueos_por_consentimiento,
             AVG(CAST(latencia_ms AS FLOAT)) AS latencia_media
      FROM dbo.AGENTE_TURNO;
      SELECT proveedor_llm, COUNT(*) AS n FROM dbo.AGENTE_TURNO GROUP BY proveedor_llm;`);
    const [priv, integ, agente, proveedores] = r.recordsets as any[];
    const ultima = await ultimaEjecucionOk();
    let verificacion: Awaited<ReturnType<typeof verificarOltpMart>> | { error: string } | null = null;
    if (ultima) { try { verificacion = await verificarOltpMart(ultima); } catch (e: any) { verificacion = { error: e.message }; } }
    return { privilegios: priv[0], integridad: integ[0], agente: agente[0], proveedores, etl: ultima, verificacion };
  });

  app.post('/api/evidencias/pruebas', async (req, reply) => {
    if ((req as any).sesion?.rol !== 'admin') return reply.code(403).send({ error: 'Solo el administrador ejecuta las pruebas.' });
    if (pruebasEnCurso) return reply.code(409).send({ error: 'Las pruebas ya se están ejecutando.' });
    pruebasEnCurso = true;
    try { return await ejecutarPruebas(); } finally { pruebasEnCurso = false; }
  });
}
