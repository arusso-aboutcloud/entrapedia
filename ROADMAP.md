# Roadmap

Entrapedia is built in scoped, reviewed chunks. Each chunk has explicit deliverables and done-criteria. This roadmap tracks sequence and status; `DESIGN.md` holds the contracts each chunk inherits.

## Chunk 1 — Scaffold + design docs — in progress

Private repository, directory skeleton, configuration stubs, and the authoritative documentation set (`README`, `DESIGN`, `ARCHITECTURE`, `SECURITY`, `CONTRIBUTING`, this file). `wrangler.toml` as a binding-declaration stub with no live IDs. No code, no provisioned resources.

Licensing was settled in a follow-up commit: code under MIT, content under CC-BY-4.0.

## Chunk 2 — Storage tier — done

Create and wire the Cloudflare storage resources: D1 (index, metadata, source/trust/license fields, answer cache), R2 (raw corpus), Vectorize (embeddings). Real binding IDs land in `wrangler.toml`. D1 schema committed under `schema/`.

Open item before this chunk: confirm Vectorize free-tier availability on the account dashboard. Fallback if paid-only is Worker-side similarity over vectors stored in D1/R2.

## Chunk 3 — Ingestion pipeline

Cron-driven ingestion worker forking the Entra-Tracker pattern: fetch upstream sources, diff against stored state, and process only changed files (chunk, embed, upsert). Per-type cadence: change feeds ~4h, doc corpus daily, structured/community weekly. Incremental-only by design, to stay within the neuron budget. Split into two sub-chunks:

### Chunk 3a — Tier-A fetch + store — done

Ingestion worker (`workers/ingestion/`) that resolves each Tier-A repo head, walks the tree (descend-on-truncation, resumable frontier in `sync_state`), diffs git blob SHAs against `documents`, and stores changed/new bodies to R2 with `documents` upserts tagged `current`/`legacy`. Per-run file + subrequest caps keep it free-tier-safe and resumable. Daily cron + authenticated manual trigger. Fetch-and-store only — no embedding, no `chunks`, no vectors.

### Chunk 3b — Embedding

Split into two phases so neuron spend is sized and chunk quality approved before anything is spent.

**Phase 1 — dry-run chunking — done.** Heading-aware chunker (`workers/ingestion/chunker.mjs`) run as a dry run over a 410-doc representative sample (zero neurons, no `chunks`/Vectorize writes, no AI). Findings in `docs/dryrun/chunk-dryrun-report.md`: projected ~144,254 chunks full-corpus; token median 363 / mean 441 / p95 690; embedding is a multi-week first pass under the free-tier neuron cap. Open decision flagged: a few un-splittable tables/code blocks exceed bge-base's 512-token limit and would be truncated.

**Phase 2 — embedding — in progress.** The chunker is wired into the worker and embeds the corpus with `@cf/baai/bge-base-en-v1.5` (768-dim) into the `entrapedia-chunks` Vectorize index with `trust`/`source`/`content_type` metadata, writing `chunks` rows in lockstep. Oversized tables are split by row-groups (header repeated; validated on `user.md` — 100% of property rows covered, no table chunk over 512); oversized code is flagged + truncated-for-vector only. Priority tiers P1 (permissions-reference + all graph `api-reference` + entra-docs identity-core) → P2 → P3 (powershell, then azure legacy). Throttled to `EMBED_NEURON_BUDGET = 9000` neurons/day (UTC; ~1k under the 10k free-tier ceiling), resumable via `documents.embedded_at`. A 3x/hour cron self-drives it; the full ~144k-chunk first pass is ~43 days of daily-budgeted runs by design (then incremental). The P1 high-value set is the milestone to report for chunk 4 testing.

## Chunk 4 — RAG retrieval + search — retrieval signed off

Authenticated `/search` endpoint: query embed (cache-miss only) → Vectorize search with `trust`/`source`/`content_type` filters → trust re-rank (official outranks community, tunable bonus; official/community/both scope) → R2/D1 hydration with citations (source URL + license + attribution) → `answer_cache` query-result cache (zero neurons on hit, short TTL while the index fills). No model generation; retrieval quality is proven first, and the site is useful on retrieval + caching alone.

