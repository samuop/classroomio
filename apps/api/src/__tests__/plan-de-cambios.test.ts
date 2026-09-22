import { describe, expect, it } from 'vitest';
import { ContentType } from '@cio/utils/constants';
import { CoursePlanSchema } from '@cio/ai-assistant';
import { atarPlanDeCambios } from '@api/services/agent/plan-de-cambios';
import { barrerValores } from '@api/services/agent/cambios-de-fuente';

/**
 * El plan que habla de lo que ya existe.
 *
 * ── Qué se cuida acá ─────────────────────────────────────────────────────────
 *
 * 1. Que «agregá una sección» pueda ser un plan de DOS ítems. El esquema exigía
 *    examen final siempre, así que el plan más chico posible era el curso
 *    entero: medido el 2026-09-21, el docente recibió treinta ítems para
 *    aprobar después de pedir uno.
 * 2. Que cada orden apunte a una fila de verdad. Un `target` que no resuelve no
 *    falla al aprobar ni al construir: falla en silencio.
 * 3. Que la línea de base se mida ANTES de tocar nada, que es lo que después
 *    permite decir «esto ya se hizo» sin preguntarle al modelo.
 * 4. Que el barrido encuentre el dato viejo también en las OPCIONES de una
 *    pregunta: una respuesta correcta que sigue diciendo el teléfono viejo es
 *    peor que una lección desactualizada, porque el alumno la aprende como
 *    correcta.
 *
 * Curso inventado, de una distribuidora que no existe.
 */

const ID = {
  recepcion: '11111111-1111-4111-8111-111111111111',
  mesaDeAyuda: '22222222-2222-4222-8222-222222222222',
  quienAtiende: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  comoSeCierra: 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  autoevaluacion: 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
};

const SECCIONES = [
  { id: ID.recepcion, title: 'Recepción de pedidos', order: 0, createdAt: '2026-01-01T00:00:00Z' },
  { id: ID.mesaDeAyuda, title: 'Mesa de Ayuda', order: 1, createdAt: '2026-01-02T00:00:00Z' }
];

const ITEMS = [
  {
    id: ID.quienAtiende,
    type: ContentType.Lesson,
    title: 'Quién atiende cada reclamo',
    sectionId: ID.mesaDeAyuda,
    order: 0
  },
  {
    id: ID.comoSeCierra,
    type: ContentType.Lesson,
    title: 'Cómo se cierra un reclamo',
    sectionId: ID.mesaDeAyuda,
    order: 1
  },
  {
    id: ID.autoevaluacion,
    type: ContentType.Exercise,
    title: 'Autoevaluación de la mesa',
    sectionId: ID.mesaDeAyuda,
    order: 2
  }
];

const CONTENIDO_QUIEN_ATIENDE =
  '<p data-block-id="b7">El reclamo se toma por el interno 4400 de lunes a viernes.</p>' +
  '<p data-block-id="b12">Si nadie atiende el interno 4400, se deja nota en el cuaderno.</p>';

const LECCIONES = [
  { id: ID.quienAtiende, title: 'Quién atiende cada reclamo', content: CONTENIDO_QUIEN_ATIENDE },
  {
    id: ID.comoSeCierra,
    title: 'Cómo se cierra un reclamo',
    content: '<p data-block-id="b3">El reclamo se cierra con la conformidad del cliente.</p>'
  }
];

const PREGUNTAS = new Map([
  [
    ID.autoevaluacion,
    [
      {
        id: 521,
        exerciseId: ID.autoevaluacion,
        title: '¿A qué interno se llama para abrir un reclamo?',
        options: [
          { id: 1, label: 'Al interno 4400', isCorrect: true },
          { id: 2, label: 'A la casilla de correo', isCorrect: false }
        ],
        settings: null
      }
    ]
  ]
]);

const ANALISIS = [
  {
    sourceId: 'fuente-1',
    fileName: 'Circular de atención.pdf',
    cambios: [
      { valorViejo: 'interno 4400', valorNuevo: 'WhatsApp 11 5555-0101', motivo: 'La circular reemplaza el interno.' },
      { valorViejo: 'de lunes a viernes', valorNuevo: 'todos los días', motivo: 'La circular amplía el horario.' },
      // Un valor que el curso no dice en ninguna parte: no le toca a nadie.
      { valorViejo: 'formulario F-12', valorNuevo: 'formulario F-20', motivo: 'Cambió el formulario.' }
    ]
  }
];

