/**
 * Volver a agregar una página y volver a leer una fuente.
 *
 * El recorrido que se fija es el de la docente de la planilla privada: agregó
 * el enlace, entró como fuente la pantalla de inicio de sesión, compartió la
 * planilla y quiso arreglarlo. No tenía cómo:
 *
 *   - volver a agregar la misma dirección devolvía la fuente vieja («reused»),
 *     porque la única comparación era por el texto, o creaba una segunda;
 *   - «Volver a leer» rechazaba las páginas web («se relee agregándola de
 *     nuevo»), que era justo lo que no funcionaba.
 *
 * Ahora la misma dirección con texto nuevo REEMPLAZA el de la fuente (misma
 * fuente, mismo id), y releer una página la baja de nuevo, fresca. Lo que
 * vuelva como muro se rechaza y la fuente queda como estaba.
 *
 * Todo con datos inventados: el id de la planilla no existe.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createChatDocument = vi.fn();
const findChatDocumentByContentHash = vi.fn();
const getChatDocument = vi.fn();
const getCourseSource = vi.fn();
const actualizarLecturaDeFuente = vi.fn();
const buscarFuentePorDireccion = vi.fn();
const reemplazarFuenteWeb = vi.fn();
const getCourseOrganizationId = vi.fn();
const encolarResumen = vi.fn();
const fetchDocumentationUrl = vi.fn();
const getAssetsByIds = vi.fn();
const getFromS3 = vi.fn();
const contarFuentesDelCurso = vi.fn();

vi.mock('@cio/db/queries/agent', () => ({
  createChatDocument: (...args: unknown[]) => createChatDocument(...args),
  findChatDocumentByContentHash: (...args: unknown[]) => findChatDocumentByContentHash(...args),
  getChatDocument: (...args: unknown[]) => getChatDocument(...args),
  getCourseSource: (...args: unknown[]) => getCourseSource(...args),
  actualizarLecturaDeFuente: (...args: unknown[]) => actualizarLecturaDeFuente(...args),
  // El tope de fuentes, con la misma forma que el de la base (ver chat-document.ts).
  contarFuentesDelCurso: (...args: unknown[]) => contarFuentesDelCurso(...args),
  MAX_SOURCES_PER_COURSE: 100,
  CODIGO_TOPE_DE_FUENTES: 'SOURCE_LIMIT_REACHED',
  esTopeDeFuentes: (error: unknown) => (error as { code?: string } | null)?.code === 'SOURCE_LIMIT_REACHED'
}));

vi.mock('@cio/db/queries/agent/fuentes-del-curso', () => ({
  buscarFuentePorDireccion: (...args: unknown[]) => buscarFuentePorDireccion(...args),
  reemplazarFuenteWeb: (...args: unknown[]) => reemplazarFuenteWeb(...args),
  duenoDeFuente: vi.fn()
}));

vi.mock('@cio/db/queries/tag', () => ({
  getCourseOrganizationId: (...args: unknown[]) => getCourseOrganizationId(...args)
}));

vi.mock('@cio/db/queries/assets', () => ({
  getAssetsByIds: (...args: unknown[]) => getAssetsByIds(...args)
}));

vi.mock('@api/utils/s3', () => ({
  getFromS3: (...args: unknown[]) => getFromS3(...args),
  uploadToS3: vi.fn()
}));

vi.mock('@api/config/storage', () => ({
  getStorageConfig: () => ({ bucketDocuments: 'documentos-demo' })
}));

vi.mock('@api/services/assets/assets', () => ({
  createAssetFromUploadService: vi.fn(async () => ({ id: 'asset-subido' }))
}));

vi.mock('@api/services/agent/resumenes-de-fuentes', () => ({
  encolarResumen: (...args: unknown[]) => encolarResumen(...args),
  leerResumenesGuardados: vi.fn(async () => new Map())
}));

vi.mock('@api/services/agent/fetch-url', async () => {
  const real = await vi.importActual<typeof import('@api/services/agent/fetch-url')>('@api/services/agent/fetch-url');

  return {
    PLAZO_DE_LECTURA_A_MANO_MS: real.PLAZO_DE_LECTURA_A_MANO_MS,
    fetchDocumentationUrl: (...args: unknown[]) => fetchDocumentationUrl(...args)
  };
});

const { storeUrlDocument, releerFuente, parseAndStoreDocument, EXTRACTOR_VERSION } = await import(
  '@api/services/agent/document'
);
const { uploadToS3 } = await import('@api/utils/s3');
const { PLAZO_DE_LECTURA_A_MANO_MS } = await import('@api/services/agent/fetch-url');
const { errorDePaginaSinContenido } = await import('@api/services/agent/pagina-sin-contenido');
const { agentDocumentKey, computeContentHash } = await import('@api/utils/redis/key-generators');
const JSZip = (await import('jszip')).default;

const PLANILLA = 'https://docs.google.com/spreadsheets/d/1EjemploInventadoDePlanilla000000000000000/edit';
const CURSO = 'curso-demo';

function redisFalso() {
  return {
    set: vi.fn(async () => 'OK'),
    get: vi.fn(async () => null),
    del: vi.fn(async () => 1)
  };
}

/** El texto de una página tal como llega de la lectura, con su sobre. */
function pagina(cuerpo: string): string {
  return `<external_untrusted_document src="${PLANILLA}">\nTitle: Stock del almacén\n\n${cuerpo}\n</external_untrusted_document>`;
}

