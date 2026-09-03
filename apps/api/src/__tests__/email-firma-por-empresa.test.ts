/**
 * Que el correo se firme con el nombre de la consultora SIN que cada punto de
 * envío tenga que acordarse.
 *
 * `resolveSenderName` existía y funcionaba — y aun así tres correos salían mal
 * firmados (`inviteTeacher`, `programGoalReminder`, `welcome`), porque había que
 * llamarlo a mano en cada sitio. Sin `from`, el envío cae a `SMTP_SENDER`, que
 * es el nombre del DESPLIEGUE: una invitación de una empresa cliente salía con
 * la marca de la plataforma en vez de con la de su consultora.
 *
 * Por eso la regla vive en `enqueueTransactionalEmail`, por donde pasan TODOS
 * los correos de plantilla, y por eso este test mira lo que se encola y no lo
 * que devuelve el resolvedor: lo que se rompió no fue la regla, fue aplicarla.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const enqueueEmailSend = vi.fn(async () => 'job-1');
const getRootOrganizationName = vi.fn();
const resolveEmailOverride = vi.fn(async () => null);

vi.mock('@cio/jobs', () => ({
  enqueueEmailSend: (...args: unknown[]) => enqueueEmailSend(...(args as [])),
  isRedisConfigured: () => true
}));

vi.mock('@cio/db/queries/organization', () => ({
  getRootOrganizationName: (...args: unknown[]) => getRootOrganizationName(...(args as [])),
  getOrgNotificationSettings: vi.fn(),
  getOrganizationById: vi.fn(),
  updateOrganization: vi.fn()
}));

vi.mock('@api/services/organization/email-template', () => ({
  resolveEmailOverride: (...args: unknown[]) => resolveEmailOverride(...(args as []))
}));

vi.mock('@api/utils/redis/redis', () => ({ logRedisUnavailableOnce: vi.fn() }));

const { enqueueTransactionalEmail } = await import('@api/services/jobs/email-jobs');
const { clearSenderNameCache } = await import('@api/services/organization/sender-name');

const CLIENTE = 'org-cliente';

/** Un correo cualquiera de los que NO pasaban `from`. */
async function encolarBienvenida(orgId?: string | null) {
  await enqueueTransactionalEmail('welcome', {
    to: 'alguien@ejemplo.test',
    fields: { name: 'Ana' },
    ...(orgId === undefined ? {} : { orgId })
  });

  return enqueueEmailSend.mock.calls.at(-1)?.[0] as { from?: string } | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearSenderNameCache();
  resolveEmailOverride.mockResolvedValue(null);
});

describe('firma de los correos de plantilla', () => {
  it('firma con el nombre de la consultora aunque el envío no lo pase', async () => {
    getRootOrganizationName.mockResolvedValue('Consultora Ejemplo');

    const encolado = await encolarBienvenida(CLIENTE);

    expect(encolado?.from).toContain('Consultora Ejemplo');
  });

  it('respeta el `from` que ya venga armado', async () => {
    getRootOrganizationName.mockResolvedValue('Consultora Ejemplo');

    await enqueueTransactionalEmail('welcome', {
      to: 'alguien@ejemplo.test',
      fields: { name: 'Ana' },
      orgId: CLIENTE,
      from: '"Ya Resuelto" <x@ejemplo.test>'
    });

    const encolado = enqueueEmailSend.mock.calls.at(-1)?.[0] as { from?: string };

    expect(encolado.from).toBe('"Ya Resuelto" <x@ejemplo.test>');
  });

  it('sin empresa no inventa una firma', async () => {
    // No hay contra qué resolver; que decida la configuración del despliegue.
    const encolado = await encolarBienvenida(undefined);

    expect(encolado?.from).toBeUndefined();
    expect(getRootOrganizationName).not.toHaveBeenCalled();
  });

  it('también firma el correo con texto reescrito por la empresa', async () => {
    // El camino `raw` es otro objeto y otra rama: se rompe por separado.
    getRootOrganizationName.mockResolvedValue('Consultora Ejemplo');
    resolveEmailOverride.mockResolvedValue({ subject: 'Hola', content: '<p>Hola</p>' } as never);

    const encolado = await encolarBienvenida(CLIENTE);

    expect(encolado?.from).toContain('Consultora Ejemplo');
  });
});
