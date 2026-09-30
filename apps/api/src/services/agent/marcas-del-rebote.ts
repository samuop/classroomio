import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import { type AIProviderConfig, createModel, resolveModelName } from '@cio/ai-assistant';
import { normalizarParaComparar } from '@api/services/agent/grounding';
import { textoParaTokens, type DecisionSobreToken, type HallazgoDeToken } from '@api/services/agent/grounding-tokens';
import { listarElementosDePrimerNivel, listLessonBlocks } from '@api/services/agent/lesson-blocks';
import { ATRIBUTO_EJEMPLO, ATRIBUTO_SIN_FUENTE } from '@api/services/agent/unsupported-passages';
import { recordTokenUsage } from '@api/services/agent/usage';

/**
 * El rebote por PARCHE: el escritor decide qué es cada dato sin respaldo, y el
 * servidor sólo pone la marca. El texto no se toca.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * Producción, 2026-09-29, un curso de planillas. El rebote le devolvía al
 * escritor la lección ENTERA con los datos que el chequeo no encontraba, y le
 * daba tres salidas: marcarlo como ejemplo, marcarlo como afirmación sin
 * fuente, o «borrarlo o reemplazarlo por lo que dice el material». Un dato
 * cierto de conocimiento general —las pestañas de la cinta, las teclas Enter y
 * Tab, la última columna— o una frase del pedido de la docente no entraba en
 * ninguna de las dos primeras, así que la instrucción literal era la tercera.
 * La segunda versión borró las pestañas, las teclas y el contexto que la
 * docente había pedido, y pasó «1.048.576» a «1,048,576» porque así lo
 * escribía la fuente. Y como era una reescritura, costaba una llamada de
 * escritor entera (12 a 30 s) más otro juez: medido, el 54 % del tiempo de
 * escribir lecciones.
 *
 * ── Qué hace ─────────────────────────────────────────────────────────────────
 *
 * Una llamada chica que devuelve, por DATO (bloque + dato), una de tres
 * decisiones:
 *
 *   - `ejemplo`: un ejemplo inventado → el elemento que lo lleva recibe
 *     `data-ejemplo`.
 *   - `sin-fuente`: una afirmación sobre la organización que el material no
 *     dice → el elemento recibe `data-sin-fuente`.
 *   - `mantener`: conocimiento general correcto → no se marca nada; el dato
 *     queda en el informe con ese rótulo y su motivo, y NO vuelve al constructor.
 *
 * Por dato y no por bloque: decidido por bloque, una lista con un renglón de
 * conocimiento general («la pestaña Insertar») y uno de ejemplo marcaba los dos
 * como inventados, y un párrafo «mantener» rotulaba como conocimiento general
 * también el nombre inventado que tenía al lado.
 *
 * El servidor pone el atributo y nada más. No hay forma de que un dato se
 * borre, se renombre o cambie de formato, porque ninguna respuesta posible toca
 * el texto — y eso se comprueba antes de guardar (`aplicarMarcas`).
 */

/**
 * Cuánto se espera la decisión.
 *
 * Es una respuesta de unas pocas líneas por bloque; las medidas de una llamada
 * así andan entre 3 y 6 s. Pasado esto se corta: los datos quedan en el informe
 * sin marcar, que es lo mismo que pasaría si no hubiera parche.
 */
export const TIEMPO_MAXIMO_PARCHE_MS = 20_000;

/** Cuántos bloques entran en una llamada: la lección entera casi nunca pasa de esto. */
export const MAX_BLOQUES_DEL_PARCHE = 16;

/** Cuánto texto de cada bloque ve el escritor: lo necesario para reconocerlo. */
const MAX_TEXTO_DEL_BLOQUE = 700;

/** Lo que el escritor escribe como motivo, recortado: va adentro de un atributo. */
const MAX_MOTIVO = 200;

/** Un bloque de la lección con los datos que no aparecieron en ningún lado. */
export interface BloqueParaMarcar {
  blockId: string;
  /** Su texto, aplanado igual que para el chequeo. */
  texto: string;
  /** Los datos, tal como aparecen en la lección. */
  tokens: string[];
}

