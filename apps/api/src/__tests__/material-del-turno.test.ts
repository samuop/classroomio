import { describe, expect, it } from 'vitest';

import { documentosEnLineaConIndice, esAdjuntoDeEsteMensaje } from '@api/services/agent/adjunto-del-turno';
import {
  avisoDeFuentesFueraDelPlan,
  fuentesFueraDelPlan,
  MARGEN_SIN_SELLO_MS,
  momentoDelPlan
} from '@api/services/agent/fuentes-fuera-del-plan';
// La fuente del prompt, no la compilada: `@cio/ai-assistant` se lee del `dist`,
// y lo que hay que probar es el texto que se va a compilar.
import { buildTeacherContextMessage } from '../../../../packages/ai-assistant/src/prompt/teacher';

/**
 * Qué material acompaña a un turno del chat, y cómo se lo presenta.
 *
 * ── Lo que se midió (2026-09-29) ─────────────────────────────────────────────
 *
 * 1. El panel manda `context.documentId` en cada pedido mientras la fuente
 *    siga adjunta. La primera página de la investigación viajó entera en cada
 *    paso de una construcción —unas 4.700 fichas— presentada como «el PDF que
 *    el docente acaba de adjuntar… la fuente de verdad para armar el curso».
 * 2. Una fuente agregada entre el plan y su aprobación quedó afuera de toda la
 *    construcción sin que nadie lo dijera.
 */

const usuario = (texto: string, attachment?: Record<string, unknown>) => ({
  role: 'user',
  parts: [{ type: 'text', text: texto }],
  ...(attachment ? { metadata: { attachment } } : {})
});
const asistente = (texto: string) => ({ role: 'assistant', parts: [{ type: 'text', text: texto }] });

describe('el adjunto de este mensaje', () => {
  it('es el que llegó con el último mensaje del docente y con ninguno anterior', () => {
    const mensajes = [
      usuario('Armá un curso de caja.'),
      asistente('¿Tenés material?'),
      usuario('Acá va el manual.', { name: 'Manual de caja.pdf', documentId: 'fuente-manual' })
    ];

    expect(esAdjuntoDeEsteMensaje(mensajes, 'fuente-manual')).toBe(true);
  });

  it('también cuando llega en la lista de documentos del primer mensaje', () => {
    const mensajes = [usuario('Armá un curso con esto.', { documentIds: ['fuente-a', 'fuente-manual'] })];

    expect(esAdjuntoDeEsteMensaje(mensajes, 'fuente-manual')).toBe(true);
  });

  it('no, si ya lo nombraba un mensaje anterior: es la fuente que quedó pegada en el compositor', () => {
    const mensajes = [
      usuario('Armá un curso con esto.', { documentIds: ['fuente-manual'] }),
      asistente('Listo el plan.'),
      usuario('Construí el curso según el plan aprobado.', { name: 'document', documentId: 'fuente-manual' })
    ];

    expect(esAdjuntoDeEsteMensaje(mensajes, 'fuente-manual')).toBe(false);
  });

  it('no, si el último mensaje no lo nombra aunque viaje en el contexto', () => {
    const mensajes = [usuario('Seguí construyendo el plan desde donde quedó.')];

    expect(esAdjuntoDeEsteMensaje(mensajes, 'fuente-manual')).toBe(false);
    expect(esAdjuntoDeEsteMensaje(mensajes, undefined)).toBe(false);
  });
});

describe('qué documento va entero cuando el material viaja como índice', () => {
  it('ninguno si ya es fuente del curso: está en el índice y se lee con read_source', () => {
    expect(documentosEnLineaConIndice({ documentId: 'fuente-manual', idsDelIndice: ['fuente-manual'] })).toEqual([]);
  });

  it('sí, si el índice no lo tiene: si no, el modelo no tendría cómo verlo', () => {
    expect(documentosEnLineaConIndice({ documentId: 'pagina-suelta', idsDelIndice: ['fuente-manual'] })).toEqual([
      'pagina-suelta'
    ]);
  });

  it('sin documento, nada', () => {
    expect(documentosEnLineaConIndice({ idsDelIndice: ['fuente-manual'] })).toEqual([]);
  });
});

