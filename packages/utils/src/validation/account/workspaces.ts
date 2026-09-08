import * as z from 'zod';

import { ZSiteName, SITE_NAME_MIN_LENGTH } from '../organization/site-name';

/**
 * El nombre de una empresa hija, tal como lo escribe quien la crea.
 *
 * El mínimo era 5 y venía del proyecto original, sin ninguna razón anotada. Era
 * más estricto que el del NOMBRE DEL SITIO, que es el campo con restricciones
 * de verdad —se convierte en `<sitio>.<dominio>` y si sale mal el host no
 * resuelve— y que acepta 3. O sea que la etiqueta para mostrar exigía más que
 * la etiqueta DNS.
 *
 * Ahora los dos piden lo mismo: dos reglas distintas que nadie puede explicar
 * son dos reglas que alguien va a chocar. "ONE!" es un nombre de empresa
 * perfectamente válido y lo rechazaba.
 *
 * Se recortan los espacios de los bordes por lo mismo que el nombre del sitio:
 * sin eso, tres espacios pasan el mínimo.
 */
export const ZCreateWorkspace = z.object({
  name: z
    .string()
    .trim()
    .min(SITE_NAME_MIN_LENGTH)
    .refine((val) => !/^[-]|[-]$/.test(val), {
      message: 'Workspace name cannot start or end with a hyphen'
    }),
  siteName: ZSiteName
});

export type TCreateWorkspace = z.infer<typeof ZCreateWorkspace>;

export const ZWorkspaceIdParam = z.object({
  workspaceId: z.uuid()
});

export type TWorkspaceIdParam = z.infer<typeof ZWorkspaceIdParam>;
