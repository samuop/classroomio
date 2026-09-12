import { generateText } from 'ai';
import { buildLessonWriterPrompt, createModel, resolveModelName, type AIProviderConfig } from '@cio/ai-assistant';
import { listCourseSources } from '@cio/db/queries/agent/chat-document';
import { getCourseSourceText } from '@api/services/agent/document';
import type { FuenteVista } from '@api/services/agent/grounding';
import { buscarFuente } from '@api/services/agent/plan-coverage';
import { recordTokenUsage } from '@api/services/agent/usage';
import type { RedisClient } from '@api/utils/redis/redis';

/**
 * El escritor de lecciones: un sub-agente que escribe UNA lección con contexto
 * limpio.
 *
 * ── Qué arregla ──────────────────────────────────────────────────────────────
 *
 * Construyendo un curso, un solo modelo planificaba, creaba secciones, escribía
 * dieciséis lecciones y armaba los exámenes en la misma conversación. Cada
 * lección quedaba adentro como entrada de `create_lesson` y la ronda la volvía a
 * mandar en cada paso siguiente: a la lección doce se arrastraban once lecciones
 * enteras, y cuando el historial se recortaba el modelo perdía de vista lo que
 * había escrito.
 *
 * Con esto, el constructor manda una consigna corta y una lista de fuentes. El
 * escritor recibe esa consigna, el temario del curso (para no repetir) y SÓLO el
 * material que el plan le asignó a esa lección. Devuelve HTML, que se guarda por
 * el mismo camino que cualquier lección — misma normalización, mismos chequeos.
 *
 * ── Por qué sólo las fuentes asignadas ───────────────────────────────────────
 *
 * Es lo que convierte la declaración de fuentes del plan en algo que decide. Y
 * hace el fundamento auditable por lección: como se sabe exactamente qué tenía
 * delante el escritor, el verificador contrasta contra eso y no contra todo el
 * curso. Una afirmación que no está en su material no pudo salir de ahí.
 */

/**
 * Tope de material por lección.
 *
 * 160.000 caracteres son unas 40.000 fichas: holgado para el caso normal (una o
 * dos fuentes por lección) y bastante menos que el paquete entero que el
 * constructor carga en cada paso. Si una lección necesita más, el texto se corta
 * con una marca que se lo dice al escritor, y el resultado se lo dice al
 * constructor.
 */
export const PRESUPUESTO_MATERIAL_CHARS = 160_000;

/** Largo máximo de la descripción de cada ítem en el temario. */
const MAX_DESCRIPCION_TEMARIO = 300;

export interface MaterialDeLeccion {
  texto: string;
  /** Fuentes que no entraron enteras. */
  recortadas: string[];
}

/**
 * Arma el material del escritor dentro del presupuesto.
 *
 * El reparto es por nivelación: primero se le da lo suyo a la fuente más chica,
 * y lo que sobra se reparte entre las que quedan. Repartir en partes iguales en
 * el orden en que llegan desperdicia presupuesto — una fuente enorme que llega
 * primera se come su mitad y deja a la chica con una mitad que no usa — y
 * recorta sin necesidad.
 *
 * El orden en que se MUESTRAN es el original: el que declaró el plan.
 */
export function armarMaterial(
  fuentes: Array<{ fileName: string; text: string }>,
  presupuesto = PRESUPUESTO_MATERIAL_CHARS
): MaterialDeLeccion {
  if (fuentes.length === 0) return { texto: '', recortadas: [] };

  const cupos = new Array<number>(fuentes.length);
  let restante = presupuesto;

  fuentes
    .map((f, i) => ({ largo: f.text.length, i }))
    .sort((a, b) => a.largo - b.largo)
    .forEach(({ largo, i }, k, orden) => {
      const parte = Math.floor(restante / (orden.length - k));
      cupos[i] = Math.min(largo, parte);
      restante -= cupos[i];
    });

  const recortadas: string[] = [];

  const bloques = fuentes.map((f, i) => {
    if (cupos[i] >= f.text.length) return `--- Source: ${f.fileName} ---\n${f.text}`;

    recortadas.push(f.fileName);
    const faltan = f.text.length - cupos[i];

    return (
      `--- Source: ${f.fileName} (only the first part — it did not fit) ---\n${f.text.slice(0, cupos[i])}\n` +
      `[… ${faltan} more characters of "${f.fileName}" were not shown to you. Do not write about what you have not read: say in <note> that this lesson covers only the first part of that source.]`
    );
  });

  return { texto: bloques.join('\n\n'), recortadas };
}

/**
 * Saca la lección del sobre que devuelve el escritor.
 *
 * Devuelve `null` en vez de adivinar. Un sobre sin cerrar es casi siempre una
 * respuesta cortada por el tope de salida, y guardar media lección —que se ve
 * completa en el editor y termina a mitad de una oración— es peor que avisar que
 * no se pudo.
 */
