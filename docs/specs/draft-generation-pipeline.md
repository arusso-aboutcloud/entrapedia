# Spec (plan only) — grounded draft-generation pipeline

**Status: SPEC ONLY. No pipeline code until this is approved.** On approval: build the CLI + validation, then generate ONE grounded draft for a fresh concept (not an existing exemplar) for quality/grounding review before any batch.

## Goal

An authoring-throughput unlock: produce **grounded, cited first drafts** of concept articles from the existing corpus, so the curator *edits-and-approves* instead of authoring from a blank page (~3h/article -> ~30min editing). The corpus is the source of truth; the tool retrieves first, then drafts only from what it retrieved. It never publishes — every output is a `draft: true` markdown file for human review.

## Non-negotiable constraints (these define the design)

1. **Zero cost.** Generation runs on the curator's **self-hosted LLM** (homelab, e.g. local DeepSeek / Hermes box), invoked locally. No paid model API. No Workers AI **generation** spend. The Cloudflare side stays read-only.
2. **Local CLI, never a Worker.** Authoring-time tooling the curator runs locally. Never scheduled, never exposed publicly, never auto-publishing. Output is markdown files in the repo.
3. **Strictly grounded.** Every claim traces to a retrieved corpus chunk with a real citation. No grounding for a cited section -> a marked TODO stub, never invented prose.
4. **Hard human-review gate.** Drafts land `draft: true`; the pipeline **cannot** set `draft: false`. Only the curator publishes, via a normal git commit/PR after editing.
5. **Version-controlled markdown** in the existing format (`frontend/src/content/articles/<category>/<slug>.md`, matching `content.config.ts` frontmatter + the seven-section body).

## 1. Architecture

A Node ESM CLI under a new top-level **`tools/draftgen/`** (NOT `frontend/`, NOT `workers/` — it is not part of any deployed artifact):

```
tools/draftgen/
  draftgen.mjs          # CLI entry: parse args, orchestrate retrieve->compose->validate->write
  retrieve.mjs          # read-only client of the existing /search retrieval engine
  compose.mjs           # calls the self-hosted LLM section-by-section
  validate.mjs          # the grounding gate (blocks a draft from being written)
  write.mjs             # assembles + writes the .md (draft:true) to the category path
  prompts.mjs           # the system/section prompt templates (the safety core)
  config.example.json   # committed template (no secrets)
  seeds/                # concept seed files (taxonomy input)
    example.yml
  config.json           # LOCAL, git-ignored: endpoints + any secret
  .rejected/            # LOCAL, git-ignored: drafts that failed validation
```

`.gitignore` adds `tools/draftgen/config.json` and `tools/draftgen/.rejected/`.

### Invocation

```
# single concept
node tools/draftgen/draftgen.mjs --slug named-locations --title "Named locations" \
     --category access --topic "conditional access named locations IP ranges"

# from a seed file (batch — see 6)
node tools/draftgen/draftgen.mjs --seeds tools/draftgen/seeds/access.yml
```

Flags: `--slug --title --category --topic [--sub <section>=<query> ...] [--layer current|legacy] [--see-also slug,slug] [--dry-run] [--force]`. `--dry-run` retrieves + composes + validates and prints the report **without writing**. `--force` is the only way to overwrite an existing article, and it refuses if that article is `draft: false` (published) unless additionally `--overwrite-published` is given (a deliberate, loud double-opt-in).

### Endpoints (config-driven, never hardcoded)

`config.json` (git-ignored), shape mirrored by committed `config.example.json`:

```jsonc
{
  "llm": {
    "endpoint": "http://hermes.lab.local:11434/v1/chat/completions", // OpenAI-compatible chat endpoint
    "model": "deepseek-r1:32b",
    "api_key": "",            // usually empty for a homelab server
    "temperature": 0.2,        // low: drafting, not creativity
    "max_tokens": 1400,
    "timeout_ms": 120000
  },
  "retrieval": {
    "endpoint": "https://entrapedia.pages.dev/api/search", // the PUBLIC, secret-free proxy (default)
    "bearer": null,            // OR set to the worker /search secret to use the worker directly
    "top_k": 10,
    "per_section_top_k": 6
  }
}
```

