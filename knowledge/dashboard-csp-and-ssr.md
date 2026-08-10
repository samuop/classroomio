# Dashboard: CSP, uploaded media, and dev-SSR breakage

> Two failures that look unrelated but bit us in the same session. Both are
> silent — no error in the server log, no CSP violation report — so you can burn
> an hour blaming infrastructure that is perfectly healthy.

**Last updated**: 2026-08-02

## TL;DR

- Uploaded images render as "Failed to load" when the storage **origin** is
  missing from `img-src`. `curl` returns 200; only the browser blocks it.
- The origin now comes **only** from `PUBLIC_MEDIA_HOST`. It used to be gated on
  `NODE_ENV`, which `svelte.config.js` cannot read reliably.
- The API bakes **absolute** asset URLs into the DB at upload time. Changing the
  storage host breaks every old row and no CSP change can fix it — it needs a
  data migration.
- Never import the `$features/ui` barrel from a server-rendered route: it drags
  `layerchart` into the SSR graph and Vite's dev SSR runner dies on a circular
  dependency.

## 1. "The image server went down" (it didn't)

Symptom: some course cards show a red "Failed to load"
(`apps/dashboard/src/lib/features/ui/image.svelte`), others render fine.

**A partial failure is never an outage.** Cards with an empty `course.logo` fall
back to a static asset (`/images/…-template.jpg`) and always work; only cards
with an uploaded logo break. Check the data before the infrastructure:

```bash
docker exec cio-postgres psql -U postgres -d classroomio -t -A \
  -c "select title, coalesce(logo,'<NULL>') from course order by created_at desc limit 10;"
```

Then confirm the object is actually served — `curl` ignores CSP, so a 200 here
plus a broken `<img>` in the browser *is* the CSP signature:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:9000/media/<key>"
```

Finally read the policy the server really emits (not the one you think it
computes):

```bash
curl -s -D - -o /dev/null http://localhost:5173/login \
  | grep -i "^content-security-policy:" | tr ';' '\n' | grep -E "img-src|media-src"
```

## 2. Why the origin vanished from `img-src`

`svelte.config.js` had:

```javascript
const isDev = process.env.NODE_ENV !== 'production';
const devMediaSrc = isDev ? ['http://localhost:9000'] : [];
```

`svelte.config.js` is evaluated **before Vite normalizes `NODE_ENV`**, so `isDev`
is a guess about an environment that has not been set up yet. In a shell where
`NODE_ENV=production` leaked in, `isDev` was `false` under `vite dev` and
`localhost:9000` silently disappeared from `img-src`.

Now the origin comes from `PUBLIC_MEDIA_HOST` alone, so build-time and runtime
agree and there is nothing to guess:

| Environment | Where it is set |
|---|---|
| local dev | `apps/dashboard/.env` → `http://localhost:9000` |
| prod | `.github/workflows/deploy-classroomio.yml` → `learn-files.tensor.com.ar` |

It **must** cover the host in the API's `OBJECT_STORAGE_MEDIA_PUBLIC_BASE_URL`.

Two mechanisms feed the policy — know which one you are editing:

- **build time** — `PUBLIC_MEDIA_HOST` → `getCspDomains()` → `svelte.config.js`
- **runtime** — `CSP_MEDIA_SRC_DOMAINS`, `PUBLIC_SERVER_URL` etc. →
  `applyCspExtensions()` in `src/lib/utils/csp.ts`, appended to the header per
  response

`PUBLIC_SERVER_URL` reaching `connect-src` comes from the **runtime** path. That
is why self-hosted builds work even though `getCspDomains()` returns
`apiOrigin: null` for them.

⚠️ `vite dev` does **not** re-read `svelte.config.js` or `.env` on change. A
config edit that "does nothing" almost always means the dev server is stale —
restart it before debugging further.

## 3. The real design flaw: absolute URLs in the DB

`uploadImage()` (`apps/api/src/services/media.ts:65`) stores
`${OBJECT_STORAGE_MEDIA_PUBLIC_BASE_URL}/${fileKey}` — an absolute URL — into
`course.logo`, `organization.avatar_url`, `profile.avatar_url` and friends. The
host is frozen per row at upload time.

Consequence: change the storage domain and every previously uploaded asset
breaks, permanently, and no CSP tweak helps. Find the damage with:

```sql
select 'course.logo', count(*) from course where logo like '%localhost%'
union all select 'organization.avatar', count(*) from organization where avatar_url like '%localhost%'
union all select 'profile.avatar', count(*) from profile where avatar_url like '%localhost%';
```

