# Entrapedia — Design

`entrapedia.aboutcloud.io` — a **curated Microsoft Entra ID encyclopedia**, served entirely from the Cloudflare free tier.

This document is authoritative. Every implementation chunk inherits the contracts defined here. No code or surface change may contradict this document without updating it first.

> **Identity revision note:** Entrapedia's primary identity is a *curated encyclopedia*. Earlier design framed it around RAG retrieval and search; that subsystem still exists and is excellent, but it is now the **evidence layer** beneath the encyclopedia, not the headline. Search is a utility, not the front door. This document leads with the encyclopedia identity throughout.

## 1. What Entrapedia is

Entrapedia is a curated encyclopedia of Microsoft Entra ID, for two audiences at once: users who need to understand a concept ("what is this, how does it fit together"), and engineers who need precise, source-linked technical detail ("what permission, what cmdlet, which license, what changed").

It is **not** a search engine over documents, and it is **not** an auto-assembled aggregation of retrieved snippets. It is a body of **authored, browsable, interlinked concept articles**, where:

- The **editorial spine** — what the core concepts are, how they're explained, how they relate, and how they're organized — is curated by a domain expert. This is the product's differentiator and the thing that makes it an encyclopedia rather than an index.
- The **evidence** — technical detail, current-state facts, licensing, citations — is drawn from the corpus (official Microsoft docs and attributed sources). The corpus proves; the curation structures and explains.
- The **historical/heritage lens** — the Azure AD → Entra ID lineage, renamed features, retired products, deprecated-with-modern-equivalent — threads through every article. This is a core differentiator: no other reference tells the evolution story coherently.

The distinguishing test: a visitor should arrive to *browsable structure and authored articles with a sense of place*, not a query box and a results list.

## 2. Design principles

- **Curated-first, corpus-backed.** Authored editorial structure is primary; the corpus is the cited evidence layer beneath it. Auto-assembling pages purely from retrieval is explicitly rejected — it produces an "agglomerate of information," not an encyclopedia.
- **Search is a utility.** Search exists and is useful, but it is demoted to a tool in the corner, not the landing experience.
- **Cloudflare-native, zero cost.** Pages, Workers, Workers AI, Vectorize, D1, R2, Cron Triggers only. No service lacking a free tier (Browser Rendering, Hyperdrive, Images are out of scope).
- **Informative-first, retrieval-grounded.** The site shows authoritative sources and helps the reader understand them. Claim-bearing content is cited; the site does not assert unverified technical facts.
- **Trust tiers are first-class.** Every stored chunk and every cited claim carries a trust level. Official Microsoft content is authoritative; community/third-party content is attributed and flagged, and never outranks official in conflict.
- **Self-learning by re-indexing the source of truth.** "Self-learning" means scheduled incremental re-indexing of upstream sources, never a model freewheeling.
- **Incremental, human-reviewed delivery.** Built in scoped, reviewed chunks; docs ship with the code they describe.

## 3. The encyclopedia layer (primary)

### 3.1 Concept taxonomy — nine categories + a heritage lens

Articles are organized into nine top-level categories:

1. **Fundamentals** — what Entra is, the tenant model, the Azure AD→Entra rename and family history, licensing tiers (Free/P1/P2/Suite), admin center, Graph / identity platform surfaces. The "start here" category.
2. **Identity (Core Entra ID)** — users, groups, the directory, authentication (MFA, passwordless/passkeys, methods), SSO, Domain Services, hybrid identity (Connect / Cloud Sync).
3. **Access & Conditional Access** — Conditional Access policies, policy-enforcement model, named locations, session controls, authentication strength.
4. **Identity Protection & Security** — risk-based policies, risky users/sign-ins, risk detections, Identity Protection, SOC/security-operator actions.
5. **Governance (ID Governance)** — entitlement management, access packages, access reviews, lifecycle workflows, PIM.
6. **Applications & Workload Identity** — app registrations, enterprise apps, service principals, OAuth/permissions/consent, managed identities, workload identity federation.
7. **Agent ID (AI-agent identity)** — governed identities for AI agents, Conditional Access for agents, governance/protection for agents. The current frontier of the Entra family.
8. **External & Decentralized Identity** — External ID (B2B/B2C successor), Verified ID (decentralized credentials), and the legacy Azure AD B2C lineage.
9. **Network Access (Global Secure Access)** — Internet Access, Private Access (ZTNA/SWG).

