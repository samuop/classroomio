import { confirmacionesSobreElPlan, contarPlan, estadosSobreElPlan, planesDeLaConversacion } from './plan-summary';
import type { CoursePlan } from './course-plan';
import type { AiAssistantPlanProgress } from './types';

/**
 * El avance de la construcción, dibujado sobre el plan.
 *
 * Lo delicado es aparear: el servidor manda filas con título y tipo, no con la
 * posición en el plan, y dos lecciones pueden llamarse igual.
 */

const item = (title: string, type: 'lesson' | 'exercise' = 'lesson', hasExercise = false) => ({
  title,
  type,
  description: '',
  order: 0,
  hasExercise
});

const plan: CoursePlan = {
  title: 'Curso',
  sections: [
    { title: 'Arranque', order: 1, items: [item('Bienvenida'), item('Repaso'), item('Control', 'exercise')] },
    { title: 'Cierre', order: 2, items: [item('Repaso'), item('Síntesis', 'lesson', true)] }
  ]
};

const progreso = (items: AiAssistantPlanProgress['items']): AiAssistantPlanProgress => ({
  total: items.length,
  completed: items.filter((i) => i.status === 'done').length,
  pendingCount: 0,
  emptyCount: 0,
  items
});

describe('el avance sobre el plan', () => {
  it('ubica cada fila en su sección, aunque dos lecciones se llamen igual', () => {
    const estados = estadosSobreElPlan(
      plan,
      progreso([
        { key: 's1', kind: 'section', title: 'Arranque', status: 'done' },
        { key: 's1.1', kind: 'lesson', title: 'Bienvenida', status: 'done' },
        { key: 's1.2', kind: 'lesson', title: 'Repaso', status: 'done' },
        { key: 's1.3', kind: 'exercise', title: 'Control', status: 'empty' },
        { key: 's2', kind: 'section', title: 'Cierre', status: 'done' },
        { key: 's2.1', kind: 'lesson', title: 'Repaso', status: 'missing' },
        { key: 's2.2', kind: 'lesson', title: 'Síntesis', status: 'empty' }
      ])
    );

    expect(estados.get('0.1')).toBe('done');
    expect(estados.get('1.0')).toBe('missing');
    expect(estados.get('0.2')).toBe('empty');
    expect(estados.get('1.1')).toBe('empty');
  });

  it('no le importan las tildes ni las mayúsculas del título', () => {
    const estados = estadosSobreElPlan(plan, progreso([{ key: '', kind: 'lesson', title: 'SINTESIS', status: 'done' }]));

    expect(estados.get('1.1')).toBe('done');
  });

  it('un ítem sin fila queda sin estado, en vez de heredar el de otro', () => {
    const estados = estadosSobreElPlan(plan, progreso([{ key: 's1', kind: 'section', title: 'Arranque', status: 'done' }]));

    expect(estados.get('0')).toBe('done');
    expect(estados.has('0.0')).toBe(false);
  });

  it('un ejercicio no se aparea con una lección del mismo nombre', () => {
    const estados = estadosSobreElPlan(plan, progreso([{ key: '', kind: 'lesson', title: 'Control', status: 'done' }]));

    expect(estados.has('0.2')).toBe(false);
  });

  it('sin avance no hay estados', () => {
    expect(estadosSobreElPlan(plan, null).size).toBe(0);
  });
});

/**
 * Un ✅ medido («el 4400 ya no está») y uno declarado por el asistente («lo que
 * queda es de otra regla») no valen lo mismo, y el docente es quien decide si le
 * cree. Ver `confirm_change_applied` en la API.
 */
describe('los ítems que el asistente dio por hechos declarándolo', () => {
  it('llegan con su motivo, ubicados en la misma posición que su estado', () => {
    const avance = progreso([
      { key: 's1', kind: 'section', title: 'Arranque', status: 'done' },
      { key: 's1.1', kind: 'lesson', title: 'Bienvenida', status: 'done' },
      {
        key: 's1.2',
        kind: 'lesson',
        title: 'Repaso',
        status: 'done',
        confirmed: 'Las 2 horas que quedan son del P1.'
      }
    ]);

    const confirmaciones = confirmacionesSobreElPlan(plan, avance);

    expect(confirmaciones.get('0.1')).toBe('Las 2 horas que quedan son del P1.');
    // Y no se contagia a los que sí se midieron.
    expect(confirmaciones.has('0.0')).toBe(false);
    // El estado sigue saliendo igual que siempre.
    expect(estadosSobreElPlan(plan, avance).get('0.1')).toBe('done');
  });

  it('un plan sin declaraciones no devuelve ninguna', () => {
    const avance = progreso([{ key: 's1.1', kind: 'lesson', title: 'Bienvenida', status: 'done' }]);

    expect(confirmacionesSobreElPlan(plan, avance).size).toBe(0);
  });
});

