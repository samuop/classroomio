<script lang="ts">
  import * as Field from '@cio/ui/base/field';
  import { Switch } from '@cio/ui/base/switch';
  import { InputField } from '@cio/ui/custom/input-field';
  import { TextareaField } from '@cio/ui/custom/textarea-field';
  import { t } from '$lib/utils/functions/translations';
  import { currentOrg } from '$lib/utils/store/org';
  import { certificateEditorStore } from '../store/certificate-editor.store.svelte';
  import BrandLogoField from './brand-logo-field.svelte';
  import { MAX_BRAND_LOGO_HEIGHT, MIN_BRAND_LOGO_HEIGHT, getTemplateLabelKeys } from '@cio/certificates';

  interface Props {
    disabled?: boolean;
  }

  let { disabled = false }: Props = $props();

  const draft = $derived(certificateEditorStore.draft);

  /**
   * Only the wording the CURRENT template actually prints. Showing every label
   * would ask a teacher to fill in lines that never appear — Classique has no
   * "Issued" key, Minimal has no "certifies that" line.
   *
   * The two brand captions are deliberately NOT in these lists: every template
   * draws the marks, so they belong with the marks below rather than in a
   * per-template section.
   */
  const labelKeys = $derived(getTemplateLabelKeys(draft.templateId));

  /**
   * The captions only print when there are two marks to tell apart, so offering
   * them before then would be offering a field that does nothing.
   */
  const hasClientBrand = $derived(Boolean(draft.clientBrandName.trim() || draft.clientBrandLogoUrl.trim()));

  /** Noir prints its marks on near-black; a white wordmark needs the same behind it. */
  const logoPreview = $derived(draft.templateId === 'noir' ? ('dark' as const) : ('light' as const));
</script>

