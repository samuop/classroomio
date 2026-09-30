import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Lo que la docente eligió en el formulario de preguntas llega a quien escribe.
 *
 * Medido en producción el 2026-09-30, con planillas reales: eligió nombrar las
 * responsabilidades por rol y no con los nombres del equipo, y 12 de 16
 * lecciones salieron con los nombres de la planilla. El constructor corre sin
 * la conversación y los escritores ven sólo su consigna.
 */

const generateObject = vi.fn();
const generateText = vi.fn();

vi.mock('ai', async (original) => ({
  ...(await original<typeof import('ai')>()),
  generateObject: (...args: unknown[]) => generateObject(...args),
  generateText: (...args: unknown[]) => generateText(...args)
}));

vi.mock('@cio/ai-assistant', async (original) => ({
  ...(await original<typeof import('@cio/ai-assistant')>()),
  createModel: vi.fn(() => ({ modelId: 'modelo-de-prueba' })),
  resolveModelName: vi.fn(() => 'modelo-de-prueba')
}));

vi.mock('@api/services/agent/usage', () => ({
  recordTokenUsage: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@cio/db/queries/agent/chat-document', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/agent/chat-document')>()),
  listCourseSources: vi.fn().mockResolvedValue([])
}));

const { indicacionesDelFormulario, respuestasDelFormulario, RECORDATORIO_DE_LA_DOCENTE } = await import(
  '@api/services/agent/respuestas-del-formulario'
);
const { crearEscritorDeLecciones } = await import('@api/services/agent/lesson-writer');
const { crearEscritorDePreguntas } = await import('@api/services/agent/question-writer');

/** Un formulario como lo deja el asistente en el historial. */
const formulario = (formId: string, fields: unknown[]) => ({
  id: `a-${formId}`,
  role: 'assistant',
  parts: [
    {
      type: 'tool-ask_discovery_questions',
      toolCallId: `llamada-${formId}`,
      state: 'output-available',
      input: { title: 'Antes del plan', formId, fields },
      output: { awaiting_user: true }
    },
    { type: 'text', text: 'Completá estas preguntas.' }
  ]
});

/** Las respuestas como las manda el panel. */
const respuesta = (formId: string, answers: Record<string, string>) => ({
  id: `u-${formId}`,
  role: 'user',
  metadata: { discovery: { action: 'submit_discovery_answers', formId, answers } },
  parts: [{ type: 'text', text: 'Here are my answers to your questions:' }]
});

const NOMBRES = {
  id: 'manejo_roles',
  label: '¿Cómo preferís nombrar las responsabilidades?',
  type: 'select',
  options: [
    { value: 'nombres_reales', label: 'Con los nombres del equipo actual' },
    { value: 'roles_genericos', label: 'Por roles y funciones (ej. Responsable de Recepción)' }
  ]
};
const PROFUNDIDAD = {
  id: 'formato',
  label: '¿Qué profundidad buscás?',
  type: 'select',
  options: [
    { value: 'operativo', label: 'Operativo y directo' },
    { value: 'detallado', label: 'Detallado y formativo' }
  ]
};
const PUBLICO = { id: 'publico', label: '¿Quién lo va a tomar?', type: 'text' };

const CONVERSACION = [
  { id: 'u0', role: 'user', parts: [{ type: 'text', text: 'Armá un curso con la planilla del depósito.' }] },
  formulario('deposito', [PROFUNDIDAD, NOMBRES, PUBLICO]),
  respuesta('deposito', { manejo_roles: 'roles_genericos', formato: 'detallado', publico: 'Personal nuevo del depósito' })
];

describe('las respuestas del formulario, leídas del historial', () => {
  it('cada pregunta con el texto de la opción elegida, en el orden del formulario', () => {
    expect(respuestasDelFormulario(CONVERSACION)).toEqual([
      { pregunta: '¿Qué profundidad buscás?', respuesta: 'Detallado y formativo' },
      { pregunta: '¿Cómo preferís nombrar las responsabilidades?', respuesta: 'Por roles y funciones (ej. Responsable de Recepción)' },
      { pregunta: '¿Quién lo va a tomar?', respuesta: 'Personal nuevo del depósito' }
    ]);
  });

  it('si contestó dos formularios, vale el último', () => {
    const conOtro = [
      ...CONVERSACION,
      formulario('segundo', [NOMBRES]),
      respuesta('segundo', { manejo_roles: 'nombres_reales' })
    ];

    expect(respuestasDelFormulario(conOtro)).toEqual([
      { pregunta: '¿Cómo preferís nombrar las responsabilidades?', respuesta: 'Con los nombres del equipo actual' }
    ]);
  });

  it('se empareja con su formulario por el id, no con el último que se mostró', () => {
    const dosFormularios = [formulario('primero', [NOMBRES]), formulario('segundo', [PROFUNDIDAD]), respuesta('primero', { manejo_roles: 'roles_genericos' })];

    expect(respuestasDelFormulario(dosFormularios)).toEqual([
      { pregunta: '¿Cómo preferís nombrar las responsabilidades?', respuesta: 'Por roles y funciones (ej. Responsable de Recepción)' }
    ]);
  });

  it('una respuesta cuyo formulario ya no está en el historial igual vale, con su id', () => {
    expect(respuestasDelFormulario([respuesta('perdido', { manejo_roles: 'roles_genericos' })])).toEqual([
      { pregunta: 'manejo_roles', respuesta: 'roles_genericos' }
    ]);
  });

  it('sin formulario contestado no hay nada', () => {
    const salteado = {
      id: 'u1',
      role: 'user',
      metadata: { discovery: { action: 'skip_discovery_form', formId: 'deposito' } },
      parts: [{ type: 'text', text: 'Contesto en el chat.' }]
    };

    expect(respuestasDelFormulario([CONVERSACION[0], CONVERSACION[1], salteado])).toEqual([]);
    expect(indicacionesDelFormulario([])).toBeUndefined();
  });

  it('el bloque dice que la elección de la docente manda, y dónde: también en tablas, ejemplos y consignas', () => {
    const bloque = indicacionesDelFormulario(respuestasDelFormulario(CONVERSACION))!;

    expect(bloque).toContain('## What the teacher chose before the plan (discovery form)');
    expect(bloque).toContain('they win over the sources, the plan and any brief');
    // Medido: la prosa salió con roles y los nombres volvieron en la tabla de
    // responsables, en el ejemplo de cómo llenar la columna y en una consigna.
    expect(bloque).toContain('write the role wherever the source has the name, even inside a table');
    expect(bloque).toContain('never put the name next to the role');
    // Y hasta dónde: con «el rol también en el ejemplo de cómo llenar la columna»,
    // la lección enseñó a escribir el rol en la planilla, que lleva el nombre.
    expect(bloque).toContain('A choice about how the course is written never changes what the company does');
    expect(bloque).toContain("say it takes the name of whoever did the task, without a real name in the example");
    expect(bloque).toContain('When you write a brief for someone else, apply the choices there too.');
    expect(bloque).toContain('- ¿Cómo preferís nombrar las responsabilidades?: Por roles y funciones (ej. Responsable de Recepción)');
  });
});

