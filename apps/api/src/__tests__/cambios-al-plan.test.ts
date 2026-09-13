import { pideCambiosAlPlan } from '@api/services/agent/plan-revision';

/**
 * El pedido de cambios al plan se reconoce por la marca del mensaje, no por lo
 * que dice: con esa marca el servidor obliga al agente a devolver un plan.
 */

const docente = (metadata?: object) => ({ role: 'user', metadata });
const asistente = (metadata?: object) => ({ role: 'assistant', metadata });

describe('reconocer un pedido de cambios al plan', () => {
  it('lo reconoce en el último mensaje del docente', () => {
    expect(pideCambiosAlPlan([docente(), asistente(), docente({ plan: { action: 'request_plan_changes' } })])).toBe(true);
  });

  it('un mensaje posterior sin la marca ya no es un pedido de cambios', () => {
    expect(pideCambiosAlPlan([docente({ plan: { action: 'request_plan_changes' } }), asistente(), docente()])).toBe(
      false
    );
  });

  it('aprobar el plan no es pedirle cambios', () => {
    expect(pideCambiosAlPlan([docente({ plan: { action: 'implement_course_plan' } })])).toBe(false);
  });

  it('la metadata de una respuesta del asistente no cuenta', () => {
    expect(pideCambiosAlPlan([docente({ plan: { action: 'request_plan_changes' } }), asistente({ plan: {} })])).toBe(
      true
    );
    expect(pideCambiosAlPlan([asistente({ plan: { action: 'request_plan_changes' } })])).toBe(false);
  });

  it('sin mensajes no hay nada que forzar', () => {
    expect(pideCambiosAlPlan([])).toBe(false);
  });
});
