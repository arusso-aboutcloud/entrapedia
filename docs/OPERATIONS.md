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
