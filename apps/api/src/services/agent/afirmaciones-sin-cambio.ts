/**
 * Lo que el mensaje del modelo DICE que cambió y el servidor no vio cambiar.
 *
 * ── Por qué ──────────────────────────────────────────────────────────────────
 *
 * Medido en producción (2026-11): una docente pidió actualizar los
 * cuestionarios después de cambiar el curso. El modelo contestó que los había
 * actualizado. No había llamado a ninguna herramienta de preguntas: el registro
 * de la ronda decía «Editó» sobre lecciones y nada sobre preguntas, y nadie lo
 * contrastó. La docente le creyó, y los alumnos siguieron respondiendo preguntas viejas.
 *
 * El registro (`round-ledger.ts`) ya se mostraba al lado del relato, pero sólo
 * cuando había cambios, y no decía nada de lo que FALTABA. Esto busca, en el
 * texto del modelo, las frases que afirman un cambio, y las contrasta con lo
 * que el servidor registró.
 *
 * ── Qué cuenta como afirmación ───────────────────────────────────────────────
 *
 * Una frase con un verbo de cambio en primera persona del pasado («actualicé»,
 * «corregí», «quedó actualizada») que nombra una pieza del curso —por su
 * enlace `@[título](…)` o por su título exacto—. Si nombra preguntas o
 * cuestionarios en general y la ronda no tocó ninguna pregunta, también.
 *
 * No corrige el texto: el modelo ya lo escribió y la docente lo está leyendo.
 * Marca la diferencia al lado, que es lo que se puede garantizar.
 *
 * Pura: el texto, lo cambiado y los títulos del curso entran por parámetro.
 */

/*
 * Los bordes de palabra van con letras Unicode y no con `\b`: en JavaScript
 * `\b` es ASCII aun con la bandera `u`, y «actualicé» termina en una letra que
 * para `\b` no es letra — la frase entera no coincidía.
 */
const ANTES = '(?<![\\p{L}\\p{N}])';
const DESPUES = '(?![\\p{L}\\p{N}])';

/**
 * Verbos de cambio en primera persona del pasado, el impersonal («se
 * actualizaron las preguntas del…», que es como lo escribió en el caso medido)
 * y los participios de «quedó X».
 */
const VERBO_DE_CAMBIO = new RegExp(
  `${ANTES}(?:actualic[eé]|modifiqu[eé]|cambi[eé]|correg[ií]|agregu[eé]|añad[ií]|reescrib[ií]|ajust[eé]|edit[eé]|reemplac[eé]|elimin[eé]|borr[eé]|quit[eé]|incorpor[eé]|sum[eé]|complet[eé]|escrib[ií]|cre[eé]|gener[eé]|reformul[eé]|rehice|se (?:actualiz|ajust|modific|corrig|cambi|agreg|añadi|reescrib|incorpor|elimin|quit|reemplaz|reformul|complet)\\p{L}*|(?:qued[oó]|quedaron|est[aá]n?|fueron|fue) (?:actualizad|corregid|modificad|ajustad|reescrit|cambiad|agregad|incorporad|reemplazad)\\p{L}*|updated|changed|fixed|corrected|added|rewrote|rewritten|edited|replaced|removed|deleted)${DESPUES}`,
  'iu'
);

/** Lo que nombra preguntas en general, sin decir cuáles. */
const PALABRAS_DE_PREGUNTAS = new RegExp(
  `${ANTES}(?:preguntas?|cuestionarios?|evaluaci[oó]n(?:es)?|ex[aá]men(?:es)?|quiz(?:zes)?|questions?)${DESPUES}`,
  'iu'
);

/** Los enlaces que escribe el modelo: `@[Título](lesson:S2.L3)`. */
const ENLACE = /@\[([^\]]+)\]\([^)]*\)/g;

/** Por debajo de esto un título es demasiado común para buscarlo suelto en el texto. */
const LARGO_MINIMO_DE_TITULO = 8;

/** Las herramientas que cambian preguntas: con una que salió bien, la ronda cambió preguntas. */
export const HERRAMIENTAS_DE_PREGUNTAS: ReadonlySet<string> = new Set([
  'update_questions',
  'add_questions',
  'write_questions'
]);

export interface AfirmacionesSinCambio {
  /** Piezas que el mensaje dice haber cambiado y el servidor no vio cambiar. */
  piezas: string[];
  /** El mensaje habla de cambios en preguntas y la ronda no cambió ninguna. */
  preguntas: boolean;
}

export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[«»"“”'`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** El texto en frases. Los enlaces se dejan enteros: su título puede traer puntos. */
function frases(texto: string): string[] {
  return texto
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((frase) => frase.trim())
    .filter((frase) => frase.length > 0);
}

export function afirmacionesSinCambio(params: {
  /** El texto que la docente ve, de toda la respuesta. */
  texto: string;
  /** Los títulos de lo que la ronda cambió (lecciones, ejercicios, secciones). */
  cambiadas: readonly string[];
  /** Si la ronda cambió alguna pregunta. */
  cambioPreguntas: boolean;
  /** Los títulos de las piezas del curso, para encontrar las nombradas sin enlace. */
  titulosDelCurso: readonly string[];
}): AfirmacionesSinCambio {
  const cambiadas = new Set(params.cambiadas.map(normalizar));
  const titulos = [...new Set(params.titulosDelCurso.map((titulo) => titulo.trim()))].filter(
    (titulo) => titulo.length >= LARGO_MINIMO_DE_TITULO
  );
  const piezas = new Map<string, string>();
  let preguntas = false;

  for (const frase of frases(params.texto)) {
    if (!VERBO_DE_CAMBIO.test(frase)) continue;

    const nombradas = new Map<string, string>();

    for (const enlace of frase.matchAll(ENLACE)) {
      nombradas.set(normalizar(enlace[1]), enlace[1].trim());
    }

    const fraseNormalizada = normalizar(frase.replace(ENLACE, ' '));

    for (const titulo of titulos) {
      const clave = normalizar(titulo);

      if (!nombradas.has(clave) && fraseNormalizada.includes(clave)) nombradas.set(clave, titulo);
    }

    for (const [clave, titulo] of nombradas) {
      if (!cambiadas.has(clave)) piezas.set(clave, titulo);
    }

    if (nombradas.size === 0 && !params.cambioPreguntas && PALABRAS_DE_PREGUNTAS.test(frase)) preguntas = true;
  }

  return { piezas: [...piezas.values()], preguntas };
}

export function hayAfirmacionesSinCambio(resultado: AfirmacionesSinCambio): boolean {
  return resultado.piezas.length > 0 || resultado.preguntas;
}
