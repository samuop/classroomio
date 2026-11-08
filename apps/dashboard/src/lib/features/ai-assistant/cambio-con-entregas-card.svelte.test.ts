import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';

import CambioConEntregasCard, { type PropuestaConEntregas } from './cambio-con-entregas-card.svelte';
import { getCompletedToolLine } from './utils/tool-labels';
import { t } from '$lib/utils/functions/translations';

/**
 * La tarjeta de un cambio que toca notas.
 *
 * Medido en producción (2026-11-07): doce preguntas agregadas a un examen ya
 * rendido bajaron cincuenta notas de ~87 % a ~42 %, y la docente sólo vio
 * «Cambió las preguntas (3 veces)». Ahora el servidor no escribe sin su
 * aprobación, y esto es lo que ella ve: el efecto, y los dos botones.
 *
 * Curso inventado, de un almacén que no existe.
 */

const red = vi.hoisted(() => ({
  leer: vi.fn(),
  resolver: vi.fn()
}));

vi.mock('$lib/utils/services/api', () => ({
  classroomio: {
    agent: {
      proposals: {
        ':proposalId': {
          $get: red.leer,
          resolve: { $post: red.resolver }
        }
      }
    }
  }
}));

const texto = (clave: string, valores?: Record<string, unknown>) => get(t)(clave, valores);
const respuesta = (cuerpo: unknown, status = 200) => ({ status, json: async () => cuerpo });

const PROPUESTA: PropuestaConEntregas = {
  status: 'needs_teacher_approval',
  proposalId: '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b',
  exerciseTitle: 'Examen final',
  impact: {
    tipo: 'agregar',
    entregas: 50,
    maximoAntes: 12,
    maximoDespues: 25,
    promedioAntes: 87,
    promedioDespues: 42,
    agregadas: { cantidad: 12, puntos: 13 }
  }
};
const CURSO = '00000000-0000-4000-8000-00000000c002';

beforeEach(() => {
  red.leer.mockReset().mockResolvedValue(respuesta({ success: true, data: { estado: 'pendiente' } }));
  red.resolver.mockReset();
});

describe('la tarjeta de un cambio que toca notas', () => {
  it('dice el efecto con números: cuántas entregas, el máximo y el promedio antes y después', async () => {
    render(CambioConEntregasCard, { propuesta: PROPUESTA, courseId: CURSO });

    expect(await screen.findByRole('button', { name: texto('ai_assistant.graded_change.approve') })).toBeTruthy();
    expect(screen.getByText(texto('ai_assistant.graded_change.exercise', { title: 'Examen final', count: 50 }))).toBeTruthy();
    expect(screen.getByText(texto('ai_assistant.graded_change.add', { count: 12, points: 13 }))).toBeTruthy();
    expect(screen.getByText(texto('ai_assistant.graded_change.max', { before: 12, after: 25 }), { exact: false })).toBeTruthy();
    expect(
      screen.getByText(texto('ai_assistant.graded_change.average', { before: 87, after: 42 }), { exact: false })
    ).toBeTruthy();
    expect(red.leer).toHaveBeenCalledWith({ param: { proposalId: PROPUESTA.proposalId }, query: { courseId: CURSO } });
  });

  it('«Aprobar» lo manda al servidor y muestra que se aplicó, sin dejar los botones', async () => {
    red.resolver.mockResolvedValue(respuesta({ success: true, data: { estado: 'aplicada' } }));
    render(CambioConEntregasCard, { propuesta: PROPUESTA, courseId: CURSO });

    await fireEvent.click(await screen.findByRole('button', { name: texto('ai_assistant.graded_change.approve') }));

    expect(red.resolver).toHaveBeenCalledWith({
      param: { proposalId: PROPUESTA.proposalId },
      json: { courseId: CURSO, decision: 'approve' }
    });
    expect(await screen.findByText(texto('ai_assistant.graded_change.applied'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: texto('ai_assistant.graded_change.approve') })).toBeNull();
  });

  it('«Cancelar» no aplica nada y lo dice', async () => {
    red.resolver.mockResolvedValue(respuesta({ success: true, data: { estado: 'cancelada' } }));
    render(CambioConEntregasCard, { propuesta: PROPUESTA, courseId: CURSO });

    await fireEvent.click(await screen.findByRole('button', { name: texto('ai_assistant.graded_change.cancel') }));

    expect(red.resolver).toHaveBeenCalledWith(expect.objectContaining({ json: { courseId: CURSO, decision: 'cancel' } }));
    expect(await screen.findByText(texto('ai_assistant.graded_change.cancelled'))).toBeTruthy();
  });

  it('una propuesta ya resuelta (otra pestaña, o antes de recargar) no vuelve a ofrecer los botones', async () => {
    red.leer.mockResolvedValue(respuesta({ success: true, data: { estado: 'aplicada' } }));
    render(CambioConEntregasCard, { propuesta: PROPUESTA, courseId: CURSO });

    expect(await screen.findByText(texto('ai_assistant.graded_change.applied'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: texto('ai_assistant.graded_change.approve') })).toBeNull();
  });

  it('si la decisión no llega al servidor, lo dice y deja volver a intentar', async () => {
    red.resolver.mockRejectedValue(new Error('sin red'));
    render(CambioConEntregasCard, { propuesta: PROPUESTA, courseId: CURSO });

    await fireEvent.click(await screen.findByRole('button', { name: texto('ai_assistant.graded_change.approve') }));

    expect(await screen.findByText(texto('ai_assistant.graded_change.error'))).toBeTruthy();
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: texto('ai_assistant.graded_change.approve') }) as HTMLButtonElement).disabled
      ).toBe(false)
    );
  });

  it('en la lista de trabajo, un borrado propuesto no dice «Ejercicio borrado»', () => {
    // Sin esto la línea de la herramienta contaba como hecho lo que sólo quedó propuesto.
    expect(getCompletedToolLine('delete_exercise', { ...PROPUESTA, title: 'Examen final' })).toEqual({
      shape: 'i18n',
      key: 'ai_assistant.tool.done.needs_approval',
      vars: { title: 'Examen final' }
    });
  });

  it('borrar un ejercicio con entregas dice que se pierden', async () => {
    render(CambioConEntregasCard, {
      propuesta: { ...PROPUESTA, impact: { ...PROPUESTA.impact, tipo: 'borrar', maximoDespues: 0, agregadas: undefined } },
      courseId: CURSO
    });

    expect(await screen.findByText(texto('ai_assistant.graded_change.delete'))).toBeTruthy();
  });
});
