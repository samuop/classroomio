/**
 * Qué se registra de los ingresos, las sesiones y la cuenta, y con qué nombre.
 *
 * El hermano de `audit-map.ts` para `/api/auth/*`, que el middleware excluye. Los
 * avisos llegan desde Better Auth (ver `@cio/db/auth/audit-bridge`) y acá se
 * decide, sin tocar la base, qué fila sale de cada uno.
 *
 * Tres reglas:
 *
 *   1. **Lista blanca de endpoints.** Better Auth tiene decenas y casi todos son
 *      sondeos. Uno que no esté acá no se registra, ni cuando falla.
 *   2. **Campo por campo.** Del cuerpo sólo sale lo declarado en `campos`. La
 *      contraseña, el token y el código nunca: el cuerpo de un ingreso trae la
 *      clave, y la tabla de auditoría no puede ser el lugar donde quede escrita.
 *   3. **Un intento no es de nadie.** El correo de un ingreso fallido va en
 *      `metadata.email`, no en `user_label`: cualquiera puede escribir el correo
 *      de otra persona, y consultar «qué hizo Ana» no puede devolver lo que un
 *      desconocido intentó con su cuenta.
 */

import type { AvisoDeIngreso } from '@cio/db/auth/audit-bridge';

export interface EndpointDeCuenta {
  /** Ruta de Better Auth, sin `/api/auth`. */
  ruta: string;
  /** Nombre de la acción cuando sale bien. */
  accion: string;
  /** Campos del cuerpo que se pueden guardar. */
  campos?: string[];
  /** Guarda sólo los NOMBRES de los campos enviados (ediciones libres). */
  nombresDeCampos?: boolean;
  /**
   * El éxito ya lo registra el aviso de sesión creada (`INGRESO`, con la IP y la
   * sesión nueva). Registrarlo también acá duplicaría cada ingreso.
   */
  exitoPorSesion?: boolean;
  /** Nombre del fallo, si no es el genérico `<ACCION>_FALLIDO`. */
  siFalla?: string;
}

export const ENDPOINTS_DE_CUENTA: EndpointDeCuenta[] = [
  // ── Ingreso ──
  { ruta: '/sign-in/email', accion: 'INGRESO', campos: ['email'], exitoPorSesion: true, siFalla: 'INGRESO_FALLIDO' },
  { ruta: '/sign-in/social', accion: 'INGRESO', campos: ['provider'], exitoPorSesion: true, siFalla: 'INGRESO_FALLIDO' },
  { ruta: '/sign-in/sso', accion: 'INGRESO', campos: ['email', 'providerId', 'domain'], exitoPorSesion: true, siFalla: 'INGRESO_FALLIDO' },
  { ruta: '/sign-in/anonymous', accion: 'INGRESO', exitoPorSesion: true, siFalla: 'INGRESO_FALLIDO' },
  { ruta: '/login-link', accion: 'INGRESO', exitoPorSesion: true, siFalla: 'INGRESO_FALLIDO' },
  { ruta: '/token-exchange', accion: 'INGRESO', exitoPorSesion: true, siFalla: 'INGRESO_FALLIDO' },
  { ruta: '/sign-up/email', accion: 'SE_REGISTRO', campos: ['email'], siFalla: 'REGISTRO_FALLIDO' },

  // ── Contraseña y correo ──
  { ruta: '/request-password-reset', accion: 'PIDIO_RECUPERAR_CONTRASENA', campos: ['email'] },
  { ruta: '/forget-password', accion: 'PIDIO_RECUPERAR_CONTRASENA', campos: ['email'] },
  { ruta: '/reset-password', accion: 'RESTABLECIO_CONTRASENA' },
  { ruta: '/change-password', accion: 'CAMBIO_SU_CONTRASENA', campos: ['revokeOtherSessions'] },
  { ruta: '/set-password', accion: 'DEFINIO_SU_CONTRASENA' },
  { ruta: '/change-email', accion: 'PIDIO_CAMBIAR_SU_EMAIL', campos: ['newEmail'] },
  { ruta: '/send-verification-email', accion: 'PIDIO_VERIFICAR_EMAIL', campos: ['email'] },
  { ruta: '/verify-email', accion: 'VERIFICO_EMAIL' },

  // ── La cuenta y sus sesiones ──
  { ruta: '/update-user', accion: 'EDITO_SU_USUARIO', nombresDeCampos: true },
  { ruta: '/delete-user', accion: 'PIDIO_BORRAR_SU_CUENTA' },
  { ruta: '/delete-user/callback', accion: 'BORRO_SU_CUENTA' },
  { ruta: '/revoke-session', accion: 'CERRO_UNA_DE_SUS_SESIONES' },
  { ruta: '/revoke-sessions', accion: 'CERRO_TODAS_SUS_SESIONES' },
  { ruta: '/revoke-other-sessions', accion: 'CERRO_SUS_OTRAS_SESIONES' },
  { ruta: '/link-social', accion: 'VINCULO_CUENTA_EXTERNA', campos: ['provider'] },
  { ruta: '/unlink-account', accion: 'DESVINCULO_CUENTA_EXTERNA', campos: ['providerId'] },

  // ── Administración de usuarios (plugin admin) ──
  // Los intentos rechazados valen tanto como los exitosos: un 403 acá es alguien
  // probando si puede bloquear, suplantar o cambiarle la clave a otro.
  { ruta: '/admin/create-user', accion: 'ADMIN_CREO_USUARIO', campos: ['email', 'role'] },
  { ruta: '/admin/update-user', accion: 'ADMIN_EDITO_USUARIO', campos: ['userId'] },
  { ruta: '/admin/set-role', accion: 'ADMIN_CAMBIO_ROL', campos: ['userId', 'role'] },
  { ruta: '/admin/ban-user', accion: 'ADMIN_BLOQUEO_USUARIO', campos: ['userId', 'banReason', 'banExpiresIn'] },
  { ruta: '/admin/unban-user', accion: 'ADMIN_DESBLOQUEO_USUARIO', campos: ['userId'] },
  { ruta: '/admin/impersonate-user', accion: 'ADMIN_SUPLANTO_USUARIO', campos: ['userId'] },
  { ruta: '/admin/stop-impersonating', accion: 'ADMIN_DEJO_DE_SUPLANTAR' },
  { ruta: '/admin/set-user-password', accion: 'ADMIN_CAMBIO_CONTRASENA_DE_USUARIO', campos: ['userId'] },
  { ruta: '/admin/remove-user', accion: 'ADMIN_BORRO_USUARIO', campos: ['userId'] },
  { ruta: '/admin/revoke-user-session', accion: 'ADMIN_CERRO_SESION_DE_USUARIO' },
  { ruta: '/admin/revoke-user-sessions', accion: 'ADMIN_CERRO_SESIONES_DE_USUARIO', campos: ['userId'] },
  { ruta: '/admin/list-users', accion: 'ADMIN_LISTO_USUARIOS' }
];

