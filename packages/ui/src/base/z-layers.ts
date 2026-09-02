import { getContext, setContext } from 'svelte';

/**
 * La escalera de capas de la aplicacion.
 *
 * Esto no es una preferencia de estilo: es la unica forma de que un menu no
 * aparezca por debajo de la barra a la que pertenece. El historial de este repo
 * muestra la alternativa — la barra del examen paso por `z-250`, `z-50` y
 * `z-100` en tres commits distintos, y quedaron parches sueltos (`z-201!`,
 * `z-200!`, `z-[250]`) donde a alguien se le tapo algo. Cada numero suelto
 * arregla una pantalla y rompe otra, porque nadie sabe contra que esta compitiendo.
 *
 * Las reglas, de abajo hacia arriba:
 *
 * - `0`-`40` — apilado DENTRO de una pagina: encabezados de tabla pegajosos,
 *   sub-barras de una vista. Nunca sale de su pagina.
 *
 * - `CHROME` (100) — el marco fijo que rodea al contenido: encabezado del curso,
 *   encabezado del programa, la barra lateral de escritorio, el panel lateral,
 *   el visor de documentos a pantalla completa.
 *
 * - `OVERLAY` (150) — lo que se abre anclado a un boton: menu desplegable,
 *   popover, select, tooltip. **Tiene que estar arriba del marco**, porque casi
 *   siempre lo dispara un boton que vive en el marco. Este era el error: bits-ui
 *   los trae en 50, alguien subio los encabezados a 100, y desde entonces cada
 *   menu del encabezado del curso se abria por detras de la barra del examen.
 *
 * - `MODAL` (200) — lo que se apodera de la pantalla y atrapa el foco: dialogo,
 *   sheet (la barra lateral en celular), drawer. Tapa todo lo anterior a proposito.
 *
 * - `OVERLAY_IN_MODAL` (250) — un select o un menu abierto DENTRO de un dialogo.
 *   Es la unica excepcion legitima, y va como override en el lugar de uso.
 *
 * `PROGRESS` (10000) queda arriba de todo: es una linea de 2px que no tapa nada.
 *
 * Si necesitas un numero que no esta aca, el numero no es la solucion.
 */
export const Z_LAYER = {
  CHROME: 100,
  OVERLAY: 150,
  MODAL: 200,
  OVERLAY_IN_MODAL: 250,
  PROGRESS: 10000
} as const;

export type ZLayer = (typeof Z_LAYER)[keyof typeof Z_LAYER];

/**
 * Marcar el subarbol como "esto vive dentro de un modal".
 *
 * Existe porque `OVERLAY_IN_MODAL` no se puede resolver mirando el DOM: un
 * select se PORTALEA al `body`, asi que en el arbol renderizado no es
 * descendiente del dialogo — es su hermano. Preguntarle al DOM "estoy adentro
 * de un modal?" siempre contesta que no.
 *
 * El arbol de COMPONENTES si lo sabe, y es el unico que lo sabe. Por eso el
 * contexto: el dialogo lo declara, y cada overlay anclado lo lee al montarse.
 */
const CLAVE_CAPA_MODAL = Symbol('cio.dentro-de-modal');

/** Lo llaman los contenidos de dialog/sheet/drawer. */
export function marcarDentroDeModal(): void {
  setContext(CLAVE_CAPA_MODAL, true);
}

/**
 * La capa que le toca a un overlay anclado (select, popover, menu, tooltip).
 *
 * Se resuelve una sola vez, al montarse: un overlay no cambia de modal a mitad
 * de camino, y leer contexto fuera de la inicializacion no esta permitido.
 */
export function claseDeCapaDeOverlay(): 'ui:z-150' | 'ui:z-250' {
  return getContext(CLAVE_CAPA_MODAL) === true ? 'ui:z-250' : 'ui:z-150';
}
