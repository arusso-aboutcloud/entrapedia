# Operations

Operational notes for running Entrapedia's workers. This file grows per chunk.

## Ingestion worker (chunk 3a: fetch + store)

`workers/ingestion/index.js` fetches Tier-A source documents and stores them in
R2 (raw bodies) and the D1 `documents` registry. It performs **no embedding**
and writes **no `chunks` rows or vectors** (that is chunk 3b).

### Required secrets

Set as Worker secrets (never committed):

| Secret | Purpose |
|---|---|
| `GITHUB_TOKEN` | GitHub token, **public-repo read is sufficient**. Sent as a Bearer token on GitHub API and `raw.githubusercontent.com` calls to lift the unauthenticated 60/hr rate limit. |
| `TRIGGER_SECRET` | Shared secret that guards the manual `/run` trigger. Pick a long random string. |

```sh
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put TRIGGER_SECRET
```

### Deploy

```sh
npx wrangler deploy
```

`wrangler.toml` wires `main`, the D1/R2 bindings, and the cron. (The `AI` and
`VECTORIZE` bindings are declared for later chunks and are unused here.)

### CI deploy (GitHub Actions)

`.github/workflows/deploy.yml` deploys on push to `main` (paths `workers/**`,
`wrangler.toml`, `schema/**`) and on manual dispatch. It uses no marketplace
actions (plain `git clone` of the public repo + pinned `npx wrangler`), so there
is nothing to SHA-pin. Required repository secrets:

| Repo secret | Purpose |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Deploy + set worker secrets (Workers Scripts:Edit + D1/R2/KV/Vectorize/Workers AI:Edit, Account Settings:Read). |
| `GH_DOCS_TOKEN` | GitHub fine-grained PAT, *Public repositories (read-only)*. The workflow pushes it onto the worker as the `GITHUB_TOKEN` secret. |
| `TRIGGER_SECRET` | Guards the worker's `/run` trigger; the workflow also uses it to drive the backfill. |
| `CLOUDFLARE_ACCOUNT_ID` | Recommended (kept out of the committed `wrangler.toml`); lets wrangler resolve the account unambiguously. |

Manual dispatch with a backfill, e.g.:

```sh
gh workflow run deploy.yml -f run_backfill=true -f iterations=8 -f source=graph-docs
```

### Cron

`crons = ["0 6 * * *"]` — a daily 06:00 UTC Tier-A reconcile. Because each run is
capped and resumable (below), the daily cadence first drives the incremental
backfill and then settles into steady-state sync.

### Manual trigger

The worker serves exactly one authenticated route, `POST`/`GET /run`:

```sh
# whole run (all sources), default caps
curl -H "Authorization: Bearer $TRIGGER_SECRET" "https://<worker-url>/run"

# one source, custom caps
curl -H "Authorization: Bearer $TRIGGER_SECRET" \
  "https://<worker-url>/run?source=graph-docs&max=25"
```

Query params: `source=<key>` (limit to one source), `max=<n>` (override
`MAX_FILES_PER_RUN`), `sub=<n>` (override `SUBREQUEST_BUDGET`). Any other path or
a missing/incorrect secret returns 404/401 — there is no unauthenticated trigger.

### Tuning the per-run caps

Two top-of-file constants in `workers/ingestion/index.js`:

- `MAX_FILES_PER_RUN` (default **25**) — bodies fetched + stored per invocation.
- `SUBREQUEST_BUDGET` (default **45**) — hard ceiling on subrequests per
  invocation. `fetch()`, R2, and D1 calls each count as one subrequest. **Workers
  Free allows 50 subrequests/request**; the default stays under it and lets the
  resumable walk continue next run. On Workers Paid (1000 subrequests) both can
  be raised for a faster backfill.

A run stops when either cap is reached and persists progress; the next run
resumes. To accelerate an initial backfill, trigger `/run` repeatedly (or
shorten the cron) rather than raising the caps past the subrequest limit.

### Tree walk (why it descends one level at a time)

The GitHub Git Trees API **truncates large recursive trees** (~100k entries /
7 MB) — `microsoft-graph-docs-contrib` exceeds it, so a single `?recursive=1`
call silently returns a partial tree and would miss high-value pages (e.g. the
Graph permissions reference). Worse on the free tier, a recursive call on a large
directory returns a multi-MB JSON whose **parse alone exceeds the Workers Free
CPU-time limit** (`error 1102`). The worker therefore **never fetches
recursively**: it lists **one directory level non-recursively per visit** and
enqueues child directories, walking the tree breadth-first. This bounds per-run
CPU and sidesteps truncation entirely, at the cost of more (small) tree calls.
The pending-directory **frontier is persisted in `sync_state.last_etag`**, so a
run capped mid-walk resumes the tree walk (not just the fetch step) on the next
invocation. No content sub-paths are hardcoded,
so the crawl stays self-maintaining against upstream repo reorganisation.

