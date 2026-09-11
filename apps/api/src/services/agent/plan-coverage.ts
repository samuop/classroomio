/**
 * Cobertura del plan: qué lección del plan se apoya en qué fuente, declarado
 * por el agente y contrastado por el servidor ANTES de construir.
 *
 * ── Qué problema resuelve ────────────────────────────────────────────────────
 *
 * Un curso real de producción se planificó con dieciséis lecciones a partir de
 * una sola fuente que alcanzaba para dos. El agente escribió las dieciséis. Las
 * catorce restantes salieron de su conocimiento general, con el sello «Basado
 * en: <url>» debajo, que es peor que no tener sello: el docente lee que hay
 * fundamento donde no lo hay.
 *
 * El agente nunca dijo «para esto no tengo material». No porque no supiera —
 * cuando se le preguntó después, lo identificó sin dudar— sino porque nadie se
 * lo preguntó en el momento en que importaba, que es cuando el plan todavía se
 * puede cambiar. Después de escribir, admitir el hueco es contradecirse.
 *
 * ── Cómo lo resuelve ─────────────────────────────────────────────────────────
 *
 * Cada ítem del plan declara de qué fuente sale. El servidor lo contrasta contra
 * las fuentes que el curso tiene DE VERDAD, y devuelve tres listas: lo cubierto,
 * lo huérfano, y lo que declara una fuente que no existe.
 *
 * Es el mismo principio que el chequeo de fundamento y que los avisos de
 * diagramas: una declaración que nadie contrasta se convierte en decoración. La
 * diferencia es el momento — esto corre cuando todavía no se escribió nada, así
 * que la respuesta puede ser «no lo escribas» en vez de «reescribilo».
 *
 * ── Lo que NO hace ───────────────────────────────────────────────────────────
 *
 * No bloquea el plan ni lo corrige. Un curso puede legítimamente tener lecciones
 * sin fuente: el docente puede querer relleno general y decirlo. Lo que no puede
 * pasar es que se decida sin él. El servidor marca; preguntar es del agente.
 */

/** Una fuente del curso, como la ve el contraste. */
export interface FuenteDelCurso {
  id: string;
  fileName: string;
}

export interface ItemDelPlan {
  type: 'lesson' | 'exercise';
  title: string;
  sources?: string[];
}

export interface Cobertura {
  /**
   * NINGUNA lección declaró nada — ni siquiera una lista vacía.
   *
   * Es un estado aparte y no un caso de `sinFuente`, porque las respuestas son
   * opuestas: acá el modelo no contestó la pregunta y hay que pedirle que la
   * conteste; allá contestó, y hay que hablar con el docente. Confundirlos fue
   * el primer resultado medido de este chequeo: 14 lecciones huérfanas de 14,
   * incluidas las que la fuente sí cubría, porque el modelo había omitido el
   * campo entero.
   */
  sinDeclarar: boolean;
  /** Lecciones que declararon al menos una fuente real. */
  cubiertas: number;
  /** Lecciones que no declararon ninguna fuente. */
  sinFuente: string[];
  /**
   * Lecciones que declararon una fuente que el curso no tiene, con el nombre
   * inventado. Se separa de `sinFuente` a propósito: no declarar nada es un
   * hueco, y nombrar un documento inexistente es una invención — el mismo fallo
   * que el chequeo de fundamento persigue, sólo que antes de escribir.
   */
  fuentesInexistentes: Array<{ item: string; declarada: string }>;
}

/**
 * Forma comparable de un nombre de archivo.
 *
 * El modelo copia el nombre de una fuente desde el paquete de fuentes, y entre
 * ese texto y la fila de la base se pierden cosas que no significan nada:
 * mayúsculas, acentos, la extensión, los paréntesis del dominio en una página
 * web. Comparar en crudo haría fallar la coincidencia por razones que no le
 * importan a nadie, y el resultado sería marcar como inventada una fuente que
 * está ahí.
 */
