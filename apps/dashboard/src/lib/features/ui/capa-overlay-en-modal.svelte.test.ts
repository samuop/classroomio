import { render } from '@testing-library/svelte';

import SelectoEnModal from './__fixtures__/selecto-en-modal.svelte';
import SelectoSuelto from './__fixtures__/selecto-suelto.svelte';

/**
 * Un desplegable abierto DENTRO de un modal tiene que quedar por encima del modal.
 *
 * Esto no se ve como un error: la lista existe, el lector de pantalla la
 * encuentra, Playwright la da por "visible" — y en pantalla no hay nada, porque
 * se dibuja detras del panel. El sintoma que llega es "el boton no hace nada".
 * Roto asi estuvieron TODOS los modales con un select: invitar tutores a un
 * curso y a un programa entre ellos.
 *
 * Se comprueba la clase de capa y no el pixel porque jsdom no compone capas: no
 * hay forma de preguntarle quien tapa a quien. La clase ES la decision.
 */

/** La capa efectiva del contenido del select, sea cual sea el resto de clases. */
function capaDelDesplegable(contenedor: HTMLElement): string | null {
  const contenido =
    contenedor.ownerDocument.querySelector('[data-slot="select-content"]') ??
    contenedor.querySelector('[data-slot="select-content"]');

  if (!contenido) return null;

  return [...contenido.classList].find((clase) => clase.includes('z-1') || clase.includes('z-2')) ?? null;
}

describe('capa de un desplegable', () => {
  it('sube a 250 cuando vive dentro de un modal', async () => {
    const { container } = render(SelectoEnModal);

    expect(capaDelDesplegable(container as HTMLElement)).toBe('ui:z-250');
  });

  it('se queda en 150 cuando no hay modal', async () => {
    const { container } = render(SelectoSuelto);

    expect(capaDelDesplegable(container as HTMLElement)).toBe('ui:z-150');
  });
});
