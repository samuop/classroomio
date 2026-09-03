import { ZQuizCreate, ZQuizGetParam, ZQuizListParam, ZQuizUpdate } from '@cio/utils/validation/organization';
import { createQuizService, deleteQuizService, getQuiz, listQuizzes, updateQuizService } from '@api/services/quiz';

import { Hono } from '@api/utils/hono';
import { assertOrgAccess } from '@api/utils/org-scope';
import { authMiddleware } from '@api/middlewares/auth';
import { handleError } from '@api/utils/errors';
import { orgMemberMiddleware } from '@api/middlewares/org-member';
import { zValidator } from '@hono/zod-validator';

/**
 * Cuestionarios de una empresa.
 *
 * Este router se monta como `/organization/:orgId/quiz`, o sea que la empresa
 * viene en la URL — pero `orgMemberMiddleware` sólo mira la cabecera
 * `cio-org-id`. Nada ataba las dos: alcanzaba con poner la empresa propia en la
 * cabecera y la ajena en la URL. Verificado contra un servidor real: el admin
 * de una empresa hija creó, listó, editó y borró cuestionarios de la empresa
 * madre.
 *
 * Por eso cada ruta llama a `assertOrgAccess` con el id de la URL, y las que
 * trabajan sobre un cuestionario suelto lo buscan acotado a esa empresa: sin
 * eso, el id del cuestionario seguiría siendo una puerta lateral.
 */
export const quizRouter = new Hono()
  /**
   * GET /organization/:orgId/quiz
   * Gets all quizzes for an organization
   * Requires authentication and organization membership
   */
  .get('/', authMiddleware, orgMemberMiddleware, zValidator('param', ZQuizListParam), async (c) => {
    try {
      const { orgId } = c.req.valid('param');
      assertOrgAccess(c, orgId);

      const quizzes = await listQuizzes(orgId);

      return c.json(
        {
          success: true,
          data: quizzes
        },
        200
      );
    } catch (error) {
      return handleError(c, error, 'Failed to fetch quizzes');
    }
  })
  /**
   * GET /organization/:orgId/quiz/:quizId
   * Gets a single quiz by ID
   * Requires authentication and organization membership
   */
  .get('/:quizId', authMiddleware, orgMemberMiddleware, zValidator('param', ZQuizGetParam), async (c) => {
    try {
      const { orgId, quizId } = c.req.valid('param');
      assertOrgAccess(c, orgId);

      const quiz = await getQuiz(quizId, orgId);

      if (!quiz) {
        return c.json(
          {
            success: false,
            error: 'Quiz not found'
          },
          404
        );
      }

      return c.json(
        {
          success: true,
          data: quiz
        },
        200
      );
    } catch (error) {
      return handleError(c, error, 'Failed to fetch quiz');
    }
  })
  /**
   * POST /organization/:orgId/quiz
   * Creates a new quiz
   * Requires authentication and organization membership
   */
  .post(
    '/',
    authMiddleware,
    orgMemberMiddleware,
    zValidator('param', ZQuizListParam),
    zValidator('json', ZQuizCreate),
    async (c) => {
      try {
        const { orgId } = c.req.valid('param');
        assertOrgAccess(c, orgId);

        const data = c.req.valid('json');

        const quiz = await createQuizService(orgId, data);

        return c.json(
          {
            success: true,
            data: quiz
          },
          201
        );
      } catch (error) {
        return handleError(c, error, 'Failed to create quiz');
      }
    }
  )
  /**
   * PUT /organization/:orgId/quiz/:quizId
   * Updates a quiz
   * Requires authentication and organization membership
   */
  .put(
    '/:quizId',
    authMiddleware,
    orgMemberMiddleware,
    zValidator('param', ZQuizGetParam),
    zValidator('json', ZQuizUpdate),
    async (c) => {
      try {
        const { orgId, quizId } = c.req.valid('param');
        assertOrgAccess(c, orgId);

        const data = c.req.valid('json');

        const quiz = await updateQuizService(quizId, orgId, data);

        return c.json(
          {
            success: true,
            data: quiz
          },
          200
        );
      } catch (error) {
        return handleError(c, error, 'Failed to update quiz');
      }
    }
  )
  /**
   * DELETE /organization/:orgId/quiz/:quizId
   * Deletes a quiz
   * Requires authentication and organization membership
   */
  .delete('/:quizId', authMiddleware, orgMemberMiddleware, zValidator('param', ZQuizGetParam), async (c) => {
    try {
      const { orgId, quizId } = c.req.valid('param');
      assertOrgAccess(c, orgId);

      await deleteQuizService(quizId, orgId);

      return c.json(
        {
          success: true
        },
        200
      );
    } catch (error) {
      return handleError(c, error, 'Failed to delete quiz');
    }
  });
