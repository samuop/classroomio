import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CANDADO_MS,
  claveDeDetener,
  claveDelCandado,
  leerRondaViva,
  pedirQueSeDetenga,
  SOLTAR_SI_ES_MIO,
  tomarCandadoDeRonda
} from '@api/services/agent/ronda-viva';
import type { RedisClient } from '@api/utils/redis/redis';

import { redisDePrueba, type RedisDePrueba } from './ayuda/redis-de-prueba';

/**
 * Una sola ronda viva por conversación, y `/agent/status` que la ve.
 *
 * ── Lo que se midió (2026-09-29) ─────────────────────────────────────────────
 *
 * Un reintento arrancó mientras la ronda anterior seguía escribiendo una
 * lección, y un pedido que el navegador ya había abandonado siguió trabajando
 * en paralelo con su reintento. Hoy no dejó duplicados de casualidad: la
 * ventana de `write_questions` son 9 a 15 s de escritor.
 *
 * El Redis de acá es de mentira (ver `ayuda/redis-de-prueba.ts`), con el reloj
 * de los timers falsos. La parte que importa probar es la del candado —quién lo
 * toma, quién lo suelta, cuándo vence—, no Redis.
 */

const CURSO = 'curso-de-prueba';
const DOCENTE = 'docente-de-prueba';

const tomar = (redis: RedisDePrueba, conversationId: string, extra: Record<string, unknown> = {}) =>
  tomarCandadoDeRonda({
    redis: redis as unknown as RedisClient,
    conversationId,
    courseId: CURSO,
    userId: DOCENTE,
    ...extra
  });

const rondaViva = (redis: RedisDePrueba) =>
  leerRondaViva({ redis: redis as unknown as RedisClient, courseId: CURSO, userId: DOCENTE });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-29T15:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('el candado de la conversación', () => {
  it('una segunda ronda sobre la misma conversación no lo toma', async () => {
    const redis = redisDePrueba();

    const primera = await tomar(redis, 'conversacion-1');
    const segunda = await tomar(redis, 'conversacion-1');

    expect(primera).not.toBeNull();
    expect(segunda).toBeNull();
    // SET NX PX con un token, y el vencimiento del contrato.
    expect(redis.set).toHaveBeenCalledWith(claveDelCandado('conversacion-1'), expect.any(String), {
      NX: true,
      PX: CANDADO_MS
    });

    await primera?.soltar();
  });

  it('otra conversación del mismo docente sí', async () => {
    const redis = redisDePrueba();

    const una = await tomar(redis, 'conversacion-1');
    const otra = await tomar(redis, 'conversacion-2');

    expect(una).not.toBeNull();
    expect(otra).not.toBeNull();

    await una?.soltar();
    await otra?.soltar();
  });

  it('suelto, la ronda siguiente lo toma: la continuación automática no rebota', async () => {
    const redis = redisDePrueba();

    const primera = await tomar(redis, 'conversacion-1');
    await primera?.soltar();

    const siguiente = await tomar(redis, 'conversacion-1');

    expect(siguiente).not.toBeNull();
    await siguiente?.soltar();
  });

  it('se renueva solo mientras la ronda trabaja, aunque tarde más que su vencimiento', async () => {
    const redis = redisDePrueba();
    const candado = await tomar(redis, 'conversacion-1', { ttlMs: 60_000, renovarCadaMs: 20_000 });

    // Tres minutos de trabajo: tres veces el vencimiento.
    await vi.advanceTimersByTimeAsync(180_000);

    expect(await tomar(redis, 'conversacion-1')).toBeNull();

    await candado?.soltar();
  });

  it('si el proceso muere sin soltarlo, vence solo', async () => {
    const redis = redisDePrueba();
    // Sin renovación: es lo que queda de un proceso que murió.
    const huerfano = await tomar(redis, 'conversacion-1', { ttlMs: 60_000, renovarCadaMs: 10_000_000 });

    await vi.advanceTimersByTimeAsync(61_000);

    const siguiente = await tomar(redis, 'conversacion-1');
    expect(siguiente).not.toBeNull();

    // Y el huérfano que despierta tarde no le suelta el candado a la ronda nueva.
    await huerfano?.soltar();
    expect(await tomar(redis, 'conversacion-1')).toBeNull();

    await siguiente?.soltar();
  });

  it('una ronda que perdió el candado no se lo renueva a la que lo tomó después', async () => {
    const redis = redisDePrueba();
    const vieja = await tomar(redis, 'conversacion-1', { ttlMs: 60_000, renovarCadaMs: 10_000_000 });

    await vi.advanceTimersByTimeAsync(61_000);
    const nueva = await tomar(redis, 'conversacion-1', { ttlMs: 60_000, renovarCadaMs: 10_000_000 });

    await vi.advanceTimersByTimeAsync(50_000);
    await vieja?.renovar();
    await vi.advanceTimersByTimeAsync(11_000);

    // Si la vieja la hubiera renovado, seguiría trabada.
    expect(await tomar(redis, 'conversacion-1')).not.toBeNull();

    await nueva?.soltar();
  });

  it('soltarlo dos veces no hace nada', async () => {
    const redis = redisDePrueba();
    const candado = await tomar(redis, 'conversacion-1');

    await candado?.soltar();
    await candado?.soltar();

    expect(redis.eval.mock.calls.filter(([script]) => script === SOLTAR_SI_ES_MIO)).toHaveLength(1);
  });
});

