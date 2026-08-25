# Knowledge Base

Living documentation of everything we've learned while building this project.
This directory is checked into git so future agents (and humans) can pick up
where we left off.

## Files

- [`minimax-integration.md`](./minimax-integration.md) — everything about the
  MiniMax-M3 Anthropic-compatible API: caching, document handling, the
  Sources panel, the gotchas that took us a day to debug. Also §6: i18n
  (`fallbackLocale`, misnested blocks, the key-coverage audit).
- [`gemini-provider.md`](./gemini-provider.md) — switching the chat agent to
  Gemini: the two env vars, how its automatic cache behaves (92% measured), and
  the `cachedContents` + tools 400 that makes the explicit cache unusable here.
- [`dashboard-csp-and-ssr.md`](./dashboard-csp-and-ssr.md) — broken uploaded
  images (CSP vs `PUBLIC_MEDIA_HOST`, absolute URLs frozen in the DB) and the
  `$features/ui` barrel that 500s every server-rendered route.
- [`branding-y-correos.md`](./branding-y-correos.md) — cómo se sacó toda la marca
  ClassroomIO de lo que ve el usuario (incluido el cartel que aparecía justo
  cuando una pantalla se rompía), qué se conserva por licencia, y el layout de
  correo compartido con SaaS-RRHH.
- [`auditoria.md`](./auditoria.md) — qué queda registrado de cada request (quién,
  cuándo, qué endpoint, desde qué dispositivo, cuánto tardó) y de cada error, en
  `audit_event` / `audit_incident`. Un solo middleware, un solo mapa de rutas, y
  el reportador del navegador para lo que el servidor no puede ver. Se consulta
  con la skill `/auditoria`.
- [`agent-build-harness.md`](./agent-build-harness.md) — how sources become a
  built course: the plan registry (why the agent duplicated sections),
  server-measured progress, autonomous rounds, and the source pack / cache split.
  Read this before touching the plan → build flow.

## Conventions

- One file per "topic" (provider, subsystem, infrastructure choice).
- Plain Markdown. No special tooling — these are human/agent-readable.
- Each file should have:
  - A "TL;DR" at the top (2–5 bullets) so a fresh agent can decide whether to
    read the full file.
  - A "Last updated" date so you know how stale the info might be.
  - A "Files involved" or "Code locations" section pointing at the source of
    truth.
  - A "Common pitfalls" section with the symptoms + fix for the bugs we
    already paid to discover.
- **No** architecture decisions in here — those belong in code comments or
  `AGENTS.md` at the repo root. This directory is for **operational knowledge**
  (how to use the tools we wired up, what to do when X breaks).

## When to add a new file

- You discovered a non-obvious behavior of a third-party API
- You fixed a bug that took longer than 30 minutes to track down
- You made a design choice that future-you would want to revisit
- You learned a constraint (rate limit, max size, format) the hard way