/**
 * Las reglas de la docente viajan en el plan, y el modelo no puede dejarlas
 * fuera.
 *
 * Gemini deja vacío lo que el esquema no exige, aunque el prompt lo pida: por
 * eso `teacherRules` es obligatorio en lo que ve el modelo. Pero los planes ya
 * aprobados que viven en las conversaciones guardadas no lo tienen, y tienen
 * que seguir leyéndose.
 */
import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import { CoursePlanFieldsSchema, reglasDeLaDocente } from '@cio/ai-assistant';

import { coursePlanParam } from '@api/services/agent/agent-tool-schemas';
import { aprobacionDelMensaje, getLatestImplementationPlan } from '@api/services/agent/chat-context';
import { indicacionesDeLasReglas, juntarIndicaciones } from '@api/services/agent/respuestas-del-formulario';

const PLAN = {
  title: 'Venta en salón',
  sections: [
    {
      title: 'Atender',
      order: 0,
      items: [
        { type: 'lesson', title: 'Recibir al cliente', description: 'Saludo y escucha.', order: 0 },
        { type: 'exercise', title: 'Examen final', description: 'Todo el curso.', order: 1 }
      ]
    }
  ]
};

describe('teacherRules en el plan', () => {
  it('la herramienta lo exige: sin el campo, el plan se rechaza; con una lista vacía, pasa', () => {
    expect(coursePlanParam.safeParse({ plan: PLAN }).success).toBe(false);
    expect(coursePlanParam.safeParse({ plan: { ...PLAN, teacherRules: [] } }).success).toBe(true);
  });

  it('y el esquema que ve el modelo lo marca como requerido', () => {
    const esquema = toJSONSchema(coursePlanParam) as {
      properties: { plan: { required?: string[] } };
    };

    expect(esquema.properties.plan.required).toContain('teacherRules');
  });

  it('un plan aprobado antes de esto, sin reglas, se sigue leyendo', () => {
    const leido = CoursePlanFieldsSchema.safeParse(PLAN);

    expect(leido.success).toBe(true);
    expect(reglasDeLaDocente(leido.success ? leido.data : undefined)).toEqual([]);
  });

  it('las reglas salen limpias, y el bloque para los escritores las lista', () => {
    const reglas = reglasDeLaDocente({ teacherRules: ['  No inventes devoluciones.  ', '', '   '] });

    expect(reglas).toEqual(['No inventes devoluciones.']);

    const bloque = indicacionesDeLasReglas(reglas)!;

    expect(bloque).toContain("## The teacher's rules for this course");
    expect(bloque).toContain('- No inventes devoluciones.');
    // Medido en desarrollo (2026-11-06): con la regla «no inventes descuentos»
    // una lección escribió «no debés aplicar descuentos», que es una política
    // que nadie dijo. La regla no es contenido.
    expect(bloque).toContain('is NOT content');
    expect(indicacionesDeLasReglas([])).toBeUndefined();
    expect(juntarIndicaciones(undefined, bloque, '  ')).toBe(bloque);
    expect(juntarIndicaciones(undefined)).toBeUndefined();
  });
});

/**
 * Las reglas las escribe la docente en la pantalla del plan. Una regla de 401
 * caracteres hacía que el plan entero no validara, y el servidor salteaba esa
 * aprobación en silencio: construía con el plan aprobado antes, o sin ninguno.
 */
describe('la aprobación con lo que escribió la docente', () => {
  const aprobacionDe = (payload: unknown) => ({
    id: 'u9',
    role: 'user',
    metadata: { plan: { action: 'implement_course_plan', payload } },
    parts: [{ type: 'text', text: 'Construí el curso según el plan aprobado.' }]
  });
  const ANTERIOR = { ...PLAN, title: 'El plan aprobado antes' };

  it('una regla larga se recorta, y el plan aprobado es ESTE y no el anterior', () => {
    const larga = `No ${'inventes '.repeat(60)}`.trim();
    const plan = getLatestImplementationPlan([
      aprobacionDe(ANTERIOR),
      aprobacionDe({ ...PLAN, teacherRules: [larga, '  ', 'Sin precios.'] })
    ]);

    expect(plan?.title).toBe('Venta en salón');
    expect(plan?.teacherRules).toHaveLength(2);
    expect(plan?.teacherRules?.[0].length).toBeLessThanOrEqual(400);
    expect(plan?.teacherRules?.[1]).toBe('Sin precios.');
  });

  it('más de 30 reglas: quedan las primeras 30', () => {
    const muchas = Array.from({ length: 35 }, (_, i) => `Regla ${i + 1}.`);

    expect(getLatestImplementationPlan([aprobacionDe({ ...PLAN, teacherRules: muchas })])?.teacherRules).toHaveLength(30);
  });

  it('una aprobación que igual no valida se reconoce como inválida, con el campo que falla', () => {
    const vaciado = { ...PLAN, sections: [{ ...PLAN.sections[0], items: [{ ...PLAN.sections[0].items[0], title: '' }] }] };
    const resultado = aprobacionDelMensaje(aprobacionDe(vaciado));

    expect(resultado).toMatchObject({ valida: false });
    expect(resultado && !resultado.valida && resultado.problemas[0]).toContain('sections.0.items.0.title');
    expect(aprobacionDelMensaje(aprobacionDe({ ...PLAN, teacherRules: [] }))).toEqual({ valida: true });
    expect(aprobacionDelMensaje({ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Hola' }] })).toBeNull();
  });
});
