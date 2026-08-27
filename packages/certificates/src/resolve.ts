/**
 * Turn a stored `course.certificate` blob into a complete design.
 *
 * ── Why this is one function and not four ────────────────────────────────────
 *
 * A design is read out of a JSONB column by rebuilding it field by field, and
 * every place that did its own rebuild forgot a field. The API forgot `labels`,
 * so every teacher who customised the wording got a success toast and a PDF
 * with the defaults. The dashboard's summary card forgot `labels`,
 * `clientBrand`, `orgBrand` and `titleOverride`, so a certificate designed with
 * two marks was shown back to its author with one. Nothing errors, nothing
 * logs; the field is simply not there.
 *
 * A rebuild is unavoidable — the column is untrusted, and a URL out of it ends
 * up in an `<img src>` that Cloudflare's browser resolves on the platform's
 * behalf. What is avoidable is having more than one. Adding a design field
 * means editing THIS function, `ZCertificateDesign`, and the column's
 * `$type<>`, and nothing else.
 */
import { DEFAULT_CERTIFICATE_DESIGN, DEFAULT_CERTIFICATE_LABELS } from './constants';
import { resolveTemplateId } from './render';
import { CERTIFICATE_FIELD_IDS } from './layout/types';
import type { CertificateFieldId, CertificateFieldPlacement, CertificateLayout } from './layout/types';
import type {
  CertificateBrand,
  CertificateDesign,
  CertificateLabelKey,
  CertificateLabels,
  CertificateSignatory
} from './types';

/** These are short lines of chrome; an unbounded one just breaks its layout. */
const MAX_LABEL_LENGTH = 120;
const MAX_NAME_LENGTH = 120;
const MAX_TITLE_LENGTH = 160;
const MAX_URL_LENGTH = 2048;

export function resolveCertificateDesign(stored: unknown): CertificateDesign {
  const blob = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const legacyTheme = typeof blob.theme === 'string' ? blob.theme : undefined;
  const design =
    blob.design && typeof blob.design === 'object' ? (blob.design as Partial<CertificateDesign>) : undefined;

  const accentColor =
    design?.accentColor && /^#[0-9a-fA-F]{6}$/.test(design.accentColor)
      ? design.accentColor
      : DEFAULT_CERTIFICATE_DESIGN.accentColor;

  const storedSignatories = Array.isArray(design?.signatories) ? design?.signatories : undefined;

  return {
    templateId: resolveTemplateId(design?.templateId ?? legacyTheme),
    accentColor,
    subtitle: design?.subtitle ?? DEFAULT_CERTIFICATE_DESIGN.subtitle,
    descriptionOverride: design?.descriptionOverride,
    signatories: [sanitizeSignatory(storedSignatories?.[0], 0), sanitizeSignatory(storedSignatories?.[1], 1)],
    idFormat: design?.idFormat ?? DEFAULT_CERTIFICATE_DESIGN.idFormat,
    labels: sanitizeLabels(design?.labels),
    ...(typeof design?.titleOverride === 'string'
      ? { titleOverride: design.titleOverride.slice(0, MAX_TITLE_LENGTH) }
      : {}),
    ...(design?.orgBrand ? { orgBrand: sanitizeBrand(design.orgBrand) } : {}),
    ...(design?.clientBrand ? { clientBrand: sanitizeBrand(design.clientBrand) } : {}),
    ...(typeof design?.brandLogoHeight === 'number' && Number.isFinite(design.brandLogoHeight)
      ? { brandLogoHeight: design.brandLogoHeight }
      : {}),
    ...(typeof design?.brandShowNames === 'boolean' ? { brandShowNames: design.brandShowNames } : {}),
    // Tercer lugar donde hay que nombrar el campo, despues del tipo y de zod:
    // esta funcion reconstruye el diseno campo por campo, asi que lo que no
    // nombra se pierde entre la base y el renderer. Un valor invalido cae al
    // default de la plantilla en vez de dibujar nada raro.
    ...(design?.brandPlacement === 'top' || design?.brandPlacement === 'bottom'
      ? { brandPlacement: design.brandPlacement }
      : {}),
    // Cuarta capa que puede perder el campo, después del tipo, de zod y de la
    // columna: esta función reconstruye el diseño campo por campo.
    ...(design?.layout ? { layout: sanitizeLayout(design.layout) } : {}),
    ...(design?.document ? { document: design.document } : {})
  };
}

/**
 * La plantilla propia, en su camino a un `<img src>` y a coordenadas.
 *
 * `backgroundUrl` sale por la MISMA puerta que los logos: sólo `http(s)`. Y los
 * campos se filtran contra la lista cerrada, así que una clave que no
 * conocemos —de una fila vieja o de un cliente equivocado— no llega al
 * compilador en vez de convertirse en un elemento que nadie diseñó.
 */
