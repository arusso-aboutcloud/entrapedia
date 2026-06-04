# Contributing

Entrapedia is in early development and built in scoped, reviewed chunks. This document records how work lands, so that both human and automated contributors follow the same discipline.

## Working principles

- **Docs ship with code.** Every change that alters the product or its surface updates all affected documentation in the same pull request — `README.md`, `DESIGN.md`, `ARCHITECTURE.md`, `SECURITY.md`, `ROADMAP.md`, and this file, as relevant. No "code first, docs later."
- **`DESIGN.md` is authoritative.** No change may contradict the design contracts (source tiers, trust levels, the safety and cost contract) without updating `DESIGN.md` first, in the same PR.
- **Scoped deliverables only.** A change set commits only what its scope calls for. Do not add files outside the stated deliverables, even if they seem useful — raise it for discussion instead.
- **Incremental, verifiable steps.** Prefer small chunks with explicit done-criteria over large speculative ones.

## For automated contributors (bots)

- Each task specifies an exact deliverables list. Commit nothing outside it.
- Each task includes a doc audit naming which docs change and which do not and why. Honor it.
- Do not provision external resources (Cloudflare or otherwise) unless the task explicitly authorizes it for that chunk.
- ASCII-only content in `.ps1`, `.sh`, and `.bicep` files.
- Verify any Microsoft Graph permission GUID against an authoritative reference before use.

## Code and content standards

- Cloudflare-native, free-tier only. No service lacking a free tier (see `ARCHITECTURE.md`).
- Workflow actions pinned to commit SHAs, not floating tags.
- Surfaced technical content carries a source citation; pages carry an attribution footer per their source license.

## Branching

During early development the scaffold and initial chunks may commit directly to `main`. Once the storage and ingestion chunks land, changes move to pull requests against `main` with the doc audit included in the PR description.
