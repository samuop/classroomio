import { getDefaultTemplate } from '../templates/default';

/**
 * Un correo automático, escrito en bloques en vez de en HTML.
 *
 * Antes el admin editaba el documento entero: `<!doctype html>`, tablas de 600px
 * y estilos en línea. Eso no es editable por alguien que no escribe HTML, y para
 * quien sí sabe tampoco tiene sentido — una llave de más y el correo sale roto
 * en la bandeja de trescientas personas, sin ningún error que lo avise.
 *
 * Acá el admin escribe **texto**, y el servidor lo mete en el mismo diseño de
 * siempre. Es el modelo de SaaS-RRHH (`backend/src/lib/emailTemplate.ts`), y el
 * motivo de copiarlo es que ya está probado con gente que no programa.
 */
export interface EmailBlocks {
  /** Lo que se ve en la bandeja de entrada. Texto plano, sin HTML. */
  subject: string;
  /** Título grande adentro del correo. Vacío = sin título. */
  heading: string;
  /** El mensaje. Texto plano: línea en blanco = párrafo nuevo. */
  body: string;
  /** Texto del botón. **Vacío = el correo sale sin botón**, y es una elección válida. */
  ctaLabel: string;
  /** A dónde va el botón. Casi siempre una variable, ej. `{inviteLink}`. */
  ctaUrl: string;
  /** Nota chica al final. Vacío = sin nota. */
  footer: string;
}

export const EMAIL_BLOCK_KEYS = ['subject', 'heading', 'body', 'ctaLabel', 'ctaUrl', 'footer'] as const;

export type EmailBlockKey = (typeof EMAIL_BLOCK_KEYS)[number];

/** Tope por bloque. Generosos, pero un cuerpo de 200 kB no es un correo. */
export const EMAIL_BLOCK_LIMITS: Record<EmailBlockKey, number> = {
  subject: 200,
  heading: 300,
  body: 5000,
  ctaLabel: 80,
  ctaUrl: 500,
  footer: 1000
};

export const EMPTY_BLOCKS: EmailBlocks = {
  subject: '',
  heading: '',
  body: '',
  ctaLabel: '',
  ctaUrl: '',
  footer: ''
};

const FONT_STACK = 'Arial,Helvetica,sans-serif';
const TEXT_COLOR = '#3D3A45';
const MUTED_COLOR = '#8A8694';

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string
  );
}

/**
 * Reemplaza `{variable}` por su valor.
 *
 * `escape` va en `true` para todo lo que termina adentro del HTML: los valores
 * son datos de gente —el nombre de un alumno, el título de un curso— y un curso
 * llamado `<script>` no puede convertirse en etiqueta. En el asunto va en
 * `false`, porque el asunto NO es HTML: escaparlo ahí haría que "Ventas &
 * Marketing" llegue como "Ventas &amp;amp; Marketing" a la vista de todos.
 *
 * Una variable que no exista se deja tal cual, visible: que el admin vea
 * `{cursoo}` en la vista previa y lo corrija es mejor que un hueco silencioso.
 */
function interpolar(texto: string, fields: Record<string, unknown>, escape: boolean): string {
  return texto.replace(/\{(\w+)\}/g, (original, nombre: string) => {
    if (!(nombre in fields)) return original;

    const valor = fields[nombre];
    if (valor === null || valor === undefined) return '';

    return escape ? escapeHtml(String(valor)) : String(valor);
  });
}

/**
 * `*negrita*` → `<strong>`.
 *
 * Es el único formato que hay, y existe por un motivo concreto: los textos de
 * fábrica ya usaban negrita para el nombre del curso y la fecha de vencimiento.
 * Sin esto, pasar a texto plano sería perder eso en los catorce correos.
 *
 * Se aplica DESPUÉS de escapar y ANTES de interpolar, así un alumno que se
 * llame `*Ana*` no puede meter etiquetas en el correo de los demás.
 */
function aplicarNegrita(html: string): string {
  return html.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
}

const PARRAFO = `margin:0 0 16px 0;font-size:15px;line-height:1.65;color:${TEXT_COLOR};`;

/** Línea en blanco = párrafo nuevo; salto simple = `<br/>`. */
function cuerpoAHtml(cuerpo: string): string {
  return (
    cuerpo
      .split(/\n\s*\n/)
      .map((parrafo) => parrafo.trim())
      // Un párrafo que quedó vacío después de interpolar era una variable
      // opcional sin valor (`{courseLine}` cuando no hay cursos). Se cae solo, en
      // vez de dejar un hueco.
      .filter((parrafo) => parrafo !== '')
      .map((parrafo) => `<p style="${PARRAFO}">${parrafo.replace(/\n/g, '<br/>')}</p>`)
      .join('\n')
  );
}

/**
 * El botón sólo sale si la URL quedó siendo una URL.
 *
 * Después de interpolar, `{inviteLink}` puede haber quedado vacío (variable que
 * no llegó) o ser cualquier cosa que el admin haya escrito a mano. Un `href`
 * con `javascript:` adentro de un correo es una trampa que viaja con el correo,
 * así que lo que no empiece con http(s) no se dibuja.
 */
function urlSegura(url: string): string | null {
  const limpia = url.trim();

  return /^https?:\/\/[^\s]+$/i.test(limpia) ? limpia : null;
}

export interface RenderBlocksOptions {
  /** Quién firma — la organización, cuando la hay. */
  sender?: string | null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
}

/** Arma el correo completo: bloques + datos → asunto y HTML listos para enviar. */
export function renderEmailBlocks(
  blocks: EmailBlocks,
  fields: Record<string, unknown>,
  options: RenderBlocksOptions = {}
): RenderedEmail {
  const partes: string[] = [];

  const heading = interpolar(aplicarNegrita(escapeHtml(blocks.heading.trim())), fields, true);
  if (heading) {
    partes.push(
      `<h1 style="margin:0 0 18px 0;font-family:${FONT_STACK};font-size:21px;line-height:1.35;font-weight:bold;color:${TEXT_COLOR};">${heading}</h1>`
    );
  }

  const cuerpo = interpolar(aplicarNegrita(escapeHtml(blocks.body)), fields, true);
  if (cuerpo.trim()) partes.push(cuerpoAHtml(cuerpo));

  const etiqueta = interpolar(escapeHtml(blocks.ctaLabel.trim()), fields, true);
  const destino = urlSegura(interpolar(blocks.ctaUrl, fields, false));
  if (etiqueta && destino) {
    partes.push(
      `<div style="margin:26px 0 6px 0;"><a class="button" href="${escapeHtml(destino)}">${etiqueta}</a></div>`
    );
  }

  const pie = interpolar(aplicarNegrita(escapeHtml(blocks.footer.trim())), fields, true);
  if (pie) {
    partes.push(
      `<p style="margin:26px 0 0 0;font-size:12px;line-height:1.6;color:${MUTED_COLOR};">${pie.replace(/\n/g, '<br/>')}</p>`
    );
  }

  return {
    subject: interpolar(blocks.subject, fields, false).trim(),
    html: getDefaultTemplate(partes.join('\n'), { sender: options.sender })
  };
}