- **LLM**: any OpenAI-compatible local server (Ollama / llama.cpp / vLLM / LM Studio). The CLI POSTs `chat/completions`. The endpoint/model live in local config — nothing about the homelab is committed.
- **Retrieval**: default is the **public `/api/search` proxy** — read-only, no secret, already rate-limited and cache-friendly. Optionally point `endpoint` at the worker `/search` with `bearer` set (the curator holds the secret in local config) for higher `top_k` and no rate-limit friction. Either path is **read-only** (it only issues search queries; it never writes to D1/R2/Vectorize).

### Cost statement

Generation is 100% on the self-hosted LLM => **zero Cloudflare cost, zero Workers AI generation neurons**. The only Cloudflare touch is retrieval: each uncached search query embeds at ~1 neuron (the *existing* retrieval cost, drawn from the existing retrieval reserve, and answer-cache/edge-cache friendly across re-runs). No new generation spend exists. The tool runs at the curator's pace, locally; nothing runs on a schedule.

## 2. Flow: retrieve -> compose -> validate -> write

### 2.1 Retrieve grounding (per concept)

- Run the concept `topic` against `/search`, plus **per-section sub-queries** to target the cited sections:
  - **Current state**: `"<concept> overview how it works"` (+ the topic).
  - **Licensing**: `"<concept> license requirement Microsoft Entra ID P1 P2 plan"`.
  - **History**: `"<concept> formerly Azure AD renamed deprecated"`.
  - Sub-queries are overridable per concept (`--sub licensing="..."` or a seed field).
- Merge results, **dedupe by `doc_id`**, **prefer official trust** (drop community when an official source covers the same ground; keep community only when it is the only source, carrying its verify flag). Cap the grounding set (e.g. <= 14 distinct docs) to fit the local model's context.
- Build the **grounding set**: an ordered list of `{ sid, doc_title, snippet/chunk_text, source_url, license, attribution, trust, layer, result_kind, permission?, guid? }`. Each gets a short stable **source id** `S1..Sn`. Permission results carry their `permission` name + GUID explicitly (high-risk handling, see 5).
- If the grounding set is empty or thin, the report says so and most cited sections will stub.

### 2.2 Compose (self-hosted LLM, section by section)

Section-by-section (not whole-article) for control and to bound hallucination — each call sees only its relevant grounding + its section contract:

- **Authored sections** (What it is / Why it matters / How it relates / See also): drafted in clear, neutral encyclopedia prose for orientation. The model MAY frame conceptually, but MUST NOT assert specific cited-class facts (GUIDs, license tiers, dates, product-history specifics, exact feature lists) unless supported by a provided source (cited). Output carries a trailing `<!-- voice-check: curator pass needed -->` marker so the curator knows to apply their voice. "How it relates" is given the list of sibling concept slugs so it can interlink (`/a/<slug>`); "See also" is generated from `see_also` + retrieved-adjacent concepts.
- **Cited sections** (Current state / Licensing / History): drafted **only** from the section's retrieved chunks; every factual claim carries an inline citation token `[[Sk]]` referencing a provided source id. If the provided chunks don't support a section, the model returns exactly `<!-- TODO: needs grounding -->`. **Licensing** additionally must carry an as-of date and the "verify, licensing changes" posture, and may only state tiers/SKUs present in the excerpts.

Citation tokens `[[Sk]]` are resolved by `write.mjs` into inline markdown links `[claim](source_url)` and a frontmatter `citations[]` built from the **used** source ids only.

### 2.3 Validate (the gate — see 4)

The composed draft is validated **before** anything is written. Pass -> write the article file. Fail -> write `<slug>.REJECTED.md` into `.rejected/` (git-ignored) with an inline failure report; **never** the clean article path.

### 2.4 Write

Assemble frontmatter (`title, slug, category, summary, tags, layer, see_also, last_reviewed, licensing_as_of, draft: true, citations[]`) + the seven-section body, write to `frontend/src/content/articles/<category>/<slug>.md`. Print a **grounded-vs-stubbed report**: per section, grounded (n citations) | stubbed (TODO) | authored (voice-check), plus the trust mix of the grounding set. The CLI never `git add`s or commits — the curator reviews, edits, and commits.

