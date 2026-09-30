import { vi } from 'vitest';

import { PEDIR_DETENER, RENOVAR_SI_ES_MIO, SOLTAR_SI_ES_MIO } from '@api/services/agent/ronda-viva';

/**
 * Un Redis de mentira para el candado de la ronda del chat.
 *
 * Vence las claves con `Date.now()`, así que con los timers falsos de vitest
 * el tiempo se adelanta a mano; y corre los scripts del candado con la misma
 * regla que su Lua: renovar o soltar sólo si el valor sigue siendo el token de
 * quien lo pide, y la marca de «Detener» sólo con el token de la ronda viva.
 * Tiene sólo los comandos que el candado usa: si un cambio empieza a usar otro,
 * el test se entera porque el comando no existe.
 */

type Entrada = { valor: string; vence?: number };
type Hash = { campos: Map<string, string>; vence?: number };

export function redisDePrueba() {
  const valores = new Map<string, Entrada>();
  const hashes = new Map<string, Hash>();
  const vivo = (vence?: number) => vence === undefined || vence > Date.now();

  const leer = (clave: string) => {
    const entrada = valores.get(clave);
    return entrada && vivo(entrada.vence) ? entrada.valor : null;
  };

  const hash = (clave: string) => {
    const actual = hashes.get(clave);

    if (actual && vivo(actual.vence)) return actual;

    const nuevo: Hash = { campos: new Map() };
    hashes.set(clave, nuevo);
    return nuevo;
  };

  return {
    isReady: true,
    set: vi.fn(async (clave: string, valor: string, opciones?: { NX?: boolean; PX?: number }) => {
      if (opciones?.NX && leer(clave) !== null) return null;

      valores.set(clave, { valor, vence: opciones?.PX ? Date.now() + opciones.PX : undefined });
      return 'OK';
    }),
    get: vi.fn(async (clave: string) => leer(clave)),
    del: vi.fn(async (clave: string) => (valores.delete(clave) ? 1 : 0)),
    hSet: vi.fn(async (clave: string, campo: string, valor: string) => {
      hash(clave).campos.set(campo, valor);
      return 1;
    }),
    hGetAll: vi.fn(async (clave: string) => Object.fromEntries(hash(clave).campos)),
    pExpire: vi.fn(async (clave: string, ms: number) => {
      const entrada = valores.get(clave) ?? hashes.get(clave);
      if (entrada) entrada.vence = Date.now() + ms;
      return entrada ? 1 : 0;
    }),
    eval: vi.fn(async (script: string, { keys, arguments: args }: { keys: string[]; arguments: string[] }) => {
      if (script === PEDIR_DETENER) {
        const [candado, marca] = keys;
        const token = leer(candado);

        if (token === null) return 0;
        valores.set(marca, { valor: token, vence: Date.now() + Number(args[0]) });
        return 1;
      }

      const [candado, indice, marca] = keys;

      if (script === RENOVAR_SI_ES_MIO) {
        if (leer(candado) !== args[0]) return 0;
        valores.get(candado)!.vence = Date.now() + Number(args[1]);
        hash(indice).campos.set(args[2], args[3]);
        hashes.get(indice)!.vence = Date.now() + Number(args[1]);
        if (marca && leer(marca) === args[0]) valores.get(marca)!.vence = Date.now() + Number(args[1]);
        return 1;
      }

      if (script === SOLTAR_SI_ES_MIO) {
        if (leer(candado) !== args[0]) return 0;
        valores.delete(candado);
        hash(indice).campos.delete(args[1]);
        if (marca && leer(marca) === args[0]) valores.delete(marca);
        return 1;
      }

      throw new Error('script desconocido');
    })
  };
}

export type RedisDePrueba = ReturnType<typeof redisDePrueba>;
