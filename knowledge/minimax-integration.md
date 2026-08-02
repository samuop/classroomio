# MiniMax Integration — Lessons Learned

> Living document. Anything new we discover about MiniMax-M3, Anthropic-compatible
> APIs, prompt caching, document handling, or anything adjacent goes here. Read
> this end-to-end before touching the AI agent code — these are the gotchas that
> cost us real debugging time.

**Last major update**: 2026-08-02. Two sprints in this file now: multi-user cache
sharing, then a debugging session that corrected several claims it used to make.
If you read an older copy, re-check these — they were **wrong**:
- `ttl: '1h'` does NOT prevent MiniMax from caching (§3)
- the badge did NOT report on the key the chat writes (§11)
- `fallbackLocale` as a second constructor argument was silently discarded (§6)

New this session: §5b (agent + AI SDK gotchas), the Anthropic vs Gemini handle
TTL split, and what stays alive when the system is idle.

---

## 1. MiniMax at a glance

### Endpoints

```
base URL:   https://api.minimax.io/anthropic/v1
auth:       x-api-key: <key>  (NOT Authorization: Bearer)
version:    anthropic-version: 2023-06-01
```

The base URL is **NOT** `https://api.minimax.io/anthropic` — the Vercel
`@ai-sdk/anthropic` SDK appends `/messages` to whatever you give it. If the
trailing `/v1` is missing, MiniMax returns 404.

### Available models

| Model            | Context     | Notes                                                  |
|------------------|-------------|--------------------------------------------------------|
| `MiniMax-M3`    | 1,000,000   | Latest M-series. Multimodal (image, video, text, tools) |
| `MiniMax-M2.7`   | 204,800     | Text + tools (no image/video)                          |
| `MiniMax-M2.7-highspeed` | 204,800 | Same as M2.7, faster                                 |
| `MiniMax-M2.5`   | 204,800     | Text + tools                                           |
| `MiniMax-M2.1`   | 204,800     | Text + tools                                           |
| `MiniMax-M2`     | 204,800     | Oldest still listed                                    |

Default in code: `MiniMax-M3`. Configurable via `MINIMAX_MODEL` env var
(see `packages/ai-assistant/src/providers/index.ts:DEFAULT_MODELS`).

### Official docs

- Text API: https://platform.minimax.io/docs/api-reference/text-anthropic-api
- Prompt caching: https://platform.minimax.io/docs/api-reference/anthropic-api-compatible-cache
- Pricing: https://platform.minimax.io/docs/guides/pricing-paygo (cache
  read = 5–20% of input price depending on model; write = 1.25× input price)

---

## 2. What MiniMax accepts (and doesn't)

### ✅ Supported `messages[].content` types

```
text           — yes (all models)
image          — only MiniMax-M3 (URL or base64, JPEG/PNG/GIF/WEBP)
video          — only MiniMax-M3 (URL, base64, or mm_file://<id>)
tool_use       — yes (all models)
tool_result    — yes (all models)
thinking       — yes (all models)
document       — ❌ NOT supported. Anthropic's native PDF type does NOT work
                 with MiniMax. We had to fall back to extracting text with
                 pdf-parse and inlining it as text blocks.
```

### ✅ Supported cache_control

```json
{
  "type": "ephemeral"
}
```

**TTL is fixed at 5 minutes.** It auto-refreshes on every cache hit at no
extra cost. Do **NOT** include `ttl: '1h'` — that's an Anthropic-only
extension and MiniMax silently rejects it (the SDK will send it, MiniMax
returns an error, and the SDK falls back to no-cache for that request).

### What can be cached

- `system` blocks (only as array of `{type: 'text', text, cache_control}`, NOT
  a plain string with `system: '...'`)
- `messages[].content[]` blocks (text, tool_use, tool_result)
- `tools[]` definitions (place `cache_control` on the **last** tool to mark all
  prior tools as part of the cached prefix)

### Limits

- Up to **4 cache_control breakpoints** per request. If you specify more, only
  the 4 most recent (back-to-front) are used.
- 20-block lookback window: the system checks up to 20 blocks before each
  breakpoint.
- Cache reads when the cached prefix is hit; the cache lifetime refreshes for
  free each time.

---

## 3. Prompt caching — how it actually behaves

### The "first call is always cache hit = 0%" gotcha

Cache reads only kick in on the **second** request that has the same cached
prefix. The first request creates the cache (and MiniMax sometimes doesn't even
report the creation explicitly via `cache_creation_input_tokens`).

This means: if you look at our log and see
```
[agent.chat] cache hit=0% read=128 write=0 uncached=110192
```
followed by
```
[agent.chat] cache hit=100% read=11264 write=0 uncached=51
```
**that's normal, not a bug.** The first line is the cache miss; the second
is the cache hit.

### What `write=0` actually means

Our log uses `cacheWriteTokens` from `usage.inputTokenDetails.cacheWriteTokens`.
For MiniMax this often stays at 0 even on the first request because MiniMax
caches implicitly server-side (under the `cache_control` hint) without
reporting `cache_creation_input_tokens` in the response. So **`write=0` does
not mean the cache failed to create** — check `cacheRead` on the next
request to confirm the cache is alive.

### Where to put `cache_control` in our request

The system prompt is the obvious candidate but it's typically small. The big
content is the **context message** (the prepended user turn with the PDF
text inside `<document>...</document>`). We tag BOTH:

- `system` — `cacheControl: { type: 'ephemeral' }` on the last system block
- the prepended context user message — same hint, so the PDF block inside
  `<document>` is cached

See `apps/api/src/routes/agent/agent.ts:830-870` for the exact code. The
critical bit:

```typescript
...(isAnthropicCompatible && hasInlineDocumentContext
  ? { providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }
  : {})
```

⚠️ **`ttl: '1h'` is ignored, not fatal** — corrected 2026-08-02. This section
used to claim that sending `ttl: '1h'` meant "the cache was never actually
created". That is **wrong**, and the code has been sending it all along
(`agent.ts:875` on the context message, `agent.ts:900` on the last message).
Measured counter-evidence from `ai_token_usage`:

```
prompt=65259  cache_read=49408   ← a real hit, with ttl:'1h' present
```

What MiniMax actually does is enforce its own 5-minute window and disregard the
field. So `ttl` is harmless clutter, not a cache killer. Don't go "fixing" it
expecting a behaviour change; if you remove it, do so for tidiness only.

The real reason cache reads look absent is almost always **the 5-minute window**,
not the request shape. Turns spaced further apart than that always miss:

```
01:40:20  110318  read=128
01:46:31  110320  read=128    ← 6m11s later: outside the window
04:54:30  109775  read=0      ← hours later
```

### Handle TTL must mirror the provider window (5 min), not Gemini's (15 min)

`document-cache.ts` keeps two constants, and they must stay apart:

```typescript
const CACHE_TTL_SECONDS = 900;            // Gemini: a resource we own, renew and PAY for
const ANTHROPIC_CACHE_TTL_SECONDS = 300;  // MiniMax: mirrors the provider's own window
```

They used to be one 900s value, with a comment shrugging that "our Redis handle
can outlive" the provider's 5 minutes. Harmless while a handle only meant "a
cache might exist" — but once `recordAnthropicCacheHit` made it mean *"the
provider billed us for cached reads"*, a 15-minute handle kept the Sources badge
green for ~10 minutes over a cache that had already evaporated. Same class of
over-claim as the fabricated handles it replaced, just smaller.

Losing the handle costs nothing on this path: the next cached read re-establishes
it. Regression test: `expect(opts.EX).toBe(300)`.

### What stays alive when nobody is using the chat

Answer to "if nobody chats or builds, what keeps running?" — with
`CHAT_PROVIDER=minimax`, **nothing, and nothing bills for idling**:

| Resource | Lifetime | Costs money while idle? |
|---|---|---|
| MiniMax cache (provider side) | 5 min idle; free refresh on every hit | **No** — implicit, nothing is rented |
| Our Redis handle (Anthropic) | 5 min (`ANTHROPIC_CACHE_TTL_SECONDS`) | No — a local record |
| Document text in Redis | 1 h (`DOCUMENT_REDIS_TTL = 3600`) | No |
| Gemini `cachedContent` | 15 min sliding | **Yes** — hourly storage, hence the explicit DELETE in `releaseDocumentCaches`. Dormant under MiniMax |
| `ai_chat_document.text` in Postgres | permanent | Storage only |

The asymmetry is the whole point: Gemini's cache is a resource we create and must
release; MiniMax's is a hint the server may honour. There is nothing to shut down.

### Measured: the cache genuinely works

From `ai_token_usage` on a real plan session (2026-08-02):

```
05:25:16  prompt 221605  cache_read 110464    ← 2 steps, document inline
05:34:53  prompt 221987  cache_read 110464    ← whole document served from cache
05:36:16  prompt  10429  cache_read      0    ← document GONE from context
```

Two lessons in one table. The cache does serve a 110k-token document at read
price. And turns spaced beyond the 5-minute window always miss — `read=128`
readings are that, not a broken prefix.

### Conversation-id vs document-id scoping

The cache handle is keyed on **`(courseId, contentHash)`** (multi-user shared
cache) **OR** `(documentId)` (legacy / single-user fallback). Same content
uploaded to the same course shares one cache handle across users — see
section 11 below for the full multi-user architecture.

---

## 4. Document handling

### PDF parsing

`pdf-parse` (used in `apps/api/src/services/agent/document.ts:extractPdfText`)
works fine. DOCX uses mammoth, PPTX uses jszip + xml scraping.

### Document size limits

- **Max upload size**: `MAX_AGENT_DOCUMENT_SIZE = 25 * 1024 * 1024` (25 MB)
- **Max text length**: `MAX_DOCUMENT_TEXT_LENGTH = 500_000` chars
  (`apps/api/src/services/agent/document.ts`)
- **Cache min threshold**: `MIN_CACHE_DOCUMENT_CHARS = 16_000` chars
  (~4k tokens — covers both Gemini's 4k minimum and Anthropic's 1k minimum)

### Document table

`ai_chat_document` (Postgres) stores the parsed text. Schema:

```
id                text PRIMARY KEY
conversation_id   uuid FK → ai_chat_conversation
course_id         uuid  (denormalized for Sources panel queries)
user_id           uuid
asset_id          uuid FK → asset (S3 object)
file_name         text
mime_type         text
text              text  (full extracted text)
content_hash      text  (SHA-256 of text — for multi-user dedup, see §11)
word_count        int
page_count        int
created_at        timestamp with timezone
```

The `course_id` denormalization is what makes the Sources panel query
(`WHERE course_id = ? AND user_id = ?`) a single-index lookup instead of a join
across conversations. The `content_hash` enables multi-user shared cache.