describe('cómo se le presenta el documento al modelo', () => {
  const CONTEXTO = {
    courseId: 'curso-de-prueba',
    courseTitle: 'Caja del Almacén Demo',
    userId: 'docente-de-prueba',
    role: 'teacher',
    locale: 'es'
  } as const;

  const mensaje = (extra: Record<string, unknown>) =>
    buildTeacherContextMessage({ ...CONTEXTO, ...extra } as Parameters<typeof buildTeacherContextMessage>[0]);

  it('nunca como «el PDF que el docente acaba de adjuntar»: puede ser una página web y puede no ser de este turno', () => {
    for (const documentAttachedThisTurn of [true, false]) {
      const texto = mensaje({ documentText: 'TEXTO', documentAttachedThisTurn });

      expect(texto).not.toMatch(/PDF the teacher just attached/);
      expect(texto).not.toMatch(/source of truth and build the course structure from it/);
    }
  });

  it('adjuntado con este mensaje: es el foco del turno', () => {
    const texto = mensaje({ documentText: 'TEXTO', documentAttachedThisTurn: true });

    expect(texto).toContain('The teacher attached a document to THIS message');
    expect(texto).toContain('<document>\nTEXTO\n</document>');
  });

  it('de antes: material de referencia, no un pedido nuevo', () => {
    const texto = mensaje({ documentText: 'TEXTO', documentAttachedThisTurn: false });

    expect(texto).toContain('none of it was attached to this message');
    expect(texto).not.toContain('attached a document to THIS message');
  });

  it('con el adjunto de este turno buscable, el bloque sólo trae lo de antes', () => {
    const texto = mensaje({ documentText: 'RESUMENES', documentAttachedThisTurn: true, searchableDocument: true });

    expect(texto).toContain('none of it was attached to this message');
  });

  it('el índice de fuentes se sigue explicando aunque además haya un documento en línea', () => {
    const texto = mensaje({ documentText: 'TEXTO', courseSourceCount: 3, sourcesAsIndex: true });

    expect(texto).toContain('<document>');
    expect(texto).toContain('call `read_source` with an id to read one');
  });

  it('un adjunto de este turno que ya es fuente se nombra, para que lo lea con read_source', () => {
    const texto = mensaje({
      documentId: 'fuente-manual',
      documentAttachedThisTurn: true,
      courseSourceCount: 3,
      sourcesAsIndex: true
    });

    expect(texto).toContain('With this message the teacher attached the source with id fuente-manual');
    expect(texto).not.toContain('<document>');
  });

  it('una fuente que quedó pegada de antes no se presenta como el foco del turno', () => {
    const texto = mensaje({
      documentId: 'fuente-manual',
      documentAttachedThisTurn: false,
      courseSourceCount: 3,
      sourcesAsIndex: true
    });

    expect(texto).not.toContain('With this message the teacher attached');
  });
});

describe('cuándo se armó el plan que se aprobó', () => {
  const PLAN_PROPUESTO = (finishedAt?: string) => ({
    role: 'assistant',
    ...(finishedAt ? { metadata: { finishedAt } } : {}),
    parts: [{ type: 'tool-generate_course_plan', state: 'output-available' }]
  });
  const APROBACION = {
    role: 'user',
    metadata: { plan: { action: 'implement_course_plan' } },
    parts: [{ type: 'text', text: 'Construí el curso según el plan aprobado.' }]
  };

  it('es el sello del mensaje que propuso el plan aprobado', () => {
    const mensajes = [
      usuario('Armá un curso.'),
      PLAN_PROPUESTO('2026-09-29T15:30:00.000Z'),
      usuario('Cambiá la sección 2.'),
      PLAN_PROPUESTO('2026-09-29T15:43:30.000Z'),
      APROBACION,
      asistente('Construyendo…')
    ];

    expect(momentoDelPlan(mensajes)).toBe('2026-09-29T15:43:30.000Z');
  });

  it('sin sello (planes de antes de que existiera), no inventa uno', () => {
    expect(momentoDelPlan([usuario('Armá un curso.'), PLAN_PROPUESTO(), APROBACION])).toBeUndefined();
  });

  it('sin aprobación no hay plan que fechar', () => {
    expect(momentoDelPlan([usuario('Armá un curso.'), PLAN_PROPUESTO('2026-09-29T15:43:30.000Z')])).toBeUndefined();
  });
});