export function extraerLeccion(
  respuesta: string
): { html: string; nota?: string } | { faltaMaterial: string } | null {
  /**
   * El escritor puede NEGARSE, y esa negativa es un resultado, no un error.
   *
   * Hasta acá sólo podía escribir. Si el material mencionaba el tema de pasada
   * —o directamente no lo mencionaba— su única salida era escribir igual y
   * poner el hueco en una nota que se relataba en prosa y se iba hacia arriba
   * en el chat. O sea: el hueco quedaba tapado con algo verosímil, que es el
   * peor resultado de todos porque nadie puede ver qué parte es invento.
   *
   * Con esto puede devolver «para esta lección no hay material», y quien lo
   * llamó deja el ítem PENDIENTE en vez de rellenarlo. Un hueco declarado lo
   * llena el docente subiendo lo que falta; uno tapado no lo ve nadie.
   */
  const negativa = respuesta.match(/<sin-material>([\s\S]*?)<\/sin-material>/i)?.[1].trim();

  if (negativa) return { faltaMaterial: negativa };

  const leccion = respuesta.match(/<lesson>([\s\S]*?)<\/lesson>/i);

  if (!leccion) return null;

  // Hay modelos que, aun pidiéndoles HTML crudo, lo envuelven en un bloque de
  // código. Adentro de la lección eso se vería como texto literal.
  const html = leccion[1]
    .trim()
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  if (!html) return null;

  const nota = respuesta.match(/<note>([\s\S]*?)<\/note>/i)?.[1].trim();

  return nota ? { html, nota } : { html };
}

/**
 * El temario que ve el escritor: el curso entero, para que no repita.
 *
 * Con las descripciones del plan y no sólo los títulos: «Seguridad en depósito»
 * y «Manejo de sustancias» se pisan o no según lo que diga cada descripción, y
 * el escritor no tiene otra forma de saber qué le toca a la lección de al lado.
 */
export function temarioDelPlan(
  plan:
    | { sections: Array<{ title: string; items: Array<{ type: string; title: string; description?: string }> }> }
    | undefined
): string | undefined {
  if (!plan?.sections?.length) return undefined;

  return plan.sections
    .map((seccion, i) => {
      const items = seccion.items
        .map((item) => {
          const tipo = item.type === 'exercise' ? '[exercise] ' : '';
          const descripcion = item.description?.trim()
            ? ` — ${item.description.trim().slice(0, MAX_DESCRIPCION_TEMARIO)}`
            : '';

          return `  - ${tipo}${item.title}${descripcion}`;
        })
        .join('\n');

      return `${i + 1}. ${seccion.title}\n${items}`;
    })
    .join('\n');
}

export interface LeccionEscrita {
  html: string;
  nota?: string;
  /** Lo que el escritor tuvo delante, completo: contra esto se verifica. */
  material: FuenteVista[];
  fuentesUsadas: string[];
  fuentesNoEncontradas: string[];
  recortadas: string[];
}

/**
 * El escritor miro el material y dijo que no alcanza para esta leccion.
 *
 * Es un resultado valido, no una falla: quien llama deja el item pendiente y se
 * lo cuenta al docente. Por eso es un tipo aparte y no un `html` vacio — un
 * vacio se cuela por cualquier rama que no lo mire, una union obliga al
 * compilador a preguntar.
 */
export interface LeccionSinMaterial {
  faltaMaterial: string;
  fuentesUsadas: string[];
  fuentesNoEncontradas: string[];
}

export type ResultadoEscritor = LeccionEscrita | LeccionSinMaterial;

export type EscritorDeLecciones = (params: {
  lessonTitle: string;
  brief: string;
  locale: string;
  sources: string[];
  contenidoActual?: string;
}) => Promise<ResultadoEscritor>;

/**
 * Arma el escritor para una ronda del agente.
 *
 * Tira errores en vez de devolver vacío, a diferencia del verificador: si no se
 * pudo escribir, no hay nada que guardar, y quien llama tiene que saberlo para
 * reintentar o escribir la lección por su cuenta.
 */
