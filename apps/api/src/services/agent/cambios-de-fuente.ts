import { generateObject } from 'ai';
import { z } from 'zod';
import { createModel, resolveModelName, type AIProviderConfig } from '@cio/ai-assistant';
import { buscarEnLecciones } from '@api/services/agent/lesson-search';
import { normalizarParaComparar } from '@api/services/agent/grounding';
import { recordTokenUsage } from '@api/services/agent/usage';

/**
 * Qué del curso cambia cuando el docente sube una circular nueva.
 *
 * ── Qué problema resuelve ────────────────────────────────────────────────────
 *
 * Medido el 2026-09-21: «actualizá la sección con esta circular» salió bien, y
 * costó 153 segundos y la reescritura completa de cuatro lecciones para cambiar
 * TRES datos. El agente no tenía cómo saber cuáles eran los tres: leyó el
 * documento, leyó las lecciones, y como no podía distinguir lo que cambiaba de
 * lo que no, reescribió todo. Cada reescritura es una oportunidad nueva de
 * inventar — en esa misma ronda un «preferentemente» del material salió
 * convertido en obligatorio.
 *
 * Acá el trabajo se parte en dos mitades, y la división es el punto:
 *
 * 1. **Un modelo decide qué dato quedó viejo.** Es un juicio: «el teléfono de
 *    la mesa de ayuda pasó de 4400 a WhatsApp» no se deduce comparando cadenas.
 * 2. **El servidor barre dónde está ese dato.** Es cuenta: el modelo dice
 *    «4400», el servidor encuentra las seis apariciones, en qué lección y en
 *    qué bloque. Un valor que el modelo dice que está y no aparece en ninguna
 *    parte se descarta acá mismo, antes de llegar al plan.
 *
 * Lo que sale es una lista de ediciones puntuales con su dirección exacta. Eso
 * es lo que convierte «actualizá esto» en un plan de cambios que el docente
 * puede leer y aprobar — y en una orden de trabajo que el servidor puede
 * medir, porque sabe cuál es el valor que tiene que dejar de aparecer.
 */

/**
 * Un valor que hay que reemplazar, y por cuál.
 *
 * ── Por qué además de `old` hay una CLAVE ────────────────────────────────────
 *
 * `old` es la frase tal como el analista la vio en la lección: «Teléfono
 * interno 4400», «Primera respuesta: 2 horas». Buscar eso encuentra la lección
 * y nada más. Medido el 2026-09-22: las cuatro preguntas del ejercicio que
 * tenían el dato viejo quedaron sin tocar, porque las preguntas lo dicen con
 * otras palabras —«al interno 4400», «plazo de primera respuesta de 2 horas»,
 * «8:00 hs»— y ninguna contiene la frase de la lección. El plan no las incluyó
 * porque el barrido no las listó, así que el curso quedó enseñando el dato
 * nuevo y evaluando el viejo.
 *
 * La clave es la forma MÁS CORTA y distintiva del mismo dato: «4400», «2
 * horas», «8 a 18». Eso sí viaja igual entre una lección y una pregunta.
 *
 * ── Y por qué la clave necesita contexto ─────────────────────────────────────
 *
 * Porque una clave corta es ambigua justo donde importa. «2 horas» es el plazo
 * de un incidente P2 y también aparece en la regla del P1; cambiar las dos
 * rompería la que estaba bien. `context` son las palabras que tienen que estar
 * cerca para que la coincidencia cuente: `["P2", "Alta"]`. Vacío cuando la
 * clave ya es única, que es el caso de un teléfono.
 */
export interface ValorACambiar {
  old: string;
  new: string;
  /** La forma más corta y distintiva del valor viejo: la que viaja entre una lección y una pregunta. */
  key?: string;
  /** Palabras que tienen que aparecer cerca para que una coincidencia por clave cuente. */
  context?: readonly string[];
}

/** Lo mínimo de una lección para barrerla. */
export interface LeccionParaBarrer {
  id: string;
  title: string;
  /** El HTML guardado: de ahí salen los `data-block-id` de cada aparición. */
  content: string;
}

/** Lo mínimo de una pregunta para barrerla: su enunciado y las etiquetas de sus opciones. */
export interface PreguntaParaBarrer {
  id: number;
  exerciseId: string;
  title: string;
  options: ReadonlyArray<{ id: number; label: string }>;
}

