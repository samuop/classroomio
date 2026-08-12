<script lang="ts">
  /**
   * The organisation's mark, with a neutral stand-in while it is unknown.
   *
   * Everywhere this replaces used `/logo-192.png` as its fallback — which is the
   * ClassroomIO logo shipped with the upstream project. On a normal load the
   * organisation arrives a moment after the shell, so that fallback rendered
   * first and was then swapped: a foreign brand flashing on every visit.
   *
   * A monogram instead. It belongs to whoever is being shown (the initial comes
   * from their own name), it occupies exactly the same box so nothing shifts
   * when the real logo lands, and it is never somebody else's logo.
   */
  interface Props {
    src?: string | null;
    name?: string | null;
    /** Tailwind sizing for the box, e.g. "h-8 w-8". */
    class?: string;
    rounded?: string;
  }

  let { src = null, name = null, class: className = 'h-8 w-8', rounded = 'rounded' }: Props = $props();

  const initial = $derived((name?.trim()?.[0] ?? '').toUpperCase());
</script>

{#if src}
  <img {src} alt={name ?? ''} class="{className} {rounded} object-cover" />
{:else}
  <span
    class="{className} {rounded} ui:bg-muted ui:text-muted-foreground inline-flex items-center justify-center text-sm font-semibold select-none"
    aria-hidden={!initial}
  >
    {initial}
  </span>
{/if}
