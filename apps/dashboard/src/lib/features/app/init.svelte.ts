import { BaseApi, classroomio } from '$lib/utils/services/api';
import { currentOrg, mergeAccountOrgFromServer, orgs } from '$lib/utils/store/org';
import { defaultProfileState, defaultUserState, profile, user } from '$lib/utils/store/user';

import type { AccountResponse } from './types';
import { PUBLIC_IS_SELFHOSTED } from '$env/static/public';
import type { TUser } from '@cio/db/types';
import { authClient } from '$lib/utils/services/auth/client';
import { get } from 'svelte/store';
import { goto } from '$app/navigation';
import { handleLocaleChange } from '$lib/utils/functions/translations';
import { identifyPosthogUser } from '$lib/utils/services/posthog';
import { identifyUserJotUser } from '$lib/utils/services/userjot';
import { isOrgStudent } from '$lib/utils/store/app';
import { isPublicRoute } from '$lib/utils/functions/routes/isPublicRoute';
import { licenseApi } from '$features/license/api/license.svelte';
import { logout } from '$lib/utils/functions/logout';
import { page } from '$app/state';
import { resolve } from '$app/paths';
import { setSentryUser } from '$lib/utils/services/sentry';
import { setTheme } from '$lib/utils/functions/theme';
import { setupAnalyticsBasedOnLicense } from '$lib/utils/functions/appSetup';
import shouldRedirectOnAuth from '$lib/utils/functions/routes/shouldRedirectOnAuth';

type AppSetupParams = {
  isOrgSite: boolean;
  orgSiteName: string;
  /** Tenant org id from `getOrgSiteInfo`; used to auto-enroll the user if they aren't a member yet. */
  orgId?: string | null;
  /**
   * La empresa dueña del dominio, y su madre si esa dueña es a su vez una
   * empresa cliente. Es a quién PERTENECE el host, aparte de `orgId`, que
   * existe sólo para decidir si hay que auto-inscribir.
   *
   * Hace falta porque en el dominio de una consultora el usuario puede no ser
   * miembro de la consultora en sí, sino de una de sus empresas cliente. Sin
   * esto no hay forma de saber que esa empresa cliente es la de acá.
   */
  hostOrgId?: string | null;
  hostOrgParentId?: string | null;
};

/**
 * Los caminos donde la persona está justo aceptando una invitación.
 *
 * Aceptar es lo que decide a qué empresa entra. Auto-inscribirla mientras
 * tanto la anota de ALUMNO en la dueña del dominio antes de que acepte —
 * y en el dominio de una consultora la dueña casi nunca es su empresa.
 */
function isAcceptingAnInvite(pathname: string): boolean {
  return pathname.startsWith('/invite/') || /^\/course\/[^/]+\/enroll\/?$/.test(pathname);
}

/*
  Manages everything related to loading the logged in user and setting up the organization.
*/
class AppInitApi extends BaseApi {
  data = $state<AccountResponse>(null);
  session = $state<App.Locals | null>(null);

  get loading() {
    return this.isLoading;
  }

  async setupApp(locals: App.Locals, params: AppSetupParams): Promise<boolean | undefined> {
    if (!locals.user) {
      if (!params.isOrgSite) {
        goto(resolve('/login', {}));
        return false;
      }

      console.log('No user found in locals');
      return;
    }

    this.session = locals;

    // Auto-enroll on tenant sites for first-time signups. Idempotent on the
    // API side (no-ops for existing members so invited admins/tutors keep
    // their roles). Runs BEFORE the account fetch so the returned org list
    // already reflects the new membership.
    if (params.isOrgSite && params.orgId && !isAcceptingAnInvite(window.location.pathname)) {
      await this.autoEnrollOnTenantSite(params.orgId);
    }

    await this.execute<typeof classroomio.account.$get>({
      requestFn: () => classroomio.account.$get(),
      logContext: 'fetching account',
      onSuccess: (data) => {
        this.data = data;
        licenseApi.setFeatures(data.licenseFeatures);
        setupAnalyticsBasedOnLicense(
          data.profile?.id ? { id: data.profile.id, email: data.profile.email, name: data.profile.fullname } : undefined
        );
        this.setupStores(params);
        this.setUserAnalytics();
        this.routeUserToNextPage(params);
      },
      onError: () => {
        logout();
      }
    });
  }

