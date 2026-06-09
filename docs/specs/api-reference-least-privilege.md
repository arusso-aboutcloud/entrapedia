# Spec (plan only) — api-reference least-privilege retrieval (chunk 4b)

**Status: PLAN ONLY. Not started. Build gated on the prerequisite + a spec review.**

Flagship-topic capability that closes the chunk-4 known limitation: answer least-privilege-by-operation queries ("least privilege to list applications", "minimal permission to send mail as a user") with the **published** least-privileged permission for that operation — correct, source-grounded, cited. **No heuristic name→permission mapping** (the explicit reason chunk 4 left this open: a guess on a trust-critical topic is worse than an honest pointer).

## Why this is grounded, not heuristic

Microsoft Graph **api-reference method pages** publish, per operation, a standardized **Permissions** table — e.g. for `GET /applications` ("List applications"):

```
## Permissions
| Permission type | Least privileged permissions | Higher privileged permissions |
|--|--|--|
| Delegated (work or school account) | Application.Read.All | Application.ReadWrite.All, Directory.Read.All, ... |
| Delegated (personal Microsoft account) | Not supported. | Not supported. |
| Application | Application.Read.All | Application.ReadWrite.OwnedBy, Application.ReadWrite.All, ... |
```

The "Least privileged permissions" column **is** the authoritative answer. This capability retrieves the right method page and returns that column — sourced and cited. These pages are already entering the corpus (Tier-1 backfill includes `graph-docs:api-reference/`), so no new ingestion is required, only structured extraction + a retrieval path.

## Prerequisite

The Graph api-reference method-page set embedded. The backfill is in flight; this chunk queues immediately after it reaches that set. A first build step must confirm coverage (count of `graph-docs:api-reference/**` method pages with a parseable Permissions table).

## Plan

1. **Discovery / format validation (first step, do before coding).** Inspect a sample of ingested `api-reference/**` method pages in R2 to confirm the current Permissions-table shape and variants (the table format has changed over Graph's history; older pages may use a flat permission list rather than the least/higher-privileged two-column form, and beta vs v1.0 pages differ). Record the variants the parser must handle. Do not assume the example above is universal until verified against the corpus.

2. **Structured extraction (api-reference-specific parser).** Allowlisted to `graph-docs:api-reference/**` method pages (same `STRUCTURED_TABLE_DOCS` seam pattern as permissions-reference; prose docs untouched). Per method page extract:
   - **operation identity** — method title (frontmatter/H1, e.g. "List applications") and the HTTP request line(s) from the "HTTP request" section (e.g. `GET /applications`, `GET /applications/{id}`).
   - **per principal type** (delegated work/school, delegated personal-MSA, application): `least_priv` (list) and `higher_priv` (list), preserving `Not supported.` honestly (never fabricate a permission for an unsupported principal).
   - **api version** (v1.0 vs beta) from the path; prefer v1.0, tag both.

3. **Storage.** New D1 table `op_permissions` keyed by method-page `doc_id`: `operation_title`, `http_method`, `http_path`, `principal`, `least_priv`, `higher_priv`, `api_version`. Indexed for lookup. The method page is also embedded as a normal chunk (it already is, via the backfill) so the operation is retrievable by dense similarity; the structured LP answer is joined from `op_permissions`.

4. **Retrieval path for LP-intent queries.** When `/search` detects a least-privilege cue and the query is NOT a literal permission identifier (those still resolve via the permissions-reference Tier-0, unchanged):
   - dense-retrieve over api-reference operation chunks;
   - for the top operation match(es), join `op_permissions` and return the **least-privileged permission(s)** as the grounded answer, cited to the method page (the authoritative source), cross-linked to each permission's permissions-reference entry (name + GUID);
   - if no operation matches with sufficient confidence, fall back to the current chunk-4 honest advisory (`least_privilege_grounded: false`). The fallback is the floor, never a guess.

5. **Composition.** Layers cleanly on chunk 4: exact name/GUID → permissions-reference Tier-0 (unchanged); LP-intent + operation → this api-reference path; everything else → dense. The trust re-rank and `advisory` mechanics are reused.

6. **Citations / trust.** Answer cites the method page's least-privileged column (official; MIT/CC-BY) and cross-references the permission GUID from permissions-reference. Both official — no community/heuristic content in the LP path.

## Edge cases the spec must address at build time

- `Not supported.` principal rows — represent as unsupported, do not emit a permission.
- Multiple least-privileged permissions for one operation/principal — return all.
- Operation disambiguation (e.g. "list applications" vs "list app registrations") — return the top operation(s) by retrieval score with their LP perms; let citations disambiguate. Never merge across operations.
- Non-standard / legacy Permissions sections — flag and fall back to the advisory rather than mis-parse.
- beta-only operations — tag version; prefer v1.0 when both exist.

## Cost

No new embedding beyond the in-flight backfill (method pages are Tier-1). Extraction is structural (parse + D1 writes, zero neurons). Retrieval adds one D1 join per LP query. Free-tier throughout.

## Sign-off bar (to define fully at build, illustrative)

- "least privilege to list applications" → `Application.Read.All`, cited to the `GET /applications` method page's least-privileged column.
- "minimal permission to send mail as a user" → the send-mail operation's least-privileged permission, cited.
- A spread of operations across families (users, groups, mail, directory).
- An unsupported-principal operation → represented honestly (no fabricated permission).
- Regression: chunk-4 §5 set (permissions-reference exact-match, mislabeling, fuzzy guard, scoping) still passes; LP queries with no matching operation still return the honest advisory.

## Scope guardrails (carried from chunk 4)

Permissions/api-reference-scoped, not corpus-wide hybrid search. No heuristic name→permission dictionary. The least-privilege answer is always the **published** least-privileged column, retrieved and cited — or the honest advisory. Generation layer remains a separate later chunk.
