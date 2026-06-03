<script lang="ts">
  import type { Writable } from 'svelte/store';
  import * as Field from '@cio/ui/base/field';
  import { Input } from '@cio/ui/base/input';
  import { Switch } from '@cio/ui/base/switch';

  import { t } from '$lib/utils/functions/translations';
  import type { AtRiskSettings } from '../utils/types';

  interface Props {
    store: Writable<AtRiskSettings>;
    disabled?: boolean;
  }

  let { store, disabled = false }: Props = $props();

  function setNumber(key: 'inactiveDays' | 'lowProgressPct' | 'lowGradePct', event: Event) {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value)) {
      store.update((settings) => ({ ...settings, [key]: value }));
    }
  }
</script>

<Field.Group>
  <Field.Set>
    <Field.Legend>{$t('at_risk.settings.availability')}</Field.Legend>
    <Field.Description>{$t('at_risk.settings.availability_description')}</Field.Description>

    <Field.Field orientation="horizontal">
      <Switch bind:checked={$store.enabled} {disabled} />
      <Field.Label>{$t('at_risk.settings.enabled')}</Field.Label>
    </Field.Field>
  </Field.Set>

  <Field.Separator />

  <Field.Set>
    <Field.Legend>{$t('at_risk.settings.thresholds')}</Field.Legend>
    <Field.Description>{$t('at_risk.settings.thresholds_description')}</Field.Description>

    <Field.Group>
      <Field.Field>
        <Field.Label>{$t('at_risk.settings.inactive_days')}</Field.Label>
        <Input
          type="number"
          min="1"
          max="365"
          value={$store.inactiveDays}
          oninput={(e) => setNumber('inactiveDays', e)}
          disabled={disabled || !$store.enabled}
        />
        <Field.Description>{$t('at_risk.settings.inactive_days_description')}</Field.Description>
      </Field.Field>

      <Field.Field>
        <Field.Label>{$t('at_risk.settings.low_progress_pct')}</Field.Label>
        <Input
          type="number"
          min="0"
          max="100"
          value={$store.lowProgressPct}
          oninput={(e) => setNumber('lowProgressPct', e)}
          disabled={disabled || !$store.enabled}
        />
        <Field.Description>{$t('at_risk.settings.low_progress_pct_description')}</Field.Description>
      </Field.Field>

      <Field.Field>
        <Field.Label>{$t('at_risk.settings.low_grade_pct')}</Field.Label>
        <Input
          type="number"
          min="0"
          max="100"
          value={$store.lowGradePct}
          oninput={(e) => setNumber('lowGradePct', e)}
          disabled={disabled || !$store.enabled}
        />
        <Field.Description>{$t('at_risk.settings.low_grade_pct_description')}</Field.Description>
      </Field.Field>
    </Field.Group>
  </Field.Set>
</Field.Group>
