/**
 * De la plantilla propia al documento que ya se sabe dibujar.
 *
 * Un `CertificateLayout` guarda MUY poco: la imagen de fondo y, por campo, una
 * caja. Este archivo lo convierte en el `CertificateDocument` que
 * `renderDocument` ya sabe imprimir — con su motor de ajuste de texto, su
 * escapado y su salida a PDF, todo ya probado.
 *
 * Que la conversión sea de ida y en el momento de dibujar es el punto: en la
 * base queda el objeto chico y cerrado, no un documento con elementos
 * arbitrarios. Una fila corrupta puede describir un campo mal ubicado; no puede
 * meter un elemento que nadie diseñó.
 */
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../document/types';
import type { CertificateDocument, CertificateElement, TextFit } from '../document/types';
import type { CertificateDesign } from '../types';
import { DEFAULT_FIELD_PLACEMENTS, resolveFieldPlacement } from './defaults';
import { CERTIFICATE_FIELD_IDS, isImageField, type CertificateFieldId, type CertificateLayout } from './types';

/** Lo que imprime cada campo de texto, en tokens que resuelve `substituteBindings`. */
const FIELD_CONTENT: Record<string, string> = {
  recipientName: '{{recipientName}}',
  courseName: '{{courseName}}',
  courseDescription: '{{courseDescription}}',
  orgName: '{{orgName}}',
  clientName: '{{clientName}}',
  date: '{{date}}',
  certificateId: '{{certificateId}}',
  signatoryOneName: '{{signatoryOneName}}',
  signatoryOneRole: '{{signatoryOneRole}}',
  signatoryTwoName: '{{signatoryTwoName}}',
  signatoryTwoRole: '{{signatoryTwoRole}}'
};

/**
 * Qué hace cada campo cuando su contenido no entra.
 *
 * Es lo que hace segura la ubicación libre. Un nombre se ACHICA hasta entrar —
 * "Ana Ruiz" y "María de los Ángeles Fernández Etchegaray" van en la misma
 * caja. Una descripción se CORTA, porque bajarla a 9pt sería peor que dejarla
 * suspendida. Nada se desborda sobre lo que tiene al lado.
 */
const FIELD_FIT: Record<string, TextFit> = {
  courseDescription: 'clamp'
};

const DEFAULT_FONT = 'Cormorant Garamond';

/** Tinta por defecto: la que se lee sobre el fondo que declaró quien diseñó. */
function defaultInk(tone: 'light' | 'dark'): string {
  return tone === 'dark' ? '#f2efe9' : '#1a1a1a';
}

export interface LayoutBuildInput {
  layout: CertificateLayout;
  design: CertificateDesign;
}

export function buildLayoutDocument({ layout, design }: LayoutBuildInput): CertificateDocument {
  const tone = layout.backgroundTone ?? 'light';
  const ink = defaultInk(tone);
  const elements: CertificateElement[] = [];

  for (const id of CERTIFICATE_FIELD_IDS) {
    const placement = resolveFieldPlacement(id, layout.fields?.[id]);
    if (placement.hidden) continue;

    const caja = { id: `field:${id}`, x: placement.x, y: placement.y, w: placement.w, h: placement.h };

    if (isImageField(id)) {
      const imagen = buildImageElement(id, caja, design, tone);
      if (imagen) elements.push(imagen);
      continue;
    }

    elements.push({
      ...caja,
      kind: 'text',
      // `descriptionOverride` gana sobre el texto del curso, igual que en las
      // plantillas fijas: una sola fuente de verdad para las dos vías.
      content:
        id === 'courseDescription' && design.descriptionOverride?.trim()
          ? design.descriptionOverride
          : (FIELD_CONTENT[id] ?? ''),
      fit: FIELD_FIT[id] ?? 'shrink',
      minFontSize: 9,
      maxLines: id === 'courseDescription' ? 4 : 3,
      style: {
        fontFamily: placement.fontFamily ?? DEFAULT_FONT,
        fontSize: placement.fontSize ?? 16,
        fontWeight: placement.bold ? 700 : 400,
        lineHeight: 1.2,
        letterSpacing: placement.uppercase ? 2 : 0,
        color: placement.color ?? ink,
        italic: placement.italic,
        uppercase: placement.uppercase,
        align: placement.align ?? 'center',
        verticalAlign: 'middle'
      }
    });
  }

  return {
    version: 2,
    canvas: {
      color: layout.backgroundColor ?? (tone === 'dark' ? '#111111' : '#ffffff'),
      ...(layout.backgroundUrl ? { imageUrl: layout.backgroundUrl } : {})
    },
    elements
  };
}

function buildImageElement(
  id: CertificateFieldId,
  caja: { id: string; x: number; y: number; w: number; h: number },
  design: CertificateDesign,
  tone: 'light' | 'dark'
): CertificateElement | null {
  const base = {
    ...caja,
    kind: 'image' as const,
    fit: 'contain' as const,
    // Un curso sin logo de cliente no tiene que imprimir el ícono de imagen rota
    // en cada certificado que emite.
    hideWhenEmpty: true
  };

  if (id === 'orgLogo' || id === 'clientLogo') {
    const marca = id === 'orgLogo' ? design.orgBrand : design.clientBrand;

    return {
      ...base,
      source: { kind: id === 'orgLogo' ? 'orgLogo' : 'clientLogo' },
      // La MISMA comparación que hacen las plantillas fijas: se invierte cuando
      // la tinta del archivo coincide con el papel. Acá el papel lo declaró
      // quien subió el fondo, porque nadie más lo puede saber.
      ...(marca?.logoTone && marca.logoTone === tone ? { invert: true } : {})
    };
  }

  const firmante = design.signatories[id === 'signatoryOneImage' ? 0 : 1];
  if (!firmante?.imageUrl) return null;

  return {
    ...base,
    source: { kind: 'upload', url: firmante.imageUrl },
    // Una firma siempre es tinta oscura, así que sobre fondo oscuro va invertida
    // sin preguntar. Ver `renderSignatureImage`.
    ...(tone === 'dark' ? { invert: true } : {}),
    ...(firmante.imageHasBackground ? { knockoutBackground: true } : {})
  };
}

/** El lienzo sobre el que se ubica todo, para que el editor no lo repita. */
export const LAYOUT_CANVAS = { width: CANVAS_WIDTH, height: CANVAS_HEIGHT } as const;

export { DEFAULT_FIELD_PLACEMENTS, resolveFieldPlacement };
