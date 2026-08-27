import {
  CANVAS_EDITOR_ENABLED,
  CERTIFICATE_FIELD_IDS,
  DEFAULT_FIELD_PLACEMENTS,
  buildLayoutDocument,
  resolveFieldPlacement,
  DEFAULT_BRAND_LOGO_HEIGHT,
  DEFAULT_CERTIFICATE_DESIGN,
  DEFAULT_CERTIFICATE_LABELS,
  buildPresetDocument,
  resolveCertificateDesign,
  type BindingValues,
  type CertificateDesign,
  type CertificateDocument,
  type CertificateElement,
  type CertificateLabelKey,
  type CertificateFieldId,
  type CertificateFieldPlacement,
  type CertificateLabels,
  type CertificateLayout,
  type CertificateLogoTone,
  type CertificateRenderData,
  type CertificateTemplateId
} from '@cio/certificates';
import { measureTemplateAsDocument } from '../canvas/measure-template';

import { ZCertificateDesign, ZCertificationSettings } from '@cio/utils/validation/course';

import { courseApi } from '$features/course/api';
import { snackbar } from '$features/ui/snackbar/store';
import { t } from '$lib/utils/functions/translations';

export type CertificateEditorPanel = 'templates' | 'content' | 'element' | 'layout' | 'colors' | 'export';

/**
 * The store keeps optional fields as concrete strings so two-way bindings to
 * inputs are simple — we collapse empty strings to `undefined` only when
 * shipping a payload back to the API.
 */
export interface CertificateEditorSignatory {
  name: string;
  role: string;
  imageUrl: string;
  imageHasBackground: boolean;
  /** Alto impreso. `null` = como lo pone la plantilla. */
  imageHeight: number | null;
  /** Cuánto se levanta sobre el renglón. `null` = el de la plantilla. */
  imageOffset: number | null;
}

export interface CertificateEditorDraft {
  templateId: CertificateTemplateId;
  accentColor: string;
  subtitle: string;
  descriptionOverride: string;
  idFormat: string;
  /** What the certificate calls the achievement, in place of the course title. */
  titleOverride: string;
  /**
   * Quien firma. `imageUrl` es la firma escaneada; `imageHasBackground` marca
   * que el archivo trae fondo blanco (foto o escaneo) en vez de recorte, que es
   * lo que tiene la mayoría.
   */
  signatories: [CertificateEditorSignatory, CertificateEditorSignatory];
  /**
   * The fixed wording each template prints ("se certifica que", "Otorgado a"…).
   * Held for EVERY key, not just the ones the current template uses, so switching
   * template and back does not lose what the teacher already typed.
   */
  labels: Record<CertificateLabelKey, string>;
  /**
   * The organisation delivering the training; the first mark. Empty means fall
   * back to the workspace's own name and avatar.
   */
  orgBrandName: string;
  orgBrandLogoUrl: string;
  /**
   * La tinta del archivo del logo. `''` = sin declarar, y sin declarar no se
   * toca — que es lo correcto para un logo a color. Ver `CertificateLogoTone`.
   */
  orgBrandLogoTone: '' | CertificateLogoTone;
  /** The client company this training was delivered for; the second mark. */
  clientBrandName: string;
  clientBrandLogoUrl: string;
  clientBrandLogoTone: '' | CertificateLogoTone;
  /** Printed height of each logo, in canvas pixels. */
  brandLogoHeight: number;
  /** Print each mark's name under its logo as well as the logo itself. */
  brandShowNames: boolean;
  /**
   * Dónde se dibujan las marcas. `''` = donde esa plantilla las pone por
   * defecto, que NO es el mismo lugar en todas: classique arriba, diploma
   * abajo. Por eso el vacío no se guarda — guardarlo como 'top' movría las
   * marcas de la mitad de las plantillas sin que nadie lo haya pedido.
   */
  brandPlacement: '' | 'top' | 'bottom';
  /**
   * La plantilla propia: la imagen que subió quien diseñó el certificado y
   * dónde va cada campo encima. `null` = este curso usa una de las seis
   * plantillas fijas, que es lo que hacen todos hoy.
   */
  layout: CertificateLayout | null;
  /**
   * A free canvas layout. `null` means the course renders through one of the
   * five fixed templates, which is every course while `CANVAS_EDITOR_ENABLED`
   * is off.
   */
  document: CertificateDocument | null;
}

