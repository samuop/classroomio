/**
 * Las fuentes son del curso, no de quien las subió — contra un Postgres real.
 *
 * ── Qué se rompió ────────────────────────────────────────────────────────────
 *
 * Todo el camino de las fuentes filtraba por `userId`: el índice, el paquete,
 * el escritor de lecciones y el panel. Medido en producción el 2026-09-11: un
 * segundo docente del mismo curso abrió el chat, el índice salió vacío, y el
 * agente escribió una sección entera sobre un organigrama que nunca vio. Nada
 * lo avisó — ni al docente, que también veía el panel vacío.
 *
 * ── Qué fija este test ───────────────────────────────────────────────────────
 *
 * Las dos mitades, porque el bug aparece cuando se separan:
 *   1. LISTAR devuelve lo que subió cualquiera del curso, y
 *   2. LEER esa misma fuente funciona.
 * Listar con un alcance y leer con otro es peor que no listarla: el agente pide
 * un id que acaba de ver y recibe "no existe", que se parece a un id inventado.
 *
 * Y lo que NO tiene que pasar: una fuente de OTRO curso no se lee nunca, ni
 * pidiéndola por id. El curso sigue siendo la frontera.
 *
 * Se corren aparte, con `pnpm --filter @cio/api test:db`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { aiChatConversation, aiChatDocument, course, db, eq, group, inArray, organization, profile, user } from '@cio/db/drizzle';
import { getCourseSource, getChatDocument, listCourseSources } from '@cio/db/queries/agent';
import { leerFuente } from '@api/services/agent/source-index';
import type { RedisClient } from '@api/utils/redis/redis';

/** Marca de esta corrida: la base de desarrollo es compartida. */
const RUN = randomUUID().slice(0, 8);

/** Subió las fuentes. */
const DUENO = randomUUID();
/** Otro docente del mismo curso. El que veía todo vacío. */
const COMPANERO = randomUUID();
const PERSONAS = [DUENO, COMPANERO];

const EMPRESA = randomUUID();
const GRUPO = randomUUID();
const CURSO = randomUUID();
const CURSO_AJENO = randomUUID();
const CONVERSACION = randomUUID();
const CONVERSACION_AJENA = randomUUID();

const FUENTE = `int-fuente-${RUN}`;
const FUENTE_AJENA = `int-ajena-${RUN}`;
const TEXTO = 'DIRECTOR\n  GERENTE GENERAL\n    DEPARTAMENTO COMERCIAL\n';

/**
 * Redis de mentira: siempre falla el acierto y acepta la escritura.
 *
 * No es por comodidad — es para forzar el camino que importa. Con caché, la
 * lectura podría pasar por una entrada escrita en otro momento y el test no
 * tocaría Postgres, que es donde vive la regla que se está probando.
 */
const REDIS_VACIO = {
  get: async () => null,
  set: async () => 'OK'
} as unknown as RedisClient;

async function limpiar() {
  await db.delete(aiChatDocument).where(inArray(aiChatDocument.id, [FUENTE, FUENTE_AJENA]));
  await db.delete(aiChatConversation).where(inArray(aiChatConversation.id, [CONVERSACION, CONVERSACION_AJENA]));
  await db.delete(course).where(inArray(course.id, [CURSO, CURSO_AJENO]));
  await db.delete(group).where(eq(group.id, GRUPO));
  await db.delete(organization).where(eq(organization.id, EMPRESA));
  await db.delete(profile).where(inArray(profile.id, PERSONAS));
  await db.delete(user).where(inArray(user.id, PERSONAS));
}

