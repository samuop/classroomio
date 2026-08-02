# MiniMax Integration — Lessons Learned

> Living document. Anything new we discover about MiniMax-M3, Anthropic-compatible
> APIs, prompt caching, document handling, or anything adjacent goes here. Read
> this end-to-end before touching the AI agent code — these are the gotchas that
> cost us real debugging time.

**Last major update**: 2026-08-01 (after the cache / sources-panel sprint)

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
  ? { providerOptions: { anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } } } }
  : {})
```

⚠️ **Don't include `ttl: '1h'`** when talking to MiniMax. The SDK uses the
Anthropic default of 1h, but MiniMax enforces its own 5m. Either way, the
`ttl` field is silently ignored (or rejected). The first version of this code
sent `ttl: '1h'` and it worked at the wire level (no error) but **the cache
was never actually created** because MiniMax didn't recognize the parameter
shape. Lesson: omit `ttl` when targeting MiniMax.

### Conversation-id vs document-id scoping

The cache is keyed on the **documentId**, not the conversationId. So opening
a brand-new chat and re-sending the same PDF will hit the cache **if the
PDF was uploaded within the last 5 minutes**. This is great for our flow
because the Sources panel is shared across all conversations in a course.

### Cache handle in Redis (Anthropic-compatible backend)

For MiniMax/Claude we only store a **local handle** in Redis (a marker
saying "this document is currently cacheable"). We do NOT call any
server-side endpoint to create the cache — MiniMax creates it implicitly on
the first request that includes the `cache_control` hint. See:

- `apps/api/src/services/agent/document-cache.ts:286` —
  `ensureAnthropicDocumentCache` (Redis-only, no HTTP call)
- `apps/api/src/services/agent/document-cache.ts:415` —
  `resolveDocumentCache` returns `providerOptions: { anthropic: { cacheControl: ... } }`
  and (now) **does NOT** set `excludeDocumentId` for the Anthropic-compatible
  backend (older code did, which silently broke the cache by removing the
  document text from the prompt).

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
word_count        int
page_count        int
created_at        timestamp with timezone
```

The `course_id` denormalization is what makes the Sources panel query
(`WHERE course_id = ? AND user_id = ?`) a single-index lookup instead of a join
across conversations. **Don't drop the column** without also rewriting
`listChatDocumentsByCourse` in
`packages/db/src/queries/agent/chat-document.ts`.

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

### Reconciliation policy (Phase 4)

For every source in the course:
1. **No handle in Redis** → create one (`rebuilt`/`no_handle`)
2. **Handle expired** → rebuild (`rebuilt`/`expired`)
3. **Handle valid + text unchanged** → keep (`kept`)
4. **Handle valid + text changed** → rebuild (`rebuilt`/`text_updated`)
5. **Document too small for cache** → release any leftover handle
   (`released`/`too_small`)

Implementation: `apps/api/src/services/agent/document-cache.ts:481` —
`reconcileCourseSourceCache(documents, redis)`.

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
message metadata — not done yet.

---

## 6. i18n gotchas (`es.json`)

Three bugs that took real debugging time:

### Bug A: misplaced `sources` block

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
- **Switching provider mid-conversation** — `pickAnyConfiguredProvider` is
  read once at chat construction. Switching provider requires a new
  conversation. Acceptable for now.