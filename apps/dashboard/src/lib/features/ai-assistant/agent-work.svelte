<script lang="ts">
  import CheckIcon from '@lucide/svelte/icons/check';
  import LoaderIcon from '@lucide/svelte/icons/loader';
  import CircleIcon from '@lucide/svelte/icons/circle';
  import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
  import ToolLine from '$features/ai-assistant/utils/tool-line.svelte';
  import { renderMarkdown } from '$features/ai-assistant/utils/markdown';
  import { actividadDelAgente, duracionLegible } from '$features/ai-assistant/utils/activity';
  import { getAgentStepsForMessage } from '$features/ai-assistant/utils/tool-parts';
  import type { NombrarPorId, ProgressStep } from '$features/ai-assistant/utils/tool-labels';
  import type { AiAssistantMessage } from '$features/ai-assistant/utils/types';
  import { t } from '$lib/utils/functions/translations';

  /**
   * Lo que el agente hizo en una respuesta, y lo que está haciendo mientras la escribe.
   *
   * Mientras trabaja: UNA línea viva con la acción concreta y los segundos. Antes
   * era una tarjeta con la lista de pasos creciendo y un «Pensando en su
   * solicitud...» fijo entre paso y paso, que decía que algo pasaba pero no qué.
   *
   * Al terminar: una fila plegada —«Trabajó 59 s · 4 pasos»— que se despliega con
   * el razonamiento y las acciones. El detalle queda a un clic y deja de competir
   * con la respuesta, que es lo que el docente vino a leer.
   */
  interface Props {
    message: AiAssistantMessage | null;
    /** Esta respuesta se está escribiendo ahora. */
    isLive: boolean;
    /** Cuándo empezó la ronda, para el contador en vivo. */
    startedAt?: number | null;
    /** Lo que el modelo escribió mientras trabajaba, antes de su última acción. */
    thoughts?: string[];
    courseId: string;
    onNavigate: (route: string) => void;
    nombrar?: NombrarPorId;
    /** Reintentar sólo la acción que falló. Sin esto no se ofrece. */
    onRetryStep?: (step: ProgressStep) => void;
  }

  let { message, isLive, startedAt = null, thoughts = [], courseId, onNavigate, nombrar, onRetryStep }: Props =
    $props();

  const actividad = $derived(actividadDelAgente((message?.parts ?? []) as unknown[], nombrar));
  const steps = $derived(message ? getAgentStepsForMessage(message) : []);
  const durationMs = $derived(message?.metadata?.durationMs);

  let expanded = $state(false);
  let reloj = $state(Date.now());

  $effect(() => {
    if (!isLive) return;

    reloj = Date.now();
    const intervalo = setInterval(() => (reloj = Date.now()), 1000);

    return () => clearInterval(intervalo);
  });

  const segundosEnVivo = $derived(startedAt ? Math.max(0, Math.floor((reloj - startedAt) / 1000)) : null);

  const trabajo = $derived.by(() => {
    if (isLive || typeof durationMs !== 'number') return null;

    const { minutos, segundos } = duracionLegible(durationMs);

    return minutos > 0
      ? $t('ai_assistant.activity.worked_minutes', { minutes: minutos, seconds: segundos })
      : $t('ai_assistant.activity.worked_seconds', { seconds: segundos });
  });

  const hayDetalle = $derived(steps.length > 0 || thoughts.length > 0);
  const mostrarResumen = $derived(hayDetalle || !!trabajo);

  function stepRowKey(step: ProgressStep, index: number): string {
    return `${index}-${step.toolName ?? ''}-${step.status}-${JSON.stringify(step.line)}`;
  }
</script>

