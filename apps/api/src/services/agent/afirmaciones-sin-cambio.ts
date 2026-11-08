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
 * Un verbo de cambio en pasado («actualicé», «corregí», «se actualizaron»,
 * «quedó actualizada») y lo que nombra hasta el verbo siguiente: una pieza del
 * curso —por su enlace `@[título](…)` o por su título escrito como nombre—, o
 * preguntas y cuestionarios en general si la ronda no tocó ninguna pregunta.
 *
 * ── Qué NO cuenta (los falsos positivos, uno por uno) ────────────────────────
 *
 * Una advertencia que acusa al modelo de algo que no dijo es peor que no
 * advertir: la docente deja de creerle a la advertencia. Por eso:
 *
 * - Sólo el pretérito con tilde. «¿Querés que actualice las preguntas?» —lo que
 *   escribe el modelo justo cuando NO las tocó— lleva el subjuntivo, que sin la
 *   tilde se escribe igual que «actualicé». Lo mismo «cree» (de creer) y «creé».
 * - El impersonal, sólo en pasado: «se actualizaron», no «se actualizarán» ni
 *   «que se actualicen».
 * - Una negación hasta tres palabras antes del verbo: «no actualicé», «las
 *   preguntas no fueron modificadas», «I haven't updated».
 * - Un futuro o un modal en inglés: «will be updated», «should be changed».
 * - Una pregunta: «¿Están actualizadas las preguntas?».
 * - «Las preguntas quedaron igual / sin cambios / como estaban».
 * - Lo que se refiere a otra ronda: «en la ronda anterior», «la vez pasada».
 * - «pero», «aunque», «sin embargo» y el punto y coma separan afirmaciones: en
 *   «Corregí la lección, pero no toqué el examen» el examen no se afirma.
 * - Un título suelto sólo cuenta escrito como nombre, con su mayúscula: «mejoré
 *   la atención al cliente» no nombra la lección «Atención al cliente». Y si un
 *   título contiene a otro, cuenta el más largo.
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

/** Primera persona del pretérito, siempre con su tilde. */
const PRIMERA_PERSONA =
  'actualicé|modifiqué|cambié|corregí|agregué|añadí|reescribí|ajusté|edité|reemplacé|eliminé|borré|quité|incorporé|sumé|completé|escribí|creé|generé|reformulé|rehíce|rehice';

/** El impersonal en pasado: «se actualizaron las preguntas del…», como en el caso medido. */
const IMPERSONAL =
  'se (?:actualiz|ajust|modific|cambi|agreg|incorpor|elimin|quit|reemplaz|reformul|complet)(?:ó|aron)|se (?:corrig|añad|reescrib)(?:ió|ieron)';

/** «quedó X», «fueron X», «están X», «han sido X». */
const PARTICIPIO =
  '(?:qued[oó]|quedaron|est[aá]n?|fueron|fue|han sido|ha sido) (?:actualizad|corregid|modificad|ajustad|reescrit|cambiad|agregad|incorporad|reemplazad)\\p{L}*';

const EN_INGLES = 'updated|changed|fixed|corrected|added|rewrote|rewritten|edited|replaced|removed|deleted';

const VERBO_DE_CAMBIO = new RegExp(
  `${ANTES}(?:${PRIMERA_PERSONA}|${IMPERSONAL}|${PARTICIPIO}|${EN_INGLES})${DESPUES}`,
  'giu'
);

/** Lo que nombra preguntas en general, sin decir cuáles. */
const PALABRAS_DE_PREGUNTAS = new RegExp(
  `${ANTES}(?:preguntas?|cuestionarios?|evaluaci[oó]n(?:es)?|ex[aá]men(?:es)?|quiz(?:zes)?|questions?)${DESPUES}`,
  'iu'
);

