---
title: Conditional Access
slug: conditional-access
category: access
summary: Microsoft Entra's policy engine for access decisions - it evaluates sign-in signals (who, what, where, how risky) and enforces controls like MFA or device compliance before granting access to protected resources.
tags: [conditional-access, policy, mfa, zero-trust]
layer: current
featured: true
last_reviewed: "2026-06-16"
licensing_as_of: "2026-06-16"
see_also: [azure-ad-b2c-external-id]
draft: true
citations:
  - id: ca-overview
    title: Conditional Access overview (Microsoft Entra documentation)
    source_url: https://github.com/MicrosoftDocs/entra-docs/blob/main/docs/identity/conditional-access/overview.md
    license: MIT
    attribution: Microsoft Docs - MicrosoftDocs/entra-docs (MIT)
  - id: ca-policies
    title: "Building a Conditional Access policy: assignments and access controls"
    source_url: https://github.com/MicrosoftDocs/entra-docs/blob/main/docs/identity/conditional-access/concept-conditional-access-policies.md
    license: MIT
    attribution: Microsoft Docs - MicrosoftDocs/entra-docs (MIT)
  - id: id-protection
    title: What is Microsoft Entra ID Protection (risk-based access)
    source_url: https://github.com/MicrosoftDocs/entra-docs/blob/main/docs/id-protection/overview-identity-protection.md
    license: MIT
    attribution: Microsoft Docs - MicrosoftDocs/entra-docs (MIT)
---

## What it is

Conditional Access is the **policy engine** that sits at the front door of every Microsoft Entra-protected resource. Instead of a binary "is this the right password?", it asks a richer question at sign-in: *given who this is, what they're reaching for, where they are, what device they're on, and how risky the attempt looks, what should we require before letting them through?*

A policy reads as a sentence: **if** these users reach for these resources under these conditions, **then** grant access only with these controls (or block). The classic example: "if anyone signs in to the admin portals, then require multifactor authentication."

## Why it matters

Conditional Access is where a Zero Trust posture stops being a slogan and becomes enforcement. It is the single most important lever an Entra administrator has for the day-to-day security of an organization: it is how you actually require MFA, demand a compliant or hybrid-joined device, block legacy authentication protocols that can't do MFA, or force a fresh sign-in for sensitive actions. Get it right and most credential-based attacks die at the door; get it wrong and you either lock out your own staff or leave the door open.

## How it relates

Conditional Access sits **between authentication and the resource**: identity is proven first, then Conditional Access decides what *else* is required before access is granted. It consumes signals from across the identity model - sign-in and user **risk** from Identity Protection, **device** state from Intune/Entra device registration, **named locations** and IP ranges, and **authentication strength**. Those same policies extend to guests and customers, so it overlaps with [Azure AD B2C and External ID](/a/azure-ad-b2c-external-id) when you protect external-facing access. It is a peer of the authentication-methods and Identity Protection concepts and a building block of Governance scenarios.

## Current state

A Conditional Access policy has two halves: **assignments** (the *if* - target users/groups, target resources or apps, and conditions such as sign-in risk, device platform, location, or client app) and **access controls** (the *then* - grant controls like require MFA, require a compliant device, require an approved app, or require an authentication strength; and session controls like sign-in frequency or app-enforced restrictions) - see the [policy building blocks](https://github.com/MicrosoftDocs/entra-docs/blob/main/docs/identity/conditional-access/concept-conditional-access-policies.md). Policies are additive: every policy that applies must be satisfied, and an explicit block always wins. Best practice is to exclude break-glass/emergency-access accounts from every policy and to roll out in report-only mode first, per the [Conditional Access overview](https://github.com/MicrosoftDocs/entra-docs/blob/main/docs/identity/conditional-access/overview.md).

## Licensing

Conditional Access requires **Microsoft Entra ID P1** for every user the policy applies to, per the [Conditional Access overview](https://github.com/MicrosoftDocs/entra-docs/blob/main/docs/identity/conditional-access/overview.md). **Risk-based** Conditional Access - policies that use sign-in risk or user risk as a condition - additionally requires **Microsoft Entra ID P2**, because the risk signals come from [Identity Protection](https://github.com/MicrosoftDocs/entra-docs/blob/main/docs/id-protection/overview-identity-protection.md). P1/P2 are available standalone and bundled (for example in Microsoft 365 E3/E5). *As of 2026-06-16; licensing and bundling change - verify against the linked Microsoft sources before relying on this for a purchasing or compliance decision.*

## History

Conditional Access began life as an **Azure Active Directory** capability. With the July 2023 rename of Azure AD to Microsoft Entra ID it became **"Microsoft Entra Conditional Access"** - the same engine and policies, under the new brand. Older guidance, blog posts, and PowerShell/Graph references that say "Azure AD Conditional Access" describe the same feature. The rename did not change policy behavior, the Graph resource model, or licensing.

## See also

- [Azure AD B2C and External ID](/a/azure-ad-b2c-external-id) - Conditional Access controls extend to external and customer identities.