### What a run does (per source)

1. Resolve the repo default branch + head commit SHA.
2. No-op if the head is unchanged since the last completed walk.
3. Walk the directory frontier (descend-on-truncation), enumerating in-scope
   files. Filters: `.md` and content `.yml` only; skip dot-dirs (`.github`),
   any `includes/` directory at any depth (snippet fragments, including a
   repo-root `includes/`), `toc.yml`/breadcrumb/`*.config.yml`, media, `.json`,
   binaries.
   Repo-meta files at the repo root (`README`, `CONTRIBUTING`, `SECURITY`,
   `CODE_OF_CONDUCT`, `CHANGELOG`, `ThirdPartyNotices`, `LICENSE`) are excluded,
   and content `.yml` is restricted to the doc tree (below the repo root), which
   drops root build YAML such as `cabgen-bootstrap.yml`. `azure-docs-aad` is
   additionally scoped to `articles/active-directory/` and
   `articles/active-directory-b2c/` and tagged `layer=legacy`.
4. Diff each file's git blob SHA against `documents.content_hash`; fetch only
   changed/new bodies (via `raw.githubusercontent.com`).
5. Write each raw body to R2 (`{source}/{path}`) and upsert the `documents` row
   (`doc_id = {source}:{path}`, `content_hash = git blob SHA`).
6. Persist walk + sync progress to `sync_state`.

## Chunking (chunk 3b, phase 1: dry run)

`workers/ingestion/chunker.mjs` is a pure, dependency-injectable function
(`chunkDocument(body, meta, opts)`) that turns a stored doc body into chunk
objects for embedding. It does NOT write to the DB or call AI.

Strategy: strip YAML frontmatter (keep title/description/ms.topic as metadata);
split markdown on H1-H3 heading boundaries; target ~512 tokens (range ~256-640);
never split inside a fenced code block or a table; merge a tiny trailing section
into the previous chunk; keep the heading trail attached to each chunk for
context; chunk `.yml` content docs by top-level list entry. Token counting is an
injected function -- the default `estimateTokens()` is a WordPiece approximation
for bge-base that slightly over-counts (conservative for budgeting).

Phase-1 dry run (`docs/dryrun/chunk-dryrun-report.md`, 410-doc representative
sample across all four sources + priority/edge-case docs):

- **Projected full corpus: ~144,254 chunks** (graph-docs ~113k, entra-docs ~27k,
  entra-powershell ~2.3k, azure-docs-aad ~1.5k).
- Token distribution (estimate): min 49 / median 363 / mean 441 / p95 690 /
  max 9,980; ~82% of chunks land in the 256-512 band.
- Embedding cost: at an assumed (UNCONFIRMED) ~9 neurons/chunk for
  `@cf/baai/bge-base-en-v1.5`, a full first pass is ~1.3M neurons -> a multi-week
  job under the 10k-neurons/day free-tier cap. Confirms the embed-once /
  cache-forever / incremental model. (See the report for a 3-20 neuron/chunk
  sensitivity table.)
- **Open decision before phase 2:** a few un-splittable property/permission
  tables and large code blocks exceed bge-base's 512-token input limit (worst:
  `api-reference/v1.0/resources/user.md` ~9,980 tokens) and would be truncated at
  embed time. Proposed fix: split oversized tables by row-groups (header repeated
  on each split) while leaving normal tables intact.

## Embedding pass (chunk 3b, phase 2: NEURON-SPENDING)

The worker embeds chunked docs into Vectorize with `@cf/baai/bge-base-en-v1.5`
(768-dim), throttled under the free-tier daily neuron ceiling, resumable.

### Cost + throttle

- Cost: **6,058 neurons / 1M input tokens** (Cloudflare pricing for bge-base);
  ~3 neurons per ~441-token chunk. Per-chunk neurons are tracked as
  `ceil(min(token_count, 512) / 1e6 * 6058)`.
- `EMBED_NEURON_BUDGET = 9000` neurons/day (UTC) — a named, tunable constant ~1k
  under the 10,000/day free-tier hard stop (error 4006). Today's spend is tracked
  in `sync_state` row `@embed` (`{date, neurons}`, reset at 00:00 UTC); once the
  cap is hit, every run no-ops until the next UTC day.
