/**
 * Qué requests se registran en la auditoría, y con qué nombre.
 *
 * Este es el ÚNICO archivo que hay que tocar para sumar o sacar acciones. El
 * middleware (`middlewares/audit-request.ts`) no sabe nada del dominio: le
 * pregunta acá.
 *
 * La regla de decisión, en orden:
 *
 *   ¿Falló (status >= 400)?                 → SÍ, siempre, venga de donde venga
 *   ¿Tardó más del umbral?                  → SÍ, siempre
 *   ¿Es escritura (POST/PUT/PATCH/DELETE)?  → SÍ, siempre
 *   ¿Es una lectura de la lista de abajo?   → SÍ
 *   Si no                                   → no se registra
 *
 * Las dos primeras líneas son las importantes: **cualquier** request que falle
 * queda registrado aunque su ruta no esté declarada acá. Es lo único que cubre
 * el caso que originó todo esto —una pantalla que se rompió una vez y no se
 * pudo volver a reproducir—, porque no hace falta anticipar qué se va a romper.
 *
 * Las escrituras se registran solas por el mismo motivo: un endpoint nuevo que
 * modifique datos queda auditado sin que nadie se acuerde de agregarlo.
 *
 * Las lecturas exitosas sí son lista blanca. Sin eso el registro se llena de
 * listados, cambios de página y refrescos, y tapa justo lo que se busca.
 */

import { env } from '@api/config/env';

/** Milisegundos a partir de los cuales un request se considera lento. */
export const SLOW_REQUEST_MS = env.AUDIT_SLOW_REQUEST_MS;

export interface AuditedRead {
  /** Patrón con `:param`. Tiene que matchear el path COMPLETO. */
  pattern: string;
  action: string;
  /** Entidad sobre la que actúa, para poder resolver el nombre al consultar. */
  entity?: string;
  /** De qué `:param` sale el id de la entidad. Por defecto, el primero. */
  paramId?: string;
  /**
   * Qué guardar en `metadata`. Sólo campos declarados: NUNCA el body ni el
   * querystring entero. Sin esta regla un PUT de credenciales dejaría la clave
   * escrita en la propia tabla de auditoría.
   */
  metadata?: (url: URL, params: Record<string, string>) => Record<string, unknown> | undefined;
}

