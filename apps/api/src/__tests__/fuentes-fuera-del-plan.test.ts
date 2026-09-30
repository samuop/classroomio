import { describe, expect, it } from 'vitest';

import { momentoDeLaRondaAnterior } from '@api/services/agent/fuentes-fuera-del-plan';

/**
 * Hasta cuándo ya se avisó de las fuentes que llegaron después del plan.
 *
 * El aviso va sólo en las rondas que construyen. Una charla entre el plan y la
 * aprobación no avisó nada: si contara como «ronda anterior», la fuente que
 * llegó antes de esa charla no se avisaría nunca.
 */

const plan = { id: 'a1', role: 'assistant', metadata: { finishedAt: '2026-09-29T15:43:30.000Z' }, parts: [] };
const charla = { id: 'a2', role: 'assistant', metadata: { finishedAt: '2026-09-29T15:50:00.000Z' }, parts: [] };
const aprobacion = { id: 'u3', role: 'user', metadata: { plan: { action: 'implement_course_plan' } }, parts: [] };
const primeraRonda = { id: 'a3', role: 'assistant', metadata: { finishedAt: '2026-09-29T16:00:00.000Z' }, parts: [] };
const seguir = { id: 'u4', role: 'user', parts: [] };

describe('la ronda de construcción anterior', () => {
  it('en la primera ronda después de aprobar no hay ninguna: se avisa todo, aunque antes haya habido una charla', () => {
    expect(momentoDeLaRondaAnterior([plan, charla, aprobacion])).toBeUndefined();
  });

  it('en las siguientes, la última respuesta después de la aprobación', () => {
    expect(momentoDeLaRondaAnterior([plan, charla, aprobacion, primeraRonda, seguir])).toBe('2026-09-29T16:00:00.000Z');
  });
});
