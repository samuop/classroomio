import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';

import SourcesPage from './sources-page.svelte';
import { t } from '$lib/utils/functions/translations';
import { sidePanel } from '$features/side-panel';
import { AI_ASSISTANT_PANEL_ID, chatDraft, clearChatDraft } from '../utils/store';
import type { CourseSource } from '../utils/types';

/**
 * La pantalla de Fuentes (contrato C4 con la API).
 *
 * ── Qué se fija ──────────────────────────────────────────────────────────────
 *
 * 1. El botón ↻ dice «Volver a leer esta fuente» y ahora lo hace: «Fuente
 *    actualizada» sólo si el texto cambió. Antes mostraba ese mensaje siempre,
 *    sin haber releído nada.
 * 2. Una página que pide iniciar sesión se explica con su texto (medido: una
 *    planilla privada entró como fuente con la pantalla de login de Google).
 * 3. Una fuente agregada con un plan armado avisa que el plan no la usa, y el
 *    botón abre el chat con el pedido escrito.
 *
 * Lo que se reemplaza es la capa de red (las dos APIs, el aviso del plan y los
 * carteles): el cliente de la API necesita el build de la API.
 */

const falso = vi.hoisted(() => ({
  sourcesApi: {
    sources: [] as unknown[],
    isLoading: false,
    reconciling: false,
    isAddingUrl: false,
    error: null as string | null,
    deletingId: null as string | null,
    refreshingId: null as string | null,
    cacheStatuses: {} as Record<string, unknown>,
    listSources: vi.fn(),
    loadCacheStatuses: vi.fn(),
    reconcileSources: vi.fn(),
    addUrlSource: vi.fn(),
    releerFuente: vi.fn(),
    deleteSource: vi.fn()
  },
  aiAssistantApi: { error: null as string | null, research: vi.fn(), uploadSourceDocument: vi.fn() },
  snackbar: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  leerEstadoDelPlanDelCurso: vi.fn()
}));

vi.mock('$features/ai-assistant/api/sources.svelte', () => ({ sourcesApi: falso.sourcesApi }));
vi.mock('$features/ai-assistant/api/ai-assistant.svelte', () => ({ aiAssistantApi: falso.aiAssistantApi }));
vi.mock('$features/ai-assistant/api/plan-del-curso', () => ({
  leerEstadoDelPlanDelCurso: falso.leerEstadoDelPlanDelCurso
}));
vi.mock('$features/ui/snackbar/store', () => ({ snackbar: falso.snackbar }));

const texto = (clave: string, valores?: Record<string, unknown>) => get(t)(clave, valores);

const MANUAL: CourseSource = {
  id: 'src-1',
  conversationId: 'conv-1',
  courseId: 'curso-1',
  assetId: 'asset-1',
  sourceUrl: null,
  downloadUrl: null,
  fileName: 'Manual de caja.pdf',
  mimeType: 'application/pdf',
  wordCount: 4200,
  pageCount: 18,
  cacheEligibility: 'cache',
  createdAt: '2026-09-01T10:00:00.000Z'
};

const PLANILLA: CourseSource = {
  ...MANUAL,
  id: 'src-2',
  assetId: null,
  sourceUrl: 'https://docs.example/planilla',
  fileName: 'Planilla de stock (docs.example)',
  mimeType: 'text/markdown'
};

const cuerpoDeError = (code: string) => JSON.stringify({ success: false, error: 'texto del servidor', code });

beforeEach(() => {
  vi.clearAllMocks();
  falso.sourcesApi.sources = [MANUAL];
  falso.sourcesApi.error = null;
  falso.sourcesApi.listSources.mockResolvedValue(undefined);
  falso.sourcesApi.loadCacheStatuses.mockResolvedValue(undefined);
  falso.sourcesApi.reconcileSources.mockResolvedValue(null);
  clearChatDraft();
  sidePanel.close();
});