const LABEL_KEYS = Object.keys(DEFAULT_CERTIFICATE_LABELS) as CertificateLabelKey[];

/**
 * `recipientName` <-> `field:recipientName`.
 *
 * El prefijo lo pone el compilador para que un id de campo no pueda chocar con
 * el de un elemento del lienzo libre. Las dos direcciones viven acá juntas: por
 * separado, una se cambia y la otra no.
 */
function elementIdFromFieldId(id: CertificateFieldId): string {
  return `field:${id}`;
}

function fieldIdFromElementId(elementId: string): CertificateFieldId | null {
  const id = elementId.startsWith('field:') ? elementId.slice('field:'.length) : '';

  return (CERTIFICATE_FIELD_IDS as readonly string[]).includes(id) ? (id as CertificateFieldId) : null;
}

function toLabelDraft(labels: CertificateLabels | undefined): Record<CertificateLabelKey, string> {
  return Object.fromEntries(LABEL_KEYS.map((key) => [key, labels?.[key] ?? DEFAULT_CERTIFICATE_LABELS[key]])) as Record<
    CertificateLabelKey,
    string
  >;
}

/**
 * Only keys that differ from the default are persisted, so a course does not
 * freeze today's wording — improve a default and every course that never
 * customised it picks the change up.
 */
function fromLabelDraft(draft: Record<CertificateLabelKey, string>): CertificateLabels | undefined {
  const labels: CertificateLabels = {};

  for (const key of LABEL_KEYS) {
    if (draft[key] !== DEFAULT_CERTIFICATE_LABELS[key]) labels[key] = draft[key];
  }

  return Object.keys(labels).length > 0 ? labels : undefined;
}

function toSignatoryDraft(stored: CertificateDesign['signatories'][number] | undefined): CertificateEditorSignatory {
  return {
    name: stored?.name ?? '',
    role: stored?.role ?? '',
    imageUrl: stored?.imageUrl ?? '',
    imageHasBackground: stored?.imageHasBackground ?? false,
    // `null` y no el default: guardar el default congelaría el valor de hoy, y
    // el tope que cada plantilla se puso dejaría de aplicarse.
    imageHeight: stored?.imageHeight ?? null,
    imageOffset: stored?.imageOffset ?? null
  };
}

/** Sin firma no se guarda el fondo: describiría un archivo que no existe. */
function fromSignatoryDraft(draft: CertificateEditorSignatory): CertificateDesign['signatories'][number] {
  const imageUrl = draft.imageUrl.trim();

  return {
    name: draft.name,
    role: draft.role,
    ...(imageUrl ? { imageUrl } : {}),
    ...(imageUrl && draft.imageHasBackground ? { imageHasBackground: true } : {}),
    ...(imageUrl && draft.imageHeight !== null ? { imageHeight: draft.imageHeight } : {}),
    ...(imageUrl && draft.imageOffset !== null ? { imageOffset: draft.imageOffset } : {})
  };
}

function toDraft(design: CertificateDesign): CertificateEditorDraft {
  return {
    templateId: design.templateId,
    accentColor: design.accentColor,
    subtitle: design.subtitle ?? '',
    descriptionOverride: design.descriptionOverride ?? '',
    idFormat: design.idFormat ?? '',
    titleOverride: design.titleOverride ?? '',
    signatories: [toSignatoryDraft(design.signatories[0]), toSignatoryDraft(design.signatories[1])],
    labels: toLabelDraft(design.labels),
    orgBrandName: design.orgBrand?.name ?? '',
    orgBrandLogoUrl: design.orgBrand?.logoUrl ?? '',
    orgBrandLogoTone: design.orgBrand?.logoTone ?? '',
    clientBrandName: design.clientBrand?.name ?? '',
    clientBrandLogoUrl: design.clientBrand?.logoUrl ?? '',
    clientBrandLogoTone: design.clientBrand?.logoTone ?? '',
    brandLogoHeight: design.brandLogoHeight ?? DEFAULT_BRAND_LOGO_HEIGHT,
    brandShowNames: design.brandShowNames ?? false,
    brandPlacement: design.brandPlacement ?? '',
    layout: design.layout ?? null,
    document: design.document ?? null
  };
}