- `EMBED_SUBREQUEST_BUDGET = 45` per invocation bounds docs/call (a whole doc's
  chunks go in ONE AI call + ONE Vectorize upsert + ONE D1 batch). Full corpus
  (~144k chunks) is ~43 days of daily-budgeted runs by design.

### Drive + schedule

- Cron `7,27,47 * * * *` runs the embedding pass 3x/hour; it self-throttles
  against the daily budget, so the corpus embeds incrementally on its own.
- Manual accel: `gh workflow run deploy.yml -f run_backfill=true -f mode=embed -f docs=20 -f iterations=30`
  (drives `/embed`; stops automatically at `daily_budget_reached`).
- `/embed` (Bearer `TRIGGER_SECRET`) params: `docs=<n>` (docs/call), `sub=<n>`,
  `neurons=<n>` (per-call daily-cap override).

### Priority + resumption

- Tiers (complete one before the next): **P1** permissions-reference + all
  graph `api-reference/**` + entra-docs identity-core (sign-in / conditional
  access / app+enterprise-app registration / authentication / identity-protection
  / identity-platform); **P2** rest of graph concepts + rest of entra-docs;
  **P3** entra-powershell-docs then azure-docs-aad (legacy).
- Resumable via `documents.embedded_at` (NULL until all of a doc's chunks are
  embedded) + chunk-level presence in `chunks`.

### Oversized blocks (vs the 512-token model limit)

- Tables over the limit are split by row-groups with the header repeated (no row
  loses its columns). Validated on `user.md`: 100% of property rows covered, no
  table chunk over 512.
- Oversized fenced code blocks are kept intact (flagged `oversized_code` in the
  vector metadata) and truncated to <=512 tokens for the VECTOR only; the full
  code stays in the R2 body. Oversized non-code text (e.g. docfx blockquotes
  wrapping code) and oversized yml units are split by line-groups.

### What gets written per chunk

- `chunks` row: `chunk_id` (`{doc_id}#{idx}`), `doc_id`, `chunk_index`, `r2_key`,
  `vector_id` (48-hex SHA-256 of chunk_id), `token_count`.
- Vectorize: 768-dim vector keyed by `vector_id`, with filter metadata
  `trust`/`source`/`content_type` (+ `doc_id`/`chunk_index`/`r2_key` pointers and
  `oversized_code` where set).

## Retrieval / search (chunk 4)

`/search` (Bearer `TRIGGER_SECRET`) returns ranked, cited chunks — **no LLM
generation**. GET `?q=...&scope=...&source=...&content_type=...&layer=...&top_k=...`
or POST JSON `{query, trust_scope, source, content_type, layer, top_k}`.

```sh
gh workflow run deploy.yml -f run_backfill=true -f mode=search \
  -f query="what permission do I need to read all users" -f scope=both
```

Each result carries: `score` + `reranked_score`, `trust`, `layer`, `source`,
`doc_id`/`chunk_index`, `doc_title`, `heading`, `snippet`, and a `citation`
(`source_url` / `license` / `attribution`, per DESIGN.md §4).

- **Ranking:** cosine from Vectorize, then a **trust re-rank** — `TRUST_BONUS`
  (default 0.05, tunable) added to the score for `official`, so official outranks
  community at similar relevance. `trust_scope` = `official` | `community` |
  `both` (default) selects the pool (Vectorize `trust` filter / `both` = no filter).
- **Filters:** `trust`/`source`/`content_type` are Vectorize metadata-index
  filters; `layer` is post-filtered (it is not an index — over-fetch covers it).
- **Hydration:** the snippet is re-derived from the R2 body with the same pure
  chunker (deduped by doc) because 3b stores no chunk text; deterministic, so
  `chunk_index` maps back exactly.
- **Cache (`answer_cache`):** key = SHA-256 of the normalized query (lowercase,
  trim, collapse whitespace) + scope + filters + top_k. Value = the ranked result
  list JSON. **Cache hit → `hit_count++`, ZERO neurons.** Miss → embed + search +
  cache. **Staleness:** `SEARCH_CACHE_TTL_SECONDS` (default 3600) bounds how long
  a result set survives while the index is still filling; entries older than the
  TTL are treated as a miss and recomputed. Raise the TTL once the corpus is
  fully embedded.
- **Neuron cost:** cached query = **0 neurons**; uncached = **~1 neuron** (one
  query embed). Retrieval embeds share the 10k/day free-tier ceiling with the
  embedding backfill.

