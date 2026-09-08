/**
 * Crear una empresa hija: que un rechazo se vea.
 *
 * El bug que esto fija no era la validación —esa andaba— sino lo que quedaba
 * DESPUÉS de rechazar. `createWorkspace` volvía temprano sin tocar `success`, y
 * `success` venía en `true` del listado que la pantalla hace al abrirse. Quien
 * llama leía ese éxito viejo, cerraba el diálogo, y el mensaje de error se iba
 * adentro del diálogo que acababa de cerrarse.
 *
 * Para la persona: apretás el botón, se cierra todo, no se creó nada y nadie
 * dice por qué. Pasó en producción y costó una tarde.
 *
 * Por eso el test central no mira el mensaje: mira `success` después de un
 * rechazo. El mensaje se puede mostrar de diez formas distintas; el éxito viejo
 * es lo que hace desaparecer cualquiera de ellas.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/utils/functions/translations', () => ({
  t: { get: (clave: string) => clave }
}));

vi.mock('$lib/components/Snackbar/store', () => ({
  snackbar: { success: vi.fn(), error: vi.fn() }
}));

const { accountApi } = await import('./account.svelte');

beforeEach(() => {
  accountApi.reset();
});

/** El estado con el que la pantalla llega al diálogo: ya listó los espacios. */
function comoLlegaLaPantalla() {
  accountApi.success = true;
  accountApi.errors = {};
}

describe('un nombre demasiado corto', () => {
  it('NO deja el éxito del pedido anterior', async () => {
    comoLlegaLaPantalla();

    await accountApi.createWorkspace({ name: 'AB', siteName: 'empresa-nueva' });

    // Si esto es `true`, el diálogo se cierra y el error no llega a verse.
    expect(accountApi.success).toBe(false);
  });

  it('deja dicho cuál campo está mal', async () => {
    comoLlegaLaPantalla();

    await accountApi.createWorkspace({ name: 'AB', siteName: 'empresa-nueva' });

    expect(accountApi.errors.name).toBeTruthy();
    expect(accountApi.errors.siteName).toBeUndefined();
  });
});

describe('el mínimo del nombre', () => {
  it('acepta tres caracteres, igual que la dirección', async () => {
    comoLlegaLaPantalla();

    // "ONE!" tiene cuatro y lo rechazaba: el mínimo era 5 y venía heredado del
    // proyecto original, más estricto que el del campo que sí es un host.
    await accountApi.createWorkspace({ name: 'ONE', siteName: 'one' });

    expect(accountApi.errors.name).toBeUndefined();
  });

  it('no cuenta los espacios de los bordes como caracteres', async () => {
    comoLlegaLaPantalla();

    await accountApi.createWorkspace({ name: '     ', siteName: 'empresa-nueva' });

    expect(accountApi.errors.name).toBeTruthy();
  });
});

describe('una dirección que no sirve como host', () => {
  it('rechaza los espacios en el medio y lo dice en el campo de la dirección', async () => {
    comoLlegaLaPantalla();

    await accountApi.createWorkspace({ name: 'Ferretería Central', siteName: 'ferreteria central' });

    expect(accountApi.errors.siteName).toBeTruthy();
    expect(accountApi.success).toBe(false);
  });
});
