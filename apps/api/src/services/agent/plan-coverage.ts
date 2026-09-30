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

import { terminosDeBusqueda, tramosDeBusqueda } from '@api/services/agent/source-search';

/**
 * Una fuente del curso, como la ve el contraste.
 *
 * Con `text`, además de ver si la fuente declarada EXISTE se mide si trata el
 * tema: ver `prosaDelTema`. Sin texto (una fila que no lo trajo) se contrasta
 * sólo el nombre, como antes.
 */
export interface FuenteDelCurso {
  id: string;
  fileName: string;
  text?: string | null;
}

export interface ItemDelPlan {
  type: 'lesson' | 'exercise';
  title: string;
  /** Lo que la lección tiene que enseñar: junto con el título, es lo que se busca en la fuente. */
  description?: string;
  sources?: string[];
}

/**
 * Cuánta prosa sobre el tema tiene que traer la fuente declarada para que la
 * lección se pueda escribir desde ella.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * Producción, 2026-09-29. El chequeo daba por cubierta toda lección que nombrara
 * una fuente existente. Las dos lecciones de tablas dinámicas —un objetivo que
 * la docente pidió con todas las letras— citaban el temario de un curso ajeno,
 * que nombra el tema en un renglón («3.6. Tablas dinámicas») y nada más. El
 * agente le dijo que con su material cubría 11 de 13 lecciones y sólo le
 * preguntó por las otras dos.
 *
 * Lo que se cuenta es PROSA —oraciones de ocho palabras o más—, no renglones de
 * un temario, títulos ni listas de enlaces. Quinientos caracteres son dos o
 * tres oraciones: lo mínimo para que el escritor tenga algo que enseñar y no
 * sólo un título que desarrollar de memoria. Calibrado con ese mismo curso:
 * las nueve lecciones con una fuente que de verdad las trata daban entre 559 y
 * 9465 caracteres; las dos del temario, 127 y 0; y el temario contrastado
 * contra CUALQUIERA de las trece lecciones del plan, 444 como máximo.
 */
export const PROSA_MINIMA_DEL_TEMA = 500;

/** Palabras que hacen falta para que un tramo cuente como oración y no como título. */
const PALABRAS_DE_UNA_ORACION = 8;

/**
 * El texto de una fuente partido en oraciones, títulos y renglones de lista.
 *
 * Parte también por los números de un temario («3.1. … 3.2. …»), por las celdas
 * de una tabla y por las viñetas: un temario aplanado en una celda es una sola
 * línea larguísima, y medida entera pasaría por prosa. Los enlaces se van antes
 * de contar: una bibliografía son renglones enormes hechos de direcciones.
 */
