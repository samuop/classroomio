/**
 * Los resúmenes de las fuentes, fuera del camino del chat.
 *
 * Medido en producción: el índice de fuentes resumía cada fuente con el modelo
 * ANTES de contestar, de a una. Con 11 fuentes fueron 38 s sin mandar ni las
 * cabeceras, y el navegador cortó a los 30 con «Request timeout» justo al
 * aprobar el plan; con 7, otra docente, 31 s y el mismo error. Además los
 * resúmenes duraban una hora y no se cobraban.
 *
 * Lo que se fija acá:
 *   1. Nadie espera un resumen: ni el índice ni `getDocumentSummary`, aunque el
 *      modelo no conteste nunca.
 *   2. La cola: de a cuatro, sin repetir lo que ya está hecho o en curso —en
 *      este proceso o en otro (el candado de Redis)—, 30 días por versión del
 *      texto.
 *   3. Se cobra, y a quien corresponde aunque quien lo pidió no lo sepa.
 *   4. Un error del segundo plano no rompe nada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resumirDocumento = vi.fn();
const recordTokenUsage = vi.fn();
const getCourseOrganizationId = vi.fn();
const duenoDeFuente = vi.fn();
const listCourseSources = vi.fn();

vi.mock('@api/services/agent/summarize', async () => {
  const real = await vi.importActual<typeof import('@api/services/agent/summarize')>('@api/services/agent/summarize');

  return {
    MAX_DOCUMENT_SUMMARY_INPUT_CHARS: real.MAX_DOCUMENT_SUMMARY_INPUT_CHARS,
    resumirDocumento: (...args: unknown[]) => resumirDocumento(...args)
  };
});

vi.mock('@api/services/agent/usage', () => ({
  recordTokenUsage: (...args: unknown[]) => recordTokenUsage(...args)
}));

vi.mock('@cio/db/queries/tag', () => ({
  getCourseOrganizationId: (...args: unknown[]) => getCourseOrganizationId(...args)
}));

vi.mock('@cio/db/queries/agent/fuentes-del-curso', () => ({
  duenoDeFuente: (...args: unknown[]) => duenoDeFuente(...args),
  buscarFuentePorDireccion: vi.fn(),
  reemplazarFuenteWeb: vi.fn()
}));

vi.mock('@cio/db/queries/agent/chat-document', () => ({
  listCourseSources: (...args: unknown[]) => listCourseSources(...args)
}));

const {
  claveDeResumen,
  encolarResumen,
  esperarResumenesEnCurso,
  RESUMENES_A_LA_VEZ,
  TTL_RESUMEN_SEC
} = await import('@api/services/agent/resumenes-de-fuentes');
const { MAX_DOCUMENT_SUMMARY_INPUT_CHARS } = await import('@api/services/agent/summarize');
const { buildSourceIndex } = await import('@api/services/agent/source-index');
const { getDocumentSummary } = await import('@api/services/agent/document');
const { computeContentHash } = await import('@api/utils/redis/key-generators');

/** Redis de mentira con lo justo: get, mGet, set con NX y EX, del. */
function redisFalso(inicial: Record<string, string> = {}) {
  const datos = new Map(Object.entries(inicial));
  const vencimientos = new Map<string, number>();

  const cliente = {
    get: vi.fn(async (clave: string) => datos.get(clave) ?? null),
    mGet: vi.fn(async (claves: string[]) => claves.map((clave) => datos.get(clave) ?? null)),
    set: vi.fn(async (clave: string, valor: string, opciones?: { NX?: boolean; EX?: number }) => {
      if (opciones?.NX && datos.has(clave)) return null;
      datos.set(clave, valor);
      if (opciones?.EX) vencimientos.set(clave, opciones.EX);
      return 'OK';
    }),
    del: vi.fn(async (clave: string) => (datos.delete(clave) ? 1 : 0))
  };

  return { datos, vencimientos, cliente: cliente as never };
}