### Neuron budget calibration (important)

Real Workers AI usage was measured at **~1.25x** the token-cost estimate
(per-request overhead beyond the 6058/M-token input rate): a 9000 estimated/day
embed budget overshot to the 10,000 real ceiling (`error 4006`), which also
broke retrieval. `EMBED_NEURON_BUDGET` is therefore **6000** (estimated; ~7.5k
real), reserving ~2.5k real/day so `/search` query embeds never trip 4006. If
4006 still appears, lower it further.

## Frontend (chunk 5: Cloudflare Pages)

Static Astro site under `frontend/`, deployed to the Cloudflare Pages project
`entrapedia` (`https://entrapedia.pages.dev`). It ships two same-origin Pages
Functions under `frontend/functions/api/`: `search.js` (proxy to the worker
`/search`) and `doc.js` (renders a corpus doc from its public source).

### Run locally

```
cd frontend
npm install
npm run dev          # Astro dev server (homepage renders the labelled SAMPLE set;
                     # live /api/* need the Functions runtime)
npm run build        # -> frontend/dist
```

Functions need the Pages runtime. Either deploy, or run the Functions locally
with a real secret in `frontend/.dev.vars` (NOT committed):

```
# frontend/.dev.vars
TRIGGER_SECRET = "<the worker /search secret>"
# optional override; defaults to the workers.dev origin in the code
SEARCH_ORIGIN  = "https://entrapedia.<subdomain>.workers.dev"
```

The doc proxy (`/api/doc`) needs no secret -- it fetches the document's public
GitHub source. The homepage shows a clearly-labelled SAMPLE result set before
the first query, so the design renders without any backend.

### Deploy -- git integration (primary)

The frontend deploys via **Cloudflare Pages git integration**: Cloudflare builds
and deploys on push, no CI token needed. The Pages project `entrapedia` exists
with build settings already configured (root dir `frontend`, build command
`npm run build`, output `dist`); Functions in `frontend/functions/` are
auto-detected.

One-time connect (dashboard; the GitHub-App authorization cannot be done via the
API):

1. Cloudflare dashboard -> Workers & Pages -> the `entrapedia` Pages project is
   Direct-Upload; to use git, create/connect a Pages project to the
   `arusso-aboutcloud/entrapedia` repo ("Connect to Git"), authorizing the
   Cloudflare Pages GitHub App for the repo. (If the name `entrapedia` is taken
   by the placeholder project, delete that empty project first.)
2. Build settings: **root directory** `frontend`, **build command**
   `npm run build`, **output directory** `dist`, production branch `main`.
   Optionally limit builds to `frontend/*` path changes.
3. **Live search secret:** in the project's Settings -> Environment variables,
   add `TRIGGER_SECRET` (encrypted) = the worker's `/search` secret. Until it is
   set, the site is fully live but `/api/search` returns 503 (the homepage SAMPLE
   set and doc pages still render). `SEARCH_ORIGIN` is optional (defaults to the
   workers.dev origin in code).

After connecting, every push touching `frontend/**` triggers a Cloudflare build +
deploy to `entrapedia.pages.dev`.

### Deploy -- wrangler / CI (alternative)

`.github/workflows/pages.yml` (dispatch-only) builds and deploys via
`wrangler pages deploy`, piping the `TRIGGER_SECRET` repo secret into the project
server-side. It needs **`Cloudflare Pages:Edit`** on `CLOUDFLARE_API_TOKEN` (the
token currently has only the Workers/D1/R2/Vectorize/AI scopes, so this path 403s
until that scope is added). Use it only if you prefer CI deploys over git
integration. The single advantage over git integration: it sets `TRIGGER_SECRET`
automatically from the existing repo secret.

### Search proxy: protecting the secret and the neuron budget

`TRIGGER_SECRET` is held **server-side** in the Pages Function and never shipped
to the browser. Defence in depth on the public search route:

1. **Input caps** -- query <= 256 chars, `top_k` <= 10, scope allowlist.
2. **Edge cache** -- identical queries served from `caches.default` for 10 min
   (zero worker hits, zero neurons on repeat).
3. **Soft per-IP limit** -- 30 req/60s, per-isolate (best-effort first line).
4. **Hard backstop** -- the worker's own daily neuron cap + `answer_cache` mean
   even unbounded proxy traffic cannot overspend neurons (it serves cached
   results or returns 4006). The budget is structurally protected regardless of
   the proxy.

