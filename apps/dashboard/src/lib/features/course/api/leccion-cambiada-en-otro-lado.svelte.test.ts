import { createHash } from 'node:crypto';
import { vi } from 'vitest';

import { ApiError } from '$lib/utils/services/api/types';

/**
 * El editor de una lección frente a un cambio que entró por otro lado.
 *
 * Medido el 2026-11-10, con dos sesiones sobre la misma lección:
 *
 * 1. El asistente de otra cuenta agregó un párrafo; la docente, que no lo había
 *    visto, guardó lo suyo y el párrafo desapareció (201, sin aviso).
 * 2. La docente tecleaba mientras el asistente terminaba un cambio: el panel
 *    refrescó la lección y lo tecleado se borró de la pantalla.
 *
 * Lo único falso es el transporte: la clase y sus estados son los de verdad.
 */

const falso = vi.hoisted(() => ({
  leccionGet: vi.fn(),
  idiomaPost: vi.fn(),
  snackbarError: vi.fn()
}));

vi.mock('$lib/utils/services/api', async () => {
  const constantes = await vi.importActual<typeof import('$lib/utils/services/api/constants')>(
    '$lib/utils/services/api/constants'
  );
  const base = await vi.importActual<typeof import('$lib/utils/services/api/base.svelte')>(
    '$lib/utils/services/api/base.svelte'
  );

  return {
    AI_REQUEST_TIMEOUT: constantes.AI_REQUEST_TIMEOUT,
    llamadaDeIA: constantes.llamadaDeIA,
    BaseApi: base.BaseApi,
    BaseApiWithErrors: base.BaseApiWithErrors,
    classroomio: {
      course: {
        ':courseId': {
          lesson: { ':lessonId': { $get: falso.leccionGet, language: { $post: falso.idiomaPost } } }
        }
      }
    }
  };
});
vi.mock('$features/ui/snackbar/store', () => ({
  snackbar: { error: falso.snackbarError, success: vi.fn(), info: vi.fn() }
}));

const { lessonApi, CODIGO_LECCION_CAMBIADA } = await import('./lesson.svelte');

const CURSO = 'curso-1';
const LECCION = 'leccion-1';
const AL_ABRIR = '<p>El presupuesto vale siete días.</p>';
const DEL_ASISTENTE = '<p>El presupuesto vale siete días.</p><p>Se entrega firmado.</p>';
const DE_LA_DOCENTE = '<p>El presupuesto vale siete días hábiles.</p>';

/** La misma cuenta que hace la API con `node:crypto`. */
const huella = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status });

// Una respuesta nueva por pedido: el cuerpo de una `Response` se lee una sola vez.
const servidorTiene = (contenido: string) =>
  falso.leccionGet.mockImplementation(async () =>
    json({ success: true, data: { id: LECCION, title: 'Lección', lessonLanguages: [{ locale: 'es', content: contenido }] } })
  );

const servidorGuarda = () =>
  falso.idiomaPost.mockImplementation(async ({ json: cuerpo }: { json: { content: string } }) =>
    json({ success: true, data: { locale: 'es', content: cuerpo.content } }, 201)
  );

const servidorRechaza = () =>
  falso.idiomaPost.mockRejectedValue(
    new ApiError(
      JSON.stringify({ success: false, error: 'This lesson was changed since you opened it', code: CODIGO_LECCION_CAMBIADA }),
      409
    )
  );

const cuerpoDelGuardado = (llamada = 0) =>
  (falso.idiomaPost.mock.calls[llamada][0] as { json: { content: string; baseHash?: string } }).json;

/** La docente teclea: el texto cambia en pantalla y queda sin guardar. */
function teclear(texto: string) {
  lessonApi.translations[LECCION] = { ...lessonApi.translations[LECCION], es: texto };
  lessonApi.isDirty = true;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  lessonApi.currentLocale = 'es';
  lessonApi.isDirty = false;
  lessonApi.conflicto = null;

  // La lección abierta, con lo que había en el servidor en ese momento.
  servidorTiene(AL_ABRIR);
  await lessonApi.get(CURSO, LECCION, { descartarLoMio: true });
});