describe('los escritores las reciben', () => {
  const PROVEEDOR = { provider: 'google', model: 'modelo-de-prueba' } as never;
  const BLOQUE = indicacionesDelFormulario(respuestasDelFormulario(CONVERSACION))!;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  /**
   * En sus instrucciones, y un recordatorio después de la consigna. Medido: en
   * el pedido, antes de la consigna, la consigna ganaba —traía los nombres—.
   */
  it('el de lecciones, en sus instrucciones, con el recordatorio al final de la consigna', async () => {
    generateText.mockResolvedValue({ text: '<lesson><p>Una lección.</p></lesson>', finishReason: 'stop', usage: {} });

    await crearEscritorDeLecciones({
      orgId: 'org',
      userId: 'usuario',
      courseId: 'curso',
      redis: {} as never,
      providerConfig: PROVEEDOR,
      courseTitle: 'Depósito',
      indicaciones: BLOQUE
    })({ lessonTitle: 'Recepción', brief: 'Quién recibe la mercadería.', locale: 'es', sources: [] });

    const { system, prompt } = generateText.mock.calls[0][0] as { system: string; prompt: string };
    expect(system.endsWith(BLOQUE)).toBe(true);
    expect(prompt).not.toContain(BLOQUE);
    expect(prompt).toContain(`Quién recibe la mercadería.\n\n${RECORDATORIO_DE_LA_DOCENTE}`);
  });

  it('el de preguntas, igual', async () => {
    generateObject.mockResolvedValue({ object: { questions: [] }, usage: {} });

    await crearEscritorDePreguntas({
      orgId: 'org',
      userId: 'usuario',
      courseId: 'curso',
      providerConfig: PROVEEDOR,
      isOrgOnPaidPlan: false,
      indicaciones: BLOQUE
    })({
      exerciseTitle: 'Casos de recepción',
      brief: 'Casos del día a día.',
      count: 6,
      lecciones: [{ title: 'Recepción', text: 'El responsable de recepción controla el remito.' }],
      locale: 'es'
    });

    const { system, prompt } = generateObject.mock.calls[0][0] as { system: string; prompt: string };
    expect(system.endsWith(BLOQUE)).toBe(true);
    expect(prompt).toContain(`Casos del día a día.\n\n${RECORDATORIO_DE_LA_DOCENTE}`);
  });

  it('sin formulario, los pedidos no cambian', async () => {
    generateText.mockResolvedValue({ text: '<lesson><p>Una lección.</p></lesson>', finishReason: 'stop', usage: {} });
    generateObject.mockResolvedValue({ object: { questions: [] }, usage: {} });

    await crearEscritorDeLecciones({
      orgId: 'org',
      userId: 'usuario',
      courseId: 'curso',
      redis: {} as never,
      providerConfig: PROVEEDOR,
      courseTitle: 'Depósito'
    })({ lessonTitle: 'Recepción', brief: 'Quién recibe la mercadería.', locale: 'es', sources: [] });
    await crearEscritorDePreguntas({
      orgId: 'org',
      userId: 'usuario',
      courseId: 'curso',
      providerConfig: PROVEEDOR,
      isOrgOnPaidPlan: false
    })({ exerciseTitle: 'Casos', brief: 'Casos.', count: 6, lecciones: [{ title: 'Recepción', text: 'Texto.' }], locale: 'es' });

    for (const llamada of [generateText.mock.calls[0][0], generateObject.mock.calls[0][0]] as Array<{ system: string; prompt: string }>) {
      expect(llamada.system).not.toContain('What the teacher chose');
      expect(llamada.prompt).not.toContain(RECORDATORIO_DE_LA_DOCENTE);
    }
  });
});
