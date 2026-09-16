import { fireEvent, render, screen } from '@testing-library/svelte';
import { get } from 'svelte/store';

import CourseCreatorWizard from './course-creator-wizard.svelte';
import { t } from '$lib/utils/functions/translations';

/**
 * La pantalla con la que empieza un curso.
 *
 * Era un formulario de dos pasos, y el primero pedía —en su texto de ejemplo—
 * las dos cosas que el segundo volvía a preguntar en campos propios: para quién
 * es y qué tienen que poder hacer al terminar. Ahora es una sola pantalla.
 *
 * Lo que fija este test es eso: que todo se pregunte una vez y en el mismo
 * lugar, y que no se pueda construir un curso sin las dos cosas que el agente
 * necesita para no frenar a preguntar (el tema y el público).
 */
const texto = (clave: string) => get(t)(clave);

function campoPorEtiqueta(etiqueta: string): HTMLElement {
  const rotulo = screen.getByText(etiqueta);
  const campo = rotulo.parentElement?.querySelector('input, textarea');

  if (!campo) throw new Error(`No hay campo bajo "${etiqueta}"`);

  return campo as HTMLElement;
}

describe('el formulario de creación de un curso', () => {
  it('pregunta todo en una sola pantalla, sin pasos', () => {
    render(CourseCreatorWizard);

    // Las cuatro preguntas, juntas: descripción, público, objetivo y material.
    expect(screen.getByText(texto('course.creator.guide.describe_label'))).toBeInTheDocument();
    expect(screen.getByText(texto('course.creator.guide.audience.who_label'))).toBeInTheDocument();
    expect(screen.getByText(texto('course.creator.guide.audience.outcome_label'))).toBeInTheDocument();
    expect(screen.getByText(texto('course.creator.guide.source.document_label'))).toBeInTheDocument();

    // Y un solo botón: el de construir. Sin "Continuar" ni "Volver", que eran
    // los que escondían la mitad de las preguntas.
    expect(screen.getByRole('button', { name: texto('course.creator.guide.build_button') })).toBeInTheDocument();
  });

  it('no deja construir hasta que hay tema y público', async () => {
    render(CourseCreatorWizard);

    const boton = screen.getByRole('button', { name: texto('course.creator.guide.build_button') });
    expect(boton).toBeDisabled();

    await fireEvent.input(campoPorEtiqueta(texto('course.creator.guide.describe_label')), {
      target: { value: 'Cómo se maneja la caja en las sucursales' }
    });

    // Con el tema solo no alcanza: sin público, el agente frena y lo pregunta.
    expect(boton).toBeDisabled();

    await fireEvent.input(campoPorEtiqueta(texto('course.creator.guide.audience.who_label')), {
      target: { value: 'Cajeras y cajeros de sucursal' }
    });

    expect(boton).toBeEnabled();
  });

  it('el objetivo es opcional: no bloquea la construcción', async () => {
    render(CourseCreatorWizard);

    await fireEvent.input(campoPorEtiqueta(texto('course.creator.guide.describe_label')), {
      target: { value: 'Manejo de caja' }
    });
    await fireEvent.input(campoPorEtiqueta(texto('course.creator.guide.audience.who_label')), {
      target: { value: 'Cajeras' }
    });

    expect(screen.getByRole('button', { name: texto('course.creator.guide.build_button') })).toBeEnabled();
    expect((campoPorEtiqueta(texto('course.creator.guide.audience.outcome_label')) as HTMLTextAreaElement).value).toBe(
      ''
    );
  });
});