  private async autoEnrollOnTenantSite(orgId: string): Promise<void> {
    try {
      const response = await classroomio.organization['auto-enroll-student'].$post(
        {},
        { headers: { 'cio-org-id': orgId } }
      );

      if (!response.ok) {
        // 403 is expected for invite-only / disabled-signup orgs — the user
        // visited a tenant site but isn't allowed to enroll. Other failures
        // shouldn't block the rest of setupApp.
        console.warn('auto-enroll-student failed', response.status, await response.text().catch(() => ''));
        return;
      }

      // The user is a new member, so the session cookie cache (orgRoles)
      // is stale. Force Better Auth to refetch from DB and rewrite the
      // session_data cookie — Better Auth manages the cookie name itself.
      await authClient.getSession({ query: { disableCookieCache: true } });
    } catch (error) {
      console.warn('auto-enroll-student threw', error);
    }
  }

  /*
    1. Update user store
    2. Update profile store
    3. Update organizations store
  */
  setupStores(params?: AppSetupParams) {
    if (!this.data?.success || !this.session) {
      return;
    }

    user.update((_user) => ({
      ..._user,
      fetchingUser: false,
      isLoggedIn: true,
      currentSession: (this.session?.user as unknown as TUser) || undefined
    }));

    profile.set(this.data.profile);
    handleLocaleChange(this.data.profile.locale ?? 'en');

    this.setOrgStore(params);
  }

  /** La empresa que nombra un camino `/org/<nombre>/...`, si el usuario es miembro. */
  private findOrgInPath(pathname: string) {
    if (!this.data?.success) {
      return undefined;
    }

    const [, section, rawSiteName] = pathname.split('/');
    if (section !== 'org' || !rawSiteName) {
      return undefined;
    }

    let siteName: string;
    try {
      siteName = decodeURIComponent(rawSiteName);
    } catch {
      // Un `%` suelto en la URL rompe el decode; el nombre crudo sigue sirviendo.
      siteName = rawSiteName;
    }

    return this.data.organizations.find((org) => org.siteName === siteName);
  }

  setOrgStore(params?: AppSetupParams) {
    if (!this.data?.success || !this.data) {
      return;
    }

    if (!this.data.organizations.length) {
      return;
    }

    orgs.set(this.data.organizations.map((org) => mergeAccountOrgFromServer(org)));

    // On a tenant site, pin currentOrg to that tenant — never fall back to
    // localStorage / the user's first org, which is what was making a user
    // logged in on dblocked.* see the Dblocked dashboard on ciodevs.*.
    //
    // Salvo dentro de la MISMA cuenta. Una consultora y sus empresas cliente
    // comparten un dominio, y el ancla tal cual estaba las volvía inadmi­nistrables:
    // el selector guardaba la elección y recargaba, y la recarga la pisaba — se
    // elegía la empresa hija y la pantalla volvía sola a la madre, siempre.
    //
    // La protección original sigue en pie, porque lo que se compara es la RAÍZ de
    // la cuenta: una empresa de otro cliente nunca le gana al dominio. Lo único
    // que ahora puede ganarle es una empresa de la misma cuenta que el dueño del
    // dominio, que es justamente la que el usuario acaba de elegir a mano.
    const accountRootId = (org: (typeof this.data.organizations)[number]) => org.parentOrganizationId ?? org.id;

    // La dueña del dominio, cuando el usuario es miembro de ELLA.
    const domainOwnerOrg =
      params?.isOrgSite && params.orgSiteName
        ? this.data.organizations.find((org) => org.siteName === params.orgSiteName)
        : undefined;

    // Y si no lo es: cualquier empresa suya de la misma cuenta que el dominio.
    //
    // Sin esto, alguien invitado a una empresa CLIENTE de la consultora entraba
    // por el dominio de la consultora y aterrizaba en la primera empresa de su
    // lista — otra cuenta, otra marca — porque la única forma de reconocer el
    // host era ser miembro de la dueña, y de la hija no alcanzaba.
    const hostAccountRootId = params?.isOrgSite ? (params.hostOrgParentId ?? params.hostOrgId ?? undefined) : undefined;

    const hostOrg =
      domainOwnerOrg ??
      (hostAccountRootId ? this.data.organizations.find((org) => accountRootId(org) === hostAccountRootId) : undefined);

    const lastOrgSiteName = localStorage.getItem('classroomio_org_sitename');
    const lastOrg = this.data.organizations.find((org) => org.siteName === lastOrgSiteName);

    const lastOrgIsSameAccount = Boolean(hostOrg && lastOrg && accountRootId(hostOrg) === accountRootId(lastOrg));

    // La empresa nombrada en la URL gana sobre todo lo demás.
    //
    // En el dominio de una consultora conviven la consultora y sus empresas
    // cliente, y lo ÚNICO que las distingue es el `/org/<nombre>` del camino.
    // Nada acá lo miraba: quien era administrador de una empresa cliente y
    // además había quedado de alumno de la consultora abría la URL de su
    // empresa y veía la de la consultora, con su rol de alumno.
    //
    // Sin `trim()`: un nombre de sitio guardado con un espacio al final llega
    // como `%20` y tiene que seguir coincidiendo con lo que hay en la base.
    const pathOrg = this.findOrgInPath(window.location.pathname);

    const nextOrg = pathOrg ?? (lastOrgIsSameAccount ? lastOrg : (hostOrg ?? lastOrg ?? this.data.organizations[0]));

    // Abrir la URL de una empresa es elegirla, igual que elegirla en el
    // selector — que guarda exactamente esto. Sin la línea, volver a `/lms`
    // devolvía al usuario a la empresa equivocada.
    if (pathOrg?.siteName) {
      localStorage.setItem('classroomio_org_sitename', pathOrg.siteName);
    }

    currentOrg.set(mergeAccountOrgFromServer(nextOrg));

    const theme = get(currentOrg)?.theme;

    setTheme(theme || 'blue');
  }