/** Una promesa que el test resuelve cuando quiere: así se ve cuántas corren a la vez. */
function diferida<T>() {
  let resolver!: (valor: T) => void;
  let rechazar!: (error: unknown) => void;
  const promesa = new Promise<T>((res, rej) => {
    resolver = res;
    rechazar = rej;
  });

  return { promesa, resolver, rechazar };
}

const USO = {
  inputTokens: 1200,
  outputTokens: 150,
  totalTokens: 1350,
  inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 0, noCacheTokens: 1200 },
  outputTokenDetails: { reasoningTokens: 40, textTokens: 110 }
};

function resumen(texto: string) {
  return { texto, usage: USO, modelName: 'modelo-de-prueba', provider: 'google' };
}

const esperarUnTurno = () => new Promise((resolve) => setTimeout(resolve, 0));

let serie = 0;
/** Un id de documento distinto por test: la cola es del proceso y no se reinicia entre tests. */
const nuevoId = (nombre: string) => `${nombre}-${++serie}`;

beforeEach(() => {
  vi.clearAllMocks();
  resumirDocumento.mockImplementation(async (texto: string) => resumen(`Resumen de: ${texto.slice(0, 20)}`));
  recordTokenUsage.mockResolvedValue(undefined);
  getCourseOrganizationId.mockResolvedValue('org-del-curso');
  duenoDeFuente.mockResolvedValue(null);
});

afterEach(async () => {
  await esperarResumenesEnCurso();
});