/** Lecturas que sí se registran. Todo lo que no esté acá y salga 2xx se ignora. */
export const AUDITED_READS: AuditedRead[] = [
  // ── Seguimiento de alumnos ──
  // El primero de la lista no es casualidad: es la pantalla que se rompió
  // mientras un administrador revisaba el avance de los alumnos.
  {
    pattern: '/organization/tracking/overview',
    action: 'VIO_SEGUIMIENTO',
    metadata: (url) => {
      const scope = url.searchParams.get('scope');

      return scope ? { scope } : undefined;
    }
  },
  { pattern: '/organization/at-risk/overview', action: 'VIO_ALUMNOS_EN_RIESGO' },
  { pattern: '/course/:courseId/compliance', action: 'VIO_CUMPLIMIENTO', entity: 'Course' },
  {
    pattern: '/course/:courseId/members/:userId/analytics',
    action: 'VIO_AVANCE_DE_ALUMNO',
    entity: 'Course',
    paramId: 'courseId',
    metadata: (_url, params) => ({ userId: params.userId })
  },
  { pattern: '/program/:programId/progress', action: 'VIO_AVANCE_DE_PROGRAMA', entity: 'Program' },
  { pattern: '/course/:courseId/mark/gradebook', action: 'VIO_LIBRETA_DE_NOTAS', entity: 'Course' },
  { pattern: '/course/:courseId/mark', action: 'VIO_CALIFICACIONES', entity: 'Course' },
  { pattern: '/course/:courseId/submission/for-grading', action: 'VIO_ENTREGAS_PARA_CORREGIR', entity: 'Course' },
  {
    pattern: '/course/:courseId/exercise/:exerciseId/submissions',
    action: 'VIO_ENTREGAS_DE_UN_EJERCICIO',
    entity: 'Course',
    paramId: 'courseId',
    metadata: (_url, params) => ({ exerciseId: params.exerciseId })
  },
  { pattern: '/organization/audience/:userId/analytics', action: 'VIO_AVANCE_DE_ESTUDIANTE', entity: 'User' },

  // ── Datos personales de alumnos ──
  {
    pattern: '/organization/audience',
    action: 'VIO_LISTA_DE_ALUMNOS',
    metadata: (url) => {
      const term = url.searchParams.get('q')?.trim();

      return term ? { term: term.slice(0, 200) } : undefined;
    }
  },
  { pattern: '/organization/team', action: 'VIO_EQUIPO' },
  { pattern: '/course/:courseId/members', action: 'VIO_ALUMNOS_DEL_CURSO', entity: 'Course' },
  { pattern: '/course/:courseId/invites/students', action: 'VIO_INVITADOS_DEL_CURSO', entity: 'Course' },
  { pattern: '/program/:programId/members', action: 'VIO_MIEMBROS_DEL_PROGRAMA', entity: 'Program' },
  { pattern: '/organization/assets/export', action: 'EXPORTO_MEDIOS' },

  // ── Consumo de IA ──
  // Quién mira cuánto gasta cada estudiante con el tutor: es actividad de una
  // persona identificada, y el cupo es plata.
  { pattern: '/agent/tutor-usage/:userId', action: 'VIO_USO_DEL_TUTOR_DE_UN_ESTUDIANTE', entity: 'User' },
  { pattern: '/agent/tutor-usage/summary', action: 'VIO_CONSUMO_DEL_TUTOR' },
  { pattern: '/agent/usage', action: 'VIO_CONSUMO_DE_IA' },
  { pattern: '/account/usage', action: 'VIO_CONSUMO_DE_LA_CUENTA' },

  // ── Credenciales y accesos de la empresa ──
  // Pantallas desde donde se saca una llave para entrar sin contraseña.
  { pattern: '/organization/automation/keys', action: 'VIO_CLAVES_DE_API' },
  { pattern: '/organization/token-auth', action: 'VIO_INGRESO_POR_TOKEN' },
  { pattern: '/organization/sso', action: 'VIO_CONFIGURACION_SSO' },

  // ── Panel de plataforma (cross-empresa) ──
  { pattern: '/platform/organizations', action: 'ENTRO_AL_PANEL_DE_PLATAFORMA' },
  { pattern: '/platform/organizations/:orgId', action: 'VIO_EMPRESA_EN_EL_PANEL', entity: 'Organization' },
  { pattern: '/platform/settings', action: 'VIO_AJUSTES_DE_PLATAFORMA' },
  // Era `/organization/clients`, una ruta que no existe: la entrada nunca se
  // disparó. La real es `/overview`.
  { pattern: '/organization/clients/overview', action: 'VIO_EMPRESAS_CLIENTE' },

  // ── Tablero: una fila por visita, para saber por dónde anduvo ──
  { pattern: '/dash/stats', action: 'ENTRO_AL_TABLERO' },
  { pattern: '/dash/login-activity', action: 'VIO_ACTIVIDAD_DE_INGRESOS' },
  { pattern: '/dash/landing-stats', action: 'VIO_ANALITICA_DEL_SITIO' }
];

/**
 * Nombres legibles para escrituras. NO hacen falta para que se auditen (toda
 * escritura se registra sola); sólo evitan que la acción quede como
 * `PUT /organization` en el registro.
 */
