import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * La portada del curso, sin Unsplash.
 *
 * La búsqueda de fotos de Unsplash no tenía clave en producción: la del
 * asistente devolvía `updated: true` sin imagen (el modelo la pidió tres veces y
 * terminó escribiendo de memoria la dirección de una foto) y la del panel le
 * mostraba un error a la docente cada vez que abría el cargador. Se sacó el
 * 2026-09-30. Una portada es ahora una dirección explícita: la que sube la
 * docente o la que dibuja el asistente con `generate_image`.
 */

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
const { evaluateCourseGoLiveReadiness } = await import('@api/services/course/go-live-readiness');
const { updateCourseLandingPageParam } = await import('@api/services/agent/agent-tool-schemas');
const { ZCourseLandingPageUpdate } = await import('@cio/utils/validation/course');
const { ZCourseImportDraftPublishBase } = await import('@cio/utils/validation/course-import');
const { buildTeacherSystemPrompt } = await import('../../../../packages/ai-assistant/src/prompt/teacher');

const DIBUJADA = 'https://medios.ejemplo.test/media/courses/curso/generated/portada.jpg';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('la portada, sólo con una dirección explícita', () => {
  it('con una dirección, la pone, y no sale a buscar nada', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const resultado = await updateCourseLandingPageService('curso', { imageUrl: DIBUJADA });

    expect(resultado.bannerImageUrl).toBe(DIBUJADA);
    expect(vi.mocked(updateCourse).mock.calls[0][1]).toMatchObject({ logo: DIBUJADA, bannerImage: DIBUJADA });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sin dirección no toca la imagen, y tampoco sale a buscar', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const resultado = await updateCourseLandingPageService('curso', { title: 'Caja del almacén' });

    expect(resultado.bannerImageUrl).toBeNull();
    expect(vi.mocked(updateCourse).mock.calls[0][1]).not.toHaveProperty('logo');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('un cliente viejo que manda los campos de búsqueda no recibe error: se ignoran', () => {
    expect(ZCourseLandingPageUpdate.parse({ title: 'Caja', generateImage: true, imageQuery: 'caja registradora' })).toEqual({
      title: 'Caja'
    });
    expect(
      ZCourseImportDraftPublishBase.parse({ bannerImageUrl: DIBUJADA, bannerImageQuery: 'caja', generateBannerImage: true })
    ).toEqual({ bannerImageUrl: DIBUJADA });
  });

  it('el chequeo de publicación sigue pidiendo la portada, sin sugerir buscarla', () => {
    const chequeo = evaluateCourseGoLiveReadiness({
      course: { id: 'curso', title: 'Caja', description: '', overview: '', slug: 'caja', logo: '', bannerImage: '', metadata: {} } as never,
      contentItems: [],
      organization: null
    });

    expect(chequeo.blockers.map((b) => b.code)).toContain('LANDING_IMAGE_MISSING');
    expect(chequeo.suggestedFixes.landingPage ?? {}).not.toHaveProperty('generateImage');
  });
});

describe('el asistente dibuja la portada que falta', () => {
  it('la herramienta no ofrece buscar, y la dirección dice de dónde sale', () => {
    const campos = Object.keys(updateCourseLandingPageParam.shape);

    expect(campos).not.toContain('generateImage');
    expect(campos).not.toContain('imageQuery');
    expect(updateCourseLandingPageParam.shape.imageUrl.description).toContain('draw one with generate_image');
    expect(updateCourseLandingPageParam.shape.imageUrl.description).toContain('Never one written from memory');
  });

  it('el prompt del constructor lo manda a generate_image, y no nombra a Unsplash', () => {
    const prompt = buildTeacherSystemPrompt(
      { orgId: 'o', courseId: 'c', courseTitle: 'C', userId: 'u', role: 'teacher' as never, locale: 'es' },
      { mode: 'build' }
    );

    expect(prompt).toContain('draw one with `generate_image`');
    expect(prompt).toContain('never write an image URL yourself');
    expect(prompt).not.toMatch(/unsplash/i);
    expect(prompt).not.toContain('generateImage');
  });
});
