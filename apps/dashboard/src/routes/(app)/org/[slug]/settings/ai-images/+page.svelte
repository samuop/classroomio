<script lang="ts">
  import { brandName } from '$lib/utils/branding';
  import { OrgAiImageSettingsPage } from '$features/ai-image-settings';
</script>

<svelte:head>
  <title>Imágenes de IA - {brandName}</title>
</svelte:head>

<OrgAiImageSettingsPage />