/** Campos que no salen nunca, aunque alguien los declare por error. */
const CAMPOS_PROHIBIDOS = new Set([
  'password',
  'newPassword',
  'currentPassword',
  'token',
  'idToken',
  'accessToken',
  'refreshToken',
  'code',
  'otp',
  'callbackURL'
]);

const TOPE_DE_TEXTO = 200;

export type RegistroDeCuenta =
  | {
      destino: 'evento';
      action: string;
      metadata: Record<string, unknown> | null;
      userId: string | null;
      /** Email conocido de la sesión; si falta y hay `userId`, se busca. */
      userLabel: string | null;
      sessionId: string | null;
      method: string;
      route: string;
      status: number;
    }
  | {
      destino: 'incidencia';
      kind: 'REQUEST_FAILED' | 'BACKEND_ERROR';
      message: string;
      code: string | null;
      metadata: Record<string, unknown> | null;
      userId: string | null;
      userLabel: string | null;
      sessionId: string | null;
      method: string;
      route: string;
      status: number;
    };

export function endpointDeCuenta(ruta: string): EndpointDeCuenta | null {
  return ENDPOINTS_DE_CUENTA.find((endpoint) => endpoint.ruta === ruta) ?? null;
}

/** Cómo se creó una sesión, en palabras de quien lee la auditoría. */
export function metodoDeIngreso(ruta: string | null): string {
  if (!ruta) return 'interno';
  if (ruta === '/sign-in/email') return 'contraseña';
  if (ruta === '/sign-up/email') return 'registro';
  if (ruta === '/sign-in/social' || ruta.startsWith('/callback/') || ruta === '/oauth-proxy-callback') {
    return 'cuenta externa';
  }
  if (ruta === '/sign-in/sso' || ruta.startsWith('/sso/')) return 'sso';
  if (ruta === '/sign-in/anonymous') return 'anónimo';
  if (ruta === '/login-link') return 'enlace de ingreso';
  if (ruta === '/token-exchange') return 'token de empresa';
  if (ruta === '/admin/impersonate-user') return 'suplantación';
  if (ruta === '/verify-email') return 'verificación de correo';

  return ruta;
}

