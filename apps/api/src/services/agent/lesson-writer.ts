import { generateText } from 'ai';
import { buildLessonWriterPrompt, createModel, resolveModelName, type AIProviderConfig } from '@cio/ai-assistant';
import { listCourseSources } from '@cio/db/queries/agent/chat-document';
import { getCourseSourceText } from '@api/services/agent/document';
import { esCortePorTiempo, type FuenteVista } from '@api/services/agent/grounding';
import { crearMarcadorDeTokens, type MarcadorDeTokens } from '@api/services/agent/marcas-del-rebote';
import { buscarFuente } from '@api/services/agent/plan-coverage';
import { RECORDATORIO_DE_LA_DOCENTE } from '@api/services/agent/respuestas-del-formulario';
import { buscarEnFuentes, type FuenteParaBuscar } from '@api/services/agent/source-search';
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

/**
 * Cuánto se espera al escritor antes de cortarlo.
 *
 * Una lección medida tarda entre 11 y 30 s. Sin tope, una llamada colgada del
 * proveedor dejaba la herramienta esperando sin límite mientras el navegador
 * ya había soltado la ronda. Pasado esto se corta y la herramienta dice que no
 * se pudo escribir, con la lección como estaba.
 */
export const TIEMPO_MAXIMO_ESCRITOR_MS = 90_000;

/**
 * Lo que lee el escritor cuando la lección no tiene material asignado.
 *
 * Decía «The teacher agreed this lesson is written from general professional
 * knowledge», y eso no siempre era cierto: medido el 2026-09-29, el aviso de
 * cobertura le preguntó a la docente qué hacer con dos lecciones sin material,
 * ella aprobó el plan sin contestar, y el escritor iba a recibir un acuerdo
 * que nadie dio. Qué hacer con esas lecciones se le pregunta a la docente al
 * aprobar el plan, en el panel; acá sólo se describe la situación y cómo
 * escribir en ella.
 */
export const SIN_MATERIAL_ASIGNADO =
  'None. No source material is assigned to this lesson: write it from general professional knowledge, keep it generic, and mark with data-sin-fuente anything specific to one organisation (its own policy, structure, product, figures or procedure).';

/**
 * Lo que lee el escritor cuando la lección no tiene material asignado PERO el
 * curso tiene fuentes: los documentos de la empresa, como marco.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * Producción, 2026-11-11. El plan marcó dos lecciones como «la fuente apenas
 * las toca» y la docente pidió desarrollarlas desde buenas prácticas. El
 * escritor recibió `SIN_MATERIAL_ASIGNADO` y NADA del documento, y escribió
 * contra él sin saberlo:
 *
 *   - puso entre los productos críticos una categoría que la tabla de
 *     prioridades del documento deja última;
 *   - enseñó que reportar por un canal privado es un error, cuando el documento
 *     lo permite con todas las letras;
 *   - inventó dos cargos donde el documento nombra otro.
 *
 * Que una fuente no alcance para ENSEÑAR un tema no la vuelve irrelevante: sigue
 * diciendo cómo trabaja esa empresa. Sin verla, «práctica general» y «lo
 * contrario de lo que hacen acá» son indistinguibles para quien escribe.
 */
export const SIN_MATERIAL_CON_MARCO =
  'None assigned: this lesson is written from general professional practice — for THIS organisation, whose own documents follow. Read them before you write.';

export const REGLAS_DEL_MARCO = `## What this organisation's own documents say

None of this was assigned as this lesson's material, because it does not cover the topic in depth. It is still how this organisation works, and the people taking the course work there:

1. Where these documents say something about this lesson's topic — a priority, a role, a channel, a deadline, who must be told what — the lesson says the SAME and starts from it. General practice goes around what they say, never instead of it.
2. Never contradict them. Where general practice and these documents disagree, the documents win and that piece of general practice is left out.
3. General practice stays general. Do not present it as this organisation's rule, role, tool or procedure ("the official channel is…", "the shift supervisor authorises…"): word it as common practice, and mark with data-sin-fuente anything specific to this organisation that the documents do not state.`;

/** Hasta dónde el marco va entero. Pasado esto, sólo los pasajes que tocan el tema. */
export const MARCO_MAXIMO_CHARS = 60_000;

/** Cuántos pasajes del tema se muestran cuando las fuentes no entran enteras. */
const PASAJES_DEL_MARCO = 12;

/**
 * El marco de una lección sin material: qué dicen las fuentes del curso.
 *
 * Enteras si son cortas —es el caso que se midió: un informe de unas pocas
 * páginas—; si no, los pasajes que nombran el tema de la lección, buscados
 * con la misma búsqueda que usa el agente (`buscarEnFuentes`). Devuelve
 * `undefined` cuando no hay nada que mostrar: el escritor queda como antes.
 */
export function armarMarcoDeLaOrganizacion(fuentes: FuenteParaBuscar[], tema: string): string | undefined {
  const conTexto = fuentes.filter((fuente) => fuente.text.trim().length > 0);

  if (conTexto.length === 0) return undefined;

  if (conTexto.reduce((suma, fuente) => suma + fuente.text.length, 0) <= MARCO_MAXIMO_CHARS) {
    return conTexto.map((fuente) => `--- ${fuente.fileName} (complete) ---\n${fuente.text}`).join('\n\n');
  }

  const { passages } = buscarEnFuentes({ fuentes: conTexto, consulta: tema, maxPasajes: PASAJES_DEL_MARCO });

  if (passages.length === 0) return undefined;

  return passages
    .map((pasaje) => {
      const lugar = pasaje.locations[0];

      return `--- ${lugar.fileName}, lines ${lugar.fromLine}–${lugar.toLine} (an excerpt: the rest of the document was not shown to you) ---\n${pasaje.passage}`;
    })
    .join('\n\n');
}

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

