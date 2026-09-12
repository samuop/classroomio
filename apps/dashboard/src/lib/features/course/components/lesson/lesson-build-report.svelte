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
  import { formatDisplayDate } from '$lib/utils/functions/date';

  interface Props {
    /** Tal cual lo guardó la API. Clave abierta: se lee a la defensiva. */
    report?: Record<string, unknown> | null;
  }

  const { report }: Props = $props();

  const textos = (valor: unknown): string[] =>
    Array.isArray(valor) ? valor.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];

  const fuentes = $derived(textos(report?.sources));
  // Guardada sin decir con qué fuentes se escribió, pero contrastada contra
  // todas las del curso. No es lo mismo que «sin fuentes»: esa frase le dice al
  // docente que el contenido es conocimiento general, y no lo es.
  const contrastadaContraElCurso = $derived(report?.checkedAgainst === 'course');
  const sinRespaldo = $derived(textos(report?.groundingWarnings));
  const avisoDelEscritor = $derived(typeof report?.writerNote === 'string' ? report.writerNote : '');
  const fecha = $derived(typeof report?.builtAt === 'string' ? report.builtAt : '');

  /**
   * Los datos que no están en la fuente: nombres, números y citas.
   *
   * Se muestran aparte de las afirmaciones sin respaldo porque son otra cosa y
   * se revisan distinto. Aquéllas las juzgó un modelo y admiten discusión;
   * éstos son una búsqueda —el token está en el documento o no está— y se
   * verifican mirando el contexto que viene al lado. Por eso van con su
   * contexto y no sueltos: medido, uno de cada cinco es un dato bien dicho de
   * otra manera, y sin el contexto el docente no puede descartarlo de un
   * vistazo.
   */
  interface Token {
    valor: string;
    contexto: string;
  }

  const tokens = $derived(
    Array.isArray(report?.tokenWarnings)
      ? (report.tokenWarnings as unknown[])
          .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
          .map((t) => ({
            valor: typeof t.valor === 'string' ? t.valor : '',
            contexto: typeof t.contexto === 'string' ? t.contexto : ''
          }))
          .filter((t: Token) => t.valor.length > 0)
      : []
  );

  /**
   * Los pasajes que quien escribió marcó como propios.
   *
   * Van PRIMEROS, arriba de los otros dos avisos, y no por severidad: es el
   * único de los tres que no es una sospecha. Los otros dos preguntan «¿esto
   * estará bien?» —uno se lo pregunta a un modelo, el otro a una búsqueda— y
   * acá el que escribió la lección ya contestó que ese párrafo lo puso él. Es
   * el dato más confiable de la tarjeta y el más accionable, porque el motivo
   * dice literalmente qué material falta.
   */
  interface Pasaje {
    texto: string;
    porque: string;
  }

  const pasajes = $derived(
    Array.isArray(report?.unsupportedPassages)
      ? (report.unsupportedPassages as unknown[])
          .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
          .map((p) => ({
            texto: typeof p.texto === 'string' ? p.texto : '',
            porque: typeof p.porque === 'string' ? p.porque : ''
          }))
          .filter((p: Pasaje) => p.texto.length > 0)
      : []
  );
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
      {:else if contrastadaContraElCurso}
        {$t('course.navItem.lessons.build_report.checked_against_course')}
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

    {#if pasajes.length > 0}
      <div class="mt-3">
        <p class="text-xs font-semibold text-amber-700 dark:text-amber-400">
          {$t('course.navItem.lessons.build_report.unsupported_passages')}
        </p>
        <p class="text-gray-500 dark:text-gray-400 mt-1 text-xs">
          {$t('course.navItem.lessons.build_report.unsupported_passages_hint')}
        </p>
        <ul class="mt-2 space-y-2">
          {#each pasajes as pasaje (pasaje.texto)}
            <li class="border-amber-400 dark:border-amber-500 border-s-2 ps-2 text-xs">
              <p class="text-gray-700 dark:text-gray-300">{pasaje.texto}</p>
              {#if pasaje.porque}
                <p class="text-amber-700 dark:text-amber-400 mt-0.5 italic">{pasaje.porque}</p>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
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

    {#if tokens.length > 0}
      <div class="mt-3">
        <p class="text-xs font-semibold text-amber-700 dark:text-amber-400">
          {$t('course.navItem.lessons.build_report.tokens')}
        </p>
        <ul class="text-gray-700 dark:text-gray-300 mt-1 space-y-1 text-xs">
          {#each tokens as token (token.valor)}
            <li>
              <span class="font-semibold">{token.valor}</span>
              {#if token.contexto}
                <span class="text-gray-500 dark:text-gray-400">— {token.contexto}</span>
              {/if}
            </li>
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