function oracionesDe(texto: string): string[] {
  return texto
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\bhttps?:\/\/\S+/gi, ' ')
    .split(/\n|\||•|(?:^|\s)[-*+]\s|(?<=[.!?;])\s+|\s(?=\d+(?:\.\d+)+\.?\s)/)
    .map((tramo) => tramo.replace(/^[\s#>*+\-\d.)]+/, '').trim())
    .filter(Boolean);
}

/**
 * Cuántos caracteres de prosa sobre el tema de una lección traen sus fuentes.
 *
 * El tema son los términos del título y de la descripción del ítem, y la
 * búsqueda es la de `source-search.ts` —los mismos términos
 * (`terminosDeBusqueda`), los mismos tramos (`tramosDeBusqueda`), la misma
 * coincidencia por raíz—: un tramo trata el tema si nombra dos términos. Lo que
 * no se usa es `buscarEnFuentes` entera, porque se queda con tres pasajes por
 * fuente: sirve para orientar al agente, y para MEDIR dejaba corta a una guía
 * que enseña el tema en cinco párrafos.
 *
 * De esos tramos se cuentan las oraciones que nombran un término del TÍTULO, o
 * dos cualesquiera. Pedir siempre dos dejaba afuera la prosa buena: medido, las
 * oraciones de una página de ayuda sobre la Autosuma nombran «Autosuma» y nada
 * más de la consigna.
 */
export function prosaDelTema(item: { title: string; description?: string }, fuentes: FuenteDelCurso[]): number {
  const conTexto = fuentes.filter(
    (fuente): fuente is FuenteDelCurso & { text: string } =>
      typeof fuente.text === 'string' && fuente.text.trim().length > 0
  );

  if (conTexto.length === 0) return 0;

  const terminos = terminosDeBusqueda([item.title, item.description ?? ''].join(' '));
  const delTitulo = terminosDeBusqueda(item.title);

  if (terminos.length === 0) return 0;

  const plegar = (texto: string) => texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const palabrasDe = (texto: string) => plegar(texto).split(/[^a-z0-9]+/).filter(Boolean);
  // La misma coincidencia que `buscarEnFuentes`: el número exacto, la palabra
  // por su raíz para que el singular encuentre el plural.
  const cuantos = (palabras: string[], lista: string[]) =>
    lista.filter((termino) => {
      const raiz = termino.length <= 4 ? termino : termino.slice(0, Math.max(4, Math.ceil(termino.length * 0.7)));

      return palabras.some((palabra) => (/^\d+$/.test(termino) ? palabra === termino : palabra.startsWith(raiz)));
    }).length;
  const minimo = Math.min(2, terminos.length);
  const nombra = (oracion: string) => {
    const palabras = palabrasDe(oracion);

    return cuantos(palabras, delTitulo) >= 1 || cuantos(palabras, terminos) >= minimo;
  };

  const contadas = new Set<string>();
  let prosa = 0;

  for (const fuente of conTexto) {
    const lineas = fuente.text.split('\n');

    for (const tramo of tramosDeBusqueda(lineas)) {
      const texto = lineas.slice(tramo.desde - 1, tramo.hasta).join('\n');

      // El tramo trata el tema si nombra dos términos, como en la búsqueda.
      if (cuantos(palabrasDe(texto), terminos) < minimo) continue;

      for (const oracion of oracionesDe(texto)) {
        const palabras = oracion.split(/\s+/).filter((palabra) => /\p{L}/u.test(palabra));

        if (palabras.length < PALABRAS_DE_UNA_ORACION) continue;
        if (!nombra(oracion)) continue;

        // La misma oración repetida en dos fuentes (una diapositiva copiada mes
        // a mes), o en dos tramos que se pisan, cuenta una vez.
        const clave = plegar(oracion).replace(/\s+/g, ' ');

        if (contadas.has(clave)) continue;

        contadas.add(clave);
        prosa += oracion.length;
      }
    }
  }

  return prosa;
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
  /** Lecciones que declararon al menos una fuente real que trata el tema. */
  cubiertas: number;
  /** Lecciones que no declararon ninguna fuente. */
  sinFuente: string[];
  /**
   * Lecciones cuya fuente declarada existe pero apenas nombra el tema: menos de
   * `PROSA_MINIMA_DEL_TEMA` caracteres de prosa sobre él. Sólo se mide cuando
   * las fuentes traen su texto.
   *
   * Aparte de `sinFuente` porque el agente tiene que poder decir cuál es la
   * fuente y qué le falta: «cita el temario, que sólo lo nombra».
   */
  debiles: Array<{ item: string; fuentes: string[]; prosa: number }>;
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
  const debiles: Cobertura['debiles'] = [];
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

    if (reales.length === 0) {
      sinFuente.push(leccion.title);
      continue;
    }

    /**
     * Que la fuente exista no dice que trate el tema: se mide.
     *
     * Sólo cuando las fuentes trajeron su texto. Sin texto no hay qué medir, y
     * marcarla débil por eso sería inventar una conclusión.
     */
    const elegidas = [
      ...new Map(
        reales
          .map((d) => buscarFuente(d, fuentes))
          .filter((f): f is FuenteDelCurso => !!f)
          .map((f) => [f.id, f] as const)
      ).values()
    ];
    const conTexto = elegidas.filter((f) => typeof f.text === 'string' && f.text.trim().length > 0);

    if (conTexto.length > 0) {
      const prosa = prosaDelTema(leccion, conTexto);

      if (prosa < PROSA_MINIMA_DEL_TEMA) {
        debiles.push({ item: leccion.title, fuentes: elegidas.map((f) => f.fileName), prosa });
        continue;
      }
    }

    cubiertas += 1;
  }

  return { sinDeclarar, cubiertas, sinFuente, debiles, fuentesInexistentes };
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

  const debiles = cobertura.debiles ?? [];

  if (cobertura.sinFuente.length === 0 && cobertura.fuentesInexistentes.length === 0 && debiles.length === 0) {
    return undefined;
  }

  const partes: string[] = [];

  if (cobertura.fuentesInexistentes.length > 0) {
    const lista = cobertura.fuentesInexistentes.map((f) => `"${f.item}" cites "${f.declarada}"`).join('; ');
    partes.push(
      `These plan items cite a source this course does not have: ${lista}. The course's actual sources are listed in the "## Course Sources" message. Fix the citation to a real source, or treat the item as having none.`
    );
  }

  if (cobertura.sinFuente.length > 0 || debiles.length > 0) {
    const total = cobertura.sinFuente.length + debiles.length + cobertura.cubiertas;
    const huecos: string[] = [];

    if (cobertura.sinFuente.length > 0) {
      const lista = cobertura.sinFuente.map((t) => `"${t}"`).join(', ');

      huecos.push(
        `${cobertura.sinFuente.length} of ${total} planned lessons have no source material behind them: ${lista}.`
      );
    }

    // La fuente débil se nombra, con lo que tiene: es lo que la docente necesita
    // para decidir, y lo que el agente no ve si sólo mira los nombres.
    if (debiles.length > 0) {
      const lista = debiles
        .map(
          (d) =>
            `"${d.item}" cites ${d.fuentes.map((f) => `"${f}"`).join(', ')}, which has about ${d.prosa} characters of text on the topic`
        )
        .join('; ');

      huecos.push(
        `${debiles.length} of ${total} planned lessons cite a source that only mentions their topic — a syllabus line, a heading or a list, not enough to teach it from: ${lista}. Treat them as lessons without material.`
      );
    }

    partes.push(
      `${huecos.join('\n\n')}\n\n` +
        `Do NOT start building yet. Tell the teacher plainly which lessons the uploaded material does not cover (for a weak source, name it and say it only mentions the topic), and ask what they want for those — in their language, as a normal sentence, not a list of options dressed up as a menu. The three real answers are: (a) upload the document that covers them, (b) drop them from the plan, or (c) have you write them from general professional knowledge, which you will then mark as such in the lesson.\n\n` +
        `Say it as the useful observation it is ("con el material que subiste puedo escribir 2 de las 7 lecciones bien; para las otras 5 necesitaría el manual de procedimientos"), and then wait for their answer. Guessing which one they want is the failure this check exists to prevent.`
    );
  }

  return partes.join('\n\n');
}