export const WRITE_ACTION_NAMES: Array<{ method: string; pattern: string; action: string; entity?: string }> = [
  // Organizaciones
  { method: 'POST', pattern: '/organization', action: 'CREO_EMPRESA' },
  { method: 'PUT', pattern: '/organization', action: 'EDITO_EMPRESA' },
  { method: 'POST', pattern: '/organization/team/invite', action: 'INVITO_AL_EQUIPO' },
  { method: 'DELETE', pattern: '/organization/team/:memberId', action: 'SACO_DEL_EQUIPO' },
  { method: 'POST', pattern: '/organization/plan', action: 'CREO_PLAN' },
  { method: 'PUT', pattern: '/organization/plan', action: 'EDITO_PLAN' },
  { method: 'POST', pattern: '/organization/plan/cancel', action: 'CANCELO_PLAN' },
  // Era `/organization/keys`, que no existe: la real cuelga de `/automation`.
  { method: 'POST', pattern: '/organization/automation/keys', action: 'GENERO_CLAVE_DE_API' },
  { method: 'POST', pattern: '/organization/automation/keys/:keyId/rotate', action: 'ROTO_CLAVE_DE_API' },
  { method: 'DELETE', pattern: '/organization/automation/keys/:keyId', action: 'BORRO_CLAVE_DE_API' },
  { method: 'POST', pattern: '/organization/token-auth', action: 'CONFIGURO_INGRESO_POR_TOKEN' },
  { method: 'POST', pattern: '/organization/token-auth/rotate', action: 'ROTO_SECRETO_DE_INGRESO_POR_TOKEN' },
  { method: 'PUT', pattern: '/organization/token-auth/activate', action: 'ACTIVO_INGRESO_POR_TOKEN' },
  { method: 'DELETE', pattern: '/organization/token-auth', action: 'BORRO_INGRESO_POR_TOKEN' },
  { method: 'POST', pattern: '/organization/sso', action: 'CONFIGURO_SSO' },
  { method: 'PUT', pattern: '/organization/sso', action: 'EDITO_SSO' },
  { method: 'POST', pattern: '/organization/sso/activate', action: 'ACTIVO_SSO' },
  { method: 'PUT', pattern: '/organization/sso/policy', action: 'CAMBIO_POLITICA_DE_SSO' },
  { method: 'DELETE', pattern: '/organization/sso', action: 'BORRO_SSO' },
  { method: 'PUT', pattern: '/organization/ai-tutor', action: 'CAMBIO_AJUSTES_DEL_TUTOR' },
  { method: 'PUT', pattern: '/organization/ai-images', action: 'CAMBIO_AJUSTES_DE_IMAGENES' },
  { method: 'PUT', pattern: '/organization/email-templates/:emailId', action: 'EDITO_CORREO' },
  { method: 'DELETE', pattern: '/organization/email-templates/:emailId', action: 'RESTAURO_CORREO' },
  { method: 'POST', pattern: '/organization/email-templates/:emailId/test', action: 'ENVIO_CORREO_DE_PRUEBA' },
  { method: 'POST', pattern: '/domain', action: 'CONECTO_DOMINIO' },

  // Estudiantes y equipo
  { method: 'POST', pattern: '/organization/audience/import', action: 'IMPORTO_ESTUDIANTES' },
  { method: 'POST', pattern: '/organization/audience/assign-courses', action: 'ASIGNO_CURSOS' },
  { method: 'POST', pattern: '/organization/audience/revoke-invite', action: 'REVOCO_INVITACION' },
  { method: 'POST', pattern: '/organization/audience/resend-invite', action: 'REENVIO_INVITACION' },
  { method: 'DELETE', pattern: '/organization/audience/:memberId', action: 'SACO_ESTUDIANTE_DE_LA_EMPRESA' },
  { method: 'POST', pattern: '/organization/auto-enroll-student', action: 'SE_INSCRIBIO_EN_LA_EMPRESA' },
  { method: 'POST', pattern: '/invite/organization/:token/accept', action: 'ACEPTO_INVITACION' },
  { method: 'POST', pattern: '/invite/organization/:inviteId/accept-by-id', action: 'ACEPTO_INVITACION_POR_ID' },
  { method: 'POST', pattern: '/account/workspaces', action: 'CREO_EMPRESA_CLIENTE' },
  {
    method: 'DELETE',
    pattern: '/account/workspaces/:workspaceId',
    action: 'BORRO_EMPRESA_CLIENTE',
    entity: 'Organization'
  },

  // Cursos y contenido
  { method: 'POST', pattern: '/course', action: 'CREO_CURSO' },
  { method: 'PUT', pattern: '/course/:courseId', action: 'EDITO_CURSO', entity: 'Course' },
  { method: 'DELETE', pattern: '/course/:courseId', action: 'BORRO_CURSO', entity: 'Course' },
  { method: 'PUT', pattern: '/course/:courseId/content/lock-all', action: 'BLOQUEO_TODO_EL_CONTENIDO', entity: 'Course' },
  { method: 'PUT', pattern: '/course/:courseId/lesson/:lessonId', action: 'EDITO_LECCION', entity: 'Course' },
  { method: 'POST', pattern: '/course/:courseId/lesson/:lessonId/language', action: 'EDITO_LECCION', entity: 'Course' },
  {
    method: 'PUT',
    pattern: '/course/:courseId/lesson/:lessonId/language/:locale',
    action: 'EDITO_LECCION',
    entity: 'Course'
  },
  { method: 'PUT', pattern: '/course/:courseId/exercise/:exerciseId', action: 'EDITO_EJERCICIO', entity: 'Course' },
  { method: 'DELETE', pattern: '/course/:courseId/exercise/:exerciseId', action: 'BORRO_EJERCICIO', entity: 'Course' },
  { method: 'PUT', pattern: '/course/:courseId/ai-tutor', action: 'CAMBIO_AJUSTES_DEL_TUTOR_DEL_CURSO', entity: 'Course' },
  { method: 'POST', pattern: '/course/:courseId/members', action: 'SUMO_PERSONAS_AL_CURSO', entity: 'Course' },
  { method: 'PUT', pattern: '/course/:courseId/members/:memberId', action: 'CAMBIO_ROL_EN_EL_CURSO', entity: 'Course' },
  { method: 'POST', pattern: '/course/:courseId/invites', action: 'INVITO_AL_CURSO', entity: 'Course' },
  {
    method: 'POST',
    pattern: '/course/:courseId/invites/:inviteId/revoke',
    action: 'REVOCO_INVITACION_AL_CURSO',
    entity: 'Course'
  },
  { method: 'POST', pattern: '/course/:courseId/download/certificate', action: 'DESCARGO_CERTIFICADO', entity: 'Course' },
  {
    method: 'POST',
    pattern: '/course/:courseId/download/certificate/png',
    action: 'DESCARGO_CERTIFICADO',
    entity: 'Course'
  },
  { method: 'POST', pattern: '/program/:programId/members', action: 'SUMO_PERSONAS_AL_PROGRAMA', entity: 'Program' },
  { method: 'POST', pattern: '/program/:programId/invite', action: 'INVITO_AL_PROGRAMA', entity: 'Program' },

  // Asistente de IA
  { method: 'POST', pattern: '/agent/chat', action: 'USO_EL_ASISTENTE' },
  { method: 'POST', pattern: '/agent/upload', action: 'SUBIO_UNA_FUENTE' },
  { method: 'POST', pattern: '/media/image', action: 'SUBIO_UNA_IMAGEN' },
  { method: 'PUT', pattern: '/course/:courseId/content', action: 'EDITO_CONTENIDO', entity: 'Course' },
  { method: 'DELETE', pattern: '/course/:courseId/content', action: 'BORRO_CONTENIDO', entity: 'Course' },
  { method: 'POST', pattern: '/course/:courseId/lesson', action: 'CREO_LECCION', entity: 'Course' },
  { method: 'DELETE', pattern: '/course/:courseId/lesson/:lessonId', action: 'BORRO_LECCION', entity: 'Course' },
  {
    method: 'DELETE',
    pattern: '/course/:courseId/members/:memberId',
    action: 'SACO_ALUMNO_DEL_CURSO',
    entity: 'Course'
  },
  {
    method: 'DELETE',
    pattern: '/course/:courseId/submission/:submissionId',
    action: 'BORRO_ENTREGA',
    entity: 'Course'
  },

  // Plataforma
  { method: 'POST', pattern: '/platform/organizations', action: 'CREO_EMPRESA_DESDE_EL_PANEL' },
  { method: 'PUT', pattern: '/platform/settings', action: 'CAMBIO_AJUSTES_DE_PLATAFORMA' },
  {
    method: 'PUT',
    pattern: '/platform/organizations/:orgId',
    action: 'EDITO_EMPRESA_DESDE_EL_PANEL',
    entity: 'Organization'
  },
  {
    method: 'PUT',
    pattern: '/platform/organizations/:orgId/plan',
    action: 'CAMBIO_PLAN_DE_EMPRESA',
    entity: 'Organization'
  },
  {
    method: 'POST',
    pattern: '/platform/organizations/:orgId/suspend',
    action: 'SUSPENDIO_EMPRESA',
    entity: 'Organization'
  },
  {
    method: 'POST',
    pattern: '/platform/organizations/:orgId/domain',
    action: 'CAMBIO_DOMINIO_DESDE_EL_PANEL',
    entity: 'Organization'
  },

  // Créditos de IA: se gastan cuando se acaba el cupo, así que son plata.
  { method: 'POST', pattern: '/agent/credits', action: 'CARGO_CREDITOS' },
  { method: 'POST', pattern: '/agent/credits/purchase', action: 'REGISTRO_COMPRA_DE_CREDITOS' },

  // Cuenta
  // Era `PUT /account/user`, que no existe: el perfil se guarda en `/profile`.
  { method: 'PUT', pattern: '/account/profile', action: 'CAMBIO_SU_PERFIL' }
];

