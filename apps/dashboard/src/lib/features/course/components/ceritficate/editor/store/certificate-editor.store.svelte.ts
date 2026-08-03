import {
  DEFAULT_CERTIFICATE_DESIGN,
  DEFAULT_CERTIFICATE_LABELS,
  buildPresetDocument,
  resolveTemplateId,
  type CertificateDesign,
  type CertificateDocument,
  type CertificateElement,
  type CertificateLabelKey,
  type CertificateLabels,
  type CertificateTemplateId
} from '@cio/certificates';

import { courseApi } from '$features/course/api';
import { snackbar } from '$features/ui/snackbar/store';
import { t } from '$lib/utils/functions/translations';

export type CertificateEditorPanel = 'templates' | 'content' | 'colors' | 'export';

/**
 * The store keeps optional fields as concrete strings so two-way bindings to
 * inputs are simple — we collapse empty strings to `undefined` only when
 * shipping a payload back to the API.
 */
export interface CertificateEditorDraft {
  templateId: CertificateTemplateId;
  accentColor: string;
  subtitle: string;
  descriptionOverride: string;
  idFormat: string;
  signatories: [{ name: string; role: string }, { name: string; role: string }];
  /**
   * The fixed wording each template prints ("se certifica que", "Otorgado a"…).
   * Held for EVERY key, not just the ones the current template uses, so switching
   * template and back does not lose what the teacher already typed.
   */
  labels: Record<CertificateLabelKey, string>;
  /** The client company this training was delivered for; the second mark. */
  clientBrandName: string;
  clientBrandLogoUrl: string;
  /**
   * A free canvas layout. `null` means the course still renders through one of
   * the five fixed templates, which is where every course starts.
   */
  document: CertificateDocument | null;
}

const LABEL_KEYS = Object.keys(DEFAULT_CERTIFICATE_LABELS) as CertificateLabelKey[];

