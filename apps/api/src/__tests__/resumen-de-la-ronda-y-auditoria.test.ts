import { describe, expect, it, vi } from 'vitest';

import { anotarCambio, lineasDelRegistro, registroVacio } from '@api/services/agent/round-ledger';
import { cambiosDePreguntas, resumenDeAgregadas } from '@api/services/agent/resumen-de-preguntas';
import { auditarCambiosDeLaRonda, type IdentidadDelPedido } from '@api/services/agent/auditoria-del-asistente';

/**
 * Lo que la ronda cambió, dicho entero: en el resumen y en la auditoría.
 *
 * ── Qué pasó (producción, 2026-11-07) ────────────────────────────────────────
 *
 * Una ronda agregó doce preguntas (trece puntos) a un examen final que
 * cincuenta alumnos ya habían rendido, y el resumen dijo «Cambió las preguntas
 * de «Examen final» (3 veces)». En la misma ronda reescribió una pregunta de
 * verdadero/falso para que afirmara lo contrario, con la misma respuesta
 * correcta, mientras el chat le contaba otra cosa a la docente. Y la auditoría
 * sólo decía «usó el asistente»: hubo que leer la conversación para saberlo.
 *
 * Curso inventado, de un almacén que no existe.
 */

describe('el resumen de las preguntas', () => {
  it('cuenta cuántas se agregaron y cuántos puntos suman, juntando las repeticiones', () => {
    const registro = registroVacio();

    // Tres bloques de un examen, uno por llamada: así fue el incidente.
    for (const puntos of [[1, 2, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1]]) {
      anotarCambio(registro, 'pregunto', 'Examen final', {
        agregadas: resumenDeAgregadas(puntos.map((p) => ({ points: p })))
      });
    }

    expect(lineasDelRegistro(registro)).toEqual([
      'Cambió las preguntas de «Examen final» (3 veces): agregó 12 preguntas (13 puntos)'
    ]);
  });

  it('una afirmación invertida con la misma correcta se lee: enunciado antes y después, y la correcta', () => {
    const antes = [
      {
        id: 7,
        title: 'Si un cliente compra agua por primera vez sin envase, se le cobra sólo la recarga.',
        points: 1,
        options: [
          { label: 'Verdadero', isCorrect: false },
          { label: 'Falso', isCorrect: true }
        ]
      }
    ];
    const despues = [
      {
        id: 7,
        question: 'Si un cliente compra agua por primera vez sin envase, se le cobra el envase más la recarga.',
        points: 1,
        options: [
          { label: 'Verdadero', isCorrect: false },
          { label: 'Falso', isCorrect: true }
        ]
      }
    ];

    // Arranca cerca de donde difieren: recortadas desde el principio, las dos
    // quedaban en «…se le cobra sól…» y «…se le cobra el …», y lo que cambió no
    // se veía.
    expect(cambiosDePreguntas(antes, despues)).toEqual([
      '«…envase, se le cobra sólo la recarga.» → «…envase, se le cobra el envase más la recarga.», correcta: Falso'
    ]);
  });

  it('dice cuándo cambia la correcta o los puntos, y calla lo que no cambió', () => {
    const antes = [
      { id: 1, title: '¿Cuántas bolsas anotás?', points: 1, settings: { correctValue: 40 } },
      { id: 2, title: '¿Quién firma el remito?', points: 1, options: [{ label: 'El repartidor', isCorrect: true }] },
      { id: 3, title: 'Sin cambios', points: 2, options: [{ label: 'Sí', isCorrect: true }] }
    ];
    const despues = [
      { id: 1, question: '¿Cuántas bolsas anotás?', points: 1, settings: { correctValue: 35 } },
      { id: 2, question: '¿Quién firma el remito?', points: 2, options: [{ label: 'El repartidor', isCorrect: true }] },
      { id: 3, question: 'Sin cambios', points: 2, options: [{ label: 'Sí', isCorrect: true }] }
    ];

    expect(cambiosDePreguntas(antes, despues)).toEqual(['correcta: 40 → 35', 'puntos: 1 → 2']);
  });

  it('con muchas reescrituras nombra cinco y cuenta el resto', () => {
    const registro = registroVacio();

    anotarCambio(registro, 'pregunto', 'Cuestionario de caja', {
      cambios: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((letra) => `puntos de ${letra}: 1 → 2`)
    });

    const [linea] = lineasDelRegistro(registro);

    expect(linea).toContain('puntos de e: 1 → 2');
    expect(linea).not.toContain('puntos de f');
    expect(linea).toMatch(/y 2 cambios más$/);
  });
});