/**
 * Params de ruta que son un secreto: nunca se guardan, ni en la ruta ni como id.
 *
 * Una invitación viaja con su token en la URL, y quien tenga ese token se suma a
 * la empresa. Antes quedaba escrito tal cual en `route` y en `action`.
 */
const SECRET_PARAMS = new Set(['token']);

const SECRET_ROUTES = [
  '/invite/organization/:token/accept',
  '/invite/organization/:token/preview',
  '/invite/student/:token'
];

/** La ruta con cada secreto reemplazado por el nombre de su param. */
export function redactRoute(path: string): string {
  for (const pattern of SECRET_ROUTES) {
    if (!matchPattern(pattern, path)) continue;

    const pathSegments = path.split('/');

    return pattern
      .split('/')
      .map((segment, index) =>
        segment.startsWith(':') && SECRET_PARAMS.has(segment.slice(1)) ? segment : pathSegments[index]
      )
      .join('/');
  }

  return path;
}

/**
 * Rutas que nunca se auditan, ni siquiera cuando fallan.
 *
 *  - `/api/auth`: Better Auth. Un intento fallido de ingreso no debe dejar
 *    rastro que invite a adivinar qué mails existen, y el ingreso exitoso ya
 *    queda en la tabla `session` y en `analytics_login_events`.
 *  - `/session`: es el sondeo de sesión del dashboard. Un 401 ahí es la
 *    respuesta normal a "no estoy logueado", no una incidencia — dejarlo
 *    adentro llenaría la tabla de falsos positivos.
 *  - `/audit`: si se auditara, un fallo del propio endpoint de reporte se
 *    realimentaría hasta llenar la tabla.
 *  - `/dash/track`: la analítica de páginas, que llega en lotes y tiene un
 *    volumen de otro orden. Ya se persiste en `analytics_page_event`.
 *  - `/widgets`, `/org-site`, `/public-api`: superficie pública o de terceros;
 *    la usa gente sin cuenta y su volumen no es comparable.
 *  - `/admin/queues`: el tablero de BullMQ hace polling permanente.
 */
