import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Lo que la docente dicta vale para el curso, no para una conversación.
 *
 * ── Lo que se midió (2026-11-11, dos veces de dos en cada caso) ──────────────
 *
 * - Una regla de estilo dictada al armar el curso se perdía al abrir otro chat:
 *   se leía del plan aprobado de ESA conversación.
 * - Una regla dicha después del plan no se guardaba en ningún lado, y el
 *   asistente contestaba «Regla registrada».
 * - Una corrección de un dato vivía sólo en la lección corregida: una lección
 *   nueva volvía a lo que dice la fuente, y el juez de fundamento marcaba la
 *   corrección como invento.
 *
 * Acá se fija: de dónde salen las reglas de una ronda, cómo les llegan a los
 * escritores y al juez, y que guardar una exige las palabras de la docente.
 */

const base = vi.hoisted(() => ({
  reglasDelCurso: vi.fn(),
  guardarReglasDelCurso: vi.fn(),
  retirarReglaDelCurso: vi.fn()
}));

const generateObject = vi.fn();

vi.mock('ai', async (original) => ({
  ...(await original<typeof import('ai')>()),
  generateObject: (...args: unknown[]) => generateObject(...args)
}));

vi.mock('isomorphic-dompurify', () => ({
  default: new Proxy({}, { get: () => (valor: unknown) => valor })
}));

vi.mock('@api/utils/tinybird', () => ({
  trackAgentEvent: vi.fn(),
  AgentEvent: new Proxy({}, { get: (_, clave) => String(clave) })
}));

vi.mock('@cio/db/queries/agent', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/agent')>()),
  reglasDelCurso: base.reglasDelCurso,
  guardarReglasDelCurso: base.guardarReglasDelCurso,
  retirarReglaDelCurso: base.retirarReglaDelCurso
}));

vi.mock('@api/services/agent/source-pack', () => ({
  buildSourcePack: vi.fn().mockResolvedValue({ text: '## Course Sources (1)\n\nEl presupuesto vale 48 horas.' })
}));

vi.mock('@api/services/agent/usage', () => ({
  recordTokenUsage: vi.fn().mockResolvedValue(undefined)
}));

import { buildContextMessage } from '@cio/ai-assistant';
import { reglaNormalizada } from '@cio/db/queries/agent';
import { buildAgentTools } from '@api/services/agent/chat-tools';
import { correccionesParaElJuez, crearVerificadorDeFundamento } from '@api/services/agent/grounding';
import { indicacionesDeLasReglas } from '@api/services/agent/respuestas-del-formulario';
import { reglasConId, reglasVigentesDelCurso, separarReglas } from '@api/services/agent/reglas-de-la-docente';
import { lineasDelRegistro, registroVacio } from '@api/services/agent/round-ledger';

const CURSO = '00000000-0000-4000-8000-00000000c003';
const OPCIONES = { toolCallId: 'llamada', messages: [] };

const VECINO = { id: 'aaaaaaaa-1111-4111-8111-111111111111', kind: 'rule' as const, rule: 'Decir siempre «vecino», nunca «cliente».', teacherWords: null, createdAt: '2026-11-11T10:00:00Z' };
const SIETE_DIAS = { id: 'bbbbbbbb-2222-4222-8222-222222222222', kind: 'correction' as const, rule: 'El presupuesto vale siete días (no 48 horas, como dice el manual).', teacherWords: null, createdAt: '2026-11-11T11:00:00Z' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  base.reglasDelCurso.mockResolvedValue([VECINO, SIETE_DIAS]);
  base.guardarReglasDelCurso.mockResolvedValue([]);
  base.retirarReglaDelCurso.mockResolvedValue(true);
  generateObject.mockResolvedValue({ object: { afirmaciones: [] }, usage: {} });
});

