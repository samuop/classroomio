import { get } from 'svelte/store';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';

import Pagina from './+page.svelte';
import { currentOrg } from '$lib/utils/store/org';
import { emailsApi } from '$features/emails';

/**
 * La pantalla de Correos, montada.
 *
 * El segundo error con el que salió esta pantalla: al recargarla en frío, el
 * pedido salía **antes** de que se supiera en qué empresa estaba la persona.
 * El cliente de la API arma el encabezado `cio-org-id` leyendo `currentOrg` en
 * el momento del pedido, y ese store lo llena el arranque de la app, que es
 * asincrónico. Resultado en producción: 400 `ORG_ID_REQUIRED` y una pantalla
 * que decía "no se pudieron cargar los correos".
 *
 * Nada de esto se puede ver sin montar el componente: el error no está en
 * ninguna función, está en *cuándo* corre.
 */

const EMPRESA_VACIA = get(currentOrg);

let fetchAll: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // El store es un singleton del módulo: sin devolverlo al estado inicial, el
  // primer test le dejaría la empresa puesta al segundo y "recarga en frío"
  // dejaría de significar nada.
  currentOrg.set(EMPRESA_VACIA);
  fetchAll = vi.spyOn(emailsApi, 'fetchAll').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  currentOrg.set(EMPRESA_VACIA);
});

function elegirEmpresa(id = 'org-1') {
  currentOrg.set({ ...EMPRESA_VACIA, id, siteName: 'empresa-de-prueba', name: 'Empresa de prueba' });
}

describe('pantalla de Correos', () => {
  it('no pide nada mientras no se sepa en qué empresa estamos', async () => {
    render(Pagina);
    await tick();

    expect(fetchAll).not.toHaveBeenCalled();
  });

  it('muestra "cargando" en vez de un error mientras espera a la empresa', async () => {
    render(Pagina);
    await tick();

    // Sin esto la pantalla parpadea vacía, que se lee como rota.
    expect(screen.getByText('Cargando los correos…')).toBeInTheDocument();
  });

  it('pide los correos apenas llega la empresa', async () => {
    render(Pagina);
    await tick();

    elegirEmpresa();
    await tick();

    expect(fetchAll).toHaveBeenCalledTimes(1);
  });

  it('no vuelve a pedirlos cada vez que el store de la empresa cambia', async () => {
    render(Pagina);
    await tick();

    elegirEmpresa();
    await tick();

    // El arranque de la app escribe `currentOrg` más de una vez (plan, equipo,
    // personalización). Sin la bandera, cada escritura dispararía otro pedido.
    currentOrg.update((org) => ({ ...org, name: 'Nombre nuevo' }));
    await tick();
    currentOrg.update((org) => ({ ...org, avatarUrl: '/logo.png' }));
    await tick();

    expect(fetchAll).toHaveBeenCalledTimes(1);
  });
});