const EXCLUDED_PREFIXES = [
  '/api/auth',
  '/session',
  '/audit',
  '/dash/track',
  '/widgets',
  '/org-site',
  '/public-api',
  '/admin/queues',
  '/docs',
  '/openapi'
];

export function isExcluded(path: string): boolean {
  if (path === '/') return true;

  return EXCLUDED_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + '/'));
}

// ── Matcher de rutas ─────────────────────────────────────────────────────────

/**
 * ¿El path matchea el patrón? Compara segmento a segmento y exige la MISMA
 * cantidad, para que `/course/abc/members/xyz/analytics` no matchee con
 * `/course/:courseId/members`. Un matcher laxo haría que ver el avance de un
 * alumno se registrara como "vio la lista", que es una diferencia importante.
 *
 * Devuelve los params capturados, o null si no matchea.
 */
export function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const patternSegments = pattern.split('/').filter(Boolean);
  const pathSegments = path.split('/').filter(Boolean);
  if (patternSegments.length !== pathSegments.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternSegments.length; i++) {
    const segment = patternSegments[i]!;
    if (segment.startsWith(':')) {
      params[segment.slice(1)] = safeDecode(pathSegments[i]!);
      continue;
    }

    if (segment !== pathSegments[i]) return null;
  }

  return params;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export interface AuditMatch {
  action: string;
  entity?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/** Busca el nombre declarado para este request, si lo hay. */
export function findInAuditMap(method: string, url: URL): AuditMatch | null {
  const upperMethod = method.toUpperCase();
  const path = url.pathname;

  if (upperMethod === 'GET') {
    for (const entry of AUDITED_READS) {
      const params = matchPattern(entry.pattern, path);
      if (!params) continue;

      const idKey = entry.paramId ?? Object.keys(params).find((key) => !SECRET_PARAMS.has(key));

      return {
        action: entry.action,
        entity: entry.entity,
        entityId: idKey ? params[idKey] : undefined,
        metadata: entry.metadata?.(url, params)
      };
    }

    return null;
  }

  for (const entry of WRITE_ACTION_NAMES) {
    if (entry.method !== upperMethod) continue;

    const params = matchPattern(entry.pattern, path);
    if (!params) continue;

    const idKey = Object.keys(params).find((key) => !SECRET_PARAMS.has(key));

    return {
      action: entry.action,
      entity: entry.entity,
      entityId: idKey ? params[idKey] : undefined
    };
  }

  return null;
}

/** Acción genérica para una escritura sin nombre declarado. */
export function genericAction(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

export function isWrite(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}
