import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Context } from 'hono';

import { ErrorCodes, type ErrorCode } from '@cio/utils/constants';

export { ErrorCodes, type ErrorCode };

/**
 * Standard application error with code for easy identification
 */
export class AppError extends Error {
  /**
   * @param details datos para que el cliente arme su propio mensaje (por ejemplo,
   *   los correos rechazados de una importación). Sólo viaja en un 4xx: un 5xx
   *   responde el mensaje genérico y nada del error interno.
   */
  constructor(
    error: string | Error,
    public code: string,
    public statusCode: ContentfulStatusCode = 500,
    public field?: string,
    public details?: Record<string, unknown>
  ) {
    super(error instanceof Error ? error.message : error);
    this.name = 'AppError';
  }
}

/**
 * Standard error response format
 */
export interface ErrorResponse {
  success: false;
  error: string;
  code: string;
  field?: string;
}

/**
 * Handles errors consistently across all routes
 * @param c - Hono context
 * @param error - The error to handle
 * @param fallbackMessage - Default error message if error is not an AppError
 * @param fallbackCode - Default error code if error is not an AppError
 * @returns JSON error response with appropriate status code
 *
 * @example
 * ```typescript
 * try {
 *   const data = await someService();
 *   return c.json({ success: true, data });
 * } catch (error) {
 *   return handleError(c, error, 'Failed to process request');
 * }
 * ```
 */
export const handleError = (
  c: Context,
  error: unknown,
  fallbackMessage: string = 'An unexpected error occurred',
  fallbackCode?: string
) => {
  console.error('Error in route:', error);

  // Deja el detalle a mano para el middleware de auditoría, que corre después de
  // que este handler ya devolvió la respuesta y sólo vería el número de status.
  // El stack se guarda siempre acá; el middleware decide si vale la pena
  // persistirlo (sólo para 5xx: en un 4xx esperable no aporta y ocupa).
  c.set('auditError', {
    message: error instanceof Error ? error.message : String(error),
    code: error instanceof AppError ? error.code : fallbackCode,
    stack: error instanceof Error ? error.stack : undefined
  });

  if (error instanceof AppError) {
    const isServerError = error.statusCode >= 500;
    const responseCode = isServerError ? (fallbackCode ?? error.code) : error.code;
    const responseMessage = isServerError ? fallbackMessage : error.message;

    const body: ErrorResponse = {
      success: false,
      error: responseMessage,
      code: responseCode,
      field: isServerError ? undefined : error.field
    };

    // `details` viaja en el JSON pero NO se declara en `ErrorResponse`, a
    // propósito: ese tipo se repite en la respuesta de cada ruta de la cadena de
    // `app.ts`, que ya está al borde de lo que TypeScript puede serializar, y un
    // campo más tiraba el build de la API (TS7056). Quien lo lee lo trata como
    // dato desconocido.
    return c.json<ErrorResponse>(
      isServerError || !error.details ? body : Object.assign(body, { details: error.details }),
      error.statusCode
    );
  }

  return c.json<ErrorResponse>(
    {
      success: false,
      error: fallbackMessage,
      code: fallbackCode ?? ErrorCodes.INTERNAL_ERROR
    },
    500
  );
};
