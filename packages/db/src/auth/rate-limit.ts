/**
 * Cuántos registros e ingresos acepta la autenticación por IP.
 *
 * El valor de fábrica de Better Auth es 3 cada 10 segundos para todo lo que
 * empieza con `/sign-in` o `/sign-up`. Con una sala de capacitación conectada al
 * mismo wifi —una IP para todos— el cuarto alumno que se registra recibe un 429,
 * y como el contador recién vuelve a cero después de 10 segundos SIN ningún
 * pedido, en una sala donde todos lo intentan a la vez casi nadie entra.
 *
 * - Registro: 60 por minuto. El registro es sólo por invitación (sin una
 *   invitación vigente para ese correo se rechaza antes de crear nada), así que
 *   un límite alto no abre la puerta a altas masivas.
 * - Ingreso: 50 por minuto. Alcanza para una sala que entra junta, con algún
 *   error de tipeo, y sigue frenando a quien prueba contraseñas desde una IP.
 *
 * El resto (cambio de contraseña, recuperación, verificación) queda con los
 * valores de fábrica: no son cosas que una sala haga a la vez.
 */
export const AUTH_RATE_LIMIT = {
  customRules: {
    '/sign-up/email': { window: 60, max: 60 },
    '/sign-in/email': { window: 60, max: 50 }
  }
};
