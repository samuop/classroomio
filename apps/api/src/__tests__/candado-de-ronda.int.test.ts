/**
 * El candado de la ronda y la marca de «Detener» — contra un Redis real.
 *
 * ── Por qué aparte ───────────────────────────────────────────────────────────
 *
 * `candado-de-ronda.test.ts` usa un Redis de mentira que IMITA en TypeScript los
 * tres scripts Lua (`RENOVAR_SI_ES_MIO`, `SOLTAR_SI_ES_MIO`, `PEDIR_DETENER`):
 * prueba la lógica del candado, no los scripts. Un error en el Lua —una clave
 * corrida de lugar, un argumento que no es el que se cree— pasaba esos tests y
 * aparecía recién en producción, con un «Detener» sin efecto o con una ronda que
 * borra la marca de la siguiente.
 *
 * ── Qué fija ─────────────────────────────────────────────────────────────────
 *
 * 1. Una sola ronda por conversación (el SET NX de verdad).
 * 2. «Detener» deja la marca con el token de la ronda viva; sin ronda no escribe
 *    nada.
 * 3. Renovar extiende también la marca; soltar borra candado, índice y marca.
 * 4. Una ronda vieja —la que perdió su candado— no reconoce, no renueva ni borra
 *    lo de la ronda que vino después.
 *
 * Se corre con `pnpm --filter @cio/api test:db`, con Redis levantado:
 * `docker compose -f docker/docker-compose.yaml up -d redis`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';

import {
  CANDADO_MS,
  claveDeDetener,
  claveDelCandado,
  claveDelIndice,
  pedirQueSeDetenga,
  tomarCandadoDeRonda,
  type CandadoDeRonda
} from '@api/services/agent/ronda-viva';

const RUN = randomUUID().slice(0, 8);
const CURSO = `int-candado-curso-${RUN}`;
const DOCENTE = `int-candado-docente-${RUN}`;

const redis: RedisClientType = createClient({
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  // Sin reintentos: sin Redis, `connect` falla en el acto con el mensaje de
  // abajo, en vez de reintentar hasta que venza el tiempo del hook.
  socket: { reconnectStrategy: false }
});

/** Las conversaciones que usó cada test, para borrar sus claves al final. */
const usadas: string[] = [];
/** Los candados tomados, para soltarlos al final y cortar sus renovaciones. */
const tomados: CandadoDeRonda[] = [];

function conversacionNueva(): string {
  const id = `int-candado-${RUN}-${usadas.length}`;
  usadas.push(id);
  return id;
}

async function tomar(conversationId: string, startedAt = '2026-09-30T12:00:00.000Z') {
  const candado = await tomarCandadoDeRonda({
    redis,
    conversationId,
    courseId: CURSO,
    userId: DOCENTE,
    // Que no se renueve solo en medio de un test: acá se renueva a mano.
    renovarCadaMs: 600_000,
    ahora: () => new Date(startedAt)
  });

  if (candado) tomados.push(candado);

  return candado;
}

/** Lo que pasa cuando muere el proceso de una ronda: su candado vence y nadie lo suelta. */
async function vencerCandado(conversationId: string) {
  await redis.del(claveDelCandado(conversationId));
}

beforeAll(async () => {
  redis.on('error', () => {});

  try {
    await redis.connect();
  } catch (error) {
    throw new Error(
      'No se pudo hablar con Redis. Levantalo:\n' +
        '  docker compose -f docker/docker-compose.yaml up -d redis\n' +
        `Detalle: ${error instanceof Error ? error.message : String(error)}`
    );
  }
});

afterAll(async () => {
  if (!redis.isReady) return;

  for (const candado of tomados) await candado.soltar();
  for (const id of usadas) await redis.del([claveDelCandado(id), claveDeDetener(id)]);
  await redis.del(claveDelIndice(CURSO, DOCENTE));
  await redis.quit();
});

