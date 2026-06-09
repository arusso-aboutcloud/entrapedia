// Shared front-end constants. The SOURCES map mirrors the ingestion worker's
// source list so a doc_id ({source}:{path}) resolves to its public GitHub raw
// location + license/attribution for the doc-page proxy and footers. (The search
// API already returns citation data per result; this map is for the doc view.)

export const SOURCES = {
  'entra-docs': {
    owner: 'MicrosoftDocs', repo: 'entra-docs', branch: 'main',
    trust: 'official', layer: 'current', license: 'MIT',
    attribution: 'Microsoft Docs - MicrosoftDocs/entra-docs (MIT)',
    label: 'Microsoft Entra documentation',
  },
  'entra-powershell-docs': {
    owner: 'MicrosoftDocs', repo: 'entra-powershell-docs', branch: 'main',
    trust: 'official', layer: 'current', license: 'MIT',
    attribution: 'Microsoft Docs - MicrosoftDocs/entra-powershell-docs (MIT)',
    label: 'Microsoft Entra PowerShell documentation',
  },
  'graph-docs': {
    owner: 'microsoftgraph', repo: 'microsoft-graph-docs-contrib', branch: 'main',
    trust: 'official', layer: 'current', license: 'CC-BY-4.0',
    attribution: 'Microsoft Graph docs - microsoftgraph/microsoft-graph-docs-contrib (CC-BY-4.0)',
    label: 'Microsoft Graph documentation',
  },
  'azure-docs-aad': {
    owner: 'MicrosoftDocs', repo: 'azure-docs', branch: 'main',
    trust: 'official', layer: 'legacy', license: 'CC-BY-4.0',
    attribution: 'Microsoft Azure docs - MicrosoftDocs/azure-docs (CC-BY-4.0)',
    label: 'Azure documentation (Azure AD heritage)',
  },
};

// Curated, clearly-labelled SAMPLE results shown before the first query, so the
// design language (all three trust tiers + permission/doc kinds + the LP
// advisory) is legible immediately. Real searches replace these. GUIDs are the
// real, verified identifiers for these permissions.
export const SAMPLES = [
  {
    match_type: 'dense', result_kind: 'permission', trust: 'official', layer: 'current',
    permission: 'User.Read.All', privilege: 1, principal: 'both',
    app_guid: 'df021288-bdef-4463-88db-98f22de89214',
    doc_title: 'User.Read.All',
    doc_id: 'graph-docs:concepts/permissions-reference.md',
    snippet: 'Allows the app to read user profiles without a signed-in user. DisplayText: Read all users’ full profiles. Least-privileged read permission over the user object; the broader User.ReadWrite.All is a separate, higher-privilege entry.',
    citation: { source_url: 'https://github.com/microsoftgraph/microsoft-graph-docs-contrib/blob/main/concepts/permissions-reference.md', license: 'CC-BY-4.0', attribution: 'Microsoft Graph docs - microsoftgraph/microsoft-graph-docs-contrib (CC-BY-4.0)' },
  },
  {
    match_type: 'dense', result_kind: 'doc', trust: 'official', layer: 'current',
    doc_title: 'Add multifactor authentication (MFA) to an app',
    doc_id: 'entra-docs:docs/external-id/customers/how-to-multifactor-authentication-customers.md',
    snippet: 'Create a Conditional Access policy that requires multifactor authentication. On the Exclude tab, select your organization’s emergency access or break-glass accounts, then choose the grant control "Require multifactor authentication".',
    citation: { source_url: 'https://github.com/MicrosoftDocs/entra-docs/blob/main/docs/external-id/customers/how-to-multifactor-authentication-customers.md', license: 'MIT', attribution: 'Microsoft Docs - MicrosoftDocs/entra-docs (MIT)' },
  },
  {
    match_type: 'dense', result_kind: 'doc', trust: 'legacy', layer: 'legacy',
    doc_title: 'Azure Active Directory — now Microsoft Entra ID',
    doc_id: 'azure-docs-aad:articles/active-directory/fundamentals/whatis.md',
    snippet: 'Azure Active Directory (Azure AD) is now Microsoft Entra ID. The service, capabilities, licensing and pricing are unchanged; only the name changed (announced July 2023, rename completed during 2023). Existing references and APIs continue to work.',
    citation: { source_url: 'https://github.com/MicrosoftDocs/azure-docs/blob/main/articles/active-directory/fundamentals/whatis.md', license: 'CC-BY-4.0', attribution: 'Microsoft Azure docs - MicrosoftDocs/azure-docs (CC-BY-4.0)' },
  },
  {
    match_type: 'dense', result_kind: 'doc', trust: 'community', layer: 'current',
    doc_title: 'Microsoft Entra ID P1 / P2 — licensing & SKU matrix',
    doc_id: 'm365maps:entra',
    snippet: 'Community-maintained licensing matrix mapping Microsoft Entra ID P1/P2 features to plans and SKUs. Useful as a quick map — verify any licensing decision against the official Microsoft licensing documentation.',
    citation: { source_url: 'https://m365maps.com/', license: 'CC-BY-4.0', attribution: 'M365 Maps - Aaron Dinnage (CC-BY-4.0)' },
  },
];

// An illustrative least-privilege advisory matching the engine's honest-pointer
// shape, shown in the design legend / sample state.
export const SAMPLE_ADVISORY = {
  kind: 'least_privilege', grounded: false,
  note: 'Least-privilege intent detected but not grounded to a specific permission. Results are conceptual guidance, not an authoritative minimal-permission answer. The least-privileged permission for a specific Microsoft Graph operation is published on that operation’s api-reference method page; query a permission by its exact name (e.g. User.Read.All) or GUID for a direct answer.',
};