<Field.Group>
  <Field.Set>
    <Field.Legend>{$t('course.navItem.certificates.editor.section_header')}</Field.Legend>
    <Field.Group>
      <Field.Field>
        <InputField
          label={$t('course.navItem.certificates.editor.title_override')}
          bind:value={certificateEditorStore.draft.titleOverride}
          placeholder={$t('course.navItem.certificates.editor.title_override_placeholder')}
          isDisabled={disabled}
        />
        <Field.Description>
          {$t('course.navItem.certificates.editor.title_override_hint')}
        </Field.Description>
      </Field.Field>
      <Field.Field>
        <InputField
          label={$t('course.navItem.certificates.editor.subtitle')}
          bind:value={certificateEditorStore.draft.subtitle}
          placeholder={$t('course.navItem.certificates.editor.subtitle_placeholder')}
          isDisabled={disabled}
        />
      </Field.Field>
      <Field.Field>
        <TextareaField
          label={$t('course.navItem.certificates.editor.description_override')}
          rows={4}
          bind:value={certificateEditorStore.draft.descriptionOverride}
          placeholder={$t('course.navItem.certificates.editor.description_override_placeholder')}
          {disabled}
        />
        <Field.Description>
          {$t('course.navItem.certificates.editor.description_override_hint')}
        </Field.Description>
      </Field.Field>
    </Field.Group>
  </Field.Set>

  <Field.Separator />

  <Field.Set>
    <Field.Legend>{$t('course.navItem.certificates.editor.section_brands')}</Field.Legend>
    <Field.Description>
      {$t('course.navItem.certificates.editor.section_brands_hint')}
    </Field.Description>

    <Field.Group>
      <Field.Field>
        <InputField
          label={$t('course.navItem.certificates.editor.org_brand_name')}
          bind:value={certificateEditorStore.draft.orgBrandName}
          placeholder={$currentOrg.name || $t('course.navItem.certificates.editor.sample_org')}
          isDisabled={disabled}
        />
        <Field.Description>
          {$t('course.navItem.certificates.editor.org_brand_name_hint')}
        </Field.Description>
      </Field.Field>

      <BrandLogoField
        label={$t('course.navItem.certificates.editor.org_brand_logo')}
        value={draft.orgBrandLogoUrl}
        preview={logoPreview}
        {disabled}
        onChange={(url) => (certificateEditorStore.draft.orgBrandLogoUrl = url)}
      />
    </Field.Group>

    <Field.Separator />

    <Field.Group>
      <Field.Field>
        <InputField
          label={$t('course.navItem.certificates.editor.client_brand_name')}
          bind:value={certificateEditorStore.draft.clientBrandName}
          placeholder={$t('course.navItem.certificates.editor.client_brand_name_placeholder')}
          isDisabled={disabled}
        />
      </Field.Field>

      <BrandLogoField
        label={$t('course.navItem.certificates.editor.client_brand_logo')}
        value={draft.clientBrandLogoUrl}
        preview={logoPreview}
        {disabled}
        onChange={(url) => (certificateEditorStore.draft.clientBrandLogoUrl = url)}
      />
    </Field.Group>

    {#if hasClientBrand}
      <!-- Two marks side by side already read as "by / for", so these stay out
           of the way until there is actually a second mark to caption. -->
      <Field.Group>
        <Field.Field>
          <InputField
            label={$t('course.navItem.certificates.editor.label_deliveredBy')}
            bind:value={certificateEditorStore.draft.labels.deliveredBy}
            placeholder={$t('course.navItem.certificates.editor.label_deliveredBy_placeholder')}
            isDisabled={disabled}
          />
        </Field.Field>
        <Field.Field>
          <InputField
            label={$t('course.navItem.certificates.editor.label_deliveredFor')}
            bind:value={certificateEditorStore.draft.labels.deliveredFor}
            placeholder={$t('course.navItem.certificates.editor.label_deliveredFor_placeholder')}
            isDisabled={disabled}
          />
        </Field.Field>
      </Field.Group>
    {/if}

    <!--
      A logo normally replaces its own name, since a wordmark already says it.
      That falls apart on an icon-only mark, or one whose lettering is
      unreadable at certificate scale — so it is a choice, not a rule.
    -->
    <Field.Field orientation="horizontal">
      <Switch bind:checked={certificateEditorStore.draft.brandShowNames} {disabled} />
      <Field.Label>{$t('course.navItem.certificates.editor.brand_show_names')}</Field.Label>
    </Field.Field>
    <Field.Description>
      {$t('course.navItem.certificates.editor.brand_show_names_hint')}
    </Field.Description>

    <Field.Field>
      <Field.Label for="brand-logo-height">
        {$t('course.navItem.certificates.editor.brand_logo_height')}
        <span class="ui:text-muted-foreground ml-1 font-normal">{draft.brandLogoHeight}px</span>
      </Field.Label>
      <input
        id="brand-logo-height"
        type="range"
        min={MIN_BRAND_LOGO_HEIGHT}
        max={MAX_BRAND_LOGO_HEIGHT}
        step="2"
        {disabled}
        bind:value={certificateEditorStore.draft.brandLogoHeight}
        class="w-full accent-current"
      />
      <Field.Description>
        {$t('course.navItem.certificates.editor.brand_logo_height_hint')}
      </Field.Description>
    </Field.Field>
  </Field.Set>

  {#if labelKeys.length > 0}
    <Field.Separator />

    <Field.Set>
      <Field.Legend>{$t('course.navItem.certificates.editor.section_labels')}</Field.Legend>
      <Field.Group>
        {#each labelKeys as key (key)}
          <Field.Field>
            <InputField
              label={$t(`course.navItem.certificates.editor.label_${key}`)}
              bind:value={certificateEditorStore.draft.labels[key]}
              isDisabled={disabled}
            />
          </Field.Field>
        {/each}
      </Field.Group>
      <Field.Description>
        {$t('course.navItem.certificates.editor.section_labels_hint')}
      </Field.Description>
    </Field.Set>
  {/if}

  <Field.Separator />

  <Field.Set>
    <Field.Legend>{$t('course.navItem.certificates.editor.section_signatories')}</Field.Legend>
    <Field.Group>
      <Field.Field>
        <InputField
          label={$t('course.navItem.certificates.editor.signatory_one_name')}
          bind:value={certificateEditorStore.draft.signatories[0].name}
          isDisabled={disabled}
        />
      </Field.Field>
      <Field.Field>
        <InputField
          label={$t('course.navItem.certificates.editor.signatory_one_role')}
          bind:value={certificateEditorStore.draft.signatories[0].role}
          isDisabled={disabled}
        />
      </Field.Field>
      <Field.Field>
        <InputField
          label={$t('course.navItem.certificates.editor.signatory_two_name')}
          bind:value={certificateEditorStore.draft.signatories[1].name}
          isDisabled={disabled}
        />
      </Field.Field>
      <Field.Field>
        <InputField
          label={$t('course.navItem.certificates.editor.signatory_two_role')}
          bind:value={certificateEditorStore.draft.signatories[1].role}
          isDisabled={disabled}
        />
      </Field.Field>
    </Field.Group>
  </Field.Set>

  <Field.Separator />

  <Field.Set>
    <Field.Legend>{$t('course.navItem.certificates.editor.section_reference')}</Field.Legend>
    <Field.Field>
      <InputField
        label={$t('course.navItem.certificates.editor.id_format')}
        bind:value={certificateEditorStore.draft.idFormat}
        placeholder={'N° {seq}'}
        isDisabled={disabled}
      />
      <Field.Description>
        {$t('course.navItem.certificates.editor.id_format_hint')}
      </Field.Description>
    </Field.Field>
  </Field.Set>
</Field.Group>