const PLANILLA_COMPARTIDA = pagina(
  [
    'Markdown Content:',
    '| Producto | Stock | Reposición |',
    '| --- | --- | --- |',
    ...['Yerba 1 kg', 'Azúcar 1 kg', 'Harina 000', 'Arroz largo fino', 'Aceite de girasol', 'Fideos tirabuzón', 'Leche entera', 'Galletitas de agua'].map(
      (producto, i) => `| ${producto} | ${10 + i * 3} | ${['lunes', 'martes', 'jueves'][i % 3]} |`
    ),
    'El stock se controla al cierre de cada turno y se anota en la columna de reposición cuando baja de diez unidades.',
    'Quien cierra el turno revisa también las fechas de vencimiento y separa lo que vence en la semana.'
  ].join('\n')
);

const MURO_VIEJO = pagina('Markdown Content:\n# Sign in\nto continue to Google Sheets\nEmail or phone');

function fuenteWeb(texto: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'fuente-planilla',
    conversationId: 'conv-fuentes',
    courseId: CURSO,
    userId: 'docente-demo',
    assetId: null,
    sourceUrl: PLANILLA,
    fileName: 'Google Sheets: Sign-in (docs.google.com)',
    mimeType: 'text/markdown',
    text: texto,
    contentHash: computeContentHash(texto),
    wordCount: texto.split(/\s+/).length,
    pageCount: null,
    extractorVersion: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra
  };
}