**Heritage / Legacy** is a cross-cutting lens, not a tenth silo: the Azure AD lineage, renamed features, and retired products (e.g. Permissions Management, deprecated B2C) thread through the relevant articles via each article's History section and a legacy visual treatment. The `layer=legacy` corpus content (e.g. azure-docs-aad) feeds this.

This taxonomy is the editorial starting structure; it is curated and may evolve.

### 3.2 Article content model — seven sections

Every concept article has this spine. Sections split into **authored** (editorial voice, the curator's expertise) and **cited** (corpus-backed, every claim carries a citation):

1. **What it is** — authored. Plain-language definition and orientation.
2. **Why it matters** — authored. Significance, when/why you encounter it.
3. **How it relates** — authored. Where it sits in the identity model; links to related concepts (the interlinking that makes it a web of knowledge).
4. **Current state** — cited. Technical detail from the official corpus, with source citations.
5. **Licensing** — cited **and dated**. Which tier you need (Free/P1/P2/Suite/standalone), bundling gotchas. Licensing changes frequently and a wrong claim has cost/compliance consequences — this section is cited-evidence content with a visible "verify, licensing changes" posture and an as-of date, drawn from attributed licensing sources (Microsoft licensing docs; M365 Maps / Aaron Dinnage). Never asserted from authored memory.
6. **History (formerly known as)** — cited where possible. Azure AD lineage, prior names, deprecations and modern equivalents. The heritage differentiator.
7. **See also** — authored. Cross-links to related articles.

The authored sections carry the curator's voice and judgment; the cited sections are grounded in and linked to the corpus. This split is the core of the curated-but-grounded identity.

### 3.3 Curation model

Articles are **curated, not auto-generated.** A domain expert defines the concepts, writes the authored sections, and decides the structure and links; the corpus supplies cited detail. The first content pass is **broad-but-shallow** — many concept stubs across the categories to establish structure and navigation — deepened over time. Auto-assembly of article bodies from retrieval is not the model (it reproduces the "agglomerate" problem); retrieval *supports* authoring by surfacing the cited evidence.

### 3.4 Browsable experience

- **Landing page** is browsable structure, not a search box: categories, featured/core concepts, "start here", optionally "what's new" and a heritage entry point. Search is a utility element, not the centerpiece.
- **Navigation**: persistent category nav, breadcrumbs, per-article table of contents, and "see also" cross-links — a sense of place and the ability to wander.
- **Trust + heritage visual encoding** (carried from the frontend work): official vs community legible at a glance; legacy/heritage content visually distinct (archival treatment).

## 4. The evidence layer (supporting subsystem)

The corpus, ingestion, embedding, and retrieval — previously framed as the core — are now the **evidence layer** that makes the encyclopedia accurate and cited. They remain as built; only their framing changes.

### 4.1 Sources — four content types, two trust levels

**Trust levels:** *Official* (Microsoft-published, authoritative) and *Community* (useful, attributed, carries a "verify against Microsoft" flag; never outranks Official in conflict).

**Content types:**
- **Type A — Doc corpus (full text):** `MicrosoftDocs/entra-docs` (MIT), `entra-powershell-docs`, `microsoftgraph/microsoft-graph-docs-contrib`, Entra-relevant subtrees of `azure-docs` (legacy layer).
- **Type B — Change/release feeds:** Microsoft Graph changelog RSS, Entra release-notes RSS, the Microsoft Developer unified changelog, and Entrapedia's own `entra-tracker` RSS.
- **Type C — Editorial/blog:** `devblogs.microsoft.com/identity`, the Entra Blog on Tech Community.
- **Type D — Structured reference:** M365 Maps licensing/SKU matrices (community, CC-BY-4.0, attribute Dinnage); Entrapedia's own AADSTS error catalog and RoleLens role data.

Wikipedia was removed as an ingested source (CC-BY-SA share-alike incompatible with the CC-BY-4.0 content license); it may appear only as an optional external "further reading" link.

### 4.2 Retrieval and search (the utility)

Query → embed (bge-base, 768-dim) → Vectorize search with trust/source/content_type/layer filters → official-outranks-community re-rank → R2/D1 hydration → cited results, with query-result caching for zero-neuron repeats. Permissions-reference uses one-permission-per-chunk + identifier-aware exact matching. This engine powers both the utility search box and the cited-evidence surfaced inside articles.

### 4.3 Storage

R2 (raw corpus bodies), D1 (document/chunk registry, per-permission metadata, answer cache, sync state), Vectorize (embeddings, one index, cosine, trust/source/content_type metadata indexes).

## 5. Licensing obligations (binding)

- `entra-docs` MIT; `azure-docs` and most MicrosoftDocs repos CC-BY-4.0 (content) — per-page attribution + link back required; no rights to Microsoft names/logos/trademarks.
- M365 Maps CC-BY-4.0 by Aaron Dinnage — per-page attribution to Dinnage / m365maps.com, no implied Microsoft endorsement.
- Every rendered page carries a source-attribution footer; every surfaced/cited claim carries a citation. A claim without a citation is a bug.
- Entrapedia code is MIT; content is CC-BY-4.0.

## 6. Safety and cost contract (reputation-critical, binding)

The free-tier model is weak and cannot be fine-tuned. Correctness comes from retrieval and curation, never from model knowledge.

- **KQL — informative only.** Explain tables/columns, link the schema, give operator hints. Never emit a runnable query presented as trustworthy.
- **Graph / Graph beta / PowerShell — retrieval-grounded only.** Surface a snippet only when anchored to a retrieved doc chunk, shown with its citation. If no grounded snippet, link the docs rather than invent code.
- **Permission GUIDs** come from retrieved content, never model memory (verify against merill.net).
- **Licensing claims** are cited-and-dated evidence, never authored-from-memory (see §3.2 item 5).
- **Web search — opt-in mode, not default.**
- **No vision. No LLM generation of article bodies** — articles are authored + cited, not generated.

## 7. Cost model

- Workers AI 10,000 neurons/day, hard reset 00:00 UTC, hard-fails (4006) on exhaustion. Embedding pass throttled at a per-day neuron budget (currently 6,000, ~2.5k reserved for retrieval) — real cost ≈1.25× the token-rate due to per-request overhead.
- Mitigations: answer/query caching (zero-neuron repeats), incremental embedding (changed-only), tiered model use, immutable history cached indefinitely.
- Storage well inside free allocations. Vectorize confirmed available on the account's free plan.

## 8. Build sequence

Delivered and reviewed in scoped chunks. Completed: scaffold + docs; storage tier; Tier-A fetch ingestion (26,575 docs); chunking + embedding (in progress, ~weeks); retrieval engine + cited search; permissions-reference quality fix; frontend foundation.

Now (this revision): re-found the product as a curated encyclopedia.

Next:
- **Article system** — concept-page content model (the seven sections), rendering, interlinking, category nav, browsable landing (search demoted to utility). Built to §3.
- **Curated content (broad-but-shallow)** — author concept stubs across the nine categories; the editorial spine. This is curator work, not bot-generated.
- **api-reference quality (chunk 4b)** — least-privilege retrieval from method pages + snippet-tab-chunk hygiene; gated on api-reference embedding coverage.
- **Tier-B+C feeds**, **Tier-D structured (M365 Maps — feeds the Licensing sections)**, **WebGL heritage hero**, **public-launch prerequisites** (global rate limiter, custom domain, remove dev auth).

## 9. Standing constraints for all chunks

- Update all affected docs in the same change as any product/surface change.
- Commit only the chunk's listed deliverables.
- Article bodies are authored + cited, never auto-generated from retrieval.
- Claim-bearing content (current state, licensing, history) must be cited; licensing additionally dated.
- ASCII-only in `.ps1`/`.sh`/`.bicep`/`.sql`.
- Verify Graph permission GUIDs against merill.net.
- Infra: inspect freely; never delete or recreate Cloudflare resources without confirming first.
