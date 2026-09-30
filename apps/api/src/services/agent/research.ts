import { MAX_DOCUMENT_TEXT_LENGTH } from '@cio/ai-assistant';
import {
  groundedSearch,
  mergeSearchResults,
  type GroundedSearchOutcome,
  type WebSearchResult
} from '@api/services/agent/web-search';
import { fetchDocumentationUrl } from '@api/services/agent/fetch-url';
import {
  errorDeTopeDeFuentes,
  esTopeDeFuentes,
  lugarParaFuentes,
  storeDraftDocument,
  storeUrlDocument,
  URL_SOURCE_MIME_TYPE,
  type ParsedDocument
} from '@api/services/agent/document';
import { diagnosticarFuente } from '@api/services/agent/pagina-sin-contenido';
import type { RedisClient } from '@api/utils/redis/redis';

// Vivían acá; ahora son del detector compartido. Se reexportan para no romper
// a quien los importaba de la investigación.
export { isUnreadablePage, readableProseLength } from '@api/services/agent/pagina-sin-contenido';

/**
 * Research depth, chosen by the teacher on the course wizard.
 *
 * Deliberately a small closed set rather than a number: every page is a few
 * seconds of waiting and a slice of the source-pack budget, so the cost has to be
 * legible at the moment of choosing. "How many web pages should I read" is not a
 * question a teacher should have to answer in integers.
 */
export const RESEARCH_DEPTHS = ['quick', 'normal', 'deep'] as const;
export type ResearchDepth = (typeof RESEARCH_DEPTHS)[number];

const PAGES_PER_DEPTH: Record<ResearchDepth, number> = {
  quick: 5,
  normal: 10,
  deep: 20
};

/**
 * The angles a run covers, one grounded search each.
 *
 * A single search does not make a course: "colorimetría de pinturas de paredes"
 * asked once returns paint-shop catalogues. Splitting the subject into the
 * theory, the practice and the standards is what separates a course built from
 * adverts from one built from material.
 *
 * They are angles rather than queries because the queries are Gemini's to write
 * now — each angle is one grounded call, and the searches it actually ran come
 * back in `webSearchQueries`. Several calls rather than one because grounding
 * cites what it needed for the answer it wrote: asking for four different
 * answers is what produces four different sets of pages, and a deep run needs
 * forty candidates to end up with twenty readable ones.
 */
const RESEARCH_ANGLES = [
  'the foundations: definitions, core concepts and the vocabulary of the subject',
  'the practice: applied, hands-on and how-to material a working professional would use',
  'the references: standards, norms, official documentation and reference tables',
  'the experience: worked examples, case studies, common mistakes and how to avoid them'
] as const;

const ANGLES_PER_DEPTH: Record<ResearchDepth, number> = {
  quick: 2,
  normal: 3,
  deep: 4
};

/**
 * How many pages we read at once.
 *
 * Measured: nine pages at a concurrency of 5 took 60.7s. The reader is slow per
 * page, so the only lever is width. Jina's paid tiers allow hundreds of requests
 * a minute; 8 is comfortable and still polite.
 */
const FETCH_CONCURRENCY = 8;

/**
 * Hard stop for the whole harvest, searching included.
 *
 * Whatever has been read by then is returned instead of the request dying on
 * the way back: eight pages in hand beat a timeout and nothing. Deep runs are
 * the case that hits this, which is why the depth control says "~20 pages"
 * rather than promising exactly twenty.
 *
 * Los límites de hoy, de afuera hacia adentro: Cloudflare corta a los 100 s si
 * no llegaron las cabeceras (acá no llegan hasta el final, así que ése es el
 * techo real), Nginx da 120 s al dashboard y 300 s a la API, y el navegador
 * espera lo que el panel le pida. Un comentario anterior decía que Nginx
 * cortaba a los 60 s; ya no es así, y el que mordía era el navegador, a los 30.
 *
 * It covers the WHOLE run, searching included, and that is what changed when
 * discovery moved to grounding: a grounded call is the model running several
 * searches and writing a survey, measured at 13-22 s. And it is a real ceiling
 * now: `readPages` returns when it runs out, without waiting for a read that is
 * still hanging (each read also has its own `PLAZO_DE_LECTURA_MS`).
 */
const RESEARCH_DEADLINE_MS = 48_000;

export interface ResearchSource {
  documentId: string;
  title: string;
  url: string;
  chars: number;
}

export interface ResearchOutcome {
  /** The searches Gemini ran, reported back so the teacher can see them. */
  queries: string[];
  sources: ResearchSource[];
  /** Pages that were found but could not be read. Reported, never fatal. */
  failedCount: number;
  /**
   * Páginas que esta profundidad iba a traer y quedaron afuera porque el curso
   * llegó a su tope de fuentes. Se guardan las que entran y se avisa cuántas
   * no: ninguna fuente se borra para hacerles lugar. 0 sin curso (el asistente
   * de creación investiga antes de que el curso exista).
   */
  leftOutByLimit: number;
}

