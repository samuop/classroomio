<script lang="ts">
  import XIcon from '@lucide/svelte/icons/x';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import CircleDashedIcon from '@lucide/svelte/icons/circle-dashed';
  import CircleIcon from '@lucide/svelte/icons/circle';
  import BookOpenIcon from '@lucide/svelte/icons/book-open';
  import FileQuestionIcon from '@lucide/svelte/icons/file-question';
  import LoaderIcon from '@lucide/svelte/icons/loader';
  import { Button } from '@cio/ui/base/button';
  import { t } from '$lib/utils/functions/translations';
  import { pantallaDelPlan } from '$features/ai-assistant/utils/plan-screen.svelte';
  import {
    confirmacionesSobreElPlan,
    contarPlan,
    estadosSobreElPlan,
    type EstadoDelItem
  } from '$features/ai-assistant/utils/plan-summary';
  import { aiAssistantApi } from '$features/ai-assistant/api/ai-assistant.svelte';
  import type { CoursePlan, CoursePlanSection } from '$features/ai-assistant/utils/course-plan';

  /**
   * El plan del curso, en el área principal y con el chat al costado.
   *
   * Se lee como un documento: secciones numeradas, lecciones con su descripción,
   * todo editable en el lugar antes de aprobar. Después de aprobar, la misma
   * pantalla es el tablero de la construcción: cada ítem se marca a medida que el
   * servidor lo encuentra hecho en el curso.
   */

  /** Heurística de costo por ítem, la misma que usaba la tarjeta del chat. */
  const COSTO_ESTIMADO = { seccion: 500, leccion: 3000, ejercicio: 1500 } as const;

  const mostrado = $derived(pantallaDelPlan.mostrado);
  const esVigente = $derived(pantallaDelPlan.esVigente);
  const aprobado = $derived(esVigente && pantallaDelPlan.aprobado);
  const editable = $derived(esVigente && !pantallaDelPlan.aprobado);
  const ocupado = $derived(pantallaDelPlan.ocupado);

  // Copia editable, que se rehace sólo cuando cambia la versión: si se rehiciera
  // con cada sincronización, un cambio del docente se perdería a mitad de escribir.
  let borrador = $state<CoursePlan | null>(null);
  let borradorDe = $state<string | null>(null);

  $effect(() => {
    const actual = mostrado;

    if (!actual) {
      borrador = null;
      borradorDe = null;
      return;
    }

    if (borradorDe !== actual.id) {
      borrador = JSON.parse(JSON.stringify(actual.plan)) as CoursePlan;
      borradorDe = actual.id;
    }
  });

  const plan = $derived(editable ? borrador : (mostrado?.plan ?? null));
  const cuenta = $derived(plan ? contarPlan(plan) : null);
  const estados = $derived(aprobado && plan ? estadosSobreElPlan(plan, pantallaDelPlan.progreso) : new Map());
  /**
   * Los ítems que el asistente dio por hechos DECLARÁNDOLO, con su motivo.
   *
   * Van a la vista con todas las letras: un ✅ medido («el 4400 ya no está») y
   * uno declarado («lo que queda es de otra regla») no valen lo mismo, y el
   * docente es quien decide si le cree.
   */
  const confirmaciones = $derived(
    aprobado && plan ? confirmacionesSobreElPlan(plan, pantallaDelPlan.progreso) : new Map<string, string>()
  );
  const progreso = $derived(aprobado ? pantallaDelPlan.progreso : null);
  const porcentaje = $derived(
    progreso && progreso.total > 0 ? Math.round((progreso.completed / progreso.total) * 100) : 0
  );

  const porcentajeDelCupo = $derived.by(() => {
    const restante = aiAssistantApi.status?.usage?.remaining;

    if (!cuenta || !restante || restante <= 0) return null;

    const estimado =
      cuenta.secciones * COSTO_ESTIMADO.seccion +
      cuenta.lecciones * COSTO_ESTIMADO.leccion +
      cuenta.ejercicios * COSTO_ESTIMADO.ejercicio;

    return Math.round((estimado / restante) * 100);
  });

  let pidiendoCambios = $state(false);
  let cambios = $state('');
  let cambiosEnviadosPara = $state<string | null>(null);

  // Un plan nuevo contesta el pedido: la nota de «pedido enviado» ya no corresponde.
  $effect(() => {
    if (pantallaDelPlan.vigenteId !== cambiosEnviadosPara) cambiosEnviadosPara = null;
  });

  function enviarCambios() {
    const texto = cambios.trim();

    if (!texto || ocupado || !pantallaDelPlan.acciones) return;

    pantallaDelPlan.acciones.pedirCambios(texto);
    cambiosEnviadosPara = pantallaDelPlan.vigenteId;
    cambios = '';
    pidiendoCambios = false;
  }

  function aprobar() {
    if (!borrador || ocupado || !pantallaDelPlan.acciones) return;

    pantallaDelPlan.acciones.aprobar(borrador);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && !pidiendoCambios) pantallaDelPlan.cerrar();
  }

  const etiquetaDeEstado: Record<EstadoDelItem, string> = {
    done: 'ai_assistant.plan_screen.status_done',
    empty: 'ai_assistant.plan_screen.status_empty',
    missing: 'ai_assistant.plan_screen.status_missing'
  };

  /**
   * Un campo que crece con su texto.
   *
   * Los títulos eran `<input>`: en un teléfono un título largo quedaba cortado a
   * mitad de palabra. `field-sizing: content` lo resolvería en CSS, pero Safari
   * todavía no lo soporta. Se reajusta al escribir, cuando el valor cambia desde
   * afuera, y cuando cambia el ANCHO (girar el teléfono, abrir el panel).
   */
  function autoAltura(nodo: HTMLTextAreaElement, _valor?: string) {
    let anchoAnterior = 0;

    const ajustar = () => {
      nodo.style.height = 'auto';
      nodo.style.height = `${nodo.scrollHeight}px`;
    };

    // Sólo el ancho: reaccionar al alto que se acaba de poner sería un bucle.
    const observador =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(([entrada]) => {
            const ancho = entrada.contentRect.width;
            if (ancho === anchoAnterior) return;
            anchoAnterior = ancho;
            ajustar();
          });

    ajustar();
    nodo.addEventListener('input', ajustar);
    observador?.observe(nodo);

    return {
      update: ajustar,
      destroy: () => {
        nodo.removeEventListener('input', ajustar);
        observador?.disconnect();
      }
    };
  }

  /** Un título es una línea: Enter confirma en vez de partirlo. */
  function sinSaltos(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;

    event.preventDefault();
    (event.currentTarget as HTMLTextAreaElement).blur();
  }

  /** El modelo suele titular «Sección 1: …»: ahí la etiqueta de arriba repetiría el número. */
  const tituloTraeNumero = (titulo: string) =>
    /^\s*(secci[oó]n|section|m[oó]dulo|module|unidad|unit)\s*\d+/i.test(titulo);

  /**
   * En un plan de cambios, el número que se muestra es el del CURSO, no el de la
   * lista.
   *
   * Un plan de cambios lista sólo las secciones que toca: si toca la 2 y la 5,
   * numerarlas por posición las mostraría como 1 y 2, y el docente leería que se
   * va a tocar el principio de su curso cuando no es así. La manija (`S2`) trae
   * el número real, que es justamente para lo que sirve.
   */
  const numeroDeSeccion = (seccion: CoursePlanSection): number | null => {
    const manija = seccion.sectionId?.trim().match(/^S(\d+)$/i);

    return manija ? Number(manija[1]) : null;
  };

  const etiquetaDeAccion: Record<'create' | 'rewrite' | 'edit', string> = {
    create: 'ai_assistant.plan_screen.action_create',
    rewrite: 'ai_assistant.plan_screen.action_rewrite',
    edit: 'ai_assistant.plan_screen.action_edit'
  };

  const campoClass =
    'w-full rounded-md border border-transparent bg-transparent px-1.5 py-0.5 transition-colors hover:border-(--border) focus:border-(--ring) focus:bg-(--background) focus:outline-none';