/** `{ name, logoUrl }` with blanks dropped, or nothing at all when both are blank. */
function toBrand(name: string, logoUrl: string, logoTone: '' | CertificateLogoTone): CertificateDesign['clientBrand'] {
  const trimmedName = name.trim();
  const trimmedLogo = logoUrl.trim();

  if (!trimmedName && !trimmedLogo) return undefined;

  return {
    ...(trimmedName ? { name: trimmedName } : {}),
    ...(trimmedLogo ? { logoUrl: trimmedLogo } : {}),
    // Sólo si hay logo: la tinta de un archivo que no existe no describe nada,
    // y quedaría guardada esperando al próximo que suba uno.
    ...(trimmedLogo && logoTone ? { logoTone } : {})
  };
}

function fromDraft(draft: CertificateEditorDraft): CertificateDesign {
  return {
    templateId: draft.templateId,
    accentColor: draft.accentColor,
    subtitle: draft.subtitle.trim() || undefined,
    descriptionOverride: draft.descriptionOverride.trim() || undefined,
    idFormat: draft.idFormat.trim() || undefined,
    titleOverride: draft.titleOverride.trim() || undefined,
    signatories: [fromSignatoryDraft(draft.signatories[0]), fromSignatoryDraft(draft.signatories[1])],
    labels: fromLabelDraft(draft.labels),
    ...(toBrand(draft.orgBrandName, draft.orgBrandLogoUrl, draft.orgBrandLogoTone)
      ? { orgBrand: toBrand(draft.orgBrandName, draft.orgBrandLogoUrl, draft.orgBrandLogoTone) }
      : {}),
    ...(toBrand(draft.clientBrandName, draft.clientBrandLogoUrl, draft.clientBrandLogoTone)
      ? { clientBrand: toBrand(draft.clientBrandName, draft.clientBrandLogoUrl, draft.clientBrandLogoTone) }
      : {}),
    // Only when it differs from the default, so a course does not freeze
    // today's sizing — same rule the labels follow.
    ...(draft.brandLogoHeight !== DEFAULT_BRAND_LOGO_HEIGHT ? { brandLogoHeight: draft.brandLogoHeight } : {}),
    ...(draft.brandShowNames ? { brandShowNames: true } : {}),
    ...(draft.brandPlacement ? { brandPlacement: draft.brandPlacement } : {}),
    ...(draft.layout ? { layout: draft.layout } : {}),
    ...(draft.document ? { document: draft.document } : {})
  };
}

/**
 * The one shared reader, plus the single thing this caller wants differently.
 *
 * It used to be a rebuild of its own, and so did the summary card, and so did
 * the API — three copies, each of which forgot a different field.
 */
function readStoredDesign(): CertificateDesign {
  const design = resolveCertificateDesign(courseApi.course?.certificate);

  // A course saved onto the canvas while it existed opens on its template
  // instead. `renderCertificate` ignores the stored layout for the same reason
  // and off the same constant, so the editor and the issued PDF agree about
  // which one is in force.
  return CANVAS_EDITOR_ENABLED ? design : { ...design, document: undefined };
}

/**
 * The two logo slots, appended to whatever the seed produced.
 *
 * Positioned in the top corners, outside where any template puts text, and
 * hidden when empty — so a course with no client logo prints nothing there.
 */
function brandSlotElements(): CertificateElement[] {
  return [
    { kind: 'image', id: 'org-logo', x: 68, y: 54, w: 130, h: 54, source: { kind: 'orgLogo' }, fit: 'contain' },
    { kind: 'image', id: 'client-logo', x: 902, y: 54, w: 130, h: 54, source: { kind: 'clientLogo' }, fit: 'contain' }
  ];
}

/**
 * The certificate blob to send, with legacy junk removed.
 *
 * Saving carries the whole stored `certificate` object along, because it also
 * holds settings this editor does not own — the completion deadline, the pass
 * threshold, the email message — and sending only the design would wipe them.
 *
 * But the stored blob is not guaranteed to satisfy today's schema. A course with
 * `deadline: ''` (an empty string, which the settings page can leave behind)
 * fails validation for the WHOLE update, so the design never leaves the browser:
 * a teacher's layout blocked by a field they never touched, on a page that does
 * not mention deadlines. Confirmed against the real schema, not guessed.
 *
 * So offending keys are dropped until what remains validates. `design` and
 * `theme` are never dropped — they are the reason we are here, and if the
 * problem is in them the caller reports it rather than quietly saving less than
 * the teacher asked for.
 */