/**
 * Who the course is for. Optional, because research from the Sources panel is a
 * targeted top-up on an existing course and carries no audience of its own.
 */
export interface ResearchBrief {
  audience?: string;
  level?: 'intro' | 'intermediate' | 'advanced';
}

const LEVEL_GUIDANCE: Record<NonNullable<ResearchBrief['level']>, string> = {
  intro: 'Prefer introductory explanations over specialist literature.',
  intermediate: 'Prefer working, applied material over both beginner overviews and research papers.',
  advanced: 'Prefer specialist, technical and normative sources over introductory overviews.'
};

/**
 * The brief the planner reads.
 *
 * It used to receive the topic and nothing else, which made two very different
 * courses produce identical research: colorimetry for paint-shop staff wants
 * colour charts and how to advise a customer, the same words for formulation
 * chemists want spectrophotometry and standards. The audience is not decoration
 * here — it is most of what decides whether a page is useful.
 */
export function buildBriefPrompt(topic: string, brief: ResearchBrief): string {
  const lines = [`Course brief: ${topic.slice(0, 900)}`];

  if (brief.audience?.trim()) {
    lines.push(`Learners: ${brief.audience.trim().slice(0, 300)}`);
  }

  if (brief.level) {
    lines.push(LEVEL_GUIDANCE[brief.level]);
  }

  return lines.join('\n');
}

/**
 * Searches one angle of the subject and returns the pages it cited.
 *
 * The instruction asks for a written survey, not a list of links, and that is
 * load-bearing: grounding only cites the pages it needed to write its answer, so
 * "cover each point from a different source" is what turns one call into a dozen
 * candidates instead of two. The answer itself is discarded — a course is built
 * from pages the teacher can open, not from a model's summary of them.
 *
 * The searches are written in the brief's language because Spanish material for
 * a Spanish course is the whole point, and an English-only search quietly changes
 * what the course can be built from.
 */
export async function searchAngle(
  topic: string,
  angle: string,
  brief: ResearchBrief,
  limit: number
): Promise<GroundedSearchOutcome> {
  return groundedSearch({
    instruction: [
      'You gather the reading list for a training course.',
      `Search the web and write a short factual survey of ${angle}.`,
      'Use a separate source for each point and cite every one of them — the citations are the',
      'output that matters, so breadth of sources beats depth on any single one.',
      'Search in the SAME LANGUAGE as the brief.',
      // Measured failure: for a colorimetry course the planner wrote
      // "aplicación práctica de colorimetría…", the search engine read
      // "aplicación" as "app", and three of ten pages were listicles of phone
      // apps for repainting a room. Naming the trap is cheaper than filtering
      // its results, which sit on perfectly ordinary domains.
      'Aim at teaching and reference material: explanations, guides, standards, tables.',
      'Avoid wording a shop or an app store would match — no "app", "aplicación", "mejores",',
      '"top 10", "comprar", "precio", "opiniones", "descargar".'
    ].join(' '),
    prompt: buildBriefPrompt(topic, brief),
    limit
  });
}

function toParsedDocument(page: { url: string; pageTitle: string; content: string }): ParsedDocument {
  const text = page.content.slice(0, MAX_DOCUMENT_TEXT_LENGTH);
  const hostname = (() => {
    try {
      return new URL(page.url).hostname;
    } catch {
      return page.url;
    }
  })();
  const title = page.pageTitle?.trim();
  // Same naming as storeUrlDocument, so a researched page and a page the teacher
  // pasted by hand are indistinguishable in the Sources panel — because they are.
  const fileName = title ? (title === hostname ? page.url : `${title} (${hostname})`) : page.url;

  return {
    text,
    fileName,
    mimeType: URL_SOURCE_MIME_TYPE,
    pageCount: null,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    textPreview: text.slice(0, 500),
    truncated: page.content.length > MAX_DOCUMENT_TEXT_LENGTH,
    // El asistente de creacion investiga ANTES de que el curso exista, asi que
    // estas paginas van a un borrador en Redis y recien se vuelven fuentes en
    // el primer turno de chat. Sin esto, la direccion moria en ese salto y la
    // fuente terminaba sin enlace, a diferencia de la misma pagina agregada con
    // el curso ya creado.
    sourceUrl: page.url
  };
}

