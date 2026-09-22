import { and, asc, eq } from 'drizzle-orm';
import * as schema from '@db/schema';
import { db } from '@db/drizzle';
import { CHAT_RUN_PHASE, ensureChatRun } from './chat-run';

/**
 * Plan registry — the durable binding between an approved plan item and the real
 * course row that was built from it.
 *
 * Why this exists: progress used to be reconciled by comparing plan titles to
 * course titles. The model routinely improves a title while building ("1.1
 * Introducción" for a plan item called "Introducción"), so a lesson that existed
 * was reported missing, and the anchor then ordered the model — in the strongest
 * wording of the whole prompt — to create it again. That is where duplicate
 * sections and lessons came from: not the model losing track, but the server
 * telling it to duplicate.
 *
 * A registry entry pins each plan item to a `stepKey` that survives re-planning,
 * and records the `entityId` actually created for it. Reconciliation then asks
 * "does row <uuid> still exist?" instead of "does some row have this title?".
 *
 * Storage reuses the chat-scoped run from {@link ./chat-run.ts} — one run per
 * conversation, one step per plan item — so this needs no schema change.
 */

/** What a plan item becomes in the course. */
export type PlanItemKind = 'section' | 'lesson' | 'exercise';

/** stepType for registry rows, keeping them distinct from `course_todo` steps. */
const PLAN_ITEM_STEP_TYPE = 'plan_item';

/** Qué se le hace a la pieza. Ausente = `create`, que es lo que hacía todo plan hasta ahora. */
export type PlanItemAction = 'create' | 'rewrite' | 'edit';

/**
 * Cómo estaba la pieza cuando el plan se aprobó.
 *
 * Es lo que permite decir «esto ya se hizo» sin preguntarle al modelo: si el
 * contenido cambió respecto de la línea de base, la orden se cumplió.
 */
export interface PlanItemBaseline {
  /** sha1 del contenido de la lección, o del JSON de preguntas+opciones del ejercicio. */
  contentHash: string;
}

/**
 * Un dato que hay que reemplazar dentro del target, salido del análisis de la
 * fuente nueva.
 *
 * `key` y `context` viajan con él porque la medición de «esto ya se hizo» usa
 * el MISMO matcher que el barrido: un ítem se sigue reclamando mientras la
 * frase larga o la clave (con su contexto) aparezcan. Ver `cambios-de-fuente.ts`
 * en la API — sin la clave, las preguntas quedaban con el dato viejo y nada lo
 * reclamaba.
 */
export interface PlanItemReplacement {
  old: string;
  new: string;
  /** La forma más corta y distintiva del valor viejo: «4400». */
  key?: string;
  /** Lo que tiene que estar cerca para que una coincidencia por clave cuente: «P2». */
  context?: string[];
}

/**
 * La salida declarada para un «todavía está» que el servidor no puede resolver.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * Producción, 2026-09-22. Un cambio pedía reemplazar «2 horas» con el contexto
 * `["P2", "primera respuesta"]`. La lección de escalamiento dice, legítimamente,
 * «Incidente P1 (Crítica) … Sin resolver a las 2 horas … Incidente P2 (Alta)»:
 * un diagrama, todo en un bloque, sin puntos. El `P2` queda a menos de 160
 * caracteres de esa «2 horas» que es del P1, así que el barrido dice «todavía
 * está» y el ítem NUNCA se puede dar por hecho. Costó dos rondas extra (260 s),
 * dos `replace_lesson_block` «sin cambio», y el modelo terminó escribiendo «2 h»
 * en vez de «2 horas» para conformar al riel: deformó una frase correcta para
 * salir de un bucle.
 *
 * Se probaron sobre el texto real las heurísticas deterministas (distancia,
 * oración) y ninguna distingue «la 2 horas del P1» de «la 2 horas del P2» ahí:
 * en el diagrama el P2 está MÁS cerca. Sólo el modelo puede decirlo, y no tenía
 * cómo. Esto es ese cómo, y queda guardado con su motivo para que el docente vea
 * que fue una decisión y no una medición.
 */
