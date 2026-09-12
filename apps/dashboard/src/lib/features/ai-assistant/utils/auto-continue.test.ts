import {
  decidirContinuacion,
  frenoArmado,
  frenoInicial,
  MAX_RONDAS_AUTOMATICAS,
  type MensajeParaContinuar
} from './auto-continue';

/**
 * La continuación automática de una construcción.
 *
 * Lo que más importa acá es el primer test. El caso que lo motiva no pasó
 * todavía, y ese es el punto: durante meses la continuación automática no se
 * disparó nunca porque el servidor no mandaba el progreso del plan. Al
 * arreglarlo revive, y en una conversación vieja donde el docente borró una
 * lección del plan, un pedido cualquiera termina con «plan incompleto». Si
 * arrancara encendida, reconstruiría sola lo que el docente borró.
 */

function respuesta(id: string, completed: number, total = 21): MensajeParaContinuar {
  return {
    id,
    role: 'assistant',
    metadata: { continuation: { reason: 'incomplete_plan' }, planProgress: { total, completed } }
  };
}

describe('la continuación automática arranca apagada', () => {
  it('una conversación vieja con el plan incompleto NO sigue construyendo sola', () => {
    // El docente abre el panel sobre una conversación donde se construyó un
    // curso de 21 ítems y después borró uno. Pide editar un diagrama; la
    // ronda termina y el servidor, que ve el ítem borrado, dice 20 de 21.
    expect(decidirContinuacion(frenoInicial(), respuesta('edicion-suelta', 20))).toEqual({ tipo: 'esperar' });
  });

  it('aprobar un plan la enciende', () => {
    const decision = decidirContinuacion(frenoArmado(), respuesta('ronda-1', 10));

    expect(decision).toEqual({
      tipo: 'continuar',
      freno: { habilitada: true, rondas: 1, avanceAnterior: 10, respondidoA: 'ronda-1' }
    });
  });
});

describe('los frenos', () => {
  it('no dispara dos veces por el mismo mensaje', () => {
    const primera = decidirContinuacion(frenoArmado(), respuesta('ronda-1', 10));
    if (primera.tipo !== 'continuar') throw new Error('tenía que continuar');

    expect(decidirContinuacion(primera.freno, respuesta('ronda-1', 10))).toEqual({ tipo: 'esperar' });
  });

  it('frena si una ronda automática no completó nada', () => {
    const freno = { habilitada: true, rondas: 3, avanceAnterior: 10, respondidoA: 'ronda-3' };

    expect(decidirContinuacion(freno, respuesta('ronda-4', 10))).toEqual({ tipo: 'frenar' });
  });

  it('frena en el tope de rondas aunque siga avanzando', () => {
    const freno = { habilitada: true, rondas: MAX_RONDAS_AUTOMATICAS, avanceAnterior: 10, respondidoA: 'x' };

    expect(decidirContinuacion(freno, respuesta('y', 15))).toEqual({ tipo: 'frenar' });
  });

  it('una vez frenada, no vuelve a arrancar por su cuenta', () => {
    const frenada = { habilitada: false, rondas: 2, avanceAnterior: 10, respondidoA: 'ronda-2' };

    expect(decidirContinuacion(frenada, respuesta('ronda-3', 14))).toEqual({ tipo: 'esperar' });
  });
});

describe('sólo decide sobre progreso medido por el servidor', () => {
  it('sin aviso de continuación, espera', () => {
    const sinAviso = { id: 'a', role: 'assistant', metadata: { planProgress: { total: 21, completed: 10 } } };

    expect(decidirContinuacion(frenoArmado(), sinAviso)).toEqual({ tipo: 'esperar' });
  });

  it('sin progreso del plan, espera — que es lo que pasaba siempre antes del arreglo', () => {
    const sinProgreso = { id: 'a', role: 'assistant', metadata: { continuation: { reason: 'step_limit' } } };

    expect(decidirContinuacion(frenoArmado(), sinProgreso)).toEqual({ tipo: 'esperar' });
  });

  it('con el plan completo, espera', () => {
    expect(decidirContinuacion(frenoArmado(), respuesta('fin', 21))).toEqual({ tipo: 'esperar' });
  });

  it('un mensaje del docente no dispara nada', () => {
    const delDocente = { ...respuesta('u', 10), role: 'user' };

    expect(decidirContinuacion(frenoArmado(), delDocente)).toEqual({ tipo: 'esperar' });
  });
});
