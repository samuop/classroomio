import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { orgMemberMiddleware } from '@api/middlewares/org-member';
import { zValidator } from '@hono/zod-validator';
import { ZAgentStatusQuery } from '@cio/utils/validation/agent';
import { handleError, AppError } from '@api/utils/errors';
import { isCourseTeamMemberOrOrgAdmin } from '@cio/db/queries/group';
import { uploadImage } from '@api/services/media';
import { MAX_IMAGE_SIZE } from '@api/constants/upload';
import { esTipoDeImagenDelChat, TIPOS_DE_IMAGEN_DEL_CHAT } from '@api/services/agent/chat-images';

/**
 * Imágenes que el docente adjunta a un mensaje del chat.
 *
 * Se suben ANTES de mandar el mensaje y el mensaje lleva sólo la dirección: el
 * historial se guarda como JSON en la conversación, y una imagen incrustada lo
 * inflaría con megas en cada guardado.
 *
 * Los formatos se validan acá y no al llegar al modelo: un GIF o un SVG se
 * guardarían bien y el modelo no los vería, sin ningún error que lo diga.
 */
export const agentAttachmentsRouter = new Hono().post(
  '/image',
  authMiddleware,
  orgMemberMiddleware,
  zValidator('query', ZAgentStatusQuery),
  async (c) => {
    try {
      const user = c.get('user')!;
      const { courseId } = c.req.valid('query');

      if (!(await isCourseTeamMemberOrOrgAdmin(courseId, user.id))) {
        throw new AppError('Only the course team can attach images', 'COURSE_FORBIDDEN', 403);
      }

      const body = await c.req.parseBody();
      const file = body.file;

      if (!(file instanceof File)) {
        throw new AppError('No file provided', 'VALIDATION_ERROR', 400);
      }

      if (!esTipoDeImagenDelChat(file.type)) {
        return c.json(
          { success: false, error: 'unsupported_image_type', allowed: [...TIPOS_DE_IMAGEN_DEL_CHAT] },
          415
        );
      }

      if (file.size > MAX_IMAGE_SIZE) {
        return c.json({ success: false, error: 'image_too_large', maxSize: MAX_IMAGE_SIZE }, 413);
      }

      const { url } = await uploadImage(file);

      return c.json({ success: true, data: { url, mediaType: file.type, filename: file.name } });
    } catch (error) {
      return handleError(c, error, 'Failed to attach image');
    }
  }
);
