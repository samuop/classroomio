import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Que una lección nombre una fuente que existe no dice que la fuente trate el
 * tema: se mide.
 *
 * ── Lo que se midió (producción, 2026-09-29) ─────────────────────────────────
 *
 * El chequeo de cobertura daba por cubierta toda lección que declarara una
 * fuente existente. Las dos lecciones de tablas dinámicas —un objetivo que la
 * docente pidió explícitamente— citaban el temario de un curso ajeno, que nombra
 * el tema en un renglón y nada más. El agente le dijo que su material cubría 11
 * de 13 lecciones y sólo le preguntó por las otras dos.
 *
 * Ahora se buscan en la fuente declarada las oraciones que hablan del tema, y
 * si no llegan a unos pocos párrafos la lección es de «fuente débil»: entra en
 * la nota que obliga a preguntarle a la docente antes de construir.
 *
 * Fuentes y plan inventados.
 */

vi.mock('isomorphic-dompurify', () => ({
  default: new Proxy({}, { get: () => (valor: unknown) => valor })
}));

vi.mock('@api/utils/tinybird', () => ({
  trackAgentEvent: vi.fn(),
  AgentEvent: new Proxy({}, { get: (_, clave) => String(clave) })
}));

vi.mock('@cio/db/queries/agent/chat-document', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/agent/chat-document')>()),
  listCourseSources: vi.fn()
}));

import { listCourseSources } from '@cio/db/queries/agent/chat-document';
import { buildAgentTools } from '@api/services/agent/chat-tools';
import {
  PROSA_MINIMA_DEL_TEMA,
  avisoDeCobertura,
  medirCobertura,
  prosaDelTema
} from '@api/services/agent/plan-coverage';

/** Un temario: nombra el tema en un renglón, en una tabla, con su bibliografía. */
const TEMARIO = {
  id: 'fuente-temario',
  fileName: 'Temario del taller de oficina',
  text:
    '## Taller de oficina\n\n' +
    '| Unidad | Contenido | Estrategia |\n' +
    '| --- | --- | --- |\n' +
    '| 1. PLANILLAS 1.1. Filas y columnas 1.2. Formato de celdas 1.3. Filtros automáticos 1.4. Tablas dinámicas | Clases prácticas con ejercicios de la vida laboral | Proyector |\n' +
    '| 2. PRESENTACIONES 2.1. Diapositivas 2.2. Transiciones | Trabajo en grupos pequeños con devolución | Aula |\n\n' +
    'Bibliografía: https://ejemplo.org/tablas-dinamicas-paso-a-paso • https://ejemplo.org/filtros'
};

/** Una guía que de verdad enseña el tema. */
const GUIA = {
  id: 'fuente-guia',
  fileName: 'Guía de tablas dinámicas',
  text:
    'Una tabla dinámica resume una lista de datos agrupando las filas por uno o más campos que vos elegís.\n\n' +
    'Para crearla, seleccioná una celda de la lista y elegí la opción de insertar una tabla dinámica; la planilla propone el rango completo de la lista.\n\n' +
    'En el panel de campos arrastrás el campo Turno al área de filas y el campo Importe al área de valores, y la tabla suma los importes de cada turno.\n\n' +
    'Cuando agregás filas nuevas a la lista, la tabla dinámica no se actualiza sola: hay que pedirle que se actualice para que tome los datos nuevos.\n\n' +
    'Si la lista tiene filas en blanco en el medio, la tabla dinámica deja afuera los importes que quedan del otro lado del hueco, y el total sale más bajo.'
};

const LECCION_DEL_TEMARIO = {
  type: 'lesson' as const,
  title: 'Crear una tabla dinámica por turno',
  description: 'Armar una tabla dinámica a partir del registro diario para resumir los importes por turno.',
  sources: [TEMARIO.fileName]
};

