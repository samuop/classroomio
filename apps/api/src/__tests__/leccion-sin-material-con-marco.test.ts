import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Una lección «desde buenas prácticas» se escribe sabiendo qué dice la empresa.
 *
 * Medido en producción el 2026-11-11: dos lecciones sin material asignado se
 * escribieron sin ver el documento del curso, y salieron contradiciéndolo (una
 * categoría puesta como crítica que el documento deja última, un canal dado por
 * prohibido que el documento permite, roles que la empresa no tiene).
 *
 * Fuentes y lecciones inventadas.
 */

const generateText = vi.fn();

vi.mock('ai', async (original) => ({
  ...(await original<typeof import('ai')>()),
  generateText: (...args: unknown[]) => generateText(...args)
}));

vi.mock('@cio/ai-assistant', async (original) => ({
  ...(await original<typeof import('@cio/ai-assistant')>()),
  createModel: vi.fn(() => ({ modelId: 'modelo-de-prueba' })),
  resolveModelName: vi.fn(() => 'modelo-de-prueba')
}));

vi.mock('@api/services/agent/usage', () => ({
  recordTokenUsage: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@cio/db/queries/agent/chat-document', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/agent/chat-document')>()),
  listCourseSources: vi.fn()
}));

// El texto de la fuente sale de la fila: sin caché de por medio.
vi.mock('@api/services/agent/document', () => ({
  getCourseSourceText: vi.fn(async () => null)
}));

const { listCourseSources } = await import('@cio/db/queries/agent/chat-document');
const { MARCO_MAXIMO_CHARS, REGLAS_DEL_MARCO, SIN_MATERIAL_ASIGNADO, SIN_MATERIAL_CON_MARCO, armarMarcoDeLaOrganizacion, crearEscritorDeLecciones } =
  await import('@api/services/agent/lesson-writer');

const INFORME = {
  id: 'fuente-informe',
  fileName: 'Informe de la ferretería.docx',
  text:
    'Prioridades de reposición\n\n' +
    'Tornillería\tPrioridad crítica. Evitar faltantes.\n\n' +
    'Herrajes\tSe reponen a pedido: hay reemplazo.\n\n' +
    'Las diferencias de stock se informan al encargado de depósito en el momento. Pueden informarse en privado.'
};

const escribir = async (sources: string[]) => {
  generateText.mockResolvedValue({ text: '<lesson><p>Una lección.</p></lesson>', finishReason: 'stop', usage: {} });

  const escrita = await crearEscritorDeLecciones({
    orgId: 'org',
    userId: 'usuario',
    courseId: 'curso',
    redis: null as never,
    providerConfig: { provider: 'google', apiKey: 'x' } as never,
    courseTitle: 'Depósito de la ferretería'
  })({ lessonTitle: 'Ordenar las prioridades de reposición', brief: 'Desde buenas prácticas: prioridades y stock de seguridad.', locale: 'es', sources });

  return { escrita, prompt: (generateText.mock.calls.at(-1)![0] as { prompt: string }).prompt };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('una lección sin material asignado, en un curso que tiene fuentes', () => {
  it('recibe lo que dicen los documentos de la empresa, con la orden de no contradecirlos', async () => {
    vi.mocked(listCourseSources).mockResolvedValue([INFORME] as never);

    const { prompt } = await escribir([]);

    expect(prompt).toContain(SIN_MATERIAL_CON_MARCO);
    expect(prompt).toContain(REGLAS_DEL_MARCO);
    expect(prompt).toContain('Herrajes\tSe reponen a pedido: hay reemplazo.');
    expect(prompt).toContain('Pueden informarse en privado.');
    expect(prompt).toMatch(/Never contradict them/);
    // Ya no se le dice que escriba a ciegas.
    expect(prompt).not.toContain(SIN_MATERIAL_ASIGNADO);
  });

  it('pero la lección NO queda sellada como escrita desde esa fuente', async () => {
    vi.mocked(listCourseSources).mockResolvedValue([INFORME] as never);

    const { escrita } = await escribir([]);

    expect(escrita).toMatchObject({ material: [], fuentesUsadas: [] });
  });

  it('con fuentes largas ve sólo los pasajes que tocan su tema, marcados como recorte', async () => {
    const relleno = Array.from({ length: 900 }, (_, i) => `Renglón ${i} del reglamento interno sobre licencias y vacaciones del personal administrativo.`).join('\n\n');
    const larga = { ...INFORME, text: `${relleno}\n\n${INFORME.text}\n\n${relleno}` };

    expect(larga.text.length).toBeGreaterThan(MARCO_MAXIMO_CHARS);
    vi.mocked(listCourseSources).mockResolvedValue([larga] as never);

    const { prompt } = await escribir([]);

    expect(prompt).toContain(REGLAS_DEL_MARCO);
    expect(prompt).toContain('Prioridades de reposición');
    expect(prompt).toContain('an excerpt: the rest of the document was not shown to you');
    expect(prompt).not.toContain('Renglón 450 del reglamento');
    expect(prompt.length).toBeLessThan(MARCO_MAXIMO_CHARS);
  });
});

describe('lo que no cambia', () => {
  it('un curso sin fuentes: la lección se escribe desde el conocimiento general, como antes', async () => {
    vi.mocked(listCourseSources).mockResolvedValue([] as never);

    const { prompt } = await escribir([]);

    expect(prompt).toContain(SIN_MATERIAL_ASIGNADO);
    expect(prompt).not.toContain(REGLAS_DEL_MARCO);
  });

  it('una lección con su fuente asignada: recibe el material, sin el marco', async () => {
    vi.mocked(listCourseSources).mockResolvedValue([INFORME] as never);

    const { escrita, prompt } = await escribir([INFORME.fileName]);

    expect(prompt).toContain(`--- Source: ${INFORME.fileName} ---`);
    expect(prompt).not.toContain(REGLAS_DEL_MARCO);
    expect(prompt).not.toContain(SIN_MATERIAL_CON_MARCO);
    expect(escrita).toMatchObject({ fuentesUsadas: [INFORME.fileName] });
  });
});

describe('el marco', () => {
  it('fuentes cortas van enteras; sin texto, o largas y sin nada del tema, no hay marco', () => {
    expect(armarMarcoDeLaOrganizacion([INFORME], 'prioridades de reposición')).toContain(`--- ${INFORME.fileName} (complete) ---`);
    expect(armarMarcoDeLaOrganizacion([{ ...INFORME, text: '   ' }], 'prioridades de reposición')).toBeUndefined();
    expect(armarMarcoDeLaOrganizacion([], 'prioridades de reposición')).toBeUndefined();

    const ajena = { ...INFORME, text: 'Reglamento de licencias y vacaciones del personal administrativo de la casa central.\n\n'.repeat(900) };

    expect(armarMarcoDeLaOrganizacion([ajena], 'Ordenar las prioridades de reposición')).toBeUndefined();
  });
});
