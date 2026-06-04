<script lang="ts">
  import { brandName } from '$lib/utils/branding';
  import CourseCreatorWizard from '$features/ai-assistant/components/course-creator-wizard.svelte';
</script>

<svelte:head>
  <title>Home - {brandName}</title>
</svelte:head>

<CourseCreatorWizard />
