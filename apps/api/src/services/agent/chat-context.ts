import { AppError } from '@api/utils/errors';
import { getDocumentText, getDocumentSummary } from '@api/services/agent/document';
import { claveDeTitulo } from '@api/services/agent/pieza-existente';
import { redis } from '@api/utils/redis/redis';
import {
  getCourseSectionBinding,
  getExerciseCourseBinding,
  getLessonCourseBinding,
  type PlanRegistryEntry
} from '@cio/db/queries/agent';
import { z } from 'zod';
import { CoursePlanFieldsSchema, type CourseTemplateId } from '@cio/ai-assistant';
import { manijaDe, mapaDelCurso, type MapaDelCurso } from '@api/services/agent/manijas';
import { barrerValores } from '@api/services/agent/cambios-de-fuente';
import type { EstadoDelContenido } from '@api/services/agent/plan-de-cambios';

type ResourceOwnershipRow = {
  courseId: string | null;
  title?: string | null;
};

function buildResourceOwnershipError(params: {
  resourceType: 'Lesson' | 'Exercise' | 'Section';
  resourceId: string;
  courseId: string;
  resource?: ResourceOwnershipRow;
}) {
  const { resourceType, resourceId, resource } = params;

  if (!resource) {
    return new AppError(
      `${resourceType} ${resourceId} does not exist in this course. The ID may have been hallucinated — call get_course_structure to fetch real IDs and retry.`,
      'RESOURCE_NOT_IN_COURSE',
      403
    );
  }

  const titleSuffix = resource.title ? ` (${resource.title})` : '';

  return new AppError(
    `${resourceType} ${resourceId}${titleSuffix} belongs to a different course. Call get_course_structure to fetch IDs for the current course and retry.`,
    'RESOURCE_NOT_IN_COURSE',
    403
  );
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertValidUuid(
  resourceType: 'Lesson' | 'Exercise' | 'Section' | 'ExerciseSection',
  value: string
): void {
  if (!UUID_REGEX.test(value)) {
    throw new AppError(
      `${resourceType} id "${value}" is not a valid UUID. Call get_course_structure to fetch real IDs and try again — never invent or guess UUIDs.`,
      'INVALID_RESOURCE_ID',
      400
    );
  }
}

export async function verifyLessonBelongsToCourse(lessonId: string, courseId: string): Promise<void> {
  assertValidUuid('Lesson', lessonId);

  const lesson = await getLessonCourseBinding(lessonId);

  if (!lesson || lesson.courseId !== courseId) {
    throw buildResourceOwnershipError({
      resourceType: 'Lesson',
      resourceId: lessonId,
      courseId,
      resource: lesson
    });
  }
}

export async function verifyExerciseBelongsToCourse(exerciseId: string, courseId: string): Promise<void> {
  assertValidUuid('Exercise', exerciseId);

  const exercise = await getExerciseCourseBinding(exerciseId);

  if (!exercise || exercise.courseId !== courseId) {
    throw buildResourceOwnershipError({
      resourceType: 'Exercise',
      resourceId: exerciseId,
      courseId,
      resource: exercise
    });
  }
}

export async function verifySectionBelongsToCourse(sectionId: string, courseId: string): Promise<void> {
  assertValidUuid('Section', sectionId);

  const section = await getCourseSectionBinding(sectionId);

  if (!section || section.courseId !== courseId) {
    throw buildResourceOwnershipError({
      resourceType: 'Section',
      resourceId: sectionId,
      courseId,
      resource: section
    });
  }
}

type AttachedMessage = {
  metadata?: { attachment?: { documentId?: string; documentIds?: unknown } };
};

export function collectDocumentIds(messages: unknown[], currentDocumentId?: string): string[] {
  const ids = new Set<string>();

  for (const msg of messages as AttachedMessage[]) {
    const attachment = msg?.metadata?.attachment;

    if (attachment?.documentId) ids.add(attachment.documentId);

    // A message can carry more than one document — the course wizard takes up
    // to 10 files but only one of them can be *the* attachment. Reading just
    // `documentId` meant the extra uploads were never loaded into context and
    // never persisted as sources.
    if (Array.isArray(attachment?.documentIds)) {
      for (const id of attachment.documentIds) {
        if (typeof id === 'string' && id) ids.add(id);
      }
    }
  }

  if (currentDocumentId) ids.add(currentDocumentId);

  return Array.from(ids);
}

/**
 * Build the document context block. The document attached to the CURRENT user
 * message (`currentDocumentId`) is injected as full text; documents seen only in
 * prior history are injected as short cached summaries instead — this avoids
 * re-sending ~75K tokens of full document text on every follow-up turn.
 */
export async function loadDocumentsContext(
  documentIds: string[],
  currentDocumentId: string | undefined,
  userId: string,
  /**
   * When set, the full text of this document id is OMITTED from the inline
   * context — used when the document has been placed in a Gemini explicit cache
   * and is referenced via providerOptions instead of being re-sent every turn.
   */
  excludeFullTextForId?: string
): Promise<string | undefined> {
  const loaded = await Promise.all(
    documentIds.map(async (id) => {
      if (id === excludeFullTextForId) {
        // Cached separately (Gemini cachedContent) — do not inline its text.
        return null;
      }

      if (id === currentDocumentId) {
        const text = await getDocumentText(id, userId, redis);

        return text ? { id, kind: 'full' as const, body: text } : null;
      }

      const summary = await getDocumentSummary(id, redis, () => getDocumentText(id, userId, redis));

      return summary ? { id, kind: 'summary' as const, body: summary } : null;
    })
  );

  const sections = loaded
    .filter((d): d is { id: string; kind: 'full' | 'summary'; body: string } => d !== null)
    .map((d, i) =>
      d.kind === 'full'
        ? `--- Document ${i + 1} (id: ${d.id}, full text) ---\n${d.body}`
        : `--- Document ${i + 1} (id: ${d.id}, summary of a previously shared document) ---\n${d.body}`
    );

  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

type PlanMetadataMessage = {
  role?: string;
  metadata?: {
    plan?: {
      action?: string;
      payload?: unknown;
    };
  };
};

export function getLatestImplementationPlan(messages: unknown[]): z.infer<typeof CoursePlanFieldsSchema> | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as PlanMetadataMessage;

    if (message?.role !== 'user') {
      continue;
    }

    if (message?.metadata?.plan?.action !== 'implement_course_plan') {
      continue;
    }

    const parsedPlan = CoursePlanFieldsSchema.safeParse(message.metadata.plan.payload);

    if (parsedPlan.success) {
      return parsedPlan.data;
    }
  }

  return undefined;
}

