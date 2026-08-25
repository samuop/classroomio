import { EMPTY_BLOCKS, type EmailBlocks } from './blocks';
import { EmailRegistry } from './registry';
import { sampleFieldsFor } from './sample';

/**
 * Qué correos puede reescribir un admin, y con qué variables.
 *
 * **Se deriva del registro, no de una lista aparte.** Cada correo ya declara su
 * esquema zod y sus bloques de fábrica: las claves del esquema son exactamente
 * los datos que la plantilla recibe, y los bloques son exactamente lo que se
 * envía. Mantener una segunda lista significaría que el día que un correo gane
 * un campo, la pantalla siga ofreciendo los viejos.
 *
 * Los correos de cuenta quedan afuera a propósito: son el camino para entrar al
 * sistema, y un admin que los rompa —un `{link}` borrado sin querer— deja gente
 * sin poder recuperar su contraseña, sin ningún error que lo avise.
 */
const NO_EDITABLES = new Set(['welcome', 'verifyEmail', 'forgotPassword', 'onPasswordReset']);

export interface EditableEmail {
  id: string;
  /** El texto original, que es lo que se envía mientras nadie lo cambie. */
  defaults: EmailBlocks;
  /** Nombres de variable que el texto puede usar como `{nombre}`. */
  variables: string[];
  /**
   * Variables sin las cuales el correo pierde sentido: si el texto escrito por
   * el admin no las menciona, se avisa. No se bloquea el guardado —puede haber
   * un motivo— pero un correo de invitación sin el enlace es papel picado.
   */
  requiredVariables: string[];
}

/** Variables cuya ausencia deja el correo inservible, por sufijo del nombre. */
const IMPRESCINDIBLES = /(link|url)$/i;

/**
 * Las variables de un correo: las de sus datos más las que él mismo calcula.
 *
 * Para quien escribe el texto las dos son lo mismo —`{expiresAt}` y `{dueLine}`
 * se usan igual— así que la pantalla no las distingue. Las calculadas se
 * descubren ejecutando `derived` con datos de mentira, que es la única forma de
 * saber qué claves devuelve sin escribirlas dos veces.
 */
function variablesDe(id: string): string[] {
  const template = EmailRegistry.get(id)!;
  const shape = (template.schema as unknown as { shape?: Record<string, unknown> }).shape ?? {};
  const nombres = new Set(Object.keys(shape));

  if (template.derived) {
    try {
      for (const clave of Object.keys(template.derived(sampleFieldsFor(template)))) nombres.add(clave);
    } catch (error) {
      // Una `derived` que no aguanta datos de mentira no puede aportar nombres,
      // pero eso no puede dejar sin variables al resto del correo.
      console.error(`No se pudieron listar las variables calculadas de "${id}":`, error);
    }
  }

  return [...nombres].sort();
}

export function getEditableEmails(): EditableEmail[] {
  return EmailRegistry.getAllIds()
    .filter((id) => isEditableEmail(id))
    .sort()
    .map((id) => {
      const template = EmailRegistry.get(id)!;
      const variables = variablesDe(id);

      return {
        id,
        defaults: template.blocks ?? { ...EMPTY_BLOCKS, subject: template.subject },
        variables,
        requiredVariables: variables.filter((v) => IMPRESCINDIBLES.test(v))
      };
    });
}

/**
 * Editable = está registrado, no es de cuenta, y **está escrito en bloques**.
 *
 * Lo último no es un detalle burocrático: sin bloques no hay nada que mostrarle
 * al admin más que HTML crudo, que es justamente lo que esta pantalla existe
 * para evitar.
 */
export function isEditableEmail(id: string): boolean {
  return !NO_EDITABLES.has(id) && Boolean(EmailRegistry.get(id)?.blocks);
}