describe('la auditoría de lo que cambió el asistente', () => {
  const IDENTIDAD: IdentidadDelPedido = {
    orgId: '00000000-0000-4000-8000-00000000e002',
    userId: '00000000-0000-4000-8000-00000000a002',
    userLabel: 'docente@almacen-demo.test',
    userRole: null,
    orgRole: 1,
    sessionId: null,
    ip: '203.0.113.7',
    device: 'Windows',
    browser: 'Edge',
    userAgent: 'prueba'
  };
  const CURSO = '00000000-0000-4000-8000-00000000c002';
  const EXAMEN = '00000000-0000-4000-8000-0000000e0001';

  it('una fila por cambio, con la entidad tocada, la firma de la docente y la línea del resumen', async () => {
    const registro = registroVacio();
    const registrar = vi.fn(async () => {});

    anotarCambio(registro, 'pregunto', 'Examen final', {
      entidad: { tipo: 'Exercise', id: EXAMEN },
      agregadas: { cantidad: 4, puntos: 5 }
    });
    anotarCambio(registro, 'saco_del_plan', 'Cuestionario de caja');

    await auditarCambiosDeLaRonda({ identidad: IDENTIDAD, registro, courseId: CURSO, conversationId: 'conv-1', registrar });

    expect(registrar).toHaveBeenCalledTimes(2);
    expect(registrar).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        ...IDENTIDAD,
        action: 'ASISTENTE_CAMBIO_PREGUNTAS',
        entity: 'Exercise',
        entityId: EXAMEN,
        always: true,
        metadata: expect.objectContaining({
          courseId: CURSO,
          conversationId: 'conv-1',
          resumen: 'Cambió las preguntas de «Examen final»: agregó 4 preguntas (5 puntos)'
        })
      })
    );
    // Sin entidad propia, queda colgado del curso: igual se encuentra por curso.
    expect(registrar).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ action: 'ASISTENTE_SACO_DEL_PLAN', entity: 'Course', entityId: CURSO })
    );
  });

  it('una ronda que no cambió nada no escribe nada', async () => {
    const registrar = vi.fn(async () => {});

    await auditarCambiosDeLaRonda({ identidad: IDENTIDAD, registro: registroVacio(), courseId: CURSO, registrar });

    expect(registrar).not.toHaveBeenCalled();
  });

  it('las preguntas que la ronda dejó a revisar quedan en la auditoría, una fila por pregunta', async () => {
    const registrar = vi.fn(async () => {});

    await auditarCambiosDeLaRonda({
      identidad: IDENTIDAD,
      registro: registroVacio(),
      courseId: CURSO,
      conversationId: 'conv-2',
      preguntasARevisar: [
        {
          exerciseId: EXAMEN,
          exerciseTitle: 'Examen final',
          questionId: '41',
          questionTitle: '¿Cada cuánto se cuenta la caja?',
          evidence: 'La caja se cuenta al cierre de cada turno.'
        }
      ],
      registrar
    });

    expect(registrar).toHaveBeenCalledTimes(1);
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        ...IDENTIDAD,
        action: 'ASISTENTE_DEJO_PREGUNTA_A_REVISAR',
        entity: 'Exercise',
        entityId: EXAMEN,
        always: true,
        metadata: {
          courseId: CURSO,
          conversationId: 'conv-2',
          ejercicio: 'Examen final',
          preguntaId: '41',
          pregunta: '¿Cada cuánto se cuenta la caja?',
          seBasabaEn: 'La caja se cuenta al cierre de cada turno.'
        }
      })
    );
  });

  it('si la base falla en una fila, sigue con las otras y no rompe nada', async () => {
    const registro = registroVacio();
    const registrar = vi.fn().mockRejectedValueOnce(new Error('la base no contesta')).mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    anotarCambio(registro, 'borro', 'Lección vieja');
    anotarCambio(registro, 'creo', 'Sección nueva');

    await expect(
      auditarCambiosDeLaRonda({ identidad: IDENTIDAD, registro, courseId: CURSO, registrar })
    ).resolves.toBeUndefined();
    expect(registrar).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
});
