/**
 * La ruta de Fuentes → Página web, y «Volver a leer».
 *
 * Medido en producción: una docente pegó el enlace de su planilla privada, el
 * botón quedó diez segundos en «Subiendo fuente…», el diálogo se cerró sin
 * ningún mensaje y quedó como fuente la pantalla de inicio de sesión. La ruta
 * guardaba lo que el lector devolviera con 200.
 *
 * Contra el router real, con la lectura real (`fetchDocumentationUrl` y el
 * detector): sólo son de mentira la red del lector, Redis y la base.
 *   1. Un muro responde 422 SOURCE_NEEDS_LOGIN, y no se guarda ni se abre nada.
 *   2. Una portada de puros enlaces responde 422 SOURCE_UNREADABLE.
 *   3. Una página de verdad se lee FRESCA (sin la caché de 7 días) y se guarda
 *      en la conversación de fuentes.
 *   4. «Volver a leer» le pasa a la relectura la empresa y quien la pidió, y
 *      devuelve `{ changed, wordCount }`.
 */
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const isCourseTeamMemberOrOrgAdmin = vi.fn();
const createChatConversation = vi.fn();
const getChatConversation = vi.fn();
const getChatDocumentCourseId = vi.fn();
const storeUrlDocument = vi.fn();
const releerFuente = vi.fn();
const exigirLugarParaUnaPagina = vi.fn();

vi.mock('@cio/db/queries/group', () => ({
  isCourseTeamMemberOrOrgAdmin: (...args: unknown[]) => isCourseTeamMemberOrOrgAdmin(...args)
}));

vi.mock('@cio/db/queries/agent/chat-document', () => ({
  listCourseSources: vi.fn(async () => []),
  listChatDocumentsByConversation: vi.fn(async () => []),
  deleteChatDocument: vi.fn(),
  getChatDocumentCacheKey: vi.fn(),
  getChatDocumentCourseId: (...args: unknown[]) => getChatDocumentCourseId(...args)
}));

vi.mock('@cio/db/queries/agent', () => ({
  createChatConversation: (...args: unknown[]) => createChatConversation(...args),
  getChatConversation: (...args: unknown[]) => getChatConversation(...args)
}));

vi.mock('@api/services/agent/document-cache', () => ({
  releaseDocumentCaches: vi.fn(),
  getDocumentCacheStatus: vi.fn(),
  refreshDocumentCache: vi.fn(),
  reconcileCourseSourceCache: vi.fn(),
  classifyDocumentForCache: vi.fn()
}));

vi.mock('@api/services/agent/document', () => ({
  exigirLugarParaUnaPagina: (...args: unknown[]) => exigirLugarParaUnaPagina(...args),
  fuenteConLecturaVieja: vi.fn(() => false),
  getCourseSourceText: vi.fn(),
  releerFuente: (...args: unknown[]) => releerFuente(...args),
  storeUrlDocument: (...args: unknown[]) => storeUrlDocument(...args),
  SOURCES_CONVERSATION_TITLE: 'Fuentes del curso'
}));

vi.mock('@cio/db/queries/assets/assets', () => ({ getAssetsByIds: vi.fn(async () => []) }));

vi.mock('@api/utils/s3', () => ({ generateDocumentDownloadPresignedUrls: vi.fn(async () => ({})) }));

// Redis cerrado: la lectura no usa caché y va siempre al lector de mentira.
vi.mock('@api/utils/redis/redis', () => ({
  redis: { isOpen: false, get: vi.fn(), set: vi.fn(), del: vi.fn() },
  logRedisUnavailableOnce: vi.fn()
}));

const { agentDocumentsRouter } = await import('@api/routes/agent/documents');
const { AppError } = await import('@api/utils/errors');

const EMPRESA = '00000000-0000-4000-8000-00000000e003';
const CURSO = '00000000-0000-4000-8000-00000000c003';
const DOCENTE = { id: 'docente-demo', email: 'docente@almacen-demo.test', role: null };
const PLANILLA = 'https://docs.google.com/spreadsheets/d/1EjemploInventadoDePlanilla000000000000000/edit';

/** Monta el router real detrás de una sesión armada a mano, como hace `app.ts`. */
function app() {
  return new Hono()
    .use('*', async (c, next) => {
      c.set('user' as never, DOCENTE as never);
      c.set('session' as never, { id: 's1' } as never);
      c.set('orgRoles' as never, { [EMPRESA]: 2 } as never);
      await next();
    })
    .route('/agent/documents', agentDocumentsRouter);
}

function agregarPagina(url: string) {
  return app().request('/agent/documents/url', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cio-org-id': EMPRESA },
    body: JSON.stringify({ courseId: CURSO, url })
  });
}

/** El lector contesta 200 con este texto, como hace aunque no haya podido leer nada. */
function lectorQueDevuelve(texto: string) {
  const lector = vi.fn(async (_url: string, _init?: RequestInit) => new Response(texto, { status: 200 }));
  vi.stubGlobal('fetch', lector);
  return lector;
}

const MURO = [
  'Title: Google Sheets: Sign-in',
  '',
  `URL Source: ${PLANILLA}`,
  '',
  'Markdown Content:',
  '# Sign in',
  'to continue to Google Sheets',
  'Email or phone',
  'Forgot email?',
  ...['Afrikaans', 'Dansk', 'Deutsch', 'Español', 'Français', 'Italiano'].map((i) => `*   ${i}`)
].join('\n');

/**
 * Una portada de documentación: bastante texto visible (la lectura la deja
 * pasar, el agente la usa para navegar) pero todo en enlaces. Como FUENTE no
 * sirve, y eso lo decide la ruta, no la lectura.
 */