describe('de dónde salen las reglas de una ronda', () => {
  it('una conversación sin plan recibe las del curso', async () => {
    const vigentes = await reglasVigentesDelCurso({ courseId: CURSO, delPlan: [] });

    expect(vigentes.reglas).toEqual([VECINO.rule]);
    expect(vigentes.correcciones).toEqual([SIETE_DIAS.rule]);
    expect(base.guardarReglasDelCurso).not.toHaveBeenCalled();
  });

  it('las del plan aprobado se copian al curso, para que el chat siguiente las tenga', async () => {
    await reglasVigentesDelCurso({ courseId: CURSO, delPlan: ['Tratar de vos.'], userId: 'docente', conversationId: 'conv' });

    expect(base.guardarReglasDelCurso).toHaveBeenCalledWith({
      courseId: CURSO,
      reglas: [{ kind: 'rule', rule: 'Tratar de vos.' }],
      createdBy: 'docente',
      conversationId: 'conv'
    });
  });

  it('si la base falla, la ronda sigue con las del plan en vez de romperse', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    base.reglasDelCurso.mockRejectedValue(new Error('relation "ai_course_teacher_rule" does not exist'));

    const vigentes = await reglasVigentesDelCurso({ courseId: CURSO, delPlan: ['Tratar de vos.'] });

    expect(vigentes).toEqual({ todas: [], reglas: ['Tratar de vos.'], correcciones: [] });
  });

  it('dos reglas que sólo difieren en mayúsculas o signos son la misma', () => {
    expect(reglaNormalizada('Decir siempre «vecino», nunca «cliente».')).toBe(
      reglaNormalizada('decir siempre vecino nunca CLIENTE')
    );
  });
});

describe('cómo les llegan', () => {
  const vigentes = separarReglas([VECINO, SIETE_DIAS]);

  it('al asistente: reglas y correcciones en secciones distintas, cada una con su id', () => {
    const contexto = buildContextMessage(
      { role: 'teacher', courseId: CURSO, courseTitle: 'Mostrador' } as never,
      { teacherRules: reglasConId(vigentes, 'rule'), teacherCorrections: reglasConId(vigentes, 'correction') }
    );

    expect(contexto).toContain("## The teacher's rules for this course");
    expect(contexto).toContain(`${VECINO.rule} [id aaaaaaaa]`);
    expect(contexto).toContain('## Facts the teacher corrected for this course');
    expect(contexto).toContain(`${SIETE_DIAS.rule} [id bbbbbbbb]`);
  });

  it('sin correcciones no hay sección de correcciones', () => {
    const contexto = buildContextMessage({ role: 'teacher', courseId: CURSO, courseTitle: 'Mostrador' } as never, {
      teacherRules: [VECINO.rule]
    });

    expect(contexto).not.toContain('Facts the teacher corrected');
  });

  it('a los escritores: la corrección va como contenido que reemplaza a la fuente, sin ids', () => {
    const indicaciones = indicacionesDeLasReglas(vigentes.reglas, vigentes.correcciones)!;

    expect(indicaciones).toContain(VECINO.rule);
    expect(indicaciones).toContain('## Facts the teacher corrected (they replace what the sources say)');
    expect(indicaciones).toContain(SIETE_DIAS.rule);
    // Medido en vivo: sin esto la lección nueva decía «versiones anteriores del
    // manual indicaban 48 horas», que es enseñar el dato viejo como historia.
    expect(indicaciones).toContain('Do not mention the older value at all');
    expect(indicaciones).not.toContain('[id ');
  });

  it('a los escritores les llega la corrección aunque no haya ninguna regla', () => {
    expect(indicacionesDeLasReglas([], [SIETE_DIAS.rule])).toContain(SIETE_DIAS.rule);
    expect(indicacionesDeLasReglas([], [])).toBeUndefined();
  });

  it('al juez: después de las fuentes y antes de la lección, como algo que las reemplaza', async () => {
    const juez = crearVerificadorDeFundamento({
      orgId: 'org',
      userId: 'usuario',
      courseId: CURSO,
      redis: {} as never,
      providerConfig: { provider: 'google', model: 'modelo-de-prueba' } as never,
      correcciones: vigentes.correcciones
    })!;

    await juez({ lessonTitle: 'El presupuesto', contenido: `<p>${'Todo presupuesto tiene una vigencia de siete días desde su emisión. '.repeat(8)}</p>` });

    const prompt = String(generateObject.mock.calls[0][0].prompt);

    expect(prompt).toContain('## Corrections dictated by the teacher');
    expect(prompt.indexOf('48 horas.')).toBeLessThan(prompt.indexOf(SIETE_DIAS.rule));
    expect(prompt.indexOf(SIETE_DIAS.rule)).toBeLessThan(prompt.indexOf('--- Lesson: El presupuesto ---'));
  });

  it('sin correcciones el juez recibe lo mismo que antes', () => {
    expect(correccionesParaElJuez([])).toBe('');
  });
});

