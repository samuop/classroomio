import { describe, expect, it } from 'vitest';

import type { PlanProgress, PlanProgressItem } from '@api/services/agent/chat-context';
import { conElPlanPendiente } from '@api/services/agent/plan-antes-de-publicar';
import type { CourseGoLiveReadiness } from '@api/services/course/go-live-readiness';

/**
 * El chequeo de publicación, en una ronda que construye un plan aprobado.
 *
 * Medido en producción el 2026-09-30: con 6 de 20 piezas hechas el constructor
 * fue a ver si el curso estaba listo, leyó «falta la imagen de portada», se
 * ocupó de la portada y cerró con «el curso ha sido construido en su
 * totalidad». Lo que el chequeo tiene que decir primero es lo que falta del plan.
 */

const SOLO_FALTA_LA_PORTADA: CourseGoLiveReadiness = {
  ready: false,
  blockers: [{ code: 'LANDING_IMAGE_MISSING', message: 'Add a landing-page banner or course image.', target: 'course.logo' }],
  warnings: [],
  suggestedFixes: {}
};

function avance(items: PlanProgressItem[]): PlanProgress {
  const completed = items.filter((i) => i.status === 'done').length;
  return {
    anchorText: '',
    pendingCount: items.filter((i) => i.status === 'missing').length,
    emptyCount: items.filter((i) => i.status === 'empty').length,
    misorderedCount: 0,
    items,
    total: items.length,
    completed
  };
}

const pieza = (key: string, kind: PlanProgressItem['kind'], title: string, status: PlanProgressItem['status']) => ({
  key,
  kind,
  title,
  status
});

describe('el chequeo de publicación con un plan en construcción', () => {
  it('sin plan, o con el plan terminado, contesta sólo por la publicación', () => {
    expect(conElPlanPendiente(SOLO_FALTA_LA_PORTADA, undefined)).toBe(SOLO_FALTA_LA_PORTADA);
    expect(conElPlanPendiente(SOLO_FALTA_LA_PORTADA, avance([pieza('s1', 'section', 'Caja', 'done')]))).toBe(
      SOLO_FALTA_LA_PORTADA
    );
  });

  it('con piezas que faltan, el plan va primero y lo demás queda', () => {
    const chequeo = conElPlanPendiente(
      { ...SOLO_FALTA_LA_PORTADA, ready: true, blockers: [] },
      avance([
        pieza('s1', 'section', 'Caja', 'empty'),
        pieza('s1.1', 'lesson', 'Abrir la caja', 'done'),
        pieza('s1.2', 'lesson', 'Hacer el arqueo', 'empty'),
        pieza('s1.3', 'exercise', 'Práctica de arqueo', 'missing'),
        pieza('s2', 'section', 'Cierre', 'missing')
      ])
    );

    expect(chequeo.ready).toBe(false);
    expect(chequeo.blockers.map((b) => b.code)).toEqual(['PLAN_INCOMPLETE']);
    expect(chequeo.blockers[0].message).toContain('only 1 of its 5 items are built');
    // La sección que existe no se nombra —se nombran sus piezas—; la que falta, sí.
    expect(chequeo.blockers[0].message).toContain(
      'Next: «Hacer el arqueo» (lesson, created but empty); «Práctica de arqueo» (exercise, not created yet); «Cierre» (section, not created yet).'
    );
    expect(chequeo.blockers[0].message).not.toContain('«Caja»');
  });

  it('conserva los bloqueos del curso, después del plan', () => {
    const chequeo = conElPlanPendiente(SOLO_FALTA_LA_PORTADA, avance([pieza('s1.1', 'lesson', 'Abrir la caja', 'missing')]));

    expect(chequeo.blockers.map((b) => b.code)).toEqual(['PLAN_INCOMPLETE', 'LANDING_IMAGE_MISSING']);
  });

  it('nombra las cinco que siguen y cuenta el resto', () => {
    const lecciones = Array.from({ length: 14 }, (_, i) => pieza(`s1.${i + 1}`, 'lesson', `Lección ${i + 1}`, 'missing'));
    const mensaje = conElPlanPendiente(SOLO_FALTA_LA_PORTADA, avance(lecciones)).blockers[0].message;

    expect(mensaje).toContain('«Lección 5» (lesson, not created yet), and 9 more.');
    expect(mensaje).not.toContain('«Lección 6»');
  });
});
