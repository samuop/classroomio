/**
 * Addressing lesson content by block instead of by exact text.
 *
 * `edit_lesson_content` replaces by find-and-replace, so the model has to
 * reproduce the fragment it wants to change character for character — same
 * whitespace, same quoting, same HTML entities. Getting any of that wrong fails
 * the edit, and it is the most common way the agent fails at all.
 *
 * Here the SERVER cuts and splices by id and the model only writes the
 * replacement. It is the same shape of fix as `replaceDiagramAt` in diagram.ts,
 * generalised from "the Nth <svg>" to "the block called X".
 */

export const BLOCK_ID_ATTRIBUTE = 'data-block-id';

export interface LessonBlock {
  blockId: string;
  /** The block's full outer HTML, exactly as stored. */
  html: string;
  start: number;
  end: number;
}

/** A top-level element carrying some attribute, and that attribute's value. */
export interface MarkedElement {
  value: string;
  /** The element's full outer HTML, exactly as stored. */
  html: string;
  start: number;
  end: number;
}

/**
 * Matches a top-level element carrying `attribute` and everything up to its
 * matching close tag.
 *
 * Deliberately not a DOM parse: the API has no DOM, and re-serialising through
 * one would rewrite parts of the lesson this edit never touched. Scanning for
 * the tag boundary keeps every other byte identical.
 */