/** Por qué terminó una sesión. */
export function motivoDeCierre(ruta: string | null): string {
  if (!ruta || ruta === '/get-session') return 'venció';
  if (ruta === '/sign-out') return 'salió';
  if (ruta === '/revoke-session' || ruta === '/revoke-sessions' || ruta === '/revoke-other-sessions') {
    return 'la cerró la persona';
  }
  if (ruta === '/change-password') return 'cambio de contraseña';
  if (ruta === '/reset-password') return 'restableció la contraseña';
  if (ruta.startsWith('/admin/')) return 'la cerró un administrador';

  return ruta;
}

function recortar(valor: unknown): unknown {
  if (typeof valor === 'string') return valor.slice(0, TOPE_DE_TEXTO);
  if (typeof valor === 'number' || typeof valor === 'boolean' || valor === null) return valor;

  // Objetos y listas no: un campo declarado que llega con otra forma no se guarda.
  return undefined;
}

/** Los campos declarados del cuerpo, y nada más. */
export function camposDeclarados(endpoint: EndpointDeCuenta, cuerpo: unknown): Record<string, unknown> | null {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return null;

  const datos = cuerpo as Record<string, unknown>;
  const salida: Record<string, unknown> = {};

  for (const campo of endpoint.campos ?? []) {
    if (CAMPOS_PROHIBIDOS.has(campo)) continue;

    const valor = recortar(datos[campo]);
    if (valor === undefined) continue;

    salida[campo] = campo === 'email' || campo === 'newEmail' ? String(valor).trim().toLowerCase() : valor;
  }

  if (endpoint.nombresDeCampos) {
    const nombres = Object.keys(datos).filter((nombre) => !CAMPOS_PROHIBIDOS.has(nombre));
    if (nombres.length > 0) salida.campos = nombres.slice(0, 30);
  }

  return Object.keys(salida).length > 0 ? salida : null;
}

/**
 * La fila que corresponde a un aviso del ingreso, o null si no se registra.
 *
 * Pura a propósito: la decisión se prueba sin base, y el servicio sólo busca el
 * email que falte y escribe.
 */
export function describirAvisoDeIngreso(aviso: AvisoDeIngreso): RegistroDeCuenta | null {
  if (aviso.tipo === 'sesion-creada') {
    const metadata: Record<string, unknown> = { metodo: metodoDeIngreso(aviso.ruta) };
    if (aviso.sesion.impersonatedBy) metadata.suplantadoPor = aviso.sesion.impersonatedBy;

    return {
      destino: 'evento',
      action: 'INGRESO',
      metadata,
      userId: aviso.sesion.userId,
      userLabel: null,
      // La sesión nueva: es la misma que después firma cada acción de esa
      // persona, así que desde el ingreso se sigue todo lo que hizo.
      sessionId: aviso.sesion.id,
      method: aviso.metodo ?? 'POST',
      route: `/api/auth${aviso.ruta ?? ''}`,
      status: 200
    };
  }

  if (aviso.tipo === 'sesion-borrada') {
    return {
      destino: 'evento',
      action: 'CERRO_SESION',
      metadata: { motivo: motivoDeCierre(aviso.ruta) },
      userId: aviso.sesion.userId,
      userLabel: null,
      sessionId: aviso.sesion.id,
      method: aviso.metodo ?? 'POST',
      route: `/api/auth${aviso.ruta ?? ''}`,
      status: 200
    };
  }

  const endpoint = endpointDeCuenta(aviso.ruta);
  if (!endpoint) return null;

  const metadata = camposDeclarados(endpoint, aviso.cuerpo);
  const route = `/api/auth${aviso.ruta}`;
  const method = aviso.metodo ?? 'POST';

  if (aviso.error) {
    const nombre = endpoint.siFalla ?? `${endpoint.accion}_FALLIDO`;

    return {
      destino: 'incidencia',
      kind: aviso.error.status >= 500 ? 'BACKEND_ERROR' : 'REQUEST_FAILED',
      message: aviso.error.codigo ? `${nombre}: ${aviso.error.codigo}` : nombre,
      code: aviso.error.codigo,
      metadata: { ...metadata, accion: nombre },
      userId: aviso.usuario?.id ?? null,
      userLabel: aviso.usuario?.email ?? null,
      sessionId: aviso.sesionId,
      method,
      route,
      status: aviso.error.status
    };
  }

  if (endpoint.exitoPorSesion) return null;

  return {
    destino: 'evento',
    action: endpoint.accion,
    metadata,
    userId: aviso.usuario?.id ?? null,
    userLabel: aviso.usuario?.email ?? null,
    sessionId: aviso.sesionId,
    method,
    route,
    status: 200
  };
}
