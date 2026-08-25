import { EMAIL_ACCENT_COLOR, EMAIL_ACCENT_COLOR_2, EMAIL_BRAND_NAME } from '../utils/constants';

/**
 * Layout de los correos transaccionales.
 *
 * Es el mismo que usa SaaS-RRHH (`backend/src/lib/emailTemplate.ts`) — tabla de
 * 600px, barra de acento arriba, tarjeta blanca y pie fijo — para que los dos
 * productos del ecosistema se vean como una sola cosa cuando le llegan a la
 * misma persona.
 *
 * **Todo va con estilos en línea, sin bloque `<style>`.** Acá había uno con una
 * docena de clases: Gmail lo descarta al reenviar un correo y Outlook lo
 * respeta a medias, así que el botón llegaba como un link celeste y el diseño
 * dependía del cliente de correo que tuviera cada uno. Los estilos en línea son
 * lo único que todos los webmails respetan.
 *
 * Los colores salen del entorno (`EMAIL_ACCENT_COLOR`, `EMAIL_ACCENT_COLOR_2`)
 * para que cada despliegue del ecosistema pueda tener su acento sin tocar
 * código, con el violeta de EGEA como default compartido.
 */

/** Fuente todo terreno: Arial es la única que no se sustituye en ningún webmail. */
const FONT_STACK = 'Arial,Helvetica,sans-serif';

const TEXT_COLOR = '#3D3A45';
const MUTED_COLOR = '#8A8694';
const PAGE_BACKGROUND = '#F1EDF6';

const PARAGRAPH_STYLE = `margin:0 0 16px 0;font-size:15px;line-height:1.65;color:${TEXT_COLOR};`;

const BUTTON_STYLE =
  `display:inline-block;padding:13px 34px;font-family:${FONT_STACK};font-size:15px;` +
  `font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;` +
  // El degradado primero y el color plano después: Outlook ignora el gradiente y
  // se queda con `background-color`, así que el botón nunca sale transparente.
  `background:linear-gradient(135deg,${EMAIL_ACCENT_COLOR} 0%,${EMAIL_ACCENT_COLOR_2} 100%);` +
  `background-color:${EMAIL_ACCENT_COLOR};`;

/**
 * Pasa a estilos en línea el HTML suelto que escribe cada correo.
 *
 * Las definiciones de `emails/` escriben `<p>` y `<a class="button">` sin
 * estilos, contando con el bloque `<style>` que ya no existe. En vez de
 * reescribir los diecisiete archivos, el layout se hace cargo de vestirlos: la
 * definición pone el texto, la plantilla pone la presentación.
 *
 * Sólo toca las etiquetas que no traen `style` propio, así un correo puede
 * seguir imponiendo el suyo cuando lo necesite.
 */
function inlineContentStyles(content: string): string {
  return content
    .replace(/<p(?![^>]*\sstyle=)([^>]*)>/gi, `<p$1 style="${PARAGRAPH_STYLE}">`)
    .replace(/<a\s+class="button"([^>]*?)>/gi, `<a$1 style="${BUTTON_STYLE}">`)
    .replace(/<a([^>]*?)\sclass="button"([^>]*?)>/gi, `<a$1$2 style="${BUTTON_STYLE}">`);
}

export interface DefaultTemplateOptions {
  /**
   * Quién firma el correo — la organización, cuando la hay. Aparece como
   * antetítulo arriba del título y en el pie, igual que en SaaS-RRHH.
   */
  sender?: string | null;
}

/** Escapa lo que se interpola en contexto HTML desde afuera de la plantilla. */
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string
  );
}

export const getDefaultTemplate = (content: string, options: DefaultTemplateOptions = {}): string => {
  const sender = options.sender?.trim() || '';
  const senderHtml = sender
    ? `<p style="margin:0 0 20px 0;font-size:12px;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;color:${EMAIL_ACCENT_COLOR};">${escapeHtml(sender)}</p>`
    : '';

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <base target="_blank"/>
</head>
<body style="margin:0;padding:0;background-color:${PAGE_BACKGROUND};font-family:${FONT_STACK};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAGE_BACKGROUND};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
          <!-- Barra de acento -->
          <tr>
            <td style="height:5px;border-radius:12px 12px 0 0;background:linear-gradient(90deg,${EMAIL_ACCENT_COLOR} 0%,${EMAIL_ACCENT_COLOR_2} 100%);background-color:${EMAIL_ACCENT_COLOR};font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <!-- Tarjeta principal -->
          <tr>
            <td style="background-color:#ffffff;border-radius:0 0 12px 12px;padding:36px 40px 32px 40px;font-family:${FONT_STACK};font-size:15px;line-height:1.65;color:${TEXT_COLOR};">
              ${senderHtml}
              ${inlineContentStyles(content)}
            </td>
          </tr>
          <!-- Pie -->
          <tr>
            <td style="padding:18px 8px 0 8px;text-align:center;">
              <p style="margin:0;font-size:11px;line-height:1.6;color:${MUTED_COLOR};">
                ${sender ? `Correo enviado por ${escapeHtml(sender)} · ` : ''}${escapeHtml(EMAIL_BRAND_NAME)} ${new Date().getFullYear()}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
};