describe('volver a leer una fuente', () => {
  async function releer() {
    render(SourcesPage, { props: { courseId: 'curso-1' } });

    await fireEvent.click(await screen.findByRole('button', { name: texto('course.sources.refresh_cache_aria') }));
  }

  it('relee de verdad, y con texto nuevo dice «Fuente actualizada»', async () => {
    falso.sourcesApi.releerFuente.mockResolvedValue({ changed: true, wordCount: 5100 });

    await releer();

    await waitFor(() =>
      expect(falso.snackbar.success).toHaveBeenCalledWith(texto('course.sources.snackbar_cache_refreshed'))
    );
    expect(falso.sourcesApi.releerFuente).toHaveBeenCalledWith('src-1');
    // La tarjeta muestra palabras y páginas: se vuelve a listar.
    expect(falso.sourcesApi.listSources).toHaveBeenCalledWith('curso-1');
  });

  it('sin cambios dice «La fuente no cambió», no «Fuente actualizada»', async () => {
    falso.sourcesApi.releerFuente.mockResolvedValue({ changed: false, wordCount: 4200 });

    await releer();

    await waitFor(() => expect(falso.snackbar.info).toHaveBeenCalledWith(texto('course.sources.snackbar_reread_unchanged')));
    expect(falso.snackbar.success).not.toHaveBeenCalled();
  });

  it('una página que pide iniciar sesión se explica con su texto', async () => {
    falso.sourcesApi.releerFuente.mockImplementation(async () => {
      falso.sourcesApi.error = cuerpoDeError('SOURCE_NEEDS_LOGIN');
      return null;
    });

    await releer();

    await waitFor(() => expect(falso.snackbar.error).toHaveBeenCalledWith(texto('course.sources.error_needs_login')));
  });

  it('cualquier otro error, el texto genérico', async () => {
    falso.sourcesApi.releerFuente.mockImplementation(async () => {
      falso.sourcesApi.error = cuerpoDeError('SOURCE_FILE_MISSING');
      return null;
    });

    await releer();

    await waitFor(() =>
      expect(falso.snackbar.error).toHaveBeenCalledWith(texto('course.sources.snackbar_cache_refresh_failed'))
    );
  });
});

describe('agregar una página web', () => {
  async function agregarPagina(direccion: string) {
    render(SourcesPage, { props: { courseId: 'curso-1' } });

    await fireEvent.click(screen.getByRole('button', { name: texto('course.sources.upload_cta') }));
    await fireEvent.click(await screen.findByRole('button', { name: texto('course.sources.tab_url') }));
    await fireEvent.input(screen.getByPlaceholderText('https://…'), { target: { value: direccion } });

    const enviar = screen.getAllByRole('button', { name: texto('course.sources.upload_cta') }).at(-1);

    await fireEvent.click(enviar!);
  }

  it('la que pide iniciar sesión se explica con su texto, y no entra', async () => {
    falso.sourcesApi.addUrlSource.mockImplementation(async () => {
      falso.sourcesApi.error = cuerpoDeError('SOURCE_NEEDS_LOGIN');
      return null;
    });

    await agregarPagina('https://docs.example/planilla');

    expect(await screen.findByText(texto('course.sources.error_needs_login'))).toBeInTheDocument();
    expect(falso.snackbar.success).not.toHaveBeenCalled();
  });

  it('la que no tiene texto útil, también', async () => {
    falso.sourcesApi.addUrlSource.mockImplementation(async () => {
      falso.sourcesApi.error = cuerpoDeError('SOURCE_UNREADABLE');
      return null;
    });

    await agregarPagina('https://docs.example/vacia');

    expect(await screen.findByText(texto('course.sources.error_unreadable'))).toBeInTheDocument();
  });

  it('la que entra se avisa como una subida', async () => {
    falso.sourcesApi.addUrlSource.mockResolvedValue({ documentId: 'src-2', fileName: PLANILLA.fileName });
    falso.sourcesApi.listSources.mockImplementation(async () => {
      falso.sourcesApi.sources = [PLANILLA, MANUAL];
    });
    falso.leerEstadoDelPlanDelCurso.mockResolvedValue(null);

    await agregarPagina('https://docs.example/planilla');

    await waitFor(() => expect(falso.snackbar.success).toHaveBeenCalledWith(texto('course.sources.snackbar_uploaded')));
    expect(falso.sourcesApi.addUrlSource).toHaveBeenCalledWith('curso-1', 'https://docs.example/planilla');
  });
});

