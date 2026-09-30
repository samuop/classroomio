import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Pedir una foto de portada que no se consigue.
 *
 * Medido en producción el 2026-09-30: la búsqueda de Unsplash no andaba (la
 * del panel tampoco), el asistente la pidió tres veces, leyó `updated: true`
 * cada vez sin ninguna imagen, y terminó escribiendo de memoria la dirección de
 * una foto. Cada falla era un `null` callado.
 */

const entorno = vi.hoisted(() => ({ env: { UNSPLASH_API_KEY: 'clave-de-prueba' as string | undefined } }));

vi.mock('@api/config/env', () => entorno);

vi.mock('isomorphic-dompurify', () => ({
  default: new Proxy({}, { get: () => (valor: unknown) => valor })
}));

vi.mock('@api/utils/tinybird', () => ({
  trackAgentEvent: vi.fn(),
  AgentEvent: new Proxy({}, { get: (_, clave) => String(clave) })
}));

vi.mock('@cio/db/queries/course', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/course')>()),
  getCourseById: vi.fn(async () => [{ id: 'curso', title: 'Caja del almacén', slug: 'caja-del-almacen', metadata: null, logo: null }]),
  isCourseSlugTaken: vi.fn(async () => false),
  updateCourseSlug: vi.fn()
}));

vi.mock('@cio/db/queries/tag', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/tag')>()),
  getCourseOrganizationId: vi.fn(async () => 'empresa')
}));

vi.mock('@cio/db/queries/organization', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/organization')>()),
  getOrganizationById: vi.fn(async () => ({ siteName: 'almacen-demo', customDomain: null, isCustomDomainVerified: false }))
}));

vi.mock('@api/services/course/course', async (original) => ({
  ...(await original<typeof import('@api/services/course/course')>()),
  updateCourse: vi.fn(async (id: string, datos: { logo?: string }) => ({
    id,
    title: 'Caja del almacén',
    description: '',
    slug: 'caja-del-almacen',
    logo: datos.logo ?? null
  }))
}));

const { updateCourseLandingPageService } = await import('@api/services/course/landing-page');
const { updateCourse } = await import('@api/services/course/course');
const { buildAgentTools } = await import('@api/services/agent/chat-tools');
const { updateCourseLandingPageParam } = await import('@api/services/agent/agent-tool-schemas');
const { buildTeacherSystemPrompt } = await import('../../../../packages/ai-assistant/src/prompt/teacher');

const respuesta = (status: number, cuerpo: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => cuerpo }) as Response;

const FOTO = 'https://images.unsplash.com/photo-caja?w=1080';

beforeEach(() => {
  entorno.env.UNSPLASH_API_KEY = 'clave-de-prueba';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('la foto de portada que se pidió buscar', () => {
  it('sin la clave de la búsqueda, dice que no está configurada y no toca la imagen', async () => {
    entorno.env.UNSPLASH_API_KEY = undefined;
    vi.stubGlobal('fetch', vi.fn());

    const resultado = await updateCourseLandingPageService('curso', { generateImage: true });

    expect(resultado.imageNotSet).toBe('the image search is not configured on this server');
    expect(resultado.bannerImageUrl).toBeNull();
    expect(vi.mocked(updateCourse).mock.calls[0][1]).not.toHaveProperty('logo');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('si la búsqueda falla, dice con qué código', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(401, {})));

    const resultado = await updateCourseLandingPageService('curso', { generateImage: true, imageQuery: 'caja registradora' });

    expect(resultado.imageNotSet).toBe('the image search failed (HTTP 401)');
    expect(resultado.bannerImageUrl).toBeNull();
  });

  it('si no encuentra nada, dice qué buscó', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(200, { results: [] })));

    const resultado = await updateCourseLandingPageService('curso', { imageQuery: 'caja registradora' });

    expect(resultado.imageNotSet).toBe('the image search found no photo for "caja registradora"');
  });

  it('con una foto, la pone y no hay nada que avisar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(200, { results: [{ urls: { regular: FOTO } }] })));

    const resultado = await updateCourseLandingPageService('curso', { generateImage: true });

    expect(resultado.bannerImageUrl).toBe(FOTO);
    expect(resultado).not.toHaveProperty('imageNotSet');
    expect(vi.mocked(updateCourse).mock.calls[0][1]).toMatchObject({ logo: FOTO, bannerImage: FOTO });
  });

  it('sin pedir una foto, no hay nada que avisar', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const resultado = await updateCourseLandingPageService('curso', { title: 'Caja del almacén' });

    expect(resultado).not.toHaveProperty('imageNotSet');
  });
});

describe('la herramienta del asistente', () => {
  type Herramienta = { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> };
  const portada = () =>
    (buildAgentTools('empresa', 'docente', 'curso', [], { locale: 'es' }) as Record<string, Herramienta>).update_course_landing_page;

  it('cuando no se puso la imagen lo dice, y manda a no escribir una dirección de memoria', async () => {
    entorno.env.UNSPLASH_API_KEY = undefined;

    const resultado = await portada().execute({ generateImage: true }, { toolCallId: 'llamada', messages: [] });

    expect(resultado.updated).toBe(true);
    expect(resultado.bannerImageUrl).toBeNull();
    expect(String(resultado.imageNotSet)).toContain('No banner image was set: the image search is not configured on this server.');
    expect(String(resultado.imageNotSet)).toContain('Never write an image URL yourself');
    expect(String(resultado.imageNotSet)).toContain('generate_image');
  });

  it('el campo de la dirección le dice de dónde puede salir', () => {
    expect(updateCourseLandingPageParam.shape.imageUrl.description).toContain('Never one written from memory');
  });

  it('el prompt del constructor sabe que un «no se puso» no se arregla pidiéndolo de nuevo', () => {
    const prompt = buildTeacherSystemPrompt(
      { orgId: 'o', courseId: 'c', courseTitle: 'C', userId: 'u', role: 'teacher' as never, locale: 'es' },
      { mode: 'build' }
    );

    expect(prompt).toContain(
      'If the result carries `imageNotSet`, no image was set and trying again will not help: follow what it says, and never write an image URL yourself.'
    );
  });
});