describe('la cola de resúmenes', () => {
  it('resume de a cuatro, no las once a la vez', async () => {
    const redis = redisFalso();
    const pendientes: Array<ReturnType<typeof diferida<ReturnType<typeof resumen>>>> = [];
    let enCurso = 0;
    let maximo = 0;

    resumirDocumento.mockImplementation(async () => {
      enCurso += 1;
      maximo = Math.max(maximo, enCurso);
      const d = diferida<ReturnType<typeof resumen>>();
      pendientes.push(d);
      const r = await d.promesa;
      enCurso -= 1;
      return r;
    });

    for (let i = 0; i < 11; i++) {
      const id = nuevoId('fuente');
      encolarResumen({ documentId: id, contentHash: computeContentHash(id), texto: `Texto de ${id}`, redis: redis.cliente });
    }

    try {
      await vi.waitFor(() => expect(resumirDocumento.mock.calls.length).toBeGreaterThan(0));

      // Mientras las primeras cuatro no terminan, no arranca ninguna más.
      await esperarUnTurno();
      expect(resumirDocumento).toHaveBeenCalledTimes(4);

      for (let hechas = 0; hechas < 11; hechas++) {
        await vi.waitFor(() => expect(pendientes.length).toBeGreaterThan(hechas));
        pendientes[hechas].resolver(resumen(`resumen ${hechas}`));
      }

      await esperarResumenesEnCurso();

      expect(resumirDocumento).toHaveBeenCalledTimes(11);
      expect(maximo).toBe(RESUMENES_A_LA_VEZ);
    } finally {
      // Si algo falló a mitad de camino, que la cola no quede trabada para los
      // tests que siguen: se sueltan todas las que hayan quedado esperando.
      resumirDocumento.mockImplementation(async () => resumen('suelto'));
      pendientes.forEach((d) => d.resolver(resumen('suelto')));
      await esperarResumenesEnCurso();
    }
  });

  it('guarda el resumen 30 días, con el hash del texto en la clave, y suelta el candado', async () => {
    const redis = redisFalso();
    const id = nuevoId('manual');
    const hash = computeContentHash('Manual de caja');

    encolarResumen({ documentId: id, contentHash: hash, texto: 'Manual de caja', redis: redis.cliente });
    await esperarResumenesEnCurso();

    const clave = claveDeResumen(id, hash);

    expect(redis.datos.get(clave)).toBe('Resumen de: Manual de caja');
    expect(redis.vencimientos.get(clave)).toBe(TTL_RESUMEN_SEC);
    expect(TTL_RESUMEN_SEC).toBe(30 * 24 * 3600);
    // Si el texto cambia, la clave también: un resumen nunca describe otra versión.
    expect(claveDeResumen(id, computeContentHash('Manual de caja, segunda edición'))).not.toBe(clave);
    expect([...redis.datos.keys()].some((k) => k.includes(':lock:'))).toBe(false);
  });

  it('de una fuente enorme, la cola guarda sólo lo que el resumen lee', async () => {
    // Una fuente puede tener 500 KB; con la cola llena eran cientos de MB
    // retenidos. El resumen igual lee sólo el principio.
    const redis = redisFalso();
    const enorme = 'palabra '.repeat(50_000);

    encolarResumen({ documentId: nuevoId('enorme'), contentHash: computeContentHash(enorme), texto: enorme, redis: redis.cliente });
    await esperarResumenesEnCurso();

    const [leido] = resumirDocumento.mock.calls[0] as [string];
    expect(leido.length).toBe(MAX_DOCUMENT_SUMMARY_INPUT_CHARS + 1);
    expect(enorme.startsWith(leido)).toBe(true);
  });

  it('lo que ya está resumido no se vuelve a pagar', async () => {
    const id = nuevoId('hecho');
    const hash = computeContentHash('texto');
    const redis = redisFalso({ [claveDeResumen(id, hash)]: 'ya estaba' });

    encolarResumen({ documentId: id, contentHash: hash, texto: 'texto', redis: redis.cliente });
    await esperarResumenesEnCurso();

    expect(resumirDocumento).not.toHaveBeenCalled();
  });

  it('dos pedidos del mismo documento en el mismo proceso son una sola llamada', async () => {
    const redis = redisFalso();
    const id = nuevoId('doble');
    const hash = computeContentHash('texto');

    encolarResumen({ documentId: id, contentHash: hash, texto: 'texto', redis: redis.cliente });
    encolarResumen({ documentId: id, contentHash: hash, texto: 'texto', redis: redis.cliente });
    await esperarResumenesEnCurso();

    expect(resumirDocumento).toHaveBeenCalledTimes(1);
  });

  it('si otro proceso lo está generando, el candado lo frena', async () => {
    // Medido: el reintento de las 15:50 resumió de nuevo las fuentes que el
    // pedido abandonado estaba resumiendo al mismo tiempo.
    const id = nuevoId('ajeno');
    const hash = computeContentHash('texto');
    const redis = redisFalso();

    await redis.cliente.set(`agent:source-summary:lock:${id}:${hash.slice(0, 16)}`, '1', { NX: true, EX: 120 });

    encolarResumen({ documentId: id, contentHash: hash, texto: 'texto', redis: redis.cliente });
    await esperarResumenesEnCurso();

    expect(resumirDocumento).not.toHaveBeenCalled();
  });

  it('un error del modelo queda en el log y no rompe nada', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    resumirDocumento.mockRejectedValue(new Error('el proveedor no contestó'));
    const redis = redisFalso();

    expect(() =>
      encolarResumen({
        documentId: nuevoId('falla'),
        contentHash: computeContentHash('x'),
        texto: 'x',
        redis: redis.cliente
      })
    ).not.toThrow();
    await esperarResumenesEnCurso();

    expect(error).toHaveBeenCalledWith(expect.stringContaining('[source-summary]'), expect.any(Error));
    error.mockRestore();
  });
});

