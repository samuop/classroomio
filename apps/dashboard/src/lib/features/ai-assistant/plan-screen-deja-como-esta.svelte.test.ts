import { render } from '@testing-library/svelte';

import PlanScreen from './plan-screen.svelte';
import { pantallaDelPlan } from './utils/plan-screen.svelte';
import type { CoursePlan } from './utils/course-plan';

/**
 * Lo que el plan deja AFUERA también se lee.
 *
 * ── Por qué ──────────────────────────────────────────────────────────────────
 *
 * El servidor niega un plan de cambios que calle una pieza donde el análisis
 * encontró el valor viejo (2026-09-22: el curso quedó enseñando el valor nuevo
 * en la sección 1 y el viejo en la 2 y en el examen). La única salida legítima
 * es declararlo con `skip` y su motivo — y esa salida sólo sirve si el docente
 * la VE antes de aprobar: si se dibujara igual que un ítem que sí se cambia,
 * aprobaría creyendo que se toca algo que no se va a tocar.
 *
 * Curso inventado.
 */

const plan: CoursePlan = {
  title: 'Actualización de la circular',
  scope: 'changes',
  sections: [
    {
      title: 'Mesa de Ayuda',
      order: 0,
      sectionId: 'S1',
      items: [
        {
          type: 'lesson',
          title: 'Quién atiende cada reclamo',
          description: 'Actualizar el canal de contacto.',
          order: 0,
          hasExercise: false,
          action: 'edit',
          target: 'S1.L1',
          changes: 'El interno pasa a WhatsApp.'
        },
        {
          type: 'exercise',
          title: 'Autoevaluación de la mesa',
          description: 'Queda igual.',
          order: 1,
          hasExercise: false,
          action: 'edit',
          target: 'S1.E1',
          skip: true,
          changes: 'La docente pidió no tocar la autoevaluación hasta el cierre del mes.'
        }
      ]
    }
  ]
};

describe('la pantalla del plan de cambios', () => {
  afterEach(() => {
    pantallaDelPlan.cerrar();
  });

  it('marca como «se deja como está» el ítem que no se va a tocar, con su motivo', () => {
    pantallaDelPlan.mostrar({ id: 'call-1', plan });

    const { container } = render(PlanScreen);

    expect(container.textContent).toContain('Se deja como está: La docente pidió no tocar la autoevaluación');
    // Y el ítem que sí cambia se sigue leyendo como lo que cambia, sin etiqueta.
    expect(container.textContent).toContain('El interno pasa a WhatsApp.');
    expect(container.textContent).not.toContain('Se deja como está: El interno');
  });
});