function agregar(markdown: string, url = PLANILLA, redis = redisFalso()) {
  return storeUrlDocument({
    url,
    pageTitle: 'Stock del almacén',
    markdown,
    orgId: 'org-demo',
    userId: 'docente-demo',
    courseId: CURSO,
    conversationId: 'conv-fuentes',
    redis: redis as never
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  buscarFuentePorDireccion.mockResolvedValue(null);
  findChatDocumentByContentHash.mockResolvedValue(null);
  createChatDocument.mockResolvedValue(undefined);
  reemplazarFuenteWeb.mockResolvedValue(undefined);
  actualizarLecturaDeFuente.mockResolvedValue(undefined);
  getCourseOrganizationId.mockResolvedValue('org-del-curso');
  contarFuentesDelCurso.mockResolvedValue(0);
});

describe('el tope de fuentes del curso', () => {
  async function pptx(texto: string): Promise<File> {
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml', `<p:sld><a:t>${texto}</a:t></p:sld>`);

    return new File([await zip.generateAsync({ type: 'uint8array' })], 'clase.pptx', {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    });
  }

  it('con el curso lleno, una subida se rechaza con 422 SOURCE_LIMIT_REACHED antes de guardar el archivo', async () => {
    contarFuentesDelCurso.mockResolvedValue(100);

    await expect(
      parseAndStoreDocument(await pptx('Cierre de caja'), 'org-demo', 'docente-demo', CURSO, 'conv-fuentes', redisFalso() as never)
    ).rejects.toMatchObject({ code: 'SOURCE_LIMIT_REACHED', statusCode: 422 });

    expect(uploadToS3).not.toHaveBeenCalled();
    expect(createChatDocument).not.toHaveBeenCalled();
  });

  it('con el curso lleno, una página nueva se rechaza igual', async () => {
    contarFuentesDelCurso.mockResolvedValue(100);

    await expect(agregar(PLANILLA_COMPARTIDA)).rejects.toMatchObject({ code: 'SOURCE_LIMIT_REACHED', statusCode: 422 });
    expect(createChatDocument).not.toHaveBeenCalled();
  });

  it('con el curso lleno, volver a agregar una página que ya es fuente la relee: no ocupa lugar nuevo', async () => {
    contarFuentesDelCurso.mockResolvedValue(100);
    buscarFuentePorDireccion.mockResolvedValue(fuenteWeb(MURO_VIEJO));

    const resultado = await agregar(PLANILLA_COMPARTIDA);

    expect(resultado).toMatchObject({ documentId: 'fuente-planilla', replaced: true });
  });

  it('si otra alta ganó el último lugar, el rechazo de la base también llega como 422', async () => {
    createChatDocument.mockRejectedValueOnce(Object.assign(new Error('This course already has 100 sources'), { code: 'SOURCE_LIMIT_REACHED' }));

    await expect(agregar(PLANILLA_COMPARTIDA)).rejects.toMatchObject({ code: 'SOURCE_LIMIT_REACHED', statusCode: 422 });
  });
});

describe('volver a agregar la misma página', () => {
  it('con el texto cambiado, reemplaza el de la fuente que ya estaba', async () => {
    buscarFuentePorDireccion.mockResolvedValue(fuenteWeb(MURO_VIEJO));
    const redis = redisFalso();

    const resultado = await agregar(PLANILLA_COMPARTIDA, PLANILLA, redis);

    expect(resultado).toMatchObject({ documentId: 'fuente-planilla', reused: false, replaced: true });
    expect(reemplazarFuenteWeb).toHaveBeenCalledWith('fuente-planilla', {
      text: PLANILLA_COMPARTIDA,
      // El nombre también: «Sign-in» ya no describe lo que hay.
      fileName: 'Stock del almacén (docs.google.com)',
      wordCount: PLANILLA_COMPARTIDA.split(/\s+/).filter(Boolean).length,
      contentHash: computeContentHash(PLANILLA_COMPARTIDA)
    });
    expect(createChatDocument).not.toHaveBeenCalled();
    // La copia caliente describía el muro.
    expect(redis.del).toHaveBeenCalledWith(agentDocumentKey('fuente-planilla'));
    expect(encolarResumen).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'fuente-planilla', contentHash: computeContentHash(PLANILLA_COMPARTIDA) })
    );
  });

  it('una fuente con nombre de verdad lo conserva aunque el título de la página haya cambiado', async () => {
    // El plan aprobado declara sus fuentes por nombre: renombrarla al releerla
    // dejaba la lección sin su material, sin aviso.
    buscarFuentePorDireccion.mockResolvedValue(
      fuenteWeb('Una versión anterior de la planilla de stock.', { fileName: 'Planilla de stock (docs.google.com)' })
    );

    const resultado = await agregar(PLANILLA_COMPARTIDA);

    expect(resultado).toMatchObject({ replaced: true, fileName: 'Planilla de stock (docs.google.com)' });
    expect(reemplazarFuenteWeb).toHaveBeenCalledWith(
      'fuente-planilla',
      expect.objectContaining({ fileName: 'Planilla de stock (docs.google.com)', text: PLANILLA_COMPARTIDA })
    );
  });

  it('con el mismo texto, devuelve la que estaba sin tocarla', async () => {
    buscarFuentePorDireccion.mockResolvedValue(fuenteWeb(PLANILLA_COMPARTIDA));

    const resultado = await agregar(PLANILLA_COMPARTIDA);

    expect(resultado).toMatchObject({ documentId: 'fuente-planilla', reused: true, replaced: false });
    expect(reemplazarFuenteWeb).not.toHaveBeenCalled();
    expect(createChatDocument).not.toHaveBeenCalled();
  });

  it('la busca por la dirección tal como la pegó y normalizada', async () => {
    await agregar(PLANILLA_COMPARTIDA, 'https://Docs.Google.com/spreadsheets/d/1EjemploInventadoDePlanilla000000000000000/edit');

    expect(buscarFuentePorDireccion).toHaveBeenCalledWith(CURSO, [
      'https://Docs.Google.com/spreadsheets/d/1EjemploInventadoDePlanilla000000000000000/edit',
      PLANILLA
    ]);
  });

  it('una página nueva se crea, y su resumen se pide al nacer', async () => {
    const resultado = await agregar(PLANILLA_COMPARTIDA);

    expect(resultado).toMatchObject({ reused: false, replaced: false });
    expect(createChatDocument).toHaveBeenCalledWith(expect.objectContaining({ sourceUrl: PLANILLA, courseId: CURSO }));
    expect(encolarResumen).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: resultado.documentId,
        contentHash: computeContentHash(PLANILLA_COMPARTIDA),
        consumo: { userId: 'docente-demo', courseId: CURSO }
      })
    );
  });

  it('otra dirección con el mismo texto sigue deduplicándose por el texto', async () => {
    findChatDocumentByContentHash.mockResolvedValue(fuenteWeb(PLANILLA_COMPARTIDA, { id: 'la-misma-en-otra-direccion' }));

    const resultado = await agregar(PLANILLA_COMPARTIDA, 'https://espejo.ejemplo.test/stock');

    expect(resultado).toMatchObject({ documentId: 'la-misma-en-otra-direccion', reused: true, replaced: false });
    expect(createChatDocument).not.toHaveBeenCalled();
  });
});

