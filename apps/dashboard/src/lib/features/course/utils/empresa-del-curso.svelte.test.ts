import { get } from 'svelte/store';
import { vi } from 'vitest';

import type { AccountOrg } from '$features/app/types';
import { globalStore } from '$lib/utils/store/app';
import { currentOrg, mergeAccountOrgFromServer, orgs } from '$lib/utils/store/org';

const setTheme = vi.hoisted(() => vi.fn());

vi.mock('$lib/utils/functions/theme', () => ({ setTheme }));

import { empresaParaElCurso, entrarALaEmpresaDelCurso } from './empresa-del-curso';

/**
 * Abrir un curso es entrar a su empresa.
 *
 * El caso medido (2026-10-28, y repetido en local el 2026-11-11): alguien que
 * administra la consultora abre el curso de una empresa cliente con la
 * consultora como empresa activa. Editaba las lecciones y el asistente le
 * contestaba 403, porque el chat exige que el curso sea de la empresa activa.
 */

const empresa = (id: string, extra: Partial<AccountOrg> = {}): AccountOrg =>
  mergeAccountOrgFromServer({
    id,
    name: id,
    siteName: id,
    parentOrganizationId: null,
    plans: [],
    roleId: 1,
    theme: '',
    ...extra
  } as AccountOrg);

const consultora = empresa('consultora', { theme: 'blue' });
const cliente = empresa('cliente', { parentOrganizationId: 'consultora', theme: 'purple' });
const otroCliente = empresa('otro-cliente', { parentOrganizationId: 'consultora' });
const otraCuenta = empresa('otra-cuenta');

const todas = [consultora, cliente, otroCliente, otraCuenta];

describe('a qué empresa hay que pasar para trabajar en un curso', () => {
  const decidir = (parcial: Partial<Parameters<typeof empresaParaElCurso<AccountOrg>>[0]>) =>
    empresaParaElCurso({
      empresaDelCursoId: 'cliente',
      activa: consultora,
      empresas: todas,
      enDominioDeEmpresa: false,
      ...parcial
    });

  it('con la consultora activa, el curso de un cliente pide la empresa del cliente', () => {
    expect(decidir({})?.id).toBe('cliente');
  });

  it('y al revés: con un cliente activo, un curso de la consultora pide la consultora', () => {
    expect(decidir({ empresaDelCursoId: 'consultora', activa: cliente })?.id).toBe('consultora');
  });

  it('entre dos clientes de la misma consultora, también', () => {
    expect(decidir({ activa: otroCliente })?.id).toBe('cliente');
  });

  it('si la empresa del curso ya es la activa, no hay nada que cambiar', () => {
    expect(decidir({ activa: cliente })).toBeNull();
  });

  it('una empresa a la que la persona no llega no se vuelve la activa', () => {
    // Inscripta de afuera en un curso: ve el curso, no la empresa.
    expect(decidir({ empresas: [consultora, otraCuenta] })).toBeNull();
  });

  it('un curso sin empresa a la vista deja todo como está', () => {
    expect(decidir({ empresaDelCursoId: undefined })).toBeNull();
    expect(decidir({ empresaDelCursoId: null })).toBeNull();
  });

  it('fuera del dominio de una empresa se pasa también a una empresa de otra cuenta', () => {
    expect(decidir({ empresaDelCursoId: 'otra-cuenta' })?.id).toBe('otra-cuenta');
  });

  it('en el dominio de una empresa, una de otra cuenta nunca le gana al dominio', () => {
    expect(decidir({ empresaDelCursoId: 'otra-cuenta', enDominioDeEmpresa: true })).toBeNull();
  });

  it('en el dominio de una empresa, dentro de la misma cuenta sí se cambia', () => {
    expect(decidir({ enDominioDeEmpresa: true })?.id).toBe('cliente');
  });
});

describe('entrar a la empresa del curso', () => {
  beforeEach(() => {
    setTheme.mockClear();
    localStorage.clear();
    orgs.set(todas);
    currentOrg.set(consultora);
    globalStore.set({ isDark: false, isOrgSite: false, orgSiteName: '' });
  });

  it('deja como activa la empresa del curso, la recuerda y pinta su color', () => {
    expect(entrarALaEmpresaDelCurso('cliente')).toBe(true);

    expect(get(currentOrg).id).toBe('cliente');
    // Lo mismo que guarda el selector de empresas: una recarga no la devuelve a la consultora.
    expect(localStorage.getItem('classroomio_org_sitename')).toBe('cliente');
    expect(setTheme).toHaveBeenCalledWith('purple');
  });

  it('si ya es la activa no toca nada', () => {
    currentOrg.set(cliente);

    expect(entrarALaEmpresaDelCurso('cliente')).toBe(false);

    expect(get(currentOrg).id).toBe('cliente');
    expect(localStorage.getItem('classroomio_org_sitename')).toBeNull();
    expect(setTheme).not.toHaveBeenCalled();
  });

  it('en el dominio de una empresa no salta a otra cuenta', () => {
    globalStore.set({ isDark: false, isOrgSite: true, orgSiteName: 'consultora' });

    expect(entrarALaEmpresaDelCurso('otra-cuenta')).toBe(false);
    expect(get(currentOrg).id).toBe('consultora');
  });
});
