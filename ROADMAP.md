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

## Chunk 4 — RAG retrieval + search

Query worker serving search and retrieval with citations and trust-aware conflict resolution (official outranks community). Answer caching keyed by normalized question. No model generation yet — retrieval quality is proven first. The site is useful at this point on retrieval and caching alone.

## Chunk 5 — Frontend foundation

Cloudflare Pages, Astro/Starlight. Chakra Petch typography, neo-brutalist layout, trust-tier visual treatment, per-page source-attribution footers, current-state plus history page model. Plain styling; no hero engine yet.

## Chunk 6 — WebGL logo-evolution hero

Self-contained WebGL component depicting the Azure AD to Entra ID brand lineage. Isolated by design — depends on nothing else and is the last visual chunk. Brand assets and dates to be researched for historical accuracy when this chunk is scoped.

## After chunk 4 — LLM generation layer

Once retrieval is validated, add tiered model routing and grounded, cited generation under the safety contract (KQL informative-only; Graph/PowerShell retrieval-grounded with citations; web search opt-in; no vision). Slots in as its own chunk; not before retrieval quality is established.

## Deferred / conditional

- Microsoft 365 full doc corpus — large, only partially Entra-relevant, expensive to embed. Revisit only with explicit scope approval.
- Public launch tasks (final content review, demos/blog) — after the site is functional. The repository is already public; licensing is settled (MIT / CC-BY-4.0).