export interface PlanItemConfirmed {
  /** Por qué las apariciones que quedan son legítimas, en palabras del modelo. */
  reason: string;
  /** Cuándo se declaró, ISO. */
  at: string;
}

export interface PlanRegistryEntry {
  /** Stable short key the model echoes back in create_* calls (e.g. `s1`, `s1.2`). */
  key: string;
  kind: PlanItemKind;
  title: string;
  /** For lesson/exercise entries, the key of the owning section. */
  sectionKey: string | null;
  /** Position within the flattened plan, for stable display order. */
  position: number;
  /** The course row built from this plan item, once it exists. */
  entityId: string | null;
  /** `create` salvo en un plan de cambios. */
  action?: PlanItemAction;
  /** Sólo en `rewrite`/`edit`: cómo estaba el target al aprobar el plan. */
  baseline?: PlanItemBaseline;
  /** Sólo en `edit`: los datos que el análisis de la fuente encontró dentro de este target. */
  replacements?: PlanItemReplacement[];
  /** El modelo declaró que lo que queda del valor viejo es legítimo. Ver {@link PlanItemConfirmed}. */
  confirmed?: PlanItemConfirmed;
}

/**
 * Structural shape of an approved plan. Declared here rather than imported from
 * `@cio/ai-assistant` so the db package stays free of that dependency.
 *
 * Los campos de atadura (`entityId`, `action`, `baseline`, `replacements`) no
 * salen del plan que escribió el modelo: los calcula el servidor antes de
 * sincronizar (ver `plan-de-cambios.ts` en la API). Acá llegan ya resueltos,
 * porque resolver una manija necesita el curso y este paquete no lo conoce.
 */
export interface PlanShape {
  sections: Array<{
    title: string;
    /** La sección del curso que este bloque del plan ya ocupa, si existe. */
    entityId?: string | null;
    items: Array<{
      type: 'lesson' | 'exercise';
      title: string;
      /** La fila existente sobre la que este ítem actúa (`rewrite`/`edit`). */
      entityId?: string | null;
      action?: PlanItemAction;
      baseline?: PlanItemBaseline;
      replacements?: PlanItemReplacement[];
    }>;
  }>;
}

// Type aliases, not interfaces: the `input`/`output` jsonb columns are typed
// `Record<string, unknown>`, and only a type alias is structurally assignable to
// an index-signature type.
type RegistryStepInput = {
  kind: PlanItemKind;
  title: string;
  sectionKey: string | null;
  position: number;
  action?: PlanItemAction;
  baseline?: PlanItemBaseline;
  replacements?: PlanItemReplacement[];
  confirmed?: PlanItemConfirmed;
};

type RegistryStepOutput = {
  entityId?: string;
};

type RunScope = {
  orgId: string;
  courseId: string;
  conversationId?: string | null;
  userId: string;
};