</script>

<svelte:window onkeydown={pantallaDelPlan.abierta ? handleKeydown : undefined} />

{#if pantallaDelPlan.abierta && mostrado && plan && cuenta}
  <section
    class="fixed inset-0 z-[110] flex flex-col bg-(--background) md:relative md:inset-auto md:z-auto md:min-h-[calc(100dvh-56px)]"
    aria-labelledby="plan-screen-title"
  >
    <header
      class="sticky top-0 z-10 flex items-center gap-3 border-b bg-(--background)/95 px-4 py-2.5 backdrop-blur md:px-8"
    >
      <span class="ui:text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {$t(cuenta.esDeCambios ? 'ai_assistant.plan_screen.changes_title' : 'ai_assistant.plan_screen.card_title')}
      </span>

      {#if aprobado}
        <span
          class="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:text-green-400"
        >
          {#if ocupado}
            <LoaderIcon size={11} class="animate-spin" />
            {$t('ai_assistant.plan_screen.building')}
          {:else}
            <CircleCheckIcon size={11} />
            {$t('ai_assistant.plan_screen.approved')}
          {/if}
        </span>
      {:else if !esVigente}
        <span class="ui:text-muted-foreground rounded-full border px-2 py-0.5 text-[11px] font-medium">
          {$t('ai_assistant.plan_screen.previous_version')}
        </span>
      {:else}
        <span class="rounded-full bg-(--primary)/10 px-2 py-0.5 text-[11px] font-medium text-(--primary)">
          {$t('ai_assistant.plan_screen.proposed')}
        </span>
      {/if}

      <div class="flex-1"></div>

      <!-- En pantallas angostas el texto se oculta: sin aria-label el botón quedaba sin nombre. -->
      <Button
        variant="ghost"
        size="sm"
        aria-label={$t('ai_assistant.plan_screen.close')}
        onclick={() => pantallaDelPlan.cerrar()}
      >
        <XIcon size={14} />
        <span class="hidden sm:inline">{$t('ai_assistant.plan_screen.close')}</span>
      </Button>
    </header>

    <div class="flex-1 overflow-y-auto md:overflow-visible">
      <div class="mx-auto flex w-full max-w-3xl flex-col px-4 py-8 md:px-8 md:py-10">
        {#if editable && borrador}
          <label for="plan-screen-title" class="sr-only">{$t('ai_assistant.plan_screen.card_title')}</label>
          <textarea
            id="plan-screen-title"
            rows="1"
            bind:value={borrador.title}
            use:autoAltura={borrador.title}
            onkeydown={sinSaltos}
            class="{campoClass} -ml-1.5 resize-none overflow-hidden text-2xl font-semibold tracking-tight"
          ></textarea>
        {:else}
          <h1 id="plan-screen-title" class="text-2xl font-semibold tracking-tight text-balance">{plan.title}</h1>
        {/if}

        <!--
          El contador de un plan de cambios cuenta por ACCIÓN: lo que el docente
          necesita saber antes de aprobar es cuánto de lo que ya tiene se toca.
        -->
        {#if cuenta.esDeCambios}
          <p class="ui:text-muted-foreground mt-2 text-sm">
            {$t('ai_assistant.plan_screen.affected_sections', { count: cuenta.secciones })}{#if cuenta.nuevas > 0}
              · {$t('ai_assistant.plan_screen.new_lessons', { count: cuenta.nuevas })}{/if}{#if cuenta.reescribir > 0}
              · {$t('ai_assistant.plan_screen.rewrites', { count: cuenta.reescribir })}{/if}{#if cuenta.retocar > 0}
              · {$t('ai_assistant.plan_screen.edits', { count: cuenta.retocar })}{/if}
          </p>
        {:else}
          <p class="ui:text-muted-foreground mt-2 text-sm">
            {$t('ai_assistant.plan_screen.sections', { count: cuenta.secciones })} ·
            {$t('ai_assistant.plan_screen.lessons', { count: cuenta.lecciones })}{#if cuenta.ejercicios > 0}
              · {$t('ai_assistant.plan_screen.exercises', { count: cuenta.ejercicios })}{/if}
          </p>
        {/if}

        {#if editable}
          <p class="ui:text-muted-foreground mt-1 text-xs">{$t('ai_assistant.plan_screen.edit_hint')}</p>
        {/if}

        {#if progreso && progreso.total > 0}
          <div class="mt-6 flex flex-col gap-2 rounded-xl border px-4 py-3">
            <div class="flex items-center justify-between gap-3 text-sm">
              <span class="font-medium">{$t('ai_assistant.todo_checklist.title')}</span>
              <span class="ui:text-muted-foreground tabular-nums">
                {$t('ai_assistant.plan_screen.progress', { completed: progreso.completed, total: progreso.total })}
              </span>
            </div>
            <div class="h-1.5 w-full overflow-hidden rounded-full bg-(--muted)">
              <div class="h-full rounded-full bg-(--primary) transition-all duration-500" style="width: {porcentaje}%"></div>
            </div>
          </div>
        {/if}

        <ol class="mt-8 flex flex-col gap-9">
          {#each plan.sections as seccion, s (s)}
            {@const estadoDeSeccion = estados.get(String(s))}
            {@const numeroReal = cuenta.esDeCambios ? numeroDeSeccion(seccion) : s + 1}
            {@const esSeccionNueva = cuenta.esDeCambios && numeroReal === null}
            <li class="flex flex-col gap-3">
              <div class="flex items-start gap-3">
                <span
                  class="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums {estadoDeSeccion ===
                  'done'
                    ? 'border-green-600/40 bg-green-500/10 text-green-700 dark:text-green-400'
                    : ''}"
                >
                  {numeroReal ?? '+'}
                </span>
                <div class="min-w-0 flex-1">
                  {#if esSeccionNueva}
                    <p class="ui:text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                      {$t('ai_assistant.plan_screen.section_new')}
                    </p>
                  {:else if numeroReal !== null && !tituloTraeNumero(seccion.title)}
                    <p class="ui:text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                      {$t('ai_assistant.plan_screen.section', { order: numeroReal })}
                    </p>
                  {/if}
                  {#if editable && borrador}
                    <textarea
                      rows="1"
                      bind:value={borrador.sections[s].title}
                      use:autoAltura={borrador.sections[s].title}
                      onkeydown={sinSaltos}
                      aria-label={$t('ai_assistant.plan_screen.section', { order: numeroReal ?? s + 1 })}
                      class="{campoClass} -ml-1.5 resize-none overflow-hidden text-base font-semibold"
                    ></textarea>
                  {:else}
                    <h2 class="text-base font-semibold text-balance">{seccion.title}</h2>
                  {/if}
                </div>
              </div>

              <ul class="ml-3.5 flex flex-col border-l pl-6">
                {#each seccion.items as item, i (i)}
                  {@const estado = estados.get(`${s}.${i}`)}
                  {@const accion = item.action ?? 'create'}
                  <li class="flex items-start gap-2.5 py-2.5">
                    <span class="mt-1 shrink-0" title={estado ? $t(etiquetaDeEstado[estado]) : undefined}>
                      {#if estado === 'done'}
                        <CircleCheckIcon size={15} class="text-green-600 dark:text-green-400" />
                      {:else if estado === 'empty'}
                        <CircleDashedIcon size={15} class="ui:text-primary" />
                      {:else if estado === 'missing'}
                        <CircleIcon size={15} class="ui:text-muted-foreground" />
                      {:else if item.type === 'exercise'}
                        <FileQuestionIcon size={15} class="ui:text-primary" />
                      {:else}
                        <BookOpenIcon size={15} class="ui:text-muted-foreground" />
                      {/if}
                    </span>

                    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                      <!--
                        Qué se le hace a esta pieza. Sólo en un plan de cambios:
                        en un plan de curso todo es nuevo y la etiqueta sería
                        ruido repetido en cada línea.
                      -->
                      {#if cuenta.esDeCambios}
                        <span
                          class="mb-0.5 w-fit rounded-full border px-1.5 py-px text-[10px] font-medium tracking-wide uppercase {accion ===
                          'create'
                            ? 'ui:text-primary border-(--primary)/40'
                            : 'ui:text-muted-foreground'}"
                        >
                          {$t(etiquetaDeAccion[accion])}
                        </span>
                      {/if}
                      {#if editable && borrador}
                        <textarea
                          rows="1"
                          bind:value={borrador.sections[s].items[i].title}
                          use:autoAltura={borrador.sections[s].items[i].title}
                          onkeydown={sinSaltos}
                          aria-label={item.title}
                          class="{campoClass} -ml-1.5 resize-none overflow-hidden text-sm font-medium"
                        ></textarea>
                        <textarea
                          rows="1"
                          bind:value={borrador.sections[s].items[i].description}
                          use:autoAltura={borrador.sections[s].items[i].description}
                          aria-label={item.title}
                          class="{campoClass} ui:text-muted-foreground -ml-1.5 resize-none overflow-hidden text-sm"
                        ></textarea>
                        <!--
                          Qué le cambia, editable igual que el resto: es lo que
                          el docente lee para aprobar, y corregirlo antes de
                          aprobar es más barato que pedírselo al asistente.
                        -->
                        {#if item.changes !== undefined}
                          <textarea
                            rows="1"
                            bind:value={borrador.sections[s].items[i].changes}
                            use:autoAltura={borrador.sections[s].items[i].changes}
                            aria-label={item.title}
                            class="{campoClass} -ml-1.5 resize-none overflow-hidden text-sm text-(--primary)"
                          ></textarea>
                        {/if}
                      {:else}
                        <p class="text-sm font-medium {estado === 'done' ? 'ui:text-muted-foreground' : ''}">
                          {item.title}
                        </p>
                        {#if item.description}
                          <p class="ui:text-muted-foreground text-sm text-pretty">{item.description}</p>
                        {/if}
                        {#if item.changes}
                          <p class="text-sm text-pretty text-(--primary)">{item.changes}</p>
                        {/if}
                      {/if}

                      {#if confirmaciones.get(`${s}.${i}`)}
                        <p class="ui:text-muted-foreground text-xs text-pretty italic">
                          {$t('ai_assistant.plan_screen.confirmed_by_assistant', {
                            reason: confirmaciones.get(`${s}.${i}`)
                          })}
                        </p>
                      {/if}

                      {#if item.type === 'exercise' || item.hasExercise}
                        <span class="ui:text-muted-foreground mt-0.5 inline-flex items-center gap-1 text-xs">
                          <FileQuestionIcon size={12} />
                          {item.type === 'exercise'
                            ? $t('ai_assistant.plan_screen.exercise')
                            : $t('ai_assistant.plan_screen.with_exercise')}
                        </span>
                      {/if}
                    </div>
                  </li>
                {/each}
              </ul>
            </li>
          {/each}
        </ol>
      </div>
    </div>

    {#if editable}
      <footer class="sticky bottom-0 border-t bg-(--background) px-4 py-3 md:px-8">
        <div class="mx-auto flex w-full max-w-3xl flex-col gap-2">
          {#if pidiendoCambios}
            <label for="plan-screen-changes" class="sr-only">{$t('ai_assistant.plan_screen.request_changes')}</label>
            <!-- svelte-ignore a11y_autofocus -->
            <textarea
              id="plan-screen-changes"
              bind:value={cambios}
              rows="3"
              autofocus
              placeholder={$t('ai_assistant.plan_screen.changes_placeholder')}
              class="w-full resize-none rounded-xl border bg-transparent px-3 py-2 text-sm focus:border-(--ring) focus:outline-none"
              onkeydown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) enviarCambios();
                if (event.key === 'Escape') pidiendoCambios = false;
              }}
            ></textarea>
            <div class="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onclick={() => (pidiendoCambios = false)}>
                {$t('ai_assistant.plan_screen.cancel')}
              </Button>
              <Button size="sm" disabled={!cambios.trim() || ocupado} onclick={enviarCambios}>
                {$t('ai_assistant.plan_screen.send_changes')}
              </Button>
            </div>
          {:else}
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <p class="ui:text-muted-foreground min-w-0 text-xs empty:hidden sm:mr-auto">
                {#if ocupado}
                  <span class="inline-flex items-center gap-1.5">
                    <LoaderIcon size={12} class="animate-spin" />
                    {$t('ai_assistant.plan_screen.busy')}
                  </span>
                {:else if cambiosEnviadosPara && cambiosEnviadosPara === pantallaDelPlan.vigenteId}
                  {$t('ai_assistant.plan_screen.changes_sent')}
                {:else if porcentajeDelCupo !== null}
                  {$t('ai_assistant.plan_estimated_cost_pct', { pct: porcentajeDelCupo })}
                {/if}
              </p>
              <div class="grid grid-cols-2 gap-2 sm:flex">
                <Button variant="outline" size="sm" disabled={ocupado} onclick={() => (pidiendoCambios = true)}>
                  {$t('ai_assistant.plan_screen.request_changes')}
                </Button>
                <Button size="sm" disabled={ocupado || !pantallaDelPlan.acciones} onclick={aprobar}>
                  {$t('ai_assistant.plan_screen.approve')}
                </Button>
              </div>
            </div>
          {/if}
        </div>
      </footer>
    {/if}
  </section>
{/if}