describe('quién paga el resumen', () => {
  it('se cobra a quien lo pidió, con el modelo que lo atendió', async () => {
    const redis = redisFalso();

    encolarResumen({
      documentId: nuevoId('cobro'),
      contentHash: computeContentHash('texto'),
      texto: 'texto',
      redis: redis.cliente,
      consumo: { orgId: 'org-demo', userId: 'docente-demo', courseId: 'curso-demo' }
    });
    await esperarResumenesEnCurso();

    expect(recordTokenUsage).toHaveBeenCalledWith(
      'org-demo',
      'docente-demo',
      'curso-demo',
      {
        promptTokens: 1200,
        completionTokens: 150,
        totalTokens: 1350,
        reasoningTokens: 40,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined
      },
      'modelo-de-prueba',
      'google'
    );
  });

  it('sin empresa, la del curso', async () => {
    const redis = redisFalso();

    encolarResumen({
      documentId: nuevoId('sin-empresa'),
      contentHash: computeContentHash('texto'),
      texto: 'texto',
      redis: redis.cliente,
      consumo: { userId: 'docente-demo', courseId: 'curso-demo' }
    });
    await esperarResumenesEnCurso();

    expect(getCourseOrganizationId).toHaveBeenCalledWith('curso-demo');
    expect(recordTokenUsage.mock.calls[0][0]).toBe('org-del-curso');
  });

  it('sin saber de quién es, a quien subió la fuente, en su curso', async () => {
    // El paquete de fuentes y el contexto de documentos piden resúmenes sin
    // conocer al usuario; la llamada al proveedor se paga igual.
    duenoDeFuente.mockResolvedValue({ courseId: 'curso-de-la-fuente', userId: 'quien-la-subio' });
    const redis = redisFalso();
    const id = nuevoId('huerfano');

    encolarResumen({ documentId: id, contentHash: computeContentHash('texto'), texto: 'texto', redis: redis.cliente });
    await esperarResumenesEnCurso();

    expect(duenoDeFuente).toHaveBeenCalledWith(id);
    expect(recordTokenUsage.mock.calls[0].slice(0, 3)).toEqual(['org-del-curso', 'quien-la-subio', 'curso-de-la-fuente']);
  });

  it('un borrador sin fila se resume igual, pero no hay a quién cobrárselo', async () => {
    const redis = redisFalso();
    const id = nuevoId('borrador');
    const hash = computeContentHash('texto');

    encolarResumen({ documentId: id, contentHash: hash, texto: 'texto', redis: redis.cliente });
    await esperarResumenesEnCurso();

    expect(recordTokenUsage).not.toHaveBeenCalled();
    expect(redis.datos.get(claveDeResumen(id, hash))).toBeTruthy();
  });
});

