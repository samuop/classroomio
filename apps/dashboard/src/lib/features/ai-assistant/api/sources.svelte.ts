import { AI_REQUEST_TIMEOUT, BaseApiWithErrors, classroomio, llamadaDeIA } from '$lib/utils/services/api';
import type {
  AddUrlSourceRequest,
  CourseSource,
  ListCourseSourcesRequest,
  DeleteCourseSourceRequest,
  DocumentCacheStatus,
  GetCacheStatusRequest,
  RereadSourceRequest,
  ReconcileSourcesRequest
} from '../utils/types';

/** Lo que devuelve volver a leer una fuente. Ver `releerFuente`. */
export interface RelecturaDeFuente {
  /** Si el texto cambió: sólo entonces hay algo nuevo que avisar. */
  changed: boolean;
  wordCount: number;
}

export interface ReconcileSummary {
  totalDocuments: number;
  rebuilt: number;
  kept: number;
  released: number;
  skipped: number;
  results: Array<{
    documentId: string;
    action: 'kept' | 'rebuilt' | 'released' | 'skipped';
    reason: string | null;
    status: DocumentCacheStatus | null;
  }>;
}

class SourcesApi extends BaseApiWithErrors {
  sources: CourseSource[] = $state([]);
  isUploading = $state(false);
  isAddingUrl = $state(false);
  deletingId: string | null = $state(null);
  refreshingId: string | null = $state(null);
  reconciling = $state(false);
  lastReconcileSummary: ReconcileSummary | null = $state(null);
  cacheStatuses: Record<string, DocumentCacheStatus> = $state({});

  /**
   * Number of sources with a live cache handle. Reactive — bind to it in
   * the page header for an at-a-glance "Y/Z cached" indicator.
   */
  get cachedCount(): number {
    return Object.values(this.cacheStatuses).filter((s) => s.cached).length;
  }

  /**
   * List every source attached to the course across all of the user's
   * conversations. Scoped to `conversationId` when given.
   */
  async listSources(courseId: string, conversationId?: string) {
    await this.execute<ListCourseSourcesRequest>({
      requestFn: () =>
        classroomio.agent.documents.$get({
          query: { courseId, conversationId }
        }),
      logContext: 'listing course sources',
      onSuccess: (result) => {
        this.sources = result.data as CourseSource[];
      }
    });
  }

  /**
   * Add a web page as a course source.
   *
   * The page is fetched server-side and stored like an uploaded PDF, so it shows
   * up in this list and rides in the cached source pack. Pasting a URL into the
   * chat instead only put it in the transcript — which build mode discards, so the
   * page was gone by the time the course got written.
   *
   * Devuelve el documento guardado, o `null`. Si falla, `error` guarda el cuerpo
   * de la respuesta: ahí viene el `code` (`SOURCE_NEEDS_LOGIN`,
   * `SOURCE_UNREADABLE`) con el que la pantalla elige el texto. No vuelve a
   * listar: quien llama lo hace, junto con el resto de lo que refresca.
   */
  async addUrlSource(
    courseId: string,
    url: string,
    conversationId?: string
  ): Promise<{ documentId: string; fileName: string } | null> {
    this.isAddingUrl = true;
    let guardada: { documentId: string; fileName: string } | null = null;
    await this.execute<AddUrlSourceRequest>({
      requestFn: () =>
        classroomio.agent.documents.url.$post(
          {
            json: { courseId, url, conversationId }
          },
          llamadaDeIA(AI_REQUEST_TIMEOUT.webPage)
        ),
      logContext: 'adding URL source',
      onSuccess: (response) => {
        guardada = { documentId: response.data.documentId, fileName: response.data.fileName };
      }
    });
    this.isAddingUrl = false;

    return guardada;
  }

  /**
   * Igual que `addUrlSource`, sin marcar la pantalla de Fuentes como ocupada.
   *
   * Lo usa el asistente de creacion, que necesita el id para adjuntar la pagina
   * al primer turno del agente — y que todavia no tiene la pantalla de fuentes
   * abierta.
   *
   * Devuelve `null` si la pagina no se pudo bajar. Quien llama decide: bajar 3
   * paginas y perder 1 no puede tumbar la creacion del curso entero.
   *
   * @param alFallar recibe el error de ESTA página (el cuerpo de la respuesta
   *   como texto, para `claveDelErrorDeFuente`). `error` no sirve para eso
   *   cuando se guardan varias a la vez: la última que falla pisa a las demás.
   */
  async guardarPaginaComoFuente(
    courseId: string,
    url: string,
    alFallar?: (errorCrudo: string | null) => void
  ): Promise<{ documentId: string; fileName: string } | null> {
    let guardada: { documentId: string; fileName: string } | null = null;

    await this.execute<AddUrlSourceRequest>({
      requestFn: () =>
        classroomio.agent.documents.url.$post(
          {
            json: { courseId, url }
          },
          llamadaDeIA(AI_REQUEST_TIMEOUT.webPage)
        ),
      logContext: 'saving web page as course source',
      onSuccess: (response) => {
        guardada = { documentId: response.data.documentId, fileName: response.data.fileName };
      },
      onError: (error) => {
        alFallar?.(typeof error === 'string' ? error : error ? JSON.stringify(error) : null);
      }
    });

    return guardada;
  }