function normalizeTitle(title: string | null | undefined): string {
  return (title ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Read every registry row for the conversation, INCLUDING canceled ones. A key
 * that was dropped from the plan and later restored must come back with its
 * binding intact — otherwise removing and re-adding a section in the plan would
 * orphan the lessons already built under it.
 */
async function readAllEntries(runId: string) {
  const steps = await db
    .select()
    .from(schema.aiAgentRunStep)
    .where(and(eq(schema.aiAgentRunStep.runId, runId), eq(schema.aiAgentRunStep.stepType, PLAN_ITEM_STEP_TYPE)))
    .orderBy(asc(schema.aiAgentRunStep.createdAt));

  return steps.map((step) => {
    const input = (step.input ?? {}) as Partial<RegistryStepInput>;
    const output = (step.output ?? {}) as RegistryStepOutput;

    return {
      key: step.stepKey,
      status: step.status,
      kind: (input.kind ?? 'lesson') as PlanItemKind,
      title: input.title ?? '',
      sectionKey: input.sectionKey ?? null,
      position: input.position ?? 0,
      entityId: output.entityId ?? null,
      action: input.action,
      baseline: input.baseline,
      replacements: input.replacements,
      confirmed: input.confirmed
    };
  });
}

/**
 * Reconcile an approved plan into the registry.
 *
 * Keys are matched by normalized title — sections within the plan, items within
 * their section — so an existing key (and its binding) is preserved whenever the
 * plan is regenerated or edited. Items the new plan no longer contains are marked
 * canceled rather than deleted, so their bindings survive a later restore.
 *
 * This is what makes the plan mutable: the teacher can ask for an extra section
 * mid-build, the plan is regenerated, and everything already built keeps its
 * identity instead of looking "missing" and being rebuilt.
 */
export async function syncPlanRegistry(
  params: RunScope & { plan: PlanShape }
): Promise<PlanRegistryEntry[]> {
  const run = await ensureChatRun(params);
  const now = new Date().toISOString();

  const existing = await readAllEntries(run.id);
  const usedKeys = new Set(existing.map((e) => e.key));
  const bindingByKey = new Map(existing.map((e) => [e.key, e.entityId] as const));
  /**
   * La línea de base la fija la PRIMERA sincronización y ninguna otra.
   *
   * Es lo único del registro que no se puede recalcular: mide cómo estaba la
   * lección ANTES de que la ronda la tocara. Volver a calcularla en cada ronda
   * la haría igual al contenido de ahora, o sea que un ítem `rewrite` ya hecho
   * volvería a leerse como pendiente para siempre — y el ancla lo ordenaría
   * reescribir en cada vuelta, que es el mismo defecto que producía las
   * lecciones duplicadas, con otro disfraz.
   */
  const baselineByKey = new Map(
    existing.filter((e) => e.baseline).map((e) => [e.key, e.baseline as PlanItemBaseline] as const)
  );
  /**
   * Y la confirmación del modelo también se conserva: no sale del plan, sale de
   * una declaración que ya hizo. Una sincronización que la borrara volvería a
   * reclamar un ítem que el asistente ya explicó, o sea el bucle que la
   * confirmación existe para cortar.
   */
  const confirmedByKey = new Map(
    existing.filter((e) => e.confirmed).map((e) => [e.key, e.confirmed as PlanItemConfirmed] as const)
  );

  // Existing keys indexed the way we look them up: sections by title, items by
  // (owning section key + title).
  const sectionKeyByTitle = new Map<string, string>();
  const itemKeyBySectionAndTitle = new Map<string, string>();

  for (const entry of existing) {
    if (entry.kind === 'section') {
      sectionKeyByTitle.set(normalizeTitle(entry.title), entry.key);
    } else {
      itemKeyBySectionAndTitle.set(`${entry.sectionKey ?? ''}::${normalizeTitle(entry.title)}`, entry.key);
    }
  }

  function allocateSectionKey(): string {
    for (let n = 1; ; n++) {
      const candidate = `s${n}`;
      if (!usedKeys.has(candidate)) {
        usedKeys.add(candidate);
        return candidate;
      }
    }
  }

  function allocateItemKey(sectionKey: string): string {
    for (let n = 1; ; n++) {
      const candidate = `${sectionKey}.${n}`;
      if (!usedKeys.has(candidate)) {
        usedKeys.add(candidate);
        return candidate;
      }
    }
  }

  const desired: PlanRegistryEntry[] = [];
  let position = 0;

  for (const planSection of params.plan.sections) {
    const sectionKey = sectionKeyByTitle.get(normalizeTitle(planSection.title)) ?? allocateSectionKey();

    desired.push({
      key: sectionKey,
      kind: 'section',
      title: planSection.title,
      sectionKey: null,
      position: position++,
      // La atadura que ya existe le gana a la que trae el plan: es el registro
      // de lo que se construyó de verdad. La del plan sólo sirve para una
      // sección que el plan de cambios señaló y el registro todavía no conoce.
      entityId: bindingByKey.get(sectionKey) ?? planSection.entityId ?? null
    });

    for (const item of planSection.items) {
      const lookup = `${sectionKey}::${normalizeTitle(item.title)}`;
      const itemKey = itemKeyBySectionAndTitle.get(lookup) ?? allocateItemKey(sectionKey);
      const baseline = baselineByKey.get(itemKey) ?? item.baseline;

      desired.push({
        key: itemKey,
        kind: item.type,
        title: item.title,
        sectionKey,
        position: position++,
        entityId: bindingByKey.get(itemKey) ?? item.entityId ?? null,
        ...(item.action ? { action: item.action } : {}),
        ...(baseline ? { baseline } : {}),
        ...(item.replacements ? { replacements: item.replacements } : {}),
        ...(confirmedByKey.has(itemKey) ? { confirmed: confirmedByKey.get(itemKey) as PlanItemConfirmed } : {})
      });
    }
  }

  for (const entry of desired) {
    const input: RegistryStepInput = {
      kind: entry.kind,
      title: entry.title,
      sectionKey: entry.sectionKey,
      position: entry.position,
      ...(entry.action ? { action: entry.action } : {}),
      ...(entry.baseline ? { baseline: entry.baseline } : {}),
      ...(entry.replacements ? { replacements: entry.replacements } : {}),
      ...(entry.confirmed ? { confirmed: entry.confirmed } : {})
    };
    // A bound item is 'completed', an unbound one 'queued'. `output` is left out
    // of the update set on purpose: re-syncing a plan must never drop a binding.
    const status = entry.entityId ? 'completed' : 'queued';

    await db
      .insert(schema.aiAgentRunStep)
      .values({
        runId: run.id,
        stepKey: entry.key,
        stepType: PLAN_ITEM_STEP_TYPE,
        status,
        input,
        // Un ítem que actúa sobre algo que YA existe nace atado: la fila del
        // curso no hay que construirla, hay que encontrarla, y eso ya se hizo.
        ...(entry.entityId ? { output: { entityId: entry.entityId } } : {})
      })
      .onConflictDoUpdate({
        target: [schema.aiAgentRunStep.runId, schema.aiAgentRunStep.stepKey],
        set: { status, input, updatedAt: now }
      });
  }

  const desiredKeys = new Set(desired.map((e) => e.key));

  for (const entry of existing) {
    if (!desiredKeys.has(entry.key) && entry.status !== 'canceled') {
      await db
        .update(schema.aiAgentRunStep)
        .set({ status: 'canceled', updatedAt: now })
        .where(and(eq(schema.aiAgentRunStep.runId, run.id), eq(schema.aiAgentRunStep.stepKey, entry.key)));
    }
  }

  return desired;
}

/** Read the active (non-canceled) registry, in plan order. */
export async function readPlanRegistry(params: RunScope & { runId?: string }): Promise<PlanRegistryEntry[]> {
  let runId = params.runId;

  if (!runId) {
    // Read-only path: never create a run just to read an empty registry.
    const whereConversation = params.conversationId
      ? and(
          eq(schema.aiAgentRun.conversationId, params.conversationId),
          eq(schema.aiAgentRun.userId, params.userId),
          eq(schema.aiAgentRun.phase, CHAT_RUN_PHASE)
        )
      : and(
          eq(schema.aiAgentRun.courseId, params.courseId),
          eq(schema.aiAgentRun.userId, params.userId),
          eq(schema.aiAgentRun.phase, CHAT_RUN_PHASE)
        );

    const [run] = await db
      .select({ id: schema.aiAgentRun.id })
      .from(schema.aiAgentRun)
      .where(whereConversation)
      .orderBy(asc(schema.aiAgentRun.createdAt))
      .limit(1);

    if (!run) return [];
    runId = run.id;
  }

  const entries = await readAllEntries(runId);

  return entries
    .filter((entry) => entry.status !== 'canceled')
    .map(({ key, kind, title, sectionKey, position, entityId, action, baseline, replacements, confirmed }) => ({
      key,
      kind,
      title,
      sectionKey,
      position,
      entityId,
      ...(action ? { action } : {}),
      ...(baseline ? { baseline } : {}),
      ...(replacements ? { replacements } : {}),
      ...(confirmed ? { confirmed } : {})
    }))
    .sort((a, b) => a.position - b.position);
}

/**
 * Record which course row a plan item was built into. Called by the create_*
 * tools right after a successful insert; from then on the item is identified by
 * id, and renaming it can no longer make it look missing.
 */
export async function bindPlanItem(
  params: RunScope & { planKey: string; entityId: string }
): Promise<void> {
  const run = await ensureChatRun(params);
  const now = new Date().toISOString();

  await db
    .update(schema.aiAgentRunStep)
    .set({
      status: 'completed',
      output: { entityId: params.entityId },
      finishedAt: now,
      updatedAt: now
    })
    .where(
      and(
        eq(schema.aiAgentRunStep.runId, run.id),
        eq(schema.aiAgentRunStep.stepKey, params.planKey),
        eq(schema.aiAgentRunStep.stepType, PLAN_ITEM_STEP_TYPE)
      )
    );
}

/**
 * Guarda la declaración del modelo sobre un ítem: lo que queda del valor viejo
 * es legítimo, y por qué.
 *
 * Escribe sólo `confirmed` dentro de `input`, releyendo la fila primero: el
 * resto de `input` (la acción, la línea de base, los reemplazos) es lo que el
 * ancla mide en cada ronda, y pisarlo con un objeto armado acá lo perdería.
 *
 * Devuelve `false` cuando no hay ninguna fila con esa clave: quien llama tiene
 * que poder decirle al modelo que la clave no existe, en vez de tragárselo.
 */
export async function confirmarItemDelPlan(
  params: RunScope & { planKey: string; reason: string; at?: string }
): Promise<boolean> {
  const run = await ensureChatRun(params);
  const now = new Date().toISOString();

  const [fila] = await db
    .select()
    .from(schema.aiAgentRunStep)
    .where(
      and(
        eq(schema.aiAgentRunStep.runId, run.id),
        eq(schema.aiAgentRunStep.stepKey, params.planKey),
        eq(schema.aiAgentRunStep.stepType, PLAN_ITEM_STEP_TYPE)
      )
    )
    .limit(1);

  if (!fila) return false;

  const input: RegistryStepInput = {
    ...((fila.input ?? {}) as RegistryStepInput),
    confirmed: { reason: params.reason, at: params.at ?? now }
  };

  await db
    .update(schema.aiAgentRunStep)
    .set({ input, updatedAt: now })
    .where(
      and(
        eq(schema.aiAgentRunStep.runId, run.id),
        eq(schema.aiAgentRunStep.stepKey, params.planKey),
        eq(schema.aiAgentRunStep.stepType, PLAN_ITEM_STEP_TYPE)
      )
    );

  return true;
}

/**
 * Look up the row already built for a plan key, if any. The create_* tools use
 * this to stay idempotent: a second create for the same key returns what exists
 * instead of inserting a duplicate.
 */
export async function resolvePlanBinding(
  params: RunScope & { planKey: string }
): Promise<{ key: string; kind: PlanItemKind; title: string; entityId: string } | null> {
  const entries = await readPlanRegistry(params);
  const entry = entries.find((e) => e.key === params.planKey);

  if (!entry?.entityId) return null;

  return { key: entry.key, kind: entry.kind, title: entry.title, entityId: entry.entityId };
}
