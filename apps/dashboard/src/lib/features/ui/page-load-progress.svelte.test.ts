import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { vi } from 'vitest';

import PageLoadProgress from './page-load-progress.svelte';

/**
 * La barra de carga cuando una navegación pisa a otra.
 *
 * En un celular lento, tocar un segundo enlace antes de que cargue el primero
 * arranca otra navegación, y SvelteKit rechaza el `complete` de la vieja con
 * «navigation aborted». Medido en producción el 2026-10-31: 82 de los 85 errores
 * de pantalla de tres días eran ese rechazo, de alumnos entrando desde el
 * teléfono. La barra lo dejaba sin atender (`.catch()` sin función) y, peor,
 * cerraba la barra de la navegación NUEVA mientras todavía cargaba.
 */

const falso = vi.hoisted(() => ({
  antesDeNavegar: null as null | ((nav: unknown) => void)
}));

vi.mock('$app/navigation', () => ({
  beforeNavigate: (callback: (nav: unknown) => void) => {
    falso.antesDeNavegar = callback;
  }
}));

/** Una navegación interna cuyo final decide el test. */
function navegacion() {
  let terminar!: () => void;
  let abortar!: () => void;
  const complete = new Promise<void>((resolve, reject) => {
    terminar = resolve;
    abortar = () => reject(new Error('navigation aborted'));
  });
  // Como SvelteKit: atiende su propia promesa para que no quede suelta.
  complete.catch(() => {});

  return { nav: { to: { route: { id: '/courses/[id]/lessons' } }, complete }, terminar, abortar };
}

/** Si la barra está avanzando: dibujada y sin haber llegado al final. */
const barraCorriendo = () => screen.queryByRole('progressbar')?.classList.contains('running') ?? false;

/** Deja correr las promesas encadenadas y el aviso de rechazo sin atender. */
const asentar = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await tick();
};

const sinAtender: unknown[] = [];
const anotarSinAtender = (motivo: unknown) => sinAtender.push(motivo);

beforeEach(() => {
  sinAtender.length = 0;
  process.on('unhandledRejection', anotarSinAtender);
});

afterEach(() => {
  process.off('unhandledRejection', anotarSinAtender);
});

describe('una navegación pisada por otra', () => {
  it('no deja un rechazo sin atender', async () => {
    render(PageLoadProgress, { displayThresholdMs: 0, settleTime: 0 });
    const primera = navegacion();
    const segunda = navegacion();

    falso.antesDeNavegar!(primera.nav);
    falso.antesDeNavegar!(segunda.nav);
    primera.abortar();
    await asentar();

    expect(sinAtender).toEqual([]);
  });

  it('deja la barra corriendo hasta que termine la navegación nueva', async () => {
    render(PageLoadProgress, { displayThresholdMs: 0, settleTime: 0 });
    const primera = navegacion();
    const segunda = navegacion();

    falso.antesDeNavegar!(primera.nav);
    falso.antesDeNavegar!(segunda.nav);
    await tick();
    expect(barraCorriendo()).toBe(true);

    primera.abortar();
    await asentar();
    // La página nueva todavía está cargando: la barra tiene que seguir.
    expect(barraCorriendo()).toBe(true);

    segunda.terminar();
    await asentar();
    expect(barraCorriendo()).toBe(false);
  });
});

describe('una navegación sola', () => {
  it('cierra la barra al terminar, y también si se cancela', async () => {
    render(PageLoadProgress, { displayThresholdMs: 0, settleTime: 0 });
    const terminada = navegacion();

    falso.antesDeNavegar!(terminada.nav);
    await tick();
    expect(barraCorriendo()).toBe(true);
    terminada.terminar();
    await asentar();
    expect(barraCorriendo()).toBe(false);

    const cancelada = navegacion();
    falso.antesDeNavegar!(cancelada.nav);
    await tick();
    expect(barraCorriendo()).toBe(true);
    cancelada.abortar();
    await asentar();
    expect(barraCorriendo()).toBe(false);
    expect(sinAtender).toEqual([]);
  });
});