/** Palabras que, hasta tres antes del verbo o de lo nombrado, lo niegan. «No sólo» no niega. */
const NEGACION = /(?:^|\s)(?:no(?! s[oó]lo)|ni|nunca|jam[aá]s|tampoco|not|never|\p{L}+n[’']t)(?=\s|$)/iu;

function negado(texto: string, hasta: number): boolean {
  return NEGACION.test(` ${palabrasAntes(texto, hasta, 3)}`);
}

/** En inglés, lo que hace del participio un futuro o una posibilidad. */
const MODAL = /(?:^|\s)(?:will|would|can|could|should|may|might|must|to)(?=\s|$)/i;

/** «quedaron igual», «sin cambios», «como estaban». */
const SIN_CAMBIOS = new RegExp(
  `${ANTES}(?:igual(?:es)?|sin cambios|intact[ao]s?|como estaban|sin tocar|unchanged|as they were)${DESPUES}`,
  'iu'
);

/** Lo que habla de una ronda que no es ésta. */
const OTRA_RONDA = new RegExp(
  `${ANTES}(?:en (?:la|el|una|un) (?:ronda|mensaje|turno|respuesta|paso|conversaci[oó]n) anterior|la vez pasada|hace un rato|anteriormente|previously|earlier|last time)${DESPUES}`,
  'iu'
);

/** Lo que separa dos afirmaciones dentro de una frase. */
const SEPARADOR = /;|\s+—\s+|,?\s+(?:pero|aunque|sin embargo|mientras que|en cambio|but|although|however)\s+/iu;

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

/** Sin tildes ni comillas, y con los espacios juntos; conserva mayúsculas y largo de cada letra. */
function sinTildes(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[«»"“”'`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizar(texto: string): string {
  return sinTildes(texto).toLowerCase();
}

/**
 * El texto en frases. Los enlaces se cambian antes por una marca sin puntos ni
 * espacios, para que un título con puntos no parta la frase.
 */
function frases(texto: string): { frases: string[]; enlaces: string[] } {
  const enlaces: string[] = [];
  const marcado = texto.replace(ENLACE, (_entero, titulo: string) => {
    enlaces.push(titulo.trim());

    return `⟦${enlaces.length - 1}⟧`;
  });

  return {
    frases: marcado
      .split(/(?<=[.!?…])\s+|\n+/u)
      .map((frase) => frase.trim())
      .filter((frase) => frase.length > 0),
    enlaces
  };
}

const MARCA_DE_ENLACE = /⟦(\d+)⟧/g;

function esPregunta(frase: string): boolean {
  return frase.startsWith('¿') || /\?\s*\p{P}*$/u.test(frase);
}

/**
 * Las últimas `n` palabras antes de una posición, sin pasar la coma anterior:
 * en «Si no te gusta, cambié el ejemplo» el «no» es de la otra cláusula.
 */
function palabrasAntes(texto: string, hasta: number, n: number): string {
  const previo = texto.slice(0, hasta);
  const desdeLaComa = previo.slice(Math.max(previo.lastIndexOf(','), previo.lastIndexOf(':')) + 1);

  return desdeLaComa.trim().split(/\s+/).slice(-n).join(' ');
}

/**
 * Las formas cuyo sujeto puede ir antes del verbo: «@[A] quedó actualizada»,
 * «las preguntas se ajustaron», «the questions have been updated».
 */
const PASIVA = new RegExp(`^(?:${IMPERSONAL}|${PARTICIPIO}|${EN_INGLES})$`, 'iu');

/**
 * Cada tramo de la cláusula que corresponde a un verbo de cambio afirmado: del
 * verbo al verbo siguiente. En la pasiva el tramo arranca antes, en lo último
 * que se nombró antes del verbo (desde la coma o la «y» anterior): en «Revisé
 * @[A] y @[B] quedó actualizada» se afirma B, no A.
 */
function tramosAfirmados(clausula: string): string[] {
  const verbos = [...clausula.matchAll(VERBO_DE_CAMBIO)];
  const tramos: string[] = [];

  verbos.forEach((verbo, i) => {
    const donde = verbo.index ?? 0;
    const hasta = i + 1 < verbos.length ? (verbos[i + 1].index ?? clausula.length) : clausula.length;

    if (negado(clausula, donde) || MODAL.test(` ${palabrasAntes(clausula, donde, 2)}`)) return;

    let desde = donde;

    if (PASIVA.test(verbo[0])) {
      const anterior = i === 0 ? 0 : (verbos[i - 1].index ?? 0) + verbos[i - 1][0].length;
      const previo = clausula.slice(anterior, donde);
      const corte = Math.max(previo.lastIndexOf(','), previo.lastIndexOf(' y '), previo.lastIndexOf(' and '));

      desde = anterior + (corte >= 0 ? corte + 1 : 0);
    }

    tramos.push(clausula.slice(desde, hasta));
  });

  return tramos;
}

/**
 * Los títulos del curso escritos como nombre en un tramo. Del más largo al más
 * corto, borrando lo encontrado: «Recibir mercadería en depósito» no cuenta
 * también como «Recibir mercadería». Uno con una negación justo antes («y no
 * toqué Recibir mercadería») no se afirma.
 */
function titulosNombrados(tramo: string, titulos: readonly string[]): string[] {
  let conMayusculas = sinTildes(tramo);
  let enMinusculas = conMayusculas.toLowerCase();
  const nombrados: string[] = [];

  for (const titulo of titulos) {
    const original = sinTildes(titulo);
    const clave = original.toLowerCase();
    let desde = 0;

    while (desde <= enMinusculas.length) {
      const donde = enMinusculas.indexOf(clave, desde);

      if (donde < 0) break;

      const antes = enMinusculas[donde - 1];
      const despues = enMinusculas[donde + clave.length];
      const enteraComoPalabra = !/[\p{L}\p{N}]/u.test(antes ?? ' ') && !/[\p{L}\p{N}]/u.test(despues ?? ' ');
      // Escrito como nombre: con la mayúscula con la que arranca el título.
      const comoNombre = original[0] === original[0].toLowerCase() || conMayusculas[donde] === original[0];

      if (enteraComoPalabra && comoNombre) {
        if (!negado(conMayusculas, donde)) nombrados.push(titulo);
        const tapado = ' '.repeat(clave.length);
        conMayusculas = conMayusculas.slice(0, donde) + tapado + conMayusculas.slice(donde + clave.length);
        enMinusculas = enMinusculas.slice(0, donde) + tapado + enMinusculas.slice(donde + clave.length);
        break;
      }

      desde = donde + 1;
    }
  }

  return nombrados;
}

/**
 * Los títulos de lo que la ronda cambió DE VERDAD, para contrastar el relato:
 * lo que anotó el registro, menos lo propuesto, más lo que la bitácora vio
 * guardar.
 *
 * Lo propuesto no cuenta: un cambio sobre un ejercicio con entregas queda
 * esperando a la docente y el ejercicio sigue igual. Contado como cambio,
 * «sumé las preguntas al @[Examen final]» pasaba sin advertencia cuando el
 * examen no había cambiado (medido en vivo, 2026-11-08).
 */
export function piezasCambiadas(params: {
  cambios: ReadonlyArray<{ accion: string; objeto: string }>;
  escriturasHechas: ReadonlyArray<{ titulo?: string }>;
}): string[] {
  return [
    ...params.cambios.filter((cambio) => cambio.accion !== 'propuso').map((cambio) => cambio.objeto),
    ...params.escriturasHechas.map((escritura) => escritura.titulo ?? '')
  ].filter(Boolean);
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
  const titulos = [...new Set(params.titulosDelCurso.map((titulo) => titulo.trim()))]
    .filter((titulo) => titulo.length >= LARGO_MINIMO_DE_TITULO)
    .sort((a, b) => b.length - a.length);
  const piezas = new Map<string, string>();
  let preguntas = false;

  const { frases: todas, enlaces } = frases(params.texto);

  for (const frase of todas) {
    if (esPregunta(frase)) continue;

    for (const clausula of frase.split(SEPARADOR)) {
      if (OTRA_RONDA.test(clausula)) continue;

      for (const tramo of tramosAfirmados(clausula)) {
        // Todo lo que el tramo nombra, afirmado o no: con algo nombrado, la
        // frase habla de esas piezas y no de «las preguntas» en general.
        let nombraAlgo = false;
        const afirmadas = new Map<string, string>();

        for (const marca of tramo.matchAll(MARCA_DE_ENLACE)) {
          const titulo = enlaces[Number(marca[1])];

          if (!titulo) continue;

          nombraAlgo = true;

          if (!negado(tramo, marca.index ?? 0)) afirmadas.set(normalizar(titulo), titulo);
        }

        const sinEnlaces = tramo.replace(MARCA_DE_ENLACE, ' ');

        for (const titulo of titulosNombrados(sinEnlaces, titulos)) {
          nombraAlgo = true;

          const clave = normalizar(titulo);

          if (!afirmadas.has(clave)) afirmadas.set(clave, titulo);
        }

        for (const [clave, titulo] of afirmadas) {
          if (!cambiadas.has(clave)) piezas.set(clave, titulo);
        }

        const mencion = PALABRAS_DE_PREGUNTAS.exec(sinEnlaces);

        if (
          !nombraAlgo &&
          !params.cambioPreguntas &&
          mencion &&
          !negado(sinEnlaces, mencion.index) &&
          !SIN_CAMBIOS.test(sinEnlaces)
        ) {
          preguntas = true;
        }
      }
    }
  }

  return { piezas: [...piezas.values()], preguntas };
}

export function hayAfirmacionesSinCambio(resultado: AfirmacionesSinCambio): boolean {
  return resultado.piezas.length > 0 || resultado.preguntas;
}
