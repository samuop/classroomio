import type { CertificateDocument } from './document/types';
import type { CertificateLayout } from './layout/types';

export const CERTIFICATE_TEMPLATE_IDS = ['classique', 'diploma', 'brutalist', 'noir', 'poster', 'minimal'] as const;
export type CertificateTemplateId = (typeof CERTIFICATE_TEMPLATE_IDS)[number];

export interface CertificateSignatory {
  name: string;
  role: string;
  /**
   * La firma escaneada, impresa sobre la línea. Ausente = sólo nombre y cargo,
   * que es como se veian todos los certificados hasta ahora.
   */
  imageUrl?: string;
  /**
   * `true` cuando el archivo trae fondo BLANCO en vez de transparente — una
   * foto o un escaneo, que es lo que tiene la mayoría.
   *
   * Se declara el archivo por la misma razón que `CertificateLogoTone`: la
   * plantilla sabe sobre qué papel imprime y quien firma no. Un rectángulo
   * blanco sobre el crema de classique se ve como un parche, y sobre `noir` es
   * un bloque que tapa medio pie de página.
   */
  imageHasBackground?: boolean;
  /** Alto impreso de la firma, en px de lienzo. Cada plantilla lo limita. */
  imageHeight?: number;
  /**
   * Cuánto se levanta sobre el renglón, en px.
   *
   * Existe porque una firma escaneada trae su propio aire: un recorte ajustado
   * queda flotando y una foto con margen queda hundida, y eso depende del
   * archivo, no de la plantilla. Negativo la baja hasta cruzar la línea, que es
   * lo que hace una firma de verdad.
   */
  imageOffset?: number;
}

/**
 * The fixed wording each template prints around the variable data.
 *
 * These used to be literals inside the templates, which made them both
 * uneditable and untranslatable: a Spanish certificate still read "— this is to
 * certify that —" over the recipient's name, and nothing in the editor could
 * change it. Every field is optional; a template falls back to
 * `DEFAULT_CERTIFICATE_LABELS` for anything not set.
 */
export interface CertificateLabels {
  /** Line above the recipient's name: "— se certifica que —". */
  presented?: string;
  /**
   * Line below the recipient's name, introducing the course: "ha completado
   * satisfactoriamente".
   *
   * Only layouts that name the person before the course have somewhere to print
   * this; the ones that lead with the course title do not.
   */
  completed?: string;
  /** Heading over the recipient in grid layouts: "Otorgado a". */
  awardedTo?: string;
  /** Key for the issue date. */
  issued?: string;
  /** Key for the certificate number. */
  reference?: string;
  /** Key for the award/course name in the metadata row. */
  award?: string;
  /** Key for the distinction level. */
  distinction?: string;
  /** Word stamped on the seal or medal. */
  seal?: string;
  /**
   * Caption over the issuing organisation's mark ("Dictado por").
   *
   * Empty by default, unlike every other label: two logos side by side is how
   * certificates normally carry a consultancy and its client, and a caption is
   * an addition a teacher opts into rather than wording they have to clear.
   */
  deliveredBy?: string;
  /** Caption over the client company's mark ("Para"). Empty by default. */
  deliveredFor?: string;
}

export type CertificateLabelKey = keyof CertificateLabels;

/**
 * De que color esta hecho el archivo del logo, no de que color queremos verlo.
 *
 * Un lock-up monocromo se sube una sola vez y tiene que servir para las seis
 * plantillas, pero cinco imprimen sobre papel claro y `noir` sobre casi negro:
 * el mismo PNG de letras blancas es invisible en una y perfecto en la otra.
 *
 * Por eso lo que se declara es el ARCHIVO (`light` = tinta clara, `dark` =
 * tinta oscura) y la plantilla decide si hay que invertirlo. Un interruptor de
 * "poner el logo en negro" habria obligado a acordarse de apagarlo justo al
 * probar Noir, que es exactamente el momento en que nadie se acuerda.
 *
 * Sin declarar no se toca nada: es lo correcto para un logo a color — invertir
 * uno arruina la marca — y deja idénticos los certificados ya emitidos.
 */
export type CertificateLogoTone = 'light' | 'dark';

/**
 * One of the marks a certificate is issued under.
 *
 * A consultancy issues the same certificate under two of them — its own and the
 * client company it trained — and before this there was room for neither: no
 * template drew a logo at all, `orgLogoUrl` was carried all the way to the
 * renderer and never used, and the organisation was a line of plain text.
 *
 * Both live on the course's design, because the same course run for two clients
 * is two courses with two marks.
 */
