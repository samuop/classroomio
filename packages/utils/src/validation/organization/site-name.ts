import { blockedSubdomain } from '../../constants/org';
import * as z from 'zod';

/**
 * El nombre del sitio de una empresa: la etiqueta que va delante del dominio
 * raiz (`<siteName>.<TENANT_ROOT_DOMAIN>`).
 *
 * ── Por que esto existe ──────────────────────────────────────────────────────
 *
 * Es una etiqueta DNS, no un texto libre, y hasta ahora se validaba como texto
 * libre: los tres caminos que crean una empresa (panel de plataforma,
 * onboarding y espacios de trabajo) pedian un largo minimo y que no empezara ni
 * terminara en guion. Nada mas. Asi entro `"Pinurasespeciales "` — mayuscula
 * inicial y un espacio al final — y la URL que se le muestra al operador es
 * `https://Pinurasespeciales .tensor.com.ar`, un host que no resuelve.
 *
 * No es solo cosmetico: ese valor es la ruta por la que el servidor decide a que
 * empresa pertenece una visita.
 *
 * ── Que se corrige solo y que se rechaza ─────────────────────────────────────
 *
 * Se recortan los espacios de los bordes y se pasa a minuscula, porque son
 * arreglos sin sorpresa: nadie escribio ese espacio a proposito y una mayuscula
 * en un host no significa nada.
 *
 * Un espacio EN EL MEDIO, un acento o un simbolo se rechazan en vez de
 * convertirse: convertir "Pinturas Especiales" en "pinturas-especiales" le daria
 * a la empresa una direccion que nadie eligio. Que lo elija quien crea, con el
 * formulario mostrandole el resultado mientras escribe.
 */
export const SITE_NAME_MIN_LENGTH = 3;
export const SITE_NAME_MAX_LENGTH = 63;

/** Minusculas y numeros, separados por guiones simples. Sin guion al principio ni al final. */
export const SITE_NAME_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const ZSiteName = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(
    z
      .string()
      .min(SITE_NAME_MIN_LENGTH, { message: 'validations.site_name.too_short' })
      .max(SITE_NAME_MAX_LENGTH, { message: 'validations.site_name.too_long' })
      .regex(SITE_NAME_REGEX, { message: 'validations.site_name.format' })
      // Un cliente que se llame `app` o `www` se comeria un host de la propia
      // plataforma. Antes esto solo se miraba al crear un espacio de trabajo.
      .refine((value) => !blockedSubdomain.includes(value), { message: 'validations.site_name.reserved' })
  );

/**
 * Lleva un nombre libre a un nombre de sitio valido, para proponerlo en el
 * formulario. No garantiza que este libre: eso lo resuelve la base.
 */
export function toSiteName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SITE_NAME_MAX_LENGTH)
    .replace(/-+$/g, '');
}
