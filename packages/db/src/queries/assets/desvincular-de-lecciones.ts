import * as schema from '@db/schema';

import { and, db, eq, inArray } from '@db/drizzle';
import { quitarMarcadoresDeMedio, separarPorAsset } from '@cio/utils/functions/lesson-media-id';

/**
 * Saca un medio de todas las lecciones donde este puesto.
 *
 * Borrar el archivo y nada mas dejaba la leccion ROTA: la entrada seguia en
 * `videos[]`/`documents[]` con un enlace que ya no resuelve, y si la nota tenia
 * un marcador apuntandole, la vista de lectura dibujaba un cartel de "este medio
 * ya no esta". Quien borra un video no pide un cartel: pide que la leccion quede
 * como si nunca lo hubiera subido.
 *
 * Por eso se limpian los TRES lugares donde vive la referencia:
 *
 * 1. `lesson.videos` / `lesson.documents` — la entrada con ese `assetId`.
 * 2. `lesson_language.content` — el marcador que apunta al placement borrado,
 *    en TODOS los idiomas de esa leccion. La nota no vive en `lesson.note`
 *    (esa columna esta vacia en toda la base), vive aca.
 * 3. `asset_usages` — lo hace sola la clave foranea al borrar el asset.
 *
 * Todo en una transaccion: una leccion sin su entrada pero con el marcador vivo
 * es justo el estado roto que esto viene a evitar.
 */
export async function desvincularAssetDeLecciones(orgId: string, assetId: string): Promise<{ lecciones: number }> {
  try {
    return await db.transaction(async (tx) => {
      const usos = await tx
        .select({ targetId: schema.assetUsage.targetId })
        .from(schema.assetUsage)
        .where(
          and(
            eq(schema.assetUsage.assetId, assetId),
            eq(schema.assetUsage.organizationId, orgId),
            eq(schema.assetUsage.targetType, 'lesson')
          )
        );

      const idsDeLeccion = [...new Set(usos.map((uso) => uso.targetId))];
      if (idsDeLeccion.length === 0) {
        return { lecciones: 0 };
      }

      const lecciones = await tx
        .select({
          id: schema.lesson.id,
          videos: schema.lesson.videos,
          documents: schema.lesson.documents
        })
        .from(schema.lesson)
        .where(inArray(schema.lesson.id, idsDeLeccion));

      let tocadas = 0;

      for (const leccion of lecciones) {
        const video = separarPorAsset(leccion.videos as { id?: string; assetId?: string | null }[], assetId);
        const documento = separarPorAsset(leccion.documents as { id?: string; assetId?: string | null }[], assetId);
        const placementsQuitados = new Set([...video.idsQuitados, ...documento.idsQuitados]);

        const hayCambios =
          video.quedan.length !== (leccion.videos?.length ?? 0) ||
          documento.quedan.length !== (leccion.documents?.length ?? 0);

        if (!hayCambios) continue;

        await tx
          .update(schema.lesson)
          .set({
            videos: video.quedan as typeof schema.lesson.$inferInsert.videos,
            documents: documento.quedan as typeof schema.lesson.$inferInsert.documents,
            updatedAt: new Date().toISOString()
          })
          .where(eq(schema.lesson.id, leccion.id));

        tocadas += 1;

        if (placementsQuitados.size === 0) continue;

        // Las entradas viejas no tienen placement id, y sin id no hay marcador
        // que pueda apuntarles: por eso esto se saltea en vez de tocar la nota
        // a ciegas.
        const notas = await tx
          .select({ id: schema.lessonLanguage.id, content: schema.lessonLanguage.content })
          .from(schema.lessonLanguage)
          .where(eq(schema.lessonLanguage.lessonId, leccion.id));

        for (const nota of notas) {
          const limpio = quitarMarcadoresDeMedio(nota.content ?? '', placementsQuitados);
          if (limpio === (nota.content ?? '')) continue;

          await tx.update(schema.lessonLanguage).set({ content: limpio }).where(eq(schema.lessonLanguage.id, nota.id));
        }
      }

      return { lecciones: tocadas };
    });
  } catch (error) {
    console.error('desvincularAssetDeLecciones error:', error);
    throw new Error(
      `Failed to detach asset from lessons: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
