<script lang="ts">
  import * as Dialog from '@cio/ui/base/dialog';
  import * as Field from '@cio/ui/base/field';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import { Spinner } from '@cio/ui/base/spinner';
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
  import GlobeIcon from '@lucide/svelte/icons/globe';

  import { platformApi } from '$features/platform/api/platform.svelte';
  import type { PlatformPlanName } from '$features/platform/utils/types';
  import { t } from '$lib/utils/functions/translations';

  const PLAN_OPTIONS: { value: PlatformPlanName; labelKey: string }[] = [
    { value: 'BASIC', labelKey: 'platform.plans.basic' },
    { value: 'EARLY_ADOPTER', labelKey: 'platform.plans.early_adopter' },
    { value: 'ENTERPRISE', labelKey: 'platform.plans.enterprise' }
  ];

  async function onChangePlan(value: string | undefined) {
    if (!orgId || !value || value === detail?.planName) return;

    await platformApi.setPlan(orgId, value as PlatformPlanName);
  }

  interface Props {
    orgId: string | null;
    onClose: () => void;
  }

  let { orgId, onClose }: Props = $props();

  let newDomain = $state('');

  $effect(() => {
    if (orgId) {
      newDomain = '';
      platformApi.loadOrganization(orgId);
    }
  });

  const detail = $derived(platformApi.detail);
  const isOpen = $derived(orgId !== null);

  function formatTokens(tokens: number) {
    return new Intl.NumberFormat().format(tokens);
  }

  async function onConnect() {
    if (!orgId || !newDomain.trim()) return;

    await platformApi.domainAction(orgId, 'connect', newDomain.trim());
    if (platformApi.success) newDomain = '';
  }

  async function onRefresh() {
    if (orgId) await platformApi.domainAction(orgId, 'refresh');
  }

  async function onRemove() {
    if (orgId) await platformApi.domainAction(orgId, 'remove');
  }
</script>

<Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
  <Dialog.Content class="ui:flex ui:max-h-[85vh] ui:max-w-lg ui:flex-col ui:overflow-hidden">
    {#if !detail || detail.id !== orgId}
      <div class="flex justify-center py-16"><Spinner class="size-8!" /></div>
    {:else}
      <Dialog.Header>
        <Dialog.Title>{detail.name}</Dialog.Title>
        <Dialog.Description>{detail.siteName}</Dialog.Description>
      </Dialog.Header>

      <div class="ui:-mr-2 ui:min-h-0 ui:flex-1 ui:overflow-y-auto ui:pr-2">
        <Field.Group>
          <!-- Summary -->
        <div class="grid grid-cols-2 gap-3">
          <div class="rounded border p-3">
            <p class="ui:text-muted-foreground text-xs">{$t('platform.detail.members')}</p>
            <p class="text-sm font-medium tabular-nums">{detail.memberCount}</p>
          </div>
          <div class="rounded border p-3">
            <p class="ui:text-muted-foreground text-xs">{$t('platform.detail.tokens_all_time')}</p>
            <p class="text-sm font-medium tabular-nums">{formatTokens(detail.tokensAllTime)}</p>
          </div>
        </div>

        <!-- Plan (changeable). A 3-button group instead of a Select avoids the
             popover-inside-dialog stacking issue and reads clearer for 3 options. -->
        <Field.Field>
          <Field.Label>{$t('platform.detail.plan')}</Field.Label>
          <div class="grid grid-cols-3 gap-2">
            {#each PLAN_OPTIONS as option (option.value)}
              <Button
                variant={detail.planName === option.value ? 'default' : 'outline'}
                size="sm"
                disabled={platformApi.isLoading}
                onclick={() => onChangePlan(option.value)}
              >
                {$t(option.labelKey)}
              </Button>
            {/each}
          </div>
          <Field.Description>{$t('platform.detail.plan_hint')}</Field.Description>
        </Field.Field>

        <Field.Separator />

        <!-- Domains -->
        <Field.Set>
          <Field.Legend>{$t('platform.detail.domains_title')}</Field.Legend>

          <!-- Tenant subdomain (automatic from siteName) -->
          <Field.Field>
            <Field.Label>{$t('platform.detail.tenant_url_label')}</Field.Label>
            <div class="flex items-center gap-2">
              <GlobeIcon class="ui:text-muted-foreground size-4" />
              <a
                href={detail.domains.tenantUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="text-sm underline underline-offset-2 hover:no-underline"
              >
                {detail.domains.tenantUrl}
              </a>
              <ExternalLinkIcon class="ui:text-muted-foreground size-3.5" />
            </div>
            <Field.Description>{$t('platform.detail.tenant_url_hint')}</Field.Description>
          </Field.Field>

          <!-- Custom domain -->
          <Field.Field>
            <Field.Label>{$t('platform.detail.custom_domain_label')}</Field.Label>

            {#if detail.domains.customDomain}
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-sm font-medium">{detail.domains.customDomain}</span>
                {#if detail.domains.isCustomDomainVerified}
                  <Badge variant="outline" class="border-emerald-500/40 text-emerald-600 dark:text-emerald-300">
                    {$t('platform.detail.domain_verified')}
                  </Badge>
                {:else}
                  <Badge variant="outline" class="border-amber-500/40 text-amber-600 dark:text-amber-300">
                    {$t('platform.detail.domain_pending')}
                  </Badge>
                {/if}
              </div>

              <div class="mt-2 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onclick={onRefresh}
                  loading={platformApi.isLoading}
                  disabled={platformApi.isLoading}
                >
                  {$t('platform.detail.domain_refresh')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="text-rose-600 hover:text-rose-700"
                  onclick={onRemove}
                  disabled={platformApi.isLoading}
                >
                  {$t('platform.detail.domain_remove')}
                </Button>
              </div>
            {:else}
              <div class="flex gap-2">
                <Input bind:value={newDomain} placeholder="egea.com.ar" />
                <Button
                  onclick={onConnect}
                  loading={platformApi.isLoading}
                  disabled={platformApi.isLoading || !newDomain.trim()}
                >
                  {$t('platform.detail.domain_connect')}
                </Button>
              </div>
              <Field.Description>{$t('platform.detail.custom_domain_hint')}</Field.Description>
            {/if}
          </Field.Field>
        </Field.Set>
        </Field.Group>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>
