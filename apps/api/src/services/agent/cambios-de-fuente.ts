import { generateObject } from 'ai';
import { z } from 'zod';
import { createModel, resolveModelName, type AIProviderConfig } from '@cio/ai-assistant';
import { buscarEnLecciones } from '@api/services/agent/lesson-search';
import { normalizarParaComparar } from '@api/services/agent/grounding';
import { recordTokenUsage } from '@api/services/agent/usage';

/**
 * Qué del curso cambia cuando el docente sube una circular nueva.
 *
 * ── Qué problema resuelve ────────────────────────────────────────────────────
 *
 * Medido el 2026-09-21: «actualizá la sección con esta circular» salió bien, y
 * costó 153 segundos y la reescritura completa de cuatro lecciones para cambiar
 * TRES datos. El agente no tenía cómo saber cuáles eran los tres: leyó el
 * documento, leyó las lecciones, y como no podía distinguir lo que cambiaba de
 * lo que no, reescribió todo. Cada reescritura es una oportunidad nueva de
 * inventar — en esa misma ronda un «preferentemente» del material salió
 * convertido en obligatorio.
 *
 * Acá el trabajo se parte en dos mitades, y la división es el punto:
 *
 * 1. **Un modelo decide qué dato quedó viejo.** Es un juicio: «el teléfono de
 *    la mesa de ayuda pasó de 4400 a WhatsApp» no se deduce comparando cadenas.
 * 2. **El servidor barre dónde está ese dato.** Es cuenta: el modelo dice
 *    «4400», el servidor encuentra las seis apariciones, en qué lección y en
 *    qué bloque. Un valor que el modelo dice que está y no aparece en ninguna
 *    parte se descarta acá mismo, antes de llegar al plan.
 *
 * Lo que sale es una lista de ediciones puntuales con su dirección exacta. Eso
 * es lo que convierte «actualizá esto» en un plan de cambios que el docente
 * puede leer y aprobar — y en una orden de trabajo que el servidor puede
 * medir, porque sabe cuál es el valor que tiene que dejar de aparecer.
 */

/** Un valor que hay que reemplazar, y por cuál. */
export interface ValorACambiar {
  old: string;
  new: string;
}

/** Lo mínimo de una lección para barrerla. */
export interface LeccionParaBarrer {
  id: string;
  title: string;
  /** El HTML guardado: de ahí salen los `data-block-id` de cada aparición. */
  content: string;
}

/** Lo mínimo de una pregunta para barrerla: su enunciado y las etiquetas de sus opciones. */
export interface PreguntaParaBarrer {
  id: number;
  exerciseId: string;
  title: string;
  options: ReadonlyArray<{ id: number; label: string }>;
}

/** Dónde apareció un valor viejo. */
export interface OcurrenciaDeValor {
  valorViejo: string;
  lessonId?: string;
  /** El bloque de la lección que lo contiene, cuando lo tiene: es lo que `replace_lesson_block` pide. */
  blockId?: string;
  exerciseId?: string;
  questionId?: number;
  /** El texto alrededor, para que el docente y el modelo entiendan de qué aparición se habla. */
  texto: string;
}

/**
 * Tope de apariciones por lección.
 *
 * Bastante más alto que el de `search_lessons` (3) porque acá no se está
 * buscando «dónde dice esto» para leerlo: se está armando la orden de trabajo, y
 * una aparición que no entra en la lista es una que nadie va a cambiar y que el
 * ancla va a seguir reclamando para siempre.
 */
const MAX_POR_LECCION = 20;

/** Tope total por valor, por si un valor es una palabra común que aparece en todo el curso. */
const MAX_POR_VALOR = 60;

/** El enunciado, recortado, para nombrar una pregunta sin volcarla entera. */
function recorte(texto: string, largo = 120): string {
  const limpio = texto.replace(/\s+/g, ' ').trim();

  return limpio.length > largo ? `${limpio.slice(0, largo)}…` : limpio;
}

/**
 * Dónde está cada valor viejo, en las lecciones y en las preguntas.
 *
 * Determinista y sin base ni modelo: es lo que hace que «todavía está» sea una
 * afirmación verificable y no una opinión. El ancla lo vuelve a correr en cada
 * ronda contra el contenido de ese momento, así que los `blockId` que muestra
 * son siempre los de ahora y no los de cuando se aprobó el plan.
 */