function buildCertificatePayload(
  stored: Record<string, unknown> | undefined | null,
  design: CertificateDesign,
  templateId: CertificateTemplateId
): Record<string, unknown> {
  const candidate: Record<string, unknown> = { ...(stored ?? {}), design, theme: templateId };

  // Bounded: each pass removes at least one key, and there are only a handful.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = ZCertificationSettings.safeParse(candidate);
    if (result.success) return candidate;

    const offenders = result.error.issues
      .map((issue) => issue.path[0])
      .filter((key): key is string => typeof key === 'string' && key !== 'design' && key !== 'theme');

    if (offenders.length === 0) return candidate;

    for (const key of new Set(offenders)) {
      console.warn(`[certificate] dropping unsaveable stored setting "${key}" so the design can be saved`);
      delete candidate[key];
    }
  }

  return candidate;
}

/** Plain deep copy of a rune-proxied document, safe to keep in a history stack. */
function snapshotDocument(document: CertificateDocument): CertificateDocument {
  return structuredClone($state.snapshot(document)) as CertificateDocument;
}

/**
 * How many steps back the editor can go.
 *
 * Deep copies of a whole document, so this is a memory budget as much as a
 * feature: 50 steps covers any realistic "I've made a mess, take me back"
 * without holding megabytes of near-identical layouts.
 */
const MAX_HISTORY = 50;

/** Un paso del historial. Cubre las dos vías: el lienzo y la plantilla propia. */
interface EditorSnapshot {
  document: CertificateDocument | null;
  layout: CertificateLayout | null;
}

class CertificateEditorStore {
  activePanel = $state<CertificateEditorPanel>('templates');
  draft = $state<CertificateEditorDraft>(toDraft(DEFAULT_CERTIFICATE_DESIGN));
  initial = $state<CertificateEditorDraft>(toDraft(DEFAULT_CERTIFICATE_DESIGN));
  isSaving = $state(false);
  selectedElementId = $state<string | null>(null);
  #past = $state<EditorSnapshot[]>([]);
  #future = $state<EditorSnapshot[]>([]);
  #initializedCourseId: string | null = null;

  readonly isDirty = $derived(JSON.stringify(this.draft) !== JSON.stringify(this.initial));