describe('volver a leer una página web', () => {
  function leida(content: string) {
    return {
      url: PLANILLA,
      pageTitle: 'Stock del almacén',
      content,
      links: [],
      contentTokens: 100,
      fetchedAt: '2026-01-02T00:00:00.000Z',
      cacheHit: false
    };
  }

  it('la baja fresca y, si cambió, reemplaza el texto', async () => {
    getCourseSource.mockResolvedValue(fuenteWeb(MURO_VIEJO));
    fetchDocumentationUrl.mockResolvedValue(leida(PLANILLA_COMPARTIDA));

    const resultado = await releerFuente({
      documentId: 'fuente-planilla',
      courseId: CURSO,
      redis: redisFalso() as never,
      orgId: 'org-demo',
      userId: 'docente-demo'
    });

    expect(fetchDocumentationUrl).toHaveBeenCalledWith(
      expect.objectContaining({ url: PLANILLA, orgId: 'org-demo', fresco: true, plazoMs: PLAZO_DE_LECTURA_A_MANO_MS })
    );
    expect(resultado).toMatchObject({
      changed: true,
      wordCount: PLANILLA_COMPARTIDA.split(/\s+/).filter(Boolean).length,
      pageCount: null
    });
    expect(reemplazarFuenteWeb).toHaveBeenCalledWith('fuente-planilla', expect.objectContaining({ text: PLANILLA_COMPARTIDA }));
    expect(encolarResumen).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'fuente-planilla', consumo: { userId: 'docente-demo', courseId: CURSO } })
    );
  });

  it('si no cambió, lo dice y no toca nada', async () => {
    getCourseSource.mockResolvedValue(fuenteWeb(PLANILLA_COMPARTIDA));
    fetchDocumentationUrl.mockResolvedValue(leida(PLANILLA_COMPARTIDA));

    const resultado = await releerFuente({ documentId: 'fuente-planilla', courseId: CURSO, redis: redisFalso() as never });

    expect(resultado.changed).toBe(false);
    expect(reemplazarFuenteWeb).not.toHaveBeenCalled();
    expect(encolarResumen).not.toHaveBeenCalled();
  });

  it('sin empresa, la saca del curso: la caché del lector es por empresa', async () => {
    getCourseSource.mockResolvedValue(fuenteWeb(MURO_VIEJO));
    fetchDocumentationUrl.mockResolvedValue(leida(PLANILLA_COMPARTIDA));

    await releerFuente({ documentId: 'fuente-planilla', courseId: CURSO, redis: redisFalso() as never });

    expect(getCourseOrganizationId).toHaveBeenCalledWith(CURSO);
    expect(fetchDocumentationUrl).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-del-curso' }));
  });

  it('si sigue siendo un muro, se rechaza y la fuente queda como estaba', async () => {
    getCourseSource.mockResolvedValue(fuenteWeb(PLANILLA_COMPARTIDA));
    fetchDocumentationUrl.mockRejectedValue(
      errorDePaginaSinContenido({ code: 'SOURCE_NEEDS_LOGIN', motivo: 'it is a sign-in screen' }, PLANILLA)
    );

    await expect(
      releerFuente({ documentId: 'fuente-planilla', courseId: CURSO, redis: redisFalso() as never })
    ).rejects.toMatchObject({ code: 'SOURCE_NEEDS_LOGIN', statusCode: 422 });
    expect(reemplazarFuenteWeb).not.toHaveBeenCalled();
  });

  it('una página de puros enlaces tampoco reemplaza una lectura buena', async () => {
    getCourseSource.mockResolvedValue(fuenteWeb(PLANILLA_COMPARTIDA));
    fetchDocumentationUrl.mockResolvedValue(
      leida(pagina(['Markdown Content:', '*   [Inicio](https://ejemplo.test/)', '*   [Ayuda](https://ejemplo.test/ayuda)'].join('\n')))
    );

    await expect(
      releerFuente({ documentId: 'fuente-planilla', courseId: CURSO, redis: redisFalso() as never })
    ).rejects.toMatchObject({ code: 'SOURCE_UNREADABLE', statusCode: 422 });
    expect(reemplazarFuenteWeb).not.toHaveBeenCalled();
  });

  it('una fuente sin archivo ni dirección no tiene de dónde releerse', async () => {
    getCourseSource.mockResolvedValue(fuenteWeb('texto', { sourceUrl: null }));

    await expect(
      releerFuente({ documentId: 'fuente-planilla', courseId: CURSO, redis: redisFalso() as never })
    ).rejects.toMatchObject({ code: 'SOURCE_HAS_NO_FILE', statusCode: 400 });
    expect(fetchDocumentationUrl).not.toHaveBeenCalled();
  });
});

