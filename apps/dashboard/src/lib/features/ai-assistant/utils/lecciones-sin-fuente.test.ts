import { CoursePlanSchema } from '@cio/ai-assistant';

import type { CoursePlan } from './course-plan';
import { leccionesSinFuente, quitarLeccionesSinFuente } from './lecciones-sin-fuente';

/**
 * Aprobar un plan con lecciones que no tienen material atrás (contrato C5).
 *
 * ── Qué se fija ──────────────────────────────────────────────────────────────
 *
 * «Sacarlas del plan» tiene que dejar un plan que el servidor acepte: sin
 * secciones vacías, con el examen final en la última sección, y validado con
 * el MISMO esquema. Y las lecciones se ubican por posición: la docente puede
 * haber editado sus títulos antes de aprobar, y la cobertura las nombra por el
 * título original.
 *
 * Curso inventado.
 */

const leccion = (title: string, order: number, extra: Record<string, unknown> = {}) => ({
  type: 'lesson' as const,
  title,
  description: `Qué se ve en «${title}».`,
  order,
  hasExercise: false,
  ...extra
});

const examen = (order: number) => ({
  type: 'exercise' as const,
  title: 'Examen final',
  description: 'Una pregunta por sección.',
  order,
  hasExercise: false
});

function plan(): CoursePlan {
  return {
    title: 'Caja en sucursales',
    sections: [
      {
        title: 'Apertura',
        order: 0,
        items: [leccion('Arqueo inicial', 0, { sources: ['Manual de caja.pdf'] }), leccion('Asistente en la planilla', 1, { sources: [] })]
      },
      { title: 'Herramientas nuevas', order: 1, items: [leccion('Pedirle un resumen al asistente', 0, { sources: [] })] },
      { title: 'Cierre', order: 2, items: [leccion('Cierre de caja', 0, { sources: ['Manual de caja.pdf'] }), examen(1)] }
    ],
    coverage: {
      sourcesAttached: 1,
      lessonsWithSource: 2,
      lessonsWithoutSource: ['Asistente en la planilla', 'Pedirle un resumen al asistente'],
      note: 'Do NOT start building yet.'
    }
  };
}

describe('las lecciones sin fuente de un plan', () => {
  it('se ubican por posición', () => {
    expect(leccionesSinFuente(plan()).map(({ seccion, item }) => [seccion, item])).toEqual([
      [0, 1],
      [1, 0]
    ]);
  });

  it('con el título que la docente editó, y el original para la cobertura', () => {
    const editado = plan();
    editado.sections[0].items[1].title = 'El asistente dentro de la planilla';

    const encontradas = leccionesSinFuente(plan(), editado);

    expect(encontradas[0]).toMatchObject({ titulo: 'El asistente dentro de la planilla', tituloOriginal: 'Asistente en la planilla' });
  });

  it('sin cobertura, o con todo cubierto, no hay ninguna', () => {
    const sinCobertura = { ...plan(), coverage: undefined };
    const cubierto = { ...plan(), coverage: { ...plan().coverage!, lessonsWithoutSource: [] } };

    expect(leccionesSinFuente(sinCobertura)).toEqual([]);
    expect(leccionesSinFuente(cubierto)).toEqual([]);
  });

  it('una pieza que se retoca no cuenta: el servidor sólo midió lo que se crea', () => {
    const conRetoque = plan();
    conRetoque.sections[0].items[1] = { ...conRetoque.sections[0].items[1], action: 'edit', target: 'S1.L2', changes: 'x' };

    expect(leccionesSinFuente(conRetoque).map(({ seccion }) => seccion)).toEqual([1]);
  });
});

describe('sacarlas del plan', () => {
  it('saca esas lecciones y la sección que se queda vacía, y renumera', () => {
    const resultado = quitarLeccionesSinFuente(plan(), leccionesSinFuente(plan()));

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.plan.sections.map((s) => s.title)).toEqual(['Apertura', 'Cierre']);
    expect(resultado.plan.sections.map((s) => s.order)).toEqual([0, 1]);
    expect(resultado.plan.sections[0].items.map((i) => i.title)).toEqual(['Arqueo inicial']);
    // El examen final sigue en la última sección.
    expect(resultado.plan.sections.at(-1)?.items.some((i) => i.type === 'exercise')).toBe(true);
  });

  it('el resultado pasa el esquema del plan que usa el servidor', () => {
    const resultado = quitarLeccionesSinFuente(plan(), leccionesSinFuente(plan()));

    expect(resultado.ok && CoursePlanSchema.safeParse(resultado.plan).success).toBe(true);
  });

  it('la cobertura que viaja ya no nombra lo que se sacó, aunque se haya editado el título', () => {
    const editado = plan();
    editado.sections[0].items[1].title = 'El asistente dentro de la planilla';

    const resultado = quitarLeccionesSinFuente(editado, leccionesSinFuente(plan(), editado));

    expect(resultado.ok && resultado.plan.coverage?.lessonsWithoutSource).toEqual([]);
  });

  it('no toca el plan que recibe', () => {
    const original = plan();
    quitarLeccionesSinFuente(original, leccionesSinFuente(original));

    expect(original.sections).toHaveLength(3);
    expect(original.sections[0].items).toHaveLength(2);
  });

  it('si el plan no quedaría válido, no se aprueba nada', () => {
    // Un plan de cambios cuyas únicas piezas nuevas no tienen fuente: sacarlas
    // lo deja sin secciones, y el esquema exige al menos una.
    const cambios: CoursePlan = {
      title: 'Agregar un módulo',
      scope: 'changes',
      sections: [{ title: 'Módulo nuevo', order: 0, items: [leccion('Tema sin material', 0, { sources: [] })] }],
      coverage: { sourcesAttached: 1, lessonsWithSource: 0, lessonsWithoutSource: ['Tema sin material'] }
    };

    expect(quitarLeccionesSinFuente(cambios, leccionesSinFuente(cambios))).toEqual({ ok: false });
  });

  it('sin nada para sacar, el mismo plan', () => {
    const original = plan();

    expect(quitarLeccionesSinFuente(original, [])).toEqual({ ok: true, plan: original });
  });
});
