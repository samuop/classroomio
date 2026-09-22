<script lang="ts">
  import ListTreeIcon from '@lucide/svelte/icons/list-tree';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import { Button } from '@cio/ui/base/button';
  import { t } from '$lib/utils/functions/translations';
  import { contarPlan } from '$features/ai-assistant/utils/plan-summary';
  import type { CoursePlan } from '$features/ai-assistant/utils/course-plan';

  /**
   * El plan, tal como aparece en el chat: una fila que dice qué es y lo abre.
   *
   * El plan entero se revisa en su propia pantalla (`plan-screen.svelte`). Acá
   * sólo queda lo que ubica a la versión en la conversación: si es la que está
   * para revisar, una anterior, o la que ya se aprobó.
   */
  interface Props {
    plan: CoursePlan;
    /** Es la versión más nueva de la conversación. */
    isLatest: boolean;
    implemented: boolean;
    onOpen: () => void;
  }

  let { plan, isLatest, implemented, onOpen }: Props = $props();

  const cuenta = $derived(contarPlan(plan));
  const paraRevisar = $derived(isLatest && !implemented);
</script>

<div
  class="ui:bg-background flex items-center gap-3 rounded-xl border p-3 {paraRevisar
    ? 'ui:border-primary/40 shadow-sm'
    : ''}"
>
  <div
    class="flex size-9 shrink-0 items-center justify-center rounded-lg {paraRevisar
      ? 'ui:bg-primary/10 ui:text-primary'
      : 'ui:bg-muted ui:text-muted-foreground'}"
  >
    <ListTreeIcon size={18} />
  </div>

  <div class="min-w-0 flex-1">
    <p class="ui:text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
      {#if implemented}
        <span class="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
          <CircleCheckIcon size={11} />
          {$t('ai_assistant.plan_screen.approved')}
        </span>
      {:else if !isLatest}
        {$t('ai_assistant.plan_screen.previous_version')}
      {:else}
        {$t('ai_assistant.plan_screen.proposed')}
      {/if}
      <!--
        Un plan de cambios se dice: abrir esperando el temario del curso y
        encontrarse con dos ediciones es lo que hace dudar de si el asistente
        entendió el pedido.
      -->
      {#if cuenta.esDeCambios}
        · {$t('ai_assistant.plan_screen.changes_title')}
      {/if}
    </p>
    <p class="truncate text-sm font-medium" title={plan.title}>{plan.title}</p>
    <!--
      Los mismos contadores que la pantalla, y por el mismo motivo: la fila del
      chat es lo primero que el docente ve, y «5 lecciones» suena igual si las
      cinco son nuevas que si se le van a reescribir cinco que ya estaban.
    -->
    {#if cuenta.esDeCambios}
      <p class="ui:text-muted-foreground truncate text-xs">
        {$t('ai_assistant.plan_screen.affected_sections', { count: cuenta.secciones })}{#if cuenta.nuevas > 0}
          · {$t('ai_assistant.plan_screen.new_lessons', { count: cuenta.nuevas })}{/if}{#if cuenta.reescribir > 0}
          · {$t('ai_assistant.plan_screen.rewrites', { count: cuenta.reescribir })}{/if}{#if cuenta.retocar > 0}
          · {$t('ai_assistant.plan_screen.edits', { count: cuenta.retocar })}{/if}
      </p>
    {:else}
      <p class="ui:text-muted-foreground truncate text-xs">
        {$t('ai_assistant.plan_screen.sections', { count: cuenta.secciones })} ·
        {$t('ai_assistant.plan_screen.lessons', { count: cuenta.lecciones })}{#if cuenta.ejercicios > 0}
          · {$t('ai_assistant.plan_screen.exercises', { count: cuenta.ejercicios })}{/if}
      </p>
    {/if}
  </div>

  <Button size="sm" variant={paraRevisar ? 'default' : 'outline'} onclick={onOpen} class="shrink-0">
    {$t('ai_assistant.plan_screen.open')}
  </Button>
</div>