/**
 * Reads pages with a fixed number of workers and one shared deadline.
 *
 * A worker pool rather than fixed batches because the reader's per-page time
 * varies wildly: in batches, one slow page holds up the other seven and the whole
 * run pays for the worst case in every round. Workers pull the next URL as soon
 * as they are free, so the slow page costs only itself.
 */
/**
 * Persists one page, as a course source when there is a course and as a draft
 * when there is not.
 *
 * The wizard researches before the course exists, so its pages can only be
 * drafts (Redis), promoted on the first chat turn like an uploaded PDF. But
 * research started from a course that already exists has somewhere to put them
 * NOW, and putting them anywhere else would mean the Sources tab stays empty
 * until the teacher happens to send a message — with the material silently
 * expiring an hour later if they do not.
 */
async function persistPage(
  page: { url: string; pageTitle: string; content: string },
  parsed: ParsedDocument,
  params: { orgId: string; courseId?: string; conversationId?: string; userId: string; redis: RedisClient }
): Promise<string> {
  if (params.courseId && params.conversationId) {
    const stored = await storeUrlDocument({
      url: page.url,
      pageTitle: page.pageTitle,
      markdown: page.content,
      orgId: params.orgId,
      userId: params.userId,
      courseId: params.courseId,
      conversationId: params.conversationId,
      redis: params.redis
    });

    return stored.documentId;
  }

  const { documentId } = await storeDraftDocument(parsed, params.userId, params.redis);

  return documentId;
}

async function readPages(
  results: WebSearchResult[],
  budget: number,
  deadline: number,
  params: { orgId: string; courseId?: string; conversationId?: string; userId: string; redis: RedisClient }
): Promise<{ sources: ResearchSource[]; failedCount: number; timedOut: boolean; sinLugar: number }> {
  const sources: ResearchSource[] = [];
  let failedCount = 0;
  let timedOut = false;
  let next = 0;
  let inFlight = 0;

  /**
   * Páginas leídas que no se guardaron porque el curso se llenó mientras
   * tanto (otra alta ganó el último lugar). Con la primera se deja de leer:
   * las que siguieran tampoco entrarían.
   */
  let sinLugar = 0;

  /**
   * Se levanta cuando vence el plazo y la respuesta ya se armó con lo que había.
   *
   * Una lectura que llega después no se guarda: la docente ya recibió la lista,
   * y una fuente que aparece sola en el panel —o un borrador que nadie va a
   * promover— es peor que una página menos.
   */
  let cerrado = false;

  async function worker() {
    for (;;) {
      if (cerrado || sinLugar > 0) return;

      if (Date.now() >= deadline) {
        timedOut = true;

        return;
      }

      // Claim a slot before reading, counting pages already being read.
      //
      // Without the in-flight term, workers keep pulling while the first results
      // are still being stored — a budget of 5 cost 9 reads, because nothing had
      // landed yet when the sixth was claimed. Spares are meant to replace
      // failures, not to be read speculatively; each one is a paid fetch and a
      // second or two of the deadline.
      if (sources.length + inFlight >= budget) {
        if (inFlight === 0) {
          return;
        }

        // Others are still reading: one of them may fail and free this slot.
        await new Promise((resolve) => setTimeout(resolve, 25));
        continue;
      }

      const index = next++;
      const result = results[index];

      if (!result) {
        return;
      }

      inFlight += 1;

      try {
        const page = await fetchDocumentationUrl({
          url: result.url,
          orgId: params.orgId,
          courseId: params.courseId,
          // A teacher asking for research is not the runaway-agent case the
          // per-conversation fetch limit guards against — same reasoning as the
          // Sources panel's own URL route.
          priorMessages: []
        });

        // El mismo criterio que la ruta de Fuentes: un muro de inicio de sesión,
        // un error del sitio o una página hecha sólo de enlaces no son material.
        const diagnostico = diagnosticarFuente(page.content);

        if (diagnostico) {
          throw new Error(`${diagnostico.code} at ${result.url}: ${diagnostico.motivo}`);
        }

        if (cerrado) return;

        const parsed = toParsedDocument(page);
        const documentId = await persistPage(page, parsed, params);

        sources.push({
          documentId,
          title: parsed.fileName,
          url: page.url,
          chars: parsed.text.length
        });
      } catch (error) {
        if (esTopeDeFuentes(error)) {
          sinLugar += 1;
          console.info(`[research] page left out: the course is at its source limit (${result.url})`);
        } else {
          failedCount += 1;
          console.info('[research] page skipped:', error instanceof Error ? error.message : error);
        }
      } finally {
        inFlight -= 1;
      }
    }
  }

  const workers = Math.max(1, Math.min(FETCH_CONCURRENCY, budget, results.length));

  // El plazo es un techo de verdad: al vencer se contesta con lo que haya, sin
  // esperar una lectura que siga colgada. Antes el tope sólo impedía EMPEZAR
  // lecturas, y una página lenta estiraba la investigación más allá de lo que el
  // navegador estaba dispuesto a esperar.
  let reloj: ReturnType<typeof setTimeout> | undefined;

  const vence = new Promise<'vencio'>((resolve) => {
    reloj = setTimeout(() => resolve('vencio'), Math.max(0, deadline - Date.now()));
  });

  const final = await Promise.race([
    Promise.all(Array.from({ length: workers }, worker)).then(() => 'terminaron' as const),
    vence
  ]);

  clearTimeout(reloj);
  cerrado = true;

  if (final === 'vencio') timedOut = true;

  return { sources: sources.slice(0, budget), failedCount, timedOut, sinLugar };
}

