import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { formatDisplayDateTime, instanteDelServidor } from './date';

/**
 * Las horas que el servidor manda sin zona, en la pantalla.
 *
 * El historial de versiones de una lección mostraba la hora UTC como si fuera
 * la argentina: una versión guardada a las 15:51 aparecía a las 18:51. La
 * columna es un `timestamp` sin zona y llega como "2026-09-29 18:51:23.123456";
 * `new Date` lo leía como hora local.
 *
 * La máquina de estos tests se pone en hora argentina, como la de la docente:
 * con el reloj en UTC —el de CI— leer como local o como UTC da lo mismo y el
 * defecto no se ve.
 */
process.env.TZ = 'America/Argentina/Buenos_Aires';

describe('instanteDelServidor', () => {
  it('la máquina de la prueba está en hora argentina', () => {
    expect(new Date(2026, 8, 29).getTimezoneOffset()).toBe(180);
  });

  it('lee como UTC la hora que llega sin zona, con microsegundos', () => {
    expect(instanteDelServidor('2026-09-29 18:51:23.123456').toISOString()).toBe('2026-09-29T18:51:23.123Z');
    expect(instanteDelServidor('2026-09-29 18:51:23').toISOString()).toBe('2026-09-29T18:51:23.000Z');
  });

  it('respeta la zona cuando viene, y deja pasar una fecha ya hecha', () => {
    expect(instanteDelServidor('2026-09-29T18:51:23Z').toISOString()).toBe('2026-09-29T18:51:23.000Z');
    expect(instanteDelServidor('2026-09-29T15:51:23-03:00').toISOString()).toBe('2026-09-29T18:51:23.000Z');

    const fecha = new Date('2026-09-29T18:51:23Z');
    expect(instanteDelServidor(fecha).getTime()).toBe(fecha.getTime());
  });

  it('en pantalla sale la hora argentina', () => {
    expect(formatDisplayDateTime(instanteDelServidor('2026-09-29 18:51:23').toISOString())).toMatch(/, 15:51$/);
  });
});

describe('el historial de versiones', () => {
  it('lee la hora de cada versión como UTC, y no con new Date', () => {
    const componente = readFileSync(
      fileURLToPath(new URL('../../features/course/components/lesson/lesson-version-history.svelte', import.meta.url)),
      'utf8'
    );

    expect(componente).toMatch(/timestamp: item\.timestamp \? instanteDelServidor\(item\.timestamp\)/);
    expect(componente).not.toMatch(/new Date\(item\.timestamp\)/);
  });
});
