/**
 * Los tres estados en los que puede estar la pantalla de un curso.
 *
 * Existe como tipo, y no como un par de booleanos sueltos en el layout, por el
 * bug que vino a arreglar: `error` NO existía. "Todavía no llegó el curso" y
 * "no se va a poder traer" caían los dos en `loading`, así que un curso borrado
 * (la API responde 404, con razón) dejaba el spinner girando para siempre.
 *
 * Y lo peor no era el spinner: mientras los dos casos fueran el mismo estado,
 * ningún test podía notarlo. Un test que renderizara la pantalla con el pedido
 * fallando veía un spinner — que es la salida correcta mientras carga — y
 * pasaba. El bug era intesteable por construcción. Nombrar el tercer estado es
 * lo que lo vuelve afirmable.
 */
export type CourseScreenState = 'loading' | 'error' | 'ready';

export interface CourseScreenStateInput {
  /** El curso que pidió la ruta. */
  requestedCourseId: string | undefined;
  /** El curso que el store tiene cargado, si tiene alguno. */
  loadedCourseId: string | undefined;
  /** El grupo viene junto con el curso; sin él la pantalla no puede dibujarse. */
  hasGroup: boolean;
  /** El último intento de traer el curso terminó sin curso. */
  loadFailed: boolean;
}

export function getCourseScreenState({
  requestedCourseId,
  loadedCourseId,
  hasGroup,
  loadFailed
}: CourseScreenStateInput): CourseScreenState {
  const isReady = !!requestedCourseId && loadedCourseId === requestedCourseId && hasGroup;

  // `ready` le gana a `loadFailed` a propósito: si el curso ya está en pantalla
  // y falla un refresco posterior, mejor dejar lo que la persona está leyendo
  // que vaciarle la pantalla por un error que no le impide seguir.
  if (isReady) return 'ready';

  return loadFailed ? 'error' : 'loading';
}
