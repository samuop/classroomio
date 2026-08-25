import {
  // ApiIcon, // Automation (API) menu item hidden for now — see below.
  ChartColumnIcon,
  AttachmentIcon,
  CommunityIcon,
  CourseIcon,
  DashboardIcon,
  GoalIcon,
  HomeIcon,
  LandingPageIcon,
  PeopleIcon,
  SettingsIcon,
  SetupIcon,
  TagIcon
} from '@cio/ui/custom/moving-icons';

import BuildingIcon from '@lucide/svelte/icons/building-2';
import type { AccountOrg } from '$features/app/types';
// import BotIcon from '@lucide/svelte/icons/bot'; // Automation (MCP) hidden for now.
import type { Component } from 'svelte';
import { isActive } from '$lib/utils/functions/app';

export interface NavItem {
  title: string;
  url: string;
  path: string; // Actual path (e.g., '/settings') for breadcrumb generation
  icon?: Component;
  isActive?: boolean;
  isExpanded?: boolean;
  /** When set, `isActive` for this item is determined by this regex on the pathname */
  matchPattern?: string;
  items?: NavItem[]; // for nested items like settings
  isPaid?: boolean; // Show upgrade indicator for free plan users
  disabled?: boolean;
  // Metadata for breadcrumb generation
  useHashUrl?: boolean; // Use '#' as URL (for collapsible items like settings)
  nestedRoutes?: NestedRouteConfig[]; // Static nested routes (like community/ask, settings/customize-lms)
  supportsDynamicSegment?: boolean; // Supports dynamic segments (like [slug])
}

export interface NavItemConfig {
  titleKey: string;
  path: string;
  icon?: Component;
  requiresAdmin?: boolean;
  disableWhenNotAdmin?: boolean;
  items?: NavItemConfig[];
  useHashUrl?: boolean; // Use '#' as URL (for collapsible items like settings)
  nestedRoutes?: NestedRouteConfig[]; // Static nested routes
  supportsDynamicSegment?: boolean; // Supports dynamic segments (like [slug])
  matchPattern?: string | ((orgSlug: string) => string); // Regex pattern for route matching
  isPaid?: boolean; // Show upgrade indicator for free plan users
  group?: string | null; // Group label key for sidebar grouping
  /**
   * Hide inside a client company. A consultancy's clients are workspaces of the
   * consultancy, so managing them belongs to the consultancy — offering it from
   * within a client would suggest that client can open clients of its own.
   */
  requiresPrimaryWorkspace?: boolean;
}

export interface NavGroup {
  labelKey: string | null;
  items: NavItem[];
}

export interface NestedRouteConfig {
  path: string; // Relative to parent (e.g., 'ask', 'customize-lms')
  titleKey: string; // Translation key or plain text
}

