import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../document/types';
import type { CertificateFieldId, CertificateFieldPlacement } from './types';

/**
 * Dónde arranca cada campo antes de que nadie lo mueva.
 *
 * No es una plantilla: es un punto de partida razonable sobre una hoja en
 * blanco, para que quien sube su propia imagen de fondo encuentre los campos ya
 * puestos y sólo tenga que correrlos. Empezar con quince cajas apiladas en el
 * 0,0 hace que la primera pantalla parezca rota.
 *
 * Las cajas están en unidades del lienzo (${CANVAS_WIDTH}x${CANVAS_HEIGHT}), las
 * mismas del documento y del PNG exportado.
 */
export const DEFAULT_FIELD_PLACEMENTS: Record<CertificateFieldId, CertificateFieldPlacement> = {
  orgLogo: { x: 475, y: 40, w: 150, h: 56 },
  clientLogo: { x: 890, y: 40, w: 140, h: 50 },

  orgName: { x: 300, y: 106, w: 500, h: 24, fontSize: 13, align: 'center', uppercase: true },
  clientName: { x: 300, y: 132, w: 500, h: 22, fontSize: 12, align: 'center', uppercase: true },

  courseName: { x: 150, y: 178, w: 800, h: 84, fontSize: 34, align: 'center', bold: true },
  recipientName: { x: 110, y: 296, w: 880, h: 88, fontSize: 54, align: 'center' },
  courseDescription: { x: 220, y: 406, w: 660, h: 54, fontSize: 15, align: 'center', italic: true },

  signatoryOneImage: { x: 150, y: 556, w: 200, h: 62 },
  signatoryOneName: { x: 130, y: 626, w: 240, h: 26, fontSize: 16, align: 'center' },
  signatoryOneRole: { x: 130, y: 652, w: 240, h: 20, fontSize: 11, align: 'center', uppercase: true },

  signatoryTwoImage: { x: 750, y: 556, w: 200, h: 62 },
  signatoryTwoName: { x: 730, y: 626, w: 240, h: 26, fontSize: 16, align: 'center' },
  signatoryTwoRole: { x: 730, y: 652, w: 240, h: 20, fontSize: 11, align: 'center', uppercase: true },

  date: { x: 80, y: 702, w: 320, h: 22, fontSize: 12, align: 'left' },
  certificateId: { x: 700, y: 702, w: 320, h: 22, fontSize: 12, align: 'right' }
};

/**
 * Lo guardado por encima del default, campo por campo.
 *
 * Se mezcla en lugar de reemplazar por la razón de siempre en este archivo: un
 * campo que agreguemos mañana aparece en su lugar por defecto dentro de los
 * certificados ya diseñados, en vez de faltar sin que nada lo diga.
 */
export function resolveFieldPlacement(
  id: CertificateFieldId,
  stored: CertificateFieldPlacement | undefined
): CertificateFieldPlacement {
  return { ...DEFAULT_FIELD_PLACEMENTS[id], ...(stored ?? {}) };
}