describe('las fuentes que llegaron después del plan y el plan no usa', () => {
  const plan = (fuentes: string[]) => ({
    sections: [{ items: [{ sources: fuentes }, { sources: undefined }] }]
  });
  const MANUAL = { id: 'fuente-manual', fileName: 'Manual de caja.pdf', createdAt: '2026-09-29 15:40:00+00' };
  const PLANILLA = { id: 'fuente-planilla', fileName: 'Planilla de precios', createdAt: '2026-09-29 15:48:21+00' };
  const VIEJA = { id: 'fuente-vieja', fileName: 'Reglamento interno.pdf', createdAt: '2026-09-29 15:10:00+00' };

  it('con sello: las creadas después que ningún ítem declara', () => {
    const nuevas = fuentesFueraDelPlan({
      plan: plan(['Manual de caja.pdf']),
      fuentes: [MANUAL, PLANILLA, VIEJA],
      planArmadoEn: '2026-09-29T15:43:30.000Z'
    });

    // La vieja tampoco: el plan decidió no usarla, y eso no es noticia.
    expect(nuevas.map((fuente) => fuente.id)).toEqual(['fuente-planilla']);
  });

  it('una fuente declarada con otro nombre parecido cuenta como declarada, igual que para el escritor', () => {
    // La página guardada con el dominio pegado al título; el plan la nombra sin él.
    const planillaWeb = { ...PLANILLA, fileName: 'Planilla de precios (docs.google.com)' };

    const nuevas = fuentesFueraDelPlan({
      plan: plan(['Manual de caja.pdf', 'Planilla de precios']),
      fuentes: [MANUAL, planillaWeb],
      planArmadoEn: '2026-09-29T15:43:30.000Z'
    });

    expect(nuevas).toEqual([]);
  });

  it('sin sello: lo nuevo empieza un minuto después de la fuente más nueva que el plan nombra', () => {
    const casiJunto = {
      id: 'pagina-investigada',
      fileName: 'Página investigada',
      createdAt: new Date(Date.parse('2026-09-29T15:40:00.000Z') + MARGEN_SIN_SELLO_MS - 1_000).toISOString()
    };

    const nuevas = fuentesFueraDelPlan({ plan: plan(['Manual de caja.pdf']), fuentes: [MANUAL, casiJunto, PLANILLA] });

    // La que subió junto con las del plan no se anuncia; la de ocho minutos después, sí.
    expect(nuevas.map((fuente) => fuente.id)).toEqual(['fuente-planilla']);
  });

  it('sin sello ni fuentes declaradas no hay con qué medir: calla', () => {
    expect(fuentesFueraDelPlan({ plan: plan([]), fuentes: [MANUAL, PLANILLA] })).toEqual([]);
  });

  it('el aviso nombra cada fuente con su id y pide avisarle al docente y ofrecer rehacer el plan', () => {
    const aviso = avisoDeFuentesFueraDelPlan([PLANILLA]);

    expect(aviso).toContain('## Sources added after the plan');
    expect(aviso).toContain('"Planilla de precios" (id: fuente-planilla)');
    expect(aviso).toMatch(/tell the teacher/);
    expect(aviso).toMatch(/offer to redo the plan/);
    // No la mete en el plan por su cuenta: eso sería construir algo que el docente no aprobó.
    expect(aviso).toMatch(/do not work these into lessons on your own/);
  });

  it('sin fuentes nuevas no hay aviso', () => {
    expect(avisoDeFuentesFueraDelPlan([])).toBeUndefined();
  });
});
