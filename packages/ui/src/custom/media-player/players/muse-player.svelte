<script lang="ts">
  import type { MediaPlayerOptions } from '../types';

  interface Props {
    svid?: string;
    options?: MediaPlayerOptions;
  }

  let { svid }: Props = $props();

  /**
   * Sin parámetro `logo`: estaba fijo en `app.classroomio.com/logo-512.png`, o
   * sea que este despliegue le pedía a muse.ai que bajara el logo de otra
   * empresa y lo estampara sobre cada video. Sin el parámetro, muse.ai no
   * dibuja ninguno.
   *
   * (La copia del dashboard, `features/ui/media-player/players/muse-player.svelte`,
   * además usa el avatar de la organización cuando lo hay; acá no se puede,
   * porque `packages/ui` no conoce los stores del dashboard.)
   */
  const embedUrl = $derived(
    svid ? `https://muse.ai/embed/${svid}?subtitles=auto&cover_play_position=center` : ''
  );
</script>

{#if embedUrl}
  <div style="position:relative;padding-bottom:51.416579%">
    <iframe
      src={embedUrl}
      style="width:100%;height:100%;position:absolute;left:0;top:0"
      frameborder="0"
      allowfullscreen
      title="Muse AI Video"
    ></iframe>
  </div>
{/if}