function normalizar(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\.(pdf|docx?|pptx?|txt|md|csv|xlsx?)$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * ¿La fuente declarada existe?
 *
 * Acepta el id exacto, el nombre normalizado, y la contención en cualquiera de
 * los dos sentidos: «Organigrama» declarado contra «Organigrama actual.pptx.pdf»
 * es evidentemente la misma cosa, y exigir el nombre completo sólo entrenaría al
 * modelo a copiar mal.
 *
 * El piso de tres caracteres está para que un nombre de una letra no coincida
 * con todo — que es la forma en que este tipo de coincidencia laxa se rompe.
 */
export function fuenteDeclaradaExiste(declarada: string, fuentes: FuenteDelCurso[]): boolean {
  return buscarFuente(declarada, fuentes) !== undefined;
}

/**
 * La fuente a la que se refiere un nombre declarado, con las mismas reglas que
 * `fuenteDeclaradaExiste`.
 *
 * La usa el escritor de lecciones para cargar SÓLO el material que el plan le
 * asignó a cada lección. Por eso las dos funciones son una: si el contraste del
 * plan y la carga del escritor coincidieran distinto, una lección podría pasar
 * el chequeo de cobertura con una fuente y escribirse con otra.
 *
 * Prefiere la coincidencia exacta antes que la contención: entre
 * "Organigrama.pdf" y "Organigrama 2023.pdf", «Organigrama» es el primero.
 */
export function buscarFuente<T extends FuenteDelCurso>(declarada: string, fuentes: T[]): T | undefined {
  const pedido = normalizar(declarada);

  if (pedido.length < 3) return undefined;

  const porId = fuentes.find((f) => f.id === declarada.trim());
  if (porId) return porId;

  const exacta = fuentes.find((f) => normalizar(f.fileName) === pedido);
  if (exacta) return exacta;

  return fuentes.find((f) => {
    const real = normalizar(f.fileName);

    return real.includes(pedido) || pedido.includes(real);
  });
}

/**
 * Contrasta el plan contra las fuentes del curso.
 *
 * Los ejercicios quedan afuera: un cuestionario se arma de las lecciones del
 * propio curso, no del material del docente, y marcarlo como huérfano sería un
 * aviso que hay que aprender a ignorar.
 */
export function medirCobertura(items: ItemDelPlan[], fuentes: FuenteDelCurso[]): Cobertura {
  const lecciones = items.filter((i) => i.type === 'lesson');

  // `undefined` es «no contestó»; `[]` es «contestó que no hay». Por eso el
  // campo es opcional y no tiene valor por defecto.
  const sinDeclarar = lecciones.length > 0 && lecciones.every((l) => l.sources === undefined);

  const sinFuente: string[] = [];
  const fuentesInexistentes: Array<{ item: string; declarada: string }> = [];
  let cubiertas = 0;

  for (const leccion of lecciones) {
    const declaradas = (leccion.sources ?? []).map((s) => s.trim()).filter(Boolean);

    if (declaradas.length === 0) {
      sinFuente.push(leccion.title);
      continue;
    }

    const reales = declaradas.filter((d) => fuenteDeclaradaExiste(d, fuentes));

    for (const inventada of declaradas.filter((d) => !fuenteDeclaradaExiste(d, fuentes))) {
      fuentesInexistentes.push({ item: leccion.title, declarada: inventada });
    }

    if (reales.length > 0) cubiertas += 1;
    else sinFuente.push(leccion.title);
  }

  return { sinDeclarar, cubiertas, sinFuente, fuentesInexistentes };
}

/**
 * Lo que se le devuelve al modelo junto con el plan.
 *
 * Devuelve `undefined` cuando no hay nada que decir — plan enteramente cubierto,
 * o curso sin fuentes, donde escribir desde el conocimiento general es lo normal
 * y no un defecto.
 *
 * La instrucción es PREGUNTAR, no arreglar. Las tres salidas que se le ofrecen
 * son las tres que el docente puede querer de verdad, y ninguna es «escribilo
 * igual y no digas nada», que es lo que viene pasando.
 */
export function avisoDeCobertura(cobertura: Cobertura, totalFuentes: number): string | undefined {
  if (totalFuentes === 0) return undefined;

  // El modelo no contestó. Pedírselo es lo único honesto: reportarle huérfanas
  // que no declaró sería inventarle una conclusión a partir de un silencio.
  if (cobertura.sinDeclarar) {
    return (
      `This course has ${totalFuentes} attached source(s) and not one lesson in this plan declares which of them it comes from. ` +
      `Call generate_course_plan again with the same plan, adding \`sources\` to every lesson item: the file name(s) from the "## Course Sources" list that carry that lesson, or an empty array \`[]\` when none of them do. ` +
      `An empty array is a real answer and the right one for a lesson the material does not cover — omitting the field is not, because it leaves the teacher unable to see which parts of their course have nothing behind them.`
    );
  }

  if (cobertura.sinFuente.length === 0 && cobertura.fuentesInexistentes.length === 0) return undefined;

  const partes: string[] = [];

  if (cobertura.fuentesInexistentes.length > 0) {
    const lista = cobertura.fuentesInexistentes.map((f) => `"${f.item}" cites "${f.declarada}"`).join('; ');
    partes.push(
      `These plan items cite a source this course does not have: ${lista}. The course's actual sources are listed in the "## Course Sources" message. Fix the citation to a real source, or treat the item as having none.`
    );
  }

  if (cobertura.sinFuente.length > 0) {
    const lista = cobertura.sinFuente.map((t) => `"${t}"`).join(', ');
    partes.push(
      `${cobertura.sinFuente.length} of ${cobertura.sinFuente.length + cobertura.cubiertas} planned lessons have no source material behind them: ${lista}.\n\n` +
        `Do NOT start building yet. Tell the teacher plainly which lessons the uploaded material does not cover, and ask what they want for those — in their language, as a normal sentence, not a list of options dressed up as a menu. The three real answers are: (a) upload the document that covers them, (b) drop them from the plan, or (c) have you write them from general professional knowledge, which you will then mark as such in the lesson.\n\n` +
        `Say it as the useful observation it is ("con el material que subiste puedo escribir 2 de las 7 lecciones bien; para las otras 5 necesitaría el manual de procedimientos"), and then wait for their answer. Guessing which one they want is the failure this check exists to prevent.`
    );
  }

  return partes.join('\n\n');
}
