import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * El juez de fundamento deja rastro de si CORRIÓ.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * El `catch` de `crearVerificadorDeFundamento` devolvía `[]`, o sea exactamente
 * lo mismo que una lección impecable. `writeLessonBody` guardaba
 * `groundingWarnings: []` en el informe y seguía. Una caída del proveedor en
 * una construcción de dieciséis lecciones producía dieciséis lecciones
 * «limpias» sin una línea en ningún lado que dijera que nadie las miró.
 *
 * Fallar abierto está bien —perder la lección sería peor—; fallar MUDO no.
 *
 * Curso y fuentes inventados.
 */

const generateObject = vi.fn();
const buildSourcePack = vi.fn();

vi.mock('ai', () => ({
  generateObject: (...args: unknown[]) => generateObject(...args)
}));

vi.mock('@cio/ai-assistant', () => ({
  createModel: vi.fn(() => ({ modelId: 'modelo-de-prueba' })),
  resolveModelName: vi.fn(() => 'modelo-de-prueba')
}));

vi.mock('@api/services/agent/source-pack', () => ({
  buildSourcePack: (...args: unknown[]) => buildSourcePack(...args)
}));

vi.mock('@api/services/agent/usage', () => ({
  recordTokenUsage: vi.fn().mockResolvedValue(undefined)
}));

import { crearVerificadorDeFundamento } from '@api/services/agent/grounding';

/** Larga a propósito: por debajo de 400 caracteres el chequeo no sale a la red. */
const LECCION =
  '<p>La mesa de ayuda recibe los reclamos por el canal que la circular indica y los clasifica por prioridad. ' +
  'Un incidente crítico se escala a la gerencia si no se resuelve dentro del plazo. ' +
  'El operador registra cada contacto con el cliente, deja constancia de lo acordado y cierra el caso ' +
  'solamente cuando el cliente confirma que quedó conforme con la solución entregada. ' +
  'Cuando el reclamo llega fuera del horario de atención, queda registrado y se toma a primera hora del ' +
  'día siguiente, con el mismo plazo de respuesta que si hubiera entrado en horario.</p>';

function juez() {
  return crearVerificadorDeFundamento({
    orgId: 'org',
    userId: 'usuario',
    courseId: 'curso',
    redis: {} as never,
    providerConfig: { provider: 'google', model: 'modelo-de-prueba' } as never
  })!;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  buildSourcePack.mockResolvedValue({ text: '## Course Sources (1)\n\nLa mesa de ayuda atiende de 8 a 18.' });
});

describe('cuando el chequeo corre', () => {
  it('sin hallazgos devuelve «ok» y ningún aviso', async () => {
    generateObject.mockResolvedValue({ object: { afirmaciones: [] }, usage: {} });

    const resultado = await juez()({ lessonTitle: 'Cómo se escala un incidente', contenido: LECCION });

    expect(resultado).toEqual({ avisos: [], estado: 'ok' });
  });
});

describe('cuando el chequeo NO corre', () => {
  it('una caída del proveedor vuelve como «failed» con el motivo, no como una lección limpia', async () => {
    generateObject.mockRejectedValue(new Error('502 del proveedor'));

    const resultado = await juez()({ lessonTitle: 'Cómo se escala un incidente', contenido: LECCION });

    expect(resultado).toMatchObject({ avisos: [], estado: 'failed' });
    expect(String(resultado.motivo)).toContain('502 del proveedor');
  });

  it('un curso sin fuentes legibles vuelve como «skipped», que tampoco es limpia', async () => {
    buildSourcePack.mockResolvedValue({ text: '' });

    const resultado = await juez()({ lessonTitle: 'Cómo se escala un incidente', contenido: LECCION });

    expect(resultado).toMatchObject({ estado: 'skipped' });
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('y una lección de dos frases también, sin pagar el paquete de fuentes', async () => {
    const resultado = await juez()({ lessonTitle: 'Una lección corta', contenido: '<p>Muy corta.</p>' });

    expect(resultado).toMatchObject({ estado: 'skipped' });
    expect(generateObject).not.toHaveBeenCalled();
  });
});