describe('guardar el texto', () => {
  it('manda la huella del texto que el editor había cargado', async () => {
    servidorGuarda();
    teclear(DE_LA_DOCENTE);

    await lessonApi.upsertLanguage(CURSO, LECCION, 'es', DE_LA_DOCENTE);

    expect(cuerpoDelGuardado()).toEqual({ locale: 'es', content: DE_LA_DOCENTE, baseHash: huella(AL_ABRIR) });
  });

  it('después de guardar, la base es lo que el servidor guardó', async () => {
    servidorGuarda();

    await lessonApi.upsertLanguage(CURSO, LECCION, 'es', DE_LA_DOCENTE);
    await lessonApi.upsertLanguage(CURSO, LECCION, 'es', `${DE_LA_DOCENTE}<p>Más.</p>`);

    expect(cuerpoDelGuardado(1).baseHash).toBe(huella(DE_LA_DOCENTE));
  });

  it('si la lección cambió en otro lado (409): no se guarda, queda marcado el choque y no sale el error genérico', async () => {
    servidorRechaza();
    teclear(DE_LA_DOCENTE);

    const respuesta = await lessonApi.upsertLanguage(CURSO, LECCION, 'es', DE_LA_DOCENTE);

    expect(respuesta).toBeUndefined();
    expect(lessonApi.conflicto).toEqual({ lessonId: LECCION, locale: 'es' });
    expect(lessonApi.isDirty).toBe(true);
    expect(lessonApi.translations[LECCION].es).toBe(DE_LA_DOCENTE);
    expect(falso.snackbarError).not.toHaveBeenCalled();
  });

  it('cualquier otro error sigue avisando como antes, y no marca un choque', async () => {
    falso.idiomaPost.mockRejectedValue(new ApiError(JSON.stringify({ success: false, error: 'x', code: 'OTRO' }), 500));

    await lessonApi.upsertLanguage(CURSO, LECCION, 'es', DE_LA_DOCENTE);

    expect(lessonApi.conflicto).toBeNull();
    expect(falso.snackbarError).toHaveBeenCalledWith('snackbar.materials.update_translations');
  });

  it('«guardar la mía igual» va sin huella, y al guardarse el choque se levanta', async () => {
    servidorRechaza();
    await lessonApi.upsertLanguage(CURSO, LECCION, 'es', DE_LA_DOCENTE);
    expect(lessonApi.conflicto).not.toBeNull();

    servidorGuarda();
    await lessonApi.upsertLanguage(CURSO, LECCION, 'es', DE_LA_DOCENTE, { forzar: true });

    expect(cuerpoDelGuardado(1)).toEqual({ locale: 'es', content: DE_LA_DOCENTE });
    expect(lessonApi.conflicto).toBeNull();
  });

  it('un diagrama rehecho desde esta pantalla pasa a ser la base: el guardado siguiente no choca contra sí mismo', async () => {
    servidorGuarda();
    lessonApi.updateTranslation(LECCION, 'es', DEL_ASISTENTE);

    await lessonApi.upsertLanguage(CURSO, LECCION, 'es', DEL_ASISTENTE);

    expect(cuerpoDelGuardado().baseHash).toBe(huella(DEL_ASISTENTE));
  });
});

describe('un refresco de la lección', () => {
  it('sin cambios locales, trae lo nuevo a la pantalla', async () => {
    servidorTiene(DEL_ASISTENTE);

    await lessonApi.get(CURSO, LECCION);

    expect(lessonApi.translations[LECCION].es).toBe(DEL_ASISTENTE);
    expect(lessonApi.conflicto).toBeNull();
  });

  it('con texto sin guardar NO lo reemplaza, y marca el choque si el servidor ya tiene otro texto', async () => {
    teclear(DE_LA_DOCENTE);
    servidorTiene(DEL_ASISTENTE);

    await lessonApi.get(CURSO, LECCION);

    expect(lessonApi.translations[LECCION].es).toBe(DE_LA_DOCENTE);
    expect(lessonApi.conflicto).toEqual({ lessonId: LECCION, locale: 'es' });
  });

  it('y el guardado siguiente sale con la huella VIEJA: el servidor es quien lo frena', async () => {
    teclear(DE_LA_DOCENTE);
    servidorTiene(DEL_ASISTENTE);
    await lessonApi.get(CURSO, LECCION);
    servidorGuarda();

    await lessonApi.upsertLanguage(CURSO, LECCION, 'es', DE_LA_DOCENTE);

    expect(cuerpoDelGuardado().baseHash).toBe(huella(AL_ABRIR));
  });

  it('con texto sin guardar y el servidor igual que antes, no hay nada que avisar', async () => {
    teclear(DE_LA_DOCENTE);
    servidorTiene(AL_ABRIR);

    await lessonApi.get(CURSO, LECCION);

    expect(lessonApi.translations[LECCION].es).toBe(DE_LA_DOCENTE);
    expect(lessonApi.conflicto).toBeNull();
  });

  it('«ver la versión nueva» sí reemplaza: trae lo del servidor, sin cambios pendientes ni choque', async () => {
    teclear(DE_LA_DOCENTE);
    servidorTiene(DEL_ASISTENTE);
    await lessonApi.get(CURSO, LECCION);

    await lessonApi.get(CURSO, LECCION, { descartarLoMio: true });

    expect(lessonApi.translations[LECCION].es).toBe(DEL_ASISTENTE);
    expect(lessonApi.isDirty).toBe(false);
    expect(lessonApi.conflicto).toBeNull();
  });
});
