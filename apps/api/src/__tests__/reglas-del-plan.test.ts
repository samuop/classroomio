import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toJSONSchema } from 'zod';

/**
 * Las «reglas de la docente» de un plan son las que ella escribió.
 *
 * Medido el 2026-11-11 con un curso real armado desde un documento: la docente
 * contestó el formulario (una palabra en el campo libre) y pidió el curso. El
 * plan salió con cinco reglas «de la docente» que ella no había dicho, y como
 * una regla gana sobre la fuente en todas las lecciones, cerca de la mitad de
 * los defectos del curso salieron de ahí.
 *
 * El caso de acá es inventado, con la misma forma.
 */

vi.mock('isomorphic-dompurify', () => ({
  default: new Proxy({}, { get: () => (valor: unknown) => valor })
}));

vi.mock('@api/utils/tinybird', () => ({
  trackAgentEvent: vi.fn(),
  AgentEvent: new Proxy({}, { get: (_, clave) => String(clave) })
}));

vi.mock('@cio/db/queries/agent/chat-document', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/agent/chat-document')>()),
  listCourseSources: vi.fn(async () => [])
}));

import { coursePlanParam } from '@api/services/agent/agent-tool-schemas';
import { buildAgentTools } from '@api/services/agent/chat-tools';
import { avisoDeReglasDescartadas, reglasQueDijoLaDocente, textosEscritosPorLaDocente } from '@api/services/agent/reglas-del-plan';

const texto = (id: string, role: 'user' | 'assistant', contenido: string, metadata?: unknown) => ({
  id,
  role,
  parts: [{ type: 'text', text: contenido }],
  ...(metadata ? { metadata } : {})
});

/** El mensaje con que el panel manda el formulario: preguntas del asistente, respuestas de ella. */
const FORMULARIO = texto(
  'u2',
  'user',
  'Here are my answers to your questions:\n' +
    '- ¿Qué herramientas o canales usa el equipo habitualmente?: telegram\n' +
    '- ¿Cuál es la prioridad del curso?: operativa\n' +
    '- ¿Algo que el curso no deba decir?: no nombrar a los proveedores por su marca',
  {
    discovery: {
      action: 'submit_discovery_answers',
      formId: 'form-deposito',
      answers: { canales: 'telegram', prioridad: 'operativa', limites: 'no nombrar a los proveedores por su marca' }
    }
  }
);

const CONVERSACION = [
  texto('u1', 'user', 'Armá el curso del depósito. No pongas precios en ninguna lección, cambian todas las semanas.'),
  texto('a1', 'assistant', 'Antes de planificar: usar Telegram como canal oficial para coordinar con los proveedores.'),
  FORMULARIO,
  texto('u3', 'user', 'Construí el curso según el plan aprobado.', { plan: { action: 'implement_course_plan', payload: {} } })
];

const SIN_PRECIOS = { rule: 'No poner precios en ninguna lección.', teacherWords: 'No pongas precios en ninguna lección' };
const DEL_ASISTENTE = { rule: 'Usar Telegram como canal oficial con los proveedores.', teacherWords: 'usar Telegram como canal oficial para coordinar con los proveedores' };
const DE_LA_PREGUNTA = {
  rule: 'Usar Telegram como canal oficial del equipo.',
  teacherWords: '¿Qué herramientas o canales usa el equipo habitualmente?: telegram'
};
const DE_UNA_PALABRA = { rule: 'Usar Telegram como canal oficial del equipo.', teacherWords: 'telegram' };
const DE_NADIE = { rule: 'Escribir los roles en lugar de los nombres propios.', teacherWords: 'siempre roles en lugar de nombres' };
const DEL_CAMPO_LIBRE = { rule: 'No nombrar a los proveedores por su marca.', teacherWords: 'no nombrar a los proveedores por su marca' };

describe('lo que la docente escribió', () => {
  it('sus mensajes cuentan; del formulario, sólo las respuestas; el texto de un botón, no', () => {
    expect(textosEscritosPorLaDocente(CONVERSACION)).toEqual([
      'Armá el curso del depósito. No pongas precios en ninguna lección, cambian todas las semanas.',
      'telegram',
      'operativa',
      'no nombrar a los proveedores por su marca'
    ]);
  });

  it('un mensaje sin texto, o algo que no es un mensaje, no rompe', () => {
    expect(textosEscritosPorLaDocente([null, { role: 'user' }, { role: 'user', parts: [] }, { role: 'user', metadata: { discovery: {} } }])).toEqual([]);
  });
});

