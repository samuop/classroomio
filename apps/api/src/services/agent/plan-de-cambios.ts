import { createHash } from 'node:crypto';
import type { CoursePlan } from '@cio/ai-assistant';
import type { AnalisisDeFuente, PlanItemAction, PlanItemReplacement, PlanShape } from '@cio/db/queries/agent';
import type { TLocale } from '@cio/db/types';
import { getCourseContentItems } from '@cio/db/queries/course/content';
import { getCourseLessonContents } from '@cio/db/queries/lesson/language';
import { getOptionsByQuestionIds, getQuestionsByExerciseIds } from '@cio/db/queries/exercise';
import {
  esUuid,
  mapaDelCurso,
  resolverEnMapa,
  type ItemParaMapa,
  type MapaDelCurso,
  type SeccionParaMapa
} from '@api/services/agent/manijas';
import { claveDeTitulo } from '@api/services/agent/pieza-existente';
import { barrerValores, valorDelCambio, type PreguntaParaBarrer } from '@api/services/agent/cambios-de-fuente';

/**
 * Un plan que habla de lo que YA existe: atarlo al curso y fijarle la línea de
 * base.
 *
 * ── Por qué hace falta ───────────────────────────────────────────────────────
 *
 * Un plan de curso se mide por existencia: la lección está o no está. Un plan de
 * CAMBIOS no se puede medir así — la lección siempre está; lo que hay que saber
 * es si cambió. Medirlo por lo que el modelo dice que hizo es exactamente el
 * error que el registro del plan vino a arreglar para las construcciones
 * (`plan-registry.ts`): decía haber editado cinco menciones cuando editó cuatro.
 *
 * Así que cada ítem que toca algo existente se guarda con dos cosas:
 *
 * - **A qué fila apunta** (`entityId`), resuelta acá por manija, por id o por
 *   título. El plan lo nombra como puede; el servidor lo convierte en un id una
 *   sola vez y ya nadie más tiene que interpretarlo.
 * - **Cómo estaba** (`baseline.contentHash`), medido ANTES de que la ronda lo
 *   toque. Con eso, «esto ya se hizo» es una comparación y no una promesa.
 *
 * Y cuando la orden salió de una fuente nueva, además los `replacements`: los
 * valores concretos que tienen que dejar de aparecer. Es la forma más fuerte de
 * medir que existe acá, porque no dice «cambió algo», dice «el 4400 ya no está».
 */

/** Lo que `syncPlanRegistry` necesita, más lo que no se pudo atar. */
export interface PlanAtado {
  registro: PlanShape;
  /**
   * Los ítems que no se pudieron atar, en inglés y listos para devolvérselos al
   * modelo. No frenan la sincronización: un ítem sin atar queda como un ítem
   * común, que es como se comportaba todo antes de esto.
   */
  errores: string[];
}

/** Una pregunta del curso, como la ve el barrido y el hash de un ejercicio. */
export interface PreguntaDelCurso extends PreguntaParaBarrer {
  options: Array<{ id: number; label: string; isCorrect: boolean }>;
  settings: unknown;
}

/**
 * El contenido del curso ahora mismo, medido una vez por ronda.
 *
 * `textoPorLeccion` guarda el HTML y no el texto plano a propósito: el ancla
 * recalcula en cada ronda en QUÉ BLOQUE está cada valor viejo, y un `data-block-id`
 * sólo existe en el HTML. Sin eso la orden de trabajo diría «todavía está» sin
 * poder decir dónde, que es justamente el dato que convierte una edición
 * quirúrgica en posible.
 */
export interface EstadoDelContenido {
  hashPorLeccion: Map<string, string>;
  textoPorLeccion: Map<string, string>;
  hashPorEjercicio: Map<string, string>;
  textoPorEjercicio: Map<string, string>;
  /**
   * Las preguntas de cada ejercicio.
   *
   * No está en el diseño original de `estado`, y hace falta: el ancla tiene que
   * poder decir «la pregunta 521 todavía dice 4400», y desde un texto plano
   * pegado no hay forma de volver al id de la pregunta.
   */
  preguntasPorEjercicio: Map<string, PreguntaDelCurso[]>;
}