export function crearEscritorDeLecciones(params: {
  orgId: string;
  userId: string;
  courseId: string;
  redis: RedisClient;
  providerConfig: AIProviderConfig;
  courseTitle: string;
  temario?: string;
}): EscritorDeLecciones {
  const modelName =
    process.env.AGENT_WRITER_MODEL?.trim() ||
    params.providerConfig.model ||
    resolveModelName(params.providerConfig.provider);
  const model = createModel({ ...params.providerConfig, model: modelName });
  const system = buildLessonWriterPrompt();

  return async ({ lessonTitle, brief, locale, sources, contenidoActual }) => {
    const documentos = sources.length > 0 ? await listCourseSources(params.courseId) : [];

    const material: FuenteVista[] = [];
    const fuentesUsadas: string[] = [];
    const fuentesNoEncontradas: string[] = [];
    const vistas = new Set<string>();

    for (const declarada of sources) {
      const doc = buscarFuente(declarada, documentos);

      if (!doc) {
        fuentesNoEncontradas.push(declarada);
        continue;
      }

      if (vistas.has(doc.id)) continue;
      vistas.add(doc.id);

      const text = (await getCourseSourceText(doc.id, params.courseId, params.redis)) ?? doc.text;
      material.push({ fileName: doc.fileName, text });
      fuentesUsadas.push(doc.fileName);
    }

    // Se declararon fuentes y no apareció NINGUNA. Seguir sería escribir la
    // lección sin material y decirle al escritor que el docente eligió
    // conocimiento general — o sea, convertir en silencio una lección que debía
    // estar fundada en una que no lo está. Es exactamente el fallo que todo esto
    // vino a cerrar.
    if (sources.length > 0 && material.length === 0) {
      const reales = documentos.map((d) => `"${d.fileName}"`).join(', ') || '(none)';
      throw new Error(
        `none of the sources you listed (${sources.map((s) => `"${s}"`).join(', ')}) exist in this course. Its sources are: ${reales}. Copy the names from there.`
      );
    }

    const armado = armarMaterial(material);

    // Lo que es igual para todas las lecciones va primero y lo propio de cada una
    // al final: la caché del proveedor es por prefijo, así que el temario se
    // reutiliza en todas y el material en las que comparten fuente.
    const partes = [
      `## Course\n\n${params.courseTitle}` +
        (params.temario ? `\n\nOutline — the whole course, so you know what the other lessons cover:\n${params.temario}` : ''),
      armado.texto
        ? `## Source material for this lesson\n\n${armado.texto}`
        : '## Source material for this lesson\n\nNone. The teacher agreed this lesson is written from general professional knowledge.',
      `## This lesson\n\nTitle: ${lessonTitle}\nWrite it in this language: ${locale}\n\nBrief:\n${brief}`,
      contenidoActual ? `## Current content of this lesson (you are rewriting it)\n\n${contenidoActual}` : ''
    ].filter(Boolean);

    const inicio = Date.now();

    const resultado = await generateText({
      model,
      system,
      prompt: partes.join('\n\n'),
      // Una lección con un par de diagramas pasa holgada las 8.000 fichas que
      // algunos proveedores dan por defecto, y en Gemini el razonamiento cuenta
      // contra el mismo tope. Cortarla a mitad es lo que `extraerLeccion` ataja,
      // pero mejor que no pase.
      maxOutputTokens: 32_768,
      maxRetries: 1
    });

    // Se cobra como cualquier llamada al proveedor: sin esto el consumo del mes
    // mentiría hacia abajo justo en la parte más cara de construir un curso.
    await recordTokenUsage(
      params.orgId,
      params.userId,
      params.courseId,
      {
        promptTokens: resultado.usage.inputTokens ?? 0,
        completionTokens: resultado.usage.outputTokens ?? 0,
        totalTokens: resultado.usage.totalTokens ?? 0,
        cacheReadTokens: resultado.usage.inputTokenDetails?.cacheReadTokens || undefined,
        cacheWriteTokens: resultado.usage.inputTokenDetails?.cacheWriteTokens || undefined
      },
      modelName,
      params.providerConfig.provider
    ).catch((error) => console.error('[lesson-writer] no se pudo registrar el consumo:', error));

    if (resultado.finishReason === 'length') {
      throw new Error('its answer was cut off by the output limit, so nothing was saved.');
    }

    const extraida = extraerLeccion(resultado.text ?? '');

    if (!extraida) {
      throw new Error('it did not return a lesson in the expected <lesson>…</lesson> envelope, so nothing was saved.');
    }

    // Se nego: el material no sostiene esta leccion. Vuelve como resultado —no
    // como error— para que quien llamo deje el item pendiente y se lo diga al
    // docente, en vez de reintentar hasta que salga algo.
    if ('faltaMaterial' in extraida) {
      console.info(
        `[lesson-writer] "${lessonTitle}": sin material suficiente — ${extraida.faltaMaterial.slice(0, 120)}`
      );

      return { faltaMaterial: extraida.faltaMaterial, fuentesUsadas, fuentesNoEncontradas };
    }

    console.info(
      `[lesson-writer] "${lessonTitle}": ${fuentesUsadas.length} fuente(s)` +
        (fuentesUsadas.length ? ` (${fuentesUsadas.join(', ')})` : ' — conocimiento general') +
        `, ${armado.texto.length} caracteres de material, ${extraida.html.length} de lección, ` +
        `${((Date.now() - inicio) / 1000).toFixed(1)} s` +
        (armado.recortadas.length ? `, recortadas: ${armado.recortadas.join(', ')}` : '')
    );

    return {
      html: extraida.html,
      ...(extraida.nota ? { nota: extraida.nota } : {}),
      material,
      fuentesUsadas,
      fuentesNoEncontradas,
      recortadas: armado.recortadas
    };
  };
}
