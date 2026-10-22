import { get } from 'svelte/store';
import { render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';

import { page } from '$app/state';
import { profile } from '$lib/utils/store/user';

/**
 * La página de una invitación, cuando se vuelve de crear la cuenta.
 *
 * Se volvía acá y había que apretar «Aceptar» OTRA vez. Quien cerraba la pestaña
 * en ese momento quedaba con una cuenta sin empresa, y con el registro sólo por
 * invitación nada lo volvía a meter en la suya. Ahora el registro y el inicio de
 * sesión vuelven con `?aceptar=1`, y la página acepta sola — si el correo es el
 * invitado y la invitación sigue vigente.
 */

const falso = vi.hoisted(() => ({ accept: vi.fn() }));

vi.mock('$lib/utils/services/api', async () => {
  const constantes = await vi.importActual<typeof import('$lib/utils/services/api/constants')>(
    '$lib/utils/services/api/constants'
  );
  const base = await vi.importActual<typeof import('$lib/utils/services/api/base.svelte')>(
    '$lib/utils/services/api/base.svelte'
  );

  return {
    ...constantes,
    BaseApi: base.BaseApi,
    BaseApiWithErrors: base.BaseApiWithErrors,
    getRequestBaseUrl: () => 'http://localhost/proxy',
    classroomio: { invite: { organization: { ':token': { accept: { $post: falso.accept } } } } }
  };
});

// «Cambiar de cuenta» no se prueba acá, y `logout` arrastra Sentry, que no
// resuelve fuera de SvelteKit.
vi.mock('$lib/utils/functions/logout', () => ({ logout: vi.fn() }));

const { default: Pagina } = await import('./+page.svelte');

const PERFIL_VACIO = get(profile);
const URL_ORIGINAL = page.url;

const datos = (estado = 'ACTIVE') => ({
  token: 'token-de-prueba',
  currentOrg: null,
  invite: {
    invite: { status: estado, email: 'ana@ejemplo.test', roleId: 3 },
    organization: { name: 'Empresa cliente', siteName: 'cliente' }
  }
});

function volverA(camino: string, email?: string) {
  page.url = new URL(`http://localhost${camino}`);
  if (email) profile.set({ ...PERFIL_VACIO, id: 'persona-1', email });
}

beforeEach(() => {
  falso.accept.mockResolvedValue(
    new Response(JSON.stringify({ success: true, data: { redirectTo: '/lms' } }), { status: 200 })
  );
});

afterEach(() => {
  vi.clearAllMocks();
  profile.set(PERFIL_VACIO);
  page.url = URL_ORIGINAL;
});

describe('volver de crear la cuenta', () => {
  it('con la marca y el correo invitado, acepta sola', async () => {
    volverA('/invite/token-de-prueba?aceptar=1', 'ana@ejemplo.test');

    render(Pagina, { props: { data: datos() as never } });

    await waitFor(() => expect(falso.accept).toHaveBeenCalledTimes(1));
    expect(falso.accept.mock.calls[0][0]).toEqual({ param: { token: 'token-de-prueba' } });
  });

  it('espera a que llegue la sesión, que se carga después de montar', async () => {
    volverA('/invite/token-de-prueba?aceptar=1');

    render(Pagina, { props: { data: datos() as never } });
    await tick();
    expect(falso.accept).not.toHaveBeenCalled();

    profile.set({ ...PERFIL_VACIO, id: 'persona-1', email: 'ana@ejemplo.test' });

    await waitFor(() => expect(falso.accept).toHaveBeenCalledTimes(1));
  });

  it('sin la marca, espera el botón como siempre', async () => {
    volverA('/invite/token-de-prueba', 'ana@ejemplo.test');

    render(Pagina, { props: { data: datos() as never } });
    await tick();

    expect(falso.accept).not.toHaveBeenCalled();
  });

  it('con otro correo no intenta nada: su cartel ya explica por qué', async () => {
    volverA('/invite/token-de-prueba?aceptar=1', 'otra@ejemplo.test');
    render(Pagina, { props: { data: datos() as never } });
    await tick();

    expect(falso.accept).not.toHaveBeenCalled();
  });

  it('con la invitación vencida no intenta nada', async () => {
    volverA('/invite/token-de-prueba?aceptar=1', 'ana@ejemplo.test');
    render(Pagina, { props: { data: datos('EXPIRED') as never } });
    await tick();

    expect(falso.accept).not.toHaveBeenCalled();
  });
});