  syncFromCourse(courseId: string, force = false) {
    if (!force && this.#initializedCourseId === courseId) return;

    const stored = readStoredDesign();
    this.initial = toDraft(stored);
    this.draft = toDraft(stored);
    this.#initializedCourseId = courseId;
    // History belongs to the document being edited; carrying it across courses
    // would let an undo paste one course's layout into another.
    this.#past = [];
    this.#future = [];
    this.selectedElementId = null;
  }

  reset() {
    this.draft = toDraft(fromDraft(this.initial));
    this.#past = [];
    this.#future = [];
    this.selectedElementId = null;
  }

  /** True once this course renders from a canvas layout rather than a template. */
  readonly isCanvas = $derived(this.draft.document !== null);
  /** Este curso trae su propia imagen de certificado en vez de una plantilla. */
  readonly isLayout = $derived(this.draft.layout !== null);
  /** El lienzo se puede arrastrar en los dos modos. */
  readonly isEditableStage = $derived(this.isCanvas || this.isLayout);

  async setTemplate(
    templateId: CertificateTemplateId,
    reseed?: { data: CertificateRenderData; values: BindingValues }
  ) {
    this.draft.templateId = templateId;

    // Picking a different template while on the canvas would otherwise change
    // nothing visible — the document owns the layout — which reads as a broken
    // button. Re-seed from the template just chosen, discarding the current
    // layout, which is what choosing a different template means.
    if (!this.draft.document) return;

    this.checkpoint();
    this.draft.document = null;
    this.selectedElementId = null;

    if (reseed) {
      await this.switchToCanvas(reseed.data, reseed.values);
    } else {
      this.draft.document = buildPresetDocument({ ...fromDraft(this.draft), templateId });
      this.draft.document.elements.push(...brandSlotElements());
    }
  }

  /**
   * Move this course onto the free canvas, seeded from the template it is
   * already using so the teacher starts from their own certificate rather than
   * an empty rectangle.
   *
   * Seeded by MEASURING the template rather than by a hand-written recreation
   * of it. The recreations were visibly different from every template they
   * claimed to be, and were never going to converge: the originals reflow with
   * flex, grid and `clamp()`, and a canvas is fixed coordinates. Letting the
   * browser lay the template out and reading the result matches by
   * construction. `buildPresetDocument` stays as the fallback for when there is
   * no DOM to measure in.
   *
   * This is also what turns on the two brand slots: no fixed template draws a
   * logo at all, so the client's mark only appears once a course is on the
   * canvas.
   */
  async switchToCanvas(data: CertificateRenderData, values: BindingValues) {
    if (!CANVAS_EDITOR_ENABLED || this.draft.document) return;

    const design = fromDraft(this.draft);
    const measured = await measureTemplateAsDocument(design, data, values).catch(() => null);
    const document = measured ?? buildPresetDocument(design);

    // Nothing measurable draws a logo, so the brand slots are appended rather
    // than discovered — they are the feature the canvas exists to unlock.
    document.elements.push(...brandSlotElements());

    this.checkpoint();
    this.draft.document = document;
    this.selectedElementId = null;
  }

  /**
   * Back to the fixed template. The document is dropped, and that is a real
   * loss of work, so the caller confirms first — the store does not own that
   * conversation, but it must not pretend the layout is recoverable.
   */
  revertToTemplate() {
    this.checkpoint();
    this.draft.document = null;
    this.selectedElementId = null;
  }

  // ─── Canvas editing ────────────────────────────────────────────────────────

  /**
   * Lo que el lienzo dibuja y arrastra.
   *
   * En modo plantilla propia son los campos COMPILADOS a elementos, y no una
   * segunda lista: así el lienzo, la vista previa y el PDF salen exactamente
   * del mismo compilador. La alternativa —que el editor tenga su idea de dónde
   * va cada campo— es de dónde salen los editores que muestran una cosa y
   * imprimen otra.
   */
  readonly elements = $derived.by(() => {
    if (this.draft.layout) {
      return buildLayoutDocument({ layout: this.draft.layout, design: fromDraft(this.draft) }).elements;
    }

    return this.draft.document?.elements ?? [];
  });

  /** El fondo que el lienzo pinta detrás de todo. */
  readonly stageCanvas = $derived.by(() => {
    if (this.draft.layout) {
      return buildLayoutDocument({ layout: this.draft.layout, design: fromDraft(this.draft) }).canvas;
    }

    return this.draft.document?.canvas;
  });
  readonly selectedElement = $derived(this.elements.find((element) => element.id === this.selectedElementId) ?? null);
  readonly canUndo = $derived(this.#past.length > 0);
  readonly canRedo = $derived(this.#future.length > 0);

  /**
   * Mark a point worth returning to. Called ONCE at the start of a gesture, not
   * per frame: a drag emits a mutation on every pointer move, and checkpointing
   * each one would mean fifty presses of undo to reverse a single motion.
   */
  checkpoint() {
    if (!this.draft.document && !this.draft.layout) return;

    this.#past = [...this.#past, this.#snapshot()].slice(-MAX_HISTORY);
    // A new action invalidates anything that was undone: the timeline branched.
    this.#future = [];
  }

  undo() {
    const previous = this.#past.at(-1);
    if (!previous) return;

    this.#future = [this.#snapshot(), ...this.#future];
    this.#past = this.#past.slice(0, -1);
    this.#restore(previous);
  }

  redo() {
    const next = this.#future[0];
    if (!next) return;

    this.#past = [...this.#past, this.#snapshot()].slice(-MAX_HISTORY);
    this.#future = this.#future.slice(1);
    this.#restore(next);
  }

  /**
   * Las DOS vías en el mismo paso del historial.
   *
   * Guardar sólo el documento dejaba a la plantilla propia sin deshacer, y
   * —peor— pasar de una vía a la otra no era un paso reversible: se perdía el
   * trabajo sin que nada lo dijera.
   */
  #snapshot(): EditorSnapshot {
    return {
      document: this.draft.document ? snapshotDocument(this.draft.document) : null,
      layout: this.draft.layout ? structuredClone($state.snapshot(this.draft.layout)) : null
    };
  }

  #restore(snapshot: EditorSnapshot) {
    this.draft.document = snapshot.document;
    this.draft.layout = snapshot.layout;

    // Lo que se estaba editando puede no existir en el estado restaurado.
    const sigueExistiendo = this.elements.some((element) => element.id === this.selectedElementId);
    if (!sigueExistiendo) this.selectedElementId = null;
  }

  select(elementId: string | null) {
    this.selectedElementId = elementId;

    // Clicking a thing and having its properties appear is what every design
    // tool does; without it the panel is a place you have to remember to visit.
    if (elementId) this.activePanel = this.draft.layout ? 'layout' : 'element';
  }

  /** Patch an element in place. The caller checkpoints before a gesture starts. */
  updateElement(elementId: string, patch: Partial<CertificateElement>) {
    // En plantilla propia los elementos son una compilación: escribirlos sería
    // escribir sobre algo que se regenera en el siguiente $derived. Lo que se
    // guarda es la CAJA del campo.
    if (this.draft.layout) {
      const id = fieldIdFromElementId(elementId);
      if (!id) return;

      const { x, y, w, h } = patch as Partial<CertificateFieldPlacement>;
      this.updateField(id, {
        ...(typeof x === 'number' ? { x } : {}),
        ...(typeof y === 'number' ? { y } : {}),
        ...(typeof w === 'number' ? { w } : {}),
        ...(typeof h === 'number' ? { h } : {})
      });

      return;
    }

    const document = this.draft.document;
    if (!document) return;

    const index = document.elements.findIndex((element) => element.id === elementId);
    if (index < 0) return;

    document.elements[index] = { ...document.elements[index], ...patch } as CertificateElement;
  }

  // ─── Plantilla propia ──────────────────────────────────────────────────────

  /**
   * Pasar este curso a plantilla propia.
   *
   * Arranca VACÍO de campos, no con una copia de la plantilla actual: los
   * campos caen solos en su ubicación por defecto, y guardar una copia
   * congelaría hoy las quince cajas — mejorar un default no llegaría nunca a
   * los certificados ya creados.
   */
  useOwnTemplate() {
    if (this.draft.layout) return;

    this.checkpoint();
    this.draft.layout = { backgroundTone: 'light' };
    this.selectedElementId = null;
    this.activePanel = 'layout';
  }

  /**
   * Volver a las plantillas fijas.
   *
   * Conserva lo ubicado en `layout` hasta que se guarde: quien prueba las dos
   * y vuelve no pierde el trabajo. Al guardar sí se descarta, porque `fromDraft`
   * sólo escribe `layout` cuando existe.
   */
  useFixedTemplate() {
    if (!this.draft.layout) return;

    this.checkpoint();
    this.draft.layout = null;
    this.selectedElementId = null;
    this.activePanel = 'templates';
  }

  setBackground(url: string) {
    if (!this.draft.layout) return;

    this.checkpoint();
    this.draft.layout = { ...this.draft.layout, ...(url ? { backgroundUrl: url } : { backgroundUrl: undefined }) };
  }

  setBackgroundTone(tone: 'light' | 'dark') {
    if (!this.draft.layout) return;

    this.checkpoint();
    this.draft.layout = { ...this.draft.layout, backgroundTone: tone };
  }

  /** Lo guardado de un campo por encima de su ubicación por defecto. */
  fieldPlacement(id: CertificateFieldId): CertificateFieldPlacement {
    return resolveFieldPlacement(id, this.draft.layout?.fields?.[id]);
  }

  /**
   * Mover o restilar un campo.
   *
   * Se escribe la caja COMPLETA y no sólo lo que cambió: un campo a medio
   * guardar —con `x` pero sin `w`— lo descarta el resolver del servidor, así
   * que el editor mostraría la posición nueva y el PDF la vieja.
   */
  updateField(id: CertificateFieldId, patch: Partial<CertificateFieldPlacement>) {
    if (!this.draft.layout) return;

    const fields = { ...(this.draft.layout.fields ?? {}) };
    fields[id] = { ...this.fieldPlacement(id), ...patch };
    this.draft.layout = { ...this.draft.layout, fields };
  }

  toggleField(id: CertificateFieldId, hidden: boolean) {
    this.checkpoint();
    this.updateField(id, { hidden });
    if (hidden && this.selectedElementId === elementIdFromFieldId(id)) this.selectedElementId = null;
  }

  /** Devolver un campo a donde estaba antes de que nadie lo tocara. */
  resetField(id: CertificateFieldId) {
    if (!this.draft.layout) return;

    this.checkpoint();
    const fields = { ...(this.draft.layout.fields ?? {}) };
    delete fields[id];
    this.draft.layout = { ...this.draft.layout, fields };
  }

  readonly selectedFieldId = $derived(this.draft.layout ? fieldIdFromElementId(this.selectedElementId ?? '') : null);

  selectField(id: CertificateFieldId | null) {
    this.selectedElementId = id ? elementIdFromFieldId(id) : null;
    if (id) this.activePanel = 'layout';
  }

  addElement(element: CertificateElement) {
    if (!this.draft.document) return;

    this.checkpoint();
    this.draft.document.elements.push(element);
    this.selectedElementId = element.id;
  }

  duplicateSelected() {
    const source = this.selectedElement;
    if (!source || !this.draft.document) return;

    this.checkpoint();
    const copy = {
      ...structuredClone($state.snapshot(source)),
      id: `${source.kind}-${Date.now().toString(36)}`,
      // Offset so the copy is visibly a second object rather than appearing to
      // have done nothing.
      x: source.x + 16,
      y: source.y + 16
    } as CertificateElement;

    this.draft.document.elements.push(copy);
    this.selectedElementId = copy.id;
  }

  removeSelected() {
    const document = this.draft.document;
    if (!document || !this.selectedElementId) return;

    this.checkpoint();
    document.elements = document.elements.filter((element) => element.id !== this.selectedElementId);
    this.selectedElementId = null;
  }

  /**
   * Move an element through the paint order. Array position IS z-order, so this
   * is a splice rather than a z-index — keeping one source of truth for depth.
   */
  reorderSelected(direction: 'front' | 'back' | 'forward' | 'backward') {
    const document = this.draft.document;
    if (!document || !this.selectedElementId) return;

    const index = document.elements.findIndex((element) => element.id === this.selectedElementId);
    if (index < 0) return;

    const target =
      direction === 'front'
        ? document.elements.length - 1
        : direction === 'back'
          ? 0
          : direction === 'forward'
            ? Math.min(document.elements.length - 1, index + 1)
            : Math.max(0, index - 1);

    if (target === index) return;

    this.checkpoint();
    const [element] = document.elements.splice(index, 1);
    document.elements.splice(target, 0, element);
  }

  setCanvasBackground(patch: Partial<CertificateDocument['canvas']>) {
    if (!this.draft.document) return;

    this.checkpoint();
    this.draft.document.canvas = { ...this.draft.document.canvas, ...patch };
  }

  setAccent(color: string) {
    this.draft.accentColor = color;
  }

  /**
   * Returns a render-ready design with empty optional strings collapsed to
   * `undefined`, suitable for handing to `Certificate.Preview` / API payload.
   */
  toDesign(): CertificateDesign {
    return fromDraft(this.draft);
  }

  async save() {
    const course = courseApi.course;
    if (!course?.id) return;

    this.isSaving = true;
    try {
      const design = fromDraft(this.draft);

      /**
       * Check the design here, where we can say what is wrong with it.
       *
       * `courseApi.update` validates the whole body and, on failure, returns
       * null after quietly parking the messages on `courseApi.errors` — which
       * nothing in this editor renders. So a design the schema rejects produced
       * no request, no error, and a button that just stayed on "unsaved". A
       * teacher losing a layout they spent time on, told nothing.
       */
      const check = ZCertificateDesign.safeParse(design);

      if (!check.success) {
        const first = check.error.issues[0];
        const where = first?.path.join('.') || 'design';

        console.error('[certificate] design rejected before saving:', check.error.issues);
        snackbar.error(
          t.get('course.navItem.certificates.editor.save_invalid', {
            detail: `${where}: ${first?.message ?? ''}`
          })
        );

        return;
      }

      const certificate = buildCertificatePayload(course.certificate, design, this.draft.templateId);

      const updated = await courseApi.update(course.id, { certificate }, { showSuccessToast: false });

      if (!updated) {
        // The request itself failed, or the wider body was rejected. Either way
        // the teacher's work is still in the draft, and they need to know it did
        // not land rather than discovering it on the next page load.
        snackbar.error(t.get('course.navItem.certificates.editor.save_failed_certificate'));
      }

      if (updated) {
        this.initial = {
          ...this.draft,
          signatories: [{ ...this.draft.signatories[0] }, { ...this.draft.signatories[1] }],
          labels: { ...this.draft.labels },
          // Deep-copied like the rest: sharing the reference would make `isDirty`
          // compare the document against itself and never report a change.
          document: this.draft.document ? structuredClone($state.snapshot(this.draft.document)) : null
        };
        snackbar.success(t.get('course.navItem.certificates.editor.saved'));
      }
    } finally {
      this.isSaving = false;
    }
  }
}

export const certificateEditorStore = new CertificateEditorStore();