function toLabelDraft(labels: CertificateLabels | undefined): Record<CertificateLabelKey, string> {
  return Object.fromEntries(
    LABEL_KEYS.map((key) => [key, labels?.[key] ?? DEFAULT_CERTIFICATE_LABELS[key]])
  ) as Record<CertificateLabelKey, string>;
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

function toDraft(design: CertificateDesign): CertificateEditorDraft {
  return {
    templateId: design.templateId,
    accentColor: design.accentColor,
    subtitle: design.subtitle ?? '',
    descriptionOverride: design.descriptionOverride ?? '',
    idFormat: design.idFormat ?? '',
    signatories: [
      { name: design.signatories[0]?.name ?? '', role: design.signatories[0]?.role ?? '' },
      { name: design.signatories[1]?.name ?? '', role: design.signatories[1]?.role ?? '' }
    ],
    labels: toLabelDraft(design.labels),
    clientBrandName: design.clientBrand?.name ?? '',
    clientBrandLogoUrl: design.clientBrand?.logoUrl ?? '',
    document: design.document ?? null
  };
}

function fromDraft(draft: CertificateEditorDraft): CertificateDesign {
  return {
    templateId: draft.templateId,
    accentColor: draft.accentColor,
    subtitle: draft.subtitle.trim() || undefined,
    descriptionOverride: draft.descriptionOverride.trim() || undefined,
    idFormat: draft.idFormat.trim() || undefined,
    signatories: [
      { name: draft.signatories[0].name, role: draft.signatories[0].role },
      { name: draft.signatories[1].name, role: draft.signatories[1].role }
    ],
    labels: fromLabelDraft(draft.labels),
    ...(draft.clientBrandName.trim() || draft.clientBrandLogoUrl.trim()
      ? {
          clientBrand: {
            ...(draft.clientBrandName.trim() ? { name: draft.clientBrandName.trim() } : {}),
            ...(draft.clientBrandLogoUrl.trim() ? { logoUrl: draft.clientBrandLogoUrl.trim() } : {})
          }
        }
      : {}),
    ...(draft.document ? { document: draft.document } : {})
  };
}

function readStoredDesign(): CertificateDesign {
  const certificate = courseApi.course?.certificate;
  const stored = certificate?.design as Partial<CertificateDesign> | undefined;
  const legacyTheme = certificate?.theme;

  return {
    templateId: resolveTemplateId(stored?.templateId ?? legacyTheme),
    accentColor: stored?.accentColor ?? DEFAULT_CERTIFICATE_DESIGN.accentColor,
    subtitle: stored?.subtitle ?? DEFAULT_CERTIFICATE_DESIGN.subtitle,
    descriptionOverride: stored?.descriptionOverride,
    signatories: [
      {
        name: stored?.signatories?.[0]?.name ?? DEFAULT_CERTIFICATE_DESIGN.signatories[0].name,
        role: stored?.signatories?.[0]?.role ?? DEFAULT_CERTIFICATE_DESIGN.signatories[0].role
      },
      {
        name: stored?.signatories?.[1]?.name ?? DEFAULT_CERTIFICATE_DESIGN.signatories[1].name,
        role: stored?.signatories?.[1]?.role ?? DEFAULT_CERTIFICATE_DESIGN.signatories[1].role
      }
    ],
    idFormat: stored?.idFormat ?? DEFAULT_CERTIFICATE_DESIGN.idFormat,
    labels: stored?.labels,
    clientBrand: stored?.clientBrand,
    document: stored?.document
  };
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

class CertificateEditorStore {
  activePanel = $state<CertificateEditorPanel>('templates');
  draft = $state<CertificateEditorDraft>(toDraft(DEFAULT_CERTIFICATE_DESIGN));
  initial = $state<CertificateEditorDraft>(toDraft(DEFAULT_CERTIFICATE_DESIGN));
  isSaving = $state(false);
  selectedElementId = $state<string | null>(null);
  #past = $state<CertificateDocument[]>([]);
  #future = $state<CertificateDocument[]>([]);
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

  setTemplate(templateId: CertificateTemplateId) {
    this.draft.templateId = templateId;

    // Picking a different template while on the canvas would otherwise change
    // nothing visible — the document owns the layout — which reads as a broken
    // button. Re-seed from the template just chosen instead.
    if (this.draft.document) {
      this.draft.document = buildPresetDocument({ ...fromDraft(this.draft), templateId });
    }
  }

  /**
   * Move this course onto the free canvas, seeded from the template it is
   * already using so the teacher starts from their own certificate rather than
   * an empty rectangle.
   *
   * This is also what turns on the two brand slots: no fixed template draws a
   * logo at all, so the client's mark only appears once a course is on the
   * canvas.
   */
  switchToCanvas() {
    if (this.draft.document) return;

    this.draft.document = buildPresetDocument(fromDraft(this.draft));
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

  readonly elements = $derived(this.draft.document?.elements ?? []);
  readonly selectedElement = $derived(
    this.elements.find((element) => element.id === this.selectedElementId) ?? null
  );
  readonly canUndo = $derived(this.#past.length > 0);
  readonly canRedo = $derived(this.#future.length > 0);

  /**
   * Mark a point worth returning to. Called ONCE at the start of a gesture, not
   * per frame: a drag emits a mutation on every pointer move, and checkpointing
   * each one would mean fifty presses of undo to reverse a single motion.
   */
  checkpoint() {
    if (!this.draft.document) return;

    this.#past = [...this.#past, snapshotDocument(this.draft.document)].slice(-MAX_HISTORY);
    // A new action invalidates anything that was undone: the timeline branched.
    this.#future = [];
  }

  undo() {
    const previous = this.#past.at(-1);
    if (!previous || !this.draft.document) return;

    this.#future = [snapshotDocument(this.draft.document), ...this.#future];
    this.#past = this.#past.slice(0, -1);
    this.draft.document = previous;

    // The element being edited may not exist in the restored state.
    if (!previous.elements.some((element) => element.id === this.selectedElementId)) {
      this.selectedElementId = null;
    }
  }

  redo() {
    const next = this.#future[0];
    if (!next || !this.draft.document) return;

    this.#past = [...this.#past, snapshotDocument(this.draft.document)].slice(-MAX_HISTORY);
    this.#future = this.#future.slice(1);
    this.draft.document = next;
  }

  select(elementId: string | null) {
    this.selectedElementId = elementId;
  }

  /** Patch an element in place. The caller checkpoints before a gesture starts. */
  updateElement(elementId: string, patch: Partial<CertificateElement>) {
    const document = this.draft.document;
    if (!document) return;

    const index = document.elements.findIndex((element) => element.id === elementId);
    if (index < 0) return;

    document.elements[index] = { ...document.elements[index], ...patch } as CertificateElement;
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
      const certificate = {
        ...(course.certificate ?? {}),
        design: fromDraft(this.draft),
        theme: this.draft.templateId
      };

      const updated = await courseApi.update(course.id, { certificate }, { showSuccessToast: false });

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