export function barrerValores(params: {
  valores: readonly ValorACambiar[];
  lecciones?: readonly LeccionParaBarrer[];
  preguntas?: readonly PreguntaParaBarrer[];
}): OcurrenciaDeValor[] {
  const ocurrencias: OcurrenciaDeValor[] = [];
  const lecciones = params.lecciones ?? [];
  const preguntas = params.preguntas ?? [];

  for (const valor of params.valores) {
    const viejo = valor.old.trim();

    if (!viejo) continue;

    let contadas = 0;

    if (lecciones.length > 0) {
      const coincidencias = buscarEnLecciones({
        lecciones: lecciones.map((leccion) => ({
          id: leccion.id,
          title: leccion.title,
          content: leccion.content
        })),
        texto: viejo,
        maxPorLeccion: MAX_POR_LECCION,
        maxTotal: MAX_POR_VALOR
      });

      for (const coincidencia of coincidencias) {
        ocurrencias.push({
          valorViejo: viejo,
          lessonId: coincidencia.lessonId,
          ...(coincidencia.blockId ? { blockId: coincidencia.blockId } : {}),
          texto: coincidencia.fragmento
        });
        contadas += 1;
      }
    }

    // Las preguntas no son HTML y no tienen bloques: se comparan normalizadas,
    // con el mismo plegado que usa la evidencia de una pregunta, para que un
    // guion o una tilde de más no escondan una aparición real.
    const aguja = normalizarParaComparar(viejo);

    if (!aguja) continue;

    for (const pregunta of preguntas) {
      if (contadas >= MAX_POR_VALOR) break;

      const enElEnunciado = normalizarParaComparar(pregunta.title).includes(aguja);
      const opcion = pregunta.options.find((o) => normalizarParaComparar(o.label).includes(aguja));

      if (!enElEnunciado && !opcion) continue;

      ocurrencias.push({
        valorViejo: viejo,
        exerciseId: pregunta.exerciseId,
        questionId: pregunta.id,
        texto: enElEnunciado ? recorte(pregunta.title) : `${recorte(pregunta.title, 80)} → "${recorte(opcion!.label, 60)}"`
      });
      contadas += 1;
    }
  }

  return ocurrencias;
}

/** Un dato del curso que el documento nuevo deja viejo, tal como lo devuelve el analista. */
export interface CambioDetectado {
  valorViejo: string;
  valorNuevo: string;
  motivo: string;
  /** La lección donde el analista cree que está. Orientativa: la ubicación la fija el barrido. */
  leccion?: string;
}

export interface LeccionParaAnalizar {
  handle: string;
  title: string;
  text: string;
}

export type AnalistaDeCambios = (params: {
  fuenteNueva: { fileName: string; text: string };
  lecciones: LeccionParaAnalizar[];
}) => Promise<{ cambios: CambioDetectado[] }>;

/**
 * Tope de texto de lecciones que se le muestra al analista.
 *
 * 150.000 caracteres son unas 37.000 fichas. Entra un curso normal entero, que
 * es lo que hace falta: la pregunta es «qué del CURSO cambia», y una lección que
 * no se le mostró es una lección donde el dato viejo se queda. Lo que no entra
 * se corta con una marca que se la dice, para que no afirme sobre lo que no vio.
 */
export const PRESUPUESTO_LECCIONES_CHARS = 150_000;

export function armarLecciones(
  lecciones: readonly LeccionParaAnalizar[],
  presupuesto = PRESUPUESTO_LECCIONES_CHARS
): { texto: string; recortadas: string[] } {
  if (lecciones.length === 0) return { texto: '', recortadas: [] };

  // Reparto por nivelación, igual que en `lesson-writer.ts`: repartir en partes
  // iguales por orden de llegada deja a la lección corta con un cupo que no usa
  // y recorta a la larga sin necesidad.
  const cupos = new Array<number>(lecciones.length);
  let restante = presupuesto;

  lecciones
    .map((l, i) => ({ largo: l.text.length, i }))
    .sort((a, b) => a.largo - b.largo)
    .forEach(({ largo, i }, k, orden) => {
      const parte = Math.floor(restante / (orden.length - k));
      cupos[i] = Math.min(largo, parte);
      restante -= cupos[i];
    });

  const recortadas: string[] = [];

  const bloques = lecciones.map((l, i) => {
    if (cupos[i] >= l.text.length) return `--- ${l.handle} "${l.title}" ---\n${l.text}`;

    recortadas.push(l.title);

    return (
      `--- ${l.handle} "${l.title}" (only the first part — it did not fit) ---\n${l.text.slice(0, cupos[i])}\n` +
      `[… the rest of "${l.title}" was not shown to you. Do not claim anything about what you have not read.]`
    );
  });

  return { texto: bloques.join('\n\n'), recortadas };
}

