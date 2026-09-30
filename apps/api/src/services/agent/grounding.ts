import { generateObject } from 'ai';
import { z } from 'zod';
import { type AIProviderConfig, createModel, resolveModelName } from '@cio/ai-assistant';
import { etiquetasDeDiagrama } from '@api/services/agent/lesson-blocks';
import { buildSourcePack } from '@api/services/agent/source-pack';
import { prepararParaElJuez } from '@api/services/agent/unsupported-passages';
import { recordTokenUsage } from '@api/services/agent/usage';
import type { RedisClient } from '@api/utils/redis/redis';

/**
 * El chequeo de fundamento: contrastar lo que la lección AFIRMA contra lo que
 * las fuentes SOSTIENEN.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * Este agente tenía dos reglas sobre cómo escribir una lección:
 *
 *   1. que fuera larga  → se medía en el servidor (`validateLessonDepth`) y el
 *      resultado volvía al modelo como un aviso.
 *   2. que saliera de una fuente real → se pedía en prosa dentro del prompt, y
 *      nadie comprobaba nada.
 *
 * Cuando dos reglas chocan y sólo una se verifica, gana la que se verifica. Con
 * una fuente de quince palabras y un piso de setecientas, la única presión real
 * que sentía el modelo era «escribí más», y el hueco se llenó inventando: un
 * organigrama que el parser no pudo leer terminó convertido en una jerarquía
 * completa que nadie de esa empresa escribió, presentada a los ingresantes como
 * su estructura real.
 *
 * El piso de palabras ya no está. Esto es la otra mitad: poner del lado
 * verificable la regla que sí importa. No se agrega una frase al prompt — se
 * agrega una MEDICIÓN, y vuelve por el mismo canal que los avisos de diagramas,
 * que es el único mecanismo de este agente que, medido, cambia lo que escribe a
 * continuación.
 *
 * ── Qué NO es ────────────────────────────────────────────────────────────────
 *
 * No es un corrector de estilo ni un juez de calidad. Sólo pregunta una cosa:
 * ¿hay acá una afirmación concreta y consecuente que la fuente no respalda? Un
 * aviso que salta seguido es un aviso que se aprende a ignorar, y eso arruinaría
 * también los avisos que hoy funcionan.
 */

/** Sin esto no se llama a nadie. `false` lo apaga entero. */
export function chequeoHabilitado(): boolean {
  return process.env.AGENT_GROUNDING_CHECK?.trim().toLowerCase() !== 'false';
}

/**
 * Tope de afirmaciones que se devuelven.
 *
 * Cinco alcanzan para que el modelo entienda que el problema es sistemático sin
 * convertir la salida de la herramienta en un informe. Si hay más de cinco, el
 * problema no es una frase suelta: es que a esa lección le falta material, y eso
 * se resuelve pidiendo el documento, no corrigiendo línea por línea.
 */
export const MAX_AFIRMACIONES = 5;

/**
 * Presupuesto de fuentes para el verificador, más chico que el del agente.
 *
 * El que escribe necesita el material entero para decidir qué contar. El que
 * verifica sólo necesita poder encontrar el respaldo de una frase; y esta
 * llamada se repite una vez por lección, así que su presupuesto se paga por
 * dieciséis.
 */
export const PRESUPUESTO_FUENTES_TOKENS = 120_000;

/** Largo mínimo de una cita para que valga la pena verificarla contra el texto. */
const MIN_CARACTERES_CITA = 15;

/**
 * Cuánto se espera al juez antes de cortarlo.
 *
 * Su mediana medida es de 3 a 5 segundos todos los días, y sin tope una vez
 * tardó 67: una sola lección se llevó 155 s de construcción esperando a un
 * juez que devolvió cero avisos. Pasado esto la llamada se aborta y el estado
 * queda `failed` con el motivo — la lección ya está guardada, así que cortar
 * no pierde nada y esperar sí.
 */
