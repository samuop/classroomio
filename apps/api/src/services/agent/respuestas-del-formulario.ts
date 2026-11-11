/**
 * Lo que la docente eligió en el formulario de preguntas, antes del plan.
 *
 * Medido en producción el 2026-09-30, con planillas reales de un cliente: la
 * docente eligió nombrar las responsabilidades «por roles y funciones», no con
 * los nombres del equipo. El planificador lo vio —estaba en la conversación—,
 * pero el constructor corre con un contexto aislado (el plan aprobado y el
 * último pedido) y el escritor de lecciones recibe sólo la consigna de cada
 * una: 12 de 16 lecciones salieron con los nombres de las personas que figuran
 * en la planilla. Una elección que vive sólo en la conversación se pierde justo
 * al escribir.
 *
 * Se lee del historial: el formulario es la llamada a `ask_discovery_questions`
 * (las preguntas y las opciones, como las vio la docente) y las respuestas, la
 * metadata del mensaje con que el panel las mandó. El valor de una opción es un
 * id (`roles_genericos`); lo que se pasa es su texto.
 */

export interface RespuestaDelFormulario {
  pregunta: string;
  respuesta: string;
}

interface CampoDelFormulario {
  id?: unknown;
  label?: unknown;
  options?: Array<{ value?: unknown; label?: unknown }>;
}

interface MensajeConFormulario {
  role?: string;
  metadata?: { discovery?: { action?: string; formId?: unknown; answers?: Record<string, unknown> } };
  parts?: Array<{ type?: string; input?: { formId?: unknown; fields?: CampoDelFormulario[] } }>;
}

/** Las preguntas del formulario que se contestó: el último con ese id antes de la respuesta. */
function camposDelFormulario(anteriores: readonly unknown[], formId: unknown): CampoDelFormulario[] {
  for (let i = anteriores.length - 1; i >= 0; i--) {
    const mensaje = anteriores[i] as MensajeConFormulario;
    if (mensaje?.role !== 'assistant') continue;

    for (const parte of mensaje.parts ?? []) {
      if (parte?.type !== 'tool-ask_discovery_questions') continue;
      if (formId !== undefined && parte.input?.formId !== formId) continue;
      if (Array.isArray(parte.input?.fields)) return parte.input.fields;
    }
  }

  return [];
}

const texto = (valor: unknown): string => (typeof valor === 'string' ? valor.trim() : '');

/** Las respuestas del último formulario enviado, en el orden de sus preguntas. */
export function respuestasDelFormulario(messages: readonly unknown[]): RespuestaDelFormulario[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const mensaje = messages[i] as MensajeConFormulario;
    const envio = mensaje?.role === 'user' ? mensaje.metadata?.discovery : undefined;
    if (envio?.action !== 'submit_discovery_answers' || !envio.answers) continue;

    const campos = camposDelFormulario(messages.slice(0, i), envio.formId);
    const pendientes = new Map(Object.entries(envio.answers).filter(([, valor]) => texto(valor) !== ''));
    const respuestas: RespuestaDelFormulario[] = [];

    for (const campo of campos) {
      const id = texto(campo.id);
      const valor = texto(pendientes.get(id));
      if (!valor) continue;

      pendientes.delete(id);
      const opcion = campo.options?.find((o) => texto(o.value) === valor);
      respuestas.push({ pregunta: texto(campo.label) || id, respuesta: texto(opcion?.label) || valor });
    }

    // Una respuesta sin su pregunta a la vista (un historial recortado) igual vale.
    for (const [id, valor] of pendientes) respuestas.push({ pregunta: id, respuesta: texto(valor) });

    return respuestas;
  }

  return [];
}

/**
 * El bloque que va al constructor y a los escritores. Dice que manda sobre las
 * fuentes: el caso medido es justamente una fuente que nombra personas y una
 * docente que pidió roles.
 *
 * Y dice DÓNDE, porque la primera versión decía sólo «seguí su elección» y no
 * alcanzó: medido en producción el mismo día, la prosa salió con roles pero los
 * nombres volvieron en lo copiado de la planilla —la tabla de responsables, el
 * ejemplo de cómo llenar la columna— y en una consigna que el constructor le
 * escribió al escritor.
 *
 * Y dice hasta dónde: la segunda versión mandaba el rol también «al ejemplo de
 * cómo llenar una columna», y la lección pasó a enseñar que en la columna
 * RESPONSABLE de la planilla se escribe el rol. La planilla de la empresa lleva
 * el nombre de quien hizo la tarea; lo que se eligió es cómo se escribe el curso.
 */
