import { get } from 'svelte/store';

import type { AccountOrg } from '$features/app/types';
import { setTheme } from '$lib/utils/functions/theme';
import { globalStore } from '$lib/utils/store/app';
import { currentOrg, mergeAccountOrgFromServer, orgBrand, orgs } from '$lib/utils/store/org';

/**
 * Abrir un curso es entrar a la empresa de ese curso.
 *
 * ── Lo que pasaba ────────────────────────────────────────────────────────────
 *
 * Quien administra una consultora llega a los cursos de sus empresas cliente.
 * Si abría uno por un enlace directo o desde el historial, la empresa activa
 * seguía siendo la consultora: editaba las lecciones a mano sin problema —esas
 * rutas autorizan por el equipo del curso— y el asistente le contestaba 403,
 * porque el chat exige que el curso sea de la empresa activa (de ahí salen el
 * cupo, el modelo y la auditoría). Medido en producción: seis pedidos seguidos
 * rechazados en la misma sesión en la que se guardaron 55 ediciones.
 *
 * ── Qué se fija ──────────────────────────────────────────────────────────────
 *
 * Al cargar el curso, si su empresa no es la activa y la persona llega a esa
 * empresa, la activa pasa a ser la del curso: lo mismo que elegirla en el
 * selector, sin recargar la pantalla.
 *
 * En el dominio de una empresa el cambio vale sólo dentro de la misma cuenta
 * (la consultora y sus clientes). Es la misma protección que `setOrgStore`: una
 * empresa de otra cuenta nunca le gana al dominio en el que se está.
 */

type Empresa = Pick<AccountOrg, 'id' | 'parentOrganizationId'>;

const raizDeLaCuenta = (empresa: Empresa): string => empresa.parentOrganizationId ?? empresa.id;

export interface DecisionDeEmpresa<T extends Empresa> {
  /** La empresa del curso, como viene en `group.organizationId`. */
  empresaDelCursoId: string | null | undefined;
  activa: Empresa;
  /** Las empresas a las que llega la persona: las suyas y las derivadas. */
  empresas: readonly T[];
  enDominioDeEmpresa: boolean;
}

/** La empresa a la que hay que pasar para trabajar en este curso; `null` si no hay que cambiar. */
export function empresaParaElCurso<T extends Empresa>({
  empresaDelCursoId,
  activa,
  empresas,
  enDominioDeEmpresa
}: DecisionDeEmpresa<T>): T | null {
  if (!empresaDelCursoId || empresaDelCursoId === activa.id) return null;

  const delCurso = empresas.find((empresa) => empresa.id === empresaDelCursoId);

  // Un curso al que se llega sin llegar a su empresa (inscripto de afuera): no
  // hay empresa a la que pasar, y la activa se queda como está.
  if (!delCurso) return null;

  if (enDominioDeEmpresa && activa.id && raizDeLaCuenta(delCurso) !== raizDeLaCuenta(activa)) return null;

  return delCurso;
}

/**
 * Deja como activa la empresa del curso, si corresponde. Devuelve si cambió.
 *
 * Tiene que correr ANTES de que el curso figure como cargado: lo que la
 * pantalla pide al dibujarse (el estado del asistente, el cupo) ya sale con la
 * empresa correcta.
 */
export function entrarALaEmpresaDelCurso(empresaDelCursoId: string | null | undefined): boolean {
  const destino = empresaParaElCurso({
    empresaDelCursoId,
    activa: get(currentOrg),
    empresas: get(orgs),
    enDominioDeEmpresa: get(globalStore).isOrgSite
  });

  if (!destino) return false;

  // Lo mismo que guarda el selector: al recargar, la elección se mantiene.
  if (destino.siteName) {
    try {
      localStorage.setItem('classroomio_org_sitename', destino.siteName);
    } catch {
      // Sin localStorage el cambio vale igual para esta visita.
    }
  }

  currentOrg.set(mergeAccountOrgFromServer(destino));
  setTheme(orgBrand(destino).theme || 'blue');

  return true;
}
