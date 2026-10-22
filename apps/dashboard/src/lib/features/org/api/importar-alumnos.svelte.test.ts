import { ApiError } from '$lib/utils/services/api/types';

/**
 * La importación de alumnos, vista desde `orgApi`.
 *
 * 1. Que no se reintente sola. El cliente reenviaba cualquier POST después de un
 *    5xx o un corte de red, y una importación reenviada revocaba las
 *    invitaciones que la primera acababa de mandar.
 * 2. Que un rechazo llegue a la docente traducido y con los correos culpables.
 *    Quedaba en `orgApi.errors`, que ninguna pantalla mostraba.
 *
 * Lo único falso es el transporte (el cliente RPC): la clase, su manejo de
 * errores y las traducciones son los de verdad.
 */

const falso = vi.hoisted(() => ({ importPost: vi.fn() }));

vi.mock('$lib/utils/services/api', async () => {
  const constantes = await vi.importActual<typeof import('$lib/utils/services/api/constants')>(
    '$lib/utils/services/api/constants'
  );
  const base = await vi.importActual<typeof import('$lib/utils/services/api/base.svelte')>(
    '$lib/utils/services/api/base.svelte'
  );

  return {
    sinReintento: constantes.sinReintento,
    BaseApiWithErrors: base.BaseApiWithErrors,
    classroomio: { organization: { audience: { import: { $post: falso.importPost } } } }
  };
});

const { orgApi } = await import('./org.svelte');

const respuesta = (cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status: 200 });

/** Así llega un 4xx de la API: `pedirConReintentos` tira el cuerpo como mensaje. */
const rechazo = (cuerpo: unknown) => new ApiError(JSON.stringify(cuerpo), 400, 'Bad Request');

const DATOS = { recipientCsv: 'ana@ejemplo.test', courseIds: ['curso-1'], sendEmail: true } as never;

beforeEach(() => {
  vi.clearAllMocks();
  orgApi.importError = null;
});

describe('importar alumnos', () => {
  it('no se reintenta sola', async () => {
    falso.importPost.mockResolvedValue(
      respuesta({
        success: true,
        data: {
          imported: 1,
          assigned: 0,
          pendingInvitesRenewed: 0,
          pendingInvitesKept: 0,
          emailsSent: 1,
          emailsFailed: 0
        }
      })
    );

    await orgApi.importAudienceMembers(DATOS);

    expect(falso.importPost.mock.calls[0][1]).toEqual({ init: { retries: 0 } });
    expect(orgApi.importError).toBeNull();
  });

  it('un correo mal escrito se le dice a la docente, con el correo', async () => {
    falso.importPost.mockRejectedValue(
      rechazo({
        success: false,
        error: 'Invalid emails found: beto@ejemplo',
        code: 'AUDIENCE_INVALID_EMAILS',
        field: 'recipientCsv',
        details: { emails: ['beto@ejemplo'] }
      })
    );

    const resultado = await orgApi.importAudienceMembers(DATOS);

    expect(resultado).toBeUndefined();
    expect(orgApi.importError).toBe(
      'No se invitó a nadie: hay correos mal escritos (beto@ejemplo). Corregilos y volvé a enviar la lista.'
    );
  });

  it('con muchos correos culpables nombra algunos y cuenta el resto', async () => {
    const correos = Array.from({ length: 10 }, (_, i) => `tutor${i}@ejemplo.test`);
    falso.importPost.mockRejectedValue(
      rechazo({ success: false, error: 'x', code: 'AUDIENCE_STAFF_EMAILS', details: { emails: correos } })
    );

    await orgApi.importAudienceMembers(DATOS);

    expect(orgApi.importError).toContain('tutor7@ejemplo.test y 2 más');
    expect(orgApi.importError).not.toContain('tutor8@ejemplo.test');
  });

  it('un tiempo agotado avisa que pudo haberse hecho igual', async () => {
    falso.importPost.mockRejectedValue(new ApiError('Request timeout', 408, 'Request Timeout'));

    await orgApi.importAudienceMembers(DATOS);

    expect(orgApi.importError).toContain('puede haberse hecho igual');
  });
});
