import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Lo marcado como ejemplo sigue a la vista del juez, envuelto.
 *
 * ── Lo que se midió (producción, 2026-09-29) ─────────────────────────────────
 *
 * Para no rebotar, el escritor marcaba como ejemplo el párrafo o la lista
 * ENTERA donde había un número inventado, y la marca sacaba todo el bloque de
 * los dos chequeos. En una lección, el 56 % del texto visible quedó fuera de
 * toda verificación: una definición casi textual de la fuente, una regla del
 * programa, un diagrama entero por un solo número.
 *
 * Ahora el juez recibe el ejemplo envuelto como `[example: …]`: sabe que sus
 * nombres y números son inventados a propósito, y sigue viendo la regla que el
 * bloque afirma. Lo que se declaró como hueco (`data-sin-fuente`) sí se va.
 *
 * Lección y fuentes inventadas.
 */

const generateObject = vi.fn();

vi.mock('ai', () => ({
  generateObject: (...args: unknown[]) => generateObject(...args)
}));

vi.mock('@cio/ai-assistant', () => ({
  createModel: vi.fn(() => ({ modelId: 'modelo-de-prueba' })),
  resolveModelName: vi.fn(() => 'modelo-de-prueba')
}));

vi.mock('@api/services/agent/source-pack', () => ({
  buildSourcePack: vi.fn().mockResolvedValue({ text: '## Course Sources (1)\n\nLa mesa de ayuda atiende de 8 a 18.' })
}));

vi.mock('@api/services/agent/usage', () => ({
  recordTokenUsage: vi.fn().mockResolvedValue(undefined)
}));

import { INSTRUCCION_VERIFICADOR, crearVerificadorDeFundamento } from '@api/services/agent/grounding';

const REGLA_EN_EL_EJEMPLO = 'la planilla alinea los números a la derecha y el texto a la izquierda';

const LECCION =
  '<p>La mesa de ayuda recibe los reclamos por el canal que la circular indica y los clasifica por prioridad. ' +
  'Un incidente crítico se escala a la gerencia si no se resuelve dentro del plazo que fija el protocolo.</p>' +
  `<ul data-ejemplo="un listado inventado"><li>La gaseosa de 500 ml cuesta 1200: ${REGLA_EN_EL_EJEMPLO}.</li></ul>` +
  '<p data-sin-fuente="la circular no dice quién firma">El jefe de turno firma cada cierre del día.</p>' +
  '<p>El operador registra cada contacto con el cliente y cierra el caso solamente cuando el cliente confirma que quedó conforme.</p>';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  generateObject.mockResolvedValue({ object: { afirmaciones: [] }, usage: {} });
});

function juez() {
  return crearVerificadorDeFundamento({
    orgId: 'org',
    userId: 'usuario',
    courseId: 'curso',
    redis: {} as never,
    providerConfig: { provider: 'google', model: 'modelo-de-prueba' } as never
  })!;
}

describe('lo que ve el juez', () => {
  it('el ejemplo marcado le llega envuelto, con la regla que afirma a la vista', async () => {
    await juez()({ lessonTitle: 'La mesa de ayuda', contenido: LECCION });

    const prompt = String(generateObject.mock.calls[0][0].prompt);

    expect(prompt).toMatch(/\[example: .*500 ml.*\]/);
    expect(prompt).toContain(REGLA_EN_EL_EJEMPLO);
  });

  it('el pasaje declarado como hueco no le llega', async () => {
    await juez()({ lessonTitle: 'La mesa de ayuda', contenido: LECCION });

    expect(String(generateObject.mock.calls[0][0].prompt)).not.toContain('El jefe de turno firma');
  });

  it('una afirmación adentro del ejemplo se puede señalar: su cita existe en lo que vio', async () => {
    generateObject.mockResolvedValue({
      object: { afirmaciones: [{ cita: REGLA_EN_EL_EJEMPLO, porque: 'la fuente no habla de alineación' }] },
      usage: {}
    });

    const resultado = await juez()({ lessonTitle: 'La mesa de ayuda', contenido: LECCION });

    expect(resultado.afirmaciones).toEqual([expect.objectContaining({ cita: REGLA_EN_EL_EJEMPLO })]);
  });

  it('y la instrucción le dice qué es un [example: …]', () => {
    expect(INSTRUCCION_VERIFICADOR).toMatch(/arrives wrapped as \[example: \.\.\.\]/);
    expect(INSTRUCCION_VERIFICADOR).toMatch(/never flag those/);
  });
});