**Retrieval-quality fix (signed off).** Live testing on the high-value permissions-reference page surfaced two defects: heading-anchor mislabeling (a least-privilege permission presented under its over-privileged sibling's heading) and dense-embedding flattening of structurally-identical permission rows. Fixed by one-permission-per-chunk re-chunking of `permissions-reference.md` (name-keyed vector ids, per-permission metadata in D1) plus identifier-aware matching (exact permission-name/GUID → Tier 0, pinned above dense; identifier-only queries skip the embed) and a gated least-privilege re-rank bias. §5 test set: 8/10 pass — mislabeling fully fixed (Mail.Send/Directory.Read.All/Group(Member).Read.All all surface under their own names), exact-name/GUID and direct natural-language queries solid, fuzzy-query guard and permissions-only scoping confirmed.

**Known limitation (interim honest behavior).** Least-privilege *intent* over a generic operation ("least privilege to list applications") is not answerable from the flat permissions-reference list — the minimal permission per operation is published on the Graph api-reference method pages. No heuristic guessing on this trust-critical topic: `/search` returns `least_privilege_grounded: false` + an `advisory` pointing to the operation's api-reference method page. Proper fix is the next chunk below.

## Chunk 4b — api-reference retrieval quality (least-privilege + snippet-tab hygiene) — near-term priority

Two api-reference-quality items, both gated on the same api-reference backfill coverage, so they queue together.

**(a) Least-privilege retrieval (flagship-topic fix for the LP-verb-resource limitation above).** The Graph **api-reference method pages** (already being ingested into the corpus) publish, per operation, the **least-privileged permission** (and higher-privileged alternatives). The capability: retrieval over those pages that, for an operation query ("least privilege to list applications" / "minimal permission to send mail"), surfaces the operation's published least-privileged permission — correct, source-grounded, cited; **no heuristic name→permission mapping**. Spec (plan only) lives in `docs/specs/api-reference-least-privilege.md`; build gated on prerequisite + spec review.

**(b) Snippet-tab-chunk corpus hygiene (prioritized).** Graph api-reference pages embed code-sample "snippet tab" fragments (the language-switcher snippets — C#/JavaScript/Java/Go/PowerShell/etc.) that produce **high-volume, low-semantic-content chunks**. These pollute retrieval relevance across many queries — surfaced when `?q=phs` returned beta api-reference snippet-tab chunks instead of relevant content — and the impact **grows as the api-reference backfill (~80% of the corpus) embeds**. This is corpus-wide retrieval hygiene, **not** a phs-specific edge case — the same class of structural-noise filtering as the earlier `/includes/` and repo-meta exclusions. Fix pattern mirrors the permissions-reference fix: identify the structural noise, filter/handle the snippet-tab chunks, re-embed the affected api-reference docs. Folded here because it is api-reference-quality work on the same backfill gate.

**Prerequisite (both):** the api-reference method-page set embedded (backfill in flight; this chunk queues right after it reaches that set).

## Chunk 5 — Frontend foundation — built (iterating on aesthetics)

Static Astro site under `frontend/`, deployed to Cloudflare Pages (`entrapedia.pages.dev`). Chakra Petch + neo-brutalist/cyberpunk-glow design ("exposed concrete meets terminal glow"). Search experience over the `/search` API via a server-side proxy (secret never client-side; input-capped, edge-cached, soft-rate-limited); ranked cited results with **semantic trust-tier encoding** (official = cyan glow, legacy/heritage = amber archival, community = matte/verify) and honest `result_kind` + least-privilege `advisory` rendering. Doc view renders a corpus document with a source-attribution footer and a reserved current-state + history page model (DESIGN.md §7). Foundation is a first opinionated version; look-and-feel iterates from rendered output (v0.2 pass: widened layout + bolder/earned glow, more assertive brutalist frames + corner ticks, sharper trust-tier encoding, pushed Chakra Petch hierarchy). Search verified live end-to-end (real cited permissions-reference data with correct GUIDs; proxy->worker->Vectorize; secret server-side only). WebGL hero NOT built (chunk 6). Public launch (custom domain `entrapedia.aboutcloud.io`, removing the worker auth) is a later step — the corpus is still embedding.

Deferred within chunk 5 follow-up: progressive-enhancement / no-JS search fallback (search is currently client-rendered); hardening the proxy rate limit to a Durable-Object/KV token bucket for public launch.

## Chunk 6 — WebGL logo-evolution hero

Self-contained WebGL component depicting the Azure AD to Entra ID brand lineage. Isolated by design — depends on nothing else and is the last visual chunk. Brand assets and dates to be researched for historical accuracy when this chunk is scoped. The frontend design language already reserves an archival/heritage treatment (legacy layer) for it to slot into.

## After chunk 5 — public launch

Custom domain `entrapedia.aboutcloud.io`, removing the worker's `/search` auth in favour of the public rate-limited proxy path, and final content review. Gated on the corpus reaching useful embedding coverage. Not a visual chunk.

**Prerequisites (must clear before exposing the proxy publicly):**

- **Global rate limiter (blocker).** The current proxy rate limit is **per-isolate** (an in-memory counter per Worker isolate), so the effective limit is **leaky** — fine for the private dev site, NOT acceptable for public exposure. A leaky limiter lets a scraper / heavy visitor exceed the intended limit and drain the daily neuron allocation, which would **stall the embedding backfill**. Upgrade to a **global counter — a Durable Object** (or KV as a lighter, weaker-consistency alternative) — before launch. This complements, not replaces, the neuron backstop: the backstop is the hard floor, but for public exposure the rate limiter itself must actually be tight.

## After chunk 4 — LLM generation layer

Once retrieval is validated, add tiered model routing and grounded, cited generation under the safety contract (KQL informative-only; Graph/PowerShell retrieval-grounded with citations; web search opt-in; no vision). Slots in as its own chunk; not before retrieval quality is established.

## Deferred / conditional

- **Bare-abbreviation retrieval (known limitation, lower priority).** Bare abbreviations (e.g. "phs" = Password Hash Sync) embed poorly and retrieve weakly — abbreviation→expansion is a genuine retrieval challenge. Logged as a known limitation; no bespoke expansion mechanism now. Note that fixing chunk 4b item (b) — snippet-tab hygiene — will **partially** improve these queries by removing the low-content noise that currently dominates their results, even without abbreviation handling.
- Microsoft 365 full doc corpus — large, only partially Entra-relevant, expensive to embed. Revisit only with explicit scope approval.
- Public launch tasks (final content review, demos/blog) — after the site is functional. The repository is already public; licensing is settled (MIT / CC-BY-4.0).