describe('el curso con todas sus fuentes (tope de 100)', () => {
  async function abrirDialogo(pestana?: string) {
    render(SourcesPage, { props: { courseId: 'curso-1' } });

    await fireEvent.click(screen.getByRole('button', { name: texto('course.sources.upload_cta') }));

    if (pestana) await fireEvent.click(await screen.findByRole('button', { name: texto(pestana) }));
  }

  it('una página de más se explica con su texto, y no entra', async () => {
    falso.sourcesApi.addUrlSource.mockImplementation(async () => {
      falso.sourcesApi.error = cuerpoDeError('SOURCE_LIMIT_REACHED');
      return null;
    });

    await abrirDialogo('course.sources.tab_url');
    await fireEvent.input(screen.getByPlaceholderText('https://…'), { target: { value: 'https://docs.example/otra' } });
    await fireEvent.click(screen.getAllByRole('button', { name: texto('course.sources.upload_cta') }).at(-1)!);

    expect(await screen.findByText(texto('course.sources.error_source_limit'))).toBeInTheDocument();
  });

  it('un archivo de más, también — y ya no dice «No se pudo eliminar la fuente»', async () => {
    falso.aiAssistantApi.uploadSourceDocument.mockImplementation(async () => {
      falso.aiAssistantApi.error = cuerpoDeError('SOURCE_LIMIT_REACHED');
      return null;
    });

    await abrirDialogo();
    const entrada = document.querySelector('input[type="file"]') as HTMLInputElement;
    const archivo = new File(['%PDF-1.4'], 'otro-manual.pdf', { type: 'application/pdf' });
    await fireEvent.change(entrada, { target: { files: [archivo] } });
    await fireEvent.click(screen.getAllByRole('button', { name: texto('course.sources.upload_cta') }).at(-1)!);

    expect(await screen.findByText(texto('course.sources.error_source_limit'))).toBeInTheDocument();
    expect(screen.queryByText(texto('course.sources.snackbar_delete_failed'))).toBeNull();
  });

  it('una investigación que no entró entera dice cuántas páginas quedaron afuera', async () => {
    falso.aiAssistantApi.research.mockResolvedValue({
      queries: ['arqueo de caja'],
      sources: [{ documentId: 'src-9', title: 'Arqueo', url: 'https://docs.example/arqueo', chars: 900 }],
      failedCount: 0,
      leftOutByLimit: 9
    });

    await abrirDialogo('course.sources.tab_research');
    await fireEvent.input(screen.getByPlaceholderText(texto('course.sources.research_placeholder')), {
      target: { value: 'arqueo de caja' }
    });
    await fireEvent.click(screen.getAllByRole('button', { name: texto('course.sources.tab_research') }).at(-1)!);

    await waitFor(() =>
      expect(falso.snackbar.info).toHaveBeenCalledWith(texto('course.sources.research_left_out_by_limit', { count: 9 }))
    );
  });
});

describe('una fuente nueva con un plan ya armado', () => {
  async function agregarConPlan(estado: 'pendiente' | 'construyendo' | 'terminado' | null) {
    falso.sourcesApi.addUrlSource.mockResolvedValue({ documentId: 'src-2', fileName: PLANILLA.fileName });
    falso.sourcesApi.listSources.mockImplementation(async () => {
      falso.sourcesApi.sources = [PLANILLA, MANUAL];
    });
    falso.leerEstadoDelPlanDelCurso.mockResolvedValue(estado);

    render(SourcesPage, { props: { courseId: 'curso-1' } });

    await fireEvent.click(screen.getByRole('button', { name: texto('course.sources.upload_cta') }));
    await fireEvent.click(await screen.findByRole('button', { name: texto('course.sources.tab_url') }));
    await fireEvent.input(screen.getByPlaceholderText('https://…'), { target: { value: 'https://docs.example/planilla' } });
    await fireEvent.click(screen.getAllByRole('button', { name: texto('course.sources.upload_cta') }).at(-1)!);

    await waitFor(() => expect(falso.leerEstadoDelPlanDelCurso).toHaveBeenCalledWith('curso-1'));
  }

  const aviso = () => screen.queryByText(texto('course.sources.plan_notice', { count: 1 }));

  it('con el plan sin aprobar, avisa que no la usa', async () => {
    await agregarConPlan('pendiente');

    await waitFor(() => expect(aviso()).toBeInTheDocument());
  });

  it('con la construcción en curso, también', async () => {
    await agregarConPlan('construyendo');

    await waitFor(() => expect(aviso()).toBeInTheDocument());
  });

  it('con el plan terminado, o sin plan, no hay nada que avisar', async () => {
    await agregarConPlan('terminado');
    // Lo que haya después de la respuesta del estado ya corrió.
    await new Promise((resolver) => setTimeout(resolver, 20));

    expect(aviso()).toBeNull();
  });

  it('el botón abre el chat con el pedido escrito, marcado como pedido de otro plan', async () => {
    // Como hace la app al arrancar: el panel del asistente está registrado.
    sidePanel.register({
      id: AI_ASSISTANT_PANEL_ID,
      titleKey: 'side_panel.titles.ai_assistant',
      scope: 'course',
      component: (() => {}) as never,
      defaultWidth: 400,
      minWidth: 320,
      maxWidth: 720,
      widthStorageKey: 'prueba-ancho'
    });

    await agregarConPlan('pendiente');
    await waitFor(() => expect(aviso()).toBeInTheDocument());

    await fireEvent.click(screen.getByRole('button', { name: texto('course.sources.plan_notice_action') }));

    const borrador = get(chatDraft);

    expect(borrador).toMatchObject({ mode: 'append', rehacerPlan: true });
    expect(borrador?.text).toContain(PLANILLA.fileName);
    expect(sidePanel.activePanelId).toBe(AI_ASSISTANT_PANEL_ID);
    // Y el aviso se va: ya se hizo lo que pedía.
    expect(aviso()).toBeNull();
  });
});
