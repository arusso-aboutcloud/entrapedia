# Entrapedia — Design

`entrapedia.aboutcloud.io` — a curated Microsoft Entra ID encyclopedia and reference, served entirely from the Cloudflare free tier.

This document is authoritative. Every implementation chunk that follows inherits the contracts defined here. No code or surface change may contradict this document without updating it first.

## 1. What Entrapedia is

A reference encyclopedia for Microsoft Entra ID, for two audiences at once: end users who need to understand a concept, and engineers who need accurate, source-linked technical detail. It combines three things that do not currently exist together in one place:

1. **Current-state reference** — drawn from official Microsoft documentation.
2. **Change/release awareness** — what is new or deprecated, reusing the existing Entra-Tracker ingestion pattern.
3. **An encyclopedic/historical layer** — the lineage from Azure AD to Microsoft Entra ID: old names, rename timelines, deprecated features and their modern equivalents. This is the differentiator and, because history does not change, it is also the cheapest content to serve.

## 2. Design principles

- **Cloudflare-native, zero cost.** Pages, Workers, Workers AI, Vectorize, D1, R2, Cron Triggers / Workflows only. No service that lacks a free tier (Browser Rendering, Hyperdrive, Images are explicitly out of scope).
- **Informative-first, retrieval-grounded.** The site shows the authoritative source and helps the reader understand it. It does not pretend to be the source. This is a reputation guarantee, not a preference.
- **Self-learning by re-indexing the source of truth.** "Self-learning" means scheduled incremental re-indexing of upstream sources, never a model freewheeling.
- **Trust tiers are first-class.** Every stored chunk carries a trust level. Official Microsoft content is authoritative; community/third-party content is attributed and flagged, and never overrides an official source in retrieval conflict resolution.
- **Incremental, human-reviewed delivery.** Build proceeds in scoped chunks. Docs ship in the same PR as the code they describe.

## 3. Source model — four content types, two trust levels

### Trust levels

- **Official** — authoritative. Microsoft-published. No staleness caveat beyond the document's own date.
- **Community** — useful, attributed, carries a "verify against Microsoft" flag. Never outranks an Official source when the two conflict in retrieval.

### Content types

**Type A — Doc corpus (full text).** The body of the encyclopedia. GitHub markdown repos, synced and embedded.

- `MicrosoftDocs/entra-docs` (MIT) — core. Already used by Entra-Tracker.
- `MicrosoftDocs/entra-powershell-docs` — Entra PowerShell reference.
- `microsoftgraph/microsoft-graph-docs-contrib` — Graph API surface.
- Relevant subtrees of `MicrosoftDocs/azure-docs` (e.g. the B2C area already tracked).

**Type B — Change / release feeds.** RSS/changelog items, ingested as feed entries, not full documents. This is the Entra-Tracker domain, reused.

- Microsoft Graph changelog RSS.
- Microsoft Entra release-notes RSS.
- Microsoft Developer unified changelog (filtered to Microsoft Identity Platform).
- `api.aboutcloud.io/entra-tracker` RSS (dogfooding our own product).

**Type C — Editorial / blog.** Announcements and narrative context, ingested as articles.

- `devblogs.microsoft.com/identity` (Microsoft Entra Identity Platform).
- Microsoft Entra Blog on Tech Community (per-category RSS, not HTML scraping).

**Type D — Structured reference.** Lookup data, not prose. Extracted into structured form before use.

- M365 Maps licensing / SKU matrices — community, CC-BY-4.0, attribution to Aaron Dinnage required.
- Our own AADSTS error catalog and RoleLens role data fit this type.

### Source-tier table

| Source | Type | Trust | Sync cadence | License / attribution |
|---|---|---|---|---|
| entra-docs | A | Official | daily (incremental) | MIT |
| entra-powershell-docs | A | Official | daily (incremental) | MIT |
| microsoft-graph-docs-contrib | A | Official | daily (incremental) | per-repo, attribute |
| azure-docs (subtrees) | A | Official | daily (incremental) | CC-BY-4.0, attribute |
| Graph changelog RSS | B | Official | 4h | feed |
| Entra release-notes RSS | B | Official | 4h | feed |
| Dev unified changelog | B | Official | 4h | feed |
| entra-tracker RSS | B | Official (self) | 4h | own |
| devblogs identity | C | Official | daily | attribute |
| Tech Community Entra blog | C | Official | daily | attribute |
| M365 Maps | D | Community | weekly | CC-BY-4.0, attribute Dinnage |
| Wikipedia (Entra ID / Connect) | D | Community | weekly | CC-BY-SA, attribute |
| AADSTS-Entra-Errors (self) | D | Official (self) | on change | own |
| Entra-RoleLens (self) | D | Official (self) | on change | own |

M365-365-docs and the full Microsoft 365 corpus are deliberately **deferred** — large, only partially Entra-relevant, and expensive to embed. Revisit only with explicit scope approval.

## 4. Licensing obligations (binding)

