import { listarElementosDePrimerNivel, listLessonBlocks } from '@api/services/agent/lesson-blocks';

/**
 * Dónde dice el CURSO una frase, buscada entera y por significado.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * 2026-11-13, tres conversaciones iguales sobre un curso con cinco frases que
 * contradecían el documento («corregí eso»). En dos quedó una frase sin
 * corregir, y el cierre decía «implementé los ajustes». Las dos fallas:
 *
 * - En una, el asistente buscó cuatro frases en las lecciones y la quinta no la
 *   buscó nunca.
 * - En la otra buscó UNA PALABRA de la frase. La lección la usa en veinte
 *   párrafos, `search_lessons` devolvió los primeros tres, ninguno era el del
 *   error, y se fue a corregir otra lección.
 *
 * Elegir la palabra es el problema: la docente dice la frase con unas palabras
 * y la lección con otras; de doce palabras que el modelo probó, seis traían el
 * párrafo, y para una frase ninguna. Buscar la frase
 * ENTERA contra cada bloque de cada lección trajo el párrafo correcto primero
 * en cuatro de cinco y segundo en la otra, sobre 317 bloques.
 *
 * El índice que ya existe (`lesson_embedding`) no sirve para esto: guarda
 * trozos de hasta 1.800 caracteres sin saber de qué bloque salieron, así que
 * acierta la lección pero no dice qué párrafo editar. Acá se compara contra los
 * bloques de AHORA, sin índice guardado que pueda quedar viejo.
 *
 * Cuenta pura: quien incrusta se pasa por parámetro, así los tests no llaman a
 * nadie.
 */

/** Convierte textos en vectores. `null` cuando no hay con qué (sin clave, caída). */
export type Incrustador = (textos: string[]) => Promise<number[][] | null>;

export interface LeccionParaUbicar {
  id: string;
  title: string;
  content: string;
}

export interface PasajeDelCurso {
  lessonId: string;
  title: string;
  /** El bloque a editar con `replace_lesson_block`. Ausente si la lección no tiene ids. */
  blockId?: string;
  /** El texto del bloque, como lo lee el alumno. */
  text: string;
  /** Parecido con la frase, de 0 a 1. Sirve para ordenar, no para decidir. */
  similarity: number;
}

export interface FraseUbicada {
  statement: string;
  passages: PasajeDelCurso[];
}

/** Cuántos pasajes se devuelven por frase. */
export const PASAJES_POR_FRASE = 3;

/** Con menos texto que esto un bloque es un título o un rótulo, no algo que afirme. */
export const MIN_TEXTO_DE_BLOQUE = 40;

/** Lo que se muestra de un bloque largo (una tabla entera, por ejemplo). */
export const MAX_TEXTO_DE_PASAJE = 900;

const ES_TITULO = /^<h[1-6]\b/i;

function textoVisible(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Los bloques de una lección que pueden afirmar algo.
 *
 * Los títulos quedan afuera: son cortos, se parecen a cualquier frase del tema
 * («Criterios de prioridad y categorías críticas») y en la medición le ganaron
 * el primer puesto al párrafo que de verdad decía la frase.
 *
 * Una lección sin `data-block-id` (escrita antes de que existieran) se parte
 * por sus elementos de primer nivel: se la puede ubicar igual, sin `blockId`.
 */
export function bloquesQueAfirman(leccion: LeccionParaUbicar): Array<Omit<PasajeDelCurso, 'similarity'>> {
  const conId = listLessonBlocks(leccion.content).map((bloque) => ({ blockId: bloque.blockId, html: bloque.html }));
  const piezas: Array<{ blockId?: string; html: string }> =
    conId.length > 0
      ? conId
      : listarElementosDePrimerNivel(leccion.content).map((elemento) => ({
          html: leccion.content.slice(elemento.start, elemento.end)
        }));

  return piezas
    .filter((pieza) => !ES_TITULO.test(pieza.html.trimStart()))
    .map((pieza) => ({
      lessonId: leccion.id,
      title: leccion.title,
      ...(pieza.blockId ? { blockId: pieza.blockId } : {}),
      text: textoVisible(pieza.html)
    }))
    .filter((pieza) => pieza.text.length >= MIN_TEXTO_DE_BLOQUE);
}

function parecido(a: readonly number[], b: readonly number[]): number {
  let punto = 0;
  let normaA = 0;
  let normaB = 0;

  for (let i = 0; i < a.length; i += 1) {
    punto += a[i] * b[i];
    normaA += a[i] * a[i];
    normaB += b[i] * b[i];
  }

  const norma = Math.sqrt(normaA * normaB);

  return norma === 0 ? 0 : punto / norma;
}

/**
 * Los pasajes del curso más parecidos a cada frase, del más parecido al menos.
 *
 * Devuelve `null` si no se pudo incrustar: quien llama tiene que decirlo, no
 * hacer de cuenta que el curso no dice nada.
 */
export async function ubicarFrases(params: {
  frases: readonly string[];
  lecciones: readonly LeccionParaUbicar[];
  incrustar: Incrustador;
  porFrase?: number;
}): Promise<FraseUbicada[] | null> {
  const frases = params.frases.map((frase) => frase.trim()).filter(Boolean);
  const bloques = params.lecciones.flatMap(bloquesQueAfirman);

  if (frases.length === 0) return [];
  if (bloques.length === 0) return frases.map((statement) => ({ statement, passages: [] }));

  // Una sola tanda: las frases primero, los bloques después.
  const vectores = await params.incrustar([...frases, ...bloques.map((bloque) => bloque.text.slice(0, 1800))]);

  if (!vectores || vectores.length !== frases.length + bloques.length) return null;

  const porFrase = params.porFrase ?? PASAJES_POR_FRASE;

  return frases.map((statement, i) => ({
    statement,
    passages: bloques
      .map((bloque, j) => ({ ...bloque, similarity: parecido(vectores[i], vectores[frases.length + j]) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, porFrase)
      .map((pasaje) => ({
        ...pasaje,
        text: pasaje.text.length > MAX_TEXTO_DE_PASAJE ? `${pasaje.text.slice(0, MAX_TEXTO_DE_PASAJE)}…` : pasaje.text,
        similarity: Math.round(pasaje.similarity * 1000) / 1000
      }))
  }));
}

/**
 * Las frases ubicadas en esta ronda cuyo pasaje más parecido está en una
 * lección que el plan de cambios no nombra.
 *
 * ── Por qué el PRIMER pasaje y no cualquiera de los tres ─────────────────────
 *
 * En la corrida que falló, el plan sí tocaba una lección del mismo tema —la
 * segunda más parecida— y dejaba intacta la que tenía la frase. Si alcanzara
 * con tocar cualquiera de las tres, ese plan pasaba.
 *
 * El primer puesto no es infalible. La salida para cuando se equivoca ya
 * existe y la docente la ve en la tarjeta: un ítem `skip` sobre esa lección con
 * el motivo («ese párrafo no dice la frase»).
 */
export function frasesFueraDelPlan(params: {
  ubicadas: readonly FraseUbicada[];
  /** Los ids de las lecciones que el plan edita, reescribe o deja como están a propósito. */
  tocados: ReadonlySet<string>;
}): Array<{ statement: string; passage: PasajeDelCurso }> {
  return params.ubicadas.flatMap((frase) => {
    const primero = frase.passages[0];

    return primero && !params.tocados.has(primero.lessonId) ? [{ statement: frase.statement, passage: primero }] : [];
  });
}
