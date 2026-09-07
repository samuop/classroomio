import { AppError, ErrorCodes } from '@api/utils/errors';

import { generateLessonImage } from '@api/services/agent/image-generation';
import { getCourseOrganizationId } from '@cio/db/queries/tag';
import { getOrgAiImageSettingsService } from '@api/services/organization/ai-images';

/**
 * La portada de un curso, dibujada a pedido.
 *
 * Hasta acá la portada sólo se podía subir, y el resultado era que casi ningún
 * curso tenía una: conseguir una foto que pegue con el tema es trabajo aparte, y
 * la imagen por omisión sirve para todos y no describe a ninguno.
 *
 * Usa el MISMO estilo que las ilustraciones de las lecciones —el que la empresa
 * configuró— y no uno propio. Una portada que no se parece al interior del curso
 * es peor que ninguna: promete otra cosa.
 */
export async function generateCourseCover(params: {
  courseId: string;
  userId: string;
  prompt: string;
}): Promise<{ url: string }> {
  const orgId = await getCourseOrganizationId(params.courseId);

  if (!orgId) {
    throw new AppError('Course not found', ErrorCodes.NOT_FOUND, 404);
  }

  // La empresa se resuelve DESDE el curso y no desde la cabecera: es la empresa
  // que va a pagar la imagen, y tiene que ser la dueña del curso aunque quien
  // pida sea administrador de otra.
  const style = await getOrgAiImageSettingsService(orgId).catch(() => null);

  const image = await generateLessonImage({
    subject: params.prompt,
    courseId: params.courseId,
    // La tarjeta del curso es apaisada; pedirla cuadrada obligaría a recortar
    // justo lo que el prompt pidió que se viera.
    aspectRatio: '16:9',
    styleReferenceUrl: style?.styleReferenceUrl,
    styleNote: style?.styleNote,
    orgId,
    userId: params.userId,
    usageKind: 'cover'
  });

  return { url: image.url };
}