/** Dónde apareció un valor viejo. */
export interface OcurrenciaDeValor {
  valorViejo: string;
  lessonId?: string;
  /** El bloque de la lección que lo contiene, cuando lo tiene: es lo que `replace_lesson_block` pide. */
  blockId?: string;
  exerciseId?: string;
  questionId?: number;
  /** El texto alrededor, para que el docente y el modelo entiendan de qué aparición se habla. */
  texto: string;
}

/**
 * Tope de apariciones por lección.
 *
 * Bastante más alto que el de `search_lessons` (3) porque acá no se está
 * buscando «dónde dice esto» para leerlo: se está armando la orden de trabajo, y
 * una aparición que no entra en la lista es una que nadie va a cambiar y que el
 * ancla va a seguir reclamando para siempre.
 */
const MAX_POR_LECCION = 20;

/** Tope total por valor, por si un valor es una palabra común que aparece en todo el curso. */
const MAX_POR_VALOR = 60;

/**
 * Hasta dónde se mira alrededor de una clave para decidir si el contexto está
 * «cerca».
 *
 * Una oración larga en español anda por los cien caracteres, así que a ciento
 * sesenta de cada lado entra la frase entera y su vecina, y no entra el párrafo
 * siguiente — que es donde puede estar la OTRA regla, la que no hay que tocar.
 */
export const DISTANCIA_CONTEXTO = 160;

/** El enunciado, recortado, para nombrar una pregunta sin volcarla entera. */
function recorte(texto: string, largo = 120): string {
  const limpio = texto.replace(/\s+/g, ' ').trim();

  return limpio.length > largo ? `${limpio.slice(0, largo)}…` : limpio;
}

/**
 * ¿Está la aguja en el texto normalizado, como palabra entera?
 *
 * Como palabra y no como subcadena, que es la diferencia entre encontrar «2
 * horas» y encontrarlo adentro de «12 horas». El texto ya viene plegado por
 * `normalizarParaComparar`, así que lo único que puede haber alrededor de una
 * palabra es un espacio o el borde.
 */
function incluyeComoPalabra(plano: string, aguja: string): boolean {
  return posicionComoPalabra(plano, aguja, 0) !== -1;
}

/** La primera posición de `aguja` en `plano` a partir de `desde`, como palabra entera. */
function posicionComoPalabra(plano: string, aguja: string, desde: number): number {
  if (!aguja) return -1;

  for (let pos = plano.indexOf(aguja, desde); pos !== -1; pos = plano.indexOf(aguja, pos + 1)) {
    const antes = pos === 0 || plano[pos - 1] === ' ';
    const fin = pos + aguja.length;
    const despues = fin === plano.length || plano[fin] === ' ';

    if (antes && despues) return pos;
  }

  return -1;
}

/**
 * ¿Este texto todavía trae el valor viejo?
 *
 * El ÚNICO matcher del archivo, y lo usan las dos puntas: el barrido, para
 * decir dónde está el dato, y la medición del ancla, para decir si la orden ya
 * se cumplió. Tienen que ser el mismo: con dos, un ítem podía quedar reclamado
 * por uno y dado por hecho por el otro, y el docente vería un ✅ sobre un dato
 * que sigue ahí.
 *
 * La regla, en orden: la frase larga vale siempre; la clave vale si el contexto
 * está vacío o si alguna de sus palabras aparece cerca de ESA aparición —no en
 * cualquier lugar del texto—, porque de eso depende no pisar la regla vecina.
 */
export function apareceValor(texto: string, valor: ValorACambiar): boolean {
  const plano = normalizarParaComparar(texto);

  if (!plano) return false;

  const viejo = normalizarParaComparar(valor.old ?? '');

  if (viejo && plano.includes(viejo)) return true;

  const clave = normalizarParaComparar(valor.key ?? '');

  if (!clave) return false;

  const contexto = (valor.context ?? []).map((palabra) => normalizarParaComparar(palabra)).filter(Boolean);

  if (contexto.length === 0) return incluyeComoPalabra(plano, clave);

  for (let pos = posicionComoPalabra(plano, clave, 0); pos !== -1; pos = posicionComoPalabra(plano, clave, pos + 1)) {
    const ventana = plano.slice(
      Math.max(0, pos - DISTANCIA_CONTEXTO),
      pos + clave.length + DISTANCIA_CONTEXTO
    );

    if (contexto.some((palabra) => ventana.includes(palabra))) return true;
  }

  return false;
}

/** ¿Este tramo suelto —un enunciado, la etiqueta de una opción— nombra el valor viejo? */
function nombraElValor(texto: string, valor: ValorACambiar): boolean {
  const plano = normalizarParaComparar(texto);
  const viejo = normalizarParaComparar(valor.old ?? '');
  const clave = normalizarParaComparar(valor.key ?? '');

  if (!plano) return false;
  if (viejo && plano.includes(viejo)) return true;

  return !!clave && incluyeComoPalabra(plano, clave);
}

