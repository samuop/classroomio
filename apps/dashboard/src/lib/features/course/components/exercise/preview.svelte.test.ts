import { render } from '@testing-library/svelte';

import Preview from './preview.svelte';

/**
 * Corregir un envío al que le falta una nota.
 *
 * `Grade` declara `grade = $bindable(0)`, con valor por defecto, y este
 * componente hace `bind:grade={grades[pregunta.id]}`. Svelte 5 prohíbe atar un
 * `undefined` a una prop con fallback: tira `props_invalid_value`, que no es un
 * aviso sino un error de render — el modal de corrección entero se cae y el
 * docente ve la pantalla de error en lugar del envío.
 *
 * No hace falta un caso raro para llegar: alcanza una pregunta sin puntaje
 * registrado, como una agregada al cuestionario después de que el alumno
 * entregó.
 */

function pregunta(id: number, order: number) {
  return {
    id,
    order,
    title: `Pregunta ${order}`,
    points: 5,
    questionTypeId: 1,
    options: []
  } as never;
}

it('abre el envío aunque falte la nota de una pregunta', () => {
  const questions = [pregunta(1, 1), pregunta(2, 2)];

  // La primera tiene nota, la segunda no: es el envío que rompía.
  const grades: Record<string, number> = { '1': 3 };

  expect(() =>
    render(Preview, {
      props: {
        questions,
        grades,
        disableGrading: false,
        questionnaireMetaData: { answers: {}, isFinished: true }
      }
    })
  ).not.toThrow();
});

it('no inventa un cero donde nadie corrigió', () => {
  // El arreglo fácil era rellenar los huecos con 0 y seguir. Pero "todavía no
  // la corregí" y "le puse cero" no son lo mismo, y con el hueco relleno el
  // docente no puede distinguirlos: la casilla vacía es la información.
  const questions = [pregunta(1, 1), pregunta(2, 2)];
  const grades: Record<string, number> = { '1': 3 };

  render(Preview, {
    props: {
      questions,
      grades,
      disableGrading: false,
      questionnaireMetaData: { answers: {}, isFinished: true }
    }
  });

  expect(grades['1']).toBe(3);
  expect(grades['2']).toBeUndefined();
});

it('tampoco rompe cuando el envío se está sólo mirando', () => {
  const questions = [pregunta(1, 1), pregunta(2, 2)];
  const grades: Record<string, number> = { '1': 3 };

  expect(() =>
    render(Preview, {
      props: {
        questions,
        grades,
        disableGrading: true,
        questionnaireMetaData: { answers: {}, isFinished: true }
      }
    })
  ).not.toThrow();
});