## 3. Generation prompts (the safety core)

Verbatim templates (in `prompts.mjs`). `{SECTION}` / `{INTENT}` / `{SOURCES}` / `{CONCEPT}` are filled per call. `{SOURCES}` renders each as `[[S1]] <doc_title> (<trust>): <chunk_text>` ...

### System prompt — CITED sections (Current state / History)

```
You draft ONE section of a Microsoft Entra ID encyclopedia article, for expert human review.
Write ONLY from the SOURCE EXCERPTS provided. Rules, in priority order:
1. Every factual claim MUST be supported by an excerpt and cited inline as [[Sk]] using that
   excerpt's id, placed immediately after the claim.
2. If the excerpts do not support a claim, DO NOT write it. Omit it.
3. Do NOT use any knowledge beyond the excerpts. No outside facts, numbers, names, or dates.
4. If the excerpts contain no usable grounding for this section, output EXACTLY:
   <!-- TODO: needs grounding -->
   and nothing else.
5. A permission name or GUID may ONLY appear if it is present verbatim in an excerpt; cite it.
6. Output only the section prose (no heading, no preamble, no closing remarks).
7. Voice: precise, neutral, plain encyclopedia English. Short paragraphs.
```

### System prompt — LICENSING (cited + dated, extra-guarded)

```
You draft the LICENSING section of a Microsoft Entra ID encyclopedia article, for expert review.
Write ONLY from the SOURCE EXCERPTS. Additional rules beyond strict grounding:
- State a license tier, SKU, plan, or price ONLY if an excerpt states it; cite each with [[Sk]].
- Do NOT infer or generalize licensing from product behavior or memory.
- End the section with: "*As of {AS_OF_DATE}; licensing changes - verify against the linked
  sources before relying on this.*"
- If no excerpt addresses licensing, output EXACTLY: <!-- TODO: needs grounding -->
Output only the section prose.
```

### System prompt — AUTHORED sections (What it is / Why it matters / How it relates / See also)

```
You draft ONE orienting section of a Microsoft Entra ID encyclopedia article, for expert review
and a curator voice-pass. Write clear, neutral, conceptual encyclopedia prose.
- You may explain the concept at a conceptual level for a general reader.
- You MUST NOT state specific facts that need a source - GUIDs, license tiers, version numbers,
  dates, product-rename history, or exhaustive feature lists - UNLESS supported by a provided
  excerpt, cited [[Sk]]. When unsure, stay conceptual rather than specific.
- For "How it relates"/"See also", link related concepts as /a/<slug> from the provided slug list.
- End your output with the marker <!-- voice-check: curator pass needed -->
Output only the section prose (no heading).
```

