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
   *
   * Desde el 2026-09-29 un dato puede traer además DÓNDE se lo encontró fuera
   * de las fuentes de la lección —en el pedido del docente, en el plan, en otra
   * fuente del curso— o que quien escribió lo da por conocimiento general. Sin
   * ese rótulo la lista entera se leía como «datos inventados»: medido en un
   * curso real, eran las palabras del propio pedido y las teclas del programa.
   * El rótulo se traduce acá por su código (`respaldo`, `decision`); el texto
   * que guarda el servidor (`rotulo`) queda sólo para un código que esta
   * pantalla todavía no conozca.
   */
  type Respaldo = 'pedido' | 'plan' | 'curso';
  const esRespaldo = (valor: unknown): valor is Respaldo => valor === 'pedido' || valor === 'plan' || valor === 'curso';

  interface Token {
    valor: string;
    contexto: string;
    enDiagrama: boolean;
    respaldo: Respaldo | null;
    /** Quien escribió decidió dejarlo: lo da por conocimiento general. */
    mantenido: boolean;
    rotulo: string;
    motivo: string;
  }

  const texto = (valor: unknown): string => (typeof valor === 'string' ? valor : '');

  const tokens = $derived(
    Array.isArray(report?.tokenWarnings)
      ? (report.tokenWarnings as unknown[])
          .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
          .map(
            (t): Token => ({
              valor: texto(t.valor),
              contexto: texto(t.contexto),
              enDiagrama: t.enDiagrama === true,
              respaldo: esRespaldo(t.respaldo) ? t.respaldo : null,
              mantenido: t.decision === 'mantener',
              rotulo: texto(t.rotulo).trim(),
              motivo: texto(t.motivo).trim()
            })
          )
          .filter((t) => t.valor.length > 0)
      : []
  );

  /** Lo que el docente lee al lado del dato: dónde apareció, o qué decidió quien escribió. */
  function rotuloDe(token: Token): string {
    if (token.respaldo) return $t(`course.navItem.lessons.build_report.token_backing.${token.respaldo}`);
    if (token.mantenido) return $t('course.navItem.lessons.build_report.token_kept');

    return token.rotulo;
  }

  /**
   * Los rótulos de un diagrama que nadie explicó van juntos, en una línea.
   *
   * Sueltos, cada caja del dibujo ocupaba un renglón con un «contexto» que es
   * la misma etiqueta: diez renglones para un solo diagrama, y la lista parecía
   * diez errores. Uno que sí trae rótulo sigue en la lista, porque su rótulo es
   * justamente lo que hay que leer.
   */
  const tokensEnLista = $derived(tokens.filter((token) => !token.enDiagrama || rotuloDe(token) !== ''));
  const tokensDeDiagrama = $derived(
    tokens.filter((token) => token.enDiagrama && rotuloDe(token) === '').map((token) => token.valor)
  );

  /**
   * Los ejemplos que quien escribió inventó a propósito, y lo declaró.
   *
   * No hay nada que confirmar en ellos —la marca dice que esos nombres y
   * números no salen de ningún lado—, pero sí algo que mirar: un ejemplo marcado
   * queda fuera de los dos chequeos, y medido en un curso real, la marca se
   * llevaba a veces la definición de al lado. Por eso van a la vista, plegados y
   * al final de lo que declaró quien escribió.
   */
  const ejemplos = $derived(
    Array.isArray(report?.examples)
      ? (report.examples as unknown[])
          .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
          .map((e) => ({ texto: texto(e.texto).trim(), porque: texto(e.porque).trim() }))
          .filter((e) => e.texto.length > 0)
      : []
  );

  /** Un ejemplo puede ser un párrafo entero: alcanza con reconocerlo. */
  const MAX_TEXTO_DE_EJEMPLO = 200;
  const recortar = (valor: string): string =>
    valor.length > MAX_TEXTO_DE_EJEMPLO ? `${valor.slice(0, MAX_TEXTO_DE_EJEMPLO).trimEnd()}…` : valor;

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

    {#if ejemplos.length > 0}
      <details class="mt-3" data-ejemplos>
        <summary class="text-gray-700 dark:text-gray-300 cursor-pointer text-xs font-semibold">
          {$t('course.navItem.lessons.build_report.examples', { count: ejemplos.length })}
        </summary>
        <p class="text-gray-500 dark:text-gray-400 mt-1 text-xs">
          {$t('course.navItem.lessons.build_report.examples_hint')}
        </p>
        <ul class="mt-2 space-y-2">
          {#each ejemplos as ejemplo, indice (indice)}
            <li class="border-gray-300 dark:border-neutral-600 border-s-2 ps-2 text-xs">
              <p class="text-gray-700 dark:text-gray-300">{recortar(ejemplo.texto)}</p>
              {#if ejemplo.porque}
                <p class="text-gray-500 dark:text-gray-400 mt-0.5 italic">{ejemplo.porque}</p>
              {/if}
            </li>
          {/each}
        </ul>
      </details>
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
          {#each tokensEnLista as token, indice (indice)}
            {@const rotulo = rotuloDe(token)}
            <li>
              <span class="font-semibold">{token.valor}</span>
              {#if token.contexto}
                <span class="text-gray-500 dark:text-gray-400">— {token.contexto}</span>
              {/if}
              {#if rotulo}
                <span class="text-green-700 dark:text-green-400" data-rotulo>· {rotulo}</span>
              {/if}
              {#if token.mantenido && token.motivo}
                <span class="text-gray-500 dark:text-gray-400 italic">({token.motivo})</span>
              {/if}
            </li>
          {/each}
          {#if tokensDeDiagrama.length > 0}
            <li data-diagramas>
              <span class="font-semibold">{$t('course.navItem.lessons.build_report.tokens_in_diagrams')}</span>
              {tokensDeDiagrama.join(', ')}
            </li>
          {/if}
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
