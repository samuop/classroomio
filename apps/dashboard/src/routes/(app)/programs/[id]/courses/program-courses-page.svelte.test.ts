import { get } from 'svelte/store';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';

import Pagina from './+page.svelte';
import { ROLE } from '@cio/utils/constants';
import { currentOrg } from '$lib/utils/store/org';
import { profile } from '$lib/utils/store/user';
import { programApi } from '$features/program/api';

/**
 * La pestaña «Cursos» de un programa, montada.
 *
 * El alumno entra a esta misma pantalla que el equipo, y se le mostraban el
 * botón «Agregar curso», los tachos para quitar cursos y el aviso sobre cursos
 * sin publicar. La API le rechaza las acciones, pero se ve como si pudiera.
 */

const EMPRESA_VACIA = get(currentOrg);
const PERFIL_VACIO = get(profile);

const CURSO = {
  id: 'pc-1',
  programId: 'programa-1',
  courseId: 'curso-1',
  addedAt: '2026-09-28T00:00:00Z',
  course: {
    id: 'curso-1',
    title: 'Pago a proveedores',
    description: 'El circuito del pedido al pago',
    coverImage: null,
    slug: 'pago-a-proveedores',
    status: 'ACTIVE',
    isPublished: true
  }
};

function entrarComo(rolEnLaEmpresa: number, rolEnElPrograma: number) {
  currentOrg.set({ ...EMPRESA_VACIA, id: 'org-1', siteName: 'empresa', name: 'Empresa', roleId: rolEnLaEmpresa });
  profile.set({ ...PERFIL_VACIO, id: 'persona-1' });
  programApi.members = [
    { id: 'pm-1', programId: 'programa-1', profileId: 'persona-1', roleId: rolEnElPrograma } as never
  ];
  programApi.courses = [CURSO as never];
}

afterEach(() => {
  currentOrg.set(EMPRESA_VACIA);
  profile.set(PERFIL_VACIO);
  programApi.members = [];
  programApi.courses = [];
});

describe('pestaña Cursos del programa', () => {
  it('al alumno no le ofrece agregar ni quitar cursos', async () => {
    entrarComo(ROLE.STUDENT, ROLE.STUDENT);
    render(Pagina, { props: { data: { programId: 'programa-1' } } });
    await tick();

    expect(screen.getByText('Pago a proveedores')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Agregar curso/ })).toBeNull();
    expect(screen.queryByText('Acceso de estudiantes')).toBeNull();
  });

  it('a la tutora del programa sí', async () => {
    entrarComo(ROLE.TUTOR, ROLE.TUTOR);
    render(Pagina, { props: { data: { programId: 'programa-1' } } });
    await tick();

    expect(screen.getByRole('button', { name: /Agregar curso/ })).toBeInTheDocument();
    expect(screen.getByText('Acceso de estudiantes')).toBeInTheDocument();
  });

  it('y a la ADMIN de la empresa aunque no sea miembro del programa', async () => {
    entrarComo(ROLE.ADMIN, ROLE.STUDENT);
    programApi.members = [];
    render(Pagina, { props: { data: { programId: 'programa-1' } } });
    await tick();

    expect(screen.getByRole('button', { name: /Agregar curso/ })).toBeInTheDocument();
  });
});