describe('guardar una regla exige las palabras de la docente', () => {
  const DICHO = 'De ahora en adelante el presupuesto vale siete días, ya no cuarenta y ocho horas.';

  function herramientas(registro = registroVacio(), textosDeLaDocente: string[] = [DICHO]) {
    return buildAgentTools('org', 'docente', CURSO, [], {
      conversationId: '11111111-0000-4000-8000-000000000001',
      locale: 'es',
      registro,
      textosDeLaDocente
    }) as Record<string, { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> }>;
  }

  const CORRECCION = { kind: 'correction', rule: SIETE_DIAS.rule, teacherWords: 'el presupuesto vale siete días, ya no cuarenta y ocho horas' };

  it('con sus palabras, queda guardada para el curso y en el resumen de la ronda', async () => {
    base.guardarReglasDelCurso.mockResolvedValue([SIETE_DIAS]);
    const registro = registroVacio();

    const resultado = await herramientas(registro).remember_teacher_rule.execute(CORRECCION, OPCIONES);

    expect(base.guardarReglasDelCurso).toHaveBeenCalledWith({
      courseId: CURSO,
      reglas: [CORRECCION],
      createdBy: 'docente',
      conversationId: '11111111-0000-4000-8000-000000000001'
    });
    expect(resultado).toMatchObject({ saved: true, id: 'bbbbbbbb', kind: 'correction' });
    expect(lineasDelRegistro(registro)).toEqual([`Guardó para todo el curso «${SIETE_DIAS.rule}»`]);
  });

  it('con palabras que ella no escribió, no se guarda nada', async () => {
    const resultado = await herramientas().remember_teacher_rule.execute(
      { ...CORRECCION, teacherWords: 'el presupuesto ahora vale quince días hábiles' },
      OPCIONES
    );

    expect(resultado).toMatchObject({ ok: false, error: expect.stringContaining('EXACT words') });
    expect(base.guardarReglasDelCurso).not.toHaveBeenCalled();
  });

  it('si el curso ya la tenía, lo dice en vez de darla por guardada otra vez', async () => {
    const resultado = await herramientas().remember_teacher_rule.execute(CORRECCION, OPCIONES);

    expect(resultado).toMatchObject({ saved: false, alreadyKnown: true });
  });

  it('retirar una también exige sus palabras, y nombra la regla por su id', async () => {
    const pedido = 'Olvidate de lo de vecino, volvé a decir cliente.';
    const registro = registroVacio();
    const conSusPalabras = herramientas(registro, [pedido]);

    const sinCita = await conSusPalabras.forget_teacher_rule.execute({ id: 'aaaaaaaa', teacherWords: 'sacá todas las reglas del curso' }, OPCIONES);

    expect(sinCita).toMatchObject({ ok: false });
    expect(base.retirarReglaDelCurso).not.toHaveBeenCalled();

    const retirada = await conSusPalabras.forget_teacher_rule.execute({ id: 'aaaaaaaa', teacherWords: 'Olvidate de lo de vecino' }, OPCIONES);

    expect(retirada).toMatchObject({ withdrawn: true, rule: VECINO.rule });
    expect(base.retirarReglaDelCurso).toHaveBeenCalledWith(CURSO, VECINO.id);
    expect(lineasDelRegistro(registro)).toEqual([`Retiró de las reglas del curso «${VECINO.rule}»`]);
  });

  it('un id que no es de ninguna regla no retira nada', async () => {
    const resultado = await herramientas(registroVacio(), ['Olvidate de lo de vecino']).forget_teacher_rule.execute(
      { id: 'cccccccc', teacherWords: 'Olvidate de lo de vecino' },
      OPCIONES
    );

    expect(resultado).toMatchObject({ ok: false });
    expect(base.retirarReglaDelCurso).not.toHaveBeenCalled();
  });
});
