/**
 * De dónde salió cada fuente, y cómo volver al original.
 *
 * Una fuente puede venir de dos lados y son excluyentes: alguien subió un
 * archivo —y la copia es nuestra— o salió de la web, y entonces el original
 * vive en internet y lo único que podemos guardar es la dirección.
 *
 * Esa dirección se estaba tirando. La página se guardaba con el título y el
 * dominio metidos en el nombre —"Colorimetría (wikipedia.org)"— y de ahí no se
 * puede volver: hay que buscar la página de nuevo a mano. Estos tests fijan que
 * la dirección sobreviva por los **dos** caminos por los que una página llega a
 * ser fuente, que es donde estaba el agujero: uno la tenía y el otro no.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createChatDocument = vi.fn();
const findChatDocumentByContentHash = vi.fn();
const getChatDocument = vi.fn();

vi.mock('@cio/db/queries/agent', () => ({
  getChatDocument: (...args: unknown[]) => getChatDocument(...args),
  createChatDocument: (...args: unknown[]) => createChatDocument(...args),
  findChatDocumentByContentHash: (...args: unknown[]) => findChatDocumentByContentHash(...args)
}));

vi.mock('@api/services/analytics/agent-events', () => ({
  trackAgentEvent: vi.fn(),
  AgentEvent: { DOCUMENT_UPLOADED: 'document_uploaded' }
}));

const { storeUrlDocument, storeDraftDocument, promoteDraftDocuments } = await import(
  '@api/services/agent/document'
);

const PAGINA = 'https://es.wikipedia.org/wiki/Colorimetr%C3%ADa';
const DUENO = { userId: 'docente-1', courseId: 'curso-1', conversationId: 'conv-1' };

function redisFalso() {
  const guardado = new Map<string, string>();

  return {
    cliente: {
      set: vi.fn(async (key: string, value: string) => {
        guardado.set(key, value);
      }),
      get: vi.fn(async (key: string) => guardado.get(key) ?? null)
    },
    guardado
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getChatDocument.mockResolvedValue(null);
  findChatDocumentByContentHash.mockResolvedValue(null);
  createChatDocument.mockResolvedValue(undefined);
});

describe('una página agregada con el curso ya creado', () => {
  it('guarda la dirección, no sólo el dominio dentro del nombre', async () => {
    const redis = redisFalso();

    await storeUrlDocument({
      url: PAGINA,
      pageTitle: 'Colorimetría',
      markdown: 'La colorimetría mide el color.',
      orgId: 'org-1',
      userId: DUENO.userId,
      courseId: DUENO.courseId,
      conversationId: DUENO.conversationId,
      redis: redis.cliente as never
    });

    const guardado = createChatDocument.mock.calls[0][0];

    expect(guardado.sourceUrl).toBe(PAGINA);
    // El nombre sigue siendo legible, pero NO es de donde se saca el enlace: de
    // "Colorimetría (es.wikipedia.org)" no se puede reconstruir la dirección.
    expect(guardado.fileName).toBe('Colorimetría (es.wikipedia.org)');
    // Una página no deja copia nuestra; ofrecer una descarga sería mentir.
    expect(guardado.assetId).toBeNull();
  });
});

describe('una página investigada ANTES de que el curso exista', () => {
  it('la dirección sobrevive el salto por el borrador', async () => {
    // Este es el camino del asistente de creación: investiga cuando todavía no
    // hay curso, así que la página va a un borrador en Redis y recién se vuelve
    // fuente en el primer turno de chat. La dirección se perdía justo ahí, y el
    // síntoma era desconcertante: la MISMA página tenía enlace o no según en qué
    // momento se la hubiera agregado.
    const redis = redisFalso();

    const { documentId } = await storeDraftDocument(
      {
        text: 'La colorimetría mide el color.',
        fileName: 'Colorimetría (es.wikipedia.org)',
        mimeType: 'text/markdown',
        pageCount: null,
        wordCount: 5,
        textPreview: 'La colorimetría',
        truncated: false,
        sourceUrl: PAGINA
      },
      DUENO.userId,
      redis.cliente as never
    );

    const promovidos = await promoteDraftDocuments([documentId], DUENO, redis.cliente as never);

    expect(promovidos).toBe(1);
    expect(createChatDocument).toHaveBeenCalledWith(expect.objectContaining({ sourceUrl: PAGINA }));
  });
});

describe('un archivo subido', () => {
  it('no inventa una dirección web', async () => {
    // El original lo tenemos nosotros: se baja del almacenamiento, no se abre en
    // internet. Si esto guardara algo, la tarjeta ofrecería "abrir la página"
    // para un PDF que no vive en ninguna página.
    const redis = redisFalso();

    const { documentId } = await storeDraftDocument(
      {
        text: 'Contenido del apunte.',
        fileName: 'apuntes.pdf',
        mimeType: 'application/pdf',
        pageCount: 12,
        wordCount: 3,
        textPreview: 'Contenido',
        truncated: false
      },
      DUENO.userId,
      redis.cliente as never
    );

    await promoteDraftDocuments([documentId], DUENO, redis.cliente as never);

    expect(createChatDocument).toHaveBeenCalledWith(expect.objectContaining({ sourceUrl: null }));
  });

  it('conserva el archivo original a traves del borrador', async () => {
    // El asistente de creacion guardaba SOLO el texto extraido, asi que el PPT
    // que habia subido el docente no se podia recuperar: existia como fuente,
    // pero el archivo no estaba en ninguna parte. Medido en produccion antes de
    // esto: 11 de 13 archivos subidos no tenian original guardado.
    const redis = redisFalso();

    const { documentId } = await storeDraftDocument(
      {
        text: 'Contenido de la presentacion.',
        fileName: 'clase-1.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        pageCount: null,
        wordCount: 3,
        textPreview: 'Contenido',
        truncated: false,
        assetId: 'asset-99'
      },
      DUENO.userId,
      redis.cliente as never
    );

    await promoteDraftDocuments([documentId], DUENO, redis.cliente as never);

    expect(createChatDocument).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'asset-99' }));
  });
});