User message per call carries: `{CONCEPT}` (title + one-line intent), `{SECTION}` + `{INTENT}` (what the section should cover), `{SOURCES}` (the section's grounding chunks with ids), and for authored sections the sibling-slug list.

## 4. Validation rules (a draft is BLOCKED from the clean path unless ALL pass)

1. **Frontmatter** parses as YAML, contains all `content.config.ts` required fields, `layer` in {current, legacy}, dates are quoted strings, `draft: true` present and `true`.
2. **Citation closure**: every `[[Sk]]` / resolved citation URL in the body maps to an entry in frontmatter `citations[]`; and every frontmatter citation's `source_url` is in the **retrieved grounding set** for this run (no fabricated or out-of-set URLs).
3. **Cited-section grounding**: each of Current state / Licensing / History either contains >= 1 citation OR is exactly the `<!-- TODO: needs grounding -->` stub. No cited section may contain uncited factual prose.
4. **Licensing posture**: a non-stub Licensing section contains an as-of date and the "verify" line.
5. **GUID provenance**: any 8-4-4-4-12 hex GUID in the body must appear verbatim in some grounding chunk's text; otherwise FAIL (no GUID from model memory). Same for any `Permission.Name.All`-style token presented as authoritative.
6. **Structure**: the seven canonical H2 headings are present and in order; no section is empty (stub counts as present).
7. **Slug safety**: target path doesn't already hold a `draft: false` article (unless `--overwrite-published`); a `draft: true` target requires `--force`.
8. **Authored-section discipline** (best-effort lint): authored sections containing a GUID, a `P1/P2/SKU` token, or a 4-digit year that is NOT cited are flagged for review (warning, not a hard fail — the curator voice-pass catches these).

Fail on 1-7 -> `.rejected/<slug>.REJECTED.md` + a printed reason; the clean article file is not written.

## 5. High-risk content (DESIGN.md 6)

- **Permission GUIDs**: only from retrieved permission chunks (the engine's identifier-aware path surfaces these with the GUID in `app_guid`/`delegated_guid`). The prompt forbids GUIDs not in excerpts; validation rule 5 enforces it.
- **Licensing**: only from retrieved licensing sources, always dated, always carrying the verify posture; validation rule 4 enforces the posture; rule 2/3 enforce grounding.

## 6. Batch mode (broad-but-shallow)

Input: a **seed file** (`tools/draftgen/seeds/<name>.yml`), ideally one per category, seeded from the nine-category taxonomy (`frontend/src/lib/categories.mjs`):

```yaml
# tools/draftgen/seeds/access.yml
category: access
concepts:
  - slug: named-locations
    title: Named locations
    topic: conditional access named locations IP ranges countries
    see_also: [conditional-access]
  - slug: authentication-strength
    title: Authentication strength
    topic: conditional access authentication strength MFA methods
  - slug: session-controls
    title: Conditional Access session controls
    topic: conditional access session controls sign-in frequency
```

The CLI iterates concepts **sequentially**, grounding each **independently** (its own retrieval + its own per-section composition + its own validation). Broad-but-shallow falls out naturally: where the corpus has coverage, sections are grounded; where it doesn't, they stub — so a batch produces many honest, partially-grounded `draft: true` stubs across a category, each ready for curator deepening. Batch is gated behind single-draft review (below). It is still local, manual, and non-publishing.

## 7. What the pipeline CANNOT do (explicit)

- **Cannot publish.** It only ever writes `draft: true`; it has no path that sets `draft: false`. Publishing is a separate human git action.
- **Cannot auto-run.** No cron, no Worker, no scheduler, no CI hook. Manual local invocation only.
- **Cannot run server-side or be exposed.** It is not a Worker and is not deployed; it never serves traffic.
- **Cannot spend generation neurons.** Generation is the self-hosted LLM; the only Cloudflare call is read-only retrieval (existing ~1-neuron query embeds, cached).
- **Cannot invent uncited claims.** Ungrounded cited content becomes a TODO stub; validation blocks uncited factual prose and out-of-set citations.
- **Cannot commit** or push. The curator reviews/edits/commits.
- **Cannot overwrite a published article** without a deliberate double-opt-in flag.

## 8. Seed / taxonomy input format

- Single concept via flags (3.1), or a seed YAML (6). Seed fields: `slug` (required, unique), `title` (required), `category` (one of the nine ids), `topic` (required retrieval seed), optional `sub_queries` (per-section overrides), `layer`, `see_also`. A `--seeds-from-taxonomy` helper can scaffold an empty seed file per category from `categories.mjs` for the curator to fill in concept names.

## 9. Demonstration (after approval)

Build the CLI + validation, then generate **one** draft for a **fresh** concept (not Conditional Access / B2C) — candidates: **Named locations** (access), **Privileged Identity Management** (governance), or **Managed identities** (applications). Deliver the `draft: true` file + the grounded-vs-stubbed report for review of draft quality and grounding fidelity, before any batch run.

## Open decisions for review

1. **Retrieval endpoint default**: public `/api/search` proxy (no secret, simplest, top_k<=10, rate-limited) vs. worker `/search` with the secret in local config (higher top_k, no rate limit). Default proposed: public proxy; switch per local config.
2. **Citation rendering**: inline `[claim](source_url)` links (matches the exemplars) resolved from `[[Sk]]` tokens, plus the frontmatter `citations[]` block. Confirm this is the desired on-page citation form vs. numbered footnotes.
3. **Authored-section drafting**: draft them (conceptual, voice-check flagged) as specced, or leave authored sections as empty curator stubs and only auto-draft the cited sections? (Proposed: draft conceptually + flag, since a starting paragraph still saves time; the curator owns voice.)
