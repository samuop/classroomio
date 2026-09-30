import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * El parche: qué se le pregunta al escritor, y qué hace el servidor con la
 * respuesta.
 *
 * La garantía que lo justifica es una sola: ninguna respuesta posible cambia el
 * texto de la lección. Medido el 2026-09-29, el rebote que reescribía la
 * lección borró hechos ciertos y cambió el formato de las cifras; acá lo único
 * que puede pasar es que un bloque gane un atributo.
 *
 * Lecciones inventadas.
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

import {
  EsquemaDelParche,
  anotarDecisiones,
  aplicarMarcas,
  crearMarcadorDeTokens,
  prepararParche,
  ROTULO_MANTENER,
  ubicarEnBloques
} from '@api/services/agent/marcas-del-rebote';
import { textoParaTokens, verificarTokens, type HallazgoDeToken } from '@api/services/agent/grounding-tokens';

const dato = (valor: string, tipo: HallazgoDeToken['tipo'] = 'nombre'): HallazgoDeToken => ({
  tipo,
  valor,
  contexto: valor,
  enDiagrama: false
});

const LECCION =
  '<h3 data-block-id="t1">Proveedores</h3>' +
  '<p data-block-id="p1">El local le compra a la distribuidora Arlux.</p>' +
  '<ul data-block-id="u1"><li>Cada celda tiene un nombre, como B3.</li><li>La factura 4471 se carga el lunes.</li></ul>' +
  '<table data-block-id="tb1"><tbody><tr><td>Arlux</td><td>4471</td></tr></tbody></table>' +
  '<p data-block-id="p2" data-ejemplo="un caso inventado">Otro caso: la factura 4471 vuelve el martes.</p>';

