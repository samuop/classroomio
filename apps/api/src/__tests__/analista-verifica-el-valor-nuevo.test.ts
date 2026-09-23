import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * El valor NUEVO también se verifica contra el documento.
 *
 * ── Por qué ──────────────────────────────────────────────────────────────────
 *
 * El servidor ya comprobaba la mitad de abajo —que el valor VIEJO exista de
 * verdad en el curso, con `barrerValores`— y no comprobaba nada de la mitad de
 * arriba: el `new` que devolvía el analista se copiaba al plan, del plan a la
 * orden de trabajo y de ahí al curso. O sea que lo único que decide QUÉ va a
 * decir el curso a partir de ahora era lo único que nadie miraba.
 *
 * Es el mismo molde que la evidencia de una pregunta: lo que el modelo
 * devuelve, el servidor lo tiene que ENCONTRAR.
 *
 * Documento y curso inventados.
 */

const generateObject = vi.fn();

vi.mock('ai', () => ({
  generateObject: (...args: unknown[]) => generateObject(...args)
}));

vi.mock('@cio/ai-assistant', () => ({
  createModel: vi.fn(() => ({ modelId: 'modelo-de-prueba' })),
  resolveModelName: vi.fn(() => 'modelo-de-prueba')
}));

vi.mock('@api/services/agent/usage', () => ({
  recordTokenUsage: vi.fn().mockResolvedValue(undefined)
}));

import { crearAnalistaDeCambios } from '@api/services/agent/cambios-de-fuente';

const FUENTE = {
  fileName: 'Circular de atención.pdf',
  text: 'A partir del lunes, el contacto de la mesa pasa a WhatsApp 11 5555-0101. El horario no cambia.'
};

const LECCIONES = [
  {
    handle: 'S1.L1',
    title: 'Quién atiende cada reclamo',
    text: 'El reclamo se toma por el interno 4400, de 8 a 18.'
  }
];

function analista() {
  return crearAnalistaDeCambios({
    orgId: 'org',
    userId: 'usuario',
    courseId: 'curso',
    providerConfig: { provider: 'google', model: 'modelo-de-prueba' } as never
  });
}

