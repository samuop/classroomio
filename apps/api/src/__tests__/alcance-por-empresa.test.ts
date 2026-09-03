/**
 * Que la empresa que llega por la URL sea la de quien llama.
 *
 * Los cuestionarios cuelgan de `/organization/:orgId/quiz`, o sea que la
 * empresa viaja en la URL — pero el guardia de la ruta (`orgMemberMiddleware`)
 * sólo mira la cabecera `cio-org-id`. Nada ataba las dos cosas, así que
 * alcanzaba con poner la empresa propia en la cabecera y la ajena en la URL.
 * Verificado contra un servidor real antes del arreglo: el admin de una empresa
 * hija creó, listó, editó y borró cuestionarios de la empresa madre.
 *
 * El test monta el router DE VERDAD, no una copia del guardia: lo que se rompió
 * no fue la regla —`assertOrgAccess` ya existía— sino no haberla llamado. Un
 * test sobre el helper habría pasado en verde con el agujero abierto.
 *
 * Por eso además se afirma QUÉ recibe el servicio: que el guardia deje pasar no
 * sirve si después la consulta busca el cuestionario sólo por su id, porque
 * entonces el id vuelve a ser una puerta lateral.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ROLE } from '@cio/utils/constants';

const listQuizzes = vi.fn(async () => []);
const getQuiz = vi.fn(async () => ({ id: 'q1', title: 'x' }));
const createQuizService = vi.fn(async () => ({ id: 'q1', title: 'x' }));
const updateQuizService = vi.fn(async () => ({ id: 'q1', title: 'x' }));
const deleteQuizService = vi.fn(async () => undefined);

vi.mock('@api/services/quiz', () => ({
  listQuizzes: (...a: unknown[]) => listQuizzes(...(a as [])),
  getQuiz: (...a: unknown[]) => getQuiz(...(a as [])),
  createQuizService: (...a: unknown[]) => createQuizService(...(a as [])),
  updateQuizService: (...a: unknown[]) => updateQuizService(...(a as [])),
  deleteQuizService: (...a: unknown[]) => deleteQuizService(...(a as []))
}));

const { Hono } = await import('hono');
const { quizRouter } = await import('@api/routes/organization/quiz');

const PROPIA = '11111111-1111-4111-8111-111111111111';
const AJENA = '22222222-2222-4222-8222-222222222222';
const CLIENTE = '33333333-3333-4333-8333-333333333333';
const QUIZ = '44444444-4444-4444-8444-444444444444';

const USUARIO = { id: 'u1', email: 'quien@ejemplo.test', role: null };

/**
 * Arma el mismo contexto que `app.ts` deja en cada request: usuario, sesión y
 * el mapa de roles que la sesión ya trae resuelto.
 */
function app(orgRoles: Record<string, number>) {
  return new Hono()
    .use('*', async (c, next) => {
      c.set('user' as never, USUARIO as never);
      c.set('session' as never, { id: 's1' } as never);
      c.set('orgRoles' as never, orgRoles as never);
      await next();
    })
    .route('/organization/:orgId/quiz', quizRouter);
}

/** El caso del ataque: mi empresa en la cabecera, la ajena en la URL. */
async function pedir(
  ruta: string,
  { metodo = 'GET', cabecera = PROPIA, roles = { [PROPIA]: ROLE.ADMIN } } = {}
) {
  const cuerpo = metodo === 'POST' || metodo === 'PUT' ? JSON.stringify({ title: 'algo' }) : undefined;

  return app(roles).request(ruta, {
    method: metodo,
    headers: { 'cio-org-id': cabecera, 'content-type': 'application/json' },
    body: cuerpo
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cuestionarios de otra empresa', () => {
  const ataques: Array<[string, string, string]> = [
    ['listar', 'GET', `/organization/${AJENA}/quiz`],
    ['leer uno', 'GET', `/organization/${AJENA}/quiz/${QUIZ}`],
    ['crear', 'POST', `/organization/${AJENA}/quiz`],
    ['editar', 'PUT', `/organization/${AJENA}/quiz/${QUIZ}`],
    ['borrar', 'DELETE', `/organization/${AJENA}/quiz/${QUIZ}`]
  ];

  for (const [que, metodo, ruta] of ataques) {
    it(`no deja ${que} los de una empresa ajena`, async () => {
      const res = await pedir(ruta, { metodo });

      expect(res.status).toBe(404);
    });
  }

  it('no llega siquiera a tocar el servicio', async () => {
    await pedir(`/organization/${AJENA}/quiz/${QUIZ}`, { metodo: 'DELETE' });

    // Que responda 404 no alcanza: podría haber borrado y despues fallado.
    expect(deleteQuizService).not.toHaveBeenCalled();
  });
});

describe('cuestionarios de la empresa propia', () => {
  it('deja listarlos', async () => {
    const res = await pedir(`/organization/${PROPIA}/quiz`);

    expect(res.status).toBe(200);
    expect(listQuizzes).toHaveBeenCalledWith(PROPIA);
  });

  it('deja crearlos', async () => {
    const res = await pedir(`/organization/${PROPIA}/quiz`, { metodo: 'POST' });

    expect(res.status).toBe(201);
  });

  it('busca el cuestionario acotado a la empresa, no sólo por su id', async () => {
    // Sin esto el guardia estaría bien y la consulta seguiría abriendo el
    // cuestionario de cualquiera a quien le adivinen el id.
    await pedir(`/organization/${PROPIA}/quiz/${QUIZ}`);

    expect(getQuiz).toHaveBeenCalledWith(QUIZ, PROPIA);
  });

  it('borra acotado a la empresa', async () => {
    await pedir(`/organization/${PROPIA}/quiz/${QUIZ}`, { metodo: 'DELETE' });

    expect(deleteQuizService).toHaveBeenCalledWith(QUIZ, PROPIA);
  });
});

describe('la consultora sobre su empresa cliente', () => {
  it('sigue entrando: administrar la consultora es administrar sus clientes', async () => {
    // El permiso derivado ya vive en `orgRoles`, así que cerrar el agujero no
    // puede romperlo. Este test es el que avisa si se cierra de más.
    const res = await pedir(`/organization/${CLIENTE}/quiz`, {
      cabecera: CLIENTE,
      roles: { [PROPIA]: ROLE.ADMIN, [CLIENTE]: ROLE.ADMIN }
    });

    expect(res.status).toBe(200);
  });
});