  routeUserToNextPage({ isOrgSite }: AppSetupParams) {
    console.log('routeUserToNextPage', window.location.pathname);
    if (!this.data?.success) {
      return;
    }

    const redirect = page.url.searchParams.get('redirect');
    if (redirect) {
      console.log('redirecting to', redirect);
      // goto redirect won't accept dynamic url so we need to use window.location.href
      window.location.href = redirect;
      return;
    }

    // This allows you to be on the landing page of an organization site and not be redirected
    const path = window.location.pathname;
    if (isPublicRoute(path) && (path !== '/' || isOrgSite)) {
      console.log('no redirect is needed');
      return;
    }

    const isStudent = get(isOrgStudent);
    const userHasOrganizations = this.data.organizations.length > 0;
    const isCloud = PUBLIC_IS_SELFHOSTED !== 'true';

    // CLOUD: when user has no orgs and isOrgSite is false, route to /onboarding
    // isOrgSite - means the user is on a multi tenant organization site, we don't want to redirect to /onboarding in this case
    if (isCloud) {
      const shouldRedirectToOnboarding = !userHasOrganizations && !isOrgSite;
      if (shouldRedirectToOnboarding) {
        console.log('cloud: redirecting to onboarding');
        return goto(resolve(`/onboarding`, {}));
      }
    } else {
      // Self-hosted: when user has no orgs, route to /onboarding
      if (!userHasOrganizations) {
        console.log('self-hosted: redirecting to onboarding');
        return goto(resolve(`/onboarding`, {}));
      }
    }

    if (!shouldRedirectOnAuth(page.url.pathname)) return;

    // The role decides where to land, exactly as it decides which shell to show
    // (see isStudentExperience). Upstream this read `isOrgSite || isStudent`,
    // which on a multi-tenant deployment sent everyone arriving on a tenant
    // domain to the learner area — an organization's own admin included, since
    // the first branch won before the role was ever consulted.
    //
    // `isOrgStudent` is null when there is no membership to read a role from,
    // and for those the org site really is the learner's door.
    const shouldGoToLMS = isStudent ?? isOrgSite;
    console.log('redirecting to', shouldGoToLMS ? 'lms' : 'org');
    return shouldGoToLMS ? this.goToLMS() : this.goToOrg();
  }

  goToLMS() {
    goto(resolve('/lms', {}));
  }

  goToOrg() {
    const selectedOrg = get(currentOrg);

    goto(resolve(`/org/${selectedOrg.siteName}`, {}));
  }

  setUserAnalytics() {
    const profileStore = get(profile);

    if (!profileStore?.id) return;

    setSentryUser({
      id: profileStore.id,
      username: profileStore.username,
      email: profileStore.email,
      fullname: profileStore.fullname
    });

    identifyPosthogUser(profileStore.id, {
      email: profileStore.email,
      name: profileStore.fullname
    });

    identifyUserJotUser({
      id: profileStore.id,
      email: profileStore.email,
      fullname: profileStore.fullname,
      avatarUrl: profileStore.avatarUrl
    });
  }

  reset() {
    super.reset();
    this.data = null;
    licenseApi.reset();

    user.set(defaultUserState);
    profile.set(defaultProfileState);
  }

  get isInitializedAndReady() {
    return !this.isLoading && !this.error && this.data !== null;
  }
}

export const appInitApi = new AppInitApi();