/**
 * Dónde está cada valor viejo, en las lecciones y en las preguntas.
 *
 * Determinista y sin base ni modelo: es lo que hace que «todavía está» sea una
 * afirmación verificable y no una opinión. El ancla lo vuelve a correr en cada
 * ronda contra el contenido de ese momento, así que los `blockId` que muestra
 * son siempre los de ahora y no los de cuando se aprobó el plan.
 */
export function barrerValores(params: {
  valores: readonly ValorACambiar[];
  lecciones?: readonly LeccionParaBarrer[];
  preguntas?: readonly PreguntaParaBarrer[];
}): OcurrenciaDeValor[] {
  const ocurrencias: OcurrenciaDeValor[] = [];
  const lecciones = params.lecciones ?? [];
  const preguntas = params.preguntas ?? [];

  for (const valor of params.valores) {
    const viejo = valor.old.trim();
    const clave = valor.key?.trim() ?? '';

    if (!viejo && !clave) continue;

    let contadas = 0;
    /**
     * Lo ya anotado para este valor: una aparición por bloque y una por
     * pregunta.
     *
     * Hace falta desde que se busca dos veces —por la frase larga y por la
     * clave—: el mismo párrafo contiene las dos, así que sin esto la orden de
     * trabajo diría «todavía está en el bloque b7» dos veces y el modelo
     * editaría b7, volvería a leer lo mismo y editaría b7 otra vez.
     */
    const vistas = new Set<string>();

    // Por la frase larga Y por la clave. El orden importa poco, pero la frase
    // va primera porque su coincidencia es la más específica y es la que queda
    // anotada cuando las dos caen en el mismo bloque.
    const agujas = [viejo, clave].filter((aguja, i, todas) => !!aguja && todas.indexOf(aguja) === i);

    for (const aguja of agujas) {
      if (contadas >= MAX_POR_VALOR) break;

      const esLaClave = aguja !== viejo;

      if (lecciones.length > 0) {
        const coincidencias = buscarEnLecciones({
          lecciones: lecciones.map((leccion) => ({
            id: leccion.id,
            title: leccion.title,
            content: leccion.content
          })),
          texto: aguja,
          maxPorLeccion: MAX_POR_LECCION,
          maxTotal: MAX_POR_VALOR
        });

        for (const coincidencia of coincidencias) {
          if (contadas >= MAX_POR_VALOR) break;

          // Una coincidencia por clave se vuelve a pasar por el matcher, con el
          // fragmento que la rodea como vecindario: ahí se aplica el contexto
          // («2 horas» sí, pero la del P2) y se cae la que era pedazo de otra
          // palabra («2 horas» adentro de «12 horas»).
          if (esLaClave && !apareceValor(coincidencia.fragmento, valor)) continue;

          const marca = `L:${coincidencia.lessonId}:${coincidencia.blockId ?? ''}`;

          if (vistas.has(marca)) continue;

          vistas.add(marca);
          ocurrencias.push({
            valorViejo: viejo || clave,
            lessonId: coincidencia.lessonId,
            ...(coincidencia.blockId ? { blockId: coincidencia.blockId } : {}),
            texto: coincidencia.fragmento
          });
          contadas += 1;
        }
      }
    }

    // Las preguntas no son HTML y no tienen bloques: se comparan normalizadas,
    // con el mismo plegado que usa la evidencia de una pregunta, para que un
    // guion o una tilde de más no escondan una aparición real. Y el vecindario
    // del contexto es la pregunta ENTERA —enunciado más opciones—, porque una
    // pregunta es corta y su tema está repartido entre las dos partes: el «P2»
    // suele estar en el enunciado y el «2 horas» en una opción.
    for (const pregunta of preguntas) {
      if (contadas >= MAX_POR_VALOR) break;

      const completa = [pregunta.title, ...pregunta.options.map((o) => o.label)].filter(Boolean).join(' · ');

      if (!apareceValor(completa, valor)) continue;

      const marca = `Q:${pregunta.id}`;

      if (vistas.has(marca)) continue;

      const enElEnunciado = nombraElValor(pregunta.title, valor);
      const opcion = pregunta.options.find((o) => nombraElValor(o.label, valor));

      vistas.add(marca);
      ocurrencias.push({
        valorViejo: viejo || clave,
        exerciseId: pregunta.exerciseId,
        questionId: pregunta.id,
        texto:
          enElEnunciado || !opcion
            ? recorte(pregunta.title)
            : `${recorte(pregunta.title, 80)} → "${recorte(opcion.label, 60)}"`
      });
      contadas += 1;
    }
  }

  return ocurrencias;
}

