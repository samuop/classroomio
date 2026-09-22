export type AgentToolProgressStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/** Render in UI via `ToolLine` / `$t` — no user-facing literals in `.ts`. */
export type ToolLineUi =
  | { shape: 'i18n'; key: string; vars?: Record<string, string | number> }
  | { shape: 'lesson_written'; lessonId: string; title: string; charCount: number }
  | {
      shape: 'exercise_questions';
      exerciseId: string;
      title: string;
      count: number;
      action: 'added' | 'updated';
    }
  /** Course landing page editor (same path as sidebar "Landing page"). Title may be empty. */
  | { shape: 'landing_page_updated'; title: string };

export interface ProgressStep {
  status: AgentToolProgressStatus;
  indent?: boolean;
  line: ToolLineUi;
  /**
   * Which tool produced this step. Carried so a FAILED step can be retried on
   * its own: without it the card knows something broke but not what to ask for
   * again, and the only recourse is re-sending the whole turn — which re-does
   * every action that already succeeded.
   */
  toolName?: string;
  /** Error text from the failed call, quoted back to the agent on retry. */
  errorText?: string;
}

const TOOLS_WITH_PENDING_COPY = new Set([
  'get_course_structure',
  'get_lesson_content',
  'get_exercise_details',
  'create_section',
  'update_section',
  'create_lesson',
  'update_lesson',
  'update_lesson_content',
  'edit_lesson_content',
  'replace_lesson_block',
  'create_exercise',
  'create_exercise_section',
  'update_exercise',
  'update_exercise_section',
  'add_questions',
  'write_questions',
  'update_questions',
  'reorder_content',
  'update_course_landing_page',
  'check_course_go_live_readiness',
  'go_live_course',
  'generate_course_plan',
  'ask_template_questions',
  'ask_discovery_questions',
  'fetch_documentation_url',
  'search_web',
  'generate_image',
  'read_source',
  'search_document',
  'delete_lesson',
  'delete_exercise',
  'delete_section',
  'write_lesson',
  'read_lessons',
  'analyze_source_changes',
  'confirm_change_applied'
]);

/** i18n key for the running / pending description of `toolName` */
export function getPendingToolI18nKey(toolName: string): string {
  if (TOOLS_WITH_PENDING_COPY.has(toolName)) {
    return `ai_assistant.tool.pending.${toolName}`;
  }

  return 'ai_assistant.tool.pending.unknown_tool';
}

export function getPendingToolI18nVars(toolName: string): Record<string, string | number | undefined> | undefined {
  if (TOOLS_WITH_PENDING_COPY.has(toolName)) {
    return undefined;
  }

  return { toolName };
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const v = record[key];
  return typeof v === 'string' ? v : undefined;
}

function prettifyUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');

    return `${parsed.host}${path}${parsed.search}`;
  } catch {
    return rawUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
}

