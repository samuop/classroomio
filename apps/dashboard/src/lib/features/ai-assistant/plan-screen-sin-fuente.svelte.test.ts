import { fireEvent, render, screen } from '@testing-library/svelte';
import { get } from 'svelte/store';

import PlanScreen from './plan-screen.svelte';
import { pantallaDelPlan } from './utils/plan-screen.svelte';
import type { CoursePlan } from './utils/course-plan';
import { t } from '$lib/utils/functions/translations';

/**
 * Aprobar un plan con lecciones que no tienen material atrás (contrato C5).
 *
 * ── Por qué ──────────────────────────────────────────────────────────────────
 *
 * El servidor marca esas lecciones al armar el plan, y antes sólo le pedía al
 * agente que preguntara. Medido: el agente preguntó, la docente no contestó,
 * tocó «Aprobar y construir», y la construcción arrancó igual; al escritor se
 * le iba a decir que ella había aceptado escribirlas de conocimiento general.
 * Ahora la pregunta la hace el botón: escribirlas igual, sacarlas, o cancelar.
 *
 * La pantalla lee el cupo del asistente para estimar el costo; eso es lo único
 * que se reemplaza (el cliente de la API necesita el build de la API).
 */

vi.mock('$features/ai-assistant/api/ai-assistant.svelte', () => ({
  aiAssistantApi: { status: { usage: { remaining: 500_000 } } }
}));

const texto = (clave: string, valores?: Record<string, unknown>) => get(t)(clave, valores);

const leccion = (title: string, order: number, sources: string[]) => ({
  type: 'lesson' as const,
  title,
  description: `Qué se ve en «${title}».`,
  order,
  hasExercise: false,
  sources
});

function planConHuecos(): CoursePlan {
  return {
    title: 'Caja en sucursales',
    sections: [
      {
        title: 'Apertura',
        order: 0,
        items: [leccion('Arqueo inicial', 0, ['Manual de caja.pdf']), leccion('Asistente en la planilla', 1, [])]
      },
      { title: 'Herramientas nuevas', order: 1, items: [leccion('Pedirle un resumen al asistente', 0, [])] },
      {
        title: 'Cierre',
        order: 2,
        items: [
          leccion('Cierre de caja', 0, ['Manual de caja.pdf']),
          { type: 'exercise', title: 'Examen final', description: 'Una pregunta por sección.', order: 1, hasExercise: false }
        ]
      }
    ],
    coverage: {
      sourcesAttached: 1,
      lessonsWithSource: 2,
      lessonsWithoutSource: ['Asistente en la planilla', 'Pedirle un resumen al asistente'],
      note: 'Do NOT start building yet.'
    }
  };
}

function abrir(plan: CoursePlan) {
  const aprobar = vi.fn();
  const desconectar = pantallaDelPlan.conectar({ aprobar, pedirCambios: () => {} });

  pantallaDelPlan.mostrar({ id: 'call-1', plan });
  pantallaDelPlan.sincronizar({ vigente: { id: 'call-1', plan }, aprobado: false, ocupado: false, progreso: null });

  render(PlanScreen);

  return { aprobar, desconectar };
}