export interface CertificateBrand {
  name?: string;
  /** La tinta del archivo. Ver `CertificateLogoTone`. */
  logoTone?: CertificateLogoTone;
  /**
   * Must be a PUBLIC, stable URL: the page is fetched by Cloudflare's browser,
   * not ours, and a presigned URL would expire and silently strip the logo off
   * every certificate issued afterwards.
   *
   * An SVG is the right thing to upload here — it has no background to clash
   * with the certificate and stays sharp at export resolution.
   */
  logoUrl?: string;
}

/**
 * Dónde van las marcas (logo de la consultora y del cliente).
 *
 * Un conjunto CERRADO de huecos, y no coordenadas libres. El lienzo libre ya se
 * intentó y no cerró nunca (ver `CANVAS_EDITOR_ENABLED`): con posición libre,
 * cada logo que alguien sube es un ancho distinto y termina pisando el título o
 * las firmas. Dos huecos que cada plantilla diseña a propósito no se pueden
 * romper.
 *
 * `top` es arriba del título; `bottom`, en el pie junto a las firmas. Cada
 * plantilla trae su propio valor por defecto — el lugar donde ya las ponía —
 * así que un diseño que no elige nada se sigue viendo igual que siempre.
 */
export type CertificateBrandPlacement = 'top' | 'bottom';

export interface CertificateDesign {
  templateId: CertificateTemplateId;
  accentColor: string;
  subtitle?: string;
  descriptionOverride?: string;
  signatories: [CertificateSignatory, CertificateSignatory];
  idFormat?: string;
  labels?: CertificateLabels;
  /**
   * What the certificate calls the achievement, replacing the course title.
   *
   * A course is named for the people taking it ("Inducción SSMA 2026"); the
   * certificate is a document its holder shows to someone else, and often has
   * to read differently. Applied once, centrally, in `renderCertificate`, so
   * every template picks it up.
   */
  titleOverride?: string;
  /**
   * The issuing organisation's mark, overriding the workspace name and avatar.
   *
   * Separate from the org's own profile on purpose: the avatar is a square
   * bitmap sized for a nav bar, and a certificate wants the full lock-up —
   * usually a transparent SVG.
   */
  orgBrand?: CertificateBrand;
  /** The company the training was delivered for. Absent for most courses. */
  clientBrand?: CertificateBrand;
  /** Printed height of each logo in canvas pixels; templates cap it further. */
  brandLogoHeight?: number;
  /** Dónde se dibujan las marcas. Sin valor, cada plantilla usa el suyo. */
  brandPlacement?: CertificateBrandPlacement;
  /**
   * Print each mark's name under its logo as well.
   *
   * Off by default, because a wordmark already says the name and printing both
   * is the usual way a two-brand certificate ends up looking amateur. It is a
   * choice rather than a rule because that reasoning does not survive contact
   * with a real logo: an icon-only mark, or one whose lettering is unreadable
   * at certificate scale, needs the words next to it.
   */
  brandShowNames?: boolean;
  /**
   * La plantilla propia: la imagen que trajo quien diseñó el certificado, más
   * dónde se imprime cada campo encima.
   *
   * Cuando está, REEMPLAZA a la plantilla — `templateId` se queda en el diseño
   * como el preset del que salió, pero no lo lee nadie para dibujar. Ausente es
   * lo que tienen todos los cursos de hoy.
   *
   * No confundir con `document`, el lienzo libre aparcado: acá el conjunto de
   * campos es cerrado y sólo se ubican, no se crean.
   */
  layout?: CertificateLayout;
  /**
   * A free canvas layout. When present it REPLACES the template: `templateId`
   * stays on the design as the preset it started from, but nothing reads it for
   * rendering. Absent means this course still uses one of the five fixed
   * layouts, which is what every existing course does.
   *
   * Only read while {@link CANVAS_EDITOR_ENABLED} is on.
   */
  document?: CertificateDocument;
}

export interface CertificateRenderData {
  recipientName: string;
  courseName: string;
  courseDescription: string;
  orgName: string;
  orgLogoUrl?: string;
  date: string;
  certificateId: string;
}

export interface CertificateRenderResult {
  html: string;
  styles: string;
}

export interface CertificateTemplateMeta {
  id: CertificateTemplateId;
  label: string;
  description: string;
  /**
   * Which labels this template actually prints. The editor shows only these, so
   * a teacher is never asked to fill in wording that will not appear.
   */
  labels: CertificateLabelKey[];
  /**
   * Sobre que fondo imprime. Lo unico que decide si un logo monocromo hay que
   * invertirlo, y vive aca para que no haya que preguntar `id === 'noir'` en
   * cada lugar que dibuje o previsualice una marca.
   */
  surface: 'light' | 'dark';
}