const item = (extra: Record<string, unknown>) => ({
  type: 'lesson' as const,
  title: 'Quién atiende cada reclamo',
  description: 'Actualizar el canal de contacto.',
  order: 0,
  hasExercise: false,
  ...extra
});

const planDeCambios = (items: Array<ReturnType<typeof item>>, sectionId?: string) => ({
  title: 'Actualización de la circular',
  scope: 'changes' as const,
  sections: [{ title: 'Mesa de Ayuda', order: 1, ...(sectionId ? { sectionId } : {}), items }]
});

function atar(plan: ReturnType<typeof planDeCambios>) {
  return atarPlanDeCambios({
    plan,
    secciones: SECCIONES,
    items: ITEMS,
    lecciones: LECCIONES,
    preguntasPorEjercicio: PREGUNTAS,
    analisis: ANALISIS
  });
}

describe('el esquema de un plan de cambios', () => {
  it('no exige examen final: un cambio de dos ítems es un plan válido', () => {
    const resultado = CoursePlanSchema.safeParse(
      planDeCambios([item({ action: 'edit', target: 'S2.L1', changes: 'El interno pasa a WhatsApp.' })])
    );

    expect(resultado.success).toBe(true);
  });

  /** El examen final sigue siendo obligatorio donde siempre lo fue: un curso entero. */
  it('un plan de curso sin examen final se sigue rechazando', () => {
    const resultado = CoursePlanSchema.safeParse({
      title: 'Atención al cliente',
      sections: [{ title: 'Mesa de Ayuda', order: 0, items: [item({})] }]
    });

    expect(resultado.success).toBe(false);
    expect(JSON.stringify(resultado)).toContain('final examination');
  });

  it('un ítem que dice retocar algo tiene que decir qué y dónde', () => {
    const sinTarget = CoursePlanSchema.safeParse(planDeCambios([item({ action: 'edit', changes: 'Algo cambia.' })]));
    const sinChanges = CoursePlanSchema.safeParse(planDeCambios([item({ action: 'edit', target: 'S2.L1' })]));

    expect(sinTarget.success).toBe(false);
    expect(JSON.stringify(sinTarget)).toContain('needs `target`');
    expect(sinChanges.success).toBe(false);
    expect(JSON.stringify(sinChanges)).toContain('needs `changes`');
  });
});

