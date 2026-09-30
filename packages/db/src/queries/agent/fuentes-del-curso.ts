import { and, desc, eq, inArray } from 'drizzle-orm';
import * as schema from '@db/schema';
import { db } from '@db/drizzle';
import type { ChatDocumentRecord } from './chat-document';

/**
 * La fuente del curso que salió de alguna de estas direcciones, si hay una.
 *
 * Existe para que volver a agregar una página no la duplique: antes la única
 * comparación era por el texto, así que una página que había cambiado entraba
 * como una SEGUNDA fuente, y un muro de inicio de sesión que se volvía a leer
 * igual devolvía la misma fuente vieja como si nada. Se reciben varias formas
 * de la dirección porque la ruta de Fuentes la guarda como la pegó la docente
 * y la investigación la guarda normalizada.
 *
 * Si hay más de una (duplicados de antes de esto), devuelve la más nueva: es la
 * última lectura, la misma que elige `findChatDocumentByContentHash`.
 */
export async function buscarFuentePorDireccion(
  courseId: string,
  direcciones: string[]
): Promise<ChatDocumentRecord | null> {
  const candidatas = [...new Set(direcciones.filter(Boolean))];

  if (candidatas.length === 0) return null;

  try {
    const [row] = await db
      .select()
      .from(schema.aiChatDocument)
      .where(
        and(eq(schema.aiChatDocument.courseId, courseId), inArray(schema.aiChatDocument.sourceUrl, candidatas))
      )
      .orderBy(desc(schema.aiChatDocument.createdAt))
      .limit(1);

    return row ?? null;
  } catch (error) {
    console.error('buscarFuentePorDireccion error:', error);
    throw new Error('Failed to find course source by URL');
  }
}

/**
 * Pone una lectura nueva de una página en la fuente que ya existía.
 *
 * El par web de `actualizarLecturaDeFuente`: se conservan `id`, `sourceUrl`,
 * `conversationId` y `createdAt` —las lecciones que la citan, su lugar en el
 * panel y su enlace siguen valiendo— y cambia lo que se leyó. El nombre cambia
 * también, porque sale del título de la página: una fuente guardada como
 * «Sign-in» que ahora se leyó bien no puede seguir llamándose así.
 */
export async function reemplazarFuenteWeb(
  documentId: string,
  lectura: { text: string; fileName: string; wordCount: number; contentHash: string }
): Promise<void> {
  try {
    await db
      .update(schema.aiChatDocument)
      .set({ ...lectura, pageCount: null })
      .where(eq(schema.aiChatDocument.id, documentId));
  } catch (error) {
    console.error('reemplazarFuenteWeb error:', error);
    throw new Error('Failed to replace web source text');
  }
}

/**
 * De qué curso es una fuente y quién la subió, sin traer el texto.
 *
 * Para cobrar un resumen que se pidió sin decir a quién: el paquete de fuentes
 * y el contexto de documentos lo piden sin conocer al usuario, y la llamada al
 * proveedor se paga igual. `null` para un borrador, que todavía no tiene fila.
 */
export async function duenoDeFuente(documentId: string): Promise<{ courseId: string; userId: string } | null> {
  try {
    const [row] = await db
      .select({ courseId: schema.aiChatDocument.courseId, userId: schema.aiChatDocument.userId })
      .from(schema.aiChatDocument)
      .where(eq(schema.aiChatDocument.id, documentId))
      .limit(1);

    return row ?? null;
  } catch (error) {
    console.error('duenoDeFuente error:', error);
    throw new Error('Failed to fetch course source owner');
  }
}