/**
 * Real course item as returned by getCourseContentItems — only the fields this
 * module needs. Kept structural (not imported) so the DB row type can evolve
 * without coupling the anchor to it.
 */
type CourseItemState = {
  /** Present on rows from getCourseContentItems; the plan registry resolves by it. */
  id?: string;
  type: string;
  title: string | null;
  /** Lo que ubica la pieza dentro de su sección: de ahí sale la manija. */
  order?: number | null;
  createdAt?: string | null;
  sectionId: string | null;
  hasNoteContent?: boolean | null;
  /** Una lección puede estar escrita sin `note`: diapositivas o video. */
  hasSlideContent?: boolean | null;
  videosCount?: number | null;
  questionCount?: number | null;
};

/**
 * El tipo de un ítem llega en DOS vocabularios y hay que aceptar los dos.
 *
 * Las filas de `getCourseContentItems` vienen estampadas con `ContentType`
 * (`'LESSON'`, `'EXERCISE'`, `'SECTION'`); el plan y los arneses los escriben en
 * minúsculas. Como `type` es `string`, comparar contra una sola de las dos
 * formas no da ningún error: deja la comprobación MUERTA. Así estuvieron las dos
 * de vacío, y por eso un ejercicio sin preguntas se contaba como hecho
 * (producción, 2026-09-15: un plan declarado 38/38 con el examen final en 0
 * preguntas). Comparar `it.type` a pelo dentro de este módulo es el bug;
 * normalizar acá es el arreglo.
 */
type TipoDeItem = 'section' | 'lesson' | 'exercise' | 'otro';

function tipoDeItem(type: string | null | undefined): TipoDeItem {
  switch ((type ?? '').toLowerCase()) {
    case 'section':
      return 'section';
    case 'lesson':
      return 'lesson';
    case 'exercise':
      return 'exercise';
    default:
      return 'otro';
  }
}

/**
 * Vacía = creada y sin nada que leer. Las diapositivas y los videos cuentan como
 * contenido: marcarlas vacías dejaría un Continuar que no se apaga y le pediría
 * al modelo reescribir una lección que ya está hecha.
 */
function leccionSinContenido(item: CourseItemState): boolean {
  return item.hasNoteContent === false && !item.hasSlideContent && (item.videosCount ?? 0) === 0;
}

