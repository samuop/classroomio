import { describe, expect, it } from 'vitest';

import type { TCoursePdfData, TCoursePdfLesson } from '@cio/db/queries/course';
import { arrangeCourse, buildCoursePdfHtml, prepareLessonHtml } from '@api/services/course/course-pdf';

// 23:30 del 28 de octubre en Argentina; ya es 29 en UTC.
const NOW = new Date('2026-10-29T02:30:00.000Z');

function lesson(overrides: Partial<TCoursePdfLesson> & { id: string }): TCoursePdfLesson {
  return {
    sectionId: null,
    title: `Lección ${overrides.id}`,
    order: 1,
    content: null,
    documents: [],
    videos: [],
    slideUrl: null,
    ...overrides
  };
}

function data(): TCoursePdfData {
  return {
    course: {
      id: 'curso',
      title: 'Curso <Prueba>',
      description: 'Primera línea\nSegunda línea',
      metadata: { goals: '<p>Atender bien la caja</p>' },
      orgName: 'Empresa Ejemplo'
    },
    sections: [
      { id: 's2', title: 'Cierre', order: 2 },
      { id: 's1', title: 'Apertura', order: 1 }
    ],
    lessons: [
      lesson({ id: 'l2', sectionId: 's1', order: 2, title: 'Cobrar con tarjeta', content: '<p>Texto de cobro</p>' }),
      lesson({ id: 'l1', sectionId: 's1', order: 1, title: 'Abrir la caja', content: '<p>Texto de apertura</p>' }),
      lesson({ id: 'l3', sectionId: 's2', order: 1, title: 'Cerrar el turno', content: '<p>Texto de cierre</p>' })
    ],
    exercises: [
      {
        id: 'e1',
        sectionId: 's1',
        lessonId: null,
        title: 'Cuestionario de caja',
        description: null,
        order: 3,
        questions: [
          {
            id: 1,
            exerciseId: 'e1',
            title: '¿Qué se controla primero?',
            order: 1,
            typename: 'RADIO',
            settings: {},
            options: [
              { label: 'El cambio inicial', isCorrect: true },
              { label: 'La góndola', isCorrect: false }
            ]
          },
          {
            id: 2,
            exerciseId: 'e1',
            title: '¿Cuánto vale z?',
            order: 2,
            typename: 'NUMERIC',
            settings: { correctValue: 2.05, tolerance: 0.1 },
            options: []
          },
          {
            id: 3,
            exerciseId: 'e1',
            title: '¿Dónde se guarda el efectivo?',
            order: 3,
            typename: 'SHORT_ANSWER',
            settings: { correctAnswers: ['buzón'] },
            options: []
          }
        ]
      },
      {
        id: 'e2',
        sectionId: null,
        lessonId: 'l3',
        title: 'Control de cierre',
        description: null,
        order: 1,
        questions: []
      }
    ]
  };
}

const between = (html: string, from: string, to: string) => html.slice(html.indexOf(from), html.indexOf(to));

describe('arrangeCourse', () => {
  it('orders sections and interleaves lessons and exercises by their own order', () => {
    const blocks = arrangeCourse(data());

    expect(blocks.map((block) => block.title)).toEqual(['Apertura', 'Cierre']);
    expect(blocks[0].items.map((item) => (item.kind === 'lesson' ? item.lesson.id : item.exercise.id))).toEqual([
      'l1',
      'l2',
      'e1'
    ]);
  });

  it('puts an exercise that only points at a lesson right after that lesson', () => {
    const blocks = arrangeCourse(data());

    expect(blocks[1].items.map((item) => (item.kind === 'lesson' ? item.lesson.id : item.exercise.id))).toEqual([
      'l3',
      'e2'
    ]);
  });

  it('keeps content without a section in a trailing block instead of dropping it', () => {
    const course = data();
    course.lessons.push(lesson({ id: 'suelta', title: 'Lección suelta' }));

    const blocks = arrangeCourse(course);

    expect(blocks.at(-1)?.title).toBe('Otros contenidos');
    expect(blocks.at(-1)?.items).toHaveLength(1);
  });
});