/**
 * Search the web on a topic and keep what is worth keeping.
 *
 * The result is a set of DRAFT documents, not course sources, because this runs
 * from the course wizard where **the course does not exist yet** — the teacher is
 * still describing it. Drafts live in Redis exactly like a PDF uploaded on that
 * same screen, and `promoteDraftDocuments` turns both into real sources on the
 * first chat turn. Reusing that path is what makes a researched page and an
 * uploaded PDF land in the same Sources panel and the same cached source pack,
 * instead of research becoming a second, parallel notion of "material".
 *
 * Nothing here is fatal. A dead link, a page behind a paywall or a search that
 * returns junk reduce the harvest; they do not fail the request, because a course
 * built from eight good pages is worth more than an error message.
 */
export async function runResearch(params: {
  topic: string;
  depth: ResearchDepth;
  orgId: string;
  /** Absent when the course wizard researches before the course exists. */
  courseId?: string;
  /** Set together with courseId — pages then land in the Sources tab immediately. */
  conversationId?: string;
  userId: string;
  redis: RedisClient;
  /** Who the course is for — shapes what counts as useful material. */
  brief?: ResearchBrief;
}): Promise<ResearchOutcome> {
  const { topic, depth, brief } = params;
  const pedidas = PAGES_PER_DEPTH[depth];
  const angles = RESEARCH_ANGLES.slice(0, ANGLES_PER_DEPTH[depth]);

  /**
   * En un curso que ya existe, las páginas son fuentes del curso y cuentan para
   * su tope. Con el curso lleno no se busca nada (422 SOURCE_LIMIT_REACHED, sin
   * gastar búsquedas); con poco lugar se leen sólo las que entran, y se avisa
   * cuántas de las que pide esta profundidad quedaron afuera.
   */
  const lugar = params.courseId && params.conversationId ? await lugarParaFuentes(params.courseId) : Infinity;

  if (lugar <= 0) throw errorDeTopeDeFuentes();

  const pageBudget = Math.min(pedidas, lugar);

  // One clock for searching AND reading. Started here, before the first search,
  // so the seconds grounding spends come out of the same budget the reader draws
  // on instead of being added to it.
  const deadline = Date.now() + RESEARCH_DEADLINE_MS;

  // Over-fetch the candidate list: some pages will be unreadable, and it is
  // cheaper to have spares than to come up short of the depth the teacher chose.
  const perAngle = await Promise.all(
    angles.map(async (angle) => {
      try {
        return await searchAngle(topic, angle, brief ?? {}, pageBudget);
      } catch (error) {
        console.warn(`[research] search failed for "${angle}":`, error);

        return { queries: [], results: [] as WebSearchResult[] };
      }
    })
  );

  // What Gemini actually typed into Search, deduplicated across angles. The
  // teacher sees these, so they have to be the real searches and not our guess
  // at what it would search for.
  const queries = [...new Set(perAngle.flatMap((outcome) => outcome.queries))];

  // Spares, not a bigger harvest: login walls and video pages are only detected
  // after reading them, so a run with no slack comes back short of its depth.
  const candidates = mergeSearchResults(
    perAngle.map((outcome) => outcome.results),
    pageBudget * 2
  );

  if (candidates.length === 0) {
    return { queries, sources: [], failedCount: 0, leftOutByLimit: 0 };
  }

  const { sources, failedCount, timedOut, sinLugar } = await readPages(candidates, pageBudget, deadline, params);

  // Lo que la profundidad pedía y no tuvo lugar: lo que se recortó de entrada,
  // más lo que se leyó y no entró porque el curso se llenó mientras tanto.
  const leftOutByLimit = pedidas - pageBudget + sinLugar;

  console.info('[research] done', {
    topic: topic.slice(0, 80),
    depth,
    queries: queries.length,
    kept: sources.length,
    failed: failedCount,
    leftOutByLimit,
    timedOut
  });

  return { queries, sources, failedCount, leftOutByLimit };
}
