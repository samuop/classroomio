import * as schema from '@db/schema';

import type { TNewQuiz, TQuiz } from '@db/types';

import { db } from '@db/drizzle';
import { and, eq } from 'drizzle-orm';

export async function getQuizzesByOrganizationId(orgId: string): Promise<TQuiz[]> {
  const quizzes = await db
    .select()
    .from(schema.quiz)
    .where(eq(schema.quiz.organizationId, orgId))
    .orderBy(schema.quiz.updatedAt);

  return quizzes;
}

/**
 * Un cuestionario, acotado a su empresa.
 *
 * `orgId` no es opcional a propósito: buscar sólo por id convertía el id del
 * cuestionario en una llave que abría el de cualquier empresa. Que el filtro
 * viva acá y no en quien llama es lo que hace que no se pueda olvidar.
 */
export async function getQuizById(quizId: string, orgId: string): Promise<TQuiz | null> {
  const [quiz] = await db
    .select()
    .from(schema.quiz)
    .where(and(eq(schema.quiz.id, quizId), eq(schema.quiz.organizationId, orgId)))
    .limit(1);

  return quiz || null;
}

export async function createQuiz(data: TNewQuiz): Promise<TQuiz> {
  const [quiz] = await db.insert(schema.quiz).values(data).returning();

  return quiz;
}

export async function updateQuiz(quizId: string, orgId: string, data: Partial<TNewQuiz>): Promise<TQuiz> {
  const [quiz] = await db
    .update(schema.quiz)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(and(eq(schema.quiz.id, quizId), eq(schema.quiz.organizationId, orgId)))
    .returning();

  return quiz;
}

export async function deleteQuiz(quizId: string, orgId: string): Promise<void> {
  await db.delete(schema.quiz).where(and(eq(schema.quiz.id, quizId), eq(schema.quiz.organizationId, orgId)));
}
