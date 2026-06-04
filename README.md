# Entrapedia

A curated Microsoft Entra ID encyclopedia and reference, served entirely from the Cloudflare free tier.

`entrapedia.aboutcloud.io`

## What it is

Entrapedia answers two kinds of question in one place: the conceptual ("what is this, how does it fit together") for users, and the precise, source-linked technical ("what permission, what cmdlet, what changed") for engineers. It pairs a current-state reference drawn from official Microsoft documentation with an encyclopedic historical layer — the lineage from Azure AD to Microsoft Entra ID, including old names, rename timelines, and deprecated features alongside their modern equivalents.

## How it works

Content is kept current by scheduled incremental re-indexing of upstream sources — official Microsoft doc repositories, change/release feeds, editorial blogs, and a small set of attributed community references. Answers are retrieval-grounded: the site surfaces the authoritative source with a citation rather than generating unverified content. See `DESIGN.md` for the full source model and the safety and cost contracts, and `ARCHITECTURE.md` for the system shape.

## Stack

Cloudflare-native and zero-cost by design: Pages, Workers, Workers AI, Vectorize, D1, R2, and Cron Triggers. Frontend in Astro with Chakra Petch typography and a neo-brutalist visual style.

## Status

Early scaffolding. Built in scoped, reviewed chunks:

1. Scaffold and design docs — current
2. Storage tier
3. Ingestion pipeline
4. RAG retrieval and search
5. Frontend foundation
6. WebGL logo-evolution hero

## Sources and attribution

Entrapedia re-publishes and indexes third-party documentation under its respective licenses, with per-page attribution and links back to original sources. Microsoft documentation is © Microsoft and used under its repository licenses (MIT or CC-BY-4.0 as applicable); Microsoft names and logos are trademarks of Microsoft. Licensing diagrams are attributed to Aaron Dinnage (m365maps.com, CC-BY-4.0). Entrapedia is an independent project and is not affiliated with or endorsed by Microsoft.

## License

To be set before public release. The repository is private during development.
