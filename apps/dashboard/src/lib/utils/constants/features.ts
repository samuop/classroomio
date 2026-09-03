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

/**
 * La pantalla de Configuración → Autenticación.
 *
 * Apagada: ofrece interruptores que en este despliegue no se pueden sostener.
 *
 * «Deshabilitar el inicio de sesión con correo/contraseña» rige en el dominio
 * propio de la empresa, y ahí la única alternativa que la pantalla ofrece es
 * SSO — cuyas dos solapas se ven pero cuyas rutas rebotan de vuelta
 * (`settings/auth/sso` y `token-auth` redirigen). Encendido ese interruptor, el
 * login del dominio del cliente no muestra ni formulario ni alternativa: sólo
 * un cartel. Una pantalla que puede dejar afuera a la empresa entera no debería
 * estar a un clic, y menos prometiendo una salida que no existe.
 *
 * Apaga la entrada del menú, el buscador (que arma sus páginas desde la misma
 * lista) y las tres rutas. **No** apaga la API ni cambia ningún valor ya
 * guardado: lo que cada empresa tenga configurado hoy sigue rigiendo igual.
 */
export const AUTH_SETTINGS_ENABLED = false;