- `entra-docs` is MIT.
- `azure-docs` and most other MicrosoftDocs repos publish content under CC-BY-4.0 (code under MIT). This **requires per-page attribution and a link back to the source article**, and grants no rights to Microsoft names, logos, or trademarks.
- M365 Maps is CC-BY-4.0 by Aaron Dinnage — **per-page attribution to Dinnage / m365maps.com required**, no implied Microsoft endorsement.
- Wikipedia is CC-BY-SA — attribution required; share-alike implications noted.

Therefore every rendered page carries a source-attribution footer (source name, original URL, license). Every AI-surfaced snippet carries an inline citation. **A snippet without a citation is a bug.**

## 5. Safety and cost contract (reputation-critical, binding)

The free-tier model is weak and cannot be fine-tuned. Entra-specific correctness therefore comes from retrieval, never from model knowledge. The line between *retrieving-and-assembling* (safe) and *generating-from-reasoning* (unsafe on a weak model) governs every AI feature.

- **KQL — informative only.** Surface the relevant Log Analytics article, explain the table (`SigninLogs`, `AuditLogs`) and key columns, link the schema, give operator hints for building a query. **Never emit a runnable KQL query** the user is expected to paste and trust.
- **Graph / Graph beta / PowerShell — retrieval-grounded only.** Surface a code snippet only when it is anchored to a retrieved doc chunk, shown with its source citation beside it. If retrieval contains no grounded snippet, link the documentation instead of inventing code.
- **Universal rule.** The site never presents generated code as authoritative without a live source link beside it.
- **Permission GUIDs.** The Graph permissions reference is the highest-value, highest-risk page. Permission GUIDs and least-privilege mappings must come from retrieved content, never from model memory. (Maintainer practice: verify Graph GUIDs against merill.net.)
- **Web search — opt-in mode, not default.** Default path is RAG over the indexed corpus (cheap, deterministic, cited). Web search is an explicit "search Microsoft Learn live" escape hatch, because each tool round-trip multiplies neuron cost.
- **No vision.** Text-only. Cheaper and sufficient.

## 6. Cost model — staying under the free tier

- **Workers AI: 10,000 neurons/day**, hard-stop on exhaustion (error 4006), no silent billing on the free plan. A ~500-token generation costs roughly 400–600 neurons, so unmitigated generation exhausts the budget within low-double-digit answers/day.
- **Mitigations, in priority order:**
  1. **Answer caching.** Cache generated/retrieved answers in KV or D1 keyed by normalized question. A cache hit costs zero neurons. Most traffic is a small set of repeated questions.
  2. **Incremental embedding.** Embed only changed files per sync (the Entra-Tracker diff logic already exists). A full re-embed every run would blow the daily budget.
  3. **Tiered model routing.** Tiny model for embeddings/classification; small fast model for lookups and "explain this command"; a reasoning/function-calling model only for the genuinely hard, citation-bearing answers.
  4. **History is cached forever.** The historical layer is immutable — embed once, serve indefinitely.
- **Storage** (D1, R2, Vectorize) sits well inside free allocations for a corpus this size.
- **Open verification item:** confirm Vectorize free-tier status on the account dashboard before the storage chunk. Fallback if paid-only: similarity in a Worker over vectors stored in D1/R2.

## 7. Page model

Each major concept page has:

- A **current-state** section, from the Type A corpus, with source-attribution footer.
- A **history / formerly-known-as** section — Azure AD heritage, rename timeline, deprecated equivalents. The memorabilia layer.
- Inline citations on any surfaced snippet.

## 8. Build sequence

Chunks are delivered and reviewed one at a time. This document is chunk 1's primary deliverable, alongside the repo scaffold.

1. **Scaffold + design docs** (this chunk): private repo, directory tree, `wrangler.toml` with bindings declared, `DESIGN.md`, `ARCHITECTURE.md`, `README.md`, architecture diagram. No ingestion code, no Worker logic, no RAG.
2. **Storage tier**: D1 schema, R2 buckets, Vectorize index, bindings wired and verified.
3. **Ingestion pipeline**: cron Worker forking the Entra-Tracker pattern for full-corpus incremental sync (fetch, diff, chunk, embed changed-only).
4. **RAG retrieval + search API**: cited answers, retrieval quality proven. No LLM generation yet.
5. **Frontend foundation**: Pages, Astro/Starlight, brutalist styling, content rendering, source-attribution footers, trust-tier visual treatment.
6. **WebGL logo-evolution hero**: isolated, self-contained, talks to nothing. Late chunk by design.

The LLM-generation layer slots in after chunk 4, once retrieval quality is validated. v1 ships useful on retrieval + caching alone.

## 9. Scope constraints for all bot prompts

- Update all affected docs in the same PR as any product/surface change. No "code first, docs later."
- Do not commit any artifact not in the chunk's deliverables list, even if it seems useful.
- ASCII-only content in `.ps1` / `.sh` / `.bicep` files.
- Verify Graph permission GUIDs against merill.net before use.