describe('el índice de fuentes no espera nunca al modelo', () => {
  function fuente(id: string, texto: string, creada: string) {
    return {
      id,
      fileName: `${id}.pdf`,
      text: texto,
      wordCount: texto.split(/\s+/).length,
      pageCount: 3,
      sourceUrl: null,
      userId: 'quien-la-subio',
      createdAt: creada
    };
  }

  it('usa los resúmenes que hay y, para los que faltan, el principio del texto', async () => {
    const conResumen = fuente(nuevoId('con'), 'Procedimiento de apertura de caja y arqueo diario del turno mañana.', '2026-01-01');
    const sinResumen = fuente(
      nuevoId('sin'),
      'Inicio | Productos\nEl arqueo compara el efectivo contado con lo que registró el sistema durante el turno.',
      '2026-01-02'
    );
    listCourseSources.mockResolvedValue([sinResumen, conResumen]);

    const redis = redisFalso({
      [claveDeResumen(conResumen.id, computeContentHash(conResumen.text))]: 'Cómo abrir la caja y hacer el arqueo.'
    });

    // El modelo no contesta nunca: si el índice lo esperara, no volvería. Se le
    // da un segundo, que es muchísimo para algo que no espera a nadie.
    const colgado = diferida<ReturnType<typeof resumen>>();
    resumirDocumento.mockReturnValue(colgado.promesa);

    try {
      const indice = await Promise.race([
        buildSourceIndex({ courseId: 'curso-demo', redis: redis.cliente, orgId: 'org-demo', userId: 'docente-demo' }),
        new Promise<never>((_, rechazar) => setTimeout(() => rechazar(new Error('el índice esperó al modelo')), 1_000))
      ]);

      expect(indice.text).toContain(`"${conResumen.id}.pdf"`);
      expect(indice.text).toContain('About: Cómo abrir la caja y hacer el arqueo.');
      expect(indice.text).toContain('Begins: El arqueo compara el efectivo contado');
      expect(indice.entries.find((e) => e.id === sinResumen.id)?.resumen).toBeNull();

      // Un solo viaje a Redis para todos los resúmenes.
      expect((redis.cliente as unknown as { mGet: ReturnType<typeof vi.fn> }).mGet).toHaveBeenCalledTimes(1);

      // Y el que falta se pide aparte, cobrado a quien está trabajando.
      await vi.waitFor(() => expect(resumirDocumento).toHaveBeenCalledTimes(1));
      colgado.resolver(resumen('El arqueo, paso a paso.'));
      await esperarResumenesEnCurso();

      expect(recordTokenUsage.mock.calls[0].slice(0, 3)).toEqual(['org-demo', 'docente-demo', 'curso-demo']);
      expect(redis.datos.get(claveDeResumen(sinResumen.id, computeContentHash(sinResumen.text)))).toBe(
        'El arqueo, paso a paso.'
      );
    } finally {
      // Que un fallo acá no deje la cola trabada para los tests que siguen.
      colgado.resolver(resumen('suelto'));
    }
  });

  it('sin Redis sale igual, con los extractos', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    listCourseSources.mockResolvedValue([fuente(nuevoId('sin-redis'), 'Un texto de prueba con varias palabras.', '2026-01-01')]);
    const redis = redisFalso();
    (redis.cliente as unknown as { mGet: ReturnType<typeof vi.fn> }).mGet.mockRejectedValue(new Error('redis caído'));
    (redis.cliente as unknown as { get: ReturnType<typeof vi.fn> }).get.mockRejectedValue(new Error('redis caído'));

    const indice = await buildSourceIndex({ courseId: 'curso-demo', redis: redis.cliente });

    expect(indice.entries).toHaveLength(1);
    expect(indice.text).toContain('Begins: Un texto de prueba');
    await esperarResumenesEnCurso();
    error.mockRestore();
  });
});

describe('getDocumentSummary tampoco espera', () => {
  it('devuelve el resumen guardado para ESTA versión del texto', async () => {
    const id = nuevoId('doc');
    const redis = redisFalso({ [claveDeResumen(id, computeContentHash('texto actual'))]: 'resumen actual' });

    expect(await getDocumentSummary(id, redis.cliente, async () => 'texto actual')).toBe('resumen actual');
    expect(resumirDocumento).not.toHaveBeenCalled();
  });

  it('sin resumen contesta ya con el principio del texto, y lo pide aparte', async () => {
    const colgado = diferida<ReturnType<typeof resumen>>();
    resumirDocumento.mockReturnValue(colgado.promesa);
    const id = nuevoId('doc');
    const redis = redisFalso();
    const largo = `Principio del documento. ${'relleno '.repeat(400)}`;

    try {
      const devuelto = await Promise.race([
        getDocumentSummary(id, redis.cliente, async () => largo),
        new Promise<never>((_, rechazar) => setTimeout(() => rechazar(new Error('esperó al modelo')), 1_000))
      ]);

      expect(devuelto?.startsWith('Principio del documento.')).toBe(true);
      expect(devuelto!.length).toBeLessThan(largo.length);

      await vi.waitFor(() => expect(resumirDocumento).toHaveBeenCalledTimes(1));
      colgado.resolver(resumen('Resumen del documento.'));
      await esperarResumenesEnCurso();
    } finally {
      colgado.resolver(resumen('suelto'));
    }
  });

  it('quien no puede leer el documento tampoco recibe su resumen', async () => {
    const id = nuevoId('ajeno');
    const redis = redisFalso({ [claveDeResumen(id, computeContentHash('texto'))]: 'resumen de otro' });

    expect(await getDocumentSummary(id, redis.cliente, async () => null)).toBeNull();
  });
});
