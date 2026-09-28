import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';

import Widget from './my-goals-widget.svelte';
import { programGoalApi } from '$features/program/api';

/**
 * «Tus objetivos» en el muro del programa, montado.
 *
 * Con un objetivo que vencía en más de un día, el texto «Vencimiento en {days}
 * días» se pedía sin la variable y el formateador de mensajes tiraba: el muro del
 * programa entero caía en «Se rompió esta pantalla» para el alumno (visto en
 * producción el 2026-09-28).
 */

const EN_CINCO_DIAS = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000 - 60 * 1000).toISOString();

beforeEach(() => {
  vi.spyOn(programGoalApi, 'listMyGoals').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  programGoalApi.myGoals = [];
});

describe('los objetivos del alumno', () => {
  it('muestra en cuántos días vence sin romper la pantalla', async () => {
    programGoalApi.myGoals = [
      {
        id: 'asignacion-1',
        programId: 'programa-1',
        programName: 'Obras',
        status: 'in_progress',
        completedCount: 0,
        requiredCount: 1,
        dueDate: EN_CINCO_DIAS,
        goal: { title: 'Seguridad en la obra aprobada antes de entrar' }
      } as never
    ];

    render(Widget, { props: { programId: 'programa-1' } });
    await tick();

    expect(screen.getByText('Seguridad en la obra aprobada antes de entrar')).toBeInTheDocument();
    expect(screen.getByText('Vencimiento en 5 días')).toBeInTheDocument();
  });
});
