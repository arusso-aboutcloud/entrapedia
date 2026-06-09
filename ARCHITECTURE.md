# Entrapedia — Architecture

Cloudflare-native, free-tier, trust-tiered. This document describes the system shape; `DESIGN.md` holds the binding contracts.

## Layers

```
Sources (trust-tiered)
        |
        v
Ingestion worker (cron)  -- fetch, diff, chunk, embed changed-only
        |
        v
Storage:  R2 (raw markdown)  |  D1 (index, metadata, cache)  |  Vectorize (embeddings)
        |
        v
Query worker  -- search, RAG retrieve, cited answers
              -- (LLM generation + web search: later, opt-in)
        |
        v
Pages frontend (Astro, Chakra Petch, brutalist)
        |
        v
Users and engineers
```

A rendered SVG of this diagram lives at `docs/architecture.svg`.

## Components

**Sources.** Split by trust level (see `DESIGN.md` §3). Official Microsoft sources are authoritative; community sources are attributed and flagged. The split is carried through every downstream layer as a per-chunk trust attribute.

**Ingestion worker (Cron Triggers / Workflows).** Forks the existing Entra-Tracker ingestion pattern. On schedule, it fetches upstream sources, diffs against what is already stored, and processes only changed files: chunk, embed, upsert. Change-feed sources (Type B) run on a short cadence (~4h); the full doc corpus (Type A) runs daily; structured/community sources (Type D) run weekly. Incremental-only processing is what keeps embedding within the neuron budget.

The Tier-A fetch/store stage (`workers/ingestion/`, chunk 3a) resolves each repo's head commit, walks the tree to enumerate in-scope files, and diffs their git blob SHAs against `documents.content_hash` so only changed/new bodies are fetched. Raw bodies are written to R2 (`{source}/{path}`) and a `documents` row is upserted carrying `source`/`trust`/`license`/`attribution` and a `layer` tag — `current` for the live docs, `legacy` for the Azure AD heritage under azure-docs. Because the GitHub Trees API truncates very large recursive trees (graph-docs exceeds the limit) and a recursive parse can exceed the free-tier CPU limit, the walk lists one directory level per visit and persists the pending-directory frontier in `sync_state` so a per-run-capped backfill resumes both the tree walk and the fetch on the next invocation.

**Embedding stage (chunk 3b).** A heading-aware chunker (`chunker.mjs`) turns each stored body into ~448-token chunks: split on H1–H3 headings, never split a fenced code block; tables over the 512-token model limit are split by row-groups with the header repeated; oversized code is kept intact (flagged `oversized_code`, truncated to 512 for the vector only — the full code stays in R2); oversized non-code text and yml units are split by line-groups. Each chunk is embedded with `@cf/baai/bge-base-en-v1.5` (768-dim) and upserted into Vectorize with `trust`/`source`/`content_type` filter metadata; a `chunks` row records `chunk_id`/`vector_id`/`token_count`. The pass runs in priority tiers (P1 permissions-reference + all graph `api-reference` + entra-docs identity-core → P2 → P3 powershell/legacy), throttled to a daily neuron budget (9000, ~1k under the free-tier 10k/day ceiling, tracked in `sync_state`), and is resumable via `documents.embedded_at` + chunk presence. A frequent cron self-drives it incrementally; the full first pass is ~weeks by design (embed once, cache forever, incremental thereafter).

**Storage tier.** Resources provisioned and wired in chunk 2 (resource names in parentheses).
- **R2** (`entrapedia-corpus`) — raw fetched markdown / HTML bodies. The corpus of record.
- **D1** (`entrapedia`) — page index, document metadata, source/trust/license fields, and the answer cache (normalized-question keyed).
- **Vectorize** (`entrapedia-chunks`, 768 dimensions, cosine metric; embedding model `@cf/baai/bge-base-en-v1.5`) — embeddings for RAG retrieval. Trust separation is by metadata filter, with metadata indexes on `trust`, `source`, and `content_type`. (Free-tier availability to be confirmed on the account dashboard before the storage chunk; fallback is Worker-side similarity over vectors in D1/R2.)
- **KV** (`entrapedia-cache`) — answer cache keyed by normalized question.

