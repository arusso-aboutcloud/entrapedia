# Security

Entrapedia is a static, read-only reference site served from the Cloudflare free tier. It stores no user accounts, no secrets belonging to visitors, and performs no write actions against any tenant. Its threat surface is correspondingly small, but the project treats a few things as security-relevant by design.

## Security posture

- **No tenant write paths.** Entrapedia never authenticates to, nor writes to, any Microsoft tenant. It indexes public documentation only. Any code snippet it surfaces is informational and carries a citation to its source.
- **Retrieval-grounded output.** The site does not generate unverified technical content. KQL is informative-only; Graph and PowerShell snippets are surfaced only when grounded in retrieved documentation, with a source link. This is a correctness and reputation control as much as a security one — see `DESIGN.md` section 5.
- **Secrets.** Cloudflare API tokens, account IDs, and any deployment credentials live only in Cloudflare/Wrangler secrets and local `.dev.vars` (gitignored). No secret is ever committed. Secret scanning with push protection is enabled on the repository.
- **Dependencies.** Dependabot is enabled. Workflow actions, when added, are pinned to commit SHAs rather than floating tags.
- **Least privilege for automation.** The ingestion pipeline uses read-only access to upstream public sources. Cloudflare tokens used by automation are scoped to the minimum resources required for the relevant chunk.

## Reporting a vulnerability

If you find a security issue, please open a private report via the repository's security advisories, or contact the maintainer directly rather than filing a public issue. Please include enough detail to reproduce. You will receive an acknowledgement; coordinated disclosure is appreciated.

## Scope

In scope: the Entrapedia codebase, its Cloudflare configuration, and its handling of credentials and dependencies. Out of scope: the content of upstream sources (report documentation errors to the upstream owner), and the security of Microsoft Entra ID itself.