Indexes:
- `idx_ai_chat_document_conversation` on `conversation_id`
- `idx_ai_chat_document_course_hash` on `(course_id, content_hash)` — used for
  dedup lookup on upload

### Draft vs persisted documents

Two upload paths:

| Endpoint                  | When to use                                | Persists to DB? |
|---------------------------|-------------------------------------------|-----------------|
| `POST /agent/upload`       | User has a course/conversation             | ✅ Yes          |
| `POST /agent/upload-draft` | Home page wizard before course exists     | ❌ Redis only (1h TTL) |

The Sources panel uses `/agent/upload`. When called WITHOUT `conversationId`
we auto-create a "Course sources" hidden conversation so the document has
somewhere to live (`apps/api/src/routes/agent/agent.ts:160`). After upload,
the document is searchable via `listChatDocumentsByCourse(courseId, userId)`.

### `MAX_DOCUMENTS_PER_CONVERSATION = 10`

`packages/db/src/queries/agent/chat-document.ts:6` — when you insert into
`ai_chat_document`, the DB layer auto-prunes anything older than the 10
most-recent for that conversation. This is a **per-conversation** limit, not
per-course. If a course has 30 sources across 3 conversations, all 30 are
visible in the Sources panel.

---

## 5. The Sources panel architecture

### Routes

| Route                                    | Method | Purpose                            |
|------------------------------------------|--------|------------------------------------|
| `/agent/documents?courseId=X`            | GET    | List sources for a course          |
| `/agent/documents/:documentId`           | DELETE | Remove a source + invalidate cache |
| `/agent/documents/:documentId/cache-status` | GET | Cache status + TTL               |
| `/agent/documents/:documentId/refresh-cache` | POST | Drop + rebuild cache handle     |
| `/agent/documents/reconcile`             | POST   | Auto-sync agent: walk every doc, rebuild missing/expired handles |

### ⚠️ There is NO way to ask MiniMax whether something is cached

The Anthropic-compatible API has no `cachedContents` resource and no status
endpoint. You attach `cache_control: ephemeral` and the server decides. The
**only** ground truth is `usage.inputTokenDetails.cacheReadTokens > 0` on a real
response (logged as `[agent.chat] cache hit=…`, persisted to `ai_token_usage`).

Grep proves it — every network call in `document-cache.ts` is Gemini's:

```
document-cache.ts:138  fetch(`${GEMINI_API_BASE}/cachedContents?key=…`)
document-cache.ts:183  fetch(`${GEMINI_API_BASE}/${cacheName}`, { method: 'DELETE' })
document-cache.ts:202  fetch(`${GEMINI_API_BASE}/${handle.cacheName}?key=…`)
```

The Anthropic path does `redis.get` / `redis.set` and nothing else.

**The bug this caused.** A Redis "handle" used to be created speculatively — by
`resolveDocumentCache` at chat time, by `refreshDocumentCache`, and by
`reconcileCourseSourceCache`. Reconcile runs when the Sources panel mounts, so
**opening the panel turned the badge green**, asserting a MiniMax-side cache
that had never been requested, let alone confirmed. `expireAt` was just
`Date.now() + TTL`, not anything the provider said.

Now `recordAnthropicCacheHit` is the **only** writer, called from `agent.ts`
after the stream with the turn's real `cacheReadTokens`; it no-ops on 0. A
handle therefore means "the provider billed us for cached reads at
`observedAt`". Reconcile only reports and releases; refresh only invalidates.

Caveat kept deliberately: `cacheReadTokens` covers the whole cached prefix
(system prompt + context message with the document inside), so it attests "a
cached read happened on a turn carrying this document", not "these exact bytes
came from cache". The API exposes no per-block breakdown.

**If you ever see a green badge without a chat turn, something started
fabricating handles again.** The regression test is `honest cache badge >
reconcile does not create a handle for an eligible document`.

### Cache activation policy (Phase 4.1)

For every teacher chat turn with a document attached and NOT a single-lesson
edit, the cache is activated. The previous policy ("only on empty course")
is obsolete — once the Sources panel pins documents to a course, the
instructor WILL re-read them across edits, and the cache pays back fast.

The activation check (in `apps/api/src/routes/agent/agent.ts:535-548`):

```typescript
const hasApprovedPlanForCache =
  role === AgentRole.TEACHER ? !!getLatestImplementationPlan(messages) : false;
const hasDocumentAttached = !!context?.documentId;
const isSingleLessonEdit =
  role === AgentRole.TEACHER && !!context?.lessonId;
const cacheEligiblePhase =
  role === AgentRole.TEACHER && hasDocumentAttached && !isSingleLessonEdit;
```

This now covers all four cases:
1. Building an approved plan (dozens of tool calls read the same material)
2. Planning from a document on an empty course (genuine build-from-scratch)
3. Editing an existing course that has a source attached (every edit re-reads)
4. Single-lesson edits are NEVER cache-eligible

### Reconciliation policy (revised 2026-08-02)

Reconcile **reports and releases; it never creates** — see the warning above.
For every source in the course:
1. **No handle in Redis** → `skipped`/`awaiting_cache_hit` (badge stays dark
   until a real turn confirms a cached read)