export function indicacionesDelFormulario(respuestas: readonly RespuestaDelFormulario[]): string | undefined {
  if (respuestas.length === 0) return undefined;

  return [
    '## What the teacher chose before the plan (discovery form)',
    '',
    "These choices apply to every lesson, exercise and question of this course, including what is added later, and they win over the sources, the plan and any brief — in the prose and also in tables, examples and sample rows copied from a source. For example, if a source names people and the teacher chose roles: write the role wherever the source has the name, even inside a table, and never put the name next to the role. A choice about how the course is written never changes what the company does: when a lesson explains a form column that holds a person's name, say it takes the name of whoever did the task, without a real name in the example. When you write a brief for someone else, apply the choices there too.",
    '',
    ...respuestas.map((r) => `- ${r.pregunta}: ${r.respuesta}`)
  ].join('\n');
}

/**
 * Las reglas que la docente dijo en la conversación, como las leen los
 * escritores: vienen del plan aprobado (`teacherRules`).
 *
 * Los escritores ven sólo su consigna, y el constructor corre sin la
 * conversación. Medido el 2026-11-03: una prohibición dicha en el chat («no
 * enseñes la matriz de descuentos como vigente») no le llegó a nadie, y la
 * lección la enseñó como vigente.
 */
export function indicacionesDeLasReglas(
  reglas: readonly string[],
  correcciones: readonly string[] = []
): string | undefined {
  const bloques: string[] = [];

  if (reglas.length > 0) {
    bloques.push(
      [
        "## The teacher's rules for this course",
        '',
        'The teacher stated these rules. They bind every lesson, exercise and question of this course, and they win over the sources, the plan and any brief. If following the source would break one, follow the rule and leave that part out.',
        'A rule about what the course must not say is NOT content: never turn it into a sentence of the lesson. If the sources say nothing about discounts, the lesson says nothing about discounts — not "you must not give discounts", which is a company policy nobody stated.',
        '',
        ...reglas.map((regla) => `- ${regla}`)
      ].join('\n')
    );
  }

  // Una corrección es lo contrario de una prohibición: ES contenido. La fuente
  // dice lo viejo, y sin esto el escritor —que trata la fuente como la verdad—
  // lo traía de vuelta en cada lección nueva (medido el 2026-11-11, 2 de 2).
  if (correcciones.length > 0) {
    bloques.push(
      [
        '## Facts the teacher corrected (they replace what the sources say)',
        '',
        'The teacher corrected these facts after the source documents were written. Each one REPLACES the source on that point: wherever this lesson or these questions touch the subject, state the corrected fact, and never write the source’s older version — not as the rule, not in an example, not in a dialogue, not as the correct answer of a question.',
        'State the corrected fact simply as the fact. Do not mention the older value at all, nor that the manual used to say something else, nor that the rule changed — a learner who never knew the old value should not learn it here. (Each correction names what it replaces only so that you know which statement of the source is out of date.)',
        'The teacher is the source for these: a sentence that follows a correction is supported. Do not mark it as lacking a source.',
        '',
        ...correcciones.map((correccion) => `- ${correccion}`)
      ].join('\n')
    );
  }

  return bloques.length > 0 ? bloques.join('\n\n') : undefined;
}

/** Junta los bloques de indicaciones que haya; ninguno es nada. */
export function juntarIndicaciones(...bloques: Array<string | undefined>): string | undefined {
  const presentes = bloques.filter((bloque): bloque is string => !!bloque?.trim());

  return presentes.length > 0 ? presentes.join('\n\n') : undefined;
}

/** La línea que va después de la consigna de cada pieza: lo último que lee quien escribe. */
export const RECORDATORIO_DE_LA_DOCENTE =
  "Where this brief or the source material disagrees with the teacher's choices or rules (in your instructions), they win — tables and examples included.";
