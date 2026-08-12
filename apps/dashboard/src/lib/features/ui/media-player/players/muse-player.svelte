<script lang="ts">
  import type { MediaPlayerOptions } from '../types';
  import { currentOrg } from '$lib/utils/store/org';

  interface Props {
    svid?: string;
    options?: MediaPlayerOptions;
  }

  let { svid }: Props = $props();

  /**
   * The player's watermark was hardcoded to `app.classroomio.com/logo-512.png`
   * — this deployment was asking muse.ai to fetch and stamp another company's
   * logo onto its videos. The org's own avatar takes its place, and with none
   * set the parameter is dropped so muse.ai draws no logo.
   */
  const embedUrl = $derived.by(() => {
    if (!svid) return '';

    const logo = $currentOrg.avatarUrl ? `logo=${encodeURIComponent($currentOrg.avatarUrl)}&` : '';

    return `https://muse.ai/embed/${svid}?${logo}subtitles=auto&cover_play_position=center`;
  });
</script>

{#if embedUrl}
  <div style="position:relative;padding-bottom:51.416579%">
    <iframe
      src={embedUrl}
      style="width:100%;height:100%;position:absolute;left:0;top:0"
      frameborder="0"
      allowfullscreen
      title="Muse AI Video Embed"
    ></iframe>
  </div>
{/if}
