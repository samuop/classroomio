/**
 * Con qué nombre se firma cada correo.
 *
 * La regla no es "el nombre de la empresa": es **el de su consultora**. Una
 * alumna de una empresa cliente está recibiendo la formación de la consultora
 * que se la entrega, no de su propio empleador, y además es el nombre que
 * coincide con el dominio del remitente: un correo firmado con el nombre de la
 * empresa cliente pero saliendo del dominio de la consultora le da a cualquiera
 * la sensación de suplantación.
 *
 * Una empresa sin madre se firma a sí misma, y por eso el nivel superior del
 * despliegue sigue firmando con su propio nombre.
 *
 * La regla sale de la jerarquía y no de una lista de nombres: sumar una
 * consultora nueva con sus clientes no toca ningún archivo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getRootOrganizationName = vi.fn();

vi.mock('@cio/db/queries/organization', () => ({
  getRootOrganizationName: (...args: unknown[]) => getRootOrganizationName(...(args as [])),
  getOrgNotificationSettings: vi.fn(),
  getOrganizationById: vi.fn(),
  updateOrganization: vi.fn()
}));

const { clearSenderNameCache, resolveSenderName } = await import('@api/services/organization/sender-name');
const { EMAIL_BRAND_NAME } = await import('@cio/email');

const CONSULTORA = 'org-consultora';
const CLIENTE = 'org-cliente';
const RAIZ_PROPIA = 'org-raiz-propia';

beforeEach(() => {
  clearSenderNameCache();
  getRootOrganizationName.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('resolveSenderName', () => {
  it('firma con el nombre de la consultora, no con el de la empresa cliente', () => {
    // El caso que motivó la regla.
    getRootOrganizationName.mockResolvedValue('Consultora Norte');

    return expect(resolveSenderName(CLIENTE)).resolves.toBe('Consultora Norte');
  });

  it('una empresa sin madre se firma a sí misma', async () => {
    // El nivel superior del despliegue es su propia raíz.
    getRootOrganizationName.mockResolvedValue('Marca Propia');

    await expect(resolveSenderName(RAIZ_PROPIA)).resolves.toBe('Marca Propia');
  });

  it('sin empresa cae en la marca del despliegue', async () => {
    await expect(resolveSenderName(null)).resolves.toBe(EMAIL_BRAND_NAME);
    await expect(resolveSenderName(undefined)).resolves.toBe(EMAIL_BRAND_NAME);
    await expect(resolveSenderName('')).resolves.toBe(EMAIL_BRAND_NAME);

    // Ni siquiera pregunta a la base cuando no hay a quién preguntar por.
    expect(getRootOrganizationName).not.toHaveBeenCalled();
  });

  it('cae en la marca si la raíz no tiene nombre', async () => {
    getRootOrganizationName.mockResolvedValue(null);

    await expect(resolveSenderName(CONSULTORA)).resolves.toBe(EMAIL_BRAND_NAME);
  });

  it('cae en la marca si el nombre es sólo espacios', async () => {
    // Un `"" <casilla@dominio>` deja el correo sin firma visible.
    getRootOrganizationName.mockResolvedValue('   ');

    await expect(resolveSenderName(CONSULTORA)).resolves.toBe(EMAIL_BRAND_NAME);
  });

  it('NO tumba el envío si la consulta se cae', async () => {
    // Esto corre dentro del camino de un correo: un throw acá lo perdería. Un
    // correo firmado con la marca del despliegue es muchísimo mejor que ninguno.
    getRootOrganizationName.mockRejectedValue(new Error('la base dijo que no'));

    await expect(resolveSenderName(CONSULTORA)).resolves.toBe(EMAIL_BRAND_NAME);
  });
});

describe('el caché', () => {
  it('pregunta una sola vez para un envío masivo', async () => {
    getRootOrganizationName.mockResolvedValue('Consultora Norte');

    await resolveSenderName(CLIENTE);
    await resolveSenderName(CLIENTE);
    await resolveSenderName(CLIENTE);

    expect(getRootOrganizationName).toHaveBeenCalledTimes(1);
  });

  it('no mezcla empresas distintas', async () => {
    // Un caché por proceso sin clave por empresa firmaría los correos de una
    // consultora con el nombre de otra, que es el peor error posible acá.
    getRootOrganizationName.mockImplementation(async (id: string) =>
      id === CLIENTE ? 'Consultora Norte' : 'Marca Propia'
    );

    await expect(resolveSenderName(CLIENTE)).resolves.toBe('Consultora Norte');
    await expect(resolveSenderName(RAIZ_PROPIA)).resolves.toBe('Marca Propia');
  });

  it('vuelve a preguntar cuando vence, para que un renombre llegue solo', async () => {
    vi.useFakeTimers();
    getRootOrganizationName.mockResolvedValue('Nombre Viejo');
    await resolveSenderName(CLIENTE);

    getRootOrganizationName.mockResolvedValue('Nombre Nuevo');
    vi.advanceTimersByTime(11 * 60 * 1000);

    await expect(resolveSenderName(CLIENTE)).resolves.toBe('Nombre Nuevo');
  });

  it('no cachea el fallo: el próximo correo vuelve a intentar', async () => {
    // Guardar la marca por defecto tras un error dejaría a toda una consultora
    // firmando mal durante diez minutos por un hipo de la base.
    getRootOrganizationName.mockRejectedValueOnce(new Error('hipo'));
    await expect(resolveSenderName(CLIENTE)).resolves.toBe(EMAIL_BRAND_NAME);

    getRootOrganizationName.mockResolvedValue('Consultora Norte');
    await expect(resolveSenderName(CLIENTE)).resolves.toBe('Consultora Norte');
  });
});
