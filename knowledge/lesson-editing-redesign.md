# Lesson editing: one document, edited in place, made of blocks

> A teacher edits a lesson through four disconnected surfaces and a 60vh
> letterbox, then toggles modes to find out what they made. The student reads it
> as one page. This plan collapses the four surfaces into the one thing that was
> always being authored: a document — edited where it is read.

**Status**: proposal, not built. Written 2026-08-02.

## TL;DR

- The tabs (Vídeo / Nota / diapositiva / Documentos) are an **asset manager that
  became the authoring surface**. Editing in four pieces what is consumed as one
  page is the root discomfort, not the note editor itself.
- Target: **one document, edited in place**. The reading view *is* the editor.
  Paste or drop any file and it lands at the cursor.
- **Blocks with stable ids**, not plain rich text. This is the load-bearing
  decision: it serves the teacher *and* fixes the agent's worst failure mode
  (§3). One change, two payoffs.
- **Explicitly out of scope: real-time collaboration.** "Like Google Docs" here
  means how editing *feels*, not two people typing at once. No CRDTs, no
  presence, no sync server.
- **Blocker to solve first**: lesson media has no stable identity (§4). Nothing
  can reliably reference "that video" today.

## 1. What is actually wrong

Three findings, each verifiable in the code today.

**The editor is a letterbox.** Edit mode boxes the editor at a fixed `h-[60vh]`
with its own scrollbar
([note.svelte:105](../apps/dashboard/src/lib/features/course/components/lesson/note/note.svelte#L105)),
nested inside a page that also scrolls. A 9.5k-character lesson — a real one in
this instance — is authored ~15 lines at a time, with two scrollbars competing.

**Edit and view are different layouts of the same text.** Editing runs full
width; viewing is a centred `max-w-2xl` column
([note.svelte:117](../apps/dashboard/src/lib/features/course/components/lesson/note/note.svelte#L117)).
Line length, paragraph rhythm, and where a diagram lands relative to its
explanation cannot be judged without leaving the editor. The mode toggle is a
query param (`?mode=edit`), so "check how it looks" is a navigation.

**The lesson is split four ways for the author and stacked for the reader.**
`getViewModeComponents`
([utils.ts](../apps/dashboard/src/lib/features/course/components/lesson/utils.ts))
renders Note, Slide, Video and Document one after another in tab order for the
student. The teacher edits them as four tabs. So the author never sees the thing
they are making — and cannot decide that the video belongs *after* the second
heading, because "after the second heading" is not expressible.

## 2. The target

The reading view is the editing surface. Same column, same typography, no mode
switch — a "preview as student" toggle replaces it, for checking locks and
permissions rather than layout.

Media appears in the flow, where it was placed. The tabs demote to a resources
rail: upload there, drag into the document. That rail is worth keeping rather
than deleting, because a purely inline model has nowhere to put a file you
uploaded but have not placed yet.

### Out of scope

**Concurrent editing.** Confirmed with the author of the request: "like Google
Docs" refers to the feel of editing — WYSIWYG, paste anything, no modes — not to
multiplayer. Collaborative editing is a different order of magnitude (CRDT or OT,
presence, a sync server) and nothing here assumes it.

### What stays

- Per-locale content in `lesson_language`, version history, draft autosave, and
  `RoleBasedSecurity` gating.
- The student's reading experience, which already is one page.

## 3. Why blocks

Rich text stores a string. Blocks store an ordered list of addressable pieces.
The second one is worth the extra work here for a reason that has nothing to do
with visual design:

**It fixes the agent's most common failure.** `edit_lesson_content` replaces by
exact string match — the model must reproduce the old fragment verbatim, and
failing to do so is its single most frequent error. This is why the diagram
regenerator splices by *offset* rather than by text
([diagram.ts](../apps/api/src/services/agent/diagram.ts)), and why that works
reliably. With addressable blocks the agent says "replace block `b7`" and the
whole class of failure disappears — the same fix that already worked for
diagrams, generalised.

So blocks are not a UI preference. They are the shared substrate that makes
in-place editing straightforward for a human *and* makes AI editing reliable.

**Incremental path**: Tiptap is already integrated. Giving its top-level nodes
stable ids captures most of the benefit without replacing the editor. A full
block model can come later, or never, if ids prove sufficient.

## 4. Blocker: lesson media has no stable identity

**This must be solved before anything references media from inside a document.**

`lesson.videos` and `lesson.documents` are JSONB arrays
([schema.ts](../packages/db/src/schema.ts)):

```ts
videos:    { type; link; key?; assetId?; fileName?; metadata? }[]
documents: { type; name; link; size?; key; assetId? }[]
slideUrl:  varchar   // a single URL, not a list
```

- `documents[]` always has `key`.
- `videos[]` has `key` and `assetId` **optional** — a YouTube or generic embed
  has neither, only `link`.
- Position is not identity: deleting the first video renumbers everything after
  it, and a document referencing "video 2" would silently point at another file.

**Proposal**: add a required `id` (nanoid) to each entry on write, and backfill
existing rows.

Scale in this instance today: **35 lessons, 1 with a video, 0 with a slide**. The
backfill is nearly free right now and gets more expensive with every course built.

## 5. Paste and drop

Each row is a decision, not an implementation detail.

| Dropped or pasted | Behaviour |
|---|---|
| Image from clipboard | Uploads, lands at the cursor |
| Video file | Uploads, becomes a player in the flow |
| YouTube / Vimeo URL | Becomes a player — **via marker**, see below |
| PDF | Document card in the flow |
| Link to another lesson | Internal link, not a raw URL |
| Spreadsheet / CSV | A real table (Tiptap already has tables) |

**Why markers and not embeds**: `iframe` is in `FORBID_TAGS` and
`ALLOW_DATA_ATTR` is false. A YouTube player written into a note is stripped on
render — exactly the protection that stops an AI-written note from embedding
third-party content. The document carries an inert marker; the viewer swaps in
the real Svelte player. Same trade already made for SVG diagrams.

## 6. What already exists

Built and tested in the session that produced this document:

- `LESSON_MEDIA_ATTR` markers and media-aware splitting in
  [sanitize.ts](../packages/ui/src/tools/sanitize.ts), plus `listLessonMediaRefs`.
- The two data attributes added explicitly to `ADD_ATTR`
  ([sanitize.ts](../packages/utils/src/functions/sanitize.ts)).
- 8 tests covering the dangerous edges, including that SVG ordinals are
  unaffected — the diagram-redraw control identifies a diagram by its position
  among the SVGs, so shifting that would replace the wrong picture.

## 7. Phases

Each phase ships on its own; none strands the one before it.

### Phase 0 — comfort fixes

Remove `h-[60vh]`, give the editor the reader's column width, stop clipping the
toolbar. Worth doing regardless, and it is literally the first step toward
editing in place: same width means the two layouts stop disagreeing.

### Phase 1 — media identity

`id` on every `videos[]` / `documents[]` entry, backfilled. Invisible; unblocks
everything after it.

### Phase 2 — media in the document

The picker over the lesson's own media, the viewer swap, and suppression of the
standalone block once an item is referenced inline (so the student never sees the
same video twice). The markers already exist.

### Phase 3 — block ids

Stable ids on top-level nodes, and an agent tool that targets a block instead of
matching a string. Independently valuable: it makes AI editing reliable whether
or not the rest of the redesign proceeds.

### Phase 4 — edit in place

One surface, no mode toggle, "preview as student" instead. Much easier on top of
Phase 3 than on raw rich text, which is why it comes after despite being the
headline.

### Phase 5 — paste and drop

The table in §5, wired to the upload pipeline.

### Phase 6 — tabs become a resources rail

Upload there, drag into the document.

## 8. Migration

Existing lessons have media but no inline references. Rule: **a media item with
no marker renders where it does today** — its own block, in tab order. Nothing
needs migrating; a lesson changes only when a teacher places something.

That fallback is what makes the later phases safe: the old layout is the default,
not a legacy path awaiting removal.

## 9. Risks

- **Markers referencing deleted media.** The viewer must render an unresolvable
  marker as a visible "missing media" note, never a blank gap — a silent gap is
  indistinguishable from a layout bug.
- **The agent writes into the same document.** Autosave runs every few seconds
  and the agent writes too. Today this is handled with a lock (the diagram
  control is disabled while a draft is unsaved). In-place editing makes that lock
  much more visible, so the conflict needs a real answer rather than a guard.
- **Per-locale content.** `lesson_language` stores one version per locale. If a
  teacher drops an image while editing Spanish, does it appear in English? The
  proposal is yes — the media is shared, the prose is not — but it is a decision,
  and the marker lives inside per-locale text.
- **Two ways to do one thing** during Phases 2–6, while both the tabs and the
  document can position media. Time-boxed by finishing Phase 6.