/** Un dato del curso que el documento nuevo deja viejo, tal como lo devuelve el analista. */
export interface CambioDetectado {
  valorViejo: string;
  valorNuevo: string;
  motivo: string;
  /** La forma corta del valor viejo, la que también aparece en las preguntas. Ver `ValorACambiar`. */
  clave?: string;
  /** Lo que tiene que estar cerca para que la clave cuente. Ver `ValorACambiar`. */
  contexto?: string[];
  /** La lección donde el analista cree que está. Orientativa: la ubicación la fija el barrido. */
  leccion?: string;
}

/** El cambio detectado, como lo busca el barrido. Un solo lugar donde se arma. */
export function valorDelCambio(cambio: CambioDetectado): ValorACambiar {
  return {
    old: cambio.valorViejo,
    new: cambio.valorNuevo,
    ...(cambio.clave ? { key: cambio.clave } : {}),
    ...(cambio.contexto && cambio.contexto.length > 0 ? { context: cambio.contexto } : {})
  };
}

export interface LeccionParaAnalizar {
  handle: string;
  title: string;
  text: string;
}

export type AnalistaDeCambios = (params: {
  fuenteNueva: { fileName: string; text: string };
  lecciones: LeccionParaAnalizar[];
}) => Promise<{ cambios: CambioDetectado[] }>;

/**
 * Tope de texto de lecciones que se le muestra al analista.
 *
 * 150.000 caracteres son unas 37.000 fichas. Entra un curso normal entero, que
 * es lo que hace falta: la pregunta es «qué del CURSO cambia», y una lección que
 * no se le mostró es una lección donde el dato viejo se queda. Lo que no entra
 * se corta con una marca que se la dice, para que no afirme sobre lo que no vio.
 */
export const PRESUPUESTO_LECCIONES_CHARS = 150_000;

export function armarLecciones(
  lecciones: readonly LeccionParaAnalizar[],
  presupuesto = PRESUPUESTO_LECCIONES_CHARS
): { texto: string; recortadas: string[] } {
  if (lecciones.length === 0) return { texto: '', recortadas: [] };

  // Reparto por nivelación, igual que en `lesson-writer.ts`: repartir en partes
  // iguales por orden de llegada deja a la lección corta con un cupo que no usa
  // y recorta a la larga sin necesidad.
  const cupos = new Array<number>(lecciones.length);
  let restante = presupuesto;

  lecciones
    .map((l, i) => ({ largo: l.text.length, i }))
    .sort((a, b) => a.largo - b.largo)
    .forEach(({ largo, i }, k, orden) => {
      const parte = Math.floor(restante / (orden.length - k));
      cupos[i] = Math.min(largo, parte);
      restante -= cupos[i];
    });

  const recortadas: string[] = [];

  const bloques = lecciones.map((l, i) => {
    if (cupos[i] >= l.text.length) return `--- ${l.handle} "${l.title}" ---\n${l.text}`;

    recortadas.push(l.title);

    return (
      `--- ${l.handle} "${l.title}" (only the first part — it did not fit) ---\n${l.text.slice(0, cupos[i])}\n` +
      `[… the rest of "${l.title}" was not shown to you. Do not claim anything about what you have not read.]`
    );
  });

  return { texto: bloques.join('\n\n'), recortadas };
}

const Resultado = z.object({
  changes: z
    .array(
      z.object({
        old: z
          .string()
          .min(1)
          .describe(
            'The OLD value exactly as it appears in the lesson — verbatim, at most 6 words. A number, a phone, a time range, a name, a code. Not a sentence, not a paraphrase: the server searches the course for this string.'
          ),
        key: z
          .string()
          .min(1)
          .describe(
            'The SHORTEST distinctive form of that old value — 1 to 3 words. Almost always the number, the phone, the time range or the name itself: "4400", "2 horas", "8 a 18". The server searches the questions with THIS, because a question says the same fact in different words.'
          ),
        context: z
          .array(z.string())
          .max(3)
          .optional()
          .describe(
            'Up to 3 words that must appear NEAR the key for a match to count — only when the key alone is ambiguous. For the "2 horas" of a P2 incident: ["P2", "Alta"]. For "4400": leave it out.'
          ),
        new: z.string().min(1).describe('The value the new document gives instead.'),
        why: z.string().min(1).describe('One sentence: where in the new document this is stated and what it supersedes.'),
        lesson: z.string().optional().describe('The handle of the lesson you saw it in, if you can tell (e.g. S2.L3).')
      })
    )
    .describe('Every fact of the course the new document changes. Empty when it changes nothing.')
});

