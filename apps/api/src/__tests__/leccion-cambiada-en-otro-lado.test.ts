/**
 * Un guardado del editor no pisa en silencio lo que otro guardó mientras tanto.
 *
 * Medido el 2026-11-10 (dos sesiones sobre la misma lección): el asistente de
 * otra cuenta agregó un párrafo, la docente —que no lo había visto— guardó lo
 * suyo, el servidor respondió 201 y el párrafo desapareció.
 *
 * Lo falso es la base: el servicio y la regla son los de verdad.
 */
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ZLessonLanguageCreate } from '@cio/utils/validation/lesson';

const base = vi.hoisted(() => ({
  guardado: null as null | { id: number; lessonId: string; locale: string; content: string | null },
  upsert: vi.fn(),
  historial: vi.fn(async () => {})
}));

vi.mock('@cio/db/queries/lesson/language', () => ({
  deleteLessonLanguage: vi.fn(),
  getLessonLanguagesByLessonId: vi.fn(async () => []),
  getLessonLanguageByLessonIdAndLocale: vi.fn(async () => base.guardado),
  recordLessonLanguageHistory: base.historial,
  updateLessonLanguage: vi.fn(),
  upsertLessonLanguage: base.upsert
}));
vi.mock('@cio/db/queries/lesson/lesson', () => ({
  getLessonById: vi.fn(async (id: string) => ({ id, courseId: 'curso-1' }))
}));
vi.mock('@cio/db/queries/course', () => ({ touchCourseUpdatedAt: vi.fn(async () => {}) }));
vi.mock('@api/services/agent/embeddings', () => ({ reindexLessonLanguageInBackground: vi.fn() }));

const { upsertLessonLanguageService } = await import('@api/services/lesson-language');
const { chocaConOtroGuardado, huellaDelContenido, CODIGO_LECCION_CAMBIADA } = await import(
  '@api/services/lesson-conflict'
);

const LECCION = 'leccion-1';
const AL_ABRIR = '<p>El presupuesto vale siete días.</p>';
const DEL_ASISTENTE = '<p>El presupuesto vale siete días.</p><p>Se entrega firmado.</p>';
const DE_LA_DOCENTE = '<p>El presupuesto vale siete días hábiles.</p>';

/** La cuenta que hace el navegador con `crypto.subtle`. */
const huellaDelNavegador = (texto: string) => createHash('sha256').update(new TextEncoder().encode(texto)).digest('hex');

beforeEach(() => {
  vi.clearAllMocks();
  base.guardado = { id: 7, lessonId: LECCION, locale: 'es', content: AL_ABRIR };
  base.upsert.mockImplementation(async (datos: { content?: string | null }) => ({
    id: 7,
    lessonId: LECCION,
    locale: 'es',
    content: datos.content ?? null
  }));
});

describe('la huella', () => {
  it('es la misma que calcula el navegador, también con acentos y sin texto', () => {
    expect(huellaDelContenido(AL_ABRIR)).toBe(huellaDelNavegador(AL_ABRIR));
    expect(huellaDelContenido(null)).toBe(huellaDelNavegador(''));
    expect(huellaDelContenido(undefined)).toBe(huellaDelNavegador(''));
  });

  it('el esquema del pedido la deja pasar (zod descarta lo que no declara)', () => {
    const huella = huellaDelContenido(AL_ABRIR);

    expect(ZLessonLanguageCreate.parse({ locale: 'es', content: 'x', baseHash: huella }).baseHash).toBe(huella);
    expect(ZLessonLanguageCreate.safeParse({ locale: 'es', content: 'x', baseHash: 'no-es-una-huella' }).success).toBe(
      false
    );
  });
});

describe('cuándo un guardado choca', () => {
  it('choca si lo guardado ya no es lo que el editor había cargado', () => {
    expect(
      chocaConOtroGuardado({ baseHash: huellaDelContenido(AL_ABRIR), guardado: DEL_ASISTENTE, nuevo: DE_LA_DOCENTE })
    ).toBe(true);
  });

  it('no choca si nadie tocó la lección', () => {
    expect(
      chocaConOtroGuardado({ baseHash: huellaDelContenido(AL_ABRIR), guardado: AL_ABRIR, nuevo: DE_LA_DOCENTE })
    ).toBe(false);
  });

  it('guardar exactamente lo que ya está no es un choque', () => {
    expect(
      chocaConOtroGuardado({ baseHash: huellaDelContenido(AL_ABRIR), guardado: DEL_ASISTENTE, nuevo: DEL_ASISTENTE })
    ).toBe(false);
  });

  it('sin huella no se compara: es quien decidió guardar lo suyo igual', () => {
    expect(chocaConOtroGuardado({ baseHash: undefined, guardado: DEL_ASISTENTE, nuevo: DE_LA_DOCENTE })).toBe(false);
  });
});

describe('guardar el texto de una lección', () => {
  it('si otro la guardó mientras tanto, responde 409 y NO escribe', async () => {
    base.guardado!.content = DEL_ASISTENTE;

    await expect(
      upsertLessonLanguageService(LECCION, {
        locale: 'es',
        content: DE_LA_DOCENTE,
        baseHash: huellaDelContenido(AL_ABRIR)
      })
    ).rejects.toMatchObject({ code: CODIGO_LECCION_CAMBIADA, statusCode: 409 });

    expect(base.upsert).not.toHaveBeenCalled();
    expect(base.historial).not.toHaveBeenCalled();
  });

  it('si nadie la tocó, guarda — y la huella no viaja a la base', async () => {
    const guardada = await upsertLessonLanguageService(LECCION, {
      locale: 'es',
      content: DE_LA_DOCENTE,
      baseHash: huellaDelContenido(AL_ABRIR)
    });

    expect(guardada.content).toBe(DE_LA_DOCENTE);
    expect(base.upsert).toHaveBeenCalledTimes(1);
    expect(base.upsert.mock.calls[0][0]).not.toHaveProperty('baseHash');
  });

  it('sin huella pisa lo que haya: «guardar lo mío igual», y lo anterior queda en el historial', async () => {
    base.guardado!.content = DEL_ASISTENTE;

    await upsertLessonLanguageService(LECCION, { locale: 'es', content: DE_LA_DOCENTE });

    expect(base.upsert).toHaveBeenCalledTimes(1);
    expect(base.historial).toHaveBeenCalledWith(
      expect.objectContaining({ oldContent: DEL_ASISTENTE, newContent: DE_LA_DOCENTE })
    );
  });

  it('el primer guardado de una lección vacía no choca', async () => {
    base.guardado = null;

    await upsertLessonLanguageService(LECCION, {
      locale: 'es',
      content: DE_LA_DOCENTE,
      baseHash: huellaDelContenido('')
    });

    expect(base.upsert).toHaveBeenCalledTimes(1);
  });
});
