import {
  AVISO_DE_ULTIMO_PASO,
  AVISO_DE_ULTIMO_PASO_DOCENTE,
  avisoDeCierre,
  cerrarConRespuesta,
  esUltimoPasoDeLaRonda,
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
describe('esUltimoPasoDeLaRonda', () => {
  it('marca el último paso del estudiante', () => {
    // stepNumber es base 0: con 12 pasos, el último es el 11.
    expect(esUltimoPasoDeLaRonda({ paso: 11, maximoDePasos: 12 })).toBe(true);
  });

  it('lo deja buscar y leer en los pasos anteriores', () => {
    for (const paso of [0, 5, 10]) {
      expect(esUltimoPasoDeLaRonda({ paso, maximoDePasos: 12 })).toBe(false);
    }
  });

  /**
   * La ronda del docente también cierra con palabras.
   *
   * Quedaba afuera a propósito, porque se retoma con «Continuar» —y se sigue
   * retomando—. Lo que el botón no trae es el juicio del modelo sobre lo que
   * acaba de hacer: medido en producción el 2026-09-15, las dos rondas de una
   * construcción terminaron con 40 llamadas a herramienta y ni una palabra, y la
   * última gastó su paso 40 creando un examen vacío en vez de avisarlo.
   */
  it('también marca el último paso de la ronda del docente', () => {
    expect(esUltimoPasoDeLaRonda({ paso: 39, maximoDePasos: 40 })).toBe(true);
    expect(esUltimoPasoDeLaRonda({ paso: 38, maximoDePasos: 40 })).toBe(false);
  });
});

describe('avisoDeCierre', () => {
  it('al estudiante le pide contestar la pregunta con lo que ya leyó', () => {
    expect(avisoDeCierre(true)).toBe(AVISO_DE_ULTIMO_PASO);
    expect(avisoDeCierre(true)).toMatch(/learner/);
  });

  /**
   * Un ejercicio creado sin preguntas EXISTE, así que no se «extraña»: si el
   * aviso sólo hablara de lo que falta, el modelo podría cerrar diciendo que
   * está todo hecho. Por eso el del docente nombra lo vacío aparte.
   */
  it('al docente le pide rendir cuentas, nombrando lo vacío además de lo faltante', () => {
    const aviso = avisoDeCierre(false);

    expect(aviso).toBe(AVISO_DE_ULTIMO_PASO_DOCENTE);
    // Sobre la frase del PEDIDO, no sobre el «or empty» de la advertencia final:
    // con un /empty/ suelto el test pasaba aunque el pedido dejara de nombrarlo.
    expect(aviso).toMatch(/say what you built, what is still missing or created-but-empty/);
    expect(aviso).not.toMatch(/learner/);
  });

  it('los dos avisos son distintos: el rol no puede llevarse el del estudiante por defecto', () => {
    expect(avisoDeCierre(false)).not.toBe(avisoDeCierre(true));
  });
});

describe('recortarContextoDelPaso', () => {
  const PRESUPUESTO = 500_000;

  it('no recorta lo que el modelo leyó mientras haya lugar: ni en el primer paso ni con la ronda avanzada', () => {
    for (const tokensDelPasoAnterior of [undefined, 0, 60_000, 300_000, 424_999]) {
      expect(recortarContextoDelPaso({ tokensDelPasoAnterior, presupuesto: PRESUPUESTO })).toBe(false);
    }
  });

  it('recorta recién con el contexto casi lleno, para que el proveedor no rechace el pedido', () => {
    expect(recortarContextoDelPaso({ tokensDelPasoAnterior: 425_000, presupuesto: PRESUPUESTO })).toBe(true);
    expect(recortarContextoDelPaso({ tokensDelPasoAnterior: 600_000, presupuesto: PRESUPUESTO })).toBe(true);
  });

  it('el umbral sigue al presupuesto, no es un número fijo', () => {
    expect(recortarContextoDelPaso({ tokensDelPasoAnterior: 180_000, presupuesto: 200_000 })).toBe(true);
    expect(recortarContextoDelPaso({ tokensDelPasoAnterior: 180_000, presupuesto: PRESUPUESTO })).toBe(false);
  });
});

describe('cerrarConRespuesta', () => {
  const conversacion = [{ role: 'user', content: '¿Puedo usar el estacionamiento?' }];

  it('saca todas las herramientas y pide la respuesta al final de la conversación', () => {
    const cierre = cerrarConRespuesta(conversacion, AVISO_DE_ULTIMO_PASO);

    expect(cierre.activeTools).toEqual([]);
    expect(cierre.messages.at(-1)).toEqual({ role: 'user', content: AVISO_DE_ULTIMO_PASO });
    expect(cierre.messages.slice(0, -1)).toEqual(conversacion);
  });

  it('usa el aviso que le pasan, no uno fijo', () => {
    const cierre = cerrarConRespuesta(conversacion, AVISO_DE_ULTIMO_PASO_DOCENTE);

    expect(cierre.messages.at(-1)).toEqual({ role: 'user', content: AVISO_DE_ULTIMO_PASO_DOCENTE });
  });

  it('no modifica la conversación que recibe', () => {
    cerrarConRespuesta(conversacion, AVISO_DE_ULTIMO_PASO);
    expect(conversacion).toHaveLength(1);
  });
});
