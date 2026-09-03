import { AppError, ErrorCodes } from '@api/utils/errors';
import type { TNewQuiz, TQuiz } from '@db/types';
import {
  createQuiz,
  deleteQuiz,
  getQuizById,
  getQuizzesByOrganizationId,
  updateQuiz
} from '@cio/db/queries/organization/quiz';

/**
 * Gets all quizzes for an organization
 * @param orgId - The organization ID
 * @returns Array of quizzes
 */
export async function listQuizzes(orgId: string): Promise<TQuiz[]> {
  try {
    const quizzes = await getQuizzesByOrganizationId(orgId);
    return quizzes;
  } catch (error) {
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to fetch quizzes',
      ErrorCodes.QUIZ_FETCH_FAILED,
      500
    );
  }
}

/**
 * Gets a single quiz by ID, scoped to its organization
 * @param quizId - The quiz ID
 * @param orgId - The organization the quiz must belong to
 * @returns Quiz or null if not found
 */
export async function getQuiz(quizId: string, orgId: string): Promise<TQuiz | null> {
  try {
    const quiz = await getQuizById(quizId, orgId);
    return quiz;
  } catch (error) {
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to fetch quiz',
      ErrorCodes.QUIZ_FETCH_FAILED,
      500
    );
  }
}

/**
 * Creates a new quiz
 * @param orgId - The organization ID
 * @param data - Quiz creation data
 * @returns Created quiz
 */
export async function createQuizService(orgId: string, data: Omit<TNewQuiz, 'organizationId'>): Promise<TQuiz> {
  try {
    const quiz = await createQuiz({
      ...data,
      organizationId: orgId
    });
    return quiz;
  } catch (error) {
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to create quiz',
      ErrorCodes.QUIZ_CREATE_FAILED,
      500
    );
  }
}

/**
 * Updates a quiz
 * @param quizId - The quiz ID
 * @param orgId - The organization the quiz must belong to
 * @param data - Quiz update data
 * @returns Updated quiz
 */
export async function updateQuizService(quizId: string, orgId: string, data: Partial<TNewQuiz>): Promise<TQuiz> {
  try {
    const quiz = await getQuizById(quizId, orgId);
    if (!quiz) {
      throw new AppError('Quiz not found', ErrorCodes.QUIZ_NOT_FOUND, 404);
    }

    const updatedQuiz = await updateQuiz(quizId, orgId, data);
    return updatedQuiz;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to update quiz',
      ErrorCodes.QUIZ_UPDATE_FAILED,
      500
    );
  }
}

/**
 * Deletes a quiz
 * @param quizId - The quiz ID
 * @param orgId - The organization the quiz must belong to
 */
export async function deleteQuizService(quizId: string, orgId: string): Promise<void> {
  try {
    const quiz = await getQuizById(quizId, orgId);
    if (!quiz) {
      throw new AppError('Quiz not found', ErrorCodes.QUIZ_NOT_FOUND, 404);
    }

    await deleteQuiz(quizId, orgId);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to delete quiz',
      ErrorCodes.QUIZ_DELETE_FAILED,
      500
    );
  }
}
