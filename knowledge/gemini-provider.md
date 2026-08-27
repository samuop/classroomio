# Gemini as the chat provider — switch-over runbook

**Last updated**: 2026-08-10. Written while making `gemini-3.5-flash-lite` a
provider we can move to on any given day, without a code change.

## TL;DR

- Flipping to Gemini is **two env vars and a restart** — `CHAT_PROVIDER=google`
  plus `GOOGLE_API_KEY`. No deploy needed if both are already in the VPS `.env`.
- **Gemini caches by itself.** Nothing is asked for and nothing is managed.
  Measured on this agent's request shape: **92% of a 53k-token prompt served
  cached from turn 2 onward**.
- **Never send `providerOptions.google.cachedContent`.** Gemini returns a hard
  400 when a cached handle meets a request that carries tools, and this agent
  sends ~26 tools on every teacher turn. This is the one trap in the whole file.
- The agent's full tool set is accepted by Gemini as-is — verified by sending
  the real 26 tools, not by reading a schema.
- `gemini-3.5-flash-lite` defaults to **zero thinking tokens**, so there is no
  hidden output cost to cap (unlike 3.1, which spends them at `thinkingLevel:
  low`).

## How to switch

In `/var/www/classroomio/apps/api/.env` on the VPS:

```
CHAT_PROVIDER=google
GOOGLE_API_KEY=...          # already present — RAG embeddings use it
GOOGLE_MODEL=gemini-3.5-flash-lite
```

Then `pm2 restart cio-api`. To go back, set `CHAT_PROVIDER=minimax`.

`GOOGLE_MODEL` is optional; without it the code default is
`gemini-flash-lite-latest`, an alias Google keeps pointed at the current stable
Flash-Lite. The alias never goes obsolete, but it also moves under you — pin the
version when you want a cost and behaviour you can reason about.

`pickAnyConfiguredProvider` soft-falls-back to the other provider when the
preferred one has no key, so a half-configured deploy degrades to a working
agent instead of a dead one.

## Caching: what actually happens

Gemini's cache is **automatic**. It matches the request prefix against what it
already processed and bills the overlap at the cached rate. Nothing to create,
renew, release or pay storage for.

Our request shape suits it exactly, because the expensive part is at the front:

```
system prompt (stable per phase)        ← 6.6k–9.3k tokens
source pack   (byte-identical per course)
context msg   (changes every turn)
transcript    (grows)
```

Measured with a ~30k-token source pack, five sequential turns:

```
turn   prompt   cached      %
  1     53065        0     0%   ← always a miss; the prefix is new
  2     53094    49102    92%
  3     53130    49095    92%
  4     53164    49088    92%
  5     53191    49080    92%
```

The first turn missing is normal, not a bug — same as MiniMax.

**Prefix size matters.** Below roughly 15k tokens the automatic cache often does
not engage at all (measured 0% at 10.5k on 3.5-flash-lite, while 2.5-flash-lite
and 3.1-flash-lite hit at the same size). So a short chat with no material
attached gets no discount. That is the cheap case anyway; the expensive case —
a build round carrying a document — is comfortably above the line.

### The trap: `cachedContents` + tools = 400

There is also an *explicit* cache API (`cachedContents`). Do not reach for it:

```
400 CachedContent can not be used with GenerateContent request setting
    system_instruction, tools or tool_config.

Proposed fix: move those values to CachedContent from GenerateContent request.
```

Verified against the live API. `@ai-sdk/google` does send the option, so this is
a real 400 on every teacher turn, not a silently ignored field.

Google's suggested fix does work — put `systemInstruction` and `tools` inside
the cached content and omit them from the request — but it welds each cache to
one exact prompt version and tool set. Ours changes per phase (plan vs build),
and the AI SDK has no way to withhold `tools` from a request while still
executing the calls that come back. The automatic cache gives a bigger discount
over a wider prefix for free, so the explicit one buys nothing here.