function hashDe(texto: string): string {
  return createHash('sha1').update(texto).digest('hex');
}

/**
 * El hash del cuerpo de una lección, SIN los `data-block-id`.
 *
 * ── Por qué se sacan ─────────────────────────────────────────────────────────
 *
 * Un id de bloque no es contenido: es cómo el servidor nombra un pedazo de
 * HTML. Se estampan solos —al guardar, y también al LEER una lección vieja que
 * todavía no los tenía (ver `asegurarIdsDeBloque` en `chat-tools.ts`)—, así que
 * contándolos, abrir una lección para mirarla cambiaría su hash. Y el hash es
 * lo que decide si una orden de cambio ya se ejecutó: un ítem `rewrite` habría
 * quedado ✅ por haber sido LEÍDO, y `confirm_change_applied` habría aceptado
 * una declaración sin una sola edición atrás. Que es justo lo que ese riel
 * existe para impedir.
 */
function hashDeContenido(html: string): string {
  return hashDe(html.replace(/\s*data-block-id\s*=\s*(["'])[^"']*\1/gi, ''));
}

/** El hash de un ejercicio: todo lo que una corrección puede cambiarle. */
export function hashDePreguntas(preguntas: unknown): string {
  return hashDe(JSON.stringify(preguntas ?? []));
}

/** El texto de un ejercicio, para buscar dentro: enunciados y etiquetas de opciones. */
export function textoDePreguntas(preguntas: readonly PreguntaParaBarrer[]): string {
  return preguntas
    .map((pregunta) => [pregunta.title, ...pregunta.options.map((o) => o.label)].filter(Boolean).join(' · '))
    .join('\n');
}

/**
 * Resuelve el nombre que el plan le dio a una pieza: manija, id, o título.
 *
 * Los tres caminos hacen falta y ninguno sobra. La manija es lo que el modelo
 * usa bien; el id es lo que devuelven las herramientas; y el título es la red de
 * abajo para un plan que viene de otra conversación, donde no hay registro y el
 * único puente es cómo se llama la cosa (ver `pieza-existente.ts`).
 */
function resolverPieza(params: {
  mapa: MapaDelCurso;
  valor: string;
  tipo: 'section' | 'lesson' | 'exercise';
  items: readonly ItemParaMapa[];
  secciones: readonly SeccionParaMapa[];
  /** Cuando se sabe, la sección donde buscar por título. */
  sectionId?: string;
}): string | undefined {
  const valor = params.valor.trim();

  if (!valor) return undefined;

  try {
    const resuelto = resolverEnMapa(params.mapa, valor, params.tipo);

    // Un UUID pasa por `resolverEnMapa` sin mirar el mapa: acá sí se comprueba
    // que sea de este curso, porque un id inventado con forma válida es
    // exactamente lo que este camino tiene que atajar.
    if (!esUuid(resuelto)) return resuelto;

    const existe =
      params.tipo === 'section'
        ? params.secciones.some((s) => s.id === resuelto)
        : params.items.some((i) => i.id === resuelto && (i.type ?? '').toLowerCase() === params.tipo);

    if (existe) return resuelto;
  } catch {
    // No era ni manija conocida ni id: queda el título.
  }

  const clave = claveDeTitulo(valor);

  if (!clave) return undefined;

  if (params.tipo === 'section') {
    return params.secciones.find((s) => claveDeTitulo(s.title) === clave)?.id;
  }

  return params.items.find(
    (item) =>
      (item.type ?? '').toLowerCase() === params.tipo &&
      claveDeTitulo(item.title) === clave &&
      (params.sectionId === undefined || item.sectionId === params.sectionId)
  )?.id;
}

/**
 * Ata un plan de cambios al curso: cada sección y cada ítem a su fila, y cada
 * ítem que toca algo existente a su línea de base y a sus reemplazos.
 *
 * Un plan que no es de cambios pasa tal cual: el registro sigue funcionando como
 * siempre y nada de esto lo toca.
 */
export function atarPlanDeCambios(params: {
  plan: CoursePlan;
  secciones: readonly SeccionParaMapa[];
  items: readonly ItemParaMapa[];
  lecciones: ReadonlyArray<{ id: string; title?: string | null; content: string | null }>;
  preguntasPorEjercicio: Map<string, PreguntaDelCurso[]>;
  analisis?: readonly AnalisisDeFuente[];
}): PlanAtado {
  const mapa = mapaDelCurso(params.secciones, params.items);
  const errores: string[] = [];

  const contenidoPorLeccion = new Map(params.lecciones.map((l) => [l.id, l.content ?? ''] as const));
  const tituloPorLeccion = new Map(params.lecciones.map((l) => [l.id, l.title ?? ''] as const));

  // Todos los valores que el análisis de esta conversación encontró. Se barren
  // una sola vez y después se reparten: el mismo teléfono puede estar en cuatro
  // lecciones y en una pregunta, y barrerlo una vez por ítem sería barrerlo
  // veinte veces el mismo texto.
  const valores = (params.analisis ?? []).flatMap((analisis) => analisis.cambios.map(valorDelCambio));

  const ocurrencias =
    valores.length > 0
      ? barrerValores({
          valores,
          lecciones: params.lecciones.map((l) => ({
            id: l.id,
            title: tituloPorLeccion.get(l.id) ?? '',
            content: l.content ?? ''
          })),
          preguntas: [...params.preguntasPorEjercicio.values()].flat()
        })
      : [];

  // Indexado por lo que el barrido escribe en cada ocurrencia, que es la frase
  // larga cuando existe y la clave cuando el cambio no trae otra cosa.
  const valorPorEtiqueta = new Map(valores.map((v) => [v.old.trim() || (v.key ?? '').trim(), v] as const));

  const reemplazosDe = (entityId: string): PlanItemReplacement[] => {
    const encontrados = new Map<string, PlanItemReplacement>();

    for (const ocurrencia of ocurrencias) {
      if (ocurrencia.lessonId !== entityId && ocurrencia.exerciseId !== entityId) continue;

      const valor = valorPorEtiqueta.get(ocurrencia.valorViejo);

      if (!valor) continue;

      // La clave y el contexto viajan con el reemplazo: el ancla los vuelve a
      // barrer en cada ronda, y sin ellos mediría distinto de como se buscó.
      encontrados.set(ocurrencia.valorViejo, {
        old: valor.old,
        new: valor.new,
        ...(valor.key ? { key: valor.key } : {}),
        ...(valor.context && valor.context.length > 0 ? { context: [...valor.context] } : {})
      });
    }

    return [...encontrados.values()];
  };

  const registro: PlanShape = { sections: [] };

  for (const seccionDelPlan of params.plan.sections) {
    const sectionId = seccionDelPlan.sectionId
      ? resolverPieza({
          mapa,
          valor: seccionDelPlan.sectionId,
          tipo: 'section',
          items: params.items,
          secciones: params.secciones
        })
      : undefined;

    if (seccionDelPlan.sectionId && !sectionId) {
      errores.push(
        `Section "${seccionDelPlan.title}": sectionId "${seccionDelPlan.sectionId}" does not match any section of this course.`
      );
    }

    const items: PlanShape['sections'][number]['items'] = [];

    for (const item of seccionDelPlan.items) {
      const action = (item.action ?? 'create') as PlanItemAction;

      if (action === 'create') {
        items.push({ type: item.type, title: item.title, action });
        continue;
      }

      if (!item.target?.trim()) {
        errores.push(`Item "${item.title}" has action "${action}" but no target: say which existing piece it acts on.`);
        items.push({ type: item.type, title: item.title, action });
        continue;
      }

      const entityId = resolverPieza({
        mapa,
        valor: item.target,
        tipo: item.type,
        items: params.items,
        secciones: params.secciones,
        sectionId
      });

      if (!entityId) {
        errores.push(
          `Item "${item.title}": target "${item.target}" does not match any ${item.type} of this course. Use the handle from get_course_structure.`
        );
        items.push({ type: item.type, title: item.title, action });
        continue;
      }

      const baseline = {
        contentHash:
          item.type === 'lesson'
            ? hashDeContenido(contenidoPorLeccion.get(entityId) ?? '')
            : hashDePreguntas(params.preguntasPorEjercicio.get(entityId) ?? [])
      };
      const replacements = reemplazosDe(entityId);

      items.push({
        type: item.type,
        title: item.title,
        action,
        entityId,
        baseline,
        ...(replacements.length > 0 ? { replacements } : {}),
        // Se deja como está, y el motivo ya está en el plan que el docente
        // aprobó. El ancla no tiene nada que medir acá. Ver `medirCambio`.
        ...(item.skip ? { skip: true } : {})
      });
    }

    registro.sections.push({
      title: seccionDelPlan.title,
      ...(sectionId ? { entityId: sectionId } : {}),
      items
    });
  }

  return { registro, errores };
}

/**
 * El contenido del curso ahora mismo, en el idioma de la ronda.
 *
 * Una sola pasada: las lecciones en una consulta, las preguntas de todos los
 * ejercicios en dos más. Se llama una vez por ronda y su resultado lo comparten
 * la atadura del plan y el ancla, porque las dos tienen que estar mirando el
 * mismo curso — si midieran en momentos distintos, un ítem podría estar hecho
 * para una y pendiente para la otra.
 */
export async function estadoDelContenido(courseId: string, locale: string): Promise<EstadoDelContenido> {
  const [lecciones, items] = await Promise.all([
    getCourseLessonContents(courseId, locale as TLocale),
    getCourseContentItems(courseId)
  ]);

  const hashPorLeccion = new Map<string, string>();
  const textoPorLeccion = new Map<string, string>();

  for (const leccion of lecciones) {
    const contenido = leccion.content ?? '';
    hashPorLeccion.set(leccion.id, hashDeContenido(contenido));
    textoPorLeccion.set(leccion.id, contenido);
  }

  const exerciseIds = items
    .filter((item) => (item.type ?? '').toLowerCase() === 'exercise')
    .map((item) => item.id)
    .filter((id): id is string => typeof id === 'string');

  const preguntasPorEjercicio = new Map<string, PreguntaDelCurso[]>();
  const hashPorEjercicio = new Map<string, string>();
  const textoPorEjercicio = new Map<string, string>();

  if (exerciseIds.length > 0) {
    const preguntas = await getQuestionsByExerciseIds(exerciseIds);
    const ids = preguntas
      .map((pregunta) => pregunta.id)
      .filter((id): id is number => typeof id === 'number');
    const opciones = ids.length > 0 ? await getOptionsByQuestionIds(ids) : [];
    const opcionesPorPregunta = new Map<number, Array<{ id: number; label: string; isCorrect: boolean }>>();

    for (const opcion of opciones) {
      const lista = opcionesPorPregunta.get(opcion.questionId) ?? [];
      lista.push({ id: opcion.id, label: opcion.label ?? '', isCorrect: !!opcion.isCorrect });
      opcionesPorPregunta.set(opcion.questionId, lista);
    }

    for (const pregunta of preguntas) {
      const exerciseId = pregunta.exerciseId;

      if (!exerciseId || typeof pregunta.id !== 'number') continue;

      const lista = preguntasPorEjercicio.get(exerciseId) ?? [];
      lista.push({
        id: pregunta.id,
        exerciseId,
        // `question.title` es el ENUNCIADO: la columna se llama así en la base.
        title: pregunta.title ?? '',
        options: opcionesPorPregunta.get(pregunta.id) ?? [],
        settings: pregunta.settings ?? null
      });
      preguntasPorEjercicio.set(exerciseId, lista);
    }

    for (const exerciseId of exerciseIds) {
      const lista = preguntasPorEjercicio.get(exerciseId) ?? [];
      // Orden estable: la base no garantiza ninguno y un hash que depende del
      // orden de llegada cambiaría solo, marcando como hecho lo que nadie tocó.
      lista.sort((a, b) => a.id - b.id);
      hashPorEjercicio.set(exerciseId, hashDePreguntas(lista));
      textoPorEjercicio.set(exerciseId, textoDePreguntas(lista));
    }
  }

  return { hashPorLeccion, textoPorLeccion, hashPorEjercicio, textoPorEjercicio, preguntasPorEjercicio };
}
