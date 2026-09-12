import type { ToolSet } from 'ai';

import {
  AVISO_DESDE_FRACCION,
  avisoDePresupuesto,
  conAvisoDePresupuesto,
  type PresupuestoDePasos
} from '@api/services/agent/step-budget';
import { decidirSiGenerarImagen, MAX_IMAGES_PER_ROUND } from '@api/services/agent/image-generation';

/**
 * Los dos techos de la ronda, y por qué el número no era el problema.
 *
 * ── Lo que se midió (producción, 2026-09-12) ─────────────────────────────────
 *
 * 1. Una ronda para ilustrar CUATRO lecciones generó OCHO imágenes: una por
 *    lección —que se insertaron— y después las mismas cuatro otra vez, con el
 *    subject reformulado, que se pagaron y no se usaron. La novena llamada fue
 *    la única que el tope frenó, con el gasto ya hecho.
 *
 * 2. Una ronda de 40 pasos para corregir tres lecciones gastó 38 en lecturas
 *    (12 de ellas releyendo las MISMAS dos fuentes) e hizo 2 de las 8 ediciones
 *    que le faltaban.
 *
 * ── La conclusión, que es lo que estos tests fijan ───────────────────────────
 *
 * Los techos no estaban mal puestos: eran lo único que cortó los dos bucles. El
 * problema es la FORMA de la protección. Un tope global por ronda está
 * dimensionado para el peor caso, así que en el caso común regala margen para
 * desperdiciar y frena después del daño. Subirlos —el instinto— habría dado 8
 * huérfanas y 70 pasos perdidos.
 *
 * Así que: la regla pasa a ser por TRABAJO (una imagen por lección, que la
 * herramienta puede ver porque recibe el lessonId), y el presupuesto de pasos
 * pasa a ser VISIBLE para quien lo gasta.
 */

describe('una imagen por lección, no ocho por ronda', () => {
  it('genera la primera imagen de una lección', () => {
    expect(
      decidirSiGenerarImagen({ lessonId: 'a', yaIlustradas: new Set(), generadasEnLaRonda: 0 })
    ).toEqual({ generar: true });
  });

  it('rechaza la SEGUNDA imagen de la misma lección, con margen de sobra en la ronda', () => {
    // El caso medido, exacto: cuatro lecciones ilustradas, tope de 8, y el
    // modelo vuelve a pedir la primera. El tope global no lo ve porque no sabe
    // de qué lección se trata; sobran cuatro unidades de margen.
    const decision = decidirSiGenerarImagen({
      lessonId: 'a',
      yaIlustradas: new Set(['a', 'b', 'c', 'd']),
      generadasEnLaRonda: 4
    });

    expect(decision).toEqual({ generar: false, motivo: 'ya_tiene_imagen' });
  });

  it('deja ilustrar una lección distinta en la misma ronda', () => {
    // Lo que NO tiene que hacer: la regla es una por lección, no una por ronda.
    expect(
      decidirSiGenerarImagen({ lessonId: 'e', yaIlustradas: new Set(['a', 'b', 'c', 'd']), generadasEnLaRonda: 4 })
    ).toEqual({ generar: true });
  });

  it('sigue respetando el tope de la ronda', () => {
    const decision = decidirSiGenerarImagen({
      lessonId: 'nueva',
      yaIlustradas: new Set(['1', '2', '3', '4', '5', '6', '7', '8']),
      generadasEnLaRonda: MAX_IMAGES_PER_ROUND
    });

    expect(decision).toEqual({ generar: false, motivo: 'tope_de_ronda' });
  });

  it('la lección ya ilustrada gana al tope de ronda, porque el motivo es más útil', () => {
    // Los dos aplican; el que se le dice al modelo tiene que ser el que le
    // explica qué hacer ("ya la tiene, seguí con la que viene") y no el que
    // suena a que se quedó sin cupo.
    expect(
      decidirSiGenerarImagen({
        lessonId: 'a',
        yaIlustradas: new Set(['a']),
        generadasEnLaRonda: MAX_IMAGES_PER_ROUND
      })
    ).toEqual({ generar: false, motivo: 'ya_tiene_imagen' });
  });

  it('una imagen sin lección sólo responde al tope de ronda', () => {
    // La portada de un curso no tiene lección contra la que contarse.
    expect(decidirSiGenerarImagen({ yaIlustradas: new Set(['a']), generadasEnLaRonda: 0 })).toEqual({
      generar: true
    });
  });
});

