import { env } from '../config/env';

export const EMAIL_IDS = [
  'forgotPassword',
  'inviteTeacher',
  'newsfeedComment',
  'newsfeedPost',
  'onPasswordReset',
  'programGoalReminder',
  'studentCourseInvite',
  'studentCourseCompletion',
  'studentCourseWelcome',
  'studentOrgInvite',
  'studentProgramWelcome',
  'studentProvePayment',
  'teacherCourseWelcome',
  'teacherStudentBuyRequest',
  'teacherStudentJoined',
  'verifyEmail',
  'welcome'
] as const;

/**
 * Con qué nombre se firman los correos cuando la organización no tiene el suyo.
 *
 * Única fuente: antes esta expresión estaba copiada en la plantilla por defecto
 * y en el saneador del remitente, y encima había literales 'ClassroomIO' en la
 * API que no pasaban por ninguna de las dos.
 *
 * El default es la marca de ESTE despliegue, no la de un cliente: cada empresa
 * firma con su propio nombre (`sender`), y este valor sólo aparece cuando no hay
 * ninguno. Poner acá el nombre de un cliente lo convertía en el remitente por
 * omisión de todas las demás — y, en un repositorio público, en un dato de
 * negocio horneado en el código.
 */
export const EMAIL_BRAND_NAME = env.EMAIL_BRAND_NAME?.trim() || 'Tensor Tech';

/**
 * Acento del layout de correo: la barra de arriba y el botón.
 *
 * El default es el violeta de EGEA, el mismo de SaaS-RRHH, para que los correos
 * de los dos productos se lean como del mismo lugar cuando le llegan a la misma
 * persona. Cada despliegue puede correrse a su color sin tocar código.
 */
export const EMAIL_ACCENT_COLOR = env.EMAIL_ACCENT_COLOR?.trim() || '#7B35AB';
export const EMAIL_ACCENT_COLOR_2 = env.EMAIL_ACCENT_COLOR_2?.trim() || '#49206A';

/**
 * Remitente y Reply-To.
 *
 * Los valores por defecto eran direcciones de ClassroomIO
 * (`notify@mail.classroomio.com`, `help@classroomio.com`): sin `SMTP_SENDER`
 * configurado, cada correo salía a nombre de otra empresa y las respuestas
 * caían en su bandeja. Ahora el nombre visible es el de la marca propia.
 *
 * ⚠️ La dirección del fallback sigue siendo un placeholder inválido a
 * propósito: no hay ninguna dirección propia que adivinar, y es preferible que
 * el envío falle de forma ruidosa antes que salir firmado por un tercero. En
 * este despliegue nunca se usa — `SMTP_SENDER` está configurado.
 */
const DEFAULT_EMAIL_FROM = `"${EMAIL_BRAND_NAME}" <no-reply@invalid.local>`;

export const EMAIL_FROM = env.SMTP_SENDER || DEFAULT_EMAIL_FROM;
export const EMAIL_REPLY_TO = env.SMTP_SENDER || DEFAULT_EMAIL_FROM;

/**
 * Si esto da `false`, TODO correo sale con una dirección inválida y rebota.
 *
 * "Falla ruidosa" sólo es mejor que "sale firmado por un tercero" si alguien
 * escucha el ruido, y acá el ruido llegaba recién al primer rebote, del lado del
 * destinatario. La API lo mira al arrancar y lo dice en el log — mismo criterio
 * que `isWebSearchConfigured`.
 */
export const isEmailSenderConfigured = () => Boolean(env.SMTP_SENDER?.trim());