export const TIEMPO_MAXIMO_JUEZ_MS = 25_000;

/** ¿El error es el corte por tiempo que pidió quien llamó? */
export function esCortePorTiempo(error: unknown): boolean {
  const nombre = (error as { name?: string } | null)?.name;

  return nombre === 'TimeoutError' || nombre === 'AbortError';
}

const Resultado = z.object({
  afirmaciones: z
    .array(
      z.object({
        cita: z
          .string()
          .describe('The exact fragment of the lesson that makes the claim, copied verbatim, 5-20 words.'),
        porque: z
          .string()
          .describe('One sentence: what the sources actually say, or that they say nothing about it.')
      })
    )
    .describe('Empty when every checkable claim in the lesson is supported by the sources.')
});

const INSTRUCCION = `You are checking a lesson against the source material it was supposed to be written from. Report ONLY claims the sources do not support.

Flag a claim when ALL of these hold:
- It is SPECIFIC and checkable: a named person or role, an organisational structure, a number, a date, a price, a deadline, a procedure, a policy, a tool or product name, a rule the reader is expected to follow, something attributed to this organisation.
- It is CONSEQUENTIAL: a learner acting on it, or repeating it, would be wrong.
- The sources do not state it, and it does not follow from what they state.

Never flag:
- General knowledge, definitions of common terms, or standard professional practice presented as such — unless you are CERTAIN it is false (a rule about how a well-known tool or standard behaves that is not true). Then flag it, and say in \`porque\` what is actually true.
- Pedagogical framing, transitions, summaries, questions to the reader, encouragement.
- Anything the sources do support, even if the lesson words it differently, reorganises it, or gives it a clearer name.
- Anything the lesson itself marks as a hypothesis or a gap ("confirm with your supervisor", "the material does not cover this").

Text the writer marked as a made-up worked example arrives wrapped as [example: ...]. Its names, numbers, prices and dates are invented on purpose and declared as such: never flag those. But a general rule, a definition or a claim about how something works that the example states is still a claim — judge it like any other sentence.

Read the diagrams too. Text extracted from a figure arrives marked as [diagram: ...]; an invented box in an org chart is exactly the kind of claim that matters here, and it is the one that started this.

For each claim you report, copy the fragment of the lesson VERBATIM, character for character, so it can be located in the text. Do not paraphrase it, do not fix its punctuation, do not translate it.

Being wrong in either direction has a cost, and they are not symmetric: a false alarm teaches the writer to ignore this check, which is worse than the claim you were unsure about. When in doubt, say nothing.

If everything checkable is supported, return an empty list.`;

/**
 * El texto de la lección tal como lo mira el verificador.
 *
 * La parte que importa acá es el SVG. `countLessonWords` lo saca entero, y con
 * razón: contar coordenadas como si fueran palabras dejaría pasar una lección
 * por el peso de su marcado. Pero el caso que motivó todo esto —la jerarquía
 * inventada— vivía DENTRO de un diagrama. Sacar el SVG sería no mirar
 * exactamente donde apareció el problema.
 *
 * Así que se conservan las etiquetas (`<text>`) y se tira la geometría, que es
 * lo que el verificador no puede juzgar y sí paga por leer.
 */