function openTagPattern(attribute: string): RegExp {
  return new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*\\b${attribute}\\s*=\\s*["']([^"']*)["'][^>]*>`, 'gi');
}

/** Elements that never have a closing tag, so the match ends at the open tag. */
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'wbr'
]);

/**
 * Finds where `<tag …>` opened at `openStart` closes, honouring nesting of the
 * same tag name (a `<div>` block containing a `<div>` must not stop at the
 * inner close).
 */
function findClosingIndex(content: string, tagName: string, openEnd: number): number {
  const scanner = new RegExp(`<(/?)${tagName}\\b[^>]*>`, 'gi');
  scanner.lastIndex = openEnd;

  let depth = 1;
  let match: RegExpExecArray | null;

  while ((match = scanner.exec(content)) !== null) {
    depth += match[1] === '/' ? -1 : 1;
    if (depth === 0) return scanner.lastIndex;
  }

  // Unbalanced markup: report no block rather than guessing an end and
  // truncating the rest of the lesson.
  return -1;
}

/**
 * Every top-level element carrying `attribute`, in document order.
 *
 * Generic on purpose: block ids and the writer's ungrounded-passage marks are
 * both "find the outer element that carries this attribute", and the subtle
 * part — where a tag closes when the same tag nests inside it — is the part
 * that must not exist twice. Two copies of it drift, and the one that drifts is
 * the one nobody has tests for.
 */
export function listElementsWithAttribute(content: string, attribute: string): MarkedElement[] {
  if (!content) return [];

  const found: MarkedElement[] = [];
  const pattern = openTagPattern(attribute);
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const [openTag, tagName, value] = match;
    const start = match.index;
    const openEnd = start + openTag.length;

    const isSelfClosing = openTag.endsWith('/>') || VOID_TAGS.has(tagName.toLowerCase());
    const end = isSelfClosing ? openEnd : findClosingIndex(content, tagName, openEnd);

    if (end === -1) continue;

    found.push({ value, html: content.slice(start, end), start, end });

    // Resume after the element, so a nested one carrying the same attribute is
    // not reported as a sibling — only top-level ones count.
    pattern.lastIndex = end;
  }

  return found;
}

/** Un elemento de primer nivel del cuerpo de una lección, con su tramo. */
export interface ElementoDePrimerNivel {
  tagName: string;
  /** El tag de apertura completo, tal cual está escrito. */
  openTag: string;
  start: number;
  /** Dónde termina el tag de apertura. */
  openEnd: number;
  /** Dónde termina el elemento entero, con su cierre. */
  end: number;
}

/**
 * Un comentario HTML, o un tag de apertura.
 *
 * El comentario está en la misma alternancia y no aparte porque tiene que
 * consumirse ANTES: `<!-- <p>x</p> -->` tiene adentro algo que parece un
 * elemento, y contarlo lo daría por parte del documento.
 */
const COMENTARIO_O_APERTURA = /<!--[\s\S]*?-->|<([a-z][a-z0-9]*)\b[^>]*>/gi;

/**
 * Los elementos de primer nivel del cuerpo, en orden.
 *
 * Mismo escaneo que `listElementsWithAttribute` y con el mismo motivo: sin DOM
 * y sin re-serializar, para que todo lo que no se toca salga byte a byte igual.
 * El texto suelto y los comentarios se ignoran — no son unidades direccionables
 * y el editor tampoco los trata como tales.
 */
export function listarElementosDePrimerNivel(content: string): ElementoDePrimerNivel[] {
  if (!content) return [];

  const encontrados: ElementoDePrimerNivel[] = [];
  const patron = new RegExp(COMENTARIO_O_APERTURA.source, 'gi');
  let match: RegExpExecArray | null;

  while ((match = patron.exec(content)) !== null) {
    const tagName = match[1];

    // Un comentario: ya quedó consumido entero por el patrón.
    if (!tagName) continue;

    const openTag = match[0];
    const start = match.index;
    const openEnd = start + openTag.length;
    const esAutoCerrado = openTag.endsWith('/>') || VOID_TAGS.has(tagName.toLowerCase());
    const end = esAutoCerrado ? openEnd : findClosingIndex(content, tagName, openEnd);

    /**
     * Markup desbalanceado: se corta acá y no se sigue.
     *
     * `listElementsWithAttribute` puede darse el lujo de saltearlo porque busca
     * una marca concreta. Acá no: seguir escaneando después de un tag que nunca
     * cierra deja el cursor ADENTRO de ese elemento, y todo lo que venga se
     * reportaría como de primer nivel sin serlo. Un id estampado en un `<li>`
     * anidado no es recuperable por quien lo lee después.
     */
    if (end === -1) break;

    encontrados.push({ tagName, openTag, start, openEnd, end });
    patron.lastIndex = end;
  }

  return encontrados;
}

/**
 * Los elementos que reciben id.
 *
 * Es la lista del editor (`BlockId.ts`) leída en HTML en vez de en nombres de
 * nodo de ProseMirror, más `figure`, que el editor produce envolviendo una
 * imagen.
 *
 * ── Por qué `svg` SÍ está, contra lo que decía este comentario ───────────────
 *
 * Estuvo ausente a propósito, con este argumento: «el editor entrega el svg
 * crudo a ProseMirror y no serializa sus atributos, así que un id puesto acá
 * desaparecería la primera vez que el docente guardara». Lo que costó esa
 * suposición, medido en producción el 2026-09-22: el diagrama era el ÚNICO
 * bloque sin nombre, la orden de trabajo señalaba un valor viejo que vivía
 * adentro, el modelo no tenía cómo nombrarlo y terminó reemplazando el PÁRRAFO
 * anterior por «párrafo + svg nuevo» 7 y 10 veces. Quedaron 8 y 9 diagramas
 * idénticos seguidos, una lección pasó de 7,9 KB a 29,8 KB y la ronda murió
 * contra el tope de 40 pasos. Sin un solo error en ningún lado.
 *
 * La suposición era falsa a medias, y la mitad que importa es la contraria: el
 * nodo `svgBlock` guarda el markup CRUDO (`element.outerHTML`) y lo vuelve a
 * escribir tal cual, así que un atributo que ya viene en el HTML viaja adentro
 * del markup y sobrevive. Lo que no sobrevive es un id que la extensión
 * estampara por serialización de atributos —que es de lo que hablaba
 * `BlockId.ts`— y tampoco un `<figure>` que lo envuelva: ProseMirror no tiene
 * ese nodo y lo atraviesa.
 *
 * Las dos cosas están medidas, con el editor de verdad y con el sanitizador de
 * verdad, en `apps/dashboard/src/lib/features/course/utils/
 * diagrama-en-el-editor.svelte.test.ts`.
 */
const TIPOS_CON_ID = new Set([
  'p',
  'h3',
  'h4',
  'h5',
  'ul',
  'ol',
  'blockquote',
  'pre',
  'hr',
  'img',
  'figure',
  'div',
  'table',
  'svg'
]);

/** Ocho caracteres, igual que el editor: mismo formato de id en los dos lados. */
export function generarIdDeBloque(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().slice(0, 8);
  }

  return Math.random().toString(36).slice(2, 10);
}

const ATRIBUTO_ESCRITO = new RegExp(`\\b${BLOCK_ID_ATTRIBUTE}\\s*=\\s*(["'])([^"']*)\\1`, 'i');

function idUnico(usados: Set<string>, generarId: () => string): string {
  for (let intento = 0; intento < 20; intento += 1) {
    const id = generarId();
    if (id && !usados.has(id)) return id;
  }

  // Un generador que repite —el de un test, o la rama de `Math.random` con mala
  // suerte— no puede dejar dos bloques con el mismo nombre: el empalme por id
  // se volvería ambiguo y `findLessonBlock` pegaría en el primero de los dos.
  const base = (generarId() || 'b').slice(0, 6);
  let sufijo = 2;

  while (usados.has(`${base}${sufijo}`)) sufijo += 1;

  return `${base}${sufijo}`;
}

/** Mete el atributo justo antes del cierre del tag, sin tocar lo que ya tenía. */
function conIdNuevo(openTag: string, id: string): string {
  const cierre = openTag.endsWith('/>') ? '/>' : '>';
  const cuerpo = openTag.slice(0, openTag.length - cierre.length).trimEnd();

  return `${cuerpo} ${BLOCK_ID_ATTRIBUTE}="${id}"${cierre === '/>' ? ' />' : '>'}`;
}

/**
 * Le pone `data-block-id` a cada bloque de primer nivel que no tenga uno.
 *
 * ── Por qué en el servidor ───────────────────────────────────────────────────
 *
 * Los ids los ponía SÓLO el editor TipTap del dashboard, cuando el docente abría
 * la lección y la guardaba. O sea que una lección recién escrita por el
 * asistente no tenía ni un id, y `replace_lesson_block` —el único camino que
 * cambia un dato sin reescribir la lección entera— no existía para ella. Lo
 * medido: cada corrección era una reescritura completa, y cada reescritura es
 * una oportunidad nueva de inventar («preferentemente» volvió obligatorio en una
 * de ellas).
 *
 * ── Lo que garantiza ─────────────────────────────────────────────────────────
 *
 * - Idempotente: una segunda pasada no cambia un byte.
 * - Conserva los ids existentes. Un id que cambiara entre la lectura y la
 *   escritura sería peor que no tener id, que es la misma regla que se escribió
 *   en el editor.
 * - Un id repetido (copiar y pegar un bloque) se renumera: dos bloques con un
 *   nombre hacen ambiguo el empalme.
 * - Sólo primer nivel. Un id adentro de un `<li>` o de una celda multiplica los
 *   ids sin hacer nada más direccionable.
 * - Fuera de los tags de apertura, el HTML sale byte a byte igual.
 */
export function asignarIdsDeBloque(content: string, generarId: () => string = generarIdDeBloque): string {
  if (!content) return content;

  const elementos = listarElementosDePrimerNivel(content).filter((elemento) =>
    TIPOS_CON_ID.has(elemento.tagName.toLowerCase())
  );

  if (elementos.length === 0) return content;

  const usados = new Set<string>();
  const parches: Array<{ start: number; openEnd: number; nuevoTag: string }> = [];

  // Los ids se GENERAN en orden de documento, aunque después se apliquen al
  // revés: el primer bloque de la lección tiene que quedarse con el primer id.
  // Al revés sale una lección numerada de atrás para adelante, que no rompe
  // nada pero es ilegible para quien mire el HTML después.
  for (const elemento of elementos) {
    const escrito = elemento.openTag.match(ATRIBUTO_ESCRITO);
    const actual = escrito?.[2] ?? '';

    // Un id vacío no direcciona nada (`listLessonBlocks` lo descarta), así que
    // cuenta como ausente y se le da uno de verdad.
    if (actual && !usados.has(actual)) {
      usados.add(actual);
      continue;
    }

    const id = idUnico(usados, generarId);
    usados.add(id);

    parches.push({
      start: elemento.start,
      openEnd: elemento.openEnd,
      nuevoTag: escrito
        ? elemento.openTag.replace(ATRIBUTO_ESCRITO, `${BLOCK_ID_ATTRIBUTE}="${id}"`)
        : conIdNuevo(elemento.openTag, id)
    });
  }

  if (parches.length === 0) return content;

  let resultado = content;

  // De atrás para adelante: cada parche cambia el largo del texto, y hacerlo al
  // revés correría los tramos de todos los que faltan.
  for (let i = parches.length - 1; i >= 0; i -= 1) {
    resultado = resultado.slice(0, parches[i].start) + parches[i].nuevoTag + resultado.slice(parches[i].openEnd);
  }

  return resultado;
}

/** Every addressable block in a lesson body, in document order. */
export function listLessonBlocks(content: string): LessonBlock[] {
  return listElementsWithAttribute(content, BLOCK_ID_ATTRIBUTE)
    // An empty id addresses nothing, and splicing by it would hit the first
    // block that happens to have one.
    .filter((element) => element.value.length > 0)
    .map(({ value, html, start, end }) => ({ blockId: value, html, start, end }));
}

export function findLessonBlock(content: string, blockId: string): LessonBlock | undefined {
  return listLessonBlocks(content).find((block) => block.blockId === blockId);
}

/** Splice a replacement into the slot the block occupied, leaving all else byte-identical. */
export function replaceLessonBlock(content: string, block: LessonBlock, replacement: string): string {
  return content.slice(0, block.start) + replacement + content.slice(block.end);
}

/**
 * Keeps the block's id on the replacement.
 *
 * Without this a model that returns `<p>new text</p>` silently drops the id, and
 * the block stops being addressable the moment it is first edited — which would
 * make the tool work exactly once per block.
 */
export function preserveBlockId(replacement: string, blockId: string): string {
  const trimmed = replacement.trim();
  const openTag = trimmed.match(/^<([a-z][a-z0-9]*)\b([^>]*)>/i);

  if (!openTag) return trimmed;
  if (new RegExp(`\\b${BLOCK_ID_ATTRIBUTE}\\s*=`, 'i').test(openTag[2])) return trimmed;

  const withId = `<${openTag[1]}${openTag[2]} ${BLOCK_ID_ATTRIBUTE}="${blockId}">`;
  return withId + trimmed.slice(openTag[0].length);
}

/** ¿Este bloque es un diagrama? */
export function esDiagrama(html: string): boolean {
  return /^\s*<svg\b/i.test(html);
}

/**
 * Las etiquetas `<text>` de un diagrama, en orden y sin markup.
 *
 * Es lo único legible de un `<svg>`: la geometría no se puede juzgar ni mostrar.
 * Vive acá y no en tres lugares porque las tres puntas que la necesitan —la
 * vista previa de los bloques, el texto que ve el verificador de fundamento
 * (`grounding.ts`) y la comparación entre dos diagramas de acá abajo— tienen
 * que estar mirando lo mismo.
 */
export function etiquetasDeDiagrama(svg: string): string[] {
  return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)]
    .map((m) =>
      m[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean);
}

/**
 * A compact map of the lesson for the model to choose from: the id and enough
 * text to recognise the block, without shipping the whole body back.
 */
export function summarizeLessonBlocks(content: string, previewLength = 120): Array<{ blockId: string; text: string }> {
  return listLessonBlocks(content).map((block) => {
    // Un diagrama aplanado a texto son sus etiquetas pegadas, que se leen como
    // un párrafo cortado: «P2 Alta Primera respuesta 2 horas». Dicho así, el
    // modelo no sabe que ese bloque es un dibujo y le manda un `<p>`.
    const text = esDiagrama(block.html)
      ? `[diagram: ${etiquetasDeDiagrama(block.html).join(' · ')}]`
      : block.html
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

    return {
      blockId: block.blockId,
      text: text.length > previewLength ? `${text.slice(0, previewLength)}…` : text
    };
  });
}

/** Forma comparable de una etiqueta: lo que decide si dos diagramas dicen lo mismo. */
function plegarEtiqueta(etiqueta: string): string {
  return etiqueta.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Cuánto se tienen que parecer dos diagramas seguidos para dar uno por copia
 * del otro.
 *
 * Alto a propósito. Lo que se está por borrar es contenido, así que el error
 * caro es el falso positivo: dos diagramas distintos que comparten la mitad de
 * sus etiquetas (el mismo proceso en dos variantes) tienen que quedar los dos.
 * Lo que esto caza es la copia literal —el mismo dibujo pegado ocho veces— con
 * a lo sumo una etiqueta cambiada, que es el valor que el modelo estaba
 * corrigiendo cuando lo duplicó.
 */
export const COINCIDENCIA_DE_DIAGRAMAS = 0.9;

function sonElMismoDiagrama(unoHtml: string, otroHtml: string): boolean {
  const uno = etiquetasDeDiagrama(unoHtml).map(plegarEtiqueta);
  const otro = etiquetasDeDiagrama(otroHtml).map(plegarEtiqueta);

  // Sin etiquetas no hay con qué comparar: dos dibujos de pura geometría pueden
  // ser dos dibujos distintos, y borrar uno sería tirar contenido a ciegas.
  if (uno.length === 0 || uno.length !== otro.length) return false;

  const iguales = uno.filter((etiqueta, i) => etiqueta === otro[i]).length;

  return iguales / uno.length >= COINCIDENCIA_DE_DIAGRAMAS;
}

/**
 * La red de seguridad contra el diagrama duplicado: de una tira de copias queda
 * la ÚLTIMA.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * Producción, 2026-09-22. El modelo quería corregir un valor DENTRO de un
 * diagrama que entonces no tenía id, y la única jugada que se le ocurrió fue
 * reemplazar el párrafo anterior por «párrafo + svg nuevo». El servidor conserva
 * el id del párrafo y deja el svg nuevo al lado; el viejo sigue ahí con el valor
 * viejo, así que el aviso vuelve y el modelo lo hace otra vez: 8 y 9 diagramas
 * idénticos seguidos en dos lecciones.
 *
 * El id en el `<svg>` (ver `TIPOS_CON_ID`) saca el motivo. Esto es el piso: si
 * por cualquier otro camino vuelven a quedar dos copias seguidas, la lección no
 * se guarda con las dos.
 *
 * Se conserva la ÚLTIMA porque es la nueva: en el caso medido, la copia de
 * arriba es la que todavía dice el valor viejo. Quedarse con la primera
 * significaría revertir la corrección que el modelo acababa de hacer.
 */
export function quitarDiagramasDuplicados(content: string, lessonTitle?: string): string {
  const { contenido, eliminados } = deduplicarDiagramas(content);

  if (eliminados > 0) {
    console.info(
      `[lesson-blocks] ${eliminados} diagrama(s) duplicado(s) eliminado(s)` +
        (lessonTitle ? ` en «${lessonTitle}»` : '')
    );
  }

  return contenido;
}

/**
 * Lo mismo que `quitarDiagramasDuplicados`, pero MUDO: sólo cuenta.
 *
 * La guardia de conservación deduplica los dos lados antes de comparar (ver
 * `contarPiezas` en `conservacion.ts`), o sea dos veces por cada escritura y
 * por cada edición. Con el log adentro, una lección vieja con ocho copias
 * dejaba dos líneas de «7 eliminados» por cada `replace_lesson_block` sobre
 * OTRO bloque, sin que se eliminara nada de la base, y el log que tenía que
 * decir cuándo actuó la red de seguridad dejaba de servir para eso. El log
 * queda sólo en los puntos que GUARDAN.
 */
export function deduplicarDiagramas(content: string): { contenido: string; eliminados: number } {
  if (!content || !/<svg\b/i.test(content)) return { contenido: content, eliminados: 0 };

  const elementos = listarElementosDePrimerNivel(content);
  const aBorrar: Array<{ start: number; end: number }> = [];

  for (let i = 0; i < elementos.length - 1; i += 1) {
    const actual = elementos[i];
    const siguiente = elementos[i + 1];

    if (actual.tagName.toLowerCase() !== 'svg' || siguiente.tagName.toLowerCase() !== 'svg') continue;
    // Seguidos de verdad: entre los dos no puede haber texto suelto. Si lo hay,
    // el de arriba es parte de otra cosa y no una copia colgada al lado.
    if (content.slice(actual.end, siguiente.start).trim()) continue;
    if (!sonElMismoDiagrama(content.slice(actual.start, actual.end), content.slice(siguiente.start, siguiente.end))) {
      continue;
    }

    aBorrar.push({ start: actual.start, end: actual.end });
  }

  if (aBorrar.length === 0) return { contenido: content, eliminados: 0 };

  let resultado = content;

  // De atrás para adelante: cada corte corre los tramos de los que faltan.
  for (let i = aBorrar.length - 1; i >= 0; i -= 1) {
    resultado = resultado.slice(0, aBorrar[i].start) + resultado.slice(aBorrar[i].end);
  }

  return { contenido: resultado, eliminados: aBorrar.length };
}