const PORTADA = [
  'Title: Documentación',
  '',
  'Markdown Content:',
  ...[
    'Primeros pasos con la plataforma',
    'Instalación en servidores propios',
    'Configuración de usuarios y permisos',
    'Referencia completa de la API'
  ].map((t, i) => `*   [${t}](https://docs.ejemplo.test/${i})`)
].join('\n');

const ARTICULO = [
  'Title: Conciliación bancaria',
  '',
  'Markdown Content:',
  '# Conciliación bancaria',
  'La conciliación compara cada mes los movimientos del banco con los registros de la empresa.',
  'Sirve para encontrar a tiempo los errores de carga y los débitos que nadie reconoce en el resumen.',
  'Se hace al cierre de cada mes, con el extracto del banco y el mayor de la cuenta a la vista.',
  'Cada diferencia se anota con su explicación: un cheque que no se cobró, una comisión, un error de tipeo.',
  'Si una diferencia no tiene explicación, se revisa el comprobante antes de corregir el registro.'
].join('\n');

beforeEach(() => {
  vi.clearAllMocks();
  isCourseTeamMemberOrOrgAdmin.mockResolvedValue(true);
  exigirLugarParaUnaPagina.mockResolvedValue(undefined);
  createChatConversation.mockResolvedValue({ id: 'conv-fuentes', title: 'Fuentes del curso' });
  storeUrlDocument.mockImplementation(async (params: { url: string }) => ({
    documentId: 'fuente-nueva',
    fileName: params.url,
    reused: false,
    replaced: false
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /agent/documents/url', () => {
  it('con el curso lleno responde 422 SOURCE_LIMIT_REACHED sin leer la página', async () => {
    const lector = lectorQueDevuelve(ARTICULO);
    exigirLugarParaUnaPagina.mockRejectedValueOnce(
      new AppError('This course already has 100 sources: delete one before adding another', 'SOURCE_LIMIT_REACHED', 422)
    );

    const respuesta = await agregarPagina('https://ayuda.ejemplo.test/conciliacion');

    expect(respuesta.status).toBe(422);
    expect(await respuesta.json()).toMatchObject({ success: false, code: 'SOURCE_LIMIT_REACHED' });
    expect(exigirLugarParaUnaPagina).toHaveBeenCalledWith(CURSO, 'https://ayuda.ejemplo.test/conciliacion');
    expect(lector).not.toHaveBeenCalled();
    expect(storeUrlDocument).not.toHaveBeenCalled();
  });

  it('un muro de inicio de sesión responde 422 SOURCE_NEEDS_LOGIN, y no se guarda ni se abre nada', async () => {
    lectorQueDevuelve(MURO);

    const respuesta = await agregarPagina(PLANILLA);

    expect(respuesta.status).toBe(422);
    expect(await respuesta.json()).toMatchObject({ success: false, code: 'SOURCE_NEEDS_LOGIN' });
    expect(storeUrlDocument).not.toHaveBeenCalled();
    // Una página rechazada no tiene por qué abrir la conversación de fuentes.
    expect(createChatConversation).not.toHaveBeenCalled();
  });

  it('una portada de puros enlaces responde 422 SOURCE_UNREADABLE', async () => {
    lectorQueDevuelve(PORTADA);

    const respuesta = await agregarPagina('https://docs.ejemplo.test/');

    expect(respuesta.status).toBe(422);
    expect(await respuesta.json()).toMatchObject({ success: false, code: 'SOURCE_UNREADABLE' });
    expect(storeUrlDocument).not.toHaveBeenCalled();
  });

  it('una página de verdad se lee fresca y se guarda en la conversación de fuentes', async () => {
    const lector = lectorQueDevuelve(ARTICULO);

    const respuesta = await agregarPagina('https://ayuda.ejemplo.test/conciliacion');

    expect(respuesta.status).toBe(200);
    // Fresca: la docente quiere lo que la página dice HOY, no lo que guardó la caché.
    expect((lector.mock.calls[0][1]?.headers as Record<string, string>)['X-No-Cache']).toBe('true');
    expect(createChatConversation).toHaveBeenCalledWith(CURSO, DOCENTE.id, 'Fuentes del curso');
    expect(storeUrlDocument).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://ayuda.ejemplo.test/conciliacion', conversationId: 'conv-fuentes', courseId: CURSO })
    );
  });
});

describe('POST /agent/documents/:documentId/reread', () => {
  function releer() {
    return app().request('/agent/documents/fuente-planilla/reread', {
      method: 'POST',
      headers: { 'cio-org-id': EMPRESA }
    });
  }

  it('le pasa a la relectura la empresa y quien la pidió, y devuelve si cambió', async () => {
    getChatDocumentCourseId.mockResolvedValue(CURSO);
    releerFuente.mockResolvedValue({ changed: true, before: 300, after: 900, pageCount: null, wordCount: 150 });

    const respuesta = await releer();

    expect(respuesta.status).toBe(200);
    expect(releerFuente).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'fuente-planilla', courseId: CURSO, orgId: EMPRESA, userId: DOCENTE.id })
    );
    expect(await respuesta.json()).toMatchObject({ success: true, data: { changed: true, wordCount: 150 } });
  });

  it('una página que sigue siendo un muro responde 422 con el código', async () => {
    getChatDocumentCourseId.mockResolvedValue(CURSO);
    releerFuente.mockRejectedValue(new AppError('sign-in screen', 'SOURCE_NEEDS_LOGIN', 422));

    const respuesta = await releer();

    expect(respuesta.status).toBe(422);
    expect(await respuesta.json()).toMatchObject({ success: false, code: 'SOURCE_NEEDS_LOGIN' });
  });
});
