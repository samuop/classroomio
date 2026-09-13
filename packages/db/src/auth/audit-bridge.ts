/**
 * Por dónde el ingreso le avisa a la auditoría.
 *
 * Better Auth vive en este paquete y la auditoría en la API, que depende de este
 * paquete y no al revés. Importar la auditoría desde acá armaría un ciclo, así
 * que el ingreso sólo AVISA y la API, al arrancar, se anota para escuchar. Sin
 * nadie escuchando (un script, un test) el aviso no hace nada.
 *
 * Por qué hace falta: `/api/auth/*` está excluido del middleware de auditoría, y
 * con razón (el sondeo de sesión llenaría la tabla). El costo era que un ingreso
 * no dejaba NINGÚN rastro con IP ni navegador: la tabla `session` se purga al
 * cerrar sesión y `analytics_login_events` guarda un día por persona, sin IP. No
 * había forma de responder «¿entró alguien más con esta cuenta?».
 *
 * El aviso lleva el cuerpo del pedido tal cual, contraseña incluida: nunca sale
 * del proceso. Quien escucha elige campo por campo qué guardar, igual que el mapa
 * de auditoría de la API.
 */

export type AvisoDeIngreso =
  | {
      tipo: 'sesion-creada';
      /** Ruta de Better Auth que creó la sesión (`/sign-in/email`, `/callback/:id`…). */
      ruta: string | null;
      metodo: string | null;
      headers: Headers | null;
      sesion: { id: string; userId: string; impersonatedBy?: string | null };
    }
  | {
      tipo: 'sesion-borrada';
      ruta: string | null;
      metodo: string | null;
      headers: Headers | null;
      sesion: { id: string; userId: string };
    }
  | {
      tipo: 'endpoint';
      ruta: string;
      metodo: string | null;
      headers: Headers | null;
      /** El cuerpo del pedido, sin filtrar. Nunca se guarda entero. */
      cuerpo: unknown;
      /** `null` si salió bien; si no, el error que devolvió Better Auth. */
      error: { status: number; codigo: string | null; mensaje: string | null } | null;
      /** Quien tenía sesión al pedirlo, si la tenía. */
      usuario: { id: string; email: string | null } | null;
      sesionId: string | null;
    };

type Oyente = (aviso: AvisoDeIngreso) => Promise<void> | void;

let oyente: Oyente | null = null;

/** La API se anota una vez al arrancar. Anotarse de nuevo reemplaza al anterior. */
export function escucharIngresos(nuevo: Oyente | null): void {
  oyente = nuevo;
}

/**
 * Avisa sin esperar y sin tirar nunca: la auditoría no puede demorar ni tumbar un
 * ingreso. Perder el renglón es preferible a perder el login.
 */
export function avisarIngreso(aviso: AvisoDeIngreso): void {
  if (!oyente) return;

  try {
    void Promise.resolve(oyente(aviso)).catch((error) => {
      console.error('[auth-audit] no se pudo registrar el aviso', aviso.tipo, error);
    });
  } catch (error) {
    console.error('[auth-audit] no se pudo registrar el aviso', aviso.tipo, error);
  }
}

/** Better Auth devuelve el status como texto (`UNAUTHORIZED`) y a veces como número. */
const STATUS_POR_NOMBRE: Record<string, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500
};

/**
 * Lo que devolvió un endpoint, reducido a «salió bien» o al error.
 *
 * Medido con better-auth 1.6.11: en el hook `after`, un ingreso con clave mala
 * deja en `ctx.context.returned` un APIError con `status: 'UNAUTHORIZED'` y
 * `body.code: 'INVALID_EMAIL_OR_PASSWORD'`; uno bueno deja el objeto de respuesta.
 */
export function errorDeLoDevuelto(devuelto: unknown): {
  status: number;
  codigo: string | null;
  mensaje: string | null;
} | null {
  if (!(devuelto instanceof Error)) return null;

  const conDatos = devuelto as Error & {
    status?: unknown;
    statusCode?: unknown;
    body?: { code?: unknown; message?: unknown };
  };

  const status =
    typeof conDatos.statusCode === 'number'
      ? conDatos.statusCode
      : typeof conDatos.status === 'number'
        ? conDatos.status
        : (STATUS_POR_NOMBRE[String(conDatos.status)] ?? 500);

  return {
    status,
    codigo: typeof conDatos.body?.code === 'string' ? conDatos.body.code : null,
    mensaje:
      typeof conDatos.body?.message === 'string' ? conDatos.body.message : conDatos.message || null
  };
}
