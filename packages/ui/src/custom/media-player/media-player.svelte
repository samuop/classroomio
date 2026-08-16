<script lang="ts">
  import type { MediaPlayerOptions, VideoSource } from './types';
  import PlyrPlayer from './players/plyr-player.svelte';
  import MusePlayer from './players/muse-player.svelte';

  interface Props {
    source: VideoSource;
    options?: MediaPlayerOptions;
    class?: string;
  }

  let { source, options = {}, class: className = '' }: Props = $props();

  const tracks = $derived(source.tracks ?? []);
  const isMuse = $derived.by(() => source.type === 'muse' && source.metadata?.svid);
  const isGoogleDrive = $derived(source.type === 'google_drive');
  const poster = $derived(source.type === 'upload' ? source.metadata?.thumbnailUrl : undefined);

  const iframeTitle = $derived(source.metadata?.title?.trim() || 'Video');
  const iframeMaxHeight = $derived(options.maxHeight ?? '400px');
  const iframeWidth = $derived(options.width ?? '100%');
</script>

<div class={className}>
  {#if isMuse}
    <MusePlayer svid={source.metadata?.svid} {options} />
  {:else if isGoogleDrive}
    <div
      class="ui:relative ui:overflow-hidden ui:rounded-md ui:border ui:border-border"
      style:max-height={iframeMaxHeight}
      style:width={iframeWidth}
    >
      <!-- The min-height floor stops a Drive embed collapsing, but a flat 240px is
           taller than 16:9 on a phone, which letterboxes it. Lower it below `sm`. -->
      <iframe
        src={source.url}
        title={iframeTitle}
        class="ui:block ui:h-full ui:min-h-[180px] ui:w-full ui:border-0 ui:sm:min-h-[240px]"
        style:aspect-ratio="16 / 9"
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
        allowfullscreen
      ></iframe>
    </div>
  {:else}
    <PlyrPlayer src={source.url} {poster} {options} {tracks} />
  {/if}
</div>
