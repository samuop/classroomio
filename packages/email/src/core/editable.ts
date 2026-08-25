import * as z from 'zod';

import { EmailRegistry } from './registry';

/**
 * Qué correos puede reescribir un admin, y con qué variables.
 *
 * **Se deriva del registro, no de una lista aparte.** Cada correo ya declara su
 * esquema zod, y las claves de ese esquema son exactamente los datos que la
 * plantilla recibe: si `teacherStudentJoined` valida `{courseName, studentName,
 * studentEmail}`, ésas son las variables disponibles y no hay ninguna otra.
 * Mantener una segunda lista significaría que el día que un correo gane un campo,
 * la pantalla siga ofreciendo los viejos.
 *
 * Los correos de cuenta quedan afuera a propósito: son el camino para entrar al
 * sistema, y un admin que los rompa —un `{link}` borrado sin querer— deja gente
 * sin poder recuperar su contraseña, sin ningún error que lo avise.
 */
const NO_EDITABLES = new Set(['welcome', 'verifyEmail', 'forgotPassword', 'onPasswordReset']);

export interface EditableEmail {
  id: string;
  /** El asunto de fábrica, que es lo que se muestra cuando nadie lo cambió. */
  defaultSubject: string;
  /** Nombres de variable que el cuerpo puede usar como `{nombre}`. */
  variables: string[];
  /**
   * Variables sin las cuales el correo pierde sentido: si el cuerpo escrito por
   * el admin no las menciona, se avisa. No se bloquea el guardado — puede haber
   * un motivo— pero un correo de invitación sin el enlace es papel picado.
   */
  requiredVariables: string[];
}

/** Variables cuya ausencia deja el correo inservible, por sufijo del nombre. */
const IMPRESCINDIBLES = /(link|url)$/i;

function variablesDe(schema: z.ZodType): string[] {
  const shape = (schema as unknown as { shape?: Record<string, unknown> }).shape;

  if (!shape || typeof shape !== 'object') return [];

  return Object.keys(shape).sort();
}

export function getEditableEmails(): EditableEmail[] {
  return EmailRegistry.getAllIds()
    .filter((id) => !NO_EDITABLES.has(id))
    .sort()
    .map((id) => {
      const template = EmailRegistry.get(id)!;
      const variables = variablesDe(template.schema);

      return {
        id,
        defaultSubject: template.subject,
        variables,
        requiredVariables: variables.filter((v) => IMPRESCINDIBLES.test(v))
      };
    });
}

export function isEditableEmail(id: string): boolean {
  return !NO_EDITABLES.has(id) && EmailRegistry.has(id);
}

/**
 * Reemplaza `{variable}` por su valor, escapando lo que se interpola.
 *
 * El escapado no es opcional: los valores son datos de gente —el nombre de un
 * alumno, el título de un curso— y van a parar a un correo HTML. Un curso
 * llamado `<script>…` no puede convertirse en etiqueta. El cuerpo que escribió
 * el admin sí lleva HTML, pero eso se sanea aparte, antes de guardarlo.
 *
 * Una variable que no exista se deja tal cual, visible: preferible que el admin
 * vea `{cursoo}` en la vista previa y lo corrija, a que el correo salga con un
 * hueco vacío que nadie note.
 *
 * `modo` no es un detalle: el asunto NO es HTML. Escaparlo ahí haría que un
 * curso llamado "Ventas & Marketing" llegue como "Ventas &amp; Marketing" en la
 * bandeja de entrada, a la vista de todos.
 */
export function applyVariables(
  plantilla: string,
  fields: Record<string, unknown>,
  modo: 'html' | 'texto' = 'html'
): string {
  return plantilla.replace(/\{(\w+)\}/g, (original, nombre: string) => {
    if (!(nombre in fields)) return original;

    const valor = fields[nombre];
    if (valor === null || valor === undefined) return '';

    return modo === 'html' ? escapeHtml(String(valor)) : String(valor);
  });
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string
  );
}