/** Lo que se le preguntaría al escritor sobre esa lección. */
const { bloques } = prepararParche(LECCION, [dato('Arlux'), dato('4471', 'numero')]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('qué se le pregunta', () => {
  it('cada dato con TODOS los bloques donde aparece, y sólo bloques que pueden llevar la marca', () => {
    const { bloques, sinBloque } = prepararParche(LECCION, [dato('Arlux'), dato('4471', 'numero')]);

    // La tabla sí, desde que el editor guarda la marca en una tabla. El párrafo
    // ya marcado no: lo de adentro no se contó.
    expect(bloques.map((bloque) => bloque.blockId)).toEqual(['p1', 'u1', 'tb1']);
    expect(bloques.find((bloque) => bloque.blockId === 'p1')?.tokens).toEqual(['Arlux']);
    expect(bloques.find((bloque) => bloque.blockId === 'u1')?.tokens).toEqual(['4471']);
    expect(bloques.find((bloque) => bloque.blockId === 'tb1')?.tokens).toEqual(['Arlux', '4471']);
    expect(sinBloque).toEqual([]);
  });

  it('un dato que sólo está donde no se puede marcar queda afuera, para el informe', () => {
    // Un bloque sin id no se puede nombrar: su dato va al informe tal cual.
    const html = '<p>El proveedor Galdor entrega los lunes.</p>';

    expect(prepararParche(html, [dato('Galdor')])).toEqual({ bloques: [], sinBloque: [dato('Galdor')] });
  });

  it('una tabla de ejemplo se marca entera sólo si todos sus datos son de ejemplo', () => {
    // En un curso de planillas lo típico es una tabla de productos y precios
    // inventados: antes esos datos quedaban siempre sin marcar.
    const tabla =
      '<table data-block-id="tb1"><tbody><tr><td>Gaseosa Norte</td><td>1.250 pesos</td></tr></tbody></table>';
    const { bloques } = prepararParche(tabla, [dato('Gaseosa Norte'), dato('1.250 pesos', 'numero')]);

    const todoEjemplo = aplicarMarcas(
      tabla,
      [
        { blockId: 'tb1', token: 'Gaseosa Norte', accion: 'ejemplo', motivo: 'una planilla de precios inventada' },
        { blockId: 'tb1', token: '1.250 pesos', accion: 'ejemplo', motivo: 'una planilla de precios inventada' }
      ],
      bloques
    );

    expect(todoEjemplo.html).toContain('<table data-block-id="tb1" data-ejemplo="una planilla de precios inventada">');

    const mezclado = aplicarMarcas(
      tabla,
      [
        { blockId: 'tb1', token: 'Gaseosa Norte', accion: 'ejemplo', motivo: 'un producto inventado' },
        { blockId: 'tb1', token: '1.250 pesos', accion: 'sin-fuente', motivo: 'el material no da precios' }
      ],
      bloques
    );

    expect(mezclado.html).toBe(tabla);
  });

  it('el id del primer bloque donde aparece, para el informe y para el constructor', () => {
    expect(ubicarEnBloques(LECCION, [dato('4471', 'numero')])[0].blockId).toBe('u1');
  });
});

describe('un número con la unidad pegada («500ml», «24hs»)', () => {
  // La clase que más rebotaba en producción. El chequeo escribe el valor como
  // «500 ml» y la lección dice «500ml»: comparado tal cual, el dato quedaba sin
  // bloque, nunca se le preguntaba al escritor y nunca se marcaba.
  const html =
    '<p data-block-id="b1">En el kiosco la Gaseosa 500ml se cobra con el lector.</p>' +
    '<ul data-block-id="b2"><li>El local abre 24hs.</li><li>La pestaña Insertar agrega gráficos.</li><li>Llegan 2kg de pan.</li></ul>';
  const hallazgos = () =>
    verificarTokens({
      texto: textoParaTokens(html),
      fuentes: [{ fileName: 'Manual.pdf', text: 'El manual explica cómo se cobra con el lector de la caja.' }]
    }).filter((hallazgo) => hallazgo.tipo === 'numero');

  it('el chequeo los encuentra, escritos con la unidad separada', () => {
    expect(hallazgos().map((hallazgo) => hallazgo.valor)).toEqual(expect.arrayContaining(['500 ml', '24 hs', '2 kg']));
  });

  it('se le preguntan al escritor en su bloque: ninguno queda afuera', () => {
    const { bloques, sinBloque } = prepararParche(html, hallazgos());

    expect(sinBloque).toEqual([]);
    expect(bloques.find((bloque) => bloque.blockId === 'b1')?.tokens).toContain('500 ml');
    expect(bloques.find((bloque) => bloque.blockId === 'b2')?.tokens).toEqual(expect.arrayContaining(['24 hs', '2 kg']));
  });

  it('el informe sabe en qué bloque está cada uno', () => {
    const ubicados = ubicarEnBloques(html, hallazgos());

    expect(ubicados.find((hallazgo) => hallazgo.valor === '500 ml')?.blockId).toBe('b1');
    expect(ubicados.find((hallazgo) => hallazgo.valor === '24 hs')?.blockId).toBe('b2');
  });

  it('en una lista se marcan los renglones con el dato, y no el de la pestaña', () => {
    const { bloques } = prepararParche(html, hallazgos());
    const { html: marcado } = aplicarMarcas(
      html,
      [
        { blockId: 'b2', token: '24 hs', accion: 'ejemplo', motivo: 'un local inventado' },
        { blockId: 'b2', token: '2 kg', accion: 'ejemplo', motivo: 'un local inventado' }
      ],
      bloques
    );

    expect(marcado).toContain('<li data-ejemplo="un local inventado">El local abre 24hs.</li>');
    expect(marcado).toContain('<li data-ejemplo="un local inventado">Llegan 2kg de pan.</li>');
    expect(marcado).toContain('<li>La pestaña Insertar agrega gráficos.</li>');
  });

  it('un número solo no se confunde con uno que lleva unidad: «500» no está en «500ml»', () => {
    const { sinBloque } = prepararParche('<p data-block-id="b1">Gaseosa 500ml.</p>', [dato('500', 'numero')]);

    expect(sinBloque.map((hallazgo) => hallazgo.valor)).toEqual(['500']);
  });
});

describe('se decide por dato, no por bloque', () => {
  // Decidido por bloque, una lista con un renglón de conocimiento general y uno
  // de ejemplo marcaba los dos como inventados, y un «mantener» rotulaba como
  // conocimiento general el nombre inventado que tenía al lado.
  const MIXTA =
    '<ul data-block-id="u1"><li>La pestaña Insertar agrega gráficos.</li><li>Ejemplo: el Alfajor Triple se vende suelto.</li></ul>' +
    '<p data-block-id="p1">Con la pestaña Insertar le agregás un gráfico al Alfajor Triple.</p>';
  const decisiones = [
    { blockId: 'u1', token: 'Insertar', accion: 'mantener' as const, motivo: 'Insertar es una pestaña de Excel' },
    { blockId: 'u1', token: 'Alfajor Triple', accion: 'ejemplo' as const, motivo: 'un producto inventado' },
    { blockId: 'p1', token: 'Insertar', accion: 'mantener' as const, motivo: 'Insertar es una pestaña de Excel' },
    { blockId: 'p1', token: 'Alfajor Triple', accion: 'ejemplo' as const, motivo: 'un producto inventado' }
  ];
  const { bloques: preguntados } = prepararParche(MIXTA, [dato('Insertar'), dato('Alfajor Triple')]);

  it('en una lista mixta se marca sólo el renglón del ejemplo', () => {
    const { html } = aplicarMarcas(MIXTA, decisiones, preguntados);

    expect(html).toContain('<li>La pestaña Insertar agrega gráficos.</li>');
    expect(html).toContain('<li data-ejemplo="un producto inventado">Ejemplo: el Alfajor Triple se vende suelto.</li>');
  });

  it('cada dato mantenido lleva SU motivo, y el inventado no queda como conocimiento general', () => {
    const anotados = anotarDecisiones([dato('Insertar'), dato('Alfajor Triple')], decisiones, preguntados);

    expect(anotados.find((hallazgo) => hallazgo.valor === 'Insertar')).toMatchObject({
      decision: 'mantener',
      rotulo: ROTULO_MANTENER,
      motivo: 'Insertar es una pestaña de Excel'
    });
    expect(anotados.find((hallazgo) => hallazgo.valor === 'Alfajor Triple')?.decision).toBeUndefined();
  });

  it('un diagrama se marca sólo si todos sus datos son de ejemplo', () => {
    const svg =
      '<svg data-block-id="d1" viewBox="0 0 200 100"><text x="10" y="20">Sucursal Norte</text><text x="10" y="60">Depósito Oeste</text></svg>';
    const { bloques } = prepararParche(svg, [dato('Sucursal Norte'), dato('Depósito Oeste')]);

    expect(bloques.map((bloque) => bloque.blockId)).toEqual(['d1']);

    const mezclado = aplicarMarcas(
      svg,
      [
        { blockId: 'd1', token: 'Sucursal Norte', accion: 'ejemplo', motivo: 'una sucursal inventada' },
        { blockId: 'd1', token: 'Depósito Oeste', accion: 'sin-fuente', motivo: 'el material no nombra el depósito' }
      ],
      bloques
    );

    // Marcarlo por un dato se llevaba fuera del chequeo el otro: queda para el informe.
    expect(mezclado.html).toBe(svg);

    const todoEjemplo = aplicarMarcas(
      svg,
      [
        { blockId: 'd1', token: 'Sucursal Norte', accion: 'ejemplo', motivo: 'un organigrama inventado' },
        { blockId: 'd1', token: 'Depósito Oeste', accion: 'ejemplo', motivo: 'un organigrama inventado' }
      ],
      bloques
    );

    expect(todoEjemplo.html).toContain('data-ejemplo="un organigrama inventado"');
  });

  it('una decisión sobre un dato que no se le preguntó en ese bloque se ignora', () => {
    const { html } = aplicarMarcas(
      MIXTA,
      [{ blockId: 'u1', token: 'Otra Cosa', accion: 'ejemplo', motivo: 'no se preguntó' }],
      preguntados
    );

    expect(html).toBe(MIXTA);
  });
});

describe('qué hace el servidor con la respuesta', () => {
  it('en una lista marca el renglón que lleva el dato, no la lista entera', () => {
    const { html } = aplicarMarcas(
      LECCION,
      [{ blockId: 'u1', token: '4471', accion: 'ejemplo', motivo: 'una factura inventada' }],
      bloques
    );

    expect(html).toContain('<li data-ejemplo="una factura inventada">La factura 4471');
    expect(html).toContain('<li>Cada celda tiene un nombre, como B3.</li>');
    expect(html).toContain('<ul data-block-id="u1">');
  });

  it('el texto queda idéntico: sólo se agregan atributos', () => {
    const { html } = aplicarMarcas(
      LECCION,
      [
        { blockId: 'p1', token: 'Arlux', accion: 'sin-fuente', motivo: 'el material no dice a quién le compra el local' },
        { blockId: 'u1', token: '4471', accion: 'ejemplo', motivo: 'una factura "inventada" & su fecha' }
      ],
      bloques
    );

    expect(html).not.toBe(LECCION);
    expect(textoParaTokens(html)).toBe(textoParaTokens(LECCION));
    // El motivo va escapado adentro del atributo.
    expect(html).toContain('data-ejemplo="una factura &quot;inventada&quot; &amp; su fecha"');
  });

  it('mantener no marca nada', () => {
    const { html, aplicadas } = aplicarMarcas(
      LECCION,
      [{ blockId: 'p1', token: 'Arlux', accion: 'mantener', motivo: 'es un dato general' }],
      bloques
    );

    expect(html).toBe(LECCION);
    expect(aplicadas).toEqual([{ blockId: 'p1', token: 'Arlux', accion: 'mantener', motivo: 'es un dato general' }]);
  });

  it('no marca un bloque que no se le preguntó, y de un bloque vale la primera decisión', () => {
    const { html, aplicadas } = aplicarMarcas(
      LECCION,
      [
        { blockId: 't1', token: 'Proveedores', accion: 'ejemplo', motivo: 'no se preguntó' },
        { blockId: 'p1', token: 'Arlux', accion: 'mantener', motivo: 'primera' },
        { blockId: 'p1', token: 'Arlux', accion: 'ejemplo', motivo: 'segunda' }
      ],
      bloques
    );

    expect(html).toBe(LECCION);
    expect(aplicadas.map((decision) => decision.motivo)).toEqual(['primera']);
  });
});

describe('la llamada al modelo', () => {
  it('el esquema no tiene nada opcional: Gemini deja vacío lo que no se exige', () => {
    const campos = EsquemaDelParche.shape.decisiones.element.shape;

    for (const campo of Object.values(campos)) expect(campo.isOptional()).toBe(false);
    expect(EsquemaDelParche.shape.decisiones.isOptional()).toBe(false);
  });

  it('va con tiempo máximo y devuelve las decisiones', async () => {
    generateObject.mockResolvedValue({
      object: { decisiones: [{ blockId: ' p1 ', token: ' Arlux ', accion: 'ejemplo', motivo: 'un proveedor inventado' }] },
      usage: {}
    });

    const marcar = crearMarcadorDeTokens({
      orgId: 'org',
      userId: 'usuario',
      courseId: 'curso',
      providerConfig: { provider: 'google', model: 'modelo-de-prueba' } as never
    });
    const decisiones = await marcar({
      lessonTitle: 'Proveedores',
      brief: 'A quién le compra el local.',
      locale: 'es',
      bloques
    });

    expect(decisiones).toEqual([{ blockId: 'p1', token: 'Arlux', accion: 'ejemplo', motivo: 'un proveedor inventado' }]);

    const llamada = generateObject.mock.calls[0][0];

    expect(llamada.abortSignal).toBeInstanceOf(AbortSignal);
    expect(llamada.prompt).toContain('[block p1]');
    expect(llamada.prompt).toContain('«Arlux»');
  });

  it('si se pasa de tiempo, no decide nada y la lección queda como estaba', async () => {
    generateObject.mockImplementation(
      ({ abortSignal }: { abortSignal: AbortSignal }) =>
        new Promise((_, rechazar) => abortSignal.addEventListener('abort', () => rechazar(abortSignal.reason)))
    );

    const marcar = crearMarcadorDeTokens({
      orgId: 'org',
      userId: 'usuario',
      courseId: 'curso',
      providerConfig: { provider: 'google', model: 'modelo-de-prueba' } as never,
      tiempoMaximoMs: 20
    });

    await expect(marcar({ lessonTitle: 'Proveedores', brief: '', locale: 'es', bloques })).resolves.toEqual([]);
  });
});
