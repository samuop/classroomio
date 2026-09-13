import { herramientasDelPaso } from '@api/services/agent/student-final-step';
import { describe, expect, it } from 'vitest';

/**
 * Un estudiante nunca se queda sin respuesta por agotar los pasos.
 *
 * Con 12 pasos y una pregunta que el curso no cubre, el tutor gastaba los 12 en
 * búsquedas y lecturas y la ronda cerraba sin texto. El último paso va sin
 * herramientas para que conteste con lo que ya tiene.
 */
describe('herramientasDelPaso', () => {
  it('le saca las herramientas al estudiante en el último paso', () => {
    // stepNumber es base 0: con 12 pasos, el último es el 11.
    expect(herramientasDelPaso({ esEstudiante: true, paso: 11, maximoDePasos: 12 })).toEqual({ toolChoice: 'none' });
  });

  it('lo deja buscar y leer en los pasos anteriores', () => {
    for (const paso of [0, 5, 10]) {
      expect(herramientasDelPaso({ esEstudiante: true, paso, maximoDePasos: 12 })).toEqual({});
    }
  });

  it('no toca la ronda del docente, que se retoma con «Continuar»', () => {
    expect(herramientasDelPaso({ esEstudiante: false, paso: 39, maximoDePasos: 40 })).toEqual({});
  });
});
