import {
  AVISO_DE_ULTIMO_PASO,
  cerrarConRespuesta,
  esUltimoPasoDelEstudiante,
  recortarContextoDelPaso
} from '@api/services/agent/student-final-step';
import { describe, expect, it } from 'vitest';

/**
 * Un estudiante nunca se queda sin respuesta por agotar los pasos.
 *
 * Con 12 pasos y una pregunta que el curso no cubre, el tutor gastaba los 12 en
 * búsquedas y lecturas y la ronda cerraba sin texto. En el último paso no hay
 * herramientas y se le pide contestar con lo que ya tiene: sacar sólo las
 * herramientas, o sólo pedir `toolChoice: 'none'`, no alcanzó con el modelo real.
 */
describe('esUltimoPasoDelEstudiante', () => {
  it('marca el último paso del estudiante', () => {
    // stepNumber es base 0: con 12 pasos, el último es el 11.
    expect(esUltimoPasoDelEstudiante({ esEstudiante: true, paso: 11, maximoDePasos: 12 })).toBe(true);
  });

  it('lo deja buscar y leer en los pasos anteriores', () => {
    for (const paso of [0, 5, 10]) {
      expect(esUltimoPasoDelEstudiante({ esEstudiante: true, paso, maximoDePasos: 12 })).toBe(false);
    }
  });

  it('no toca la ronda del docente, que se retoma con «Continuar»', () => {
    expect(esUltimoPasoDelEstudiante({ esEstudiante: false, paso: 39, maximoDePasos: 40 })).toBe(false);
  });
});

describe('recortarContextoDelPaso', () => {
  it('nunca le recorta el contexto al estudiante: lo que leyó tiene que seguir ahí al contestar', () => {
    for (const paso of [0, 5, 11]) {
      expect(recortarContextoDelPaso({ esEstudiante: true, paso })).toBe(false);
    }
  });

  it('al docente le recorta desde el paso 5, como antes', () => {
    expect(recortarContextoDelPaso({ esEstudiante: false, paso: 4 })).toBe(false);
    expect(recortarContextoDelPaso({ esEstudiante: false, paso: 5 })).toBe(true);
  });
});

describe('cerrarConRespuesta', () => {
  const conversacion = [{ role: 'user', content: '¿Puedo usar el estacionamiento?' }];

  it('saca todas las herramientas y pide la respuesta al final de la conversación', () => {
    const cierre = cerrarConRespuesta(conversacion);

    expect(cierre.activeTools).toEqual([]);
    expect(cierre.messages.at(-1)).toEqual({ role: 'user', content: AVISO_DE_ULTIMO_PASO });
    expect(cierre.messages.slice(0, -1)).toEqual(conversacion);
  });

  it('no modifica la conversación que recibe', () => {
    cerrarConRespuesta(conversacion);
    expect(conversacion).toHaveLength(1);
  });
});
