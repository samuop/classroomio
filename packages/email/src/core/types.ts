import * as z from 'zod';

import type { EmailBlocks } from './blocks';
import type { EmailId } from '../utils/types';

/**
 * Base email template interface
 */
export interface EmailTemplate<TSchema extends z.ZodType = z.ZodType> {
  subject: string;
  schema: TSchema;
  render: (fields: z.infer<TSchema>) => string;
  /**
   * Asunto y HTML de una sola pasada.
   *
   * Existe porque el asunto también puede llevar variables: `subject` a secas es
   * la plantilla cruda y mandarla así deja un `{courseName}` literal en la
   * bandeja de entrada. Todo envío pasa por acá.
   */
  renderEmail: (fields: z.infer<TSchema>) => { subject: string; html: string };
  /**
   * Los bloques de fábrica, cuando el correo se define con bloques.
   *
   * Es lo que la pantalla de configuración muestra como punto de partida, y —
   * importante— es lo MISMO que se envía cuando nadie tocó nada: `render` se
   * deriva de acá. Tener dos fuentes haría que "restaurar el original" devuelva
   * un texto que no es el que sale de verdad.
   */
  blocks?: EmailBlocks;
  /**
   * Variables que no vienen en los datos sino que se calculan con ellos —
   * "vence mañana" vs "vence en 5 días". Se ofrecen en la pantalla igual que
   * las demás, porque para quien escribe el texto son indistinguibles.
   */
  derived?: (fields: z.infer<TSchema>) => Record<string, string>;
  from?: string;
  replyTo?: string;
}

/**
 * Email definition with ID for registry
 */
export interface EmailDefinition<TSchema extends z.ZodType = z.ZodType> {
  id: EmailId;
  template: EmailTemplate<TSchema>;
}

/**
 * Configuration for sending an email
 */
export interface SendConfig<TSchema extends z.ZodType = z.ZodType> {
  to: string;
  fields: z.infer<TSchema>;
  from?: string;
  replyTo?: string;
}

/**
 * Internal send configuration with template
 */
export interface SendTemplateConfig<TSchema extends z.ZodType = z.ZodType> extends SendConfig<TSchema> {
  template: EmailTemplate<TSchema>;
}

/**
 * Configuration for defining an email template
 */
export interface DefineEmailConfig<TSchema extends z.ZodType = z.ZodType> {
  id: EmailId;
  /** Sólo para los correos que todavía arman su HTML a mano. Con `blocks` sale de ahí. */
  subject?: string;
  schema: TSchema;
  /** Sólo para los correos que arman su HTML a mano (los de cuenta). */
  render?: (fields: z.infer<TSchema>) => string;
  /** La forma preferida: el correo en bloques de texto, editable desde la pantalla. */
  blocks?: EmailBlocks;
  derived?: (fields: z.infer<TSchema>) => Record<string, string>;
  from?: string;
  replyTo?: string;
}
