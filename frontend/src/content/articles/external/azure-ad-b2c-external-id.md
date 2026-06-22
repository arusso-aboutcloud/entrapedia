---
title: Azure AD B2C and External ID
slug: azure-ad-b2c-external-id
category: external
summary: The Microsoft customer-identity (CIAM) story - from the standalone Azure AD B2C product to its modern successor, Microsoft Entra External ID. A textbook Entra supersession with a real migration path.
tags: [b2c, external-id, ciam, heritage]
layer: legacy
featured: true
last_reviewed: "2026-06-16"
licensing_as_of: "2026-06-16"
see_also: [conditional-access]
draft: true
citations:
  - id: external-id-overview
    title: Microsoft Entra External ID overview (current CIAM offering)
    source_url: https://github.com/MicrosoftDocs/entra-docs/blob/main/docs/external-id/external-identities-overview.md
    license: MIT
    attribution: Microsoft Docs - MicrosoftDocs/entra-docs (MIT)
  - id: b2c-overview
    title: "Azure Active Directory B2C overview (legacy product documentation)"
    source_url: https://github.com/MicrosoftDocs/azure-docs/blob/main/articles/active-directory-b2c/overview.md
    license: CC-BY-4.0
    attribution: Microsoft Azure docs - MicrosoftDocs/azure-docs (CC-BY-4.0)
---

## What it is

This article covers Microsoft's **customer identity and access management (CIAM)** lineage: how you let *external* people - customers, partners, citizens - sign in to *your* apps. The original product was **Azure AD B2C**, a standalone consumer-identity directory with customizable sign-up/sign-in journeys. Its modern successor is **Microsoft Entra External ID**, which folds external identity into the main Entra platform rather than a separate B2C tenant.

## Why it matters

CIAM is a different problem from workforce identity: millions of unmanaged consumer accounts, custom-branded journeys, social logins, and progressive profiling. For a decade Azure AD B2C was the answer, so an enormous amount of production software still runs on it. Understanding the B2C -> External ID supersession matters because it is the single most common "which one do I build on now?" decision in the external-identity space - and because it is the cleanest example of the Entra family's evolve-and-supersede pattern.

## How it relates

External identity is one of the nine Entra concept areas; it sits alongside B2B collaboration (guests in your workforce tenant) and Verified ID (decentralized credentials). It leans on the same platform primitives as the rest of Entra - tokens, the identity platform, and policy. In particular, [Conditional Access](/a/conditional-access) controls apply to external and customer identities too, so the access-policy concepts carry straight over from the workforce side.

## Current state

The current, recommended offering is **Microsoft Entra External ID**, per the [External ID overview](https://github.com/MicrosoftDocs/entra-docs/blob/main/docs/external-id/external-identities-overview.md). New customer-identity solutions are built on External ID (an external-facing tenant configured for customers), which brings CIAM into the unified Entra admin experience and policy model rather than a separate B2C product surface. Azure AD B2C remains documented and supported for existing deployments - see the [legacy B2C overview](https://github.com/MicrosoftDocs/azure-docs/blob/main/articles/active-directory-b2c/overview.md) - but it is the prior generation, not the forward path.

## Licensing

External ID for customers is billed on **monthly active users (MAU)**, not per-seat - a usage model suited to large, fluctuating consumer populations, with a free MAU tier before metering begins. Legacy Azure AD B2C is billed per-MAU on its own meter. Because both are consumption-priced and the free allowances and rates change, treat any specific number as needing verification. *As of 2026-06-16; verify MAU tiers and pricing against the linked Microsoft sources before relying on this - billing models for CIAM have changed more than once.*

## History

**Azure AD B2C** shipped in the mid-2010s as a distinct directory type - a separate B2C tenant, separate from your workforce Azure AD, with its own user-flow and custom-policy (Identity Experience Framework) machinery. Through the 2023 Azure AD -> Microsoft Entra rename it was referred to under the Entra brand, but the bigger shift is architectural: Microsoft introduced **External ID** as the unified successor and has guided new customers toward it, with Azure AD B2C positioned as the legacy generation kept in long-term support for existing tenants. The throughline - *separate B2C product, then unified External ID* - is the heritage story this article preserves; older docs and SDKs that say "Azure AD B2C" describe the prior generation.

## See also

- [Conditional Access](/a/conditional-access) - access policy concepts apply to external and customer identities.
