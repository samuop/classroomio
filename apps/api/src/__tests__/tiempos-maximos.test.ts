import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Ninguna llamada al modelo de la construcción espera sin límite.
 *
 * ── Lo que se midió (producción, 2026-09-29) ─────────────────────────────────
 *
 * El juez de fundamento no tenía tope: su mediana es de 3 a 5 segundos, y una
 * lección esperó 38 y 67 por dos jueces que devolvieron cero avisos. Esa sola
 * herramienta pasó los 120 segundos sin mandar nada y el proxy cortó la ronda.
 * El escritor y el escritor de preguntas tampoco tenían tope.
 *
 * Y cuando el juez se corta, la lección YA está guardada: la nota no puede
 * mandar a reescribirla.
 */

const generateObject = vi.fn();
const generateText = vi.fn();

vi.mock('ai', async (original) => ({
  ...(await original<typeof import('ai')>()),
  generateObject: (...args: unknown[]) => generateObject(...args),
  generateText: (...args: unknown[]) => generateText(...args)
}));

vi.mock('@cio/ai-assistant', async (original) => ({
  ...(await original<typeof import('@cio/ai-assistant')>()),
  createModel: vi.fn(() => ({ modelId: 'modelo-de-prueba' })),
  resolveModelName: vi.fn(() => 'modelo-de-prueba')
}));

vi.mock('@api/services/agent/source-pack', () => ({
  buildSourcePack: vi.fn().mockResolvedValue({ text: '## Course Sources (1)\n\nLa mesa de ayuda atiende de 8 a 18.' })
}));

vi.mock('@api/services/agent/usage', () => ({
  recordTokenUsage: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@cio/db/queries/agent/chat-document', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/agent/chat-document')>()),
  listCourseSources: vi.fn().mockResolvedValue([])
}));

import { crearVerificadorDeFundamento } from '@api/services/agent/grounding';
import { crearEscritorDeLecciones, TIEMPO_MAXIMO_ESCRITOR_MS } from '@api/services/agent/lesson-writer';
import { crearEscritorDePreguntas } from '@api/services/agent/question-writer';

/** Larga a propósito: por debajo de 400 caracteres el juez no sale a la red. */
const LECCION =
  '<p>La mesa de ayuda recibe los reclamos por el canal que la circular indica y los clasifica por prioridad. ' +
  'Un incidente crítico se escala a la gerencia si no se resuelve dentro del plazo. ' +
  'El operador registra cada contacto con el cliente, deja constancia de lo acordado y cierra el caso ' +
  'solamente cuando el cliente confirma que quedó conforme con la solución entregada. ' +
  'Cuando el reclamo llega fuera del horario de atención, queda registrado y se toma a primera hora del ' +
  'día siguiente, con el mismo plazo de respuesta que si hubiera entrado en horario.</p>';

const PROVEEDOR = { provider: 'google', model: 'modelo-de-prueba' } as never;

/** Una llamada que no contesta nunca, salvo que la corten. */
function queNoContesta() {
  return ({ abortSignal }: { abortSignal?: AbortSignal }) =>
    new Promise((_, rechazar) => {
      abortSignal?.addEventListener('abort', () => rechazar(abortSignal.reason));
    });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('el juez de fundamento', () => {
  it('se corta al tope y queda «failed», con el motivo', async () => {
    generateObject.mockImplementation(queNoContesta());

    const juez = crearVerificadorDeFundamento({
      orgId: 'org',
      userId: 'usuario',
      courseId: 'curso',
      redis: {} as never,
      providerConfig: PROVEEDOR,
      tiempoMaximoMs: 20
    })!;

    const resultado = await juez({ lessonTitle: 'Cómo se escala un incidente', contenido: LECCION });

    expect(resultado).toEqual({
      avisos: [],
      estado: 'failed',
      motivo: expect.stringContaining('took longer than')
    });
    expect(generateObject.mock.calls[0][0].abortSignal).toBeInstanceOf(AbortSignal);
  });
});

describe('el escritor de lecciones', () => {
  function escritor() {
    return crearEscritorDeLecciones({
      orgId: 'org',
      userId: 'usuario',
      courseId: 'curso',
      redis: {} as never,
      providerConfig: PROVEEDOR,
      courseTitle: 'Mesa de ayuda'
    });
  }

  it('llama con tiempo máximo', async () => {
    generateText.mockResolvedValue({
      text: '<lesson><p>Una lección.</p></lesson>',
      finishReason: 'stop',
      usage: {}
    });

    await escritor()({ lessonTitle: 'Escalar', brief: 'Cómo se escala.', locale: 'es', sources: [] });

    expect(generateText.mock.calls[0][0].abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('si se pasa, falla diciendo que se cortó por tiempo y que no se guardó nada', async () => {
    generateText.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));

    await expect(
      escritor()({ lessonTitle: 'Escalar', brief: 'Cómo se escala.', locale: 'es', sources: [] })
    ).rejects.toThrow(`took longer than ${TIEMPO_MAXIMO_ESCRITOR_MS / 1000} s`);
  });

  it('viene con el marcador del parche colgado, como lo recibe la ronda', () => {
    expect(typeof escritor().marcarTokens).toBe('function');
  });
});

describe('el escritor de preguntas', () => {
  it('llama con tiempo máximo', async () => {
    generateObject.mockResolvedValue({ object: { questions: [] }, usage: {} });

    await crearEscritorDePreguntas({
      orgId: 'org',
      userId: 'usuario',
      courseId: 'curso',
      providerConfig: PROVEEDOR,
      isOrgOnPaidPlan: false
    })({
      exerciseTitle: 'Autoevaluación',
      brief: '',
      count: 6,
      lecciones: [{ title: 'Escalar', text: 'Un incidente crítico se escala a la gerencia.' }],
      locale: 'es'
    });

    expect(generateObject.mock.calls[0][0].abortSignal).toBeInstanceOf(AbortSignal);
  });
});