const LECCION_DE_LA_GUIA = {
  type: 'lesson' as const,
  title: 'Resumir importes con una tabla dinámica',
  description: 'Usar el panel de campos para sumar los importes de cada turno.',
  sources: [GUIA.fileName]
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cuánta prosa sobre el tema trae la fuente', () => {
  it('el temario que sólo nombra el tema no llega; la guía que lo enseña, sí', () => {
    expect(prosaDelTema(LECCION_DEL_TEMARIO, [TEMARIO])).toBeLessThan(PROSA_MINIMA_DEL_TEMA);
    expect(prosaDelTema(LECCION_DE_LA_GUIA, [GUIA])).toBeGreaterThanOrEqual(PROSA_MINIMA_DEL_TEMA);
  });

  it('la misma lección contra la guía también llega: lo que se mide es la fuente, no el título', () => {
    expect(prosaDelTema(LECCION_DEL_TEMARIO, [GUIA])).toBeGreaterThanOrEqual(PROSA_MINIMA_DEL_TEMA);
  });
});

describe('la lección de fuente débil entra en la nota que manda a preguntar', () => {
  it('se cuenta aparte, con la fuente que cita', () => {
    const medida = medirCobertura([LECCION_DEL_TEMARIO, LECCION_DE_LA_GUIA], [TEMARIO, GUIA]);

    expect(medida.cubiertas).toBe(1);
    expect(medida.sinFuente).toEqual([]);
    expect(medida.debiles).toEqual([
      expect.objectContaining({ item: LECCION_DEL_TEMARIO.title, fuentes: [TEMARIO.fileName] })
    ]);
  });

  it('y la nota la nombra y frena la construcción', () => {
    const aviso = avisoDeCobertura(medirCobertura([LECCION_DEL_TEMARIO, LECCION_DE_LA_GUIA], [TEMARIO, GUIA]), 2);

    expect(aviso).toContain(LECCION_DEL_TEMARIO.title);
    expect(aviso).toContain(TEMARIO.fileName);
    expect(aviso).toMatch(/only mentions their topic/);
    expect(aviso).toMatch(/Do NOT start building yet/);
  });

  it('sin el texto de las fuentes no se inventa una conclusión: se contrasta sólo el nombre', () => {
    const sinTexto = [TEMARIO, GUIA].map(({ id, fileName }) => ({ id, fileName }));
    const medida = medirCobertura([LECCION_DEL_TEMARIO, LECCION_DE_LA_GUIA], sinTexto);

    expect(medida.debiles).toEqual([]);
    expect(medida.cubiertas).toBe(2);
  });
});

describe('generate_course_plan mide con el texto de las fuentes', () => {
  it('devuelve las lecciones de fuente débil en la cobertura del plan', async () => {
    vi.mocked(listCourseSources).mockResolvedValue([TEMARIO, GUIA] as never);

    const herramientas = buildAgentTools('org', 'usuario', 'curso', [], {
      conversationId: 'conversacion',
      locale: 'es'
    }) as Record<string, { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> }>;

    const resultado = await herramientas.generate_course_plan.execute(
      {
        plan: {
          title: 'Planillas para el mostrador',
          sections: [
            {
              title: 'Resúmenes',
              order: 0,
              items: [
                { ...LECCION_DEL_TEMARIO, order: 0, hasExercise: false },
                { ...LECCION_DE_LA_GUIA, order: 1, hasExercise: false }
              ]
            },
            {
              title: 'Examen final',
              order: 1,
              items: [{ type: 'exercise', title: 'Examen final', description: 'Evaluación integradora.', order: 0 }]
            }
          ]
        }
      },
      { toolCallId: 'llamada', messages: [] }
    );

    const cobertura = resultado.coverage as Record<string, unknown>;

    expect(cobertura).toMatchObject({
      lessonsWithSource: 1,
      lessonsWithWeakSource: [
        expect.objectContaining({ lesson: LECCION_DEL_TEMARIO.title, sources: [TEMARIO.fileName] })
      ]
    });
    expect(String(cobertura.note)).toMatch(/Do NOT start building yet/);
  });
});