describe('buildCoursePdfHtml', () => {
  it('outline: lists sections, numbered lessons and exercises, but not the lesson text', () => {
    const html = buildCoursePdfHtml(data(), { scope: 'outline', exercises: 'none' }, NOW);

    expect(html).toContain('Temario del curso');
    expect(html).toContain('Sección 1. Apertura');
    expect(html).toContain('1.1 Abrir la caja');
    expect(html).toContain('1.2 Cobrar con tarjeta');
    expect(html).toContain('2.1 Cerrar el turno');
    expect(html).toContain('Evaluación: Cuestionario de caja <span class="tipo-item">(3 preguntas)</span>');
    expect(html).not.toContain('Texto de apertura');
    expect(html).not.toContain('<h2>Evaluaciones</h2>');
  });

  it('full: adds every lesson with its text, in course order', () => {
    const html = buildCoursePdfHtml(data(), { scope: 'full', exercises: 'none' }, NOW);
    const content = html.slice(html.indexOf('<section class="seccion">'));

    expect(html).toContain('Contenido del curso');
    expect(content.indexOf('Texto de apertura')).toBeLessThan(content.indexOf('Texto de cobro'));
    expect(content.indexOf('Texto de cobro')).toBeLessThan(content.indexOf('Texto de cierre'));
  });

  it('leaves the questions out when exercises are not wanted', () => {
    const html = buildCoursePdfHtml(data(), { scope: 'full', exercises: 'none' }, NOW);

    expect(html).not.toContain('¿Qué se controla primero?');
  });

  it('shows the questions without giving away the answers', () => {
    const html = buildCoursePdfHtml(data(), { scope: 'full', exercises: 'questions' }, NOW);

    expect(html).toContain('¿Qué se controla primero?');
    expect(html).toContain('El cambio inicial');
    expect(html).not.toContain('(correcta)');
    expect(html).not.toContain('class="opcion correcta"');
    expect(html).not.toContain('2,05');
    expect(html).not.toContain('buzón</p>');
  });

  it('marks every kind of correct answer when asked to', () => {
    const html = buildCoursePdfHtml(data(), { scope: 'full', exercises: 'answers' }, NOW);
    const question = between(html, '¿Qué se controla primero?', '¿Cuánto vale z?');

    expect(question).toContain(
      '<li class="opcion correcta"><span class="marca circulo"></span><span>El cambio inicial <span class="etiqueta-correcta">(correcta)</span>'
    );
    expect(question).toContain('<li class="opcion"><span class="marca circulo"></span><span>La góndola</span></li>');
    expect(html).toContain('Respuesta: 2,05 (± 0,1)');
    expect(html).toContain('Respuestas aceptadas: buzón');
  });

  it('outline with exercises: appends them as an annex after the outline', () => {
    const html = buildCoursePdfHtml(data(), { scope: 'outline', exercises: 'questions' }, NOW);

    expect(html.indexOf('<h2>Evaluaciones</h2>')).toBeGreaterThan(html.indexOf('<h2>Temario</h2>'));
    expect(html).toContain('¿Qué se controla primero?');
    expect(html).not.toContain('Texto de apertura');
  });

  it('escapes the course title instead of treating it as markup', () => {
    const html = buildCoursePdfHtml(data(), { scope: 'outline', exercises: 'none' }, NOW);

    expect(html).toContain('<h1>Curso &lt;Prueba&gt;</h1>');
    expect(html).not.toContain('<Prueba>');
  });

  it('dates the document in Argentina time, not in the server clock', () => {
    const html = buildCoursePdfHtml(data(), { scope: 'outline', exercises: 'none' }, NOW);

    expect(html).toContain('Generado el 28 de octubre de 2026');
  });
});

describe('prepareLessonHtml', () => {
  const base = lesson({
    id: 'l',
    documents: [{ id: 'doc-checklist', name: 'Checklist de apertura.pdf', link: 'https://example.com/a.pdf' }]
  });

  it('removes scripts and event handlers before the server browser sees them', () => {
    const html = prepareLessonHtml('<p>Hola</p><script>fetch("http://127.0.0.1:3081")</script><img src="https://x.test/a.png" onerror="alert(1)">', base);

    expect(html).toContain('<p>Hola</p>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
  });

  it('only keeps images served over https or inline', () => {
    const html = prepareLessonHtml(
      '<img src="http://127.0.0.1:3081/admin"><img src="https://files.example.com/a.png"><img src="data:image/png;base64,AAAA">',
      base
    );

    expect(html).not.toContain('127.0.0.1');
    expect(html).toContain('https://files.example.com/a.png');
    expect(html).toContain('data:image/png;base64,AAAA');
  });

  it('draws formulas as MathML from their data-latex', () => {
    const html = prepareLessonHtml('<p>Con <span data-type="inline-math" data-latex="z = 2{,}05"></span> alcanza.</p>', base);

    expect(html).toContain('<math');
    expect(html).not.toContain('data-latex');
  });

  it('names an attachment placed in the text instead of leaving an empty box', () => {
    const html = prepareLessonHtml('<div data-cio-media="document" data-cio-media-id="doc-checklist"></div>', base);

    expect(html).toContain('<p class="material">Documento: Checklist de apertura.pdf</p>');
  });
});
