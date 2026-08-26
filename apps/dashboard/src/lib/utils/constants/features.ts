/**
 * Funciones aparcadas.
 *
 * Una constante y no una variable de entorno: apagar esto es una decisión del
 * código, no de configuración. Así el interruptor viaja con el repositorio,
 * vale igual en todas las instalaciones y nadie tiene que acordarse de poner
 * nada en el servidor para que la pantalla siga oculta.
 *
 * Mismo patrón que `CANVAS_EDITOR_ENABLED` en `@cio/certificates`.
 */

/**
 * Los widgets embebibles (bloques de cursos para sitios externos).
 *
 * Apagado: es una función que no se va a trabajar por un buen tiempo, y una
 * pantalla vacía que nadie mantiene enseña algo que no existe. El código queda
 * entero —API, editor, embebido— para que volver a encenderlo sea esta línea.
 *
 * Apaga la entrada del menú, el buscador y las dos pantallas. **No** apaga la
 * API: los widgets ya publicados en sitios externos seguirían funcionando.
 */
export const WIDGETS_ENABLED = false;