describe('aprobar con lecciones sin fuente', () => {
  let desconectar = () => {};

  afterEach(() => {
    desconectar();
    pantallaDelPlan.cerrar();
  });

  async function tocarAprobar() {
    await fireEvent.click(screen.getByRole('button', { name: texto('ai_assistant.plan_screen.approve') }));
  }

  it('pregunta antes de aprobar, y nombra las lecciones', async () => {
    const abierto = abrir(planConHuecos());
    desconectar = abierto.desconectar;

    await tocarAprobar();

    expect(abierto.aprobar).not.toHaveBeenCalled();
    expect(await screen.findByText(texto('ai_assistant.plan_screen.no_source_title'))).toBeInTheDocument();
    // Las nombra: la docente tiene que saber cuáles son para decidir.
    expect(screen.getAllByText('Asistente en la planilla').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pedirle un resumen al asistente').length).toBeGreaterThan(0);
  });

  it('una lección que cita un temario que sólo nombra el tema también se pregunta, y dice por qué', async () => {
    // Medido: las lecciones de tablas dinámicas citaban un temario. El servidor
    // las mandaba como débiles, el diálogo no las leía y se construían sin que
    // nadie preguntara.
    const plan: CoursePlan = {
      ...planConHuecos(),
      coverage: {
        sourcesAttached: 2,
        lessonsWithSource: 3,
        lessonsWithoutSource: [],
        lessonsWithWeakSource: [{ lesson: 'Asistente en la planilla', sources: ['Temario.pdf'], charactersOnTopic: 120 }]
      }
    };
    const abierto = abrir(plan);
    desconectar = abierto.desconectar;

    await tocarAprobar();

    expect(abierto.aprobar).not.toHaveBeenCalled();
    expect(await screen.findByText(texto('ai_assistant.plan_screen.no_source_title'))).toBeInTheDocument();
    expect(screen.getByText(texto('ai_assistant.plan_screen.weak_source_hint', { sources: 'Temario.pdf' }))).toBeInTheDocument();

    // Y sacarla la saca también de la cobertura que viaja.
    await fireEvent.click(screen.getByRole('button', { name: texto('ai_assistant.plan_screen.no_source_remove') }));

    const aprobado = abierto.aprobar.mock.calls[0][0] as CoursePlan;
    expect(aprobado.sections[0].items.map((item) => item.title)).toEqual(['Arqueo inicial']);
    expect(aprobado.coverage?.lessonsWithWeakSource).toEqual([]);
  });

  it('«Sacarlas del plan» aprueba el plan sin esas lecciones ni la sección que quedó vacía', async () => {
    const abierto = abrir(planConHuecos());
    desconectar = abierto.desconectar;

    await tocarAprobar();
    await fireEvent.click(await screen.findByRole('button', { name: texto('ai_assistant.plan_screen.no_source_remove') }));

    expect(abierto.aprobar).toHaveBeenCalledTimes(1);

    const aprobado = abierto.aprobar.mock.calls[0][0] as CoursePlan;

    expect(aprobado.sections.map((s) => s.title)).toEqual(['Apertura', 'Cierre']);
    expect(aprobado.sections[0].items.map((i) => i.title)).toEqual(['Arqueo inicial']);
    expect(aprobado.sections.at(-1)?.items.some((i) => i.type === 'exercise')).toBe(true);
    expect(aprobado.coverage?.lessonsWithoutSource).toEqual([]);
  });

  it('«Escribirlas con conocimiento general» aprueba el plan entero', async () => {
    const abierto = abrir(planConHuecos());
    desconectar = abierto.desconectar;

    await tocarAprobar();
    await fireEvent.click(await screen.findByRole('button', { name: texto('ai_assistant.plan_screen.no_source_general') }));

    expect(abierto.aprobar).toHaveBeenCalledTimes(1);
    expect((abierto.aprobar.mock.calls[0][0] as CoursePlan).sections).toHaveLength(3);
  });

  it('«Cancelar» no aprueba nada', async () => {
    const abierto = abrir(planConHuecos());
    desconectar = abierto.desconectar;

    await tocarAprobar();
    await fireEvent.click(await screen.findByRole('button', { name: texto('ai_assistant.plan_screen.no_source_cancel') }));

    expect(abierto.aprobar).not.toHaveBeenCalled();
  });

  it('si sacarlas deja el plan inválido, lo dice y no aprueba', async () => {
    // Un plan de cambios cuyas únicas piezas nuevas no tienen fuente.
    const cambios: CoursePlan = {
      title: 'Agregar un módulo',
      scope: 'changes',
      sections: [{ title: 'Módulo nuevo', order: 0, items: [leccion('Tema sin material', 0, [])] }],
      coverage: { sourcesAttached: 1, lessonsWithSource: 0, lessonsWithoutSource: ['Tema sin material'] }
    };
    const abierto = abrir(cambios);
    desconectar = abierto.desconectar;

    await tocarAprobar();
    await fireEvent.click(await screen.findByRole('button', { name: texto('ai_assistant.plan_screen.no_source_remove') }));

    expect(abierto.aprobar).not.toHaveBeenCalled();
    expect(await screen.findByText(texto('ai_assistant.plan_screen.no_source_remove_failed'))).toBeInTheDocument();
  });

  it('un plan sin lecciones huérfanas se aprueba directo, sin preguntar', async () => {
    const cubierto = { ...planConHuecos(), coverage: undefined };
    const abierto = abrir(cubierto);
    desconectar = abierto.desconectar;

    await tocarAprobar();

    expect(abierto.aprobar).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(texto('ai_assistant.plan_screen.no_source_title'))).toBeNull();
  });
});
