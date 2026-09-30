import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Una página privada o vacía no es un error para reintentar: es un documento
 * que la docente tiene que subir.
 *
 * ── Lo que se midió (producción) ─────────────────────────────────────────────
 *
 * La planilla privada de una docente entró como fuente del curso con la
 * pantalla de inicio de sesión adentro. La lectura ahora lo detecta y tira un
 * 422 con su código (`SOURCE_NEEDS_LOGIN`, `SOURCE_UNREADABLE`). Acá se fija que
 * la herramienta del agente se lo explica al constructor —pedile el documento a
 * la docente— en vez de pasarle el error crudo, que invita a probar de nuevo el
 * mismo enlace.
 */

// El entorno de tests de la API es `node` y no puede cargar jsdom.
vi.mock('isomorphic-dompurify', () => ({
  default: new Proxy({}, { get: () => (valor: unknown) => valor })
}));

vi.mock('@api/utils/tinybird', () => ({
  trackAgentEvent: vi.fn(),
  AgentEvent: new Proxy({}, { get: (_, clave) => String(clave) })
}));

vi.mock('@api/services/agent/fetch-url', () => ({
  fetchDocumentationUrl: vi.fn()
}));

import { fetchDocumentationUrl } from '@api/services/agent/fetch-url';
import { AppError } from '@api/utils/errors';
import { buildAgentTools } from '@api/services/agent/chat-tools';

type Herramienta = { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> };

const URL_PRIVADA = 'https://docs.example.com/spreadsheets/d/planilla-de-prueba/edit';

function leer(url = URL_PRIVADA) {
  return (
    buildAgentTools('org', 'usuario', 'curso', [], { conversationId: 'conversacion', locale: 'es' }) as Record<
      string,
      Herramienta
    >
  ).fetch_documentation_url.execute({ url }, { toolCallId: 'llamada', messages: [] });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('fetch_documentation_url ante una página que no se puede leer', () => {
  it('un muro de inicio de sesión vuelve explicado: no reintentar, pedirle el documento a la docente', async () => {
    vi.mocked(fetchDocumentationUrl).mockRejectedValue(
      new AppError(`${URL_PRIVADA} did not return the document but a sign-in screen`, 'SOURCE_NEEDS_LOGIN', 422)
    );

    const resultado = await leer();

    // No es una falla pintada de rojo: es un resultado con qué hacer.
    expect(resultado.ok).toBeUndefined();
    expect(resultado).toMatchObject({ url: URL_PRIVADA, readable: false, code: 'SOURCE_NEEDS_LOGIN' });

    const nota = String(resultado.note);

    expect(nota).toContain('do not try the same link again');
    expect(nota).toContain('upload the document');
  });

  it('una página sin texto también', async () => {
    vi.mocked(fetchDocumentationUrl).mockRejectedValue(
      new AppError('https://ejemplo.org has no readable text', 'SOURCE_UNREADABLE', 422)
    );

    const resultado = await leer('https://ejemplo.org');

    expect(resultado).toMatchObject({ readable: false, code: 'SOURCE_UNREADABLE' });
    expect(String(resultado.note)).toContain('upload it in Sources');
  });

  it('cualquier otro error sigue siendo una falla, como antes', async () => {
    vi.mocked(fetchDocumentationUrl).mockRejectedValue(
      new AppError('Documentation fetch failed with status 500', 'DOCUMENTATION_FETCH_FAILED', 502)
    );

    const resultado = await leer();

    expect(resultado).toMatchObject({ ok: false, error: 'Documentation fetch failed with status 500' });
  });
});
