<script lang="ts" module>
  /** El efecto en las notas, calculado por el servidor (`ImpactoEnLasNotas` en la API). */
  export interface ImpactoDeLaPropuesta {
    tipo: 'agregar' | 'reescribir' | 'borrar';
    entregas: number;
    maximoAntes: number;
    maximoDespues: number;
    promedioAntes: number | null;
    promedioDespues: number | null;
    agregadas?: { cantidad: number; puntos: number };
    cambios?: string[];
  }

  /** Lo que devuelve una herramienta cuando el cambio quedó propuesto. */
  export interface PropuestaConEntregas {
    status: 'needs_teacher_approval';
    proposalId: string;
    exerciseTitle: string;
    impact: ImpactoDeLaPropuesta;
  }

  export function esPropuestaConEntregas(resultado: unknown): resultado is PropuestaConEntregas {
    const r = resultado as Partial<PropuestaConEntregas> | null | undefined;

    return r?.status === 'needs_teacher_approval' && typeof r.proposalId === 'string' && !!r.impact;
  }
</script>

<script lang="ts">
  /**
   * Un cambio del asistente que toca notas, esperando a la docente.
   *
   * Medido en producción (2026-11-07): el asistente agregó doce preguntas a un
   * examen que cincuenta alumnos ya habían rendido, y las cincuenta notas
   * cayeron de ~87 % a ~42 % sin que nadie tocara una entrega. Ahora, sobre un
   * ejercicio con entregas, el servidor no escribe: guarda la propuesta con su
   * efecto calculado, y esto la muestra con «Aprobar» y «Cancelar». Aprobado, lo
   * aplica el servidor con lo guardado (ver `cambios-con-entregas.ts` en la API).
   *
   * El estado se pide al servidor al dibujarse: la propuesta pudo resolverse en
   * otra pestaña, o antes de recargar, y la tarjeta no tiene que volver a
   * ofrecer botones que ya no hacen nada.
   */
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import CircleXIcon from '@lucide/svelte/icons/circle-x';
  import { Button } from '@cio/ui/base/button';
  import { classroomio } from '$lib/utils/services/api';
  import { t } from '$lib/utils/functions/translations';

  interface Props {
    propuesta: PropuestaConEntregas;
    courseId: string;
  }

  let { propuesta, courseId }: Props = $props();

  type Estado = 'cargando' | 'pendiente' | 'aplicada' | 'cancelada' | 'fallida';

  let estado = $state<Estado>('cargando');
  let errorDelServidor = $state('');
  let enviando = $state(false);
  let errorDeEnvio = $state(false);

  const impacto = $derived(propuesta.impact);

  $effect(() => {
    const id = propuesta.proposalId;
    const curso = courseId;
    let vigente = true;

    estado = 'cargando';

    (async () => {
      try {
        const respuesta = await classroomio.agent.proposals[':proposalId'].$get({
          param: { proposalId: id },
          query: { courseId: curso }
        });
        const resultado = (await respuesta.json()) as { success?: boolean; data?: { estado?: Estado; error?: string } };

        if (!vigente) return;

        // Si no se puede leer, se ofrece decidir: el servidor igual resuelve una sola vez.
        estado = resultado?.success && resultado.data?.estado ? resultado.data.estado : 'pendiente';
        errorDelServidor = resultado?.data?.error ?? '';
      } catch {
        if (vigente) estado = 'pendiente';
      }
    })();

    return () => {
      vigente = false;
    };
  });

  async function decidir(decision: 'approve' | 'cancel') {
    enviando = true;
    errorDeEnvio = false;

    try {
      const respuesta = await classroomio.agent.proposals[':proposalId'].resolve.$post({
        param: { proposalId: propuesta.proposalId },
        json: { courseId, decision }
      });
      const resultado = (await respuesta.json()) as {
        success?: boolean;
        data?: { estado?: Estado };
        error?: string;
        message?: string;
      };

      if (resultado?.success && resultado.data?.estado) {
        estado = resultado.data.estado;
      } else if (respuesta.status === 500) {
        estado = 'fallida';
        errorDelServidor = resultado?.message ?? resultado?.error ?? '';
      } else {
        errorDeEnvio = true;
      }
    } catch {
      errorDeEnvio = true;
    } finally {
      enviando = false;
    }
  }
</script>

<div
  role="group"
  aria-label={$t('ai_assistant.graded_change.title')}
  class="rounded-xl border p-3 text-sm {estado === 'pendiente' || estado === 'cargando'
    ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100'
    : 'ui:bg-background'}"
>
  <p class="flex items-center gap-2 font-medium">
    <TriangleAlertIcon size={15} class="shrink-0" />
    {$t('ai_assistant.graded_change.title')}
  </p>

  <div class="mt-2 space-y-1 text-xs">
    <p>{$t('ai_assistant.graded_change.exercise', { title: propuesta.exerciseTitle, count: impacto.entregas })}</p>

    {#if impacto.tipo === 'borrar'}
      <p class="font-medium">{$t('ai_assistant.graded_change.delete')}</p>
    {:else}
      {#if impacto.agregadas}
        <p>
          {$t('ai_assistant.graded_change.add', { count: impacto.agregadas.cantidad, points: impacto.agregadas.puntos })}
        </p>
      {/if}
      {#if impacto.cambios?.length}
        <p>{$t('ai_assistant.graded_change.rewrite', { count: impacto.cambios.length })}</p>
        <ul class="list-disc space-y-0.5 pl-5">
          {#each impacto.cambios as cambio (cambio)}
            <li>{cambio}</li>
          {/each}
        </ul>
        <p>{$t('ai_assistant.graded_change.rewrite_note')}</p>
      {/if}
      {#if impacto.maximoAntes !== impacto.maximoDespues}
        <p class="font-medium">
          {$t('ai_assistant.graded_change.max', { before: impacto.maximoAntes, after: impacto.maximoDespues })}
          {#if impacto.promedioAntes !== null && impacto.promedioDespues !== null}
            {$t('ai_assistant.graded_change.average', { before: impacto.promedioAntes, after: impacto.promedioDespues })}
          {/if}
        </p>
      {/if}
    {/if}
  </div>

  {#if estado === 'pendiente'}
    <div class="mt-3 flex gap-2">
      <Button size="sm" disabled={enviando} onclick={() => decidir('approve')}>
        {$t('ai_assistant.graded_change.approve')}
      </Button>
      <Button size="sm" variant="outline" disabled={enviando} onclick={() => decidir('cancel')}>
        {$t('ai_assistant.graded_change.cancel')}
      </Button>
    </div>
    {#if errorDeEnvio}
      <p class="mt-2 text-xs text-red-700 dark:text-red-400">{$t('ai_assistant.graded_change.error')}</p>
    {/if}
  {:else if estado === 'aplicada'}
    <p class="mt-3 flex items-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-400">
      <CircleCheckIcon size={13} />
      {$t('ai_assistant.graded_change.applied')}
    </p>
  {:else if estado === 'cancelada'}
    <p class="ui:text-muted-foreground mt-3 flex items-center gap-1.5 text-xs">
      <CircleXIcon size={13} />
      {$t('ai_assistant.graded_change.cancelled')}
    </p>
  {:else if estado === 'fallida'}
    <p class="mt-3 text-xs text-red-700 dark:text-red-400">
      {$t('ai_assistant.graded_change.failed', { error: errorDelServidor })}
    </p>
  {/if}
</div>