(3) is per-isolate, not global; the hardening for true public launch is a
Durable Object or KV token bucket. Public launch (custom domain, removing the
worker's auth) is a later step -- not chunk 5.

## Authoring an article (the encyclopedia layer)

Articles are the product (DESIGN.md 1-3). They are **git-versioned markdown**,
authored by the curator -- not in D1, never auto-generated from retrieval.

### Where files live

```
frontend/src/content/articles/<category>/<slug>.md
```

`<category>` is one of the nine ids in `frontend/src/lib/categories.mjs`
(`fundamentals`, `identity`, `access`, `protection`, `governance`,
`applications`, `agent-id`, `external`, `network-access`). The article is an
Astro content collection entry; the schema is `frontend/src/content.config.ts`.

### Frontmatter

```yaml
---
title: Conditional Access
slug: conditional-access          # unique; the URL is /a/<slug>
category: access                  # one of the nine ids
summary: One-sentence orientation shown on cards and the article header.
tags: [conditional-access, mfa]
layer: current                    # current | legacy  (legacy = amber heritage treatment)
featured: true                    # surface on the landing "core concepts"
last_reviewed: "2026-06-16"        # QUOTE dates (YAML would parse a bare date as an object)
licensing_as_of: "2026-06-16"      # OPTIONAL; renders the dated "verify" licensing banner
see_also: [azure-ad-b2c-external-id]   # slugs of related articles
draft: true                       # marks "draft exemplar" until the curator signs off
citations:                        # the cited sources used by the cited sections
  - id: ca-overview
    title: Conditional Access overview (Microsoft Entra documentation)
    source_url: https://github.com/MicrosoftDocs/entra-docs/blob/main/docs/identity/conditional-access/overview.md
    license: MIT
    attribution: Microsoft Docs - MicrosoftDocs/entra-docs (MIT)
---
```

### Body: the seven sections

Use these exact H2 headings, in order. A rehype plugin badges each as AUTHORED or
CITED automatically (it matches the heading text), so the heading text must match:

```
## What it is        (authored)   ## Current state   (cited)
## Why it matters     (authored)   ## Licensing        (cited + dated)
## How it relates     (authored)   ## History          (cited)
## See also           (authored)
```

- **Authored** sections are the curator's voice -- plain prose, judgement, links.
- **Cited** sections must ground every claim: write the prose with inline markdown
  links to the real source URLs, and list those sources in frontmatter `citations`
  (rendered as the article's "cited sources" attribution block, per DESIGN.md 5).
  A claim-bearing line without a citation is a content bug.
- **Licensing** is cited AND dated: set `licensing_as_of` and keep a visible
  "verify, licensing changes" posture (the banner does this; reinforce it inline).
- **Interlink**: link other articles by `/a/<slug>` inline (in How it relates) and
  via `see_also` -- this is the web-of-knowledge.

### How it deploys

Articles build statically (Astro content collection -> `/a/<slug>` pages, listed on
the landing and `/c/<category>`). Commit the markdown and push to `main`; the
Pages deploy (`.github/workflows/pages.yml`, or git integration) rebuilds. No D1
write, no embedding, no neuron cost -- the article is pure git content. The cited
*evidence* it links to comes from the corpus/retrieval layer, which is separate.

### Per-category corpus-bridge (sparse / empty categories)

A category with no (or few) articles is not a dead end: the category page surfaces
the topic's underlying source documents from the corpus, clearly labelled and
visually distinct from curated articles.

- **Selection method.** Each category in `frontend/src/lib/categories.mjs` carries
  a `topic` string. The category page runs that `topic` as a client-side query
  against the retrieval engine (`/api/search?q=<topic>&top_k=15`, through the
  secret-safe proxy -- no retrieval-API change), de-duplicates the results by
  `doc_id`, and renders up to ~10 as **"source doc"** cards (title -> the corpus
  doc viewer, plus source URL / license / attribution). To re-aim a category's
  bridge, edit its `topic`. The fixed per-category query is answer-cache + edge-
  cache friendly, so repeat loads cost zero neurons.
- **Scoped search.** The category page's search box prepends the category `topic`
  to the visitor's query and sends it to `/search`, biasing results to the topic.
- **Curated supersedes evidence.** When authored articles exist in a category they
  render in an **articles** section ABOVE the **source documentation** section, so
  the curated layer always leads and the corpus bridge sits beneath it as
  supporting references. As articles are added, the bridge naturally recedes.
- The source-doc cards are styled deliberately *unlike* curated article cards
  (muted, dotted, "source doc" labelled) so evidence is never mistaken for an
  authored article.