`resolveDocumentCache` therefore returns `{}` for Google, with **no
`excludeDocumentId`** — pulling the text out of the prompt is how the agent ends
up holding no document at all.

## The Sources panel badge

Works under Gemini. `cachedContentTokenCount` arrives as
`usage.inputTokenDetails.cacheReadTokens` through the same SDK field MiniMax
uses, so `recordObservedCacheHit` lights the badge from real billed reads on
either provider.

There is **no countdown** any more. It only ever made sense while we owned a
`cachedContents` lease; now both providers report the same kind of fact — "it
served N cached tokens, this long ago".

## Model availability (measured 2026-08-10)

Models offering `createCachedContent` and a 1,048,576-token window:
`gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`,
`gemini-3.1-flash-lite`, `gemini-3-flash-preview`, `gemini-2.5-flash`,
`gemini-2.5-flash-lite`, plus the `-latest` aliases.

`gemini-flash-lite-latest` currently behaves identically to
`gemini-3.5-flash-lite`, including its automatic-cache threshold.

## Web research runs on Grounding with Google Search

Finding pages (`search_web` and the course wizard's research switch) used to run
on `s.jina.ai`, chosen when chat was on MiniMax through the Anthropic-compatible
shim, which has no server-side search. Since production moved to Gemini that
detour has no reason to exist, so discovery is now Gemini's own
`google_search` tool.

**Reading a page did NOT move.** `fetch_documentation_url` still goes through
`r.jina.ai`, so `JINA_API_KEY` is still worth setting (higher rate limits) —
it just no longer gates search. Gemini's `url_context` tool was considered and
rejected: it puts the page in the model's context instead of returning it, and
then there is nothing to store as a source, cache for 7 days, or wrap in
`<external_untrusted_document>`.

### Configuration

| Variable | Role |
|---|---|
| `GOOGLE_API_KEY` | **Gates research.** Same key as RAG and images; there is not one per service |
| `GOOGLE_SEARCH_MODEL` | Optional. The model that searches. Unset, follows `GOOGLE_MODEL` |
| `JINA_API_KEY` | Reading pages only |

Independent of `CHAT_PROVIDER`, like embeddings and images — verified running a
real search with `CHAT_PROVIDER=minimax` in the local `.env`.

### Cost

Grounding is billed per **request**, not per search inside it: 5,000 free search
requests a month across Gemini 3.x, then $14 per 1,000. A research run is 2
requests (quick), 3 (normal) or 4 (deep), so the free tier covers roughly 1,250
deep runs a month. Google's Custom Search JSON API would have been a closer
match to a plain search API, but it is **closed to new customers and stops
serving on 2027-01-01** — do not build on it.

### The redirect, which is the whole trick

Grounding never returns the page's own URL. Every citation arrives as
`https://vertexaisearch.cloud.google.com/grounding-api-redirect/<opaque>`, and
`web.title` is usually the bare domain (measured: `"datacolor.com"`). That URL
**expires**, so storing it as a source means a link that dies later.

`resolveGroundingRedirect` fetches it with `redirect: 'manual'` and reads the
`Location` header — no page download. Two consequences that are easy to get
backwards:

- **The SSRF guard runs AFTER the hop, never before.** Before it, every URL is
  `vertexaisearch.cloud.google.com`, so the guard would only ever be inspecting
  Google. Same for the login-wall/video host filter.
- **A citation that will not resolve is dropped**, not stored. An address that
  expires looks like a source right up until someone clicks it.

### Measured 2026-08-27 (`gemini-flash-latest`, "colorimetría de pinturas de paredes")

| | |
|---|---|
| one grounded call | 13.1s, 684 input / 2,323 output tokens |
| searches it ran itself | 7 (`webSearchQueries`) |
| pages cited | 22 chunks, 21 distinct domains |
| redirects resolved | 22/22 |

That is one call. A run makes one per angle (2/3/4 by depth), in parallel.

**The clock is the thing to watch.** A grounded call costs ~13s where Jina cost
~1s, so `RESEARCH_DEADLINE_MS` (48s, under Nginx's 60s default) covers searching
AND reading from a single start time in `runResearch`. Restoring it to a
reading-only budget adds ~15s on top and pushes deep runs into a 504 that reads
like a research bug rather than a clock. Guarded by the test *"spends one clock
on searching and reading, not one clock each"*.

### Why the queries are no longer ours

`deriveSearchQueries` — a separate model call that turned a topic into 2-4
search strings — is gone. Grounding writes and runs its own queries inside the
same request, and reports them in `webSearchQueries`, which is what the wizard
shows the teacher. What we still control is the **angle**: `RESEARCH_ANGLES`
asks for foundations, practice, references and worked examples separately,
because one search on a course topic returns catalogues.

The instruction asks for a *cited survey*, not a list of links, and that is
load-bearing: grounding only cites what it needed for the answer it wrote, so a
request for prose with a source per point is what returns 22 pages instead of 2.

## Common pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| Every teacher turn 400s with "CachedContent can not be used…" | Something re-introduced `providerOptions.google.cachedContent` | Return `{}` from the Google branch of `resolveDocumentCache`; the test `never asks for an explicit cachedContents handle` guards this |
| Agent answers as if there were no document | `excludeDocumentId` set on the Google path | The document must stay inline — Gemini's cache covers it there |
| `cache hit=0%` on every turn | Prefix under ~15k tokens, or the prefix changed | Expected for short chats. If a build round misses, check whether something now varies ahead of the source pack |
| Sources badge dark while the log shows cached reads | The observed-hit recorder is gated on the provider again | `recordObservedCacheHit` must run for both; only the `cache_control` tagging is Anthropic-only |
| API key rejected with `API_KEY_INVALID` | `.env` values are quoted and something read the file by hand | dotenv strips quotes; hand-rolled parsers must too |
| Research says "GOOGLE_API_KEY must be set" on an install where chat works | Chat is on MiniMax and only `MINIMAX_API_KEY` is set | Search is Google-only whatever `CHAT_PROVIDER` says — set `GOOGLE_API_KEY` |
| Sources show `vertexaisearch.cloud.google.com/...` links | The redirect stopped being resolved | `resolveGroundingRedirect` must run before anything stores or guards the URL |
| Research returns 2-3 pages instead of ~20 | The angle instruction stopped asking for a cited survey | Grounding cites only what its answer needed; a request for a link list returns a link list |
| Deep research 504s at the gateway | The search clock and the read clock were split again | One `deadline` from `runResearch`, passed into `readPages` |

## Code locations

- `packages/ai-assistant/src/providers/index.ts` — `CHAT_PROVIDER` handling,
  `DEFAULT_MODELS`, `resolveModelName`, and `getWebSearchModel` (the model +
  `google_search` tool, deliberately independent of `CHAT_PROVIDER`)
- `apps/api/src/services/agent/web-search.ts` — the grounded call, the redirect
  resolution and the order the guards run in
- `apps/api/src/services/agent/research.ts` — `RESEARCH_ANGLES`, the shared
  deadline, and the harvest loop
- `apps/api/src/services/agent/document-cache.ts` — the whole caching policy,
  including the module header explaining why Gemini gets no explicit cache
- `apps/api/src/routes/agent/agent.ts` — `hasInlineDocumentContext` /
  `hasSourcePackContext` (material rides in this request) and the
  `recordObservedCacheHit` call after the stream
- `apps/api/src/__tests__/document-cache.test.ts` — the "must not" assertions
  for the Google path
- `apps/api/src/services/agent/{title,text}-generation.ts` — already disable
  thinking on Google (`thinkingConfig: { thinkingBudget: 0 }`), because Gemini
  counts thinking against `maxOutputTokens`

Related: [`minimax-integration.md`](./minimax-integration.md) for the provider
we are switching away from, and [`agent-build-harness.md`](./agent-build-harness.md)
for how the source pack gets built in the first place.
