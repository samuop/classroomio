import type { EstadoDelContenido, PreguntaDelCurso } from '@api/services/agent/plan-de-cambios';
import { hashDePreguntas, textoDePreguntas } from '@api/services/agent/plan-de-cambios';

/**
 * El estado del contenido de un curso, armado a mano para un test.
 *
 * Vive acá y no adentro de cada test porque el arnés TIENE que armar el mismo
 * contexto que la app: el ancla lee cinco mapas y confundir uno —por ejemplo
 * poner texto plano donde va el HTML— haría pasar un test contra un ancla que
 * en producción no encontraría un solo bloque.
 *
 * `hashes` se puede fijar a mano para poder escribir «el contenido sigue siendo
 * el de la línea de base» sin tener que calcular un sha1 en el test.
 */
export function estadoDeCursoDePrueba(params: {
  /** HTML guardado de cada lección, por id. */
  lecciones?: Record<string, string>;
  /** Hash de cada lección; por defecto, uno derivado de su contenido. */
  hashes?: Record<string, string>;
  preguntas?: Record<string, PreguntaDelCurso[]>;
}): EstadoDelContenido {
  const textoPorLeccion = new Map(Object.entries(params.lecciones ?? {}));
  const hashPorLeccion = new Map(
    [...textoPorLeccion].map(([id, html]) => [id, params.hashes?.[id] ?? `hash:${html.length}`] as const)
  );

  const preguntasPorEjercicio = new Map(Object.entries(params.preguntas ?? {}));
  const hashPorEjercicio = new Map(
    [...preguntasPorEjercicio].map(([id, preguntas]) => [id, hashDePreguntas(preguntas)] as const)
  );
  const textoPorEjercicio = new Map(
    [...preguntasPorEjercicio].map(([id, preguntas]) => [id, textoDePreguntas(preguntas)] as const)
  );

  return { hashPorLeccion, textoPorLeccion, hashPorEjercicio, textoPorEjercicio, preguntasPorEjercicio };
}