describe('el presupuesto de pasos, visible para quien lo gasta', () => {
  it('no dice nada al principio de la ronda', () => {
    // Un aviso en cada uno de los primeros treinta pasos no cambia ninguna
    // decisión, y el ruido constante se deja de leer.
    expect(avisoDePresupuesto({ paso: 1, maxPasos: 40 })).toBeUndefined();
    expect(avisoDePresupuesto({ paso: 29, maxPasos: 40 })).toBeUndefined();
  });

  it('avisa a partir de tres cuartos de la ronda', () => {
    const aviso = avisoDePresupuesto({ paso: 30, maxPasos: 40 });

    expect(aviso).toContain('30 of 40');
    expect(aviso).toContain('10 left');
  });

  it('dice cuántos quedan, no sólo dónde está', () => {
    // El número que decide qué hacer es el que queda, no el consumido.
    expect(avisoDePresupuesto({ paso: 38, maxPasos: 40 })).toContain('2 left');
  });

  it('en el último paso pide cerrar, en vez de sugerir aprovechar lo que queda', () => {
    // No queda ninguno: decirle que "gaste los que quedan en cambios" seria
    // mentirle, y lo unico util ahi es que diga qué hizo y qué falta.
    const aviso = avisoDePresupuesto({ paso: 40, maxPasos: 40 });

    expect(aviso).toContain('LAST step');
    expect(aviso).not.toContain('left in this round');
  });

  it('empuja hacia los cambios y en contra de releer', () => {
    // Es lo que se midió: 38 de 40 pasos en lecturas, 12 sobre las mismas dos
    // fuentes. El aviso tiene que nombrar eso, no ser un contador pelado.
    const aviso = avisoDePresupuesto({ paso: 35, maxPasos: 40 });

    expect(aviso).toMatch(/CHANGES/);
    expect(aviso).toMatch(/re-reading/);
  });

  it('escala con el techo en vez de asumir 40', () => {
    // La ronda del alumno tiene 12. Un umbral absoluto en 30 no avisaría nunca.
    expect(avisoDePresupuesto({ paso: 5, maxPasos: 12 })).toBeUndefined();
    expect(avisoDePresupuesto({ paso: 9, maxPasos: 12 })).toContain('9 of 12');
  });

  it('el umbral es la fracción declarada, no un número suelto', () => {
    const maxPasos = 100;
    const primerAviso = Math.ceil(maxPasos * AVISO_DESDE_FRACCION);

    expect(avisoDePresupuesto({ paso: primerAviso - 1, maxPasos })).toBeUndefined();
    expect(avisoDePresupuesto({ paso: primerAviso, maxPasos })).toBeDefined();
  });

  it('no se cae con números imposibles', () => {
    // Llega de `stepNumber + 1`: si algún día eso viene raro, el aviso se
    // calla en vez de tumbar la herramienta que lo estaba devolviendo.
    expect(avisoDePresupuesto({ paso: 0, maxPasos: 40 })).toBeUndefined();
    expect(avisoDePresupuesto({ paso: 5, maxPasos: 0 })).toBeUndefined();
    expect(avisoDePresupuesto({ paso: Number.NaN, maxPasos: 40 })).toBeUndefined();
  });
});

/**
 * El envoltorio que lleva el aviso a los resultados.
 *
 * Es la mitad frágil de este cambio: el aviso puede calcularse perfecto y no
 * llegar nunca, o llegar pisando algo que la herramienta ya devolvía. Y la
 * ronda es lo que lo hace delicado — el presupuesto es un objeto MUTABLE que
 * `prepareStep` actualiza entre paso y paso, así que el envoltorio tiene que
 * leerlo en el momento de devolver y no al construirse.
 */
describe('el aviso llega a los resultados de las herramientas', () => {
  const herramientaFalsa = (resultado: unknown): ToolSet =>
    ({
      probar: { description: 'una herramienta', execute: async () => resultado }
    }) as unknown as ToolSet;

  const ejecutar = async (herramientas: ToolSet) => {
    const tool = herramientas.probar as unknown as { execute: () => Promise<unknown> };
    return tool.execute();
  };

  it('agrega el aviso cuando la ronda está por terminarse', async () => {
    const envueltas = conAvisoDePresupuesto(herramientaFalsa({ ok: true }), { paso: 38, maxPasos: 40 });

    expect(await ejecutar(envueltas)).toMatchObject({ ok: true, stepBudget: expect.stringContaining('38 of 40') });
  });

  it('no agrega nada al principio de la ronda', async () => {
    const envueltas = conAvisoDePresupuesto(herramientaFalsa({ ok: true }), { paso: 2, maxPasos: 40 });

    expect(await ejecutar(envueltas)).toEqual({ ok: true });
  });

  it('lee el paso al DEVOLVER, no al construirse', async () => {
    // Lo que hace `prepareStep`: el mismo ToolSet vive toda la ronda y el
    // contador avanza por debajo. Si el envoltorio capturara el número al
    // construirse, el aviso diría "paso 1" hasta el final y no avisaria nunca.
    const presupuesto: PresupuestoDePasos = { paso: 1, maxPasos: 40 };
    const envueltas = conAvisoDePresupuesto(herramientaFalsa({ ok: true }), presupuesto);

    expect(await ejecutar(envueltas)).toEqual({ ok: true });

    presupuesto.paso = 39;

    expect(await ejecutar(envueltas)).toMatchObject({ stepBudget: expect.stringContaining('39 of 40') });
  });

  it('no toca un resultado que no es un objeto', async () => {
    // Hay herramientas que devuelven una lista o un texto. Meterle una clave
    // la convertiría en otra cosa.
    const lista = conAvisoDePresupuesto(herramientaFalsa([1, 2, 3]), { paso: 39, maxPasos: 40 });
    const texto = conAvisoDePresupuesto(herramientaFalsa('listo'), { paso: 39, maxPasos: 40 });

    expect(await ejecutar(lista)).toEqual([1, 2, 3]);
    expect(await ejecutar(texto)).toBe('listo');
  });

  it('conserva la descripción y todo lo demás de la herramienta', async () => {
    // Si el envoltorio se comiera el `description` o el `inputSchema`, el
    // modelo dejaría de saber para qué sirve la herramienta — y eso no lo
    // reporta nadie: simplemente dejaría de usarla bien.
    const envueltas = conAvisoDePresupuesto(herramientaFalsa({ ok: true }), { paso: 1, maxPasos: 40 });

    expect((envueltas.probar as unknown as { description: string }).description).toBe('una herramienta');
  });

  it('deja pasar una entrada sin execute en vez de romperla', async () => {
    const sinExecute = { probar: { description: 'sin execute' } } as unknown as ToolSet;

    expect(conAvisoDePresupuesto(sinExecute, { paso: 39, maxPasos: 40 }).probar).toBe(sinExecute.probar);
  });
});