export function textoDeLeccion(html: string): string {
  const conDiagramas = html.replace(/<svg\b[\s\S]*?<\/svg>/gi, (svg) => {
    // La extracción vive en `lesson-blocks.ts` y no acá: la vista previa de un
    // bloque y este texto tienen que mostrar las mismas etiquetas, y dos copias
    // de la misma regex terminan sin serlo — el primer arreglo llega a una sola.
    const etiquetas = etiquetasDeDiagrama(svg);

    return etiquetas.length > 0 ? ` [diagram: ${etiquetas.join(' · ')}] ` : ' ';
  });

  return conDiagramas
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&(?:#39|apos);/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Forma comparable de un texto: sin acentos, sin puntuación, sin mayúsculas.
 *
 * Es a propósito tolerante. Lo que se está comprobando no es que el verificador
 * copie bien las comillas tipográficas, es que la frase que critica EXISTA en la
 * lección.
 *
 * Exportada porque la evidencia de una pregunta se comprueba igual
 * (`evidencia-de-preguntas.ts`) y dos normalizadores que TIENEN que coincidir
 * terminan no coincidiendo: el primer arreglo llega a uno solo.
 */
export function normalizarParaComparar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ¿La cita está de verdad en la lección?
 *
 * El verificador es un modelo, y un modelo puede inventar la frase que denuncia
 * igual que el otro inventó el organigrama. Un aviso sobre una frase que nadie
 * escribió es peor que ningún aviso: el modelo sale a buscarla, no la encuentra
 * y aprende que este canal miente.
 *
 * Por eso la cita se comprueba contra el texto ACÁ, en el servidor, donde no hay
 * nada que interpretar. Es el mismo principio que el resto del archivo: lo que
 * se puede verificar se verifica.
 */
export function citaAparece(cita: string, textoLeccion: string): boolean {
  const enLaLeccion = normalizarParaComparar(textoLeccion);

  // Una cita cortada con puntos suspensivos ("el director … de la empresa") no
  // existe entera en ningún lado. Se comprueba el tramo más largo, que es el que
  // lleva la afirmación.
  const tramo = cita
    .split(/…|\.\.\./)
    .map((parte) => normalizarParaComparar(parte))
    .sort((a, b) => b.length - a.length)[0];

  if (!tramo || tramo.length < MIN_CARACTERES_CITA) return false;

  return enLaLeccion.includes(tramo);
}

export interface AfirmacionSinRespaldo {
  cita: string;
  porque: string;
}

/**
 * Lo que se le devuelve al modelo, en su idioma de trabajo (inglés, como el
 * resto de los avisos de herramientas).
 *
 * Dice qué hacer y, sobre todo, qué NO hacer: la salida incorrecta acá es
 * reemplazar la afirmación inventada por otra afirmación inventada. Una lección
 * más corta y honesta, más un pedido concreto de material, es un buen resultado
 * — y desde que no hay piso de palabras, es un resultado que el sistema permite.
 */
export function redactarAviso(afirmaciones: AfirmacionSinRespaldo[]): string[] {
  if (afirmaciones.length === 0) return [];

  const lista = afirmaciones.map((a, i) => `${i + 1}. "${a.cita}" — ${a.porque}`).join('\n');

  // La herramienta que se nombra es la de por bloque. Decía «edit_lesson_content»,
  // que es la de REPUESTO (exige copiar el HTML textual, y falla con cualquier
  // etiqueta de por medio): medido, el constructor la siguió, falló contra un
  // `<strong>`, y terminó borrando el bloque entero con la otra.
  return [
    `This lesson states things the course sources do not support:\n${lista}\n\n` +
      `Fix each one now with replace_lesson_block on the block that carries it (take its blockId from get_lesson_content or from a search_lessons match; edit_lesson_content only for a lesson without block ids), before writing anything else. For each one: rewrite it so it says only what the source actually supports — or, when the note above says what is actually true, correct it to that — or delete it. Do NOT replace an unsupported claim with a different unsupported claim, and do NOT soften it into a vague version of itself. Leave every other sentence of the block exactly as it is.\n\n` +
      `If the material is genuinely missing and the lesson needs it to teach the topic, say so to the teacher and name the document you would need. There is no minimum length here: a shorter honest lesson plus a clear request is the correct outcome, and inventing the gap shut is not.`
  ];
}

/**
 * Las citas de un aviso ya redactado, para cuando sólo se tiene el texto.
 *
 * El juez devuelve las afirmaciones estructuradas (`ResultadoDeFundamento.
 * afirmaciones`), pero un verificador de otra procedencia puede traer sólo los
 * avisos en prosa. La guardia del rebote necesita saber QUÉ frases se pidió
 * cambiar para saber qué bloques pueden cambiar, y esto las rescata de la lista
 * numerada que arma `redactarAviso`.
 */
export function citasDeLosAvisos(avisos: string[]): string[] {
  return avisos.flatMap((aviso) => [...aviso.matchAll(/^\d+\. "(.+)" — /gm)].map((m) => m[1]));
}

/** Una fuente tal como la tuvo delante quien escribió. */
export interface FuenteVista {
  fileName: string;
  text: string;
}

/**
 * Si el chequeo CORRIÓ, y si no, por qué.
 *
 * ── Por qué hace falta decirlo ───────────────────────────────────────────────
 *
 * Antes esto devolvía `string[]` y el `catch` devolvía `[]`: una caída del
 * proveedor y una lección impecable llegaban al informe EXACTAMENTE iguales —
 * `groundingWarnings: []`—, sin una línea de diferencia en ningún lado. En una
 * construcción de dieciséis lecciones eso son dieciséis lecciones «limpias» que
 * nadie verificó, y el docente leyendo el informe no tiene cómo enterarse.
 *
 * Por eso el resultado dice el estado y no sólo los hallazgos: «sin avisos» y
 * «no se miró» son cosas opuestas y tienen que llegar como cosas distintas.
 */
export type EstadoDelFundamento = 'ok' | 'skipped' | 'failed';

export interface ResultadoDeFundamento {
  /** Lo que hay que arreglar. Vacío cuando corrió y salió limpio, y cuando no corrió. */
  avisos: string[];
  estado: EstadoDelFundamento;
  /** Por qué no corrió. Sólo cuando `estado` no es `ok`. */
  motivo?: string;
  /**
   * Las mismas afirmaciones que `avisos`, sin redactar: la cita y el porqué.
   *
   * La guardia del rebote las necesita para saber qué bloques se pidió cambiar
   * (los que contienen una cita) y cuáles tienen que volver idénticos. Sólo
   * cuando hay alguna.
   */
  afirmaciones?: AfirmacionSinRespaldo[];
}

/** Lo que devuelve una ronda sin verificador: no corrió, y se dice. */
export const SIN_VERIFICADOR: ResultadoDeFundamento = {
  avisos: [],
  estado: 'skipped',
  motivo: 'the grounding check is off on this round'
};

/**
 * El resultado del juez para una versión cuyo TEXTO no cambió: sólo se le
 * agregaron marcas.
 *
 * ── Por qué no se lo vuelve a llamar ─────────────────────────────────────────
 *
 * Medido el 2026-09-29: el rebote pagaba un juez nuevo por cada lección aunque
 * la corrección sólo hubiera agregado atributos, y ese segundo juez se llevaba
 * la mitad del tiempo del rebote. Con el mismo texto el juez ve lo mismo, salvo
 * lo que ahora quedó declarado:
 *
 *   - un pasaje marcado `data-sin-fuente` sale de lo que ve el juez, así que una
 *     afirmación que caía ahí ya está declarada como hueco y se va;
 *   - un ejemplo marcado sigue a la vista (`[example: …]`), así que lo que el
 *     bloque afirmaba sigue en pie.
 *
 * Es la misma cuenta que hace el juez con su propia regla de la cita
 * (`citaAparece`), sin salir a la red.
 */
export function fundamentoParaElMismoTexto(previo: ResultadoDeFundamento, contenido: string): ResultadoDeFundamento {
  if (previo.estado !== 'ok' || !previo.afirmaciones?.length) return previo;

  const texto = textoDeLeccion(prepararParaElJuez(contenido));
  const siguen = previo.afirmaciones.filter((afirmacion) => citaAparece(afirmacion.cita, texto));

  return { avisos: redactarAviso(siguen), estado: 'ok', ...(siguen.length > 0 ? { afirmaciones: siguen } : {}) };
}

export type Verificador = (params: {
  lessonTitle: string;
  contenido: string;
  /**
   * Lo que tuvo delante quien escribió la lección, cuando se sabe.
   *
   * El escritor de lecciones recibe SÓLO las fuentes que el plan le asignó.
   * Contrastar su lección contra todo el curso sería más blando de lo que
   * corresponde: una afirmación sacada de otra fuente no pudo salir de lo que el
   * escritor leyó, así que vino de su memoria — y eso es exactamente lo que se
   * quiere encontrar.
   *
   * Vacío o ausente: se contrasta contra el paquete de fuentes del curso. Es el
   * caso de una lección escrita sin material asignado, desde el conocimiento
   * general: las prácticas generales presentadas como tales pasan, pero una
   * política atribuida a ESTA empresa que ninguna fuente dice, no.
   */
  soloFuentes?: FuenteVista[];
}) => Promise<ResultadoDeFundamento>;

/**
 * Las fuentes propias de una lección, con la misma forma que el paquete del
 * curso para que el verificador lea lo mismo en los dos casos.
 */
export function materialPropio(fuentes: FuenteVista[]): string {
  const bloques = fuentes.map((f) => `--- Source: ${f.fileName} (full text) ---\n${f.text}`);

  return `## Course Sources (${fuentes.length})\n\n${bloques.join('\n\n')}`.slice(0, PRESUPUESTO_FUENTES_TOKENS * 4);
}

function modeloVerificador(config: AIProviderConfig): string {
  const override = process.env.AGENT_GROUNDING_MODEL?.trim();
  if (override) return override;

  return config.model || resolveModelName(config.provider);
}

/**
 * Arma el verificador para una ronda del agente.
 *
 * Devuelve `undefined` sólo cuando el chequeo está apagado por configuración.
 * El caso «este curso no tiene fuentes» no se decide acá sino al cargarlas: si
 * el paquete viene vacío, el verificador no marca nada. Un curso sin fuentes se
 * escribe legítimamente desde el conocimiento general del modelo, y correr el
 * chequeo ahí marcaría la lección entera hasta que el aviso no valiera nada.
 *
 * Se resuelve así, y no con un contador recibido de afuera, porque un contador
 * puede desactualizarse respecto de lo que el paquete trae de verdad; el paquete
 * vacío no puede.
 *
 * Las fuentes se cargan UNA vez por ronda y quedan en el cierre. La ronda de
 * construcción escribe dieciséis lecciones seguidas; volver a armar el paquete
 * en cada una sería pagar dieciséis veces por los mismos bytes, y además los
 * cambiaría, que es justo lo que rompe la caché del proveedor.
 */
export function crearVerificadorDeFundamento(params: {
  orgId: string;
  userId: string;
  courseId: string;
  redis: RedisClient;
  providerConfig: AIProviderConfig;
  /** Cuánto esperar al juez. Ver `TIEMPO_MAXIMO_JUEZ_MS`; los tests lo acortan. */
  tiempoMaximoMs?: number;
}): Verificador | undefined {
  if (!chequeoHabilitado()) return undefined;

  const modelName = modeloVerificador(params.providerConfig);
  const model = createModel({ ...params.providerConfig, model: modelName });

  let fuentesPromesa: Promise<string | undefined> | null = null;

  function fuentes(): Promise<string | undefined> {
    fuentesPromesa ??= buildSourcePack({
      courseId: params.courseId,
      redis: params.redis,
      budgetTokens: PRESUPUESTO_FUENTES_TOKENS
    })
      .then((pack) => pack.text)
      .catch((error) => {
        console.error('[grounding] no se pudieron cargar las fuentes:', error);
        return undefined;
      });

    return fuentesPromesa;
  }

  const tiempoMaximoMs = params.tiempoMaximoMs ?? TIEMPO_MAXIMO_JUEZ_MS;

  return async ({ lessonTitle, contenido, soloFuentes }) => {
    // Un pasaje que el escritor declaró como propio no entra: ya está declarado,
    // y volver a marcarlo le enseñaría que declarar no sirve de nada. Un ejemplo
    // marcado SÍ entra, envuelto: ver `prepararParaElJuez`. `citaAparece` se
    // comprueba contra esta misma variable, así que el verificador no puede
    // citar algo que no llegó a ver.
    const texto = textoDeLeccion(prepararParaElJuez(contenido));

    // Una lección de dos frases no tiene afirmaciones que valga la pena
    // contrastar, y sigue costando el paquete de fuentes entero.
    if (texto.length < 400) {
      return { avisos: [], estado: 'skipped', motivo: 'the lesson is too short to have checkable claims' };
    }

    const material = soloFuentes && soloFuentes.length > 0 ? materialPropio(soloFuentes) : await fuentes();

    if (!material) {
      // Un curso sin fuentes legibles se escribe desde el conocimiento general
      // y esto no marca nada: es correcto, pero no es «limpia».
      return { avisos: [], estado: 'skipped', motivo: 'no readable source material to check against' };
    }

    try {
      const { object, usage } = await generateObject({
        model,
        schema: Resultado,
        system: INSTRUCCION,
        prompt: `${material}\n\n--- Lesson: ${lessonTitle} ---\n${texto}`,
        maxRetries: 0,
        // Con tope: ver `TIEMPO_MAXIMO_JUEZ_MS`.
        abortSignal: AbortSignal.timeout(tiempoMaximoMs)
      });

      // Se cobra: es una llamada al proveedor como cualquier otra, y si no se
      // registra, el consumo del mes miente hacia abajo justo cuando el cupo es
      // la restricción que aprieta.
      await recordTokenUsage(
        params.orgId,
        params.userId,
        params.courseId,
        {
          promptTokens: usage.inputTokens ?? 0,
          completionTokens: usage.outputTokens ?? 0,
          totalTokens: usage.totalTokens ?? 0,
          // Mismo desglose que usa la ronda del agente. Importa: `inputTokens`
          // ya incluye lo que se leyó de caché, así que sin este campo el costo
          // se calcularía como si nada se hubiera cacheado.
          cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens || undefined,
          cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens || undefined
        },
        modelName,
        params.providerConfig.provider
      ).catch((error) => console.error('[grounding] no se pudo registrar el consumo:', error));

      const reportadas = object.afirmaciones ?? [];
      const reales = reportadas.filter((a) => citaAparece(a.cita, texto)).slice(0, MAX_AFIRMACIONES);

      const descartadas = reportadas.length - reales.length;
      console.info(
        `[grounding] "${lessonTitle}": ${reportadas.length} afirmación(es) reportada(s), ` +
          `${reales.length} con cita verificable${descartadas > 0 ? `, ${descartadas} descartada(s) por cita inexistente` : ''}`
      );

      return { avisos: redactarAviso(reales), estado: 'ok', ...(reales.length > 0 ? { afirmaciones: reales } : {}) };
    } catch (error) {
      // Nunca puede tumbar la escritura de una lección: la lección queda
      // guardada igual. Lo que ya no pasa es que se guarde como si se hubiera
      // verificado — el motivo viaja al informe y de vuelta al modelo.
      const motivo = esCortePorTiempo(error)
        ? `the check took longer than ${Math.round(tiempoMaximoMs / 1000)} s and was stopped`
        : error instanceof Error
          ? error.message
          : String(error);

      console.error(`[grounding] no corrió para «${lessonTitle}»: ${motivo}`);

      return { avisos: [], estado: 'failed', motivo };
    }
  };
}

/** Sólo para que el test pueda leer la instrucción sin duplicarla. */
export const INSTRUCCION_VERIFICADOR = INSTRUCCION;
