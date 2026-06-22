// The nine concept categories (DESIGN.md 3.1) + the cross-cutting heritage lens.
// The editorial taxonomy: drives category nav, the browsable landing, and
// article breadcrumbs. `n` is a brutalist coordinate label.
export const CATEGORIES = [
  { id: 'fundamentals', n: '01', label: 'Fundamentals', blurb: 'What Entra is, the tenant model, the Azure AD->Entra rename and family history, licensing tiers, admin surfaces. Start here.' },
  { id: 'identity', n: '02', label: 'Identity', blurb: 'Users, groups, the directory, authentication (MFA, passwordless, passkeys), SSO, Domain Services, hybrid identity.' },
  { id: 'access', n: '03', label: 'Access & Conditional Access', blurb: 'Conditional Access policies, the enforcement model, named locations, session controls, authentication strength.' },
  { id: 'protection', n: '04', label: 'Identity Protection & Security', blurb: 'Risk-based policies, risky users and sign-ins, risk detections, Identity Protection, security-operator actions.' },
  { id: 'governance', n: '05', label: 'Governance', blurb: 'Entitlement management, access packages, access reviews, lifecycle workflows, PIM.' },
  { id: 'applications', n: '06', label: 'Applications & Workload Identity', blurb: 'App registrations, enterprise apps, service principals, OAuth, consent, managed identities, workload identity federation.' },
  { id: 'agent-id', n: '07', label: 'Agent ID', blurb: 'Governed identities for AI agents, Conditional Access for agents, governance and protection for agents. The Entra frontier.' },
  { id: 'external', n: '08', label: 'External & Decentralized Identity', blurb: 'External ID (B2B/B2C successor), Verified ID (decentralized credentials), and the legacy Azure AD B2C lineage.' },
  { id: 'network-access', n: '09', label: 'Network Access', blurb: 'Global Secure Access: Internet Access, Private Access (ZTNA/SWG).' },
];
export const CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