const Resultado = z.object({
  changes: z
    .array(
      z.object({
        old: z
          .string()
          .min(1)
          .describe(
            'The OLD value exactly as it appears in the lesson — verbatim, at most 6 words. A number, a phone, a time range, a name, a code. Not a sentence, not a paraphrase: the server searches the course for this string.'
          ),
        new: z.string().min(1).describe('The value the new document gives instead.'),
        why: z.string().min(1).describe('One sentence: where in the new document this is stated and what it supersedes.'),
        lesson: z.string().optional().describe('The handle of the lesson you saw it in, if you can tell (e.g. S2.L3).')
      })
    )
    .describe('Every fact of the course the new document changes. Empty when it changes nothing.')
});

const SISTEMA = `You compare a NEW document against the lessons of a course that is already written, and list every fact in the lessons that the document changes or supersedes.

For each one give: the OLD value as it appears in the lesson (verbatim, at most 6 words — a number, a phone, a time range, a name, a code), the NEW value from the document, and why.

Rules:
- Only facts the document actually CONTRADICTS or REPLACES. A fact the document merely repeats, confirms or mentions is NOT a change.
- The old value must be a short literal string that is really in the lesson text you were shown. The server searches the course for it: a paraphrase finds nothing and the change is dropped.
- Do not invent a change to seem useful. An empty list is the correct answer when the document changes nothing, and it is a useful answer.
- Do not propose editorial improvements, reorganisations or additions. This is only about facts that are now wrong.`;

/**
 * El analista: un sub-agente que mira UN documento nuevo contra las lecciones y
 * nada más.
 *
 * Contexto limpio a propósito, igual que el escritor de lecciones: el agente que
 * conversa con el docente arrastra el hilo entero, y acá lo único que importa es
 * el texto del documento y el texto del curso.
 */
export function crearAnalistaDeCambios(params: {
  orgId: string;
  userId: string;
  courseId: string;
  providerConfig: AIProviderConfig;
}): AnalistaDeCambios {
  const modelName =
    process.env.AGENT_ANALYSIS_MODEL?.trim() ||
    params.providerConfig.model ||
    resolveModelName(params.providerConfig.provider);
  const model = createModel({ ...params.providerConfig, model: modelName });

  return async ({ fuenteNueva, lecciones }) => {
    const armado = armarLecciones(lecciones);
    const inicio = Date.now();

    const { object, usage } = await generateObject({
      model,
      schema: Resultado,
      system: SISTEMA,
      prompt: [
        `## The NEW document: ${fuenteNueva.fileName}\n\n${fuenteNueva.text}`,
        `## The course's lessons as they are written today\n\n${armado.texto || '(no lesson text)'}`
      ].join('\n\n'),
      maxRetries: 1
    });

    await recordTokenUsage(
      params.orgId,
      params.userId,
      params.courseId,
      {
        promptTokens: usage.inputTokens ?? 0,
        completionTokens: usage.outputTokens ?? 0,
        totalTokens: usage.totalTokens ?? 0,
        cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens || undefined,
        cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens || undefined
      },
      modelName,
      params.providerConfig.provider
    ).catch((error) => console.error('[analista-de-cambios] no se pudo registrar el consumo:', error));

    const cambios = (object.changes ?? []).map((cambio) => ({
      valorViejo: cambio.old.trim(),
      valorNuevo: cambio.new.trim(),
      motivo: cambio.why.trim(),
      ...(cambio.lesson?.trim() ? { leccion: cambio.lesson.trim() } : {})
    }));

    console.info(
      `[analista-de-cambios] "${fuenteNueva.fileName}": ${lecciones.length} lección(es), ` +
        `${armado.texto.length} caracteres, ${cambios.length} cambio(s), ` +
        `${((Date.now() - inicio) / 1000).toFixed(1)} s` +
        (armado.recortadas.length ? `, recortadas: ${armado.recortadas.join(', ')}` : '')
    );

    return { cambios };
  };
}