export interface EntradaDelParche {
  lessonTitle: string;
  brief: string;
  locale: string;
  bloques: BloqueParaMarcar[];
}

export interface DecisionDelParche {
  blockId: string;
  /** El dato sobre el que se decide, tal como se le listó. */
  token: string;
  accion: DecisionSobreToken;
  motivo: string;
}

export type MarcadorDeTokens = (entrada: EntradaDelParche) => Promise<DecisionDelParche[]>;

/**
 * Lo que devuelve el modelo. Todo obligatorio y sin valores por defecto: un
 * campo opcional, Gemini lo deja vacío, y una decisión sin bloque o sin acción
 * es una decisión que no se puede aplicar.
 */
export const EsquemaDelParche = z.object({
  decisiones: z
    .array(
      z.object({
        blockId: z.string().describe('The id of the block, copied exactly as listed.'),
        token: z.string().describe('The flagged data this decision is about, copied exactly as listed for that block.'),
        accion: z
          .enum(['ejemplo', 'sin-fuente', 'mantener'])
          .describe('"ejemplo", "sin-fuente" or "mantener", as defined in the instructions.'),
        motivo: z
          .string()
          .describe(
            'In the course language, one short phrase: what the example illustrates (ejemplo), what the material is missing (sin-fuente), or why the data is correct general knowledge (mantener).'
          )
      })
    )
    .describe('Exactly one decision per flagged data point of each block listed.')
});

export const INSTRUCCION_DEL_PARCHE = `You wrote a lesson of an online course. The server searched every name, number and quoted term in it in the lesson's source material, in the other sources of the course, in the teacher's own words and in the approved course plan — and could not find the ones listed below. For each flagged data point of each block, decide which of three things it is. Decide each data point on its own: one block can hold an invented example next to a correct general fact.

You cannot change the text. The server only adds a mark to the line or paragraph that carries the data point, so nothing you answer can delete, reword or reformat anything.

- "ejemplo": the data point belongs to a worked example you made up — invented names, prices, quantities, dates, codes, products. Its line gets marked as an example. In \`motivo\`, say in one short phrase what the example illustrates.
- "sin-fuente": the data point states something SPECIFIC TO THIS ORGANISATION — one of its rules, figures, areas, products, schedules or procedures — that the material does not say. Its line gets marked as a gap the teacher has to confirm. In \`motivo\`, say for the teacher what the material is missing.
- "mantener": the data point is correct, well-established general knowledge of the subject — the name of a key, a menu, a button or a function of a widely used tool, a standard limit, a unit, a common term — so it needs no mark. In \`motivo\`, say in a few words why it is correct. Choose this only when you are certain it is true: anything you made up is "ejemplo", never "mantener".

Write \`motivo\` in the course language. Answer exactly once per data point listed, with its blockId and the data point copied exactly.`;

/** Recorta sin partir una palabra, con puntos suspensivos si cortó. */
function recortar(texto: string, largo: number): string {
  if (texto.length <= largo) return texto;

  const corte = texto.slice(0, largo);
  const espacio = corte.lastIndexOf(' ');

  return `${(espacio > largo * 0.6 ? corte.slice(0, espacio) : corte).trimEnd()}…`;
}

