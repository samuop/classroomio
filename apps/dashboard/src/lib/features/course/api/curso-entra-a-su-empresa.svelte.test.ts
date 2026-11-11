import { get } from 'svelte/store';
import { vi } from 'vitest';

import type { AccountOrg } from '$features/app/types';
import { currentOrg, mergeAccountOrgFromServer, orgs } from '$lib/utils/store/org';

/**
 * Cargar un curso deja como activa la empresa de ese curso.
 *
 * Es el enganche de `empresa-del-curso.ts` con la carga real: sin esto la regla
 * existe y nadie la llama. Lo único falso es el transporte.
 *
 * El orden importa: la pantalla se dibuja en cuanto el curso aparece en el
 * store, y lo que pide al dibujarse (el estado del asistente, el cupo) sale
 * con la empresa que esté activa en ese instante.
 */

const falso = vi.hoisted(() => ({ cursoGet: vi.fn() }));

vi.mock('$lib/utils/services/api', async () => {
  const base = await vi.importActual<typeof import('$lib/utils/services/api/base.svelte')>(
    '$lib/utils/services/api/base.svelte'
  );

  return {
    BaseApi: base.BaseApi,
    BaseApiWithErrors: base.BaseApiWithErrors,
    classroomio: { course: { ':courseId': { $get: falso.cursoGet } } }
  };
});
vi.mock('$lib/utils/functions/theme', () => ({ setTheme: vi.fn() }));

const { courseApi } = await import('./course.svelte');

const empresa = (id: string, parentOrganizationId: string | null = null): AccountOrg =>
  mergeAccountOrgFromServer({ id, name: id, siteName: id, parentOrganizationId, plans: [], roleId: 1 } as AccountOrg);

const consultora = empresa('consultora');
const cliente = empresa('cliente', 'consultora');

const cursoDe = (id: string, organizationId: string) => ({
  id,
  title: 'Curso',
  metadata: { description: 'x' },
  group: { id: `grupo-${id}`, organizationId, members: [] }
});

const responder = (curso: unknown) =>
  falso.cursoGet.mockResolvedValue(new Response(JSON.stringify({ success: true, data: curso }), { status: 200 }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  localStorage.clear();
  orgs.set([consultora, cliente]);
  currentOrg.set(consultora);
});

describe('cargar un curso de otra empresa de la persona', () => {
  it('la consultora abre el curso de un cliente: la empresa activa pasa a ser la del cliente', async () => {
    responder(cursoDe('curso-1', 'cliente'));

    await courseApi.ensureCourse('curso-1', 'perfil-1');

    expect(courseApi.course?.id).toBe('curso-1');
    expect(get(currentOrg).id).toBe('cliente');
  });

  it('cuando el curso aparece en pantalla, la empresa ya es la suya', async () => {
    responder(cursoDe('curso-2', 'cliente'));

    let empresaAlVerElCurso: string | undefined;
    const soltar = $effect.root(() => {
      $effect(() => {
        if (courseApi.course?.id === 'curso-2') empresaAlVerElCurso ??= get(currentOrg).id;
      });
    });

    await courseApi.ensureCourse('curso-2', 'perfil-1');
    await Promise.resolve();
    soltar();

    expect(empresaAlVerElCurso).toBe('cliente');
  });

  it('un curso de la empresa activa no cambia nada', async () => {
    responder(cursoDe('curso-3', 'consultora'));

    await courseApi.ensureCourse('curso-3', 'perfil-1');

    expect(get(currentOrg).id).toBe('consultora');
    expect(localStorage.getItem('classroomio_org_sitename')).toBeNull();
  });
});
