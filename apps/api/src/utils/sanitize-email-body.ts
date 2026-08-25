import DOMPurify from 'isomorphic-dompurify';

/**
 * Sanea el HTML que un admin escribió para un correo.
 *
 * Lista blanca chica y propia, no la de las lecciones: un correo se abre en
 * Gmail, Outlook y una docena de clientes que interpretan HTML de formas
 * distintas y viejas. Lo que allá es una imagen incrustada, acá puede ser un
 * agujero — o, más probable, un correo roto.
 *
 * Nada de `script`, `style`, `iframe`, `form` ni atributos `on*`: un correo no
 * ejecuta nada, y un cliente que sí lo intente es exactamente el que no hay que
 * alimentar. `target` y `rel` se fuerzan del lado de la plantilla.
 */
const ETIQUETAS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'blockquote', 'span'];

const ATRIBUTOS = ['href', 'title'];

export function sanitizeEmailBody(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ETIQUETAS,
    ALLOWED_ATTR: ATRIBUTOS,
    // `mailto:` y `https:` alcanzan. `javascript:` y `data:` en un enlace de
    // correo no tienen ningun uso legitimo.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
    KEEP_CONTENT: true
  });
}
