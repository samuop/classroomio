/**
 * Leer dos veces el mismo tramo de una fuente en la misma ronda.
 *
 * ── Lo que se midió (producción, 2026-09-12) ─────────────────────────────────
 *
 * Una ronda de 40 pasos hizo 31 `read_source`: el mismo taller diez veces, otro
 * ocho, otro siete, siempre desde la línea 1. No es descuido: desde el paso 5 la
 * ronda recorta de su contexto los resultados de herramientas anteriores a los
 * últimos mensajes, así que lo leído desaparece y el modelo vuelve a buscarlo.
 * Cada relectura se recorta a su vez, y el ciclo no termina.
 *
 * Avisarle en qué paso iba ya se probó dos veces: el aviso llega y la conducta
 * no cambia. Lo que sí funcionó en este proyecto con el mismo problema —las
 * imágenes pedidas dos veces— fue que la herramienta conteste con un hecho en el
 * momento de repetir, en vez de repetir el trabajo.
 *
 * ── Qué hace ─────────────────────────────────────────────────────────────────
 *
 * La segunda lectura IDÉNTICA (misma fuente, mismo desde, mismo cuánto) no
 * devuelve el texto otra vez: devuelve una nota que dice qué pasa y qué hacer.
 * Un tramo distinto de la misma fuente se lee normalmente, así que leer alrededor
 * de un pasaje que encontró la búsqueda sigue funcionando.
 */

export interface LecturaRegistrada {
  fileName: string;
  desde: number;
  hasta: number;
  /** El paso de la ronda en que se leyó, si se sabe. */
  paso?: number;
}

/**
 * La identidad de una lectura, con los valores por defecto ya puestos.
 *
 * Sin normalizar, «sin offset» y «offset 1» serían dos lecturas distintas del
 * mismo texto, y el modelo alterna entre las dos formas.
 */
export function claveDeLectura(params: {
  sourceId: string;
  offset?: number;
  limit?: number;
  limitePorDefecto: number;
}): string {
  const desde = Math.max(1, Math.floor(params.offset ?? 1));
  const cuantas = Math.max(1, Math.floor(params.limit ?? params.limitePorDefecto));

  return `${params.sourceId}:${desde}:${cuantas}`;
}

/** Lo que vuelve en lugar del texto, cuando la lectura ya se hizo en esta ronda. */
export function notaDeRelectura(previa: LecturaRegistrada): string {
  const cuando = previa.paso ? ` at step ${previa.paso}` : '';

  return (
    `You already read lines ${previa.desde}–${previa.hasta} of "${previa.fileName}" in this round${cuando}. ` +
    'Older tool results are trimmed from your context to keep it small, so reading the same lines again shows you nothing new — ' +
    'it is how a round once spent 31 of its 40 steps re-reading the same five sources. ' +
    'To find where a topic is, call search_document: it searches the text of every course source and says which ones contain it. ' +
    'Then read only around what it finds (a different offset is fine). ' +
    'To have a lesson written you do not need the source text in your own context: pass the sources that contain the topic to write_lesson.'
  );
}
