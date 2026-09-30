/**
 * Una fuente no se borra nunca sin que la docente lo pida — contra un Postgres real.
 *
 * ── Qué se rompió ────────────────────────────────────────────────────────────
 *
 * `createChatDocument` tenía un tope de 40 documentos por conversación que, al
 * pasarse, BORRABA los más viejos en silencio. Desde que todas las fuentes del
 * panel de un curso van a una sola conversación oculta, dos investigaciones
 * profundas y una subida ya se llevaban el PDF propio de la docente, el primero
 * que había subido.
 *
 * ── Qué fija este test ───────────────────────────────────────────────────────
 *
 * 1. Pasar las 40 no borra nada.
 * 2. El tope es por CURSO y rechaza la fuente nueva (`TopeDeFuentesError`), sin
 *    tocar las que ya estaban.
 * 3. Dos altas a la vez con un solo lugar no dejan el curso pasado del tope.
 *
 * Se corren aparte, con `pnpm --filter @cio/api test:db`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { aiChatConversation, aiChatDocument, course, db, eq, group, organization, profile, user } from '@cio/db/drizzle';
import {
  contarFuentesDelCurso,
  createChatDocument,
  esTopeDeFuentes,
  MAX_SOURCES_PER_COURSE
} from '@cio/db/queries/agent';

const RUN = randomUUID().slice(0, 8);

const DOCENTE = randomUUID();
const EMPRESA = randomUUID();
const GRUPO = randomUUID();
const CURSO = randomUUID();
const CONVERSACION = randomUUID();

/** La primera fuente del curso: la que la poda vieja se llevaba primero. */
const PRIMERA = `int-tope-${RUN}-000`;

const fuente = (indice: number) => ({
  id: `int-tope-${RUN}-${String(indice).padStart(3, '0')}`,
  conversationId: CONVERSACION,
  courseId: CURSO,
  userId: DOCENTE,
  assetId: null,
  fileName: `Fuente ${indice}.pdf`,
  mimeType: 'application/pdf',
  text: `Texto de la fuente ${indice}.`,
  contentHash: `hash-${RUN}-${indice}`,
  wordCount: 5,
  pageCount: 1
});

async function limpiar() {
  await db.delete(aiChatDocument).where(eq(aiChatDocument.courseId, CURSO));
  await db.delete(aiChatConversation).where(eq(aiChatConversation.id, CONVERSACION));
  await db.delete(course).where(eq(course.id, CURSO));
  await db.delete(group).where(eq(group.id, GRUPO));
  await db.delete(organization).where(eq(organization.id, EMPRESA));
  await db.delete(profile).where(eq(profile.id, DOCENTE));
  await db.delete(user).where(eq(user.id, DOCENTE));
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

  await db.insert(user).values({ id: DOCENTE, name: 'Docente', email: `docente-${RUN}@test.local` });
  await db.insert(profile).values({
    id: DOCENTE,
    fullname: 'Docente',
    username: `int-tope-${RUN}`,
    email: `pf-${RUN}@test.local`
  });
  await db.insert(organization).values({ id: EMPRESA, name: `Empresa ${RUN}`, siteName: `int-tope-${RUN}` });
  await db.insert(group).values({ id: GRUPO, name: `grupo-${RUN}`, organizationId: EMPRESA });
  await db.insert(course).values({ id: CURSO, title: `curso-${RUN}`, description: '', groupId: GRUPO });
  await db
    .insert(aiChatConversation)
    .values({ id: CONVERSACION, courseId: CURSO, userId: DOCENTE, title: 'Fuentes del curso' });
});

afterAll(async () => {
  await limpiar();
});

describe('el tope de fuentes del curso', () => {
  it('es de 100, y no uno que una investigación profunda con subidas llene', () => {
    expect(MAX_SOURCES_PER_COURSE).toBe(100);
  });

  it('pasar las 40 de una conversación no borra ninguna, tampoco la primera', async () => {
    for (let indice = 0; indice < 45; indice += 1) {
      await createChatDocument(fuente(indice));
    }

    expect(await contarFuentesDelCurso(CURSO)).toBe(45);

    const [primera] = await db.select({ id: aiChatDocument.id }).from(aiChatDocument).where(eq(aiChatDocument.id, PRIMERA));
    expect(primera?.id).toBe(PRIMERA);
  });

  it('llegado el tope rechaza la nueva y deja las que estaban', async () => {
    // Hasta 100, de una: el camino que importa es el del alta.
    await db.insert(aiChatDocument).values(Array.from({ length: 55 }, (_, i) => fuente(45 + i)));
    expect(await contarFuentesDelCurso(CURSO)).toBe(100);

    let rechazo: unknown;

    try {
      await createChatDocument(fuente(100));
    } catch (error) {
      rechazo = error;
    }

    expect(esTopeDeFuentes(rechazo)).toBe(true);
    expect(await contarFuentesDelCurso(CURSO)).toBe(100);

    const [primera] = await db.select({ id: aiChatDocument.id }).from(aiChatDocument).where(eq(aiChatDocument.id, PRIMERA));
    expect(primera?.id).toBe(PRIMERA);
  });

  it('tres altas a la vez con dos lugares: entran dos, y el curso no pasa de 100', async () => {
    await db.delete(aiChatDocument).where(eq(aiChatDocument.id, fuente(98).id));
    await db.delete(aiChatDocument).where(eq(aiChatDocument.id, fuente(99).id));
    expect(await contarFuentesDelCurso(CURSO)).toBe(98);

    const resultados = await Promise.allSettled([
      createChatDocument(fuente(200)),
      createChatDocument(fuente(201)),
      createChatDocument(fuente(202))
    ]);

    expect(resultados.filter((resultado) => resultado.status === 'fulfilled')).toHaveLength(2);

    const rechazadas = resultados.filter((resultado): resultado is PromiseRejectedResult => resultado.status === 'rejected');
    expect(rechazadas).toHaveLength(1);
    expect(esTopeDeFuentes(rechazadas[0].reason)).toBe(true);

    expect(await contarFuentesDelCurso(CURSO)).toBe(100);
  });
});