function respondeCon(changes: Array<Record<string, unknown>>) {
  generateObject.mockResolvedValue({
    object: { changes },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('el analista de cambios', () => {
  it('conserva el cambio cuyo valor nuevo está en el documento', async () => {
    respondeCon([
      {
        old: 'interno 4400',
        key: '4400',
        new: 'WhatsApp 11 5555-0101',
        why: 'La circular reemplaza el interno por WhatsApp.'
      }
    ]);

    const resultado = await analista()({ fuenteNueva: FUENTE, lecciones: LECCIONES });

    expect(resultado.cambios).toEqual([expect.objectContaining({ valorNuevo: 'WhatsApp 11 5555-0101' })]);
    expect(resultado.descartados).toBeUndefined();
  });

  it('descarta el cambio cuyo valor nuevo NO está en el documento, y dice por qué', async () => {
    respondeCon([
      {
        old: 'de 8 a 18',
        key: '8 a 18',
        new: 'de 9 a 17',
        why: 'La circular cambia el horario.'
      }
    ]);

    const resultado = await analista()({ fuenteNueva: FUENTE, lecciones: LECCIONES });

    expect(resultado.cambios).toEqual([]);
    expect(resultado.descartados).toEqual([
      expect.objectContaining({
        valorViejo: 'de 8 a 18',
        valorNuevo: 'de 9 a 17',
        motivo: expect.stringContaining('Circular de atención.pdf')
      })
    ]);
  });

  it('el descarte es de a uno: lo que sí está sobrevive', async () => {
    respondeCon([
      { old: 'de 8 a 18', key: '8 a 18', new: 'de 9 a 17', why: 'Inventado.' },
      { old: 'interno 4400', key: '4400', new: 'WhatsApp 11 5555-0101', why: 'La circular lo dice.' }
    ]);

    const resultado = await analista()({ fuenteNueva: FUENTE, lecciones: LECCIONES });

    expect(resultado.cambios.map((cambio) => cambio.valorViejo)).toEqual(['interno 4400']);
    expect(resultado.descartados).toHaveLength(1);
  });

  it('la comparación es tolerante con tildes y mayúsculas, no con el dato', async () => {
    // El documento dice «WhatsApp 11 5555-0101»; el analista puede escribirlo
    // distinto en mayúsculas o con otra puntuación y sigue siendo el mismo dato.
    respondeCon([
      { old: 'interno 4400', key: '4400', new: 'whatsapp 11 5555 0101', why: 'La circular lo dice.' }
    ]);

    const resultado = await analista()({ fuenteNueva: FUENTE, lecciones: LECCIONES });

    expect(resultado.cambios).toHaveLength(1);
  });
});

/**
 * El filtro exige que `new` sea literal; entonces al analista hay que DECÍRSELO.
 *
 * Al valor viejo el esquema ya le pedía literalidad («the server searches the
 * course for this string»); al nuevo, no. Una paráfrasis («1 hora» donde el
 * documento dice «una hora») o una supresión escrita como «removed» se
 * descartaban en silencio y el curso seguía enseñando el dato viejo. Quien
 * decide el texto de `new` es el analista, así que la regla tiene que estar en
 * lo que él lee: el esquema y el sistema.
 */
describe('lo que se le pide al analista sobre el valor nuevo', () => {
  const SUPRESION = {
    fileName: 'Circular de atención.pdf',
    text: 'Desde el lunes se elimina el interno 4400. Los reclamos se toman sólo por el portal.'
  };

  it('el esquema y el sistema le piden copiarlo tal cual, y citar la frase que suprime', async () => {
    respondeCon([]);

    await analista()({ fuenteNueva: FUENTE, lecciones: LECCIONES });

    const { schema, system } = generateObject.mock.calls[0][0] as {
      schema: { shape: { changes: { element: { shape: { new: { description?: string } } } } } };
      system: string;
    };
    const descripcion = schema.shape.changes.element.shape.new.description ?? '';

    expect(descripcion).toMatch(/verbatim/i);
    expect(descripcion).toContain('DROPS the change');
    expect(descripcion).toContain('removes the fact');
    expect(system).toMatch(/NEW value is checked the same way/);
    expect(system).toContain('REMOVES a fact');
  });

  it('una supresión escrita como «removed» se descarta: no está en el documento', async () => {
    respondeCon([{ old: 'interno 4400', key: '4400', new: '(removed)', why: 'La circular elimina el interno.' }]);

    const resultado = await analista()({ fuenteNueva: SUPRESION, lecciones: LECCIONES });

    expect(resultado.cambios).toEqual([]);
    expect(resultado.descartados).toHaveLength(1);
  });

  it('y citando la frase que la suprime, como pide el esquema, sobrevive', async () => {
    respondeCon([
      { old: 'interno 4400', key: '4400', new: 'se elimina el interno 4400', why: 'La circular elimina el interno.' }
    ]);

    const resultado = await analista()({ fuenteNueva: SUPRESION, lecciones: LECCIONES });

    expect(resultado.cambios).toEqual([expect.objectContaining({ valorNuevo: 'se elimina el interno 4400' })]);
  });

  it('una paráfrasis se descarta: por eso la regla tiene que estar en lo que lee el analista', async () => {
    const PLAZO = {
      fileName: 'Circular de plazos.pdf',
      text: 'El plazo de primera respuesta para P2 pasa a ser de una hora.'
    };

    respondeCon([{ old: '2 horas', key: '2 horas', new: '1 hora', why: 'La circular acorta el plazo.' }]);

    const resultado = await analista()({ fuenteNueva: PLAZO, lecciones: LECCIONES });

    expect(resultado.cambios).toEqual([]);
    expect(resultado.descartados?.[0]?.motivo).toContain('Circular de plazos.pdf');
  });
});