/**
 * `order` is read explicitly rather than trusting array position:
 * `getCourseSectionsByCourseId` has no ORDER BY, so the rows arrive in whatever
 * order Postgres happens to return.
 */
type CourseSectionState = { id: string; title: string | null; order?: number | null; createdAt?: string | null };

function normalizeTitle(title: string | null | undefined): string {
  return (title ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * La manija de una pieza del ancla.
 *
 * Una fila sin `id` (arneses viejos) queda en `?`, que es lo que ya se mostraba:
 * sin id no hay manija, y decirle al modelo «usá ?» es mejor que darle un
 * nombre falso para copiar.
 */
function manijaOInterrogante(mapa: MapaDelCurso, id: string | undefined): string {
  return id ? manijaDe(mapa, id) : '?';
}

/** Lo que el plan manda hacerle a un ítem. Ausente = `create`, como todo plan anterior. */
type AccionDelItem = 'create' | 'rewrite' | 'edit';

/**
 * Si una orden de cambio ya se cumplió, y —cuando no— qué falta exactamente.
 *
 * ── Por qué se mide y no se pregunta ─────────────────────────────────────────
 *
 * Es el mismo principio que el resto del ancla: el modelo no lleva la cuenta de
 * lo que hizo, el servidor la lee del curso. Con una diferencia de grado: en una
 * construcción «hecho» es «la fila existe», que es barato de comprobar y difícil
 * de falsear. En una edición la fila siempre existe, así que hubo que elegir qué
 * significa hecho.
 *
 * Hay dos medidas, y la primera es mucho mejor que la segunda:
 *
 * - **Con reemplazos** (la orden salió de una fuente nueva): hecho es que
 *   NINGUNO de los valores viejos aparezca ya en el target. No dice «cambió
 *   algo», dice «el 4400 ya no está», que es literalmente lo que se pidió. Y
 *   mientras siga estando, el ancla puede decir en qué bloque — así la edición
 *   siguiente es quirúrgica en vez de una reescritura entera.
 * - **Sin reemplazos** (el docente lo pidió con palabras): hecho es que el
 *   contenido difiera de la línea de base. Es débil —cualquier cambio cuenta—
 *   pero es lo único verificable que hay, y es infinitamente mejor que creerle
 *   al relato: medido, el relato dijo cinco ediciones donde hubo cuatro.
 *
 * Sin nada con qué comparar se devuelve PENDIENTE. Es la respuesta segura: un
 * ítem que se reclama de más cuesta una vuelta, y uno que se da por hecho de
 * menos deja al curso con el dato viejo y a nadie avisando.
 */
function medirCambio(params: {
  tipo: 'lesson' | 'exercise';
  entityId: string | undefined;
  estado: EstadoDelContenido | undefined;
  baseline: { contentHash: string } | undefined;
  replacements: Array<{ old: string; new: string }> | undefined;
}): { hecho: boolean; pendientes: Array<{ old: string; new: string; donde: string[]; preguntas: number[] }> } {
  const { tipo, entityId, estado, baseline, replacements } = params;

  if (!entityId || !estado) return { hecho: false, pendientes: [] };

  if (replacements && replacements.length > 0) {
    // El barrido se rehace contra el contenido de AHORA, en cada ronda: los
    // bloques se mueven cuando se edita, y un `blockId` de cuando se aprobó el
    // plan mandaría al modelo a reemplazar un bloque que ya no existe.
    const ocurrencias = barrerValores({
      valores: replacements,
      lecciones:
        tipo === 'lesson'
          ? [{ id: entityId, title: '', content: estado.textoPorLeccion.get(entityId) ?? '' }]
          : [],
      preguntas: tipo === 'exercise' ? (estado.preguntasPorEjercicio.get(entityId) ?? []) : []
    });

    const pendientes = replacements
      .map((reemplazo) => {
        const suyas = ocurrencias.filter((o) => o.valorViejo === reemplazo.old.trim());

        return {
          old: reemplazo.old,
          new: reemplazo.new,
          donde: [...new Set(suyas.map((o) => o.blockId).filter((b): b is string => !!b))],
          preguntas: [...new Set(suyas.map((o) => o.questionId).filter((q): q is number => typeof q === 'number'))],
          cuantas: suyas.length
        };
      })
      .filter((p) => p.cuantas > 0);

    return { hecho: pendientes.length === 0, pendientes };
  }

  if (!baseline) return { hecho: false, pendientes: [] };

  const actual = tipo === 'lesson' ? estado.hashPorLeccion.get(entityId) : estado.hashPorEjercicio.get(entityId);

  return { hecho: actual !== undefined && actual !== baseline.contentHash, pendientes: [] };
}

/** La orden de trabajo de un ítem pendiente, tal como la lee el modelo. */
function describirPendiente(params: {
  tipo: 'lesson' | 'exercise';
  accion: Exclude<AccionDelItem, 'create'>;
  manija: string;
  changes: string | undefined;
  pendientes: Array<{ old: string; new: string; donde: string[]; preguntas: number[] }>;
}): string {
  const { tipo, accion, manija, changes, pendientes } = params;

  if (accion === 'rewrite') {
    const como =
      tipo === 'lesson'
        ? `write_lesson with lessonId ${manija}`
        : `write_questions with exerciseId ${manija}`;

    return `♻️ TO REWRITE — ${como}${changes ? `: ${changes}` : ''}`;
  }

  if (pendientes.length === 0) {
    const como =
      tipo === 'lesson'
        ? 'edit the block that carries it with replace_lesson_block — do NOT rewrite the lesson'
        : 'update_questions';

    return `✏️ TO EDIT — ${changes ?? 'change what the plan asked for'}: ${como}`;
  }

  if (tipo === 'exercise') {
    const lista = pendientes
      .map((p) => {
        const cuales = p.preguntas.length > 0 ? `question ${p.preguntas.join(', ')}` : 'a question';

        return `${cuales} still says «${p.old}» (should be «${p.new}»)`;
      })
      .join('; ');

    return `✏️ TO EDIT — ${lista}: update_questions`;
  }

  const lista = pendientes
    .map((p) => {
      const donde =
        p.donde.length > 0
          ? ` (still present: ${p.donde.length === 1 ? 'block' : 'blocks'} ${p.donde.join(', ')})`
          : ' (still present, with no block id: use edit_lesson_content)';

      return `replace «${p.old}» → «${p.new}»${donde}`;
    })
    .join(', ');
  const conBloques = pendientes.some((p) => p.donde.length > 0);

  return `✏️ TO EDIT — ${lista}${conBloques ? ' — use replace_lesson_block on those blocks' : ''}`;
}

/**
 * Compares the approved plan (the Syllabus — the source of truth for WHAT to build)
 * against the course's REAL current state (from get_course_structure) and returns a
 * compact progress anchor injected into every implementation turn.
 *
 * This is the fix for "the agent said it finished but hadn't / skipped sub-topics":
 * the model no longer depends on the (trimmed) chat history to remember what it did.
 * It always sees, per plan item, whether it is ✅ done, ⚠️ present-but-empty, or ⬜ missing,
 * plus an explicit "you are NOT done until every ⬜/⚠️ is resolved" instruction.
 *
 * Matching is by plan-registry binding: each plan item records the id of the row
 * built from it, so reconciliation asks "does row <uuid> still exist?". Title
 * matching survives only as a fallback for plans that predate the registry.
 *
 * That distinction is the whole point. While this compared titles, a lesson the
 * model had renamed while writing it ("1.1 Introducción" for a plan item called
 * "Introducción") read as ⬜ missing, and the anchor — in the strongest wording of
 * the prompt — ordered it built again. The duplicates teachers reported were the
 * server instructing the model to duplicate, not the model losing its place.
 *
 * Returns undefined when there is no plan (nothing to anchor against).
 *
 * `pendingCount`/`emptyCount` are also surfaced so the API can tell the UI the plan
 * is not actually finished (⬜ missing + ⚠️ empty) even when the model wrongly claimed
 * completion — that's what powers the "Continue" button after a false "done".
 * `items`/`total`/`completed` are the same reconciliation as structured data, so the
 * UI checklist can render server truth instead of the model's self-report.
 */
export type PlanProgressStatus = 'done' | 'empty' | 'missing';

export interface PlanProgressItem {
  /** Registry key (`s1`, `s1.2`); empty for legacy plans with no registry. */
  key: string;
  kind: 'section' | 'lesson' | 'exercise';
  title: string;
  status: PlanProgressStatus;
}

export interface PlanProgress {
  anchorText: string;
  pendingCount: number;
  emptyCount: number;
  /**
   * Sections that exist but sit in a different position than the plan puts them.
   *
   * Existence and content were the only things checked before, so nothing in the
   * system could contradict the model when it announced a reordering it never
   * performed — it reported the order it intended while the course kept the old
   * one. Deliberately NOT wired into the auto-continue condition: a wrong order
   * the model cannot fix would spin rounds forever. It belongs in the anchor,
   * where it stops the model from claiming a reorder happened.
   */
  misorderedCount: number;
  items: PlanProgressItem[];
  total: number;
  completed: number;
}

/**
 * Whether this round's progress is worth drawing as a checklist.
 *
 * The anchor is measured on EVERY round for as long as an approved plan exists,
 * which is right for the prompt and wrong for the UI: once a course was built,
 * all of its rows reappeared under every later answer, including plain edit
 * chat where they report nothing new. A checklist earns its place when there is
 * still something outstanding, or when this round moved the count — the latter
 * covering the round that reaches 100%, so completion still announces itself.
 *
 * `completedBefore` is undefined when the round started with no measurement to
 * compare against; that counts as news rather than silence.
 */
export function isChecklistWorthShowing(progress: PlanProgress, completedBefore: number | undefined): boolean {
  if (progress.pendingCount > 0 || progress.emptyCount > 0) return true;

  return completedBefore === undefined || progress.completed !== completedBefore;
}

export function buildPlanProgressAnchor(
  plan: z.infer<typeof CoursePlanFieldsSchema> | undefined,
  sections: CourseSectionState[],
  items: CourseItemState[],
  registry: PlanRegistryEntry[] = [],
  /**
   * El contenido del curso ahora mismo, para los ítems que MODIFICAN algo.
   *
   * Sólo hace falta cuando el plan trae órdenes de cambio, así que lo pasa quien
   * ya sabe que las hay (ver `agent.ts`): para una construcción normal medirlo
   * sería tres consultas por ronda para no usarlas.
   */
  estado?: EstadoDelContenido
): PlanProgress | undefined {
  if (!plan || plan.sections.length === 0) return undefined;

  /**
   * El ancla nombra las piezas con su manija, no con su UUID.
   *
   * Es el único lugar del prompt que le pasa ids al modelo en cada ronda, y era
   * de donde salían los que después inventaba a medias: un `(id 3f2a…)` de
   * treinta y seis caracteres se copia mal. `(S1.L2)` se deriva de la estructura
   * y toda herramienta lo acepta. Ver `manijas.ts`.
   *
   * Se calcula acá adentro y no se recibe: el ancla ya tiene delante las mismas
   * secciones e ítems con que se arma el mapa, así que pedirlo por parámetro
   * sería dejar que un llamador se olvide de pasarlo.
   */
  const mapa = mapaDelCurso(
    sections,
    items.filter((it): it is CourseItemState & { id: string } => typeof it.id === 'string')
  );

  const sectionById = new Map(sections.map((s) => [s.id, s] as const));
  const itemById = new Map(
    items.filter((it) => tipoDeItem(it.type) !== 'section' && it.id).map((it) => [it.id as string, it] as const)
  );

  // El camino de respaldo compara el plan contra el curso REAL, y ahí el título
  // exacto no alcanza: en una conversación nueva no hay registro, y un plan que
  // dice «Historia de la Empresa» donde el curso dice «Sección 1: Historia de la
  // Empresa» ordenaba construir de nuevo la sección entera. Ver
  // `pieza-existente.ts`. Ante dos iguales gana la primera: cualquiera sirve
  // para no sumar una tercera.
  const sectionIdByTitle = new Map<string, string>();
  for (const s of sections) {
    const clave = claveDeTitulo(s.title);
    if (!sectionIdByTitle.has(clave)) sectionIdByTitle.set(clave, s.id);
  }

  // Index real items by sectionId + title key — the fallback path, used only
  // when a plan item has no registry binding yet.
  const itemsBySectionAndTitle = new Map<string, CourseItemState>();
  for (const it of items) {
    if (tipoDeItem(it.type) === 'section') continue;
    const clave = `${it.sectionId ?? ''}::${claveDeTitulo(it.title)}`;
    if (!itemsBySectionAndTitle.has(clave)) itemsBySectionAndTitle.set(clave, it);
  }

  // Registry lookups mirror how syncPlanRegistry assigned the keys: sections by
  // plan title, items by owning-section key + plan title.
  const registrySectionByTitle = new Map<string, PlanRegistryEntry>();
  const registryItemByPath = new Map<string, PlanRegistryEntry>();
  for (const entry of registry) {
    if (entry.kind === 'section') {
      registrySectionByTitle.set(normalizeTitle(entry.title), entry);
    } else {
      registryItemByPath.set(`${entry.sectionKey ?? ''}::${normalizeTitle(entry.title)}`, entry);
    }
  }

  /**
   * El target de una orden de cambio: manija o id, sin pasar por el registro.
   *
   * El registro es lo primero que se mira, pero puede no estar (la
   * sincronización falló, o el plan se aprobó en otra conversación). Que el
   * ancla sepa resolver una manija por su cuenta es lo que evita que un fallo de
   * la base convierta una orden de edición en un ítem sin dirección.
   */
  const resolverTarget = (valor: string | undefined, tipo: 'lesson' | 'exercise'): string | undefined => {
    const limpio = valor?.trim();

    if (!limpio) return undefined;
    if (itemById.has(limpio)) return limpio;

    const enMapa = mapa.idPorManija.get(limpio.toUpperCase());

    return enMapa?.tipo === tipo ? enMapa.id : undefined;
  };

  const lines: string[] = [];
  const progressItems: PlanProgressItem[] = [];
  let pendingCount = 0;
  let emptyCount = 0;
  /** Si esta ronda lleva órdenes de cambio, para decirlo al pie del ancla. */
  let hayOrdenesDeCambio = false;
  /** Plan position → live section, for the order check after the loop. */
  const placedSections: Array<{ planIndex: number; title: string; liveOrder: number }> = [];

  /** `[s1.2] ` prefix so the model can echo the key back in its create_* call. */
  const tag = (key: string) => (key ? `[${key}] ` : '');

  for (const [planIndex, planSection] of plan.sections.entries()) {
    const regSection = registrySectionByTitle.get(normalizeTitle(planSection.title));
    const sectionKey = regSection?.key ?? '';

    // Bound id first; title only as a fallback for pre-registry plans.
    const boundSectionId =
      regSection?.entityId && sectionById.has(regSection.entityId) ? regSection.entityId : undefined;
    const realSectionId = boundSectionId ?? sectionIdByTitle.get(claveDeTitulo(planSection.title));

    if (!realSectionId) {
      lines.push(`${tag(sectionKey)}Section "${planSection.title}" ⬜ NOT CREATED — create it and everything below.`);
      progressItems.push({ key: sectionKey, kind: 'section', title: planSection.title, status: 'missing' });
      for (const item of planSection.items) {
        pendingCount += 1;
        const itemKey = registryItemByPath.get(`${sectionKey}::${normalizeTitle(item.title)}`)?.key ?? '';
        lines.push(`  - ${tag(itemKey)}${item.type} "${item.title}" ⬜ missing`);
        progressItems.push({ key: itemKey, kind: item.type, title: item.title, status: 'missing' });
      }
      continue;
    }

    const liveSection = sectionById.get(realSectionId);
    if (typeof liveSection?.order === 'number') {
      placedSections.push({ planIndex, title: planSection.title, liveOrder: liveSection.order });
    }

    const itemStatuses: string[] = [];
    let sectionComplete = true;

    for (const item of planSection.items) {
      const regItem = registryItemByPath.get(`${sectionKey}::${normalizeTitle(item.title)}`);
      const itemKey = regItem?.key ?? '';
      const accion = (item.action ?? 'create') as AccionDelItem;

      /**
       * Un ítem que MODIFICA algo no se mide por existencia.
       *
       * Es la línea que separa las dos clases de ancla. Si esto cayera en el
       * camino de abajo, una lección que el plan manda reescribir aparecería ✅
       * apenas existe —que es siempre— y la orden se perdería en silencio: el
       * modelo leería «ya está» sobre lo único que le pidieron hacer.
       */
      if (accion !== 'create') {
        hayOrdenesDeCambio = true;

        const entityId =
          (regItem?.entityId && itemById.has(regItem.entityId) ? regItem.entityId : undefined) ??
          resolverTarget(item.target, item.type);
        const realDelCambio = entityId ? itemById.get(entityId) : undefined;
        const medida = medirCambio({
          tipo: item.type,
          entityId,
          estado,
          baseline: regItem?.baseline,
          replacements: regItem?.replacements
        });
        const donde = `"${realDelCambio?.title ?? item.title}" (${manijaOInterrogante(mapa, entityId)})`;

        if (medida.hecho) {
          itemStatuses.push(`  - ${tag(itemKey)}${item.type} ${donde} ✅`);
          progressItems.push({ key: itemKey, kind: item.type, title: item.title, status: 'done' });
          continue;
        }

        pendingCount += 1;
        sectionComplete = false;
        itemStatuses.push(
          `  - ${tag(itemKey)}${item.type} ${donde} ${describirPendiente({
            tipo: item.type,
            accion,
            manija: manijaOInterrogante(mapa, entityId),
            changes: item.changes,
            pendientes: medida.pendientes
          })}`
        );
        progressItems.push({ key: itemKey, kind: item.type, title: item.title, status: 'missing' });
        continue;
      }

      const boundItem = regItem?.entityId ? itemById.get(regItem.entityId) : undefined;
      const real = boundItem ?? itemsBySectionAndTitle.get(`${realSectionId}::${claveDeTitulo(item.title)}`);

      if (!real) {
        pendingCount += 1;
        sectionComplete = false;
        itemStatuses.push(`  - ${tag(itemKey)}${item.type} "${item.title}" ⬜ missing — create it`);
        progressItems.push({ key: itemKey, kind: item.type, title: item.title, status: 'missing' });
        continue;
      }
      // Lesson present but no written content, or exercise with no questions → not done.
      const tipoReal = tipoDeItem(real.type);

      if (tipoReal === 'lesson' && leccionSinContenido(real)) {
        emptyCount += 1;
        sectionComplete = false;
        itemStatuses.push(
          `  - ${tag(itemKey)}lesson "${real.title ?? item.title}" ⚠️ EXISTS (${manijaOInterrogante(mapa, real.id)}) BUT EMPTY — write its content, do NOT create it again`
        );
        progressItems.push({ key: itemKey, kind: item.type, title: item.title, status: 'empty' });
      } else if (tipoReal === 'exercise' && (real.questionCount ?? 0) === 0) {
        emptyCount += 1;
        sectionComplete = false;
        itemStatuses.push(
          `  - ${tag(itemKey)}exercise "${real.title ?? item.title}" ⚠️ EXISTS (${manijaOInterrogante(mapa, real.id)}) BUT HAS NO QUESTIONS — add questions, do NOT create it again`
        );
        progressItems.push({ key: itemKey, kind: item.type, title: item.title, status: 'empty' });
      } else {
        itemStatuses.push(`  - ${tag(itemKey)}${item.type} "${real.title ?? item.title}" ✅`);
        progressItems.push({ key: itemKey, kind: item.type, title: item.title, status: 'done' });
      }
    }

    lines.push(`${tag(sectionKey)}Section "${planSection.title}" ${sectionComplete ? '✅ complete' : '⬜ incomplete'}`);
    lines.push(...itemStatuses);
    progressItems.push({
      key: sectionKey,
      kind: 'section',
      title: planSection.title,
      status: sectionComplete ? 'done' : 'empty'
    });
  }

  const total = progressItems.length;
  const completed = progressItems.filter((entry) => entry.status === 'done').length;

  // Order check: walk the sections as the COURSE has them and see whether their
  // plan positions come out ascending. Comparing live `order` values to plan
  // indexes directly would false-positive on any gap in the numbering (deleted
  // sections leave holes), and only the relative sequence actually matters.
  const liveSequence = [...placedSections].sort((a, b) => a.liveOrder - b.liveOrder);
  const orderLines: string[] = [];
  for (let i = 1; i < liveSequence.length; i += 1) {
    if (liveSequence[i].planIndex < liveSequence[i - 1].planIndex) {
      orderLines.push(
        `  - "${liveSequence[i].title}" sits after "${liveSequence[i - 1].title}" in the course, but the plan puts it before.`
      );
    }
  }
  const misorderedCount = orderLines.length;

  if (pendingCount === 0 && emptyCount === 0 && misorderedCount === 0) {
    return {
      pendingCount,
      emptyCount,
      misorderedCount,
      items: progressItems,
      total,
      completed,
      /**
       * Nothing to steer, so nothing is injected.
       *
       * This used to carry "The course matches the plan… you are done", and the
       * anchor rides along on EVERY turn for the rest of the conversation — the
       * gate is only "has a plan ever been approved". So once a build finished,
       * every later request arrived alongside a server-written block headed
       * "source of truth" announcing there was nothing to do. Asked for an
       * illustration, the model answered with build status; asked again, it
       * answered with build status; given the answer to its own question, it
       * answered with build status. The teacher's actual request kept losing to
       * a heading that outranked it.
       *
       * The counts below still travel to the UI checklist. What is gone is the
       * instruction, because a finished build has none to give: the anchor
       * exists to stop the model losing track MID-build, and there is no build
       * left to track.
       */
      anchorText: ''
    };
  }

  /**
   * La orden de trabajo, dicha una sola vez al pie.
   *
   * Sin esto, el pie del ancla decía «creá lo que falta» sobre una lista donde
   * lo que falta es CAMBIAR algo que ya existe — y la instrucción más fuerte del
   * prompt entero mandaba justo lo contrario de lo que el plan pedía. Es la
   * misma forma del defecto que producía las lecciones duplicadas: el servidor
   * ordenando mal, no el modelo perdiéndose.
   */
  const changeSection = hayOrdenesDeCambio
    ? `\n\nItems marked ✏️ TO EDIT or ♻️ TO REWRITE ALREADY EXIST — never create them. Do exactly the change written beside each one and nothing else. An ✏️ line names the blocks that still carry the old value: replace those blocks with \`replace_lesson_block\` (or \`update_questions\` for a question), leaving the rest of the lesson byte-for-byte untouched. These lines are re-measured against the live course on every round, so an item stays listed until the old value is really gone — reporting it done does not remove it.`
    : '';

  const orderSection =
    misorderedCount > 0
      ? `\n\n### Section order does NOT match the plan\n${orderLines.join('\n')}\n\nThis is the course's REAL order, read from the database just now. Do not describe the order you intend — call \`reorder_content\` and fix it. Never report a reordering you have not performed.`
      : '';

  return {
    pendingCount,
    emptyCount,
    misorderedCount,
    items: progressItems,
    total,
    completed,
    anchorText: `## Plan Progress — YOU ARE NOT DONE (source of truth)

This is the REAL state of the course right now (from the live structure), compared against the approved plan. Trust THIS, not your memory of what you did — the chat history may be trimmed.

${lines.join('\n')}${changeSection}${orderSection}

${pendingCount} item(s) still missing and ${emptyCount} item(s) exist but are empty. You are NOT finished until every ⬜ and ⚠️ above is resolved. Continue implementing now — create the missing items and fill the empty ones, in plan order, without pausing to ask the teacher. Never claim the course is complete while any ⬜ or ⚠️ remains.

When you create an item, pass the \`[key]\` shown beside it as \`planKey\` (e.g. planKey: "s1.2"). Items marked ⚠️ already exist — fill them in with the handle shown beside them (e.g. S1.L2), never create them again.`
  };
}

const COURSE_TEMPLATE_ID_SET = new Set<CourseTemplateId>(['product_101', 'product_onboarding', 'expert_on_x']);

export function getActiveCourseTemplateId(messages: unknown[]): CourseTemplateId | undefined {
  for (const message of messages) {
    const candidate = message as {
      role?: string;
      metadata?: { template?: { id?: string; templateId?: string } };
    };

    if (candidate.role !== 'user') {
      continue;
    }

    // Activation marker `{ id }` (template picked, form pending) OR a wizard
    // submission `{ action: 'submit_template_answers', templateId, ... }`.
    const id = candidate.metadata?.template?.id ?? candidate.metadata?.template?.templateId;

    if (id && COURSE_TEMPLATE_ID_SET.has(id as CourseTemplateId)) {
      return id as CourseTemplateId;
    }
  }

  return undefined;
}

/**
 * Which slice of the teacher prompt — and which tools — this turn gets.
 *
 * - `build`: a plan was approved in this conversation. Implementation rules.
 * - `plan`:  nothing exists to edit yet. Planning rules, and READ-ONLY tools,
 *            which is what enforces "propose before you build".
 * - `full`:  there is already something to edit. Everything, including the
 *            content-writing rules and tools.
 *
 * `existingSectionCount` is the part that is easy to get wrong. The phase used
 * to be derived from the transcript alone, so a NEW conversation about an
 * already-built course found no approved plan and fell into `plan` — read-only.
 * The agent then told the teacher, correctly for the tools it had been given,
 * that it could not write lesson content, on a course full of lessons. A course
 * with sections is being maintained, not planned from a blank page.
 */
export function resolveTeacherPromptMode(params: {
  isTeacher: boolean;
  hasApprovedPlan: boolean;
  lessonId?: string;
  existingSectionCount: number;
}): 'plan' | 'build' | 'full' {
  const { isTeacher, hasApprovedPlan, lessonId, existingSectionCount } = params;

  // Students always get the unrestricted tutor prompt; phases are a teacher concept.
  if (!isTeacher) return 'full';
  if (hasApprovedPlan) return 'build';
  if (lessonId || existingSectionCount > 0) return 'full';

  return 'plan';
}
