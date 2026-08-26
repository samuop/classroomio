import { render, screen } from '@testing-library/svelte';

import UsageSummaryCards from './usage-summary-cards.svelte';
import { defaultUserState, user } from '$lib/utils/store/user';
import type { AiUsageData } from '$features/settings/utils/types';

/**
 * Que la empresa NO vea cuántas fichas consume.
 *
 * Es una regla de visibilidad: cuando falla no se rompe nada ni salta ningún
 * error — simplemente aparece un número que no tenía que aparecer. La única
 * forma de verificarla es mirar lo que la pantalla dibuja de verdad.
 */

const USADO = 3_240_000;
const CUPO = 8_000_000;

const uso = {
  used: USADO,
  allowance: CUPO,
  history: [],
  requestsThisMonth: 12
} as unknown as AiUsageData;

/** Las dos cifras, en cualquier formato que las pinte el navegador. */
function cifrasEnPantalla(html: string): string[] {
  return [USADO, CUPO]
    .flatMap((n) => [n.toLocaleString('es-AR'), n.toLocaleString('en-US'), String(n)])
    .filter((texto) => html.includes(texto));
}

function entrarComo(esSuperAdmin: boolean) {
  user.set({
    ...defaultUserState,
    isLoggedIn: true,
    fetchingUser: false,
    currentSession: (esSuperAdmin ? { role: 'platformAdmin' } : { role: null }) as never
  });
}

afterEach(() => {
  user.set(defaultUserState);
});

describe('tarjeta de consumo de IA', () => {
  it('a una empresa le muestra el porcentaje y NINGUNA de las dos cifras', () => {
    entrarComo(false);

    const { container } = render(UsageSummaryCards, { props: { usage: uso, purchased: null } });

    expect(container.textContent).toContain('41%');
    // El cupo también se controla: con el porcentaje y el cupo a la vista, lo
    // consumido se despeja con una división.
    expect(cifrasEnPantalla(container.textContent ?? '')).toEqual([]);
  });

  it('al super-admin de la plataforma sí le muestra los números', () => {
    entrarComo(true);

    const { container } = render(UsageSummaryCards, { props: { usage: uso, purchased: null } });

    expect(cifrasEnPantalla(container.textContent ?? '').length).toBeGreaterThan(0);
  });

  it('sin cupo definido no muestra nada, en vez de caer al número', () => {
    // El caso que filtraría el dato: si al no haber cupo la pantalla volviera a
    // mostrar fichas, bastaría con no configurarle cupo a una empresa.
    entrarComo(false);

    const sinCupo = { ...uso, allowance: 0 } as AiUsageData;
    const { container } = render(UsageSummaryCards, { props: { usage: sinCupo, purchased: null } });

    expect(cifrasEnPantalla(container.textContent ?? '')).toEqual([]);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
