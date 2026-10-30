/**
 * Una sala entera registrándose a la vez desde el mismo wifi.
 *
 * Todos comparten una IP, y el límite de fábrica de Better Auth (3 cada 10 s)
 * le daba 429 al cuarto. Esto corre la librería REAL —en memoria, sin base— con
 * el límite que usa la aplicación, y la misma librería con el de fábrica como
 * control: si el control no ve el 429, el test no estaría midiendo nada.
 *
 * Better Auth es dependencia de @cio/db, no de la API: se carga desde ahí.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { AUTH_RATE_LIMIT } from '@cio/db/auth/rate-limit';

const desdeLaApi = createRequire(import.meta.url);
const desdeDb = createRequire(desdeLaApi.resolve('@cio/db/auth/rate-limit'));
const cargar = (modulo: string) => import(pathToFileURL(desdeDb.resolve(modulo)).href);

const { betterAuth } = await cargar('better-auth/minimal');
const { memoryAdapter } = await cargar('better-auth/adapters/memory');

const IP_DE_LA_SALA = '203.0.113.10';

function armarAuth(rateLimit: Record<string, unknown>) {
  return betterAuth({
    baseURL: 'http://localhost:3002',
    secret: 'secreto-de-prueba-de-al-menos-32-caracteres',
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    emailAndPassword: { enabled: true },
    rateLimit: { ...rateLimit, enabled: true },
    logger: { disabled: true }
  });
}

function pedido(ruta: string, cuerpo: object, ip = IP_DE_LA_SALA) {
  return new Request(`http://localhost:3002/api/auth${ruta}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, origin: 'http://localhost:3002' },
    body: JSON.stringify(cuerpo)
  });
}

async function registrar(auth: ReturnType<typeof armarAuth>, cantidad: number, ip = IP_DE_LA_SALA) {
  const estados: number[] = [];
  for (let n = 0; n < cantidad; n++) {
    const res = await auth.handler(
      pedido('/sign-up/email', { email: `alumno${n}@ejemplo.test`, password: 'clave-segura-123', name: `Alumno ${n}` }, ip)
    );
    estados.push(res.status);
  }
  return estados;
}

async function ingresar(auth: ReturnType<typeof armarAuth>, cantidad: number) {
  const estados: number[] = [];
  for (let n = 0; n < cantidad; n++) {
    const res = await auth.handler(pedido('/sign-in/email', { email: `alumno${n}@ejemplo.test`, password: 'mal-escrita' }));
    estados.push(res.status);
  }
  return estados;
}

// Cada registro hashea una contraseña (scrypt): 40 seguidos tardan más que el plazo por defecto.
describe('registro de una sala desde la misma IP', { timeout: 120_000 }, () => {
  it('control: con el límite de fábrica, el cuarto registro ya recibe 429', async () => {
    const estados = await registrar(armarAuth({}), 5);

    expect(estados.slice(0, 3).every((s) => s === 200)).toBe(true);
    expect(estados[3]).toBe(429);
  });

  it('con el límite de la aplicación, 40 alumnos se registran seguidos sin ningún 429', async () => {
    const estados = await registrar(armarAuth(AUTH_RATE_LIMIT), 40);

    expect(estados.filter((s) => s === 429)).toHaveLength(0);
    expect(estados.every((s) => s === 200)).toBe(true);
  });

  it('40 ingresos seguidos (con contraseñas mal escritas incluidas) tampoco reciben 429', async () => {
    const estados = await ingresar(armarAuth(AUTH_RATE_LIMIT), 40);

    expect(estados.filter((s) => s === 429)).toHaveLength(0);
  });

  it('el ingreso sigue limitado: quien prueba contraseñas desde una IP termina frenado', async () => {
    const estados = await ingresar(armarAuth(AUTH_RATE_LIMIT), 55);

    expect(estados.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});
