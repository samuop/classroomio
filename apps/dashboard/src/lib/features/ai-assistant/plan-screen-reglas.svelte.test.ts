import { fireEvent, render, screen } from '@testing-library/svelte';
import { get } from 'svelte/store';

import PlanScreen from './plan-screen.svelte';
import { pantallaDelPlan } from './utils/plan-screen.svelte';
import type { CoursePlan } from './utils/course-plan';
import { t } from '$lib/utils/functions/translations';

/**
 * Las reglas de la docente en la pantalla del plan.
 *
 * Quien construye el curso no ve la conversación: sólo el plan. Una regla que
 * la docente dijo en el chat y que el asistente no anotó no le llega a nadie
 * (medido el 2026-11-03). Acá la ve antes de aprobar y la puede agregar.
 */

vi.mock('$features/ai-assistant/api/ai-assistant.svelte', () => ({
  aiAssistantApi: { status: { usage: { remaining: 500_000 } } }
}));

const texto = (clave: string, valores?: Record<string, unknown>) => get(t)(clave, valores);

function plan(teacherRules?: string[]): CoursePlan {
  return {
    title: 'Venta en salón',
    sections: [
      {
        title: 'Atender',
        order: 0,
        items: [
          { type: 'lesson', title: 'Recibir al cliente', description: 'Saludo.', order: 0, hasExercise: false },
          { type: 'exercise', title: 'Examen final', description: 'Todo.', order: 1, hasExercise: false }
        ]
      }
    ],
    ...(teacherRules ? { teacherRules } : {})
  };
}

function abrir(propuesto: CoursePlan, aprobado = false) {
  const aprobar = vi.fn();
  const desconectar = pantallaDelPlan.conectar({ aprobar, pedirCambios: () => {} });

  pantallaDelPlan.mostrar({ id: 'call-1', plan: propuesto });
  pantallaDelPlan.sincronizar({ vigente: { id: 'call-1', plan: propuesto }, aprobado, ocupado: false, progreso: null });

  render(PlanScreen);

  return { aprobar, desconectar };
}

describe('las reglas de la docente en el plan', () => {
  let desconectar = () => {};

  afterEach(() => {
    desconectar();
    pantallaDelPlan.cerrar();
  });

  it('se ven antes de aprobar, se pueden agregar, y viajan limpias en la aprobación', async () => {
    const abierto = abrir(plan(['No enseñes la matriz de descuentos como vigente.']));
    desconectar = abierto.desconectar;

    expect(screen.getByText(texto('ai_assistant.plan_screen.teacher_rules'))).toBeInTheDocument();
    expect(screen.getByDisplayValue('No enseñes la matriz de descuentos como vigente.')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: texto('ai_assistant.plan_screen.add_teacher_rule') }));
    await fireEvent.input(screen.getByRole('textbox', { name: texto('ai_assistant.plan_screen.teacher_rule', { order: 2 }) }), {
      target: { value: '  No inventes una política de devoluciones.  ' }
    });
    // Una tercera que queda vacía no viaja.
    await fireEvent.click(screen.getByRole('button', { name: texto('ai_assistant.plan_screen.add_teacher_rule') }));

    await fireEvent.click(screen.getByRole('button', { name: texto('ai_assistant.plan_screen.approve') }));

    expect(abierto.aprobar).toHaveBeenCalledTimes(1);
    expect(abierto.aprobar.mock.calls[0][0].teacherRules).toEqual([
      'No enseñes la matriz de descuentos como vigente.',
      'No inventes una política de devoluciones.'
    ]);
  });

  it('una regla se puede quitar', async () => {
    const abierto = abrir(plan(['Sin precios.', 'Sólo lo que dicen las fuentes.']));
    desconectar = abierto.desconectar;

    await fireEvent.click(
      screen.getByRole('button', { name: texto('ai_assistant.plan_screen.remove_teacher_rule', { order: 1 }) })
    );
    await fireEvent.click(screen.getByRole('button', { name: texto('ai_assistant.plan_screen.approve') }));

    expect(abierto.aprobar.mock.calls[0][0].teacherRules).toEqual(['Sólo lo que dicen las fuentes.']);
  });

  it('un plan sin reglas lo dice, y deja agregar la primera', () => {
    desconectar = abrir(plan()).desconectar;

    expect(screen.getByText(texto('ai_assistant.plan_screen.no_teacher_rules'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: texto('ai_assistant.plan_screen.add_teacher_rule') })).toBeInTheDocument();
  });
});