function readPositiveInt(record: Record<string, unknown>, key: string): number {
  const v = record[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;

  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

export function getCompletedToolLine(toolName: string, result: unknown): ToolLineUi {
  const r = (result ?? {}) as Record<string, unknown>;

  switch (toolName) {
    case 'create_section':
      return {
        shape: 'i18n',
        key: 'ai_assistant.tool.done.create_section',
        vars: { title: readString(r, 'title') ?? '' }
      };
    // Los tres borrados dicen QUÉ se borró, no "listo". Es la única acción del
    // agente que no se puede deshacer: el docente tiene que poder leer en el
    // registro qué desapareció, sin abrir nada.
    case 'delete_lesson':
      return {
        shape: 'i18n',
        key: 'ai_assistant.tool.done.delete_lesson',
        vars: { title: readString(r, 'title') ?? '' }
      };
    case 'delete_exercise':
      return {
        shape: 'i18n',
        key: 'ai_assistant.tool.done.delete_exercise',
        vars: { title: readString(r, 'title') ?? '' }
      };
    case 'delete_section':
      return {
        shape: 'i18n',
        key: 'ai_assistant.tool.done.delete_section',
        vars: { title: readString(r, 'title') ?? '' }
      };
    case 'read_lessons':
      return {
        shape: 'i18n',
        key: 'ai_assistant.tool.done.read_lessons',
        vars: { count: readPositiveInt(r, 'count') }
      };
    // Comparar una fuente con el curso no cambia nada: lo que el docente
    // necesita leer en el registro es CUÁNTO encontró, porque de eso depende si
    // el plan que viene después tiene uno o diez ítems.
    case 'analyze_source_changes':
      return {
        shape: 'i18n',
        key: 'ai_assistant.tool.done.analyze_source_changes',
        vars: { count: Array.isArray(r.changes) ? r.changes.length : 0 }
      };
    // Dar por hecho un ítem porque el asistente lo declaró no es lo mismo que
    // medirlo: el registro lo dice con todas las letras, para que el docente
    // pueda ir a mirar.
    case 'confirm_change_applied':
      return {
        shape: 'i18n',
        key: 'ai_assistant.tool.done.confirm_change_applied',
        vars: { title: readString(r, 'title') ?? '' }
      };
    case 'read_source':
      return {
        shape: 'i18n',
        key: 'ai_assistant.tool.done.read_source',
        vars: {
          title: readString(r, 'fileName') ?? '',
          from: readPositiveInt(r, 'fromLine'),
          to: readPositiveInt(r, 'toLine'),
          total: readPositiveInt(r, 'totalLines')
        }
      };
    case 'update_section':
      return {
        shape: 'i18n',
        key: 'ai_assistant.tool.done.update_section',
        vars: { title: readString(r, 'title') ?? '' }
      };
    case 'create_lesson':
      return {
        shape: 'i18n',
        key: 'ai_assistant.tool.done.create_lesson',
        vars: { title: readString(r, 'title') ?? '' }
      };
    case 'update_lesson':
      return {
        shape: 'i18n',
        key: 'ai_assistant.tool.done.update_lesson',
        vars: { title: readString(r, 'title') ?? '' }
      };
    // write_lesson devuelve los mismos campos que update_lesson_content a
    // propósito: para el docente las dos son "se escribió esta lección", y el
    // enlace a la lección es lo que importa, no qué agente la redactó.
    case 'write_lesson':
    case 'update_lesson_content': {
      const lessonId = readString(r, 'lessonId') ?? '';
      const rawTitle = readString(r, 'lessonTitle');
      const displayTitle = rawTitle && rawTitle.trim().length > 0 ? rawTitle : '';
      const contentLength = readPositiveInt(r, 'contentLength');

      if (lessonId && displayTitle) {
        return { shape: 'lesson_written', lessonId, title: displayTitle, charCount: contentLength };
      }

      return {
        shape: 'i18n',
        key: 'ai_assistant.tool.done.update_lesson_content_fallback',
        vars: { count: contentLength }
      };
    }
    // Same completion copy as edit_lesson_content: from the teacher's side both
    // are "one part of this lesson changed" — how the server found the part is
    // not something they need to read about.
    case 'replace_lesson_block':
    case 'edit_lesson_content': {
      const lessonId = readString(r, 'lessonId') ?? '';
      const rawTitle = readString(r, 'lessonTitle');
      const displayTitle = rawTitle && rawTitle.trim().length > 0 ? rawTitle : '';
      const contentLength = readPositiveInt(r, 'contentLength');

      if (lessonId && displayTitle) {
        return { shape: 'lesson_written', lessonId, title: displayTitle, charCount: contentLength };
      }

      return {
        shape: 'i18n',
        key: 'ai_assistant.tool.done.edit_lesson_content_fallback',
        vars: { count: contentLength }
      };
    }
    case 'create_exercise': {
      const count = readPositiveInt(r, 'questionCount');
      const title = readString(r, 'title') ?? '';
      const exerciseId = readString(r, 'id') ?? '';

      if (exerciseId && title) {
        return { shape: 'exercise_questions', exerciseId, title, count, action: 'added' };
      }

      return { shape: 'i18n', key: 'ai_assistant.tool.done.create_exercise', vars: { title, count } };
    }
    case 'update_exercise':
      return {
        shape: 'i18n',
        key: 'ai_assistant.tool.done.update_exercise',
        vars: { title: readString(r, 'title') ?? '' }
      };
    case 'update_exercise_section':
      return {
        shape: 'i18n',
        key: 'ai_assistant.tool.done.update_exercise_section',
        vars: { title: readString(r, 'title') ?? '' }
      };
    case 'add_questions': {
      const exerciseId = readString(r, 'exerciseId') ?? '';
      const rawTitle = readString(r, 'exerciseTitle');
      const displayTitle = rawTitle && rawTitle.trim().length > 0 ? rawTitle : '';
      const addedCount = readPositiveInt(r, 'addedCount');

      if (exerciseId && displayTitle) {
        return { shape: 'exercise_questions', exerciseId, title: displayTitle, count: addedCount, action: 'added' };
      }

      return {
        shape: 'i18n',
        key: 'ai_assistant.tool.done.add_questions_fallback',
        vars: { count: addedCount }
      };
    }
    // Para el docente es lo mismo que `add_questions`: este ejercicio tiene
    // tantas preguntas más. Que las haya escrito un sub-agente desde el texto
    // de las lecciones es asunto del servidor, no algo que haya que leer acá.
    case 'write_questions': {
      const exerciseId = readString(r, 'exerciseId') ?? '';
      const rawTitle = readString(r, 'title');
      const displayTitle = rawTitle && rawTitle.trim().length > 0 ? rawTitle : '';
      const addedCount = readPositiveInt(r, 'added');

      if (exerciseId && displayTitle) {
        return { shape: 'exercise_questions', exerciseId, title: displayTitle, count: addedCount, action: 'added' };
      }

      return {
        shape: 'i18n',
        key: 'ai_assistant.tool.done.write_questions_fallback',
        vars: { count: addedCount }
      };
    }
    case 'update_questions': {
      const exerciseId = readString(r, 'exerciseId') ?? '';
      const rawTitle = readString(r, 'exerciseTitle');
      const displayTitle = rawTitle && rawTitle.trim().length > 0 ? rawTitle : '';
      const updatedCount = readPositiveInt(r, 'updatedCount');

      if (exerciseId && displayTitle) {
        return { shape: 'exercise_questions', exerciseId, title: displayTitle, count: updatedCount, action: 'updated' };
      }

      return {
        shape: 'i18n',
        key: 'ai_assistant.tool.done.update_questions_fallback',
        vars: { count: updatedCount }
      };
    }
    case 'create_exercise_section':
      return {
        shape: 'i18n',
        key: 'ai_assistant.tool.done.create_exercise_section',
        vars: { title: readString(r, 'title') ?? '' }
      };
    case 'get_course_structure':
      return { shape: 'i18n', key: 'ai_assistant.tool.done.get_course_structure' };
    case 'get_lesson_content':
      return { shape: 'i18n', key: 'ai_assistant.tool.done.get_lesson_content' };
    case 'get_exercise_details':
      return { shape: 'i18n', key: 'ai_assistant.tool.done.get_exercise_details' };
    case 'reorder_content':
      return { shape: 'i18n', key: 'ai_assistant.tool.done.reorder_content' };
    case 'update_course_landing_page':
      return { shape: 'landing_page_updated', title: readString(r, 'title')?.trim() ?? '' };
    case 'check_course_go_live_readiness': {
      const blockers = r.blockers;
      const blockerCount = Array.isArray(blockers) ? blockers.length : 0;
      const warnings = r.warnings;
      const warningCount = Array.isArray(warnings) ? warnings.length : 0;

      if (blockerCount === 0) {
        return {
          shape: 'i18n',
          key: 'ai_assistant.tool.done.check_go_live_ready',
          vars: { warningCount }
        };
      }

      return { shape: 'i18n', key: 'ai_assistant.tool.done.check_go_live_blocked', vars: { blockerCount } };
    }
    case 'go_live_course': {
      const isPublished = r.isPublished === true;
      return isPublished
        ? {
            shape: 'i18n',
            key: 'ai_assistant.tool.done.go_live_published',
            vars: { title: readString(r, 'title') ?? '' }
          }
        : { shape: 'i18n', key: 'ai_assistant.tool.done.go_live_not_published' };
    }
    case 'generate_course_plan':
      return { shape: 'i18n', key: 'ai_assistant.tool.done.generate_course_plan' };
    case 'ask_template_questions':
      return { shape: 'i18n', key: 'ai_assistant.tool.done.ask_template_questions' };
    case 'ask_discovery_questions':
      return { shape: 'i18n', key: 'ai_assistant.tool.done.ask_discovery_questions' };
    case 'fetch_documentation_url': {
      const rawUrl = readString(r, 'url') ?? '';

      return {
        shape: 'i18n',
        key: 'ai_assistant.tool.done.fetch_documentation_url',
        vars: { url: rawUrl ? prettifyUrl(rawUrl) : '' }
      };
    }
    case 'search_web': {
      const results = (r as { results?: unknown }).results;

      return {
        shape: 'i18n',
        key: 'ai_assistant.tool.done.search_web',
        vars: {
          query: readString(r, 'query') ?? '',
          count: Array.isArray(results) ? results.length : 0
        }
      };
    }
    default:
      return { shape: 'i18n', key: 'ai_assistant.tool.done.generic' };
  }
}

/**
 * Lo que el panel conoce por nombre y la herramienta sólo trae como id: el
 * archivo de una fuente, el título de una lección. Sin esto la línea de «qué
 * está haciendo» decía «Leyendo una fuente» mientras el agente leía un archivo
 * concreto, que es justo lo que el docente quiere saber.
 */
export type NombrarPorId = (id: string) => string | undefined;

/** Tools whose running line can name what they touch. */
const LESSON_TOOLS_WITH_NAMED_COPY = new Set([
  'write_lesson',
  'get_lesson_content',
  'edit_lesson_content',
  'replace_lesson_block',
  'update_lesson_content'
]);

function getNamedPendingLine(
  toolName: string,
  record: Record<string, unknown>,
  nombrar?: NombrarPorId
): ToolLineUi | null {
  if (toolName === 'search_document') {
    const query = readString(record, 'query');

    return query ? { shape: 'i18n', key: 'ai_assistant.tool.pending.search_document_with_query', vars: { query } } : null;
  }

  if (toolName === 'read_source') {
    const sourceId = readString(record, 'sourceId');
    const name = sourceId ? nombrar?.(sourceId) : undefined;

    return name
      ? {
          shape: 'i18n',
          key: 'ai_assistant.tool.pending.read_source_named',
          vars: { name, from: readPositiveInt(record, 'offset') || 1 }
        }
      : null;
  }

  if (toolName === 'create_lesson') {
    const title = readString(record, 'title');

    return title ? { shape: 'i18n', key: 'ai_assistant.tool.pending.create_lesson_named', vars: { title } } : null;
  }

  if (LESSON_TOOLS_WITH_NAMED_COPY.has(toolName)) {
    const lessonId = readString(record, 'lessonId');
    const title = readString(record, 'title') ?? (lessonId ? nombrar?.(lessonId) : undefined);

    return title ? { shape: 'i18n', key: `ai_assistant.tool.pending.${toolName}_named`, vars: { title } } : null;
  }

  return null;
}

export function getPendingToolLine(toolName: string, input?: unknown, nombrar?: NombrarPorId): ToolLineUi {
  if (typeof input === 'object' && input !== null) {
    const named = getNamedPendingLine(toolName, input as Record<string, unknown>, nombrar);

    if (named) return named;
  }

  if (toolName === 'search_web') {
    const query =
      typeof input === 'object' && input !== null ? readString(input as Record<string, unknown>, 'query') : undefined;

    if (query) {
      return {
        shape: 'i18n',
        key: 'ai_assistant.tool.pending.search_web_with_query',
        vars: { query }
      };
    }
  }

  if (toolName === 'fetch_documentation_url') {
    const rawUrl =
      typeof input === 'object' && input !== null ? readString(input as Record<string, unknown>, 'url') : undefined;

    if (rawUrl) {
      return {
        shape: 'i18n',
        key: 'ai_assistant.tool.pending.fetch_documentation_url_with_url',
        vars: { url: prettifyUrl(rawUrl) }
      };
    }
  }

  return {
    shape: 'i18n',
    key: getPendingToolI18nKey(toolName),
    vars: getPendingToolI18nVars(toolName) as Record<string, string | number> | undefined
  };
}

export const MUTATION_TOOLS = [
  'create_section',
  'update_section',
  'create_lesson',
  'update_lesson',
  'update_lesson_content',
  'edit_lesson_content',
  'replace_lesson_block',
  'create_exercise',
  'create_exercise_section',
  'update_exercise',
  'update_exercise_section',
  'add_questions',
  'write_questions',
  'update_questions',
  'reorder_content',
  'update_course_landing_page',
  'go_live_course',
  'write_lesson',
  // Los borrados cambian la estructura igual que las altas. Fuera de esta
  // lista, una ronda que sólo borra no refresca el curso mientras corre (los
  // umbrales de `ai-course-chat.svelte` se saltean sin `hasMutations`) y la
  // tarjeta dice "trabajando" en vez de "aplicando cambios".
  'delete_lesson',
  'delete_exercise',
  'delete_section'
];