The proper fix is to persist the **relative key** and resolve the host at render
time. Not done yet — until then, a host change needs a data migration.

## 4. `$features/ui` barrel poisons server-rendered routes

Symptom, on a **cold** dev server only:

```
[vite] The dependency module is not yet fully initialized due to circular dependency.
  at layerchart/dist/components/graph/Dagre.svelte:6
```

…and every SSR route returns 500. Production builds are fine (Rollup handles the
cycle), so `curl https://learn.tensor.com.ar/login` returning 200 does **not**
clear dev.

Chain: `$features/ui/index.ts` re-exports `CourseLandingPage` → `@cio/ui` (root
barrel) → `base/chart` → `layerchart`. `layerchart` is in `ssr.noExternal`, so
Vite bundles it for SSR and hits the cycle.

The known fix `export const ssr = false` in `routes/(app)/+layout.ts` only
covers the `(app)` group. `(auth)`, `(org-site)` and `/invite` still SSR — and
`src/routes/+layout.svelte` is the root layout, so its barrel import poisoned
**every** page.

**Rule: server-rendered routes import component files directly.**

```javascript
import Snackbar from '$features/ui/snackbar/snackbar.svelte';  // ✅
import { Snackbar } from '$features/ui';                       // ❌ pulls layerchart
```

Fixed in `+layout.svelte` and in the 7 routes importing `AuthUI` from the
barrel. Guard against regressions:

```bash
grep -rn "from '\$features/ui'" src/routes --include=*.svelte
# should only match routes under (app)/, which are ssr = false
```

**This one only shows up after a restart.** A long-running dev server keeps
serving fine because its modules are already instantiated, so the breakage can
sit latent for days after the commit that introduced it — `ssr.noExternal` was
added in `44a0a54b7` and was never actually exercised in dev until the next
restart.

## 5. Triage note: an empty 500 from the API is usually a dead container

`POST /api/auth/sign-in/email` returning **500 with an empty body** is not an
auth bug — better-auth answers bad credentials with a clean `401`. A 500 with no
payload means the handler threw before it could build a response, and locally
that is almost always Postgres.

The confusing part is that the rest of the app keeps working: the dashboard's
`+layout.server` had just logged `API Response: 200 OK`, because cached/static
paths never touch the DB. So "the API is up" proves nothing.

```bash
docker ps                                    # cio-postgres / cio-redis / cio-minio present AND healthy?
docker exec cio-postgres psql -U postgres -d classroomio -c '\dt'
# "container ... is not running" → that's your 500
```

Same shape as §1: **check the layer that actually failed before rewriting the
layer you suspect.** Reproduce with deliberately wrong credentials — if bad
credentials give 500 instead of 401, the failure is infrastructure, not logic.

## 6. A 500 the API never saw: the proxy's 512 KB body limit

Attaching a 2.4 MB PDF to a course's Sources failed with a generic 500, and
`api-out.log` had **no record of the request** — the last `POST /agent/upload`
in it was a week old. That absence is the clue: the browser talks to the API
through `/proxy` on the same origin (see `getRequestBaseUrl`), so every upload
crosses the dashboard first, and adapter-node caps request bodies at **512 KB**
by default.

```
dashboard-error.log:
  msg: 'Content-length of 2486543 exceeds limit of 524288 bytes.'
  at get_raw_body (build/handler.js:972)
  at getRequest (build/handler.js:1044)
```

Two things make it nasty. The check runs inside `getRequest`, **before any
route handler**, so it cannot be caught or turned into a friendly 413 by
application code. And the upload dialog advertises "PDF, DOCX o PPTX de hasta
25MB" — the UI promised fifty times what the transport allowed.

**Fix**: `BODY_SIZE_LIMIT` on the dashboard's `.env` (written by the deploy
workflow). Set to 32 MB so the real ceiling is the application's own
`MAX_AGENT_DOCUMENT_SIZE` (25 MB) and an oversized file gets the API's
explanatory 413 instead. Nginx was never the constraint — `client_max_body_size`
is already 200–500 MB in `/etc/nginx/sites-available/classroomio`.

**How to tell this class of failure apart from a real API error**: grep the API
log for the request. If it is not there at all, stop looking at the API — the
request died in Nginx or in the dashboard proxy. Same lesson as §1 and §5:
check the layer that actually failed.

A quick probe that needs no session, since the limit is evaluated before auth:

```bash
head -c 1048576 /dev/zero > 1mb.bin
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  'https://learn.tensor.com.ar/proxy/agent/upload?courseId=test' -F 'file=@1mb.bin'
# 500 → the body limit is still biting.  403/401 → the body got through.
```
