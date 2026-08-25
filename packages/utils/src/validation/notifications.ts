import * as z from 'zod';

/**
 * Qué correos automáticos manda la plataforma y cuáles puede apagar cada
 * empresa. Se guarda en `organization.settings.notifications` (sin columna
 * propia — ver schema.ts), igual que `atRisk` y `aiImages`.
 *
 * **Este archivo es la única fuente de verdad.** El backend decide con él si
 * encola un correo y el dashboard dibuja la pantalla con él: agregar un aviso
 * nuevo es agregar una entrada acá, y si alguien se olvida de conectarla, el
 * test que compara el catálogo contra los valores por omisión lo dice.
 *
 * **Lo que a propósito NO es configurable:**
 *
 *   - Los correos de cuenta (registro, verificación, recuperar y cambiar
 *     contraseña). Sin ellos nadie puede entrar ni recuperar el acceso: apagarlos
 *     no es una preferencia, es dejar gente afuera.
 *   - Las invitaciones. Ya tienen interruptor propio, la casilla "enviar por
 *     correo" del momento de invitar. Un apagado de empresa por encima de esa
 *     casilla haría que alguien la marque y no pase nada, que es peor que no
 *     tener la opción.
 */

/** A quién le llega el aviso. Ordena la pantalla y nada más. */
export const NOTIFICATION_AUDIENCE = {
  STUDENT: 'student',
  TEAM: 'team'
} as const;

export type TNotificationAudience = (typeof NOTIFICATION_AUDIENCE)[keyof typeof NOTIFICATION_AUDIENCE];

export interface NotificationDefinition {
  id: TNotificationId;
  audience: TNotificationAudience;
  /** Encendido de fábrica. */
  default: boolean;
  /**
   * `true` cuando el aviso se manda a TODO el equipo del curso o a todos sus
   * miembros, no a una sola persona. Es el dato que explica por qué alguien
   * querría apagarlo, así que la pantalla lo muestra.
   */
  broadcast?: boolean;
}

export const NOTIFICATION_IDS = [
  // ── Al alumno ──
  /** Un docente publicó un aviso en el muro del curso. */
  'newsfeedPost',
  /** Cambió el estado de su entrega: Enviado, En progreso o Calificado. */
  'submissionStatusChanged',
  /** Terminó el curso y ganó el certificado. */
  'courseCompleted',
  /** Le piden el comprobante de pago. */
  'paymentProofRequested',
  /** Se acerca la fecha de un objetivo del programa. */
  'programGoalReminder',

  // ── Al tutor y al admin ──
  /** Un alumno entregó un ejercicio. */
  'exerciseSubmitted',
  /** Un alumno se sumó al curso. */
  'studentJoinedCourse',
  /** Alguien comentó un aviso del muro. */
  'newsfeedComment',
  /** Lo agregaron como docente de un curso. */
  'addedAsTeacher',
  /** Un alumno pidió comprar un curso. */
  'purchaseRequested'
] as const;

export type TNotificationId = (typeof NOTIFICATION_IDS)[number];

export const NOTIFICATION_CATALOG: readonly NotificationDefinition[] = [
  { id: 'newsfeedPost', audience: 'student', default: true, broadcast: true },
  { id: 'submissionStatusChanged', audience: 'student', default: true },
  { id: 'courseCompleted', audience: 'student', default: true },
  { id: 'paymentProofRequested', audience: 'student', default: true },
  { id: 'programGoalReminder', audience: 'student', default: true },

  { id: 'exerciseSubmitted', audience: 'team', default: true, broadcast: true },
  { id: 'studentJoinedCourse', audience: 'team', default: true, broadcast: true },
  { id: 'newsfeedComment', audience: 'team', default: true },
  { id: 'addedAsTeacher', audience: 'team', default: true },
  { id: 'purchaseRequested', audience: 'team', default: true }
] as const;

/**
 * Todo encendido salvo que el catálogo diga otra cosa.
 *
 * Se deriva del catálogo en vez de escribirse a mano: un aviso nuevo queda
 * cubierto sin tocar dos listas, y sobre todo no puede quedar ausente de acá —
 * un `undefined` leído como "apagado" silenciaría un aviso sin que nadie lo
 * haya pedido.
 */
export const DEFAULT_NOTIFICATION_SETTINGS: Record<TNotificationId, boolean> = Object.fromEntries(
  NOTIFICATION_CATALOG.map((n) => [n.id, n.default])
) as Record<TNotificationId, boolean>;

/**
 * Lo que se guarda. Todas las claves opcionales a propósito: una empresa que
 * nunca tocó la pantalla no tiene nada escrito, y lo que falte cae en el default.
 */
export const ZNotificationSettings = z.object(
  Object.fromEntries(NOTIFICATION_IDS.map((id) => [id, z.boolean().optional()])) as Record<
    TNotificationId,
    z.ZodOptional<z.ZodBoolean>
  >
);

export type TNotificationSettings = z.infer<typeof ZNotificationSettings>;

/** El PUT es un parche: manda sólo lo que cambió. */
export const ZNotificationSettingsUpdate = ZNotificationSettings;
export type TNotificationSettingsUpdate = z.infer<typeof ZNotificationSettingsUpdate>;

/** Lo resuelto: el default con lo guardado encima, sin huecos. */
export type TResolvedNotificationSettings = Record<TNotificationId, boolean>;

export function resolveNotificationSettings(
  stored: TNotificationSettings | null | undefined
): TResolvedNotificationSettings {
  const resolved = { ...DEFAULT_NOTIFICATION_SETTINGS };

  for (const id of NOTIFICATION_IDS) {
    const value = stored?.[id];
    // Sólo un booleano de verdad pisa el default. Un `undefined` es "nunca lo
    // tocaron", no "apagado".
    if (typeof value === 'boolean') resolved[id] = value;
  }

  return resolved;
}

export function notificationsFor(audience: TNotificationAudience): readonly NotificationDefinition[] {
  return NOTIFICATION_CATALOG.filter((n) => n.audience === audience);
}
