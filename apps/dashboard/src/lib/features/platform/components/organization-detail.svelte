<script lang="ts">
  import * as Dialog from '@cio/ui/base/dialog';
  import * as Field from '@cio/ui/base/field';
  import * as Select from '@cio/ui/base/select';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import { Spinner } from '@cio/ui/base/spinner';
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
  import GlobeIcon from '@lucide/svelte/icons/globe';

  import { platformApi } from '$features/platform/api/platform.svelte';
  import type { PlatformPlanName } from '$features/platform/utils/types';
  import { INHERIT_MODEL, modelOptionLabel, selectedModelLabel } from '$features/platform/utils/models';
  import { t } from '$lib/utils/functions/translations';

  const PLAN_OPTIONS: { value: PlatformPlanName; labelKey: string }[] = [
    { value: 'BASIC', labelKey: 'platform.plans.basic' },
    { value: 'EARLY_ADOPTER', labelKey: 'platform.plans.early_adopter' },
    { value: 'ENTERPRISE', labelKey: 'platform.plans.enterprise' }
  ];

  /** Plan defaults, mirrored from PLAN_TOKEN_ALLOWANCES in the API. Display only. */
  const PLAN_DEFAULT_ALLOWANCE: Record<PlatformPlanName, number> = {
    BASIC: 500_000,
    EARLY_ADOPTER: 3_000_000,
    ENTERPRISE: 15_000_000
  };

  async function onChangePlan(value: string | undefined) {
    if (!orgId || !value || value === detail?.planName) return;

    // The cap rides along so switching plan cannot silently drop it — the server
    // carries it over on its own, but sending it keeps the two in step when the
    // operator has edited the field and not yet saved it.
    await platformApi.setPlan(orgId, value as PlatformPlanName, parsedAllowance());
  }

  /**
   * The monthly cap this organisation should get, as typed.
   *
   * An empty box means "no override, use the plan's number" and is sent as null;
   * that is a real instruction, not a missing value, which is why it is not
   * simply omitted. Zero is kept as zero: it turns the agent off for this
   * organisation without touching its plan.
   */
  function parsedAllowance(): number | null {
    const raw = allowanceInput.trim();
    if (raw === '') return null;

    const value = Number(raw.replace(/[.\s]/g, ''));

    return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  }

  async function onSaveAllowance() {
    if (!orgId || !detail?.planName) return;

    await platformApi.setPlan(orgId, detail.planName, parsedAllowance());
  }

  /** The inherit sentinel means "use the deployment's model", sent as null. */
  async function onChangeModel(value: string) {
    if (!orgId || !detail?.planName) return;

    await platformApi.setPlan(orgId, detail.planName, undefined, value === INHERIT_MODEL ? null : value);
  }

  interface Props {
    orgId: string | null;
    onClose: () => void;
  }

  let { orgId, onClose }: Props = $props();

  let newDomain = $state('');
  let allowanceInput = $state('');
  /** Which org the box was last filled for, so typing is not overwritten on every refresh. */
  let allowanceLoadedFor = $state<string | null>(null);

  $effect(() => {
    if (orgId) {
      newDomain = '';
      platformApi.loadOrganization(orgId);
      // The selectable models come from the server; without them the dropdown
      // would offer only "inherit" when the dialog is the first thing opened.
      if (platformApi.selectableChatModels.length === 0) platformApi.loadSettings();
    }
  });

  // Seeded once per organisation rather than derived: this is an editable field,
  // and a derived value would snap back to the stored number mid-keystroke every
  // time the detail reloads.
  $effect(() => {
    const loaded = platformApi.detail;
    if (!orgId || !loaded || loaded.id !== orgId || allowanceLoadedFor === orgId) return;

    allowanceLoadedFor = orgId;
    allowanceInput = loaded.aiTokenAllowance == null ? '' : String(loaded.aiTokenAllowance);
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

          <!--
          Monthly token cap for THIS organisation, overriding the plan's default.
          Child companies carry their own plan row, so a consultancy's client can
          be raised or throttled without touching the parent.
        -->
          <Field.Field>
            <Field.Label>{$t('platform.detail.allowance')}</Field.Label>
            <div class="flex items-center gap-2">
              <Input
                type="text"
                inputmode="numeric"
                bind:value={allowanceInput}
                placeholder={formatTokens(PLAN_DEFAULT_ALLOWANCE[detail.planName ?? 'BASIC'])}
                disabled={platformApi.isLoading || !detail.planName}
                class="tabular-nums"
              />
              <Button size="sm" disabled={platformApi.isLoading || !detail.planName} onclick={onSaveAllowance}>
                {$t('platform.detail.allowance_save')}
              </Button>
            </div>
            <Field.Description>
              {$t('platform.detail.allowance_hint', {
                plan: formatTokens(PLAN_DEFAULT_ALLOWANCE[detail.planName ?? 'BASIC'])
              })}
            </Field.Description>
          </Field.Field>

          <!--
          Per-organisation model. The dialog sits at z-200 and a portalled
          popover defaults to z-50, so the list needs an explicit z-index to land
          in front of it — that stacking, not the component, was what made the
          native <select> look like the safer choice. It was not: its option list
          renders with the OS's colours and is unreadable on a dark panel.
        -->
          <Field.Field>
            <Field.Label>{$t('platform.detail.model')}</Field.Label>
            <Select.Root
              type="single"
              value={detail.aiModel ?? INHERIT_MODEL}
              disabled={platformApi.isLoading || !detail.planName}
              onValueChange={onChangeModel}
            >
              <Select.Trigger class="ui:w-full">
                {selectedModelLabel(
                  platformApi.selectableChatModels,
                  detail.aiModel,
                  $t('platform.detail.model_inherit')
                )}
              </Select.Trigger>
              <Select.Content style="z-index: 251">
                <Select.Item value={INHERIT_MODEL}>{$t('platform.detail.model_inherit')}</Select.Item>
                {#each platformApi.selectableChatModels as option (option.id)}
                  <Select.Item value={option.id}>{modelOptionLabel(option)}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
            <Field.Description>{$t('platform.detail.model_hint')}</Field.Description>
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