describe('las versiones del plan en la conversación', () => {
  const llamada = (state: string, output: unknown, toolCallId?: string) => ({
    type: 'tool-generate_course_plan',
    state,
    output,
    ...(toolCallId ? { toolCallId } : {})
  });

  it('encuentra cada versión terminada, en orden, con el id de su llamada', () => {
    const versiones = planesDeLaConversacion([
      { id: 'm1', parts: [{ type: 'text', text: 'Acá va' }, llamada('output-available', plan, 'call-1')] },
      { id: 'm2', parts: [{ type: 'text', text: 'pedido' }] },
      { id: 'm3', parts: [llamada('output-available', { ...plan, title: 'Revisado' }, 'call-2')] }
    ]);

    expect(versiones.map((v) => [v.id, v.plan.title, v.messageId])).toEqual([
      ['call-1', 'Curso', 'm1'],
      ['call-2', 'Revisado', 'm3']
    ]);
  });

  it('una llamada a medio escribir o fallida no es una versión', () => {
    const versiones = planesDeLaConversacion([
      { id: 'm1', parts: [llamada('input-streaming', undefined, 'a'), llamada('output-error', undefined, 'b')] },
      { id: 'm2', parts: [llamada('output-available', { ok: false, error: 'x' }, 'c')] }
    ]);

    expect(versiones).toEqual([]);
  });

  it('sin id de llamada, se identifica por mensaje y posición', () => {
    const [version] = planesDeLaConversacion([{ id: 'viejo', parts: [{ type: 'step-start' }, llamada('output-available', plan)] }]);

    expect(version.id).toBe('viejo:1');
  });
});

describe('contar un plan', () => {
  it('una lección con ejercicio suma un ejercicio', () => {
    expect(contarPlan(plan)).toMatchObject({ secciones: 2, lecciones: 4, ejercicios: 2 });
  });

  /**
   * Un plan de cambios se cuenta por ACCIÓN.
   *
   * «5 lecciones» suena igual si las cinco son nuevas que si se van a reescribir
   * cinco que ya estaban bien, y son cosas muy distintas para quien aprueba.
   */
  it('cuenta por acción y marca que es un plan de cambios', () => {
    const cambios: CoursePlan = {
      title: 'Actualización de la circular',
      scope: 'changes',
      sections: [
        {
          title: 'Mesa de Ayuda',
          order: 2,
          sectionId: 'S2',
          items: [
            { ...item('Quién atiende cada reclamo'), action: 'edit', target: 'S2.L1', changes: 'El interno pasa a WhatsApp.' },
            { ...item('Cómo se cierra un reclamo'), action: 'rewrite', target: 'S2.L2', changes: 'Se reescribe con la circular nueva.' },
            { ...item('Autoevaluación', 'exercise'), action: 'edit', target: 'S2.E1', changes: 'La pregunta del interno.' }
          ]
        },
        {
          title: 'Escalamiento',
          order: 5,
          items: [item('Cuándo escalar un reclamo')]
        }
      ]
    };

    expect(contarPlan(cambios)).toEqual({
      secciones: 2,
      lecciones: 3,
      ejercicios: 1,
      nuevas: 1,
      reescribir: 1,
      retocar: 2,
      seDejan: 0,
      esDeCambios: true
    });
  });

  /**
   * Un ítem `skip` es un `edit` que declara que NO se toca.
   *
   * Contarlo como «se retoca» le dice al docente lo contrario de lo que dice la
   * tarjeta de ese mismo ítem, que muestra «Se deja como está: …». Y es
   * justamente la pieza que el servidor obligó a nombrar para poder dejarla
   * afuera, así que es la que más importa que se lea bien.
   */
  it('un ítem que se deja como está no se cuenta como retocado', () => {
    const conSkip: CoursePlan = {
      title: 'Actualización de la circular',
      scope: 'changes',
      sections: [
        {
          title: 'Mesa de Ayuda',
          order: 2,
          sectionId: 'S2',
          items: [
            { ...item('Quién atiende cada reclamo'), action: 'edit', target: 'S2.L1', changes: 'El interno pasa a WhatsApp.' },
            {
              ...item('Autoevaluación', 'exercise'),
              action: 'edit',
              target: 'S2.E1',
              skip: true,
              changes: 'La docente pidió no tocar la autoevaluación hasta el cierre del mes.'
            }
          ]
        }
      ]
    };

    expect(contarPlan(conSkip)).toMatchObject({ retocar: 1, seDejan: 1 });
  });

  /** Un plan sin `action` es un plan de curso: todo se crea, y nada dice «se retoca». */
  it('un plan de curso cuenta todo como nuevo y no es de cambios', () => {
    expect(contarPlan(plan)).toEqual({
      secciones: 2,
      lecciones: 4,
      ejercicios: 2,
      nuevas: 5,
      reescribir: 0,
      retocar: 0,
      seDejan: 0,
      esDeCambios: false
    });
  });
});