describe('volver a leer un archivo', () => {
  /** Una presentación mínima: el lector de PPTX lee el texto de cada diapositiva. */
  async function presentacion(texto: string): Promise<Uint8Array> {
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml', `<p:sld><a:t>${texto}</a:t></p:sld>`);

    return zip.generateAsync({ type: 'uint8array' });
  }

  function fuenteArchivo(texto: string) {
    return {
      ...fuenteWeb(texto),
      id: 'fuente-archivo',
      assetId: 'asset-demo',
      sourceUrl: null,
      fileName: 'clase.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    };
  }

  async function conArchivo(texto: string) {
    const bytes = await presentacion(texto);
    getAssetsByIds.mockResolvedValue([{ id: 'asset-demo', storageKey: 'documentos/clase.pptx' }]);
    getFromS3.mockResolvedValue({ success: true, data: { Body: { transformToByteArray: async () => bytes } } });
  }

  it('con el mismo texto dice que no cambió, pero anota la versión del lector', async () => {
    getCourseSource.mockResolvedValue(fuenteArchivo('Arqueo de caja'));
    await conArchivo('Arqueo de caja');

    const resultado = await releerFuente({ documentId: 'fuente-archivo', courseId: CURSO, redis: redisFalso() as never });

    expect(resultado.changed).toBe(false);
    expect(actualizarLecturaDeFuente).toHaveBeenCalledWith(
      'fuente-archivo',
      expect.objectContaining({ extractorVersion: EXTRACTOR_VERSION })
    );
    expect(encolarResumen).not.toHaveBeenCalled();
  });

  it('con otro texto dice que cambió y pide el resumen nuevo', async () => {
    getCourseSource.mockResolvedValue(fuenteArchivo('Arqueo de caja'));
    await conArchivo('Arqueo de caja y cierre de turno');

    const resultado = await releerFuente({ documentId: 'fuente-archivo', courseId: CURSO, redis: redisFalso() as never });

    expect(resultado).toMatchObject({ changed: true, wordCount: 7 });
    expect(encolarResumen).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'fuente-archivo', contentHash: computeContentHash('Arqueo de caja y cierre de turno') })
    );
  });

  it('una subida nueva pide su resumen al nacer, cobrado en el curso y no en la empresa de la cabecera', async () => {
    (uploadToS3 as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
    const bytes = await presentacion('Cierre de turno');
    const archivo = new File([bytes], 'cierre.pptx', {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    });

    const subido = await parseAndStoreDocument(
      archivo,
      'org-de-la-cabecera',
      'docente-demo',
      CURSO,
      'conv-fuentes',
      redisFalso() as never
    );

    expect(createChatDocument).toHaveBeenCalledWith(expect.objectContaining({ id: subido.documentId, assetId: 'asset-subido' }));
    // Sin `orgId`: quien sube puede estar parado en la consultora mirando el
    // curso de una empresa cliente; la empresa sale del curso.
    expect(encolarResumen).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: subido.documentId,
        contentHash: computeContentHash('Cierre de turno'),
        consumo: { userId: 'docente-demo', courseId: CURSO }
      })
    );
  });
});