// Base navigation configuration structure
export const baseNavConfig: NavItemConfig[] = [
  {
    group: 'home',
    titleKey: 'org_navigation.home',
    path: '',
    icon: HomeIcon,
    matchPattern: '^/org/[^/]+/?$'
  },
  {
    group: 'home',
    titleKey: 'org_navigation.dashboard',
    path: '/dash',
    icon: DashboardIcon,
    matchPattern: '^/org/[^/]+/dash(/.*)?$'
  },
  {
    // Unified student-tracking hub. Replaces the old "Estadísticas" drawer
    // (Compliance + At-risk), which now live as tabs inside /seguimiento. The
    // hub owns its own tab bar, so this is a single flat nav item.
    group: 'home',
    titleKey: 'org_navigation.tracking',
    path: '/seguimiento',
    icon: ChartColumnIcon,
    requiresAdmin: true,
    matchPattern: '^/org/[^/]+/(seguimiento|compliance|at-risk)(/.*)?$'
  },
  {
    group: 'home',
    titleKey: 'org_navigation.setup',
    path: '/setup',
    icon: SetupIcon,
    requiresAdmin: true,
    matchPattern: '^/org/[^/]+/setup(/.*)?$'
  },
  {
    group: 'content',
    titleKey: 'org_navigation.courses',
    path: '/courses',
    icon: CourseIcon,
    matchPattern: '^/org/[^/]+/courses(/.*)?$' // Matches nested routes
  },
  {
    group: 'content',
    titleKey: 'org_navigation.programs',
    path: '/programs',
    icon: GoalIcon,
    matchPattern: '^/org/[^/]+/programs(/.*)?$'
  },
  {
    group: 'content',
    titleKey: 'org_navigation.media',
    path: '/media',
    icon: AttachmentIcon,
    matchPattern: '^/org/[^/]+/media(/.*)?$'
  },
  {
    group: 'content',
    titleKey: 'org_navigation.tags',
    path: '/tags',
    icon: TagIcon,
    requiresAdmin: true,
    matchPattern: '^/org/[^/]+/tags(/.*)?$'
  },
  {
    group: 'content',
    titleKey: 'org_navigation.widgets',
    path: '/widgets',
    icon: LandingPageIcon,
    matchPattern: '^(/org/[^/]+/widgets(/.*)?|/widgets/[^/]+(/.*)?)$'
  },
  {
    group: 'people',
    titleKey: 'org_navigation.community',
    path: '/community',
    icon: CommunityIcon,
    supportsDynamicSegment: true, // Supports /community/[slug]
    matchPattern: '^/org/[^/]+/community(/.*)?$', // Matches nested routes
    nestedRoutes: [
      {
        path: 'ask',
        titleKey: 'Ask Question' // Could be translated
      }
    ]
  },
  {
    group: 'people',
    titleKey: 'org_navigation.audience',
    path: '/audience',
    icon: PeopleIcon,
    matchPattern: '^/org/[^/]+/audience(/.*)?$' // Matches nested routes
  },
  {
    // A consultancy's client companies, side by side. Hidden inside a client,
    // which has no clients of its own.
    group: 'people',
    titleKey: 'org_navigation.clients',
    path: '/clientes',
    icon: BuildingIcon,
    requiresAdmin: true,
    requiresPrimaryWorkspace: true,
    matchPattern: '^/org/[^/]+/clientes(/.*)?$'
  },
  // Automation section (MCP + API) hidden for now — focusing on the platform's
  // core functionality first. Re-enable by uncommenting these two items; the
  // "automation" group auto-hides from the sidebar while both are commented out.
  // (Pages are still URL-blocked via their +layout.server.ts guards.)
  // {
  //   group: 'automation',
  //   titleKey: 'automation.tabs.mcp',
  //   path: '/mcp',
  //   icon: BotIcon,
  //   requiresAdmin: true,
  //   disableWhenNotAdmin: true,
  //   matchPattern: '^/org/[^/]+/mcp(/.*)?$'
  // },
  // {
  //   group: 'automation',
  //   titleKey: 'automation.tabs.api',
  //   path: '/api',
  //   icon: ApiIcon,
  //   requiresAdmin: true,
  //   disableWhenNotAdmin: true,
  //   matchPattern: '^/org/[^/]+/api(/.*)?$'
  // },
  // Zapier hidden for this deployment: the feature is a "coming soon"
  // placeholder (not implemented), so it's removed from the menu and blocked
  // by URL via routes/(app)/org/[slug]/zapier/+layout.server.ts.
  {
    titleKey: 'org_navigation.settings',
    path: '/settings',
    icon: SettingsIcon,
    useHashUrl: true, // Use '#' for collapsible parent
    matchPattern: '^/org/[^/]+/settings(/.*)?$', // Matches nested routes
    items: [
      {
        titleKey: 'settings.tabs.profile_tab',
        path: '/settings'
      },
      {
        titleKey: 'settings.tabs.organization_tab',
        path: '/settings/org'
      },
      // Hidden tabs for this deployment: Landing Page (no public site) and
      // Billing (the consultancy is billed out-of-band, not via the app).
      {
        titleKey: 'settings.tabs.ai_credits_tab',
        path: '/settings/ai-credits'
      },
      {
        titleKey: 'settings.tabs.ai_tutor_tab',
        path: '/settings/ai-tutor'
      },
      {
        titleKey: 'settings.tabs.ai_images_tab',
        path: '/settings/ai-images'
      },
      {
        titleKey: 'settings.tabs.at_risk_tab',
        path: '/settings/at-risk'
      },
      {
        titleKey: 'settings.tabs.notifications_tab',
        path: '/settings/notifications',
        requiresAdmin: true
      },
      {
        titleKey: 'settings.tabs.email_templates_tab',
        path: '/settings/email-templates',
        requiresAdmin: true
      },
      {
        titleKey: 'settings.tabs.auth_tab',
        matchPattern: '^/org/[^/]+/settings/auth(/.*)?$',
        path: '/settings/auth',
        isPaid: true
      },
      {
        titleKey: 'settings.tabs.workspaces_tab',
        path: '/settings/workspaces',
        requiresAdmin: true,
        requiresPrimaryWorkspace: true
      }
    ],
    nestedRoutes: [
      // Hidden for this deployment: billing, domains, sso, token-auth.
      {
        path: 'ai-credits',
        titleKey: 'settings.tabs.ai_credits_tab'
      },
      {
        path: 'ai-tutor',
        titleKey: 'settings.tabs.ai_tutor_tab'
      },
      {
        path: 'ai-images',
        titleKey: 'settings.tabs.ai_images_tab'
      },
      {
        path: 'at-risk',
        titleKey: 'settings.tabs.at_risk_tab'
      },
      {
        path: 'notifications',
        titleKey: 'settings.tabs.notifications_tab'
      },
      {
        path: 'email-templates',
        titleKey: 'settings.tabs.email_templates_tab'
      },
      {
        path: 'customize-lms',
        titleKey: 'settings.tabs.customize_lms_tab'
      },
      {
        path: 'teams',
        titleKey: 'settings.tabs.teams_tab'
      },
      {
        path: 'auth',
        titleKey: 'settings.tabs.auth_tab'
      },
      {
        path: 'workspaces',
        titleKey: 'settings.tabs.workspaces_tab'
      }
    ]
  }
];