function sanitizeLayout(stored: unknown): CertificateLayout | undefined {
  if (!stored || typeof stored !== 'object') return undefined;

  const raw = stored as {
    backgroundUrl?: unknown;
    backgroundColor?: unknown;
    backgroundTone?: unknown;
    fields?: unknown;
  };
  const backgroundUrl =
    typeof raw.backgroundUrl === 'string' && /^https?:\/\//i.test(raw.backgroundUrl)
      ? raw.backgroundUrl.slice(0, MAX_URL_LENGTH)
      : undefined;
  const fieldsRaw = raw.fields && typeof raw.fields === 'object' ? (raw.fields as Record<string, unknown>) : {};
  const fields: Partial<Record<CertificateFieldId, CertificateFieldPlacement>> = {};

  for (const id of CERTIFICATE_FIELD_IDS) {
    const caja = fieldsRaw[id];
    if (!caja || typeof caja !== 'object') continue;

    const { x, y, w, h } = caja as Record<string, unknown>;
    // Sin caja completa no hay ubicación que respetar: cae a su default en vez
    // de dibujarse en el 0,0.
    if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) continue;

    fields[id] = caja as CertificateFieldPlacement;
  }

  return {
    ...(backgroundUrl ? { backgroundUrl } : {}),
    ...(typeof raw.backgroundColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.backgroundColor)
      ? { backgroundColor: raw.backgroundColor }
      : {}),
    ...(raw.backgroundTone === 'light' || raw.backgroundTone === 'dark' ? { backgroundTone: raw.backgroundTone } : {}),
    ...(Object.keys(fields).length > 0 ? { fields } : {})
  };
}

/**
 * Quien firma, con su firma escaneada si la hay.
 *
 * `imageUrl` termina dentro de un `<img src>` igual que el logo de una marca,
 * así que pasa por la MISMA puerta: sólo `http(s)`. Un `javascript:` guardado
 * acá sería un script corriendo dentro de un documento que la plataforma emite
 * en nombre de quien enseña.
 */
function sanitizeSignatory(stored: unknown, indice: 0 | 1): CertificateSignatory {
  const raw = (stored && typeof stored === 'object' ? stored : {}) as {
    name?: unknown;
    role?: unknown;
    imageUrl?: unknown;
    imageHasBackground?: unknown;
    imageHeight?: unknown;
    imageOffset?: unknown;
  };
  const porDefecto = DEFAULT_CERTIFICATE_DESIGN.signatories[indice];
  const imageUrl =
    typeof raw.imageUrl === 'string' && /^https?:\/\//i.test(raw.imageUrl)
      ? raw.imageUrl.slice(0, MAX_URL_LENGTH)
      : undefined;

  return {
    name: typeof raw.name === 'string' ? raw.name : porDefecto.name,
    role: typeof raw.role === 'string' ? raw.role : porDefecto.role,
    ...(imageUrl ? { imageUrl } : {}),
    // Sin firma no hay fondo que describir: la bandera sola quedaría esperando
    // al próximo archivo que suba cualquier otro.
    ...(imageUrl && raw.imageHasBackground === true ? { imageHasBackground: true } : {}),
    // Las medidas tampoco: describen un archivo que no existe. El renderer las
    // acota igual, así que acá sólo importa que un valor raro no llegue.
    ...(imageUrl && typeof raw.imageHeight === 'number' && Number.isFinite(raw.imageHeight)
      ? { imageHeight: raw.imageHeight }
      : {}),
    ...(imageUrl && typeof raw.imageOffset === 'number' && Number.isFinite(raw.imageOffset)
      ? { imageOffset: raw.imageOffset }
      : {})
  };
}

/**
 * A brand mark, on its way into HTML a browser will fetch.
 *
 * The logo URL is written straight into an `<img src>`, so a stored
 * `javascript:` or `data:` value would be a script running inside a document
 * the platform issues on a teacher's behalf. The write path already rejects
 * those; this is the last gate before rendering, and rows predate any schema.
 */
export function sanitizeBrand(stored: unknown): CertificateBrand | undefined {
  if (!stored || typeof stored !== 'object') return undefined;

  const raw = stored as { name?: unknown; logoUrl?: unknown; logoTone?: unknown };
  const name = typeof raw.name === 'string' ? raw.name.slice(0, MAX_NAME_LENGTH) : undefined;
  const logoUrl =
    typeof raw.logoUrl === 'string' && /^https?:\/\//i.test(raw.logoUrl)
      ? raw.logoUrl.slice(0, MAX_URL_LENGTH)
      : undefined;
  // Cualquier otra cosa cae a "no declarada", que es no tocar el logo.
  const logoTone = raw.logoTone === 'light' || raw.logoTone === 'dark' ? raw.logoTone : undefined;

  // La tinta sola no es una marca: describe un logo que no existe.
  if (!name && !logoUrl) return undefined;

  return { ...(name ? { name } : {}), ...(logoUrl ? { logoUrl } : {}), ...(logoTone ? { logoTone } : {}) };
}

/**
 * The editor's custom wording, on its way to the real document.
 *
 * Anything that is not a known key with a string value is discarded rather than
 * handed to a template. An empty string is kept deliberately: `resolveLabels`
 * reads it as "print nothing here", which is not the same as falling back to
 * the default.
 */
export function sanitizeLabels(stored: unknown): CertificateLabels | undefined {
  if (!stored || typeof stored !== 'object') return undefined;

  const labels: CertificateLabels = {};

  for (const key of Object.keys(DEFAULT_CERTIFICATE_LABELS) as CertificateLabelKey[]) {
    const value = (stored as Record<string, unknown>)[key];

    if (typeof value === 'string') labels[key] = value.slice(0, MAX_LABEL_LENGTH);
  }

  return Object.keys(labels).length > 0 ? labels : undefined;
}
