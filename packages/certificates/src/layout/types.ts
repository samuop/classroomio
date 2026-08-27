/**
 * La plantilla propia: la imagen de certificado que trae quien la diseñó, más
 * la lista de campos que la plataforma imprime encima.
 *
 * ES DELIBERADAMENTE MÁS CHICO QUE EL LIENZO LIBRE (`document/`), que ya se
 * intentó y no cerró nunca. Aquel dejaba agregar, borrar y apilar elementos
 * cualesquiera, así que había que rediseñar un certificado entero desde cero
 * para obtener uno que se viera bien, y cualquier combinación podía quedar
 * rota sin que nada lo dijera.
 *
 * Acá el conjunto de campos es CERRADO: no se agrega nada, sólo se mueve,
 * se muestra o se oculta lo que el certificado siempre tuvo. Es la diferencia
 * entre una herramienta de diseño y un formulario de ubicación, y es lo único
 * que hace que no se pueda romper.
 *
 * Se guarda esto, chico, y se DIBUJA compilándolo al `CertificateDocument`, que
 * ya está escrito y probado. Así el render, el PDF y el PNG no se enteran.
 */

/**
 * Todo lo que un certificado puede imprimir. Cerrado a propósito.
 *
 * Un id que no esté acá no se dibuja: es lo que impide que una fila vieja o un
 * cliente equivocado metan un elemento arbitrario en un documento que la
 * plataforma emite en nombre de quien enseña.
 */
export const CERTIFICATE_FIELD_IDS = [
  'recipientName',
  'courseName',
  'courseDescription',
  'orgName',
  'clientName',
  'date',
  'certificateId',
  'signatoryOneImage',
  'signatoryOneName',
  'signatoryOneRole',
  'signatoryTwoImage',
  'signatoryTwoName',
  'signatoryTwoRole',
  'orgLogo',
  'clientLogo'
] as const;

export type CertificateFieldId = (typeof CERTIFICATE_FIELD_IDS)[number];

/** Los que son imagen y no texto: se ubican igual, pero no se les da tipografía. */
export const CERTIFICATE_IMAGE_FIELD_IDS = [
  'signatoryOneImage',
  'signatoryTwoImage',
  'orgLogo',
  'clientLogo'
] as const satisfies readonly CertificateFieldId[];

export function isImageField(id: CertificateFieldId): boolean {
  return (CERTIFICATE_IMAGE_FIELD_IDS as readonly CertificateFieldId[]).includes(id);
}

/**
 * Dónde va un campo y cómo se ve.
 *
 * La caja está en unidades del lienzo de 1100x780 — las mismas que usan el
 * documento, la vista previa y el viewport del PNG, así que un número significa
 * lo mismo en los tres lados y no hay ningún escalado que equivocar.
 */
export interface CertificateFieldPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Ausente = se imprime. Es al revés de lo intuitivo a propósito: un campo que
   * no está en el layout guardado cae a su ubicación por defecto y SE VE, en
   * lugar de desaparecer. Un campo nuevo que agreguemos mañana aparece solo en
   * los certificados ya diseñados, en vez de faltar en silencio.
   */
  hidden?: boolean;
  /** Sólo para los campos de texto; en los de imagen se ignora. */
  fontSize?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  italic?: boolean;
  uppercase?: boolean;
  /** Familia tipográfica; tiene que estar entre las que el PDF ya carga. */
  fontFamily?: string;
}

export interface CertificateLayout {
  /**
   * La imagen del certificado, a página completa detrás de todo.
   *
   * Es lo que trae quien diseñó el certificado en otro lado. Ausente = fondo
   * liso del color de `backgroundColor`, que sirve para empezar a ubicar antes
   * de tener la imagen final.
   */
  backgroundUrl?: string;
  backgroundColor?: string;
  /**
   * Si la imagen de fondo es clara u oscura. Por defecto, clara.
   *
   * Con las seis plantillas esto lo sabía la plantilla; con una imagen que
   * subís vos, no lo sabe nadie. Manda tres cosas a la vez: el color del texto
   * por defecto, si un logo monocromo hay que invertirlo, y si la firma
   * escaneada se dibuja en oscuro o en claro.
   */
  backgroundTone?: 'light' | 'dark';
  /** Sólo los campos que se movieron; el resto cae a su ubicación por defecto. */
  fields?: Partial<Record<CertificateFieldId, CertificateFieldPlacement>>;
}
