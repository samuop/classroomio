/**
 * El enlace que pega el docente casi nunca es el que se puede incrustar.
 *
 * Medido con presentaciones públicas reales dentro de la lección:
 * - Google Slides, enlace de «Compartir» (`/edit?usp=sharing`): se ve, pero con
 *   el editor de Google alrededor (Acceder, Archivo, miniaturas). `/present` ni
 *   siquiera se deja mostrar. `/preview` es la misma presentación, limpia.
 * - Los enlaces de «Publicar en la web» (`/d/e/…/embed` o `/pub`) ya vienen
 *   pensados para incrustar y quedan como están.
 * - Canva sólo se deja mostrar con `?embed`. El enlace que copia el docente
 *   trae `?utm_content=…`, y pegarle `?embed` al final — lo que se hacía antes —
 *   dejaba una dirección con dos `?` que Canva no reconoce.
 *
 * Todo lo demás pasa sin tocar: puede ser un sitio que el operador habilitó en
 * la política de seguridad. Lo que no es `http(s)` no pasa: un `javascript:` en
 * el `src` de un iframe corre con el origen de la plataforma.
 */

export type ProveedorDeDiapositivas = 'google' | 'canva' | 'otro';

export interface DiapositivaIncrustable {
  url: string;
  proveedor: ProveedorDeDiapositivas;
}

/** `/presentation/d/<id>` con o sin `/edit` o `/present`, y con o sin `/u/<n>` de la cuenta. */
const PRESENTACION_DE_GOOGLE = /^\/presentation(?:\/u\/\d+)?\/d\/([\w-]+)(?:\/(?:edit|present))?\/?$/;

/** `/design/<id>`, con o sin el código de acceso, terminado en `/view`, `/edit` o `/watch`. */
const DISENO_DE_CANVA = /^\/design\/([\w-]+)(?:\/([\w-]+))?\/(?:view|edit|watch)\/?$/;

export function diapositivaIncrustable(enlace: string | null | undefined): DiapositivaIncrustable | null {
  const texto = enlace?.trim();
  if (!texto) return null;

  let direccion: URL;

  try {
    direccion = new URL(texto);
  } catch {
    return null;
  }

  if (direccion.protocol !== 'https:' && direccion.protocol !== 'http:') return null;

  const host = direccion.hostname.toLowerCase();

  if (host === 'docs.google.com' && direccion.pathname.startsWith('/presentation/')) {
    // Una publicación (`/d/e/<id>/embed` o `/pub`) no coincide con el patrón y pasa tal cual.
    const compartida = direccion.pathname.match(PRESENTACION_DE_GOOGLE);

    if (compartida) {
      return { url: `https://docs.google.com/presentation/d/${compartida[1]}/preview`, proveedor: 'google' };
    }

    return { url: texto, proveedor: 'google' };
  }

  if (host === 'www.canva.com' || host === 'canva.com') {
    const diseno = direccion.pathname.match(DISENO_DE_CANVA);

    if (diseno) {
      const acceso = diseno[2] ? `/${diseno[2]}` : '';
      return { url: `https://www.canva.com/design/${diseno[1]}${acceso}/view?embed`, proveedor: 'canva' };
    }

    return { url: texto, proveedor: 'canva' };
  }

  return { url: texto, proveedor: 'otro' };
}
