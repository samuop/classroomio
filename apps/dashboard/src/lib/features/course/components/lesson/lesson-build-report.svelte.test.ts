import { render } from '@testing-library/svelte';

import LessonBuildReport from './lesson-build-report.svelte';

/**
 * La tarjeta que dice de qué está hecha una lección.
 *
 * ── Qué se está fijando ──────────────────────────────────────────────────────
 *
 * Que el docente pueda VER lo que el sistema ya sabía y se guardaba para sí:
 * con qué fuentes se escribió la lección, qué afirmaciones no pudo respaldar y
 * qué avisó quien la escribió. Antes eso viajaba al modelo, que lo contaba en
 * prosa en el chat y se perdía hacia arriba — así que el párrafo salido de un
 * documento y el relleno plausible se leían con la misma autoridad.
 *
 * Los dos casos que importan son opuestos y los dos tienen que verse: una
 * lección CON fuentes (se nombran) y una SIN fuentes (se dice, en vez de
 * callarlo, que es como una lección inventada pasa por buena).
 */
describe('de qué está hecha la lección', () => {
  it('sin informe no dibuja nada: una lección vieja no muestra una tarjeta vacía', () => {
    const { container } = render(LessonBuildReport, { props: { report: null } });

    expect(container.querySelector('section')).toBeNull();
  });

  it('nombra las fuentes con las que se escribió', () => {
    const { getByText } = render(LessonBuildReport, {
      props: { report: { sources: ['Organigrama actual.pdf', 'Manual de convivencia.pdf'], groundingWarnings: [] } }
    });

    expect(getByText('Organigrama actual.pdf')).toBeTruthy();
    expect(getByText('Manual de convivencia.pdf')).toBeTruthy();
  });

  /**
   * Con fecha, que NO es un detalle del caso feliz.
   *
   * La primera versión de este archivo nunca pasaba `builtAt`, así que nunca
   * llegaba a llamar al formateador de fechas — y el import de ese formateador
   * apuntaba a un módulo que no lo exporta. Los tests pasaron en verde y el
   * build del dashboard se cayó en el deploy: vitest deja un import inexistente
   * como `undefined` hasta que alguien lo usa; Rollup lo corta al compilar.
   *
   * O sea: un test que no ejercita una rama tampoco protege sus imports.
   */
  it('muestra la fecha, que es lo que ejercita el formateador', () => {
    const { container } = render(LessonBuildReport, {
      props: { report: { sources: [], groundingWarnings: [], builtAt: '2026-09-12T04:30:00.000Z' } }
    });

    expect(container.textContent).toMatch(/\d/);
  });

  /**
   * El caso que motivó todo: una lección escrita sin ninguna fuente del curso.
   * Callarlo la deja indistinguible de una fundada.
   */
  it('cuando no hubo fuentes lo dice, no lo omite', () => {
    const { container } = render(LessonBuildReport, { props: { report: { sources: [], groundingWarnings: [] } } });

    expect(container.textContent).toContain('sin fuentes del curso');
  });

  it('lista las afirmaciones sin respaldo', () => {
    const { container } = render(LessonBuildReport, {
      props: {
        report: {
          sources: ['Organigrama actual.pdf'],
          groundingWarnings: ['«la Gerencia de Personas y Cultura» no figura en el organigrama']
        }
      }
    });

    expect(container.textContent).toContain('Gerencia de Personas y Cultura');
  });

  it('muestra el aviso de quien la escribió', () => {
    const { container } = render(LessonBuildReport, {
      props: { report: { sources: [], groundingWarnings: [], writerNote: 'Falta el manual de depósito.' } }
    });

    expect(container.textContent).toContain('Falta el manual de depósito.');
  });

  /**
   * El informe viene de una columna de clave abierta: una fila vieja o un campo
   * con otra forma no puede tumbar la pantalla de la lección.
   */
  it('aguanta un informe con basura adentro', () => {
    const { container } = render(LessonBuildReport, {
      props: { report: { sources: 'no es una lista', groundingWarnings: [null, 42, ''], writerNote: 7 } }
    });

    expect(container.querySelector('section')).not.toBeNull();
    expect(container.querySelectorAll('li').length).toBe(0);
  });
});