2. **Handle expired** → `released`/`expired` (the provider's window lapsed)
3. **Handle live** → `kept`
4. **Document too small / over limit** → release any leftover handle
   (`released`/`too_small` | `over_limit`)

`rebuilt` is no longer produced on this path. The dashboard's
`ReconcileSummary.rebuilt` counter therefore reads 0; it is not rendered
anywhere today.

Implementation: `apps/api/src/services/agent/document-cache.ts:reconcileCourseSourceCache`

Trigger points:
- On Sources panel mount: `apps/dashboard/src/lib/features/ai-assistant/sources/sources-page.svelte:22` — `load()`
- On chat panel mount: `apps/dashboard/src/lib/features/ai-assistant/ai-course-chat.svelte:loadCourseSources()`
- After upload/delete: handled inline (no reconcile pass needed)

### Chat integration

The chat (`ai-course-chat.svelte`) auto-loads sources for the current course
and adopts the most-recently-uploaded as the `uploadedDocument` for the
first message. The chip "1 fuente adjunta de este curso" is purely cosmetic —
clicking it navigates to the Sources panel.

The single-document-at-a-time limitation is on the chat input, NOT on the
backend. Backend already supports `documentIds: string[]` in
`loadDocumentsContext`. Multi-PDF in chat would require changing
`uploadedDocument: UploadedDocument | null` to
`uploadedDocuments: UploadedDocument[]` and injecting all IDs into the
message metadata — see "Things we considered but didn't ship" below.

---

## 5b. Agent + AI SDK gotchas (2026-08-02 session)

Four failures that each looked like something else. All cost real debugging time.

### `toUIMessageStreamResponse` swallows every stream error by default

The SDK's default handler is literally `() => 'An error occurred.'` — it replaces
the real error **and logs nothing**. A broken tool call is then invisible in the
browser console *and* in the API log, so you end up hunting frontend ghosts.
Always pass `onError`. For `InvalidToolInputError`, print `toolName`,
`toolInput` (the raw JSON the model emitted) and `cause`; the generic message
tells you nothing about which property was wrong. Collapse the cause to one line
before returning it — it is multi-line and the chat bubble shows only the first,
useless line.

### MiniMax fails `z.discriminatedUnion`; flatten it

`ask_discovery_questions` failed validation five turns in a row (~666k tokens),
with the model narrating that it could not build a valid card. Cause: the field
schema was a `z.discriminatedUnion('type', …)`, which serialises to JSON Schema
as `anyOf` + `const` discriminators. The prompt and schema were tuned on Gemini;
MiniMax-M3 could not reproduce the shape.

Fix (`packages/ai-assistant/src/templates/index.ts`): a flat object with
`z.enum([...])` plus a `superRefine` that requires `options` only when
`type === 'select'`, and a `z.preprocess` that coerces `["A","B"]` into
`[{value,label}]` — models emit that constantly and the intent is unambiguous.
Strictly a *widening*: everything previously valid still validates, so the Gemini
path cannot regress. Failure messages now name the exact path, which is what the
model reads to correct itself on retry.

**If a tool keeps failing validation, suspect the schema shape before the prompt.**

### `totalUsage` is a BILLING figure, not context occupancy

AI SDK v7 aggregates `totalUsage` across every step of a round. One turn that
called a tool over a 110k-token document reported ~222k, and the context gauge —
which used `totalTokens` — read 100% on a brand-new conversation.

Occupancy is the input size of the **last** request. Capture it in
`onStepFinish` (`step.usage.inputTokens`) and ship it as a separate
`contextTokens` field; keep `totalTokens` as fallback for older messages.

Worse than the wrong number: the "context full" panel was the `{:else}` branch of
the composer, so hitting 100% **removed the input entirely** and the only exits
(compact / new chat) both spend tokens. A gauge must warn, never lock — the panel
now renders above the input.

### The document silently falls out of context after turn 1

`loadDocumentsContext` injects full text only for `currentDocumentId`; documents
seen only in history degrade to a short summary. `currentDocumentId` comes from
the chat's `uploadedDocument`, which was cleared on every `onFinish` and only
re-adopted when `isFirstMessage`. So by the time the teacher finished the
discovery form, the agent was asked to plan "from the apuntes" holding no apuntes
(measured: the plan turn sent 10,429 tokens).

Fix: `UploadedDocument.origin` — `course_source` is sticky across turns,
`one_off` keeps the old per-message behaviour. Also dropped the `isFirstMessage`
guard on auto-adoption: the attachment lives in component state, so a page reload
mid-conversation cleared it and it was never re-attached.

Trade-off to keep in mind: stickiness raises the floor to ~110k input per turn
(mostly cache-served) — and it *multiplies* the cost of a failing retry loop.

## 6. i18n gotchas (`es.json`)

### ⚠️ `fallbackLocale` goes INSIDE the config object — `new i18n()` takes one argument

**This is the bug that cost us two sessions, including one where we shipped a
wrong fix.** The base i18n class is declared
`constructor(config?: Config.T<ParserParams>)` — a **single** parameter
(`node_modules/@sveltekit-i18n/base/dist/index.d.ts:192`). So this:

```typescript
new i18n(config, { fallbackLocale: 'en' })   // ❌ second arg silently discarded
```

...never configures a fallback at all. Every key missing from the active
locale then renders as a literal (`courses.heading`, `app.search.placeholder`).
The correct shape:

```typescript
export const config = {
  parser: parser(),
  fallbackLocale: 'en',   // ✅ a property of the config
  loaders: [ … ]
};
const { t, … } = new i18n(config);
```

**Declaring it in the config is sufficient — do NOT pre-load the fallback
manually.** `getTranslationProps` filters loaders with
`(locale === active && …) || (fallbackLocale && locale === fallback && …)`,
so a single `loadTranslations('es', route)` fetches **both** `es` and `en`.
An earlier "fix" added a manual `loadTranslations('en')` + a second
`loadTranslations(initLocale)` to undo the locale flip it caused; that was
treating a symptom of the discarded-argument bug and has been reverted.
Never call `loadTranslations()` with the fallback locale — it also calls
`setLocale()` and flips the whole UI to English.

**How to verify** (30 seconds, no build needed — write the probe inside
`apps/dashboard/` so pnpm resolves the package):

```javascript
const { t, locale, translations, loadTranslations } = new i18n(config);
await loadTranslations('es', '/courses');
console.log(Object.keys(translations.get()), locale.get(), t.get('courses.heading'));
// want: [ 'en', 'es' ] es Cursos
// only ['es'] → fallback not configured (check the constructor argument)
// active 'en' → something force-loaded the fallback locale
```

### Bug A: whole blocks nested under `course` in `es.json`

**Root cause of "no carga ningún idioma".** A bad search/replace swallowed 36
top-level blocks into `course.*` in `es.json` — `course.settings` (450 keys),
`course.widgets`, `course.programs`, `course.app`, `course.courses`… `es.json`
had 23 root keys where `en.json` had 56, so ~1150 keys resolved only via the
English fallback and, while the fallback was broken, rendered as literals.

**Detection** — the orphan-block scan is the fast tell: any `es` key path with
no counterpart in `en` is almost always misnesting, not a genuine extra key.

```javascript
const orphans = [...esKeys].filter(k => !enKeys.has(k));
// group by first two segments; a group with hundreds of keys = a hoisted block
```

**Repair** — deep-merge `es.course[k]` into root `es[k]` for every `k` that is
top-level in `en.json` and NOT under `en.course`, with **root values winning**.
The root copies are the hand-curated rioplatense ones ("Compartí", "invertí");
the nested duplicates are machine-translated formal-usted and even carried a
bogus `"AulaIO"` brand. The 11 legitimately nested blocks (`navItem`, `search`,
`header`, `sidebar`, `creator`, `sources`, …) must stay put — that's why the
filter checks `en.course` too.

Root keys are now sorted alphabetically in `es.json` so this class of drift
shows up in diffs.

### Bug A2: misplaced `sources` block

The `course.sources.*` block ended up nested inside `course.snackbar.*`
because the search/replace pattern matched the wrong `submissions` block
(line 294 — a submissions inside `course.snackbar`, not the real
`course.submissions`).

**Fix**: programmatic move via Node script
(`move_ai_assistant.js`-style):

```js
const j = JSON.parse(fs.readFileSync(path, 'utf8'));
j.ai_assistant = j.course.ai_assistant;  // root
delete j.course.ai_assistant;
fs.writeFileSync(path, JSON.stringify(j, null, 2) + '\n', 'utf8');
```

The **same block was misplaced in `en.json` too**, as `snackbar.sources`
(34 keys) — so the whole Sources panel rendered literals for English users
even after `es.json` was fixed. Moved to `course.sources`. Lesson: when you
find a misnested block, check *every* locale file, not just the one you were
looking at.

### Bug B: trailing `}` missing

Programmatic writes with `JSON.stringify(j, null, 2) + '\n'` can lose a
trailing brace when re-emitting. The JSON.parse only fails on the second pass
(Vite's `vite:json` plugin catches it on first load).

**Diagnostic script**: `braces.js` — counts `{` vs `}` after stripping
strings, finds the unclosed section. Run it whenever the JSON feels broken.

### Bug C: `ai_assistant.*` keys were under `course.ai_assistant` in `es.json`

The chat code uses `$t('ai_assistant.empty_state')` (root level). But `es.json`
had it nested under `course.ai_assistant`. `en.json` had it at root.
Front-end looked correct in English (which is the default in our build).

**Lesson**: always diff key paths between `en.json` and `es.json` after edits:

```js
const path = [];
function walk(o, d){...}
walk(en); walk(es);
```

The `finderr.js` and `compare.js` scripts we used during debugging are
in `C:\Users\samu\AppData\Local\Temp\opencode\` for reference but not in the
repo.

### Bug D: many other missing keys

Symptom: literal key text rendered in the UI
(`courses.course_card.unpublished`, `org_navigation.courses`,
`public_course.powered_by`).

**Pattern**: when a key shows up in en.json but not es.json, copy the
english-shaped value and translate. Use the additive `if (!j.X) j.X = {...}`
script pattern, never a blanket replace.

**Tools in `C:\Users\samu\AppData\Local\Temp\opencode\`** (not committed):

```js
// diff_keys.js — list every key in en.json that's missing in es.json
const enKeys = collectKeys(en);
const esKeys = collectKeys(es);
const missing = enKeys.filter(k => !esKeys.has(k));
```

Use it before declaring an i18n job done.

### Bug E: my org_navigation script only added 8 keys

The `add_org_nav.js` script only copied 8 of 22 `org_navigation.*` keys because
I used a hand-written map. The remaining keys rendered as literals.
**Fix**: copy ALL keys from en.json with English fallback + fallbackLocale.
Run `diff_keys.js` to find any remaining gaps.

### The audit to run before declaring any i18n job done

Diffing `en.json` against `es.json` is the *wrong* question — it flags 1000+
keys nobody uses and misses keys absent from both. Audit against the **keys the
code actually asks for** instead. Run from `apps/dashboard/`:

```javascript
// collect every $t('a.b') / t.get('a.b') literal under src/
const used = new Set();
for (const m of source.matchAll(/\$?t(?:\.get)?\(\s*['"`]([a-z0-9_]+(?:\.[a-z0-9_]+)+)['"`]/gi))
  used.add(m[1]);

// three buckets, in severity order
[...used].filter(k => esKeys.has(k));                    // Spanish  ✅
[...used].filter(k => !esKeys.has(k) && enKeys.has(k));  // English fallback ⚠️
[...used].filter(k => !esKeys.has(k) && !enKeys.has(k)); // LITERAL  ❌
```

Baseline after the 2026-08-02 repair: **2444 / 2444 / 0 / 0** — every key the
code uses resolves in Spanish, nothing falls back, nothing renders literal.
If a later change makes bucket 2 or 3 non-zero, that's a regression.

The regex only catches string literals; keys built dynamically
(`$t(\`course.${x}.title\`)`) are invisible to it, so a clean audit is a
necessary condition, not a sufficient one.

---

## 7. Common pitfalls

### Svelte `extends` + `$state` private-field clash

```svelte
class SourcesApi extends BaseApiWithErrors {
  isLoading = $state(false);  // ❌ CRASHES
}
```

`BaseApi` already declares `isLoading = $state(false)`. Svelte 5 compiles
`$state(false)` to a private `#isLoading` field. Re-declaring in a subclass
generates a brand-new private field that doesn't have the getter/setter from
the parent. At construction time the subclass constructor runs before the
parent's `super()`, so `this.isLoading = X` tries to set the parent's
`#isLoading` and crashes with:

```
TypeError: Cannot read private member #isLoading from an object whose
class did not declare it
```

**Fix**: drop the field in the subclass. Use `this.isLoading` (inherited
publicly) and let `execute()` set it.

### `from '$features/ui/snackbar'`

This **does not exist**. The right import is
`from '$features/ui/snackbar/store'`. Many components get this wrong; if you
see "Failed to resolve import '$features/ui/snackbar'" in the Vite overlay,
fix the path. There's no `index.ts` re-export in
`src/lib/features/ui/snackbar/`.

### `BaseApiWithErrors` is extended correctly but `$state` fields are
### exclusive

The base class declares `isLoading`, `error`, `success`. Subclasses should
**not** re-declare these — extend the API with new `$state` fields only
(`sources`, `isUploading`, `deletingId`, etc.).

### `documentId` in chat metadata

The chat builds `metadata.attachment.documentId` on the user message. The
backend then `collectDocumentIds()` walks the message history for that key.
If you add multi-PDF support in the future, this is the spot that needs to
become an array.

### Accidentally deleting exports when re-editing

When using `edit` with multiple `oldString` matches, double-check before
confirming. In particular, when wrapping logic around an early-return
(short-circuit) at the top of a function, it's easy to lose the function's
"happy path" continuation. After a large edit, run `pnpm build` (or
`pnpm --filter @cio/api build`) and grep for the expected exports.

---

## 8. The migration story (for context)

We migrated from Google Gemini to MiniMax-M3 as the chat provider (with
`CHAT_PROVIDER=minimax`). Why:

- Gemini free tier hit limits during testing
- MiniMax-M3 has 1M context (vs Gemini's 32k–128k) — fits our largest courses
- Cost: roughly $0.30/M input tokens vs Gemini's similar pricing, but cache
  reads at $0.03–$0.06/M makes the effective cost much lower for the same
  multi-turn course-building session
- `CHAT_PROVIDER` env var (`minimax` or `google`) is the single toggle. With
  no key for the preferred provider, falls back to the other (so a misconfigured
  deploy doesn't silently disable the agent).

Embeddings + RAG stayed on Google (`gemini-embedding-001` at 3072 dims,
stored as `halfvec` in Postgres — see `packages/db/src/schema.ts`). The
`getEmbeddingModel()` helper only ever uses Google regardless of `CHAT_PROVIDER`.

### Code locations to know

- `packages/ai-assistant/src/providers/index.ts` — provider registry
- `packages/ai-assistant/src/providers/index.ts:146` — `pickAnyConfiguredProvider`
  (chat-side; accepts `[MINIMAX, GOOGLE]` only — Anthropic/OpenAI/Moonshot are
  listed in the registry but excluded at chat time)
- `packages/ai-assistant/src/prompt/teacher.ts` — system prompt (~12.6k tokens
  full version; scoped per phase)
- `apps/api/src/services/agent/document-cache.ts` — cache module
- `apps/api/src/services/agent/document.ts` — upload/parse/redis
- `apps/api/src/services/agent/embeddings.ts` — Google embeddings
- `apps/api/src/routes/agent/agent.ts` — chat endpoint
- `apps/api/src/routes/agent/documents.ts` — Sources panel endpoints
- `apps/api/src/routes/agent/history.ts` — chat history
- `apps/api/src/utils/redis/key-generators.ts` — Redis key helpers (incl.
  `computeContentHash`, `agentDocumentCacheKey`, `agentDocumentCacheKeyByContent`)

### Environment variables

```
CHAT_PROVIDER=minimax           # minimax | google
MINIMAX_API_KEY=sk-cp-...       # required for chat (only when CHAT_PROVIDER=minimax)
MINIMAX_MODEL=MiniMax-M3       # optional override
GOOGLE_API_KEY=AIza...         # required for embeddings/RAG only (NOT chat)
GOOGLE_MODEL=gemini-flash-latest  # for text/title generation (rarely used)
DOCUMENT_CACHE_ENABLED=true    # master switch for document cache
GEMINI_EXPLICIT_CACHE=true     # legacy alias for DOCUMENT_CACHE_ENABLED
```

`GOOGLE_API_KEY` is **never** read by the chat path. The only non-test
production code that reads it is `embeddings.ts` (legitimate) and
`document-cache.ts` for the Gemini-cachedContent backend (which is dormant
when `CHAT_PROVIDER=minimax`).

---

## 9. Debugging checklist for "cache not working"

When `cache hit=0%` shows up in the log and the user complains about cost
or speed:

1. **Check the provider** — confirm `CHAT_PROVIDER` matches the active
   Anthropic-compatible backend. If `CHAT_PROVIDER=google` but `GOOGLE_API_KEY`
   is set, the system uses Google's native cachedContent (different code path).

2. **Check `excludeDocumentId`** — this used to silently strip the PDF from
   the prompt when `CHAT_PROVIDER` was MiniMax. The Anthropic-compatible path
   in `resolveDocumentCache` MUST return no `excludeDocumentId`. See the
   comment at `apps/api/src/services/agent/document-cache.ts:425-447`.

3. **Check the system message is an array** — MiniMax requires
   `system: [{ type: 'text', text: '...' }]`. A plain string is rejected.

4. **Check `cache_control` is on the right block** — must be on the
   `messages[].content[]` or the last `system` block, NOT the request-level
   `providerOptions` (which is the Anthropic SDK shape, not MiniMax's).

5. **Check the TTL field** — omit `ttl` entirely. `cache_control: { type:
   'ephemeral' }` only. TTL is server-side 5 min.

6. **Check the cache handle in Redis** —
   `docker exec cio-redis redis-cli KEYS "agent:document:cache:*"`. If empty,
   the handle was never created (provider mismatch or providerOptions
   format wrong).

7. **Check the second request** — first request is always cache miss
   (this is normal). Second request within 5 min should hit.

---

## 10. Things we considered but didn't ship

- **PDF as `type=document`** — Anthropic supports it natively, MiniMax does
  not. We inline text instead.
- **Multi-PDF in chat** — backend supports `documentIds: string[]` but the
  chat input only handles one at a time. Would require `uploadedDocuments`
  array + multiple metadata entries on the message.
- **Per-source token savings counter** — would need a separate endpoint that
  computes `cache_read_tokens × (input_price - cache_read_price)` per document
  across all conversations. Cheap to add later; skipped for now.
- **MiniMax file uploads (`mm_file://{file_id}`)** — needed only for
  videos >50 MB. We don't process videos today.

---

## 11. Multi-user cache sharing (the architecture we built)

### The problem we solved

Two instructors of the same org work on the same course. Both upload
`apuntes.pdf`. Without sharing, each pays the full cache-creation cost
(~5× input price for the first chat turn, then ~10% on subsequent turns).
With sharing, the second user's upload is deduplicated — same content
hash → same cache entry → second user reads from cache at 10% cost.

### Key shape

```
agent:document:cache:course:<courseId>:<contentHash>   ← NEW shared key
agent:document:cache:<documentId>                     ← LEGACY single-user
```

The shared key is the preferred path. The legacy key is read-only
backward-compat — handles written before the migration can still be read
but new handles always go to the shared key.

### Storage flow

1. User uploads PDF → `parseAndStoreDocument`
2. `computeContentHash(extractedText)` → SHA-256 hex
3. `findChatDocumentByContentHash(courseId, contentHash)`
4. **Hit** → return existing `documentId`, copy text to per-user Redis cache.
   **No S3 upload, no DB insert, no cache creation.**
5. **Miss** → create new `documentId`, upload to S3, insert row with
   `content_hash`, write per-user Redis cache.

### Cache handle flow (Anthropic-compatible)

`ensureAnthropicDocumentCache({ documentId, courseId, contentHash, redis })`:

1. Try shared key `agent:document:cache:course:<courseId>:<contentHash>`
   - Hit → slide TTL forward, return handle
2. Fallback to legacy key `agent:document:cache:<documentId>` (read-only)
3. Miss → create new handle in the **shared** key
4. Return handle

### Status / refresh / reconcile

`getDocumentCacheStatus`, `refreshDocumentCache`,
`reconcileCourseSourceCache` — all three accept optional
`(courseId, contentHash)`. If present, the shared key is preferred.

⚠️ **`agentDocumentCacheKeyByContent` strips every non-hex character from the
hash** (`contentHash.replace(/[^a-f0-9]/gi, '').slice(0, 32)`). Real hashes are
SHA-256 hex so this never bites in production, but a test fixture like
`contentHash: 'h1'` silently becomes `'1'` and your seeded Redis key will not
match. Use hex-shaped fixtures.

**Key unification (fixed 2026-08-02).** This section used to claim "the badge is
reporting on the same key the chat will hit". It was false: `resolveDocumentCache`
never accepted `courseId`/`contentHash`, so the chat wrote the **legacy**
per-document key while the Sources panel wrote the **shared** key. Reads happened
to paper over it (`readCacheHandle` falls back to legacy), but two handles could
exist for one document and the shared one was never read by anything.

There is now exactly one writer — `recordAnthropicCacheHit` — and `agent.ts`
resolves `(courseId, contentHash)` via `getChatDocumentCacheKey(documentId)`
before the stream, so the key written is the key the panel reads.

Note the shared key matters less than it looks: dedup already returns the *same
documentId* to the second user, so the legacy key was shared too. It earns its
keep for legacy rows whose `content_hash` is NULL and for content that landed
under different documentIds.

### Multi-org / multi-course isolation

| Same content uploaded to              | Same cache? | Why                                |
|----------------------------------------|-------------|------------------------------------|
| Different orgs                         | ❌ No       | Different cost allocation; future orgId key possible |
| Same org, different courses           | ❌ No       | courseId part of the key           |
| Same org, same course, different users | ✅ Yes      | share via contentHash              |
| Same user, different conversations     | ✅ Yes      | same documentId → same key         |

### Where to look in the code

- `apps/api/src/utils/redis/key-generators.ts`
  - `agentDocumentCacheKey(documentId)` — legacy
  - `agentDocumentCacheKeyByContent(courseId, contentHash)` — new
  - `computeContentHash(text)` — SHA-256
- `apps/api/src/services/agent/document-cache.ts`
  - `ensureAnthropicDocumentCache` — checks shared first, writes shared
  - `getDocumentCacheStatus` / `refreshDocumentCache` — accept shared key
  - `releaseDocumentCaches` — clears both legacy and shared
  - `reconcileCourseSourceCache` — accepts `(courseId, contentHash)` per doc
- `packages/db/src/schema.ts` — `ai_chat_document.contentHash` + index
- `packages/db/src/queries/agent/chat-document.ts`
  - `findChatDocumentByContentHash(courseId, contentHash)` — dedup lookup
  - `getChatDocumentCacheKey(documentId)` — returns `{courseId, contentHash}`
- `apps/api/src/services/agent/document.ts` — `parseAndStoreDocument` calls
  `computeContentHash` + `findChatDocumentByContentHash` before creating a row
- `apps/api/src/routes/agent/documents.ts` — `cache-status` and
  `refresh-cache` endpoints use `getChatDocumentCacheKey`

### Migration

```
ALTER TABLE ai_chat_document ADD COLUMN content_hash text;
CREATE INDEX idx_ai_chat_document_course_hash ON ai_chat_document (course_id, content_hash);
```

Migration file: `packages/db/src/migrations/0004_add_content_hash.sql`.
Already applied to the dev DB. Run with:

```bash
cat packages/db/src/migrations/0004_add_content_hash.sql | docker exec -i cio-postgres psql -U postgres -d classroomio
```

### Frontend follow-ups (not yet done)

- Sources panel: group duplicate uploads visually, show "shared with N users"
  badge when the same `contentHash` exists for users other than the current
  one.
- Chat: support `uploadedDocuments[]` (multi-PDF) so the user can attach
  several sources to a single message.
- Org-level cost dashboard: count cache_read vs cache_write tokens to show
  how much money sharing is saving the org.

---

## 12. Open work / next session

When we resume:

1. **Frontend Sources UI: dedup grouping** — show "(shared with N users)" badge
   on a source card when `count(distinct user_id where content_hash = ?) > 1`
   for the same course.
2. **Multi-PDF in chat** — change `uploadedDocument: UploadedDocument | null`
   to `uploadedDocuments: UploadedDocument[]` and inject all IDs into
   `metadata.attachment.documentIds` (array, not scalar). Backend already
   supports `documentIds: string[]`.
3. **Pre-existing `apps/dashboard/tsconfig.json` warning** — vite's
   generated `.svelte-kit/tsconfig.json` has paths like `@cio/ui/*` mapped
   to `../node_modules/@cio/ui/src/*/*` (double wildcard). TypeScript warns
   but it doesn't break the dev server or the api build. Fix the upstream
   alias config or add `tsBuildInfoFile` exclusion.
4. **Cost dashboard** — surface cache_read tokens × (input - cache_read) as
   "money saved this period" on the org settings page. Backend already has
   `ai_token_usage` table with the breakdown.
5. **Does the agent reach `generate_course_plan`?** — it narrated "voy a generar
   el plan" and stopped without calling the tool. The tool WAS offered (it is in
   the `plan`-mode `activeToolNames` list), and that turn had no document in
   context, so starvation is the leading hypothesis but unconfirmed. The
   `[agent.chat] phase=… finish=… toolCalls=[…] docInline=…` log line added this
   session answers it in one run. If `docInline=true` and `toolCalls=[NONE]`,
   the problem is model adherence, not context.
6. **`ai-credits-usage.test.ts` does not load** — vitest cannot resolve
   `@cio/db/queries/agent` from `usage.ts`. Verified pre-existing (fails on a
   clean HEAD too), so it is an alias-config gap, not a regression.
7. **No typecheck for `apps/dashboard`** — `svelte-check` is not installed and
   there is no `check` script, so dashboard changes are only verified by Vite
   compiling them. Worth adding.

The TODOs at the top of the TODO list were the source of truth when the
last session ended — check `git log --oneline | head -10` and the project's
`.todos.json` (if present) to recover the rest.