beforeAll(async () => {
  try {
    await db.select({ id: user.id }).from(user).limit(1);
  } catch (error) {
    throw new Error(
      'No se pudo hablar con Postgres. Levantá la base y sincronizá el schema:\n' +
        '  docker compose -f docker/docker-compose.yaml up -d postgres\n' +
        '  pnpm --filter @cio/db db:setup\n' +
        `Detalle: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  await db.insert(user).values([
    { id: DUENO, name: 'Dueño', email: `dueno-${RUN}@test.local` },
    { id: COMPANERO, name: 'Compañero', email: `companero-${RUN}@test.local` }
  ]);
  await db.insert(profile).values(
    PERSONAS.map((id, i) => ({
      id,
      fullname: `Persona ${i}`,
      username: `int-fuentes-${RUN}-${i}`,
      email: `pf${i}-${RUN}@test.local`
    }))
  );

  await db.insert(organization).values({ id: EMPRESA, name: `Empresa ${RUN}`, siteName: `int-fuentes-${RUN}` });
  await db.insert(group).values({ id: GRUPO, name: `grupo-${RUN}`, organizationId: EMPRESA });
  await db.insert(course).values([
    { id: CURSO, title: `curso-${RUN}`, description: '', groupId: GRUPO },
    { id: CURSO_AJENO, title: `ajeno-${RUN}`, description: '', groupId: GRUPO }
  ]);

  await db.insert(aiChatConversation).values([
    { id: CONVERSACION, courseId: CURSO, userId: DUENO, title: 'Fuentes del curso' },
    { id: CONVERSACION_AJENA, courseId: CURSO_AJENO, userId: DUENO, title: 'Fuentes del curso' }
  ]);

  await db.insert(aiChatDocument).values([
    {
      id: FUENTE,
      conversationId: CONVERSACION,
      courseId: CURSO,
      userId: DUENO,
      fileName: 'Organigrama actual.pdf',
      mimeType: 'application/pdf',
      text: TEXTO,
      wordCount: 6,
      pageCount: 7
    },
    {
      id: FUENTE_AJENA,
      conversationId: CONVERSACION_AJENA,
      courseId: CURSO_AJENO,
      userId: DUENO,
      fileName: 'De otro curso.pdf',
      mimeType: 'application/pdf',
      text: 'nada que ver',
      wordCount: 3,
      pageCount: 1
    }
  ]);
});

afterAll(limpiar);

describe('las fuentes son del curso, no de quien las subió', () => {
  it('las lista aunque las haya subido otro', async () => {
    const fuentes = await listCourseSources(CURSO);

    expect(fuentes.map((f) => f.id)).toContain(FUENTE);
  });

  it('y no mezcla las de otro curso', async () => {
    const fuentes = await listCourseSources(CURSO);

    expect(fuentes.map((f) => f.id)).not.toContain(FUENTE_AJENA);
  });

  it('leer una fuente del compañero devuelve su texto, no null', async () => {
    const doc = await getCourseSource(FUENTE, CURSO);

    expect(doc?.text).toBe(TEXTO);
  });

  it('pedirla desde OTRO curso no la devuelve, ni con el id correcto', async () => {
    expect(await getCourseSource(FUENTE, CURSO_AJENO)).toBeNull();
  });

  /**
   * El que cierra el agujero de verdad: `read_source` pasa por acá, y es donde
   * listar y leer tienen que coincidir. Si alguien vuelve a meter un filtro por
   * dueño en cualquiera de las dos mitades, este test se cae.
   */
  it('read_source lee la fuente del compañero de punta a punta', async () => {
    const lectura = await leerFuente({ documentId: FUENTE, courseId: CURSO, redis: REDIS_VACIO });

    expect(lectura?.fileName).toBe('Organigrama actual.pdf');
    expect(lectura?.content).toContain('GERENTE GENERAL');
  });

  it('y no lee la de otro curso aunque le pasen el id', async () => {
    const lectura = await leerFuente({ documentId: FUENTE_AJENA, courseId: CURSO, redis: REDIS_VACIO });

    expect(lectura).toBeNull();
  });

  /**
   * Borrar sigue siendo del dueño, y es a propósito: leer lo del equipo es
   * colaborar, borrarlo es otra cosa. Si esto se cae, alguien amplió el alcance
   * de más.
   */
  it('la consulta por dueño sigue existiendo y sigue filtrando', async () => {
    expect(await getChatDocument(FUENTE, COMPANERO)).toBeNull();
    expect((await getChatDocument(FUENTE, DUENO))?.id).toBe(FUENTE);
  });
});
