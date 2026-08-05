import { currentOrg, currentOrgPath } from './org';
import { derived, writable } from 'svelte/store';

import { ROLE } from '@cio/utils/constants';

export const globalStore = writable<{
  isDark: boolean;
  isOrgSite: boolean;
  orgSiteName: string;
}>({
  isDark: false,
  isOrgSite: false,
  orgSiteName: ''
});

export const isOrgStudent = derived(currentOrg, ($currentOrg) => {
  if ($currentOrg.roleId === 0) return null;

  return $currentOrg.roleId === ROLE.STUDENT;
});

/**
 * Which shell the person gets: the student's or the staff dashboard.
 *
 * The role decides. Upstream this was "any org subdomain means student", on the
 * reasoning that staff administer from a separate app domain and the tenant
 * subdomain is the storefront. Here a client's own domain IS their whole
 * platform, so that rule locked an organization's own admin out of their
 * dashboard — they signed in as ADMIN and landed in the student LMS.
 *
 * Falls back to the org-site heuristic only when there is no role to read:
 * signed out, or someone with no membership in the organization whose domain
 * they are visiting. For them the org site really is the students' door.
 */
export const isStudentExperience = derived([globalStore, isOrgStudent], ([$gs, $isStudent]) => {
  if ($isStudent !== null) return $isStudent;

  return $gs.isOrgSite;
});

/**
 * The root path for navigation: '/lms' for students, '/org/{siteName}' for admin/teacher
 */
export const basePath = derived([isStudentExperience, currentOrgPath], ([$isStudent, $orgPath]) =>
  $isStudent ? '/lms' : $orgPath
);