describe('la ronda viva que ve /agent/status', () => {
  it('figura mientras la ronda vive, con la conversación y la hora de arranque', async () => {
    const redis = redisDePrueba();
    const candado = await tomar(redis, 'conversacion-1');

    expect(await rondaViva(redis)).toEqual({
      conversationId: 'conversacion-1',
      startedAt: '2026-09-29T15:00:00.000Z'
    });

    await candado?.soltar();

    expect(await rondaViva(redis)).toBeNull();
  });

  it('no le cree al índice una ronda cuyo candado venció', async () => {
    const redis = redisDePrueba();
    await tomar(redis, 'conversacion-1', { ttlMs: 60_000, renovarCadaMs: 10_000_000 });
    await vi.advanceTimersByTimeAsync(61_000);

    // Lo que queda en el índice si sobrevive al candado: la entrada de una
    // ronda cuyo proceso murió. El candado ya venció, y el candado no miente.
    await redis.hSet(`agent:round:course:${CURSO}:user:${DOCENTE}`, 'conversacion-1', '2026-09-29T15:00:00.000Z');

    expect(await rondaViva(redis)).toBeNull();
  });

  it('con dos conversaciones vivas, la más nueva', async () => {
    const redis = redisDePrueba();
    const vieja = await tomar(redis, 'conversacion-1');

    await vi.advanceTimersByTimeAsync(5_000);
    const nueva = await tomar(redis, 'conversacion-2');

    expect((await rondaViva(redis))?.conversationId).toBe('conversacion-2');

    await vieja?.soltar();
    await nueva?.soltar();
  });

  it('preguntada por una conversación, contesta por ésa aunque haya otra más nueva', async () => {
    // El panel que espera la ronda vieja no puede darla por terminada porque
    // la más nueva del curso sea de otro chat.
    const redis = redisDePrueba();
    const vieja = await tomar(redis, 'conversacion-1');

    await vi.advanceTimersByTimeAsync(5_000);
    const nueva = await tomar(redis, 'conversacion-2');

    const porLaVieja = () =>
      leerRondaViva({
        redis: redis as unknown as RedisClient,
        courseId: CURSO,
        userId: DOCENTE,
        conversationId: 'conversacion-1'
      });

    expect((await porLaVieja())?.conversationId).toBe('conversacion-1');

    await vieja?.soltar();
    expect(await porLaVieja()).toBeNull();

    await nueva?.soltar();
  });
});

