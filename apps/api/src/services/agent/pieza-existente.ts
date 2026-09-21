/**
 * Reconocer una pieza del curso que ya existe, aunque el plan la nombre distinto.
 *
 * ── Lo que pasó (producción, 2026-09-21) ─────────────────────────────────────
 *
 * Una docente abrió una conversación NUEVA sobre un curso ya construido para
 * sumarle una sección. El modelo rearmó el plan del curso entero y, en la
 * versión que se aprobó, les sacó el «Sección N:» a los títulos de las
 * secciones: «Historia de la Empresa» en vez de
 * «Sección 1: Historia de la Empresa».
 *
 * El registro del plan —que ata cada ítem al id de lo que se construyó para
 * él— vive POR CONVERSACIÓN, así que en una conversación nueva no hay ninguna
 * atadura y lo único que une el plan con el curso es el título. Comparado a
 * pelo, ninguna sección coincidió: el control de avance ordenó «no existe,
 * creala con todo lo de adentro», y `create_section` / `create_lesson`, que
 * sólo reusaban por atadura, obedecieron. En dos minutos el curso —publicado—
 * tenía dos secciones duplicadas con sus lecciones y una tercera paralela.
 *
 * Dos arreglos, con esta misma clave:
 *
 * - **Al comparar**, el plan contra el curso se mira por una clave que ignora
 *   la numeración, las tildes, las mayúsculas y la puntuación.
 * - **Al escribir**, las herramientas que crean miran primero si en ese lugar
 *   ya hay una pieza equivalente, y la reusan. Es la red de abajo: aunque el
 *   control de avance se equivoque, lo que ya existe no se duplica.
 *
 * Lo que NO cubre: un título reescrito con otras palabras («Conocer los
 * orígenes de la compañía» por «Conocer los orígenes y la evolución de la
 * compañía»). Ahí la clave no alcanza, y adivinar parecidos arriesga lo
 * contrario: tomar por la misma una lección que es otra.
 */

const PALABRAS_DE_NUMERACION =
  '(?:seccion|section|modulo|module|unidad|unit|leccion|lesson|parte|part|capitulo|chapter|bloque|tema)';

/** «Sección 1:», «Módulo 2 -», «Lesson 3.», «Unidad 4)». */
const PREFIJO_CON_PALABRA = new RegExp(`^${PALABRAS_DE_NUMERACION}\\s*\\d+(?:\\.\\d+)*\\s*[:.)\\-–—]?\\s*`);

/** «1.2 Tema»: un número compuesto alcanza con un espacio. */
const PREFIJO_NUMERO_COMPUESTO = /^\d+(?:\.\d+)+\s+/;

/**
 * «3. Tema», «2) Tema», «4 - Tema». Un número suelto necesita separador: sin
 * él es parte del título («5 errores comunes al cobrar»).
 */
const PREFIJO_NUMERO_CON_SEPARADOR = /^\d+\s*[.):\-–—]\s*/;

function sinTildesNiMayusculas(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function soloLetrasYNumeros(texto: string): string {
  return texto.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * La clave con la que dos títulos cuentan como la misma pieza.
 *
 * Si sacar la numeración deja el título vacío —una sección que se llama sólo
 * «Módulo 3»—, se conserva entera: una clave vacía haría iguales a todas.
 */
export function claveDeTitulo(titulo: string | null | undefined): string {
  const base = sinTildesNiMayusculas(titulo ?? '');
  const sinNumeracion = base
    .replace(PREFIJO_CON_PALABRA, '')
    .replace(PREFIJO_NUMERO_COMPUESTO, '')
    .replace(PREFIJO_NUMERO_CON_SEPARADOR, '');

  return soloLetrasYNumeros(sinNumeracion) || soloLetrasYNumeros(base);
}

/** Si dos títulos nombran la misma pieza. */
export function mismoTitulo(a: string | null | undefined, b: string | null | undefined): boolean {
  return claveDeTitulo(a) === claveDeTitulo(b);
}

type ConTitulo = { title: string | null };

/**
 * La sección del curso que ya es ésta. Si hubiera más de una —un curso que ya
 * quedó duplicado—, la primera: cualquiera sirve para no sumar otra.
 */
export function seccionEquivalente<T extends ConTitulo & { id: string }>(
  secciones: readonly T[],
  titulo: string
): T | undefined {
  return secciones.find((seccion) => mismoTitulo(seccion.title, titulo));
}

/** Lo mínimo de un ítem de `getCourseContentItems` para decidir. */
export type ItemDelCurso = ConTitulo & {
  id?: string;
  type: string;
  sectionId: string | null;
  hasNoteContent?: boolean | null;
  hasSlideContent?: boolean | null;
  videosCount?: number | null;
  questionCount?: number | null;
};

/**
 * La lección o el ejercicio que ya ocupa este lugar: misma sección, mismo
 * título. Sólo dentro de la sección: dos secciones pueden tener cada una su
 * «Autoevaluación» y no son la misma.
 *
 * `type` llega en MAYÚSCULAS desde la base (`ContentType`) y en minúsculas
 * desde el plan; se comparan las dos formas (ver `tipoDeItem` en
 * chat-context.ts, donde comparar una sola dejó un control muerto).
 */
export function piezaEquivalente<T extends ItemDelCurso>(
  items: readonly T[],
  buscada: { tipo: 'lesson' | 'exercise'; sectionId: string; titulo: string }
): T | undefined {
  return items.find(
    (item) =>
      (item.type ?? '').toLowerCase() === buscada.tipo &&
      item.sectionId === buscada.sectionId &&
      mismoTitulo(item.title, buscada.titulo)
  );
}

/**
 * Si la pieza ya tiene algo que perder. Una lección con diapositivas o video
 * cuenta como escrita, igual que en el control de avance.
 */
export function piezaConContenido(item: ItemDelCurso): boolean {
  if ((item.type ?? '').toLowerCase() === 'exercise') return (item.questionCount ?? 0) > 0;

  return item.hasNoteContent === true || Boolean(item.hasSlideContent) || (item.videosCount ?? 0) > 0;
}
