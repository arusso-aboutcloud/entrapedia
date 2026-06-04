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

The Tier-A fetch/store stage (`workers/ingestion/`, chunk 3a) resolves each repo's head commit, walks the tree to enumerate in-scope files, and diffs their git blob SHAs against `documents.content_hash` so only changed/new bodies are fetched. Raw bodies are written to R2 (`{source}/{path}`) and a `documents` row is upserted carrying `source`/`trust`/`license`/`attribution` and a `layer` tag — `current` for the live docs, `legacy` for the Azure AD heritage under azure-docs. Because the GitHub Trees API truncates very large recursive trees (graph-docs exceeds the limit), the walk descends per-directory only where a tree returns `truncated`, persisting the pending-directory frontier in `sync_state` so a per-run-capped backfill resumes both the tree walk and the fetch on the next invocation. Embedding and `chunks`/vector writes are deferred to chunk 3b; the fetch/store stage makes no Workers AI calls.

**Storage tier.** Resources provisioned and wired in chunk 2 (resource names in parentheses).
- **R2** (`entrapedia-corpus`) — raw fetched markdown / HTML bodies. The corpus of record.
- **D1** (`entrapedia`) — page index, document metadata, source/trust/license fields, and the answer cache (normalized-question keyed).
- **Vectorize** (`entrapedia-chunks`, 768 dimensions, cosine metric; embedding model `@cf/baai/bge-base-en-v1.5`) — embeddings for RAG retrieval. Trust separation is by metadata filter, with metadata indexes on `trust`, `source`, and `content_type`. (Free-tier availability to be confirmed on the account dashboard before the storage chunk; fallback is Worker-side similarity over vectors in D1/R2.)
- **KV** (`entrapedia-cache`) — answer cache keyed by normalized question.

**Query worker.** Serves search and RAG retrieval with citations. In v1 it returns retrieved, cited content and cache hits — no model generation. The generation layer (tiered model routing, answer caching, trust-aware citation) is added after retrieval quality is proven. Web search is an explicit opt-in mode, never the default path.

**Pages frontend.** Static site (Astro / Starlight). Chakra Petch typography, neo-brutalist layout, trust-tier visual treatment (official content distinct from community), per-page source-attribution footers. The WebGL logo-evolution hero is a later, isolated component that depends on nothing else.

## Free-tier surface

Used: Pages, Workers, Workers AI, Vectorize, D1, R2, Cron Triggers / Workflows, KV (answer cache).

Explicitly not used (no free tier): Browser Rendering, Hyperdrive, Images.

## Cross-cutting rules

- Every stored chunk carries source, trust level, and license metadata.
- Retrieval conflict resolution: Official outranks Community.
- Every surfaced snippet carries an inline citation; every page carries an attribution footer.
- See `DESIGN.md` §5–§6 for the binding safety and cost contracts.