describe('de las reglas que declara el plan, cuáles son de ella', () => {
  const escritos = textosEscritosPorLaDocente(CONVERSACION);

  it('la que escribió queda; las del asistente, las de nadie y las armadas con una pregunta, no', () => {
    const { aceptadas, descartadas } = reglasQueDijoLaDocente([SIN_PRECIOS, DEL_ASISTENTE, DE_LA_PREGUNTA, DE_UNA_PALABRA, DE_NADIE], escritos);

    expect(aceptadas).toEqual([SIN_PRECIOS.rule]);
    expect(descartadas.map((regla) => regla.rule)).toEqual([DEL_ASISTENTE.rule, DE_LA_PREGUNTA.rule, DE_UNA_PALABRA.rule, DE_NADIE.rule]);
  });

  it('una oración que tecleó en un campo libre del formulario sí es suya', () => {
    expect(reglasQueDijoLaDocente([DEL_CAMPO_LIBRE], escritos).aceptadas).toEqual([DEL_CAMPO_LIBRE.rule]);
  });

  it('la misma regla declarada dos veces queda una; una regla vacía se ignora', () => {
    const { aceptadas, descartadas } = reglasQueDijoLaDocente([SIN_PRECIOS, { ...SIN_PRECIOS }, { rule: '   ', teacherWords: 'x' }], escritos);

    expect(aceptadas).toEqual([SIN_PRECIOS.rule]);
    expect(descartadas).toEqual([]);
  });

  it('el aviso nombra las descartadas y dice dónde va lo que es de la fuente; sin descartadas no hay aviso', () => {
    const aviso = avisoDeReglasDescartadas([DEL_ASISTENTE, DE_NADIE])!;

    expect(aviso).toContain('2 of the teacher rules');
    expect(aviso).toContain(`"${DEL_ASISTENTE.rule}"`);
    expect(aviso).toContain(`"${DE_NADIE.rule}"`);
    expect(aviso).toMatch(/SOURCE states.*content/s);
    expect(avisoDeReglasDescartadas([])).toBeUndefined();
  });
});

describe('la herramienta del plan', () => {
  const PLAN = {
    title: 'Depósito',
    sections: [
      { title: 'Recibir', order: 0, items: [{ type: 'lesson', title: 'Controlar el remito', description: 'Qué se compara.', order: 0, sources: [] }] },
      { title: 'Examen final', order: 1, items: [{ type: 'exercise', title: 'Examen final', description: 'Todo el curso.', order: 0 }] }
    ]
  };

  const planCon = async (teacherRules: unknown[], opciones: Record<string, unknown>) => {
    const herramientas = buildAgentTools('org', 'usuario', 'curso', [], { conversationId: 'conversacion', locale: 'es', ...opciones }) as Record<
      string,
      { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> }
    >;

    return herramientas.generate_course_plan.execute({ plan: { ...PLAN, teacherRules } }, { toolCallId: 'llamada', messages: [] });
  };

  beforeEach(() => vi.clearAllMocks());

  it('pide cada regla con las palabras de la docente, y el campo sigue siendo obligatorio', () => {
    expect(coursePlanParam.safeParse({ plan: PLAN }).success).toBe(false);
    expect(coursePlanParam.safeParse({ plan: { ...PLAN, teacherRules: [] } }).success).toBe(true);
    expect(coursePlanParam.safeParse({ plan: { ...PLAN, teacherRules: [SIN_PRECIOS] } }).success).toBe(true);
    // Una regla suelta, sin sus palabras, ya no es una regla.
    expect(coursePlanParam.safeParse({ plan: { ...PLAN, teacherRules: [SIN_PRECIOS.rule] } }).success).toBe(false);
    expect(coursePlanParam.safeParse({ plan: { ...PLAN, teacherRules: [{ rule: SIN_PRECIOS.rule }] } }).success).toBe(false);

    const esquema = toJSONSchema(coursePlanParam) as {
      properties: { plan: { required?: string[]; properties: { teacherRules: { items: { required?: string[] } } } } };
    };

    expect(esquema.properties.plan.required).toContain('teacherRules');
    expect(esquema.properties.plan.properties.teacherRules.items.required).toEqual(expect.arrayContaining(['rule', 'teacherWords']));
  });

  it('el plan sale sólo con las reglas que ella escribió, y avisa cuáles se cayeron', async () => {
    const resultado = await planCon([SIN_PRECIOS, DEL_ASISTENTE, DE_LA_PREGUNTA, DE_NADIE], {
      textosDeLaDocente: CONVERSACION.filter((m) => m.role === 'user').map((m) => m.parts[0].text),
      textosEscritosPorLaDocente: textosEscritosPorLaDocente(CONVERSACION)
    });

    // Lo que se guarda y se le muestra: la forma de siempre, una lista de frases.
    expect(resultado.teacherRules).toEqual([SIN_PRECIOS.rule]);
    expect(String(resultado.teacherRulesNote)).toContain(`"${DE_NADIE.rule}"`);
    expect(String(resultado.teacherRulesNote)).toContain(`"${DE_LA_PREGUNTA.rule}"`);
    expect(String(resultado.teacherRulesNote)).not.toContain(SIN_PRECIOS.rule);
  });

  it('si no dictó ninguna, el plan sale sin reglas aunque el modelo declare cinco', async () => {
    const resultado = await planCon([DEL_ASISTENTE, DE_LA_PREGUNTA, DE_UNA_PALABRA, DE_NADIE], {
      textosEscritosPorLaDocente: textosEscritosPorLaDocente([FORMULARIO])
    });

    expect(resultado.teacherRules).toEqual([]);
    expect(resultado.title).toBe('Depósito');
  });

  it('con todas las reglas de ella no hay aviso', async () => {
    const resultado = await planCon([SIN_PRECIOS, DEL_CAMPO_LIBRE], { textosEscritosPorLaDocente: textosEscritosPorLaDocente(CONVERSACION) });

    expect(resultado.teacherRules).toEqual([SIN_PRECIOS.rule, DEL_CAMPO_LIBRE.rule]);
    expect(resultado).not.toHaveProperty('teacherRulesNote');
  });
});
