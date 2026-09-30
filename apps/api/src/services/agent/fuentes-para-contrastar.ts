import type { FuenteVista } from '@api/services/agent/grounding';

/**
 * Contra qué fuentes se contrastan los datos de una lección recién guardada.
 *
 * ── Lo que se midió (producción, 2026-09-12) ─────────────────────────────────
 *
 * El chequeo determinista —números, nombres y citas que no figuran en ninguna
 * fuente— sólo corría cuando quien guardaba le decía con qué fuentes se había
 * escrito, y eso lo hacía únicamente `write_lesson`. Una lección reescrita desde
 * el chat con `update_lesson_content` se guardaba con `sources: []` y cero
 * avisos. Dos reescrituras de la misma lección metieron «el 30% restante», «el
 * 100% de cobertura» y una «regla de propagación» que no están en ningún
 * material, y el informe se leía como limpio: el chequeo no había corrido.
 *
 * ── Las tres respuestas, y por qué «ninguna» y «no se sabe» son distintas ───
 *
 * - Hay fuentes de la lección → contra esas. Es lo más estricto: el juez con
 *   modelo contrasta sólo contra lo que tuvo delante quien escribió. Los
 *   nombres, números y citas que no aparezcan ahí se buscan después en el
 *   alcance ampliado —el resto del curso, el pedido de la docente, el plan— y
 *   lo que se encuentra va al informe con su rótulo, sin volver al modelo (ver
 *   `tokensDeLaLeccion` en `chat-tools.ts`).
 * - No se sabe con cuáles se escribió (`undefined`) → contra todas las del
 *   curso. Es más blando —un número que aparece en cualquier taller pasa—, pero
 *   caza lo que no está en ninguno, que es la invención medida.
 * - Se declaró que NINGUNA (`[]`) → no se contrasta. Es una lección escrita sin
 *   material asignado, desde el conocimiento general; marcar cada dato contra
 *   material que a propósito no la sostiene sería el aviso que se aprende a
 *   ignorar.
 *
 * Nunca tira: si las fuentes del curso no se pueden leer, la lección igual
 * quedó guardada y el informe dice que no se contrastó.
 */

export type AlcanceDelContraste = 'lesson' | 'course' | 'none';

export async function fuentesParaContrastar(params: {
  /** Las que tuvo delante quien escribió: `undefined` si no se sabe, `[]` si se declaró que ninguna. */
  deLaLeccion?: FuenteVista[];
  /** Carga las fuentes del curso. Sólo se llama si hace falta. */
  cargarDelCurso?: () => Promise<FuenteVista[]>;
}): Promise<{ fuentes: FuenteVista[]; alcance: AlcanceDelContraste }> {
  if (params.deLaLeccion !== undefined) {
    return params.deLaLeccion.length > 0
      ? { fuentes: params.deLaLeccion, alcance: 'lesson' }
      : { fuentes: [], alcance: 'none' };
  }

  if (!params.cargarDelCurso) return { fuentes: [], alcance: 'none' };

  const delCurso = await params.cargarDelCurso().catch((error: unknown) => {
    console.error('[fundamento] no se pudieron leer las fuentes del curso para contrastar:', error);
    return [] as FuenteVista[];
  });

  const conTexto = delCurso.filter((fuente) => fuente.text.trim().length > 0);

  return conTexto.length > 0 ? { fuentes: conTexto, alcance: 'course' } : { fuentes: [], alcance: 'none' };
}