describe('el candado de la ronda, con Redis de verdad', () => {
  it('toma una sola ronda por conversación', async () => {
    const id = conversacionNueva();

    expect(await tomar(id)).not.toBeNull();
    expect(await tomar(id)).toBeNull();
    expect(await redis.pTTL(claveDelCandado(id))).toBeGreaterThan(0);
  });

  it('«Detener» deja la marca con el token de la ronda viva, y la ronda la reconoce', async () => {
    const id = conversacionNueva();
    const ronda = await tomar(id);

    expect(await ronda!.pidieronDetener()).toBe(false);
    expect(await pedirQueSeDetenga({ redis, conversationId: id })).toBe('pedido');

    expect(await redis.get(claveDeDetener(id))).toBe(await redis.get(claveDelCandado(id)));
    expect(await redis.pTTL(claveDeDetener(id))).toBeGreaterThan(0);
    expect(await ronda!.pidieronDetener()).toBe(true);
  });

  it('sin ronda viva, «Detener» contesta que no hay ronda y no escribe nada', async () => {
    const id = conversacionNueva();

    expect(await pedirQueSeDetenga({ redis, conversationId: id })).toBe('sin-ronda');
    expect(await redis.exists(claveDeDetener(id))).toBe(0);
  });

  it('renovar extiende también la marca: un paso largo no la pierde', async () => {
    const id = conversacionNueva();
    const ronda = await tomar(id);

    // Una marca que vencería en un segundo…
    await pedirQueSeDetenga({ redis, conversationId: id, ttlMs: 1_000 });
    expect(await redis.pTTL(claveDeDetener(id))).toBeLessThanOrEqual(1_000);

    await ronda!.renovar();

    // …queda con el plazo del candado, y el índice sigue diciendo cuándo empezó.
    expect(await redis.pTTL(claveDeDetener(id))).toBeGreaterThan(CANDADO_MS - 5_000);
    expect(await redis.hGet(claveDelIndice(CURSO, DOCENTE), id)).toBe(ronda!.startedAt);
  });

  it('soltar borra el candado, la entrada del índice y la marca', async () => {
    const id = conversacionNueva();
    const ronda = await tomar(id);
    await pedirQueSeDetenga({ redis, conversationId: id });

    await ronda!.soltar();

    expect(await redis.exists(claveDelCandado(id))).toBe(0);
    expect(await redis.exists(claveDeDetener(id))).toBe(0);
    expect(await redis.hExists(claveDelIndice(CURSO, DOCENTE), id)).toBe(false);
  });

  describe('una ronda que perdió su candado no toca lo de la ronda que vino después', () => {
    it('la marca que quedó de la ronda vieja no detiene a la nueva', async () => {
      const id = conversacionNueva();
      await tomar(id, '2026-09-30T12:00:00.000Z');
      await pedirQueSeDetenga({ redis, conversationId: id });
      await vencerCandado(id);

      const nueva = await tomar(id, '2026-09-30T12:05:00.000Z');

      expect(nueva).not.toBeNull();
      // La marca vieja sigue ahí hasta que vence…
      expect(await redis.exists(claveDeDetener(id))).toBe(1);
      // …pero no es para esta ronda.
      expect(await nueva!.pidieronDetener()).toBe(false);
    });

    it('soltar la vieja no borra el candado, el índice ni la marca de la nueva', async () => {
      const id = conversacionNueva();
      const vieja = await tomar(id, '2026-09-30T12:00:00.000Z');
      await vencerCandado(id);
      const nueva = await tomar(id, '2026-09-30T12:05:00.000Z');
      await pedirQueSeDetenga({ redis, conversationId: id });

      await vieja!.soltar();

      expect(await redis.exists(claveDelCandado(id))).toBe(1);
      expect(await redis.hGet(claveDelIndice(CURSO, DOCENTE), id)).toBe(nueva!.startedAt);
      expect(await nueva!.pidieronDetener()).toBe(true);
    });

    it('renovar la vieja no pisa el índice ni extiende la marca de la nueva', async () => {
      const id = conversacionNueva();
      const vieja = await tomar(id, '2026-09-30T12:00:00.000Z');
      await vencerCandado(id);
      const nueva = await tomar(id, '2026-09-30T12:05:00.000Z');
      await pedirQueSeDetenga({ redis, conversationId: id, ttlMs: 1_000 });

      await vieja!.renovar();

      expect(await redis.hGet(claveDelIndice(CURSO, DOCENTE), id)).toBe(nueva!.startedAt);
      expect(await redis.pTTL(claveDeDetener(id))).toBeLessThanOrEqual(1_000);
    });
  });
});