/**
 * Get navigation items based on organization context and permissions
 */
/**
 * The sub-items this person should see here. Both navigation builders below
 * share it so the two menus cannot drift apart on who is shown what.
 */
function visibleSubItems(config: NavItemConfig, currentOrg: AccountOrg, isOrgAdmin: boolean | null): NavItemConfig[] {
  const isPrimaryWorkspace = !currentOrg.parentOrganizationId;

  return (
    config.items?.filter(
      (sub) => (!sub.requiresAdmin || isOrgAdmin) && (!sub.requiresPrimaryWorkspace || isPrimaryWorkspace)
    ) ?? []
  );
}

export function getOrgNavigationItems(
  currentOrgPath: string,
  currentOrg: AccountOrg,
  isOrgAdmin: boolean | null,
  t: (key: string) => string,
  pagePathname: string
): NavItem[] {
  const items: NavItem[] = [];

  for (const config of baseNavConfig) {
    // Skip admin-only items if user is not admin
    if (config.requiresAdmin && !isOrgAdmin && !config.disableWhenNotAdmin) {
      continue;
    }

    if (config.requiresPrimaryWorkspace && currentOrg.parentOrganizationId) {
      continue;
    }

    const visibleSubConfigs = visibleSubItems(config, currentOrg, isOrgAdmin);

    if (config.items && visibleSubConfigs.length === 0) {
      continue;
    }

    const url = config.path === '' ? currentOrgPath : `${currentOrgPath}${config.path}`;
    const fullPath = config.path === '' ? `/org/${currentOrg.siteName}` : `/org/${currentOrg.siteName}${config.path}`;

    // Extract match pattern (handle function case)
    const matchPattern =
      typeof config.matchPattern === 'function' ? config.matchPattern(currentOrg.siteName!) : config.matchPattern;

    const item: NavItem = {
      title: t(config.titleKey),
      url: config.useHashUrl ? '#' : url,
      path: config.path, // Store actual path for breadcrumb generation
      icon: config.icon,
      matchPattern,
      isActive: isActive(pagePathname, fullPath, matchPattern),
      isExpanded: config.items ? isActive(pagePathname, fullPath, matchPattern) : undefined,
      disabled: Boolean(config.disableWhenNotAdmin && !isOrgAdmin),
      useHashUrl: config.useHashUrl,
      nestedRoutes: config.nestedRoutes,
      supportsDynamicSegment: config.supportsDynamicSegment,
      isPaid: config.isPaid
    };

    // Handle nested items (like settings sub-items)
    if (visibleSubConfigs.length > 0) {
      item.items = visibleSubConfigs.map((subConfig) => {
        const subMatchPattern =
          typeof subConfig.matchPattern === 'function'
            ? subConfig.matchPattern(currentOrg.siteName!)
            : subConfig.matchPattern;
        const subUrl = `${currentOrgPath}${subConfig.path}`;

        return {
          title: t(subConfig.titleKey),
          isActive: isActive(pagePathname, subUrl, subMatchPattern, true),
          url: subUrl,
          path: subConfig.path,
          isPaid: subConfig.isPaid
        };
      });
    }

    items.push(item);
  }

  return items;
}

