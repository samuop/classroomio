import * as z from 'zod';

const envSchema = z.object({
  SMTP_HOST: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_SENDER: z.string().optional(),
  SMTP_USER: z.string().optional(),
  /** Nombre que firma los correos cuando la organizacion no tiene el suyo. */
  EMAIL_BRAND_NAME: z.string().optional(),
  /** Color de acento del layout de correo (barra superior y boton). */
  EMAIL_ACCENT_COLOR: z.string().optional(),
  /** Segundo color del degradado de acento. */
  EMAIL_ACCENT_COLOR_2: z.string().optional(),
  ZOHO_TOKEN: z.string().optional()
});

export const env = envSchema.parse(process.env);