describe('atar un plan de cambios al curso', () => {
  it('resuelve el target por manija, por id y por título', () => {
    const porManija = atar(planDeCambios([item({ action: 'edit', target: 'S2.L1', changes: 'c' })], 'S2'));
    const porId = atar(planDeCambios([item({ action: 'edit', target: ID.quienAtiende, changes: 'c' })], 'S2'));
    const porTitulo = atar(
      planDeCambios([item({ action: 'edit', target: 'Quién atiende cada reclamo', changes: 'c' })], 'S2')
    );

    for (const atado of [porManija, porId, porTitulo]) {
      expect(atado.errores).toEqual([]);
      expect(atado.registro.sections[0].entityId).toBe(ID.mesaDeAyuda);
      expect(atado.registro.sections[0].items[0].entityId).toBe(ID.quienAtiende);
    }
  });

  it('un target que no nombra nada del curso vuelve como error y no inventa una atadura', () => {
    const atado = atar(planDeCambios([item({ action: 'rewrite', target: 'S9.L4', changes: 'c' })], 'S2'));

    expect(atado.errores).toHaveLength(1);
    expect(atado.errores[0]).toContain('S9.L4');
    expect(atado.registro.sections[0].items[0].entityId).toBeUndefined();
  });

  it('un ítem que dice retocar y no dice qué queda anotado como error', () => {
    const atado = atar(planDeCambios([item({ action: 'edit', changes: 'c' })], 'S2'));

    expect(atado.errores[0]).toContain('no target');
  });

  /**
   * La línea de base es lo único del registro que no se puede recalcular: mide
   * cómo estaba la lección ANTES. Que dos contenidos distintos den hashes
   * distintos es lo que hace que «ya se hizo» sea comparable.
   */
  it('le fija a cada target su línea de base, distinta para contenidos distintos', () => {
    const unaLeccion = atar(planDeCambios([item({ action: 'rewrite', target: 'S2.L1', changes: 'c' })], 'S2'));
    const otraLeccion = atar(planDeCambios([item({ action: 'rewrite', target: 'S2.L2', changes: 'c' })], 'S2'));
    const ejercicio = atar(
      planDeCambios(
        [{ ...item({ action: 'edit', target: 'S2.E1', changes: 'c' }), type: 'exercise' as const }],
        'S2'
      )
    );

    const hashA = unaLeccion.registro.sections[0].items[0].baseline?.contentHash;
    const hashB = otraLeccion.registro.sections[0].items[0].baseline?.contentHash;

    expect(hashA).toMatch(/^[0-9a-f]{40}$/);
    expect(hashB).toMatch(/^[0-9a-f]{40}$/);
    expect(hashA).not.toBe(hashB);
    expect(ejercicio.registro.sections[0].items[0].baseline?.contentHash).toMatch(/^[0-9a-f]{40}$/);
  });

  /**
   * Los reemplazos se reparten por DÓNDE ESTÁN, no por lo que el plan diga: el
   * plan dice qué lección tocar, los valores los sabe el servidor.
   */
  it('le cuelga a cada target sólo los valores que están adentro de ese target', () => {
    const atado = atar(
      planDeCambios(
        [
          item({ action: 'edit', target: 'S2.L1', changes: 'c' }),
          { ...item({ action: 'edit', target: 'S2.L2', changes: 'c' }), title: 'Cómo se cierra un reclamo' },
          {
            ...item({ action: 'edit', target: 'S2.E1', changes: 'c' }),
            type: 'exercise' as const,
            title: 'Autoevaluación de la mesa'
          }
        ],
        'S2'
      )
    );

    const [primera, segunda, examen] = atado.registro.sections[0].items;

    expect(primera.replacements).toEqual([
      { old: 'interno 4400', new: 'WhatsApp 11 5555-0101' },
      { old: 'de lunes a viernes', new: 'todos los días' }
    ]);
    // La segunda lección no dice ninguno de los dos: no le cuelga nada.
    expect(segunda.replacements).toBeUndefined();
    // El ejercicio sí dice el interno, en la etiqueta de la opción correcta.
    expect(examen.replacements).toEqual([{ old: 'interno 4400', new: 'WhatsApp 11 5555-0101' }]);
  });

  it('un ítem que crea algo nuevo no lleva ni atadura ni línea de base', () => {
    const atado = atar(planDeCambios([{ ...item({}), title: 'Cuándo escalar un reclamo' }], 'S2'));

    expect(atado.errores).toEqual([]);
    expect(atado.registro.sections[0].items[0]).toEqual({
      type: 'lesson',
      title: 'Cuándo escalar un reclamo',
      action: 'create'
    });
  });
});

describe('barrer un valor viejo por el curso', () => {
  it('encuentra cada aparición en una lección con su bloque', () => {
    const ocurrencias = barrerValores({
      valores: [{ old: 'interno 4400', new: 'WhatsApp 11 5555-0101' }],
      lecciones: LECCIONES
    });

    expect(ocurrencias.map((o) => o.blockId)).toEqual(['b7', 'b12']);
    expect(ocurrencias[0].lessonId).toBe(ID.quienAtiende);
  });

  /**
   * El caso que más duele: la RESPUESTA CORRECTA sigue diciendo el dato viejo.
   * Una lección desactualizada se lee; una opción correcta desactualizada se
   * aprende.
   */
  it('encuentra el valor viejo en la etiqueta de una opción, no sólo en el enunciado', () => {
    const ocurrencias = barrerValores({
      valores: [{ old: 'interno 4400', new: 'WhatsApp 11 5555-0101' }],
      preguntas: [...PREGUNTAS.values()].flat()
    });

    expect(ocurrencias).toHaveLength(1);
    expect(ocurrencias[0]).toMatchObject({ exerciseId: ID.autoevaluacion, questionId: 521 });
    expect(ocurrencias[0].texto).toContain('Al interno 4400');
  });

  it('un valor que el curso no dice no aparece en ninguna parte', () => {
    expect(
      barrerValores({
        valores: [{ old: 'formulario F-12', new: 'formulario F-20' }],
        lecciones: LECCIONES,
        preguntas: [...PREGUNTAS.values()].flat()
      })
    ).toEqual([]);
  });
});
