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
    expect(indicacionesDeLasReglas([])).toBeUndefined();
    expect(juntarIndicaciones(undefined, bloque, '  ')).toBe(bloque);
    expect(juntarIndicaciones(undefined)).toBeUndefined();
  });
});