describe('«Detener»', () => {
  const detener = (redis: RedisDePrueba, conversationId: string) =>
    pedirQueSeDetenga({ redis: redis as unknown as RedisClient, conversationId });

  it('la ronda viva ve la orden; otra conversación no', async () => {
    const redis = redisDePrueba();
    const candado = await tomar(redis, 'conversacion-1');
    const otra = await tomar(redis, 'conversacion-2');

    expect(await candado!.pidieronDetener()).toBe(false);
    expect(await detener(redis, 'conversacion-1')).toBe('pedido');
    expect(await candado!.pidieronDetener()).toBe(true);
    expect(await otra!.pidieronDetener()).toBe(false);

    await candado?.soltar();
    await otra?.soltar();
  });

  it('sin ronda viva no deja nada puesto', async () => {
    const redis = redisDePrueba();

    expect(await detener(redis, 'conversacion-1')).toBe('sin-ronda');
    expect(await redis.get(claveDeDetener('conversacion-1'))).toBeNull();
  });

  it('la orden dura lo que dura el paso en curso, aunque tarde más que el vencimiento', async () => {
    // Una lección llegó a tardar 155 s: la orden tiene que seguir ahí cuando
    // ese paso termine y la ronda pregunte.
    const redis = redisDePrueba();
    const candado = await tomar(redis, 'conversacion-1', { ttlMs: 60_000, renovarCadaMs: 20_000 });

    await detener(redis, 'conversacion-1');
    await vi.advanceTimersByTimeAsync(155_000);

    expect(await candado!.pidieronDetener()).toBe(true);

    await candado?.soltar();
  });

  it('una orden que quedó puesta no frena a la ronda siguiente de la misma conversación', async () => {
    const redis = redisDePrueba();
    // Sin renovación ni soltar: lo que queda de un proceso que murió después
    // de recibir la orden.
    const vieja = await tomar(redis, 'conversacion-1', { ttlMs: 60_000, renovarCadaMs: 10_000_000 });
    await detener(redis, 'conversacion-1');
    await vi.advanceTimersByTimeAsync(30_000);
    // La marca vive más que el candado de la muerta: la escribo a mano con su
    // token para simular que sobrevivió.
    const tokenViejo = await redis.get(claveDelCandado('conversacion-1'));
    await redis.set(claveDeDetener('conversacion-1'), tokenViejo!, { PX: 600_000 });
    await vi.advanceTimersByTimeAsync(31_000);

    const siguiente = await tomar(redis, 'conversacion-1');

    expect(siguiente).not.toBeNull();
    expect(await siguiente!.pidieronDetener()).toBe(false);

    await vieja?.soltar();
    await siguiente?.soltar();
  });

  it('al soltar el candado se borra la orden', async () => {
    const redis = redisDePrueba();
    const candado = await tomar(redis, 'conversacion-1');

    await detener(redis, 'conversacion-1');
    await candado?.soltar();

    expect(await redis.get(claveDeDetener('conversacion-1'))).toBeNull();
  });

  it('sin Redis, la orden no se puede dejar y la ronda sigue', async () => {
    const redis = redisDePrueba();
    const candado = await tomar(redis, 'conversacion-1');
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    redis.isReady = false;

    expect(await detener(redis, 'conversacion-1')).toBe('sin-redis');
    expect(await candado!.pidieronDetener()).toBe(false);

    redis.isReady = true;
    await candado?.soltar();
  });
});

describe('sin Redis, falla abierto', () => {
  it('con Redis caído o reconectando el chat anda como antes, sin candado', async () => {
    const redis = redisDePrueba();
    redis.isReady = false;
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const primera = await tomar(redis, 'conversacion-1');
    const segunda = await tomar(redis, 'conversacion-1');

    expect(primera).not.toBeNull();
    expect(segunda).not.toBeNull();
    // Ni un comando: con el cliente reconectando, cualquiera quedaría encolado
    // y colgaría el pedido del chat.
    expect(redis.set).not.toHaveBeenCalled();
    expect(await rondaViva(redis)).toBeNull();

    await primera?.soltar();
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('si Redis falla al tomarlo, también', async () => {
    const redis = redisDePrueba();
    redis.set.mockRejectedValueOnce(new Error('Redis se cayó'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await tomar(redis, 'conversacion-1')).not.toBeNull();
  });

  it('un Redis que no contesta al soltar no deja la respuesta abierta', async () => {
    const redis = redisDePrueba();
    const candado = await tomar(redis, 'conversacion-1');
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    redis.eval.mockImplementationOnce(() => new Promise(() => {}));

    let soltado = false;
    const soltando = candado!.soltar().then(() => {
      soltado = true;
    });

    await vi.advanceTimersByTimeAsync(3_100);
    await soltando;

    expect(soltado).toBe(true);
  });
});