export type EscritorDeLecciones = ((params: {
  lessonTitle: string;
  brief: string;
  locale: string;
  sources: string[];
  contenidoActual?: string;
}) => Promise<ResultadoEscritor>) & {
  /**
   * El rebote por parche: el mismo escritor decide qué es cada dato que el
   * chequeo no encontró, y el servidor sólo pone la marca. Ver
   * `marcas-del-rebote.ts`.
   *
   * Va colgado del escritor y no como otra opción de la ronda porque es el
   * mismo sub-agente, con el mismo modelo: así, donde se arma un escritor, el
   * parche viene con él. Ausente (un escritor armado a mano), los datos van al
   * informe sin marcar.
   */
  marcarTokens?: MarcadorDeTokens;
};

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
  /**
   * Lo que la docente eligió en el formulario de preguntas (ver
   * `respuestas-del-formulario.ts`). La consigna de cada lección no lo trae, y
   * sin esto una fuente que nombra personas salía con los nombres aunque ella
   * hubiera pedido roles.
   */
  indicaciones?: string;
}): EscritorDeLecciones {
  const modelName =
    process.env.AGENT_WRITER_MODEL?.trim() ||
    params.providerConfig.model ||
    resolveModelName(params.providerConfig.provider);
  const model = createModel({ ...params.providerConfig, model: modelName });
  // Las elecciones de la docente van en las instrucciones y no en el pedido: en
  // el pedido competían con la consigna, que va al final y ganaba.
  const system = params.indicaciones ? `${buildLessonWriterPrompt()}\n\n${params.indicaciones}` : buildLessonWriterPrompt();

  const escribir = async ({
    lessonTitle,
    brief,
    locale,
    sources,
    contenidoActual
  }: Parameters<EscritorDeLecciones>[0]): Promise<ResultadoEscritor> => {
    // Siempre, también sin fuentes asignadas: una lección «desde buenas
    // prácticas» necesita saber qué dice la empresa. Ver `REGLAS_DEL_MARCO`.
    const documentos = await listCourseSources(params.courseId);

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
    // lección sin material, desde el conocimiento general — o sea, convertir en
    // silencio una lección que debía estar fundada en una que no lo está. Es
    // exactamente el fallo que todo esto vino a cerrar.
    if (sources.length > 0 && material.length === 0) {
      const reales = documentos.map((d) => `"${d.fileName}"`).join(', ') || '(none)';
      throw new Error(
        `none of the sources you listed (${sources.map((s) => `"${s}"`).join(', ')}) exist in this course. Its sources are: ${reales}. Copy the names from there.`
      );
    }

    const armado = armarMaterial(material);

    // Sin material asignado, las fuentes del curso van como MARCO: no para
    // enseñar desde ellas, sino para no escribir contra ellas. No entran en
    // `material` —que es contra lo que el juez mide «salió de acá»—: esta
    // lección no salió de ahí, y decir que sí sería el sello falso de antes.
    let marco: string | undefined;

    if (sources.length === 0 && documentos.length > 0) {
      const conTexto = await Promise.all(
        documentos.map(async (doc) => ({
          id: doc.id,
          fileName: doc.fileName,
          text: (await getCourseSourceText(doc.id, params.courseId, params.redis)) ?? doc.text ?? ''
        }))
      );

      marco = armarMarcoDeLaOrganizacion(conTexto, `${lessonTitle} ${brief}`);
    }

    // Lo que es igual para todas las lecciones va primero y lo propio de cada una
    // al final: la caché del proveedor es por prefijo, así que el temario se
    // reutiliza en todas y el material en las que comparten fuente.
    const partes = [
      `## Course\n\n${params.courseTitle}` +
        (params.temario ? `\n\nOutline — the whole course, so you know what the other lessons cover:\n${params.temario}` : ''),
      armado.texto
        ? `## Source material for this lesson\n\n${armado.texto}`
        : marco
          ? `## Source material for this lesson\n\n${SIN_MATERIAL_CON_MARCO}\n\n${REGLAS_DEL_MARCO}\n\n${marco}`
          : `## Source material for this lesson\n\n${SIN_MATERIAL_ASIGNADO}`,
      `## This lesson\n\nTitle: ${lessonTitle}\nWrite it in this language: ${locale}\n\nBrief:\n${brief}` +
        (params.indicaciones ? `\n\n${RECORDATORIO_DE_LA_DOCENTE}` : ''),
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
      maxRetries: 1,
      // Con tope, el reintento incluido: ver `TIEMPO_MAXIMO_ESCRITOR_MS`.
      abortSignal: AbortSignal.timeout(TIEMPO_MAXIMO_ESCRITOR_MS)
    }).catch((error: unknown) => {
      if (esCortePorTiempo(error)) {
        throw new Error(
          `it took longer than ${Math.round(TIEMPO_MAXIMO_ESCRITOR_MS / 1000)} s and was stopped, so nothing was saved.`
        );
      }

      throw error;
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

  // El parche viaja con el escritor: mismo modelo, misma cuenta de consumo.
  // Ver `EscritorDeLecciones.marcarTokens`.
  return Object.assign(escribir, {
    marcarTokens: crearMarcadorDeTokens({
      orgId: params.orgId,
      userId: params.userId,
      courseId: params.courseId,
      providerConfig: params.providerConfig,
      model,
      modelName
    })
  });
}