const GROUP_ORDER: Array<{ key: string | null; labelKey: string | null }> = [
  { key: 'home', labelKey: 'org_navigation.home' },
  { key: 'content', labelKey: 'org_navigation.content' },
  { key: 'people', labelKey: 'org_navigation.people' },
  { key: 'automation', labelKey: 'org_navigation.automation' },
  { key: null, labelKey: null }
];

/**
 * Get navigation items grouped for the sidebar
 */
export function getOrgNavigationGroups(
  currentOrgPath: string,
  currentOrg: AccountOrg,
  isOrgAdmin: boolean | null,
  t: (key: string) => string,
  pagePathname: string
): NavGroup[] {
  const pathnameOnly = pagePathname.split('?')[0];
  const groupedMap = new Map<string | null, NavItem[]>();

  for (const groupDef of GROUP_ORDER) {
    groupedMap.set(groupDef.key, []);
  }

  for (const config of baseNavConfig) {
    if (config.requiresAdmin && !isOrgAdmin && !config.disableWhenNotAdmin) {
      continue;
    }

    if (config.requiresPrimaryWorkspace && currentOrg.parentOrganizationId) {
      continue;
    }

    const visibleSubConfigs = visibleSubItems(config, currentOrg, isOrgAdmin);

    if (config.items && visibleSubConfigs.length === 0) {
      continue;
    }

    const url = config.path === '' ? currentOrgPath : `${currentOrgPath}${config.path}`;
    const fullPath = config.path === '' ? `/org/${currentOrg.siteName}` : `/org/${currentOrg.siteName}${config.path}`;
    const matchPattern =
      typeof config.matchPattern === 'function' ? config.matchPattern(currentOrg.siteName!) : config.matchPattern;

    const item: NavItem = {
      title: t(config.titleKey),
      url: config.useHashUrl ? '#' : url,
      path: config.path,
      icon: config.icon,
      matchPattern,
      isActive: isActive(pathnameOnly, fullPath, matchPattern),
      isExpanded: config.items ? isActive(pathnameOnly, fullPath, matchPattern) : undefined,
      disabled: Boolean(config.disableWhenNotAdmin && !isOrgAdmin),
      useHashUrl: config.useHashUrl,
      nestedRoutes: config.nestedRoutes,
      supportsDynamicSegment: config.supportsDynamicSegment,
      isPaid: config.isPaid
    };

    if (visibleSubConfigs.length > 0) {
      item.items = visibleSubConfigs.map((subConfig) => {
        const subMatchPattern =
          typeof subConfig.matchPattern === 'function'
            ? subConfig.matchPattern(currentOrg.siteName!)
            : subConfig.matchPattern;
        const subUrl = `${currentOrgPath}${subConfig.path}`;
        return {
          title: t(subConfig.titleKey),
          isActive: isActive(pathnameOnly, subUrl, subMatchPattern, true),
          url: subUrl,
          path: subConfig.path,
          isPaid: subConfig.isPaid
        };
      });
    }

    const groupKey = config.group !== undefined ? config.group : null;
    const bucket = groupedMap.get(groupKey) ?? groupedMap.get(null)!;
    bucket.push(item);
  }

  return GROUP_ORDER.filter(({ key }) => (groupedMap.get(key) ?? []).length > 0).map(({ key, labelKey }) => ({
    labelKey,
    items: groupedMap.get(key) ?? []
  }));
}
