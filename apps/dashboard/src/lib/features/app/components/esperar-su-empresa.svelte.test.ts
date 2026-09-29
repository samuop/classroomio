import { get } from 'svelte/store';
import { createRawSnippet, flushSync } from 'svelte';
import { render, screen } from '@testing-library/svelte';

import EsperarSuEmpresa from './esperar-su-empresa.svelte';
import { ROLE } from '@cio/utils/constants';
import { appInitApi } from '$features/app/init.svelte';
import { basePath } from '$lib/utils/store/app';
import { currentOrg } from '$lib/utils/store/org';

// init.svelte.ts arrastra Sentry, que importa `$app/stores` de SvelteKit: acá
// no existe y no hace falta, porque lo que se prueba es la espera, no el aviso.
vi.mock('$lib/utils/services/sentry', () => ({ setSentryUser: vi.fn() }));

/**
 * Entrar en frío, con sesión.
 *
 * El orden real: antes de que llegue la cuenta, `currentOrg` es la dueña del
 * dominio (sin rol) o, fuera del dominio de una empresa, la empresa vacía. Una
 * pantalla que se monta en ese hueco pide sus datos con la empresa equivocada
 * o arma sus enlaces con un camino base '#'.
 */

const EMPRESA_VACIA = get(currentOrg);
const DUENA_DEL_DOMINIO = { ...EMPRESA_VACIA, id: 'consultora', siteName: 'consultora', roleId: undefined as never };
const SU_EMPRESA = { ...EMPRESA_VACIA, id: 'empresa-cliente', siteName: 'empresa-cliente', roleId: ROLE.ADMIN };

let montadaCon: { id: string; basePath: string }[] = [];

const pantalla = createRawSnippet(() => ({
  render: () => '<p>pantalla</p>',
  setup: () => {
    montadaCon.push({ id: get(currentOrg).id, basePath: get(basePath) });
  }
}));

/** Lo que hace setupApp al recibir la cuenta: guarda los datos y pone la empresa. */
function llegaLaCuenta() {
  appInitApi.data = { success: true } as never;
  currentOrg.set(SU_EMPRESA);
  flushSync();
}

beforeEach(() => {
  montadaCon = [];
  appInitApi.data = null;
  appInitApi.error = null;
});

afterEach(() => {
  currentOrg.set(EMPRESA_VACIA);
  appInitApi.data = null;
  appInitApi.error = null;
});

describe('EsperarSuEmpresa', () => {
  it('en el dominio de una consultora, la pantalla se monta recién con la empresa de la persona', () => {
    currentOrg.set(DUENA_DEL_DOMINIO);
    render(EsperarSuEmpresa, { props: { conSesion: true, children: pantalla } });

    expect(screen.queryByText('pantalla')).not.toBeInTheDocument();

    llegaLaCuenta();

    expect(screen.getByText('pantalla')).toBeInTheDocument();
    expect(montadaCon).toEqual([{ id: 'empresa-cliente', basePath: '/org/empresa-cliente' }]);
  });

  it('en el dominio de la plataforma, no se monta con la empresa vacía y el camino base en «#»', () => {
    render(EsperarSuEmpresa, { props: { conSesion: true, children: pantalla } });

    expect(screen.queryByText('pantalla')).not.toBeInTheDocument();

    llegaLaCuenta();

    expect(montadaCon).toEqual([{ id: 'empresa-cliente', basePath: '/org/empresa-cliente' }]);
  });

  it('si la cuenta falla, no deja la pantalla colgada en la espera', () => {
    currentOrg.set(DUENA_DEL_DOMINIO);
    render(EsperarSuEmpresa, { props: { conSesion: true, children: pantalla } });

    appInitApi.error = 'fallo';
    flushSync();

    expect(screen.getByText('pantalla')).toBeInTheDocument();
  });

  it('sin sesión no espera a nadie', () => {
    render(EsperarSuEmpresa, { props: { conSesion: false, children: pantalla } });
    expect(screen.getByText('pantalla')).toBeInTheDocument();
  });
});