const SISTEMA = `You compare a NEW document against the lessons of a course that is already written, and list every fact in the lessons that the document changes or supersedes.

For each one give: the OLD value as it appears in the lesson (verbatim, at most 6 words — a number, a phone, a time range, a name, a code), its KEY, the NEW value from the document, and why.

## The key, and why it is not the same as the old value

\`old\` is the phrase as the LESSON writes it. \`key\` is the shortest distinctive form of the same fact, 1 to 3 words — normally the bare number, phone, time range or name.

- old: "Teléfono interno 4400" → key: "4400"
- old: "Primera respuesta: 2 horas" → key: "2 horas", context: ["P2", "Alta"]
- old: "de 8 a 18 horas" → key: "8 a 18"

The key exists because the same fact is also in the course's QUESTIONS, written with other words: "llamar al interno 4400", "el plazo de primera respuesta es de 2 horas". The lesson's phrase finds none of them; the key finds all of them. Measured: a course was left teaching the new value and testing the old one in four questions, because only the long phrase was searched.

\`context\` is the guard rail for a key that is short enough to be ambiguous: the words that must appear near it for a match to count, so a "2 horas" that belongs to a different rule is not changed by mistake. Leave it out when the key is already unique, like a phone number.

Rules:
- Only facts the document actually CONTRADICTS or REPLACES. A fact the document merely repeats, confirms or mentions is NOT a change.
- The old value must be a short literal string that is really in the lesson text you were shown. The server searches the course for it: a paraphrase finds nothing and the change is dropped.
- Do not invent a change to seem useful. An empty list is the correct answer when the document changes nothing, and it is a useful answer.
- Do not propose editorial improvements, reorganisations or additions. This is only about facts that are now wrong.`;

/**
 * El analista: un sub-agente que mira UN documento nuevo contra las lecciones y
 * nada más.
 *
 * Contexto limpio a propósito, igual que el escritor de lecciones: el agente que
 * conversa con el docente arrastra el hilo entero, y acá lo único que importa es
 * el texto del documento y el texto del curso.
 */
export function crearAnalistaDeCambios(params: {
  orgId: string;
  userId: string;
  courseId: string;
  providerConfig: AIProviderConfig;
}): AnalistaDeCambios {
  const modelName =
    process.env.AGENT_ANALYSIS_MODEL?.trim() ||
    params.providerConfig.model ||
    resolveModelName(params.providerConfig.provider);
  const model = createModel({ ...params.providerConfig, model: modelName });

  return async ({ fuenteNueva, lecciones }) => {
    const armado = armarLecciones(lecciones);
    const inicio = Date.now();

    const { object, usage } = await generateObject({
      model,
      schema: Resultado,
      system: SISTEMA,
      prompt: [
        `## The NEW document: ${fuenteNueva.fileName}\n\n${fuenteNueva.text}`,
        `## The course's lessons as they are written today\n\n${armado.texto || '(no lesson text)'}`
      ].join('\n\n'),
      maxRetries: 1
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
    ).catch((error) => console.error('[analista-de-cambios] no se pudo registrar el consumo:', error));

    const cambios = (object.changes ?? []).map((cambio) => {
      const clave = cambio.key?.trim() ?? '';
      const contexto = (cambio.context ?? []).map((palabra) => palabra.trim()).filter(Boolean);

      return {
        valorViejo: cambio.old.trim(),
        valorNuevo: cambio.new.trim(),
        motivo: cambio.why.trim(),
        // La clave sólo se guarda si es de verdad más corta: una igual a la
        // frase larga no agrega nada y duplicaría cada búsqueda del barrido.
        ...(clave && clave !== cambio.old.trim() ? { clave } : {}),
        ...(contexto.length > 0 ? { contexto } : {}),
        ...(cambio.lesson?.trim() ? { leccion: cambio.lesson.trim() } : {})
      };
    });

    console.info(
      `[analista-de-cambios] "${fuenteNueva.fileName}": ${lecciones.length} lección(es), ` +
        `${armado.texto.length} caracteres, ${cambios.length} cambio(s), ` +
        `${((Date.now() - inicio) / 1000).toFixed(1)} s` +
        (armado.recortadas.length ? `, recortadas: ${armado.recortadas.join(', ')}` : '')
    );

    return { cambios };
  };
}