/** El mensaje del modelo: la lección que es, y los bloques con sus datos. */
export function consignaDelParche(entrada: EntradaDelParche): string {
  const bloques = entrada.bloques
    .map(
      (bloque) =>
        `[block ${bloque.blockId}]\n${recortar(bloque.texto, MAX_TEXTO_DEL_BLOQUE)}\n` +
        `Not found anywhere: ${bloque.tokens.map((token) => `«${token}»`).join(', ')}`
    )
    .join('\n\n');

  return [
    `Lesson: ${entrada.lessonTitle}`,
    `Course language: ${entrada.locale}`,
    entrada.brief.trim() ? `Brief the lesson was written from:\n${recortar(entrada.brief.trim(), 1_200)}` : '',
    `Blocks:\n\n${bloques}`
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Si un dato aparece en un texto como palabra entera, con el número y su unidad
 * juntos o separados.
 *
 * El chequeo arma el valor de un número con unidad como «500 ml», pero la
 * lección puede decir «500ml» o «24hs». Comparar el texto tal cual dejaba ese
 * dato sin bloque: nunca se le preguntaba al escritor, nunca se marcaba, y el
 * informe lo mostraba sin lugar. Era justo la clase que más rebotaba (medido en
 * producción: «Gaseosa 500ml»). Entre un dígito y una letra el espacio es
 * opcional; lo demás tiene que estar entero: «45» no está en «4555», y «500»
 * sola no está en «500ml».
 */
export function apareceElDato(texto: string, valor: string): boolean {
  const buscado = normalizarParaComparar(valor);

  if (!buscado) return false;

  // `normalizarParaComparar` deja sólo letras, dígitos y espacios simples.
  const patron = buscado.replace(/(\d) ?(?=[a-z])/g, '$1 ?').replace(/([a-z]) ?(?=\d)/g, '$1 ?');

  return new RegExp(`(?:^| )${patron}(?: |$)`).test(normalizarParaComparar(texto));
}

/**
 * Los tipos de bloque que pueden llevar una marca que sobreviva.
 *
 * Los del editor (`Ejemplo.ts`, `SinFuente.ts`: párrafo, título, cita, listas,
 * bloque de código, tabla) más el `<svg>`, cuyo markup el editor guarda crudo y
 * con sus atributos (ver la nota de `TIPOS_CON_ID` en `lesson-blocks.ts`). Una
 * imagen o un `<figure>` no: el editor no declara la marca en esos nodos y la
 * tiraría al primer guardado, así que sus datos quedan en el informe.
 */
const TIPOS_MARCABLES = new Set(['p', 'h3', 'h4', 'h5', 'blockquote', 'pre', 'ul', 'ol', 'svg', 'table']);

/**
 * Los bloques que se marcan enteros o nada: la marca va en el `<svg>` o en la
 * `<table>`, no en sus textos ni en sus filas. Se marcan sólo si TODOS sus datos
 * son de ejemplo (una planilla de productos y precios inventados); si no, sus
 * datos quedan en el informe. Marcarlos por un dato solo se llevaba fuera del
 * chequeo todos los demás.
 */
const SE_MARCAN_ENTEROS = new Set(['svg', 'table']);

const YA_MARCADO = new RegExp(`\\b(?:${ATRIBUTO_EJEMPLO}|${ATRIBUTO_SIN_FUENTE})\\s*=`, 'i');

function tagDe(html: string): string {
  return html.match(/^\s*<([a-z][a-z0-9]*)\b/i)?.[1]?.toLowerCase() ?? '';
}

/**
 * Los bloques de la lección donde aparece cada dato pendiente.
 *
 * TODOS los bloques donde aparece, no uno: el chequeo reporta cada dato una
 * sola vez aunque esté en tres párrafos, y marcar sólo el primero dejaría los
 * otros dos para el próximo chequeo — con el mismo dato, otra vez sin marcar.
 *
 * Devuelve también los datos que no quedaron en ningún bloque marcable (una
 * tabla, un bloque sin id): esos van al informe tal cual.
 */
export function prepararParche(
  html: string,
  pendientes: HallazgoDeToken[]
): { bloques: BloqueParaMarcar[]; sinBloque: HallazgoDeToken[] } {
  const bloques = listLessonBlocks(html)
    .filter((bloque) => TIPOS_MARCABLES.has(tagDe(bloque.html)))
    // Un bloque ya marcado entero no tiene nada que decidir: lo de adentro no
    // se contó.
    .filter((bloque) => !YA_MARCADO.test(bloque.html.match(/^\s*<[^>]*>/)?.[0] ?? ''))
    .map((bloque) => ({ blockId: bloque.blockId, texto: textoParaTokens(bloque.html) }));

  const porBloque = new Map<string, BloqueParaMarcar>();
  const sinBloque: HallazgoDeToken[] = [];

  for (const hallazgo of pendientes) {
    const donde = bloques.filter((bloque) => apareceElDato(bloque.texto, hallazgo.valor));

    if (donde.length === 0) {
      sinBloque.push(hallazgo);
      continue;
    }

    for (const bloque of donde) {
      const entrada = porBloque.get(bloque.blockId) ?? { ...bloque, tokens: [] };

      if (!entrada.tokens.includes(hallazgo.valor)) entrada.tokens.push(hallazgo.valor);

      porBloque.set(bloque.blockId, entrada);
    }
  }

  // En el orden de la lección, que es el orden en que el escritor la tiene en
  // la cabeza.
  const ordenados = bloques.map((bloque) => porBloque.get(bloque.blockId)).filter((b): b is BloqueParaMarcar => !!b);

  return { bloques: ordenados.slice(0, MAX_BLOQUES_DEL_PARCHE), sinBloque };
}

/**
 * Le pone a cada hallazgo el id del primer bloque donde aparece.
 *
 * Para el informe y para lo que vuelve al constructor tras una edición por
 * bloque: con el id, `replace_lesson_block` ya tiene lo que necesita y no hay
 * que salir a buscar el párrafo. Un hallazgo que ya tiene id, o que no aparece
 * en ningún bloque con id (una lección vieja), queda como estaba.
 */
export function ubicarEnBloques(html: string, hallazgos: HallazgoDeToken[]): HallazgoDeToken[] {
  if (hallazgos.length === 0) return hallazgos;

  const bloques = listLessonBlocks(html).map((bloque) => ({
    blockId: bloque.blockId,
    texto: textoParaTokens(bloque.html)
  }));

  if (bloques.length === 0) return hallazgos;

  return hallazgos.map((hallazgo) => {
    if (hallazgo.blockId) return hallazgo;

    const donde = bloques.find((bloque) => apareceElDato(bloque.texto, hallazgo.valor));

    return donde ? { ...hallazgo, blockId: donde.blockId } : hallazgo;
  });
}

/** Valor seguro para un atributo entre comillas dobles. */
function comoAtributo(valor: string): string {
  return valor.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Mete el atributo justo antes del cierre del tag de apertura, sin tocar lo demás. */
function conAtributo(openTag: string, atributo: string, valor: string): string {
  const cierre = openTag.endsWith('/>') ? '/>' : '>';
  const cuerpo = openTag.slice(0, openTag.length - cierre.length).trimEnd();

  return `${cuerpo} ${atributo}="${comoAtributo(valor)}"${cierre === '/>' ? ' />' : '>'}`;
}

/** Entre dos decisiones sobre la misma línea, la que pide confirmar a la docente pesa más. */
const PESO: Record<Exclude<DecisionSobreToken, 'mantener'>, number> = { 'sin-fuente': 2, ejemplo: 1 };

function laDeMasPeso(decisiones: DecisionDelParche[]): DecisionDelParche {
  return decisiones.reduce((elegida, otra) =>
    PESO[otra.accion as keyof typeof PESO] > PESO[elegida.accion as keyof typeof PESO] ? otra : elegida
  );
}

/**
 * Dónde va cada marca dentro de un bloque, y con qué decisión.
 *
 * En una lista, en los `<li>` que llevan un dato a marcar y no en la lista
 * entera. Es lo que se midió como daño de las marcas anchas: una lista marcada
 * por un solo número inventado se llevaba fuera del chequeo los otros
 * renglones, que eran reglas ciertas del programa. El editor acepta la marca en
 * un `<li>`. Un renglón con un dato «sin fuente» y otro «ejemplo» se marca sin
 * fuente: es lo que la docente tiene que confirmar.
 *
 * Devuelve los tramos (absolutos en `html`) de los tags de apertura a marcar.
 */
function tagsAMarcar(
  bloque: { start: number; end: number; html: string },
  aMarcar: DecisionDelParche[]
): Array<{ start: number; openEnd: number; openTag: string; decision: DecisionDelParche }> {
  const [propio] = listarElementosDePrimerNivel(bloque.html);

  if (!propio) return [];

  const tag = propio.tagName.toLowerCase();

  if (tag === 'ul' || tag === 'ol') {
    const cierre = bloque.html.toLowerCase().lastIndexOf(`</${tag}`);
    const adentro = bloque.html.slice(propio.openEnd, cierre === -1 ? bloque.html.length : cierre);
    const items = listarElementosDePrimerNivel(adentro).filter((item) => item.tagName.toLowerCase() === 'li');
    const base = bloque.start + propio.openEnd;
    const conDato = items.flatMap((item) => {
      const texto = textoParaTokens(adentro.slice(item.start, item.end));
      const suyas = aMarcar.filter((decision) => apareceElDato(texto, decision.token));

      return suyas.length > 0 ? [{ item, decision: laDeMasPeso(suyas) }] : [];
    });

    if (conDato.length > 0) {
      return conDato
        .filter(({ item }) => !YA_MARCADO.test(item.openTag))
        .map(({ item, decision }) => ({
          start: base + item.start,
          openEnd: base + item.openEnd,
          openTag: item.openTag,
          decision
        }));
    }
  }

  return [
    {
      start: bloque.start + propio.start,
      openEnd: bloque.start + propio.openEnd,
      openTag: propio.openTag,
      decision: laDeMasPeso(aMarcar)
    }
  ];
}

/**
 * Pone las marcas que el escritor decidió, y nada más.
 *
 * Se decide por dato: `mantener` no marca nada, y un elemento se marca sólo si
 * lleva un dato decidido como ejemplo o sin fuente. Una decisión sobre un
 * bloque o un dato que no se le preguntó se ignora: el modelo no puede elegir
 * marcar otra cosa que lo que se le preguntó. De cada dato vale la primera.
 *
 * Un diagrama o una tabla se marcan enteros o nada (`SE_MARCAN_ENTEROS`): sólo
 * si TODOS sus datos son de ejemplo. Si no, sus datos quedan en el informe;
 * marcarlos por uno solo se llevaba fuera del chequeo todos los demás.
 *
 * La garantía que justifica todo esto se comprueba acá: si el texto de la
 * lección cambió —y no puede, sólo se agregan atributos— no se aplica nada.
 */
export function aplicarMarcas(
  html: string,
  decisiones: DecisionDelParche[],
  bloques: BloqueParaMarcar[],
  locale = 'es'
): { html: string; aplicadas: DecisionDelParche[] } {
  const preguntados = new Map(bloques.map((bloque) => [bloque.blockId, bloque]));
  const porId = new Map(listLessonBlocks(html).map((bloque) => [bloque.blockId, bloque]));
  const parches: Array<{ start: number; openEnd: number; nuevoTag: string }> = [];
  const aplicadas: DecisionDelParche[] = [];

  const motivoLimpio = (decision: DecisionDelParche) =>
    decision.motivo.replace(/\s+/g, ' ').trim().slice(0, MAX_MOTIVO) ||
    (decision.accion === 'mantener'
      ? ''
      : locale.startsWith('es')
        ? decision.accion === 'ejemplo'
          ? 'un ejemplo inventado'
          : 'el material no lo dice'
        : decision.accion === 'ejemplo'
          ? 'a made-up example'
          : 'the material does not say this');

  // Por bloque, la primera decisión de cada dato que se le preguntó.
  const porBloque = new Map<string, DecisionDelParche[]>();
  const vistas = new Set<string>();

  for (const decision of decisiones) {
    const preguntado = preguntados.get(decision.blockId);

    if (!preguntado || !porId.has(decision.blockId)) continue;

    const buscado = normalizarParaComparar(decision.token ?? '');
    const token = preguntado.tokens.find((candidato) => normalizarParaComparar(candidato) === buscado);

    if (!token) continue;

    const clave = `${decision.blockId} ${buscado}`;

    if (vistas.has(clave)) continue;

    vistas.add(clave);
    porBloque.set(decision.blockId, [
      ...(porBloque.get(decision.blockId) ?? []),
      { ...decision, token, motivo: motivoLimpio(decision) }
    ]);
  }

  for (const [blockId, delBloque] of porBloque) {
    const bloque = porId.get(blockId)!;
    const preguntado = preguntados.get(blockId)!;

    aplicadas.push(...delBloque.filter((decision) => decision.accion === 'mantener'));

    const aMarcar = delBloque.filter((decision) => decision.accion !== 'mantener');

    if (aMarcar.length === 0) continue;

    if (SE_MARCAN_ENTEROS.has(tagDe(bloque.html))) {
      const todosDeEjemplo = preguntado.tokens.every((token) =>
        delBloque.some((decision) => decision.token === token && decision.accion === 'ejemplo')
      );

      if (!todosDeEjemplo) continue;
    }

    const tags = tagsAMarcar(bloque, aMarcar);

    if (tags.length === 0) continue;

    for (const tag of tags) {
      const atributo = tag.decision.accion === 'ejemplo' ? ATRIBUTO_EJEMPLO : ATRIBUTO_SIN_FUENTE;

      parches.push({
        start: tag.start,
        openEnd: tag.openEnd,
        nuevoTag: conAtributo(tag.openTag, atributo, tag.decision.motivo)
      });
    }

    aplicadas.push(...aMarcar);
  }

  if (parches.length === 0) return { html, aplicadas };

  let resultado = html;

  // De atrás para adelante: cada tag nuevo es más largo que el viejo y correría
  // los tramos de los que faltan.
  for (const parche of [...parches].sort((a, b) => b.start - a.start)) {
    resultado = resultado.slice(0, parche.start) + parche.nuevoTag + resultado.slice(parche.openEnd);
  }

  if (textoParaTokens(resultado) !== textoParaTokens(html)) {
    console.error('[parche] el texto de la lección cambió al marcar: no se aplica nada');

    return { html, aplicadas: aplicadas.filter((decision) => decision.accion === 'mantener') };
  }

  return { html: resultado, aplicadas };
}

/** Lo que lee la docente al lado de un dato que el escritor decidió mantener. */
export const ROTULO_MANTENER = 'quien la escribió lo da por conocimiento general del tema';

/**
 * Anota en los hallazgos que quedaron lo que el escritor decidió mantener.
 *
 * Un dato que el escritor dio por conocimiento general sigue sin estar en las
 * fuentes, así que el chequeo lo vuelve a encontrar. Con la anotación va al
 * informe con su rótulo y SU motivo, y `vaAlModelo` ya no lo manda al
 * constructor — que es lo que la decisión significa. Dato por dato: cuando se
 * decidía por bloque, un nombre inventado aparecía en verde en el informe con
 * el motivo de la tecla que tenía al lado.
 *
 * `bloques` queda por compatibilidad: la decisión ya dice de qué dato es.
 */
export function anotarDecisiones(
  hallazgos: HallazgoDeToken[],
  decisiones: DecisionDelParche[],
  _bloques?: BloqueParaMarcar[]
): HallazgoDeToken[] {
  const mantenidos = new Map<string, string>();

  for (const decision of decisiones) {
    if (decision.accion !== 'mantener' || !decision.token) continue;

    const clave = normalizarParaComparar(decision.token);

    if (!mantenidos.has(clave)) mantenidos.set(clave, decision.motivo);
  }

  if (mantenidos.size === 0) return hallazgos;

  return hallazgos.map((hallazgo) => {
    const motivo = mantenidos.get(normalizarParaComparar(hallazgo.valor));

    return motivo === undefined || hallazgo.respaldo
      ? hallazgo
      : { ...hallazgo, decision: 'mantener' as const, rotulo: ROTULO_MANTENER, ...(motivo ? { motivo } : {}) };
  });
}

/**
 * Arrastra a una lista recalculada lo que el escritor ya había decidido
 * mantener.
 *
 * Al recalcular el informe tras una edición por bloque, los datos se vuelven a
 * buscar de cero: sin esto, los que el escritor dio por conocimiento general
 * (con su motivo) volvían al informe como datos sin respaldo. Se arrastra por
 * valor, y sólo a los que siguen en la lección y no ganaron otro respaldo.
 */
export function arrastrarDecisiones(nuevos: HallazgoDeToken[], previos: HallazgoDeToken[]): HallazgoDeToken[] {
  const mantenidos = new Map(
    previos
      .filter((previo) => previo && previo.decision === 'mantener' && typeof previo.valor === 'string')
      .map((previo) => [normalizarParaComparar(previo.valor), previo] as const)
  );

  if (mantenidos.size === 0) return nuevos;

  return nuevos.map((hallazgo) => {
    const previo = mantenidos.get(normalizarParaComparar(hallazgo.valor));

    if (!previo || hallazgo.respaldo || hallazgo.decision) return hallazgo;

    return {
      ...hallazgo,
      decision: 'mantener' as const,
      rotulo: previo.rotulo ?? ROTULO_MANTENER,
      ...(previo.motivo ? { motivo: previo.motivo } : {})
    };
  });
}

/**
 * Arma el marcador para una ronda.
 *
 * Mismo modelo que el escritor —es el escritor decidiendo sobre lo que
 * escribió— pero con una consigna propia y chica, sin el material: los datos
 * que llegan acá ya se buscaron en todas las fuentes y no están, así que lo
 * que hay que decidir es QUÉ son, no dónde están.
 *
 * Nunca tira: si la llamada falla o se pasa de tiempo, devuelve lista vacía y
 * los datos quedan en el informe sin marcar.
 */
export function crearMarcadorDeTokens(params: {
  orgId: string;
  userId: string;
  courseId: string;
  providerConfig: AIProviderConfig;
  /** El modelo ya armado del escritor, para no crear otro. */
  model?: LanguageModel;
  modelName?: string;
  tiempoMaximoMs?: number;
}): MarcadorDeTokens {
  const modelName =
    params.modelName ||
    process.env.AGENT_WRITER_MODEL?.trim() ||
    params.providerConfig.model ||
    resolveModelName(params.providerConfig.provider);
  const model = params.model ?? createModel({ ...params.providerConfig, model: modelName });
  const tiempoMaximoMs = params.tiempoMaximoMs ?? TIEMPO_MAXIMO_PARCHE_MS;

  return async (entrada) => {
    if (entrada.bloques.length === 0) return [];

    const inicio = Date.now();

    try {
      const { object, usage } = await generateObject({
        model,
        schema: EsquemaDelParche,
        system: INSTRUCCION_DEL_PARCHE,
        prompt: consignaDelParche(entrada),
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(tiempoMaximoMs)
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
      ).catch((error) => console.error('[parche] no se pudo registrar el consumo:', error));

      const decisiones = (object.decisiones ?? []).filter(
        (decision) =>
          decision &&
          typeof decision.blockId === 'string' &&
          decision.blockId.trim().length > 0 &&
          typeof decision.token === 'string' &&
          decision.token.trim().length > 0
      );

      console.info(
        `[parche] «${entrada.lessonTitle}»: ${entrada.bloques.length} bloque(s), ` +
          `${decisiones.map((decision) => `${decision.blockId}:«${decision.token}»=${decision.accion}`).join(' ')}, ` +
          `${((Date.now() - inicio) / 1000).toFixed(1)} s`
      );

      return decisiones.map((decision) => ({
        blockId: decision.blockId.trim(),
        token: decision.token.trim(),
        accion: decision.accion,
        motivo: decision.motivo ?? ''
      }));
    } catch (error) {
      const motivo = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

      console.error(`[parche] no se pudo decidir para «${entrada.lessonTitle}»: ${motivo}`);

      return [];
    }
  };
}
