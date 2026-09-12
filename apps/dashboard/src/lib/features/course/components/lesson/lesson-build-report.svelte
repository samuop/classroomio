<script lang="ts">
  /**
   * De qué está hecha esta lección: fuentes, huecos y el aviso de quien la
   * escribió.
   *
   * ── Por qué existe esta tarjeta ────────────────────────────────────────────
   *
   * El sistema ya sabía todo esto en el momento de escribir la lección —qué
   * fuentes tenía delante, qué afirmaciones no pudo respaldar, qué avisó el
   * escritor— y se lo devolvía al modelo, que lo contaba en prosa en el chat.
   * Prosa que se va hacia arriba y desaparece.
   *
   * El resultado era que el docente abría la lección y no tenía forma de
   * distinguir el párrafo que salió de un documento del que es relleno
   * plausible: los dos se leen con la misma autoridad. Un caso medido: cuatro
   * lecciones sobre un organigrama, escritas sin haberlo leído nunca, con su
   * examen incluido.
   *
   * Acá se muestra al lado del contenido que describe, que es donde sirve.
   */
  import { t } from '$lib/utils/functions/translations';
  import { formatDisplayDate } from '$lib/utils/functions/formatDate';

  interface Props {
    /** Tal cual lo guardó la API. Clave abierta: se lee a la defensiva. */
    report?: Record<string, unknown> | null;
  }

  const { report }: Props = $props();

  const textos = (valor: unknown): string[] =>
    Array.isArray(valor) ? valor.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];

  const fuentes = $derived(textos(report?.sources));
  const sinRespaldo = $derived(textos(report?.groundingWarnings));
  const avisoDelEscritor = $derived(typeof report?.writerNote === 'string' ? report.writerNote : '');
  const fecha = $derived(typeof report?.builtAt === 'string' ? report.builtAt : '');
</script>

{#if report}
  <section
    class="border-gray-200 dark:border-neutral-700 mb-4 rounded-md border p-4"
    aria-label={$t('course.navItem.lessons.build_report.title')}
  >
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h3 class="text-sm font-semibold">{$t('course.navItem.lessons.build_report.title')}</h3>
      {#if fecha}
        <span class="text-gray-500 dark:text-gray-400 text-xs">{formatDisplayDate(fecha)}</span>
      {/if}
    </div>

    <p class="text-gray-600 dark:text-gray-300 mt-2 text-xs">
      {#if fuentes.length > 0}
        {$t('course.navItem.lessons.build_report.written_from')}
      {:else}
        {$t('course.navItem.lessons.build_report.no_sources')}
      {/if}
    </p>

    {#if fuentes.length > 0}
      <ul class="mt-2 flex flex-wrap gap-1.5">
        {#each fuentes as fuente (fuente)}
          <li class="bg-gray-100 dark:bg-neutral-800 rounded px-2 py-0.5 text-xs">{fuente}</li>
        {/each}
      </ul>
    {/if}

    {#if sinRespaldo.length > 0}
      <div class="mt-3">
        <p class="text-xs font-semibold text-red-700 dark:text-red-400">
          {$t('course.navItem.lessons.build_report.unsupported')}
        </p>
        <ul class="text-gray-700 dark:text-gray-300 mt-1 list-disc space-y-1 pl-4 text-xs">
          {#each sinRespaldo as aviso (aviso)}
            <li>{aviso}</li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if avisoDelEscritor}
      <p class="text-gray-700 dark:text-gray-300 mt-3 text-xs">
        <span class="font-semibold">{$t('course.navItem.lessons.build_report.writer_note')}</span>
        {avisoDelEscritor}
      </p>
    {/if}
  </section>
{/if}