{#if isLive}
  <div class="flex min-w-0 items-center gap-2.5 py-1 text-sm" aria-live="polite">
    <span class="relative flex size-2 shrink-0" aria-hidden="true">
      <span class="absolute inline-flex size-full animate-ping rounded-full bg-(--primary)/50 motion-reduce:animate-none"
      ></span>
      <span class="ui:bg-primary relative inline-flex size-2 rounded-full"></span>
    </span>

    <span class="agent-shimmer min-w-0 truncate">
      {#if actividad.ahora.tipo === 'herramienta'}
        <ToolLine line={actividad.ahora.linea} {courseId} {onNavigate} />
      {:else if actividad.ahora.tipo === 'escribiendo'}
        {$t('ai_assistant.activity.writing')}
      {:else if actividad.ahora.titulo}
        {actividad.ahora.titulo}
      {:else}
        {$t('ai_assistant.activity.thinking')}
      {/if}
    </span>

    {#if segundosEnVivo !== null}
      <span class="ui:text-muted-foreground shrink-0 text-xs tabular-nums">{segundosEnVivo} s</span>
    {/if}
  </div>
{/if}

{#if mostrarResumen}
  <div class="flex flex-col">
    <button
      type="button"
      class="ui:text-muted-foreground inline-flex w-fit items-center gap-1 rounded py-0.5 text-xs transition-colors hover:text-(--foreground) disabled:cursor-default disabled:hover:text-(--muted-foreground)"
      onclick={() => (expanded = !expanded)}
      aria-expanded={expanded}
      disabled={!hayDetalle}
    >
      {#if trabajo}<span>{trabajo}</span>{/if}
      {#if trabajo && actividad.pasos > 0}<span aria-hidden="true">·</span>{/if}
      {#if actividad.pasos > 0}
        <span>{$t('ai_assistant.activity.steps', { count: actividad.pasos })}</span>
      {:else if !trabajo && thoughts.length > 0}
        <span>{$t('ai_assistant.activity.thoughts')}</span>
      {/if}
      {#if actividad.fallidos > 0}
        <span class="text-red-600 dark:text-red-400">
          · {$t('ai_assistant.activity.failed_steps', { count: actividad.fallidos })}
        </span>
      {/if}
      {#if hayDetalle}
        <ChevronRightIcon size={12} class="shrink-0 transition-transform duration-150 {expanded ? 'rotate-90' : ''}" />
      {/if}
    </button>

    {#if expanded && hayDetalle}
      <div class="ui:border-border mt-1.5 mb-1 flex flex-col gap-3 border-l-2 py-1 pl-3">
        {#if thoughts.length > 0}
          <div class="flex flex-col gap-1.5">
            <p class="ui:text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              {$t('ai_assistant.activity.thoughts')}
            </p>
            {#each thoughts as thought, index (index)}
              <div
                class="ai-chat-prose prose prose-sm dark:prose-invert ui:text-muted-foreground max-w-none text-xs break-words"
              >
                <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                {@html renderMarkdown(thought)}
              </div>
            {/each}
          </div>
        {/if}

        {#if steps.length > 0}
          <div class="flex flex-col gap-0.5">
            {#if thoughts.length > 0}
              <p class="ui:text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                {$t('ai_assistant.activity.actions')}
              </p>
            {/if}
            {#each steps as step, index (stepRowKey(step, index))}
              <div class="flex min-w-0 items-center gap-2 py-0.5 text-xs">
                {#if step.status === 'completed'}
                  <CheckIcon size={12} class="ui:text-primary shrink-0" />
                {:else if step.status === 'in_progress'}
                  <LoaderIcon size={12} class="ui:text-primary shrink-0 animate-spin" />
                {:else if step.status === 'failed'}
                  <AlertCircleIcon size={12} class="shrink-0 text-red-500" />
                {:else}
                  <CircleIcon size={12} class="ui:text-muted-foreground shrink-0" />
                {/if}
                <span class="min-w-0 {step.status === 'pending' ? 'ui:text-muted-foreground' : ''}">
                  <ToolLine line={step.line} {courseId} {onNavigate} />
                </span>
                {#if step.status === 'failed' && onRetryStep && !isLive}
                  <button
                    type="button"
                    onclick={() => onRetryStep(step)}
                    class="ui:text-muted-foreground ml-auto flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors hover:bg-(--muted)"
                  >
                    <RotateCwIcon size={11} />
                    {$t('ai_assistant.retry_step')}
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  /*
   * El brillo que recorre la línea viva: dice «esto está pasando ahora» sin un
   * spinner más. Con movimiento reducido queda el texto quieto, en gris.
   */
  .agent-shimmer {
    background: linear-gradient(
      90deg,
      var(--muted-foreground) 0%,
      var(--muted-foreground) 35%,
      var(--foreground) 50%,
      var(--muted-foreground) 65%,
      var(--muted-foreground) 100%
    );
    background-size: 250% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: agent-shimmer 2.4s linear infinite;
  }

  @keyframes agent-shimmer {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: 0% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .agent-shimmer {
      animation: none;
      background: none;
      -webkit-text-fill-color: currentColor;
      color: var(--muted-foreground);
    }
  }
</style>