  /**
   * Delete a source. Drops the DB row, releases any cache handle so the next
   * chat turn doesn't try to read from a cached block that no longer maps to
   * a real document.
   */
  async deleteSource(documentId: string) {
    this.deletingId = documentId;
    let success = false;
    await this.execute<DeleteCourseSourceRequest>({
      requestFn: () =>
        classroomio.agent.documents[':documentId'].$delete({
          param: { documentId }
        }),
      logContext: 'deleting course source',
      onSuccess: () => {
        this.sources = this.sources.filter((s) => s.id !== documentId);
        delete this.cacheStatuses[documentId];
        success = true;
      }
    });
    this.deletingId = null;
    return success;
  }

  /**
   * Pull the live cache status for every source currently in the list. Cheap
   * (one Redis GET per source) so we call it on mount and after any
   * refresh / delete.
   */
  async loadCacheStatuses() {
    await Promise.all(
      this.sources.map(async (s) => {
        const status = await this.fetchCacheStatus(s.id);
        if (status) this.cacheStatuses[s.id] = status;
      })
    );
  }

  async fetchCacheStatus(documentId: string): Promise<DocumentCacheStatus | null> {
    let result: DocumentCacheStatus | null = null;
    await this.execute<GetCacheStatusRequest>({
      requestFn: () =>
        classroomio.agent.documents[':documentId']['cache-status'].$get({
          param: { documentId }
        }),
      logContext: 'reading cache status',
      onSuccess: (res) => {
        result = res.data as DocumentCacheStatus;
      }
    });
    return result;
  }

  /**
   * Vuelve a leer la fuente: el archivo original con el lector de hoy, o la
   * página web leída de nuevo.
   *
   * El botón ↻ de la tarjeta dice «Volver a leer esta fuente» y llamaba a
   * `refresh-cache`, que no relee nada: sólo suelta el handle de caché. Después
   * mostraba «Fuente actualizada». Con una planilla que se guardó con la pantalla
   * de inicio de sesión, la docente la compartía, apretaba el botón y seguía con
   * el muro de login y un mensaje de éxito.
   *
   * Devuelve si el texto cambió, o `null` si falló (el cuerpo del error queda en
   * `error`, con su `code`).
   */
  async releerFuente(documentId: string): Promise<RelecturaDeFuente | null> {
    this.refreshingId = documentId;
    let result: RelecturaDeFuente | null = null;
    await this.execute<RereadSourceRequest>({
      requestFn: () =>
        classroomio.agent.documents[':documentId'].reread.$post(
          {
            param: { documentId }
          },
          llamadaDeIA(AI_REQUEST_TIMEOUT.reread)
        ),
      logContext: 're-reading source',
      onSuccess: (res) => {
        const data = res.data as { changed?: unknown; wordCount?: unknown };

        result = {
          changed: data.changed === true,
          wordCount: typeof data.wordCount === 'number' ? data.wordCount : 0
        };
      }
    });
    this.refreshingId = null;
    return result;
  }

  /**
   * Re-read the cache state for every source in the course and drop evidence
   * that has aged out. It deliberately does NOT create cache handles: for the
   * Anthropic-compatible provider a handle means "the provider billed us for
   * cached reads", which only a real chat turn can establish. Sources with no
   * confirmed hit yet come back as `skipped` / `awaiting_cache_hit`.
   *
   * Idempotent: pass after any upload / delete / refresh that may have left
   * the cache set out of sync.
   */
  async reconcileSources(courseId: string): Promise<ReconcileSummary | null> {
    this.reconciling = true;
    let summary: ReconcileSummary | null = null;
    await this.execute<ReconcileSourcesRequest>({
      requestFn: () =>
        classroomio.agent.documents.reconcile.$post({
          query: { courseId }
        }),
      logContext: 'reconciling source caches',
      onSuccess: (res) => {
        summary = res.data as ReconcileSummary;
        this.lastReconcileSummary = summary;
        // Mirror each result's status into the cache-status map so the UI
        // updates without an extra round-trip.
        for (const r of summary.results) {
          if (r.status) this.cacheStatuses[r.documentId] = r.status;
        }
      }
    });
    this.reconciling = false;
    return summary;
  }
}

export const sourcesApi = new SourcesApi();