**Query worker / retrieval (chunk 4).** An authenticated `/search` endpoint (on the same worker) returns retrieved, ranked, **cited** chunks — **no model generation**. Flow: normalize the query → cache lookup in `answer_cache` (zero neurons on a fresh hit) → on miss, embed the query once with bge-base (prefixed with the bge s2p query instruction) → Vectorize similarity search with indexed metadata filters (`trust`, `source`, `content_type`; `layer` post-filtered) → **trust re-rank** (an additive bonus so official outranks community at similar relevance; an `official`/`community`/`both` scope filter selects the pool) → hydrate each result's snippet by re-deriving the chunk from its R2 body with the same pure chunker (deduped by doc; chunk text isn't stored), and assemble citations (`source_url`/`license`/`attribution` per §4) from the `documents` row → cache the ranked result list and return. The cache is a query→results cache (not generated answers) with a short TTL while the index is still filling. Retrieval embeds (~1 neuron) share the daily neuron ceiling with the backfill; the embed budget reserves headroom so they never starve it. The generation layer (tiered model routing, grounded cited generation under the §5 safety contract) is a later chunk, gated on retrieval quality. Web search is an explicit opt-in mode, never the default path.

*Structured-reference chunking + identifier-aware matching (chunk 4 retrieval-quality fix).* The Graph permissions-reference page (`graph-docs:concepts/permissions-reference.md`) is chunked one-permission-per-chunk (each `### PermissionName` section is its own chunk carrying its OWN heading, with `perm_name`/`app_guid`/`delegated_guid`/`principal`/`family`/`action`/`priv_rank`/`scope_all` metadata in D1 and name-keyed vector ids `#perm=<Name>`). This replaced a merge-many-per-chunk scheme that mislabeled a least-privilege permission under its over-privileged sibling's heading. `/search` first runs an **identifier-aware** exact lookup: a literal permission name or GUID in the query resolves directly to that permission (Tier 0, pinned above dense; an identifier-only query skips the embed entirely — 0 neurons). A gated least-privilege re-rank bias nudges narrower permissions up *within the retrieved set* when a least-privilege cue is present. The structured path is allowlisted to permissions-reference only; all other docs keep the generic prose chunker.

*Known limitation — least-privilege-by-operation.* A query expressing least-privilege *intent* over a generic operation ("least privilege to list applications") cannot be answered authoritatively from the permissions-reference list: the minimal permission for a specific operation is published per-operation on the Graph **api-reference method pages**, not in the flat permission list. The engine does not guess (no heuristic name→permission mapping on this trust-critical topic). Instead, when least-privilege intent is detected without a grounded permission (no exact name/GUID), `/search` returns `least_privilege_grounded: false` plus an `advisory` that the results are conceptual guidance and points to the operation's api-reference method page. The proper fix is grounded retrieval over those api-reference pages once they are embedded — a near-term priority chunk (see ROADMAP).

**Pages frontend.** Static site (Astro / Starlight). Chakra Petch typography, neo-brutalist layout, trust-tier visual treatment (official content distinct from community), per-page source-attribution footers. The WebGL logo-evolution hero is a later, isolated component that depends on nothing else.

## Free-tier surface

Used: Pages, Workers, Workers AI, Vectorize, D1, R2, Cron Triggers / Workflows, KV (answer cache).

Explicitly not used (no free tier): Browser Rendering, Hyperdrive, Images.

## Cross-cutting rules

- Every stored chunk carries source, trust level, and license metadata.
- Retrieval conflict resolution: Official outranks Community.
- Every surfaced snippet carries an inline citation; every page carries an attribution footer.
- See `DESIGN.md` §5–§6 for the binding safety and cost contracts.
