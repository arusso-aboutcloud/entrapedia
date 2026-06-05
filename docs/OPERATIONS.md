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

### Tree truncation (why the walk is what it is)

The GitHub Git Trees API **truncates large recursive trees** (~100k entries /
7 MB). `microsoft-graph-docs-contrib` exceeds it — a single `?recursive=1` call
silently returns a partial tree and would miss high-value pages (e.g. the Graph
permissions reference). The worker therefore uses **descend-on-truncation**: one
recursive tree call per directory, and only when a directory comes back
`truncated: true` does it list that directory non-recursively and enqueue its
child directories. The pending-directory **frontier is persisted in
`sync_state.last_etag`**, so a run capped mid-walk resumes the tree walk (not
just the fetch step) on the next invocation. No content sub-paths are hardcoded,
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
