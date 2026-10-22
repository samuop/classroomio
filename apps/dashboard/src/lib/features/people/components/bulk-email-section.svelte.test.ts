import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

import BulkEmailSection from './bulk-email-section.svelte';

/**
 * El cuadro para invitar alumnos por correo, montado.
 *
 * Vaciaba la lista SIEMPRE después de mandarla, saliera bien o mal: con un
 * correo mal escrito no se invitaba a nadie, la lista desaparecía y no se
 * mostraba ningún error. Ahora se vacía sólo si salió bien, y el motivo de la
 * falla queda escrito debajo de la lista.
 */

const LISTA = 'ana@ejemplo.test, beto@ejemplo';

async function mandar(onInvite: (csv: string, sendEmail: boolean) => unknown) {
  render(BulkEmailSection, { props: { onInvite: onInvite as never } });

  const cuadro = screen.getByRole('textbox') as HTMLTextAreaElement;
  await fireEvent.input(cuadro, { target: { value: LISTA } });
  await fireEvent.click(screen.getByRole('button'));

  return cuadro;
}

describe('invitar alumnos por correo', () => {
  it('si falla, la lista queda y el motivo se ve', async () => {
    const onInvite = vi.fn(async () => 'No se invitó a nadie: hay correos mal escritos (beto@ejemplo).');

    const cuadro = await mandar(onInvite);

    await waitFor(() => expect(onInvite).toHaveBeenCalledWith(LISTA, true));
    expect(await screen.findByText('No se invitó a nadie: hay correos mal escritos (beto@ejemplo).')).toBeInTheDocument();
    expect(cuadro.value).toBe(LISTA);
  });

  it('si falla sin motivo, la lista queda igual', async () => {
    const cuadro = await mandar(vi.fn(async () => false));

    await waitFor(() => expect(screen.getByRole('button')).not.toBeDisabled());
    expect(cuadro.value).toBe(LISTA);
  });

  it('si sale bien, la lista se vacía', async () => {
    const cuadro = await mandar(vi.fn(async () => true));

    await waitFor(() => expect(cuadro.value).toBe(''));
  });
});
