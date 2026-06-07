# Chunking dry-run report (chunk 3b, phase 1)

Dry run only: NO embedding, NO vector inserts, NO `chunks` writes, NO Workers AI calls.
Chunker: `workers/ingestion/chunker.mjs` (heading-aware, ~512-token target, code/table-safe).

## Key findings / decisions needed before phase 2

1. **Projected ~144,254 chunks** for the full corpus (table below). At the (unconfirmed) 9 neurons/chunk this is a multi-week first pass on the free tier -- confirms DESIGN's "embed once, cache forever, incremental" model is essential.
2. **Oversized chunks vs the model's 512-token limit.** `@cf/baai/bge-base-en-v1.5` truncates input at **512 tokens**. 386 of 2209 sample chunks (17.5%) exceed that by ESTIMATE (note: the estimator over-counts, so true overflow is somewhat lower). The genuine problem is un-splittable blocks: a few **huge property/permission tables** and large code blocks. Worst offender: `api-reference/v1.0/resources/user.md` -- a single property table chunk of ~9,980 tokens that would lose ~95% of its content at embed time. **DECISION:** how to handle tables/code that exceed 512 tokens -- e.g. split large tables by row-groups (relaxing the no-split-tables rule for tables over the limit), keep a header row on each split, or accept truncation for these. Recommend: split oversized tables by row-groups with the header repeated; leave normal tables intact.
3. **Orphan merges:** 150 chunks merged a tiny trailing section into the previous chunk (working as intended -- no near-empty chunks).

## Method

- Sample: 410 docs requested, 410 chunked (0 fetch failures), spanning all four sources + the priority/edge-case docs.
- Bodies fetched from GitHub raw (byte-identical to the R2 corpus, verified earlier).
- Token counting: WordPiece approximation for bge-base (BERT uncased) -- `estimateTokens()` in the chunker. Alphanumeric words inflate ~len/4 subwords; punctuation ~1 token each. Tends to slightly OVER-count vs the real tokenizer (conservative for budgeting).
- Neuron assumption: **9 neurons per chunk** for `@cf/baai/bge-base-en-v1.5` embedding -- FLAGGED, confirm against Workers AI pricing before phase 2.

## Projected full-corpus chunk count

| source | sampled docs | sampled chunks | chunks/doc | corpus docs | projected chunks |
|---|--:|--:|--:|--:|--:|
| graph-docs | 325 | 1733 | 5.33 | 21237 | 113242 |
| entra-docs | 60 | 372 | 6.2 | 4385 | 27187 |
| entra-powershell-docs | 15 | 53 | 3.53 | 661 | 2336 |
| azure-docs-aad | 10 | 51 | 5.1 | 292 | 1489 |
| **total** | | | | 26575 | **144254** |

## Token-per-chunk distribution

- chunks measured: 2209
- min 49 / median 363 / mean 441 / p95 690 / max 9980

| token bucket | chunks |
|---|--:|
| 0-128 | 1 |
| 128-256 | 2 |
| 256-384 | 1310 |
| 384-512 | 506 |
| 512-640 | 226 |
| 640-768 | 79 |
| 768-+ | 85 |

## Embedding neuron projection

- projected chunks: 144254
- assumed neurons/chunk: 9  ->  total first-pass neurons ~ **1,298,286**
- free tier: 10,000 neurons/day (hard stop). At a conservative ~9000/day cap -> ~1000 chunks/day -> **~145 daily runs** for a full first pass.
- (History layer is immutable -> embed once; steady-state is incremental changed-chunks only.)

Sensitivity to the (unconfirmed) neuron/chunk cost:

| neurons/chunk | total neurons | daily runs @9k/day |
|--:|--:|--:|
| 3 | 432,762 | 49 |
| 6 | 865,524 | 97 |
| 9 | 1,298,286 | 145 |
| 15 | 2,163,810 | 241 |
| 20 | 2,885,080 | 321 |

## Flagged anomalies (216)

- `oversized_table`: 34 chunks
- `merged_orphan`: 150 chunks
- `oversized_code_block`: 38 chunks
- `yml_unit`: 2 chunks

Chunks over the 512-token model limit (by estimate): **386 / 2209 (17.5%)**. Worst offenders:

| doc_id | chunk | tokens | flags |
|---|--:|--:|---|
| graph-docs:api-reference/v1.0/resources/user.md | 1 | 9980 | oversized_table |
| graph-docs:api-reference/beta/api/intune-devices-windowsmanageddevice-create.md | 2 | 8087 | oversized_table |
| graph-docs:api-reference/v1.0/resources/user.md | 0 | 6896 | oversized_table |
| graph-docs:api-reference/beta/api/intune-deviceconfig-windows10generalconfiguration-get.md | 2 | 4762 | oversized_code_block |
| entra-docs:docs/id-governance/privileged-identity-management/pim-how-to-activate-role.yml | 0 | 4499 | yml_unit |
| graph-docs:api-reference/beta/api/subscription-reauthorize.md | 1 | 4323 | oversized_table |
| graph-docs:concepts/permissions-reference.md | 423 | 4007 | oversized_table,merged_orphan |
| graph-docs:api-reference/beta/api/intune-deviceconfig-iosgeneraldeviceconfiguration-get.md | 2 | 3557 | oversized_code_block |

## Sample chunks (verbatim)

### graph-docs:concepts/permissions-reference.md [chunk 0] -- 369 tok 
source=graph-docs trust=official content_type=A layer=current

```
# Microsoft Graph permissions reference

For an app to access data in Microsoft Graph, the user or administrator must grant it the necessary permissions. This article lists the delegated and application permissions exposed by Microsoft Graph. For guidance about how to use the permissions, see the [Overview of Microsoft Graph permissions](permissions-overview.md).

To read information about all Microsoft Graph permissions programmatically, sign in to an API client such as Graph Explorer using an account that has at least the *Application.Read.All* permission and run the following request.

```msgraph-interactive
GET https://graph.microsoft.com/v1.0/servicePrincipals(appId='00000003-0000-0000-c000-000000000000')?$select=id,appId,displayName,appRoles,oauth2PermissionScopes,resourceSpecificApplicationPermissions
```

[!INCLUDE [auth-use-least-privileged](../includes/auth-use-least-privileged.md)]

<!-- Autogenerated content starts here. Do not manually update. Manual updates are overwritten in weekly updates. If you see an error in this article, file a documentation issue instead. See https://github.com/microsoftgraph/microsoft-graph-docs-contrib/blob/main/CONTRIBUTING.md#ways-to-contribute -->
```

### graph-docs:concepts/permissions-reference.md [chunk 1] -- 386 tok 
source=graph-docs trust=official content_type=A layer=current

```
# Microsoft Graph permissions reference
## All permissions
### AccessReview.ReadWrite.All

| Category | Application | Delegated |
|--|--|--|
| Identifier | d07a8cc0-3d51-4b77-b3b0-32704d1f69fa | ebfcd32b-babb-40f4-a14b-42706e83bd28 |
| DisplayText | Read all access reviews | Read all access reviews that user can access |
| Description | Allows the app to read access reviews, reviewers, decisions and settings in the organization, without a signed-in user. | Allows the app to read access reviews, reviewers, decisions and settings that the signed-in user has access to in the organization. |
| AdminConsentRequired | Yes | Yes |

---

| Category | Application | Delegated |
|--|--|--|
| Identifier | ef5f7d5c-338f-44b0-86c3-351f46c8bb5f | e4aa47b9-9a69-4109-82ed-36ec70d85ff1 |
| DisplayText | Manage all access reviews | Manage all access reviews that user can access |
| Description | Allows the app to read, update, delete and perform actions on access reviews, reviewers, decisions and settings in the organization, without a signed-in user. | Allows the app to read, update, delete and perform actions on access reviews, reviewers, decisions and settings that the signed-in user has access to in the organization. |
| AdminConsentRequired | Yes | Yes |

---
```

### graph-docs:concepts/permissions-reference.md [chunk 2] -- 370 tok 
source=graph-docs trust=official content_type=A layer=current

```
# Microsoft Graph permissions reference
## All permissions
### Acronym.Read.All

| Category | Application | Delegated |
|--|--|--|
| Identifier | 18228521-a591-40f1-b215-5fad4488c117 | 5af8c3f5-baca-439a-97b0-ea58a435e269 |
| DisplayText | Manage access reviews for group and app memberships | Manage access reviews for group and app memberships |
| Description | Allows the app to read, update, delete and perform actions on access reviews, reviewers, decisions and settings in the organization for group and app memberships, without a signed-in user. | Allows the app to read, update, delete and perform actions on access reviews, reviewers, decisions and settings for group and app memberships that the signed-in user has access to in the organization. |
| AdminConsentRequired | Yes | Yes |

---

| Category | Application | Delegated |
|--|--|--|
| Identifier | 8c0aed2c-0c61-433d-b63c-6370ddc73248 | 9084c10f-a2d6-4713-8732-348def50fe02 |
| DisplayText | Read all acronyms | Read all acronyms that the user can access |
| Description | Allows an app to read all acronyms without a signed-in user. | Allows an app to read all acronyms that the signed-in user can access. |
| AdminConsentRequired | Yes | No |

---
```

### graph-docs:concepts/use-the-api.md [chunk 0] -- 397 tok 
source=graph-docs trust=official content_type=A layer=current

```
# Use the Microsoft Graph API
## OData namespace

Microsoft Graph is a RESTful web API that enables you to access Microsoft Cloud service resources. After you [register your app](auth-register-app-v2.md) and [get authentication tokens for a user](auth-v2-user.md) or [service](auth-v2-service.md), you can make requests to the Microsoft Graph API.

> [!IMPORTANT]
> How conditional access policies apply to Microsoft Graph is changing. Applications need to be updated to handle scenarios where conditional access policies are configured. For more information and guidance, see [Developer guidance for Microsoft Entra Conditional Access](/azure/active-directory/develop/active-directory-conditional-access-developer).

The Microsoft Graph API defines most of its resources, methods, and enumerations in the OData namespace, `microsoft.graph`, in the [Microsoft Graph metadata](traverse-the-graph.md#microsoft-graph-api-metadata). A small number of API sets are defined in their sub-namespaces, such as the [call records API](/graph/api/resources/callrecords-api-overview) which defines resources like [callRecord](/graph/api/resources/callrecords-callrecord) in `microsoft.graph.callRecords`.

Unless explicitly specified in the corresponding topic, assume types, methods, and enumerations are part of the `microsoft.graph` namespace.
```

### graph-docs:concepts/use-the-api.md [chunk 1] -- 475 tok 
source=graph-docs trust=official content_type=A layer=current

```
# Use the Microsoft Graph API
## Call a REST API method

To read from or write to a resource such as a user or an email message, you construct a request that looks like the following:

<!-- {
  "blockType": "ignored"
}-->

```http
{HTTP method} https://graph.microsoft.com/{version}/{resource}?{query-parameters}
```

The components of a request include:

* [{HTTP method}](#http-methods) - The HTTP method used on the request to Microsoft Graph.
* [{version}](#version) - The version of the Microsoft Graph API your application is using.
* [{resource}](#resource) - The resource in Microsoft Graph that you're referencing. 
* [{query-parameters}](#query-parameters) - Optional OData query options or REST method parameters that customize the response.
* [{headers}](#headers) - Request headers that customize the request. Can be optional or required depending on the API.

After you make a request, a response is returned that includes:

* Status code - An HTTP status code that indicates success or failure. For details about HTTP error codes, see [Errors](errors.md).
* Response message - The data that you requested or the result of the operation. The response message can be empty for some operations.
* `@odata.nextLink` - If your request returns a lot of data, you need to page through it by using the URL returned in `@odata.nextLink`. For details, see [Paging](paging.md).
* Response headers - Additional information about the response, such as the type of content returned and the request-id that you can use to correlate the response to the request.
```

### graph-docs:concepts/use-the-api.md [chunk 2] -- 452 tok 
source=graph-docs trust=official content_type=A layer=current

```
# Use the Microsoft Graph API
## HTTP methods

Microsoft Graph uses the HTTP method on your request to determine what your request is doing. Depending on the resource, the API might support operations including actions, functions, or CRUD operations described below.

|**Method** |**Description**                             |
| :----- | :------------------------------------------- |
| GET    | Read data from a resource.                   |
| POST   | Create a new resource, or perform an action. |
| PATCH  | Update a resource with new values, or upsert a resource (create if resource doesn't exist, update otherwise). |
| PUT    | Replace a resource with a new one.           |
| DELETE | Remove a resource.                           |

* For the CRUD methods `GET` and `DELETE`, no request body is required.
* The `POST`, `PATCH`, and `PUT` methods require a request body, usually specified in JSON format, that contains additional information, such as the values for properties of the resource.

> [!IMPORTANT]
> Write requests in the Microsoft Graph API have a size limit of 4 MB. 
>
> In some cases, the actual write request size limit is lower than 4 MB. For example, attaching a file to a user event by `POST /me/events/{id}/attachments` has a request size limit of 3 MB, because a file around 3.5 MB can become larger than 4 MB when encoded in base64.
>
> Requests exceeding the size limit fail with the status code HTTP 413, and the error message "Request entity too large" or "Payload too large".
```

### graph-docs:concepts/aad-advanced-queries.md [chunk 0] -- 347 tok 
source=graph-docs trust=official content_type=A layer=current

```
# Advanced query capabilities on Microsoft Entra ID objects

Microsoft Graph supports advanced query capabilities on various Microsoft Entra ID objects, also called *directory objects*, to help you efficiently access data. Examples include the addition of **not** (`not`), **not equals** (`ne`), and **ends with** (`endsWith`) operators on the `$filter` query parameter.

The Microsoft Graph query engine uses an index store to fulfill query requests. To add support for extra query capabilities on some properties, those properties are indexed in a separate store. This separate indexing improves query performance. However, these advanced query capabilities aren't available by default. The requestor must set the **ConsistencyLevel** header to `eventual` *and*, except for `$search`, use the `$count` query parameter. The **ConsistencyLevel** header and `$count` are referred to as *advanced query parameters*.

For example, to retrieve only inactive user accounts, you can run either of these queries that use the `$filter` query parameter:

**Option 1:** Use the `$filter` query parameter with the `eq` operator. This request works by default and doesn't require the advanced query parameters.
```

### graph-docs:concepts/aad-advanced-queries.md [chunk 1] -- 345 tok 
source=graph-docs trust=official content_type=A layer=current

```
# [Java](#tab/java)

<!-- {
  "blockType": "request",
  "name": "aad_advanced_queries_get_users_accountenabled"
} -->

```msgraph-interactive
GET https://graph.microsoft.com/v1.0/users?$filter=accountEnabled eq false
```

[!INCLUDE [sample-code](../includes/snippets/csharp/v1/aad-advanced-queries-get-users-accountenabled-csharp-snippets.md)]
[!INCLUDE [sdk-documentation](../includes/snippets/snippets-sdk-documentation-link.md)]

[!INCLUDE [sample-code](../includes/snippets/go/v1/aad-advanced-queries-get-users-accountenabled-go-snippets.md)]
[!INCLUDE [sdk-documentation](../includes/snippets/snippets-sdk-documentation-link.md)]

[!INCLUDE [sample-code](../includes/snippets/java/v1/aad-advanced-queries-get-users-accountenabled-java-snippets.md)]
[!INCLUDE [sdk-documentation](../includes/snippets/snippets-sdk-documentation-link.md)]
```

### graph-docs:concepts/aad-advanced-queries.md [chunk 2] -- 274 tok 
source=graph-docs trust=official content_type=A layer=current

```
# [PowerShell](#tab/powershell)

[!INCLUDE [sample-code](../includes/snippets/javascript/v1/aad-advanced-queries-get-users-accountenabled-javascript-snippets.md)]
[!INCLUDE [sdk-documentation](../includes/snippets/snippets-sdk-documentation-link.md)]

[!INCLUDE [sample-code](../includes/snippets/php/v1/aad-advanced-queries-get-users-accountenabled-php-snippets.md)]
[!INCLUDE [sdk-documentation](../includes/snippets/snippets-sdk-documentation-link.md)]

[!INCLUDE [sample-code](../includes/snippets/powershell/v1/aad-advanced-queries-get-users-accountenabled-powershell-snippets.md)]
[!INCLUDE [sdk-documentation](../includes/snippets/snippets-sdk-documentation-link.md)]
```

### graph-docs:api-reference/v1.0/resources/user.md [chunk 0] -- 6896 tok `oversized_table`
source=graph-docs trust=official content_type=A layer=current

```
# user resource type
## Methods

Namespace: microsoft.graph

Represents a Microsoft Entra user account. This resource is an open type that allows additional properties beyond those documented here. Inherits from [directoryObject](directoryobject.md). Only [a subset of user properties are returned by default in v1.0](../resources/users.md#common-properties). To retrieve other properties, you must specify them in a `$select` query option.

This resource supports:

- Adding your own data to custom properties as [extensions](/graph/extensibility-overview).
- Subscribing to [change notifications](/graph/change-notifications-overview).
- Using [delta query](/graph/delta-query-overview) to track incremental additions, deletions, and updates, by providing a [delta](../api/user-delta.md) function.

| Method | Return Type | Description |
|:-|:-|:-|
| [List](../api/user-list.md) | [user](user.md) collection | Get a list of user objects. |
| [Create](../api/user-post-users.md) | [user](user.md) | Create a new user object. |
| [Get](../api/user-get.md) | [user](user.md) | Read properties and relationships of user object. |
| [Update](../api/user-update.md) | [user](user.md) | Update user object. |
| [Delete](../api/user-delete.md) | None | Delete user object. |
| [Get delta](../api/user-delta.md) | [user](user.md) collection | Get incremental changes for users. |
| [Change password](../api/user-changepassword.md) | None | Update your own password. |
| [Retry service provisioning](../api/user-retryserviceprovisioning.md) | None | Retry the user service provisioning. |
| [Revoke sign-in sessions](../api/user-revokesigninsessions.md) | None | Revokes all the user's refresh and session tokens issued to applications, by resetting the **signInSessionsValidFromDateTime** user property to the current date-time. It forces the user to sign in to those applications again. |
| [Export personal data](../api/user-exportpersonaldata.md) | None | Submits a data policy operation request, made by a company administrator to export an organizational user's data. |
| **App role assignments** |  |  |
| [List](../api/user-list-approleassignments.md) | [appRoleAssignment](approleassignment.md) collection | Get the apps and app roles assigned to this user. |
| [Add](../api/user-post-approleassignments.md) | [appRoleAssignment](approleassignment.md) | Assign an app role to this user. |
| [Remove]
```

### graph-docs:api-reference/v1.0/resources/user.md [chunk 1] -- 9980 tok `oversized_table`
source=graph-docs trust=official content_type=A layer=current

```
# user resource type
## Properties

> [!IMPORTANT]
> Specific usage of `$filter` and the `$search` query parameter is supported only when you use the **ConsistencyLevel** header set to `eventual` and `$count`. For more information, see [Advanced query capabilities on directory objects](/graph/aad-advanced-queries#user-properties).

| Property       | Type    |Description|
|:---------------|:--------|:----------|
|aboutMe|String|A freeform text entry field for the user to describe themselves. Requires `$select` to retrieve.|
|accountEnabled|Boolean| `true` if the account is enabled; otherwise, `false`. This property is required when a user is created. <br><br>Requires `$select` to retrieve. Supports `$filter` (`eq`, `ne`, `not`, and `in`).    |
|ageGroup|[ageGroup](#agegroup-values)|Sets the age group of the user. Allowed values: `null`, `Minor`, `NotAdult`, and `Adult`. For more information, see [legal age group property definitions](#legal-age-group-property-definitions). <br><br>Requires `$select` to retrieve. Supports `$filter` (`eq`, `ne`, `not`, and `in`).|
|assignedLicenses|[assignedLicense](assignedlicense.md) collection|The licenses that are assigned to the user, including inherited (group-based) licenses. This property doesn't differentiate between directly assigned and inherited licenses. Use the **licenseAssignmentStates** property to identify the directly assigned and inherited licenses. Not nullable. Requires `$select` to retrieve. Supports `$filter` (`eq`, `not`, `/$count eq 0`, `/$count ne 0`).           |
|assignedPlans|[assignedPlan](assignedplan.md) collection|The plans that are assigned to the user. Read-only. Not nullable. <br><br>Requires `$select` to retrieve. Supports `$filter` (`eq` and `not`). |
|birthday|DateTimeOffset|The birthday of the user. The Timestamp type represents date and time information using ISO 8601 format and is always in UTC. For example, midnight UTC on Jan 1, 2014, is `2014-01-01T00:00:00Z`. <br><br>Requires `$select` to retrieve.|
|businessPhones|String collection|The telephone numbers for the user. NOTE: Although it's a string collection, only one number can be set for this property. Read-only for users synced from the on-premises directory. <br><br>Returned by default. Supports `$filter` (`eq`, `not`, `ge`, `le`, `startsWith`).|
|city|String|The city where the user is located. Maximum length is 128 characters. 
```

### graph-docs:api-reference/v1.0/resources/user.md [chunk 2] -- 567 tok 
source=graph-docs trust=official content_type=A layer=current

```
# user resource type
## Properties
### mail and proxyAddresses properties

> [!TIP]
> Directory and schema extensions and their associated data require `$select` to retrieve; Open extensions and their associated data are returned only on `$expand`.

**mail** and **proxyAddresses** are both email-related properties. The **proxyAddresses** property is a collection of addresses only relevant to the Microsoft Exchange server. It's used to store a list of mail addresses for a user that are tied to a single mailbox. The **mail** property is used as the user's email address for various purposes including user sign-in and defines the primary proxy address.

Both **mail** and **proxyAddresses** can be retrieved through the [GET user](../api/user-get.md) API. You can update the **mail** via the [Update user](../api/user-update.md) API, but can't update **proxyAddresses** through Microsoft Graph. When a user's **mail** property is updated, it triggers recalculation of **proxyAddresses** and the newly updated mail is set to be the primary proxy address, except in the following scenarios:

1. If a user has a license that includes Microsoft Exchange, all their proxy addresses must belong to a verified domain on the tenant. Any that don't belong to verified domains are silently removed.
2. A user's mail is NOT set to the primary proxy address if the user is a guest and the primary proxy address contains the guest's UPN string with #EXT#.
3. A user's mail is NOT removed, even if they no longer have proxy addresses if the user is a guest.

**proxyAddresses** are unique across directory objects (users, groups, and organizational contacts). If a user's **mail** property conflicts with one of the **proxyAddresses** of another object, an attempt to update the **mail** fails, and the **proxyAddresses** property isn't updated either.
```

### entra-docs:docs/external-id/authentication-conditional-access.md [chunk 0] -- 367 tok 
source=entra-docs trust=official content_type=A layer=current

```
# Authentication and Conditional Access for External ID

[!INCLUDE [applies-to-workforce-only](./includes/applies-to-workforce-only.md)]

> [!TIP]
> This article applies to B2B collaboration and B2B direct connect in workforce tenants. For information about external tenants, see [Security and governance in Microsoft Entra External ID](customers/concept-security-customers.md).

When an external user accesses resources in your organization, the authentication flow is determined by the collaboration method (B2B collaboration or B2B direct connect), user's identity provider (for example, an external Microsoft Entra tenant or social identity provider), Conditional Access policies, and the [cross-tenant access settings](cross-tenant-access-overview.md) configured both in the user's home tenant and the tenant hosting resources.

This article describes the authentication flow for external users who are accessing resources in your organization. Organizations can enforce multiple Conditional Access policies for their external users, which can be enforced at the tenant, app, or individual user level in the same way that they're enabled for full-time employees and members of the organization.

<a name='authentication-flow-for-external-azure-ad-users'></a>
```

### entra-docs:docs/external-id/authentication-conditional-access.md [chunk 1] -- 733 tok 
source=entra-docs trust=official content_type=A layer=current

```
# Authentication and Conditional Access for External ID
## Authentication flow for external Microsoft Entra users

The following diagram illustrates the authentication flow when a Microsoft Entra organization shares resources with users from other Microsoft Entra organizations. This diagram shows how cross-tenant access settings work with Conditional Access policies, such as multifactor authentication, to determine if the user can access resources. This flow applies to both B2B collaboration and B2B direct connect, except as noted in step 6.

[![Diagram showing the cross-tenant authentication process.](media/authentication-conditional-access/cross-tenant-auth.png)](media/authentication-conditional-access/cross-tenant-auth.png#lightbox)

|Step  |Description  |
|---------|---------|
|**1**     | A user from Fabrikam (the user’s *home tenant*) initiates sign-in to a resource in Contoso (the *resource tenant*).        |
|**2**     | During sign-in, the Microsoft Entra security token service (STS) evaluates Contoso's Conditional Access policies. It also checks whether the Fabrikam user is allowed access by evaluating cross-tenant access settings (Fabrikam’s outbound settings and Contoso’s inbound settings).        |
|**3**     | Microsoft Entra ID checks Contoso’s inbound trust settings to see if Contoso trusts MFA and device claims (device compliance, Microsoft Entra hybrid joined status) from Fabrikam. If not, skip to step 6.         |
|**4**     | If Contoso trusts MFA and device claims from Fabrikam, Microsoft Entra ID checks the user’s authentication session for an indication that the user completed MFA. If Contoso trusts device information from Fabrikam, Microsoft Entra ID looks for a claim in the authentication session indicating the device state (compliant or Microsoft Entra hybrid joined).         |
|**5**     | If MFA is required but not completed, or if a device claim isn't provided, Microsoft Entra ID issues MFA and device challenges in the user's home tenant as needed. When MFA and device requirements are satisfied in Fabrikam, the user is allowed access to the resource in Contoso. If the checks can’t be satisfied, access is blocked.        |
|**6**     | When no trust settings are configured and MFA is required, B2B collaboration users are prompted for MFA. They need to satisfy MFA in the resource tenant. Access is blocked for B2B direct connect use
```

### entra-docs:docs/external-id/authentication-conditional-access.md [chunk 2] -- 669 tok 
source=entra-docs trust=official content_type=A layer=current

```
# Authentication and Conditional Access for External ID
## Authentication flow for non-Microsoft Entra ID external users
### Example 1: Authentication flow and token for a non-Microsoft Entra ID external user

For more information, see the [Conditional Access for external users](#conditional-access-for-external-users) section.

When a Microsoft Entra organization shares resources with external users with an identity provider other than Microsoft Entra ID, the authentication flow depends on whether the user is authenticating with an identity provider or with email one-time passcode authentication. In either case, the resource tenant identifies which authentication method to use, and then either redirects the user to their identity provider or issues a one-time passcode.

The following diagram illustrates the authentication flow when an external user signs in with an account from a non-Microsoft Entra ID identity provider, such as Google, Facebook, or a federated SAML/WS-Fed identity provider.

[![Diagram showing the Authentication flow for B2B guest users from an external directory.](media/authentication-conditional-access/authentication-flow-b2b-guests.png)](media/authentication-conditional-access/authentication-flow-b2b-guests.png#lightbox)

| Step | Description |
|--------------|-----------------------|
| **1** | The B2B guest user requests access to a resource. The resource redirects the user to its resource tenant,  a trusted IdP.|
| **2** | The resource tenant identifies the user as external and redirects the user to the B2B guest user’s IdP. The user performs primary authentication in the IdP. |
| **3** | Authorization policies are evaluated in the B2B guest user's IdP. If the user satisfies these policies, the B2B guest user's IdP issues a token to the user. The user is redirected back to the resource tenant with the token. The resource tenant validates the token and then evaluates the user against its Conditional Access policies. For example, the resource tenant could require the user to perform Microsoft Entra multifactor authentication. |
| **4** | Inbound cross-tenant access settings and Conditional Access policies are evaluated. If all policies are satisfied, the resource tenant issues its own token and redirects the user to its resource. |
```

### entra-docs:docs/architecture/protect-m365-from-on-premises-attacks.md [chunk 13] -- 657 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Protect Microsoft 365 from on-premises attacks
## Specific security recommendations
### Log management

Define a log storage and retention strategy, design, and implementation to facilitate a consistent tool set. For example, consider security information and event management (SIEM) systems like Microsoft Sentinel, common queries, and investigation and forensics playbooks.

- **Microsoft Entra logs**. Ingest generated logs and signals by consistently following best practices for settings such as diagnostics, log retention, and SIEM ingestion.

- Microsoft Entra ID provides Azure Monitor integration for [multiple identity logs](../identity/monitoring-health/concept-diagnostic-settings-logs-options.md). For more information, see [Microsoft Entra activity logs in Azure Monitor](../identity/monitoring-health/concept-log-monitoring-integration-options-considerations.md) and [Investigate risky users with Copilot](../security-copilot/entra-risky-user-summarization.md).

- **Hybrid infrastructure operating system security logs**. Archive and carefully monitor all hybrid identity infrastructure operating system logs as a tier-0 system because of the surface area implications. Include the following elements:

- Private network connectors for Microsoft Entra Private Access and Microsoft Entra Application Proxy.
  - Password writeback agents.
  - Password Protection Gateway machines.
  - Network policy servers (NPSs) that have the Microsoft Entra multifactor authentication RADIUS extension.
  - [Microsoft Entra Connect](../identity/hybrid/connect/whatis-azure-ad-connect.md).
  - You must deploy Microsoft Entra Connect Health to monitor identity synchronization.

For comprehensive guidance on this topic, check [Incident response playbooks](/security/operations/incident-response-playbooks) and [Investigate risky users with Copilot](../security-copilot/entra-risky-user-summarization.md)

## Next steps

- [Build resilience into identity and access management by using Microsoft Entra ID](resilience-overview.md)
- [Secure external access to resources](secure-external-access-resources.md)
- [Integrate all your apps with Microsoft Entra ID](../fundamentals/five-steps-to-full-application-integration.md)
```

### entra-docs:docs/external-id/customers/plan-your-migration-from-b2c-to-external-id.md [chunk 10] -- 605 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Plan your migration from Azure AD B2C to External ID
## HSC mode limitations

- Third-party fraud protection integration for web-hosted (browser-based) sign-in and sign-up flows isn't supported in HSC mode. Native authentication API flows can integrate with third-party fraud protection by using a web application firewall (WAF) in front of the native authentication endpoints. For implementation guidance, see [Integrate third-party bot protection with native authentication](tutorial-third-party-bot-protection-native-api-sign-up.md) and [Integrate third-party account takeover protection with native authentication](tutorial-third-party-account-take-over-protection-native-api.md).

**User experience and compliance**

- Age gating. Azure AD B2C tenants that use custom policies to derive or store age-based attributes (such as minor or major classification) need to plan for alternate approaches.

**Admin portal experience**

- Administrative configuration and management are currently performed programmatically using Microsoft Graph and automation.

For the authoritative capability comparison, see [Capability support by scale and deployment mode](reference-service-limits.md#capability-support-by-scale-and-deployment-mode).

## Related content

Microsoft works with services and integration partners who specialize in Azure AD B2C to Microsoft Entra External ID migrations. Partners can help with advisory, implementation, and engineering-led delivery across both the standard and HSC mode approaches. For a list of partners and how to engage them, see [Services and integration partners for External ID](services-integration-partners.md).

- [Microsoft Entra External ID overview](/entra/external-id/external-identities-overview)
- [Supported features in External ID](concept-supported-features-customers.md)
- [Planning your solution](concept-planning-your-solution.md)
- [Services and integration partners for External ID](services-integration-partners.md)
- [Service limits and restrictions](reference-service-limits.md)
```

### entra-docs:docs/fundamentals/concept-license-usage-insights.md [chunk 3] -- 369 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Microsoft Entra license usage insights
## Product usage insights
### Active and guest user differentiation

Each tab includes a feature usage report that shows your tenant's feature usage for the previous month. The report displays a bar chart that compares your usage against your entitlements for each metric, expressed as a percentage of total licenses.

The chart uses the following indicators:

- **Licenses Used** — The portion of entitlements consumed by active usage.
- **Licenses Not Used** — The remaining entitlements not consumed.
- **Usage Spike** — Usage that exceeds your entitled license count.

The **Monthly usage patterns** panel shows tenant feature usage over the previous six months. You can switch between **Active users** and **Guest users** views to see trends for each user type. The chart compares feature usage against your entitled license count over time, helping you identify usage trends and plan for future license needs.

The usage metrics differentiate between active users and guest users. This distinction helps you understand which portion of your license consumption comes from internal users versus external collaborators.

## Related content

- [Microsoft Entra licensing](licensing.md)
- [Group-based licensing in Microsoft Entra](concept-group-based-licensing.md)
- [Sign up for Microsoft Entra ID P1 or P2](get-started-premium.md)
```

### entra-docs:docs/global-secure-access/concept-remote-network-connectivity.md [chunk 6] -- 619 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Understand remote network connectivity
## Common remote network connectivity scenarios
### What is the bandwidth allocation for each tenant?

**Tenant one:**

- 1,000 Microsoft Entra ID P1 licenses
- Allocated: 1,000 licenses, 3,500 Mbps

**Tenant two:**

- 3,000 Microsoft Entra ID P1 licenses
- 3,000 Internet Access licenses
- Allocated: 6,000 licenses, 11,000 Mbps

**Tenant three:**

- 8,000 Microsoft Entra ID P1 licenses
- 6,000 Microsoft Entra Suite licenses
- Allocated: 14,000 licenses, 39,000 Mbps

**Tenant one:**

Total bandwidth: 3,500 Mbps

Allocation:

- Site A: 2 IPsec tunnels: 2 x 250 Mbps = 500 Mbps
- Site B: 2 IPsec tunnels: 2 x 250 Mbps = 500 Mbps
- Site C: 2 IPsec tunnels: 2 x 500 Mbps = 1,000 Mbps
- Site D: 2 IPsec tunnels: 2 x 750 Mbps = 1,500 Mbps

Remaining bandwidth: None

**Tenant two:**

Total bandwidth: 11,000 Mbps

Allocation:

- Site A: 2 IPsec tunnels: 2 x 250 Mbps = 500 Mbps
- Site B: 2 IPsec tunnels: 2 x 500 Mbps = 1,000 Mbps
- Site C: 2 IPsec tunnels: 2 x 750 Mbps = 1,500 Mbps
- Site D: 2 IPsec tunnels: 2 x 1,000 Mbps = 2,000 Mbps
- Site E: 2 IPsec tunnels: 2 x 1,000 Mbps = 2,000 Mbps

Remaining bandwidth: 4,000 Mbps

**Tenant three:**

Total bandwidth: 39,000 Mbps

Allocation:

- Site A: 2 IPsec tunnels: 2 x 250 Mbps = 500 Mbps
- Site B: 2 IPsec tunnels: 2 x 500 Mbps = 1,000 Mbps
- Site C: 2 IPsec tunnels: 2 x 750 Mbps = 1,500 Mbps
- Site D: 2 IPsec tunnels: 2 x 750 Mbps = 1,500 Mbps
- Site E: 2 IPsec tunnels: 2 x 1,000 Mbps = 2,000 Mbps
- Site F: 2 IPsec tunnels: 2 x 1,000 Mbps = 2,000 Mbps
- Site G: 2 IPsec tunnels: 2 x 1,000 Mbps = 2,000 Mbps

Remaining bandwidth: 28,500 Mbps

## Next steps

- [List all remote networks](how-to-list-remote-networks.md)
- [Manage remote networks](how-to-manage-remote-networks.md)
- [Best practices for Global Secure Access remote network resilience](remote-network-resilience.md)
```

### entra-docs:docs/global-secure-access/tutorial-private-access-connector-setup.md [chunk 3] -- 809 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Tutorial: Set up the Private Network Connector
## Key concepts
### Step 4: Create a new connector group

1. Return to **Global Secure Access** > **Connect** > **Connectors and sensors**.
1. Confirm your newly installed connector appears in the connector list.
1. Verify connector health/status shows as **Active**.
1. Open the connector details and confirm key metadata such as:
   - Machine Name
   - External IP
   - Version

> [!NOTE]
>
> Newly registered connectors typically become visible in the portal within a couple of minutes but can take up to 10 minutes. Refresh the page if the connector doesn't appear immediately.

1. In **Global Secure Access** > **Connect** > **Connectors and sensors**, select **New Connector Group**.
1. Enter a name such as `PA-Tutorial-Connectors`.
1. Open the **Connectors** menu and check the box for the connector you just installed.
1. Select the appropriate Country/Region.
1. Select **Save**.

> [!TIP]
>
> You've now moved your new connector out of the default group. Newly added connector servers are always initially added to the default group. For this reason, it's best practice to *not* use it for application traffic. Newly added servers would immediately start serving traffic requests but might not have line of sight to the resource.

> [!NOTE]
> 
> Private Network Connectors support multi-geo configuration which allows traffic to be routed using the Microsoft Entra SSE backend that is regionally closer to the application. If you do not specify a Country/Region for the connector group it will use the tenant default which could impact network performance. Note that Quick Access does not support multi-geo and is always routed to the same regional backend as the tenant.
>
> ![Diagram that illustrates how Multi-Geo support routes traffic with Microsoft Entra private network connectors.](media/tutorial-private-access-connector-setup/multi-geo-connector-routing.png)

## Next steps

In this exercise, you accomplished the following:

- **Validated your Private Access foundation** - You confirmed server/resource prerequisites.
- **Installed and registered a Private Network Connector** - You established the path for private app access without opening any inbound ports to your network.
- **Verified connector health in the Microsoft Entra admin center** - You confirmed the service can manage and monitor your connector.
- **Implemented
```

### entra-docs:docs/id-governance/entitlement-management-process.md [chunk 4] -- 1351 tok `oversized_table`
source=entra-docs trust=official content_type=A layer=current

```
# Request process and email notifications in entitlement management
## Email notifications
### Email notifications table

The following table provides more detail about each of these email notifications. To manage these emails, you can use rules. For example, in Outlook, you can create rules to move the emails to a folder if the subject contains words from this table. The words are based on the default language settings of the tenant where the user is requesting access.

| # | Email subject | When sent | Sent to |
| --- | --- | --- | --- |
| 1 | Action required: Approve or deny forwarded request by *[date]* | This email will be sent to Stage-1 alternate approvers (after the request has been escalated) to take action. | Stage-1 alternate approvers |
| 2 | Action required: Approve or deny request by *[date]* | This email is sent to the first approver, if escalation is disabled, to take action. | First approver |
| 3 | Reminder: Approve or deny the request by *[date]* for *[requestor]* | This reminder email is sent to the first approver, if escalation is disabled. The email asks them to take action if they haven't. | First approver |
| 4 | Approve or deny the request by *[time]* on *[date]* | This email is sent to the first approver (if escalation is enabled) to take action. | First approver |
| 5 | Action required reminder: Approve or deny the request by *[date]* for *[requestor]* | This reminder email is sent to the first approver, if escalation is enabled. The email asks them to take action if they haven't. | First approver |
| 6 | Request has expired for *[access_package]* | This email will be sent to the first approver and stage-1 alternate approvers after the request has expired. | First approver, stage-1 alternate approvers |
| 7 | Request approved for *[requestor]* to *[access_package]* | This email is sent to the first approver and stage-1 alternate approvers upon request completion. | First approver, stage-1 alternate approvers |
| 8 | Request approved for *[requestor]* to *[access_package]* | This email is sent to the first approver and stage-1 alternate approvers of a multi-stage request when the stage-1 request is approved. | First approver, stage-1 alternate approvers |
| 9 | Request denied to *[access_package]* | This email is sent to the requestor when their request is denied | Requestor |
| 10 | Your request has expired for *[access_package]* |
```

### entra-docs:docs/id-governance/privileged-identity-management/pim-how-to-activate-role.yml [chunk 0] -- 4499 tok `yml_unit`
source=entra-docs trust=official content_type=A layer=current

```
### YamlMime:HowTo
metadata:
  title: Activate Microsoft Entra roles in PIM
  description: Learn how to activate Microsoft Entra roles in Privileged Identity Management (PIM).
  ms.reviewer: ilyal
  ms.date: 04/23/2026
  ms.topic: how-to
  # Customer intent: As a user with eligible Microsoft Entra role assignments, I want to activate my roles when needed to perform administrative tasks.
  ms.custom:
    - ge-structured-content-pilot
    - sfi-ga-nochange
    - sfi-image-nochange
title: |
  Activate a Microsoft Entra role in PIM
introduction: |
  Microsoft Entra Privileged Identity Management (PIM) simplifies how enterprises manage privileged access to resources in Microsoft Entra ID and other Microsoft online services like Microsoft 365 or Microsoft Intune.

  If you have been made *eligible* for an administrative role, then you must *activate* the role assignment when you need to perform privileged actions. For example, if you occasionally manage Microsoft 365 features, your organization's Privileged Role Administrators might not make you a permanent Global Administrator, since that role impacts other services, too. Instead, they would make you eligible for Microsoft Entra roles such as Exchange Online Administrator. You can request to activate that role when you need its privileges, and then have administrator control for a predetermined time period.

  This article is for administrators who need to activate their Microsoft Entra role in Privileged Identity Management. Although any user can submit a request for the role they need through PIM without having the Privileged Role Administrator (PRA) role, this role is required for managing and assigning roles to others within the organization.

  >[!IMPORTANT]
  >When a role is activated, Microsoft Entra PIM temporarily adds active assignment for the role. Microsoft Entra PIM creates active assignment (assigns user to a role) within seconds. When deactivation (manual or through activation time expiration) happens, Microsoft Entra PIM removes the active assignment within seconds as well.
  >
  >Application may provide access based on the role the user has. In some situations, application access may not immediately reflect the fact that user got role assigned or removed. If application previously cached the fact that user does not have a role – when user tries to access application again, access may not be provi
```

### entra-docs:docs/identity-platform/custom-extension-onattributecollectionstart-retrieve-return-data.md [chunk 2] -- 793 tok `oversized_code_block`
source=entra-docs trust=official content_type=A layer=current

```
# Retrieve and return data from an OnAttributeCollectionStart event
## REST API schema
### Request to the external REST API

```json
{
  "type": "microsoft.graph.authenticationEvent.attributeCollectionStart",
  "source": "/tenants/aaaabbbb-0000-cccc-1111-dddd2222eeee/applications/<resourceAppguid>",
  "data": {
    "@odata.type": "microsoft.graph.onAttributeCollectionStartCalloutData",
    "tenantId": "aaaabbbb-0000-cccc-1111-dddd2222eeee",
    "authenticationEventListenerId": "00001111-aaaa-2222-bbbb-3333cccc4444",
    "customAuthenticationExtensionId": "11112222-bbbb-3333-cccc-4444dddd5555",
    "authenticationContext": {
        "correlationId": "<GUID>",
        "client": {
            "ip": "30.51.176.110",
            "locale": "en-us",
            "market": "en-us"
        },
        "protocol": "OAUTH2.0",
        "clientServicePrincipal": {
            "id": "<Your Test Applications servicePrincipal objectId>",
            "appId": "<Your Test Application App Id>",
            "appDisplayName": "My Test application",
            "displayName": "My Test application"
        },
        "resourceServicePrincipal": {
            "id": "<Your Test Applications servicePrincipal objectId>",
            "appId": "<Your Test Application App Id>",
            "appDisplayName": "My Test application",
            "displayName": "My Test application"
        }
    },
    "userSignUpInfo": {
      "attributes": {
        "givenName": {
          "@odata.type": "microsoft.graph.stringDirectoryAttributeValue",
          "value": "Larissa Price",
          "attributeType": "builtIn"
        },
        "companyName": {
          "@odata.type": "microsoft.graph.stringDirectoryAttributeValue",
          "value": "Contoso University",
          "attributeType": "builtIn"
        },
        "extension_<appid>_universityGroups": {
          "@odata.Type": "microsoft.graph.stringDirectoryAttributeValue",
          "value": "Alumni,Faculty",
          "attributeType": "directorySchemaExtension"
        },
        "extension_<appid>_graduationYear": {
          "@odata.type": "microsoft.graph.int64DirectoryAttributeValue",
          "value": 2010,
          "attributeType": "directorySchemaExtension"
        },
        "extension_<appid>_onMailingList": {
          "@odata.type": "microsoft.graph.booleanDirectoryAttributeValue",
          "value": false,
          "attribute
```

### entra-docs:docs/identity-platform/mobile-sso-support-overview.md [chunk 4] -- 569 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Support single sign-on and app protection policies in mobile apps you develop
## Enable App Protection Policies

To enable app protection policies, use the [Microsoft Authentication Library (MSAL)](msal-overview.md). MSAL is the Microsoft identity platform's authentication and authorization library and the Intune SDK is developed to work in tandem with it.

In addition, you must use a broker app for authentication. The broker requires the app to provide application and device information to ensure app compliance. iOS users will use the [Microsoft Authenticator app](https://support.microsoft.com/account-billing/sign-in-to-your-accounts-using-the-microsoft-authenticator-app-582bdc07-4566-4c97-a7aa-56058122714c) and Android users will use either the Microsoft Authenticator app or the [Company Portal app](https://play.google.com/store/apps/details?id=com.microsoft.windowsintune.companyportal) for [brokered authentication](./msal-android-single-sign-on.md). By default, MSAL uses a broker as its first choice for fulfilling an authentication request, so using the broker to authenticate will be enabled for your app automatically when using MSAL out-of-the-box.

Finally, [add the Intune SDK](/mem/intune/developer/app-sdk-get-started) to your app to enable app protection policies. The SDK for the most part follows an intercept model and will automatically apply app protection policies to determine if actions the app is taking are allowed or not. There are also APIs you can call manually to tell the app if there are restrictions on certain actions.

## Related content

- [Plan a Microsoft Entra single sign-on deployment](~/identity/enterprise-apps/plan-sso-deployment.md)
- [How to: Configure SSO on macOS and iOS](single-sign-on-macos-ios.md)
- [Get started with the Microsoft Intune App SDK](/mem/intune/developer/app-sdk-get-started)
```

### entra-docs:docs/identity-platform/tutorial-desktop-wpf-dotnet-sign-in-build-app.md [chunk 11] -- 490 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Tutorial: Authenticate users to your WPF desktop application
## Run the app

Run your app and sign in to test the application

1. In your terminal, navigate to the root folder of your WPF app and run the app by running the command `dotnet run` in your terminal.
1. After you launch the sample, you should see a window with a **Sign-In** button. Select the **Sign-In** button.

:::image type="content" source="../external-id/customers/media/tutorial-desktop-wpf-dotnet-sign-in-build-app/wpf-sign-in-screen.png" alt-text="Screenshot of sign-in screen for a WPF desktop application.":::

1. On the sign-in page, enter your account email address. If you don't have an account, select **No account? Create one**, which starts the sign-up flow. Follow through this flow to create a new account and sign in.
1. Once you sign in, you'll see a screen displaying successful sign-in and basic information about your user account stored in the retrieved token. The basic information is displayed in the *Token Info* section of the sign-in screen

## See also

- [Sign in users in a sample Electron desktop application by using Microsoft Entra External ID](../external-id/customers/how-to-desktop-app-electron-sample-sign-in.md)
- [Sign in users in a sample .NET MAUI desktop application by using Microsoft Entra External ID](../external-id/customers/how-to-desktop-app-maui-sample-sign-in.md)
- [Customize branding for your sign-in experience](../external-id/customers/how-to-customize-branding-customers.md)
```

### entra-docs:docs/identity/app-proxy/application-proxy-qlik.md [chunk 1] -- 452 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Microsoft Entra application proxy and Qlik Sense
## References

Follow the same steps as for Application #1, with the following exceptions:

**Step #5** (required fields): The Internal URL should now be the Qlik Sense URL with the authentication port used by the application. The default is **4244** for HTTPS, and **4248** for HTTP for Qlik Sense releases before April 2018. The default for Qlik Sense releases after April 2018 is **443** for HTTPS and **80** for HTTP. For example, `https//demo.qlik.com:4244`.

**Step #8** (single sign-on): Don't set up single sign-on. Leave the **single sign-on** option disabled.

Your application is now ready to test. Access the external URL you used to publish Qlik Sense in Application #1, and sign in as a user assigned to both applications.

For more information about publishing Qlik Sense with application proxy, see the following Qlik Community Articles: 
- [Microsoft Entra ID with integrated Windows authentication using a Kerberos Constrained Delegation with Qlik Sense](https://community.qlik.com/docs/DOC-20183)
- [Qlik Sense integration with Microsoft Entra application proxy](https://community.qlik.com/t5/Technology-Partners-Ecosystem/Azure-AD-Application-Proxy/ta-p/1528396)

## Next steps

- [Publish applications with application proxy](~/identity/app-proxy/application-proxy-add-on-premises-application.md)
- [Working with private network connectors](~/global-secure-access/concept-connector-groups.md)
```

### entra-docs:docs/identity/authentication/concept-password-ban-bad-combined-policy.md [chunk 2] -- 569 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Combined password policy and check for weak passwords in Microsoft Entra ID
## Password expiration policies

Password expiration policies are unchanged but they're included in this article for completeness. Those assigned at least the [User Administrator](../role-based-access-control/permissions-reference.md#user-administrator) role can use the [Microsoft Graph PowerShell cmdlets](/powershell/microsoftgraph/) to set user passwords not to expire.

> [!NOTE]
> By default, only passwords for user accounts that aren't synchronized through Microsoft Entra Connect can be configured to not expire. For more information about directory synchronization, see [Connect AD with Microsoft Entra ID](~/identity/hybrid/connect/how-to-connect-password-hash-synchronization.md#password-expiration-policy).

You can also use PowerShell to remove the never-expires configuration, or to see user passwords that are set to never expire.

The following expiration requirements apply to other providers that use Microsoft Entra ID for identity and directory services, such as Microsoft Intune and Microsoft 365.

| Property | Requirements |
| --- | --- |
| Password expiry duration (Maximum password age) |Default value: **90** days.<br>The value is configurable by using the [Update-MgDomain](/powershell/module/microsoft.graph.identity.directorymanagement/update-mgdomain) cmdlet from the Microsoft Graph PowerShell module. |
| Password expiry (Let passwords never expire) |Default value: **false** (indicates that password's have an expiration date).<br>The value can be configured for individual user accounts by using the [Update-MgUser](/powershell/module/microsoft.graph.users/update-mguser) cmdlet.|

## Next steps

- [Password policies and account restrictions in Microsoft Entra ID](concept-sspr-policy.md)
- [Eliminate bad passwords using Microsoft Entra Password Protection](concept-password-ban-bad.md)
```

### entra-docs:docs/identity/conditional-access/policy-all-users-approved-app-or-app-protection.md [chunk 3] -- 832 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Require approved client apps or app protection policy
## Block Exchange ActiveSync on all devices

[!INCLUDE [conditional-access-report-only-mode](../../includes/conditional-access-report-only-mode.md)]

> [!TIP]
> Organizations should also deploy a policy that [blocks access from unsupported or unknown device platforms](policy-all-users-device-unknown-unsupported.md) along with this policy.

This policy blocks all Exchange ActiveSync clients using basic authentication from connecting to Exchange Online.

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com) as at least a [Conditional Access Administrator](~/identity/role-based-access-control/permissions-reference.md#conditional-access-administrator).
1. Browse to **Entra ID** > **Conditional Access**.
1. Select **Create new policy**.
1. Give your policy a name. We recommend that organizations create a meaningful standard for the names of their policies.
1. Under **Assignments**, select **Users or workload identities**.
   1. Under **Include**, select **All users**.
   1. Under **Exclude**, select **Users and groups** and exclude at least one account to prevent yourself from being locked out. If you don't exclude any accounts, you can't create the policy.
   1. Select **Done**.
1. Under **Target resources** > **Resources (formerly cloud apps)** > **Include**, select **Select resources**.
   1. Select **Office 365 Exchange Online**.
   1. Select **Select**.
1. Under **Conditions** > **Client apps**, set **Configure** to **Yes**.
   1. Uncheck all options except **Exchange ActiveSync clients**.
   1. Select **Done**.
1. Under **Access controls** > **Grant**, select **Grant access**.
   1. Select **Require app protection policy**
1. Confirm your settings and set **Enable policy** to **Report-only**.
1. Select **Create** to enable your policy.

## Related content

[!INCLUDE [conditional-access-report-only-mode](../../includes/conditional-access-report-only-mode.md)]

[!INCLUDE [active-directory-policy-exclusions](~/includes/entra-policy-exclude-user.md)]

- [App protection policies overview](/mem/intune/apps/app-protection-policy)
- [Conditional Access common policies](concept-conditional-access-policy-common.md)
- [Migrate approved client app to application protection policy in Conditional Access](migrate-approved-client-app.md)
```

### entra-docs:docs/identity/devices/manage-device-identities.md [chunk 10] -- 777 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Manage device identities using the Microsoft Entra admin center
## Audit logs

- **Restrict non-admin users from recovering the BitLocker key(s) for their owned devices**: Admins can block self-service BitLocker key access to the registered owner of the device. Default users without the BitLocker read permission are unable to view or copy their BitLocker key(s) for their owned devices. You must be at least a [Privileged Role Administrator](../role-based-access-control/permissions-reference.md#privileged-role-administrator) to update this setting.

- **Enterprise State Roaming**: For information about this setting, see [the overview article](./enterprise-state-roaming-enable.md).

Device activities are visible in the activity logs. These logs include activities triggered by the device registration service and by users:

- Device creation and adding owners/users on the device
- Changes to device settings
- Device operations like deleting or updating a device
- Bulk operations like downloading all devices

[!INCLUDE [Bulk operations limitations](~/includes/bulk-operations-limitations.md)]

The entry point to the auditing data is **Audit logs** in the **Activity** section of the **Devices** page.

The audit log has a default list view that shows:

- The date and time of the occurrence.
- The targets.
- The initiator/actor of an activity.
- The activity.

:::image type="content" source="./media/manage-device-identities/63.png" alt-text="Screenshot that shows a table in the Activity section of the Devices page. The table shows the date, target, actor, and activity for four audit logs." border="false":::

You can customize the list view by selecting **Columns** in the toolbar:

:::image type="content" source="./media/manage-device-identities/64.png" alt-text="Screenshot that shows the toolbar of the Devices page." border="false":::

To reduce the reported data to a level that works for you, you can filter it by using these fields:

- **Category**
- **Activity Resource Type**
- **Activity**
- **Date Range**
- **Target**
- **Initiated By (Actor)**

You can also search for specific entries.

## Next steps

:::image type="content" source="./media/manage-device-identities/65.png" alt-text="Screenshot that shows audit data filtering controls." border="false":::

- [How to manage stale devices in Microsoft Entra ID](manage-stale-devices.md)
- [Troubleshoot pending devic
```

### entra-docs:docs/identity/enterprise-apps/grant-consent-single-user.md [chunk 2] -- 1004 tok `oversized_code_block`
source=entra-docs trust=official content_type=A layer=current

```
# Grant consent on behalf of a single user by using PowerShell
## Grant consent on behalf of a single user

```powershell
# The app for which consent is being granted.
$clientAppId = "de8bc8b5-d9f9-48b1-a8ad-b748da725064" # Your client application

# The API to which access will be granted. Your client application makes API 
# requests to the Microsoft Graph API, so we'll use that here.
$resourceAppId = "00000003-0000-0000-c000-000000000000" # Microsoft Graph API

# The permissions to grant. Here we're including "openid", "profile", "User.Read",
# and "offline_access" (for basic sign-in), as well as "User.ReadBasic.All" (for 
# reading other users' basic profile).
$permissions = @("openid", "profile", "offline_access", "User.Read", "User.ReadBasic.All")

# The user on behalf of whom access will be granted. The app will be able to access 
# the API on behalf of this user.
$userUpnOrId = "user@example.com"

# Step 0. Connect to Microsoft Graph PowerShell. We need User.ReadBasic.All to get
#    users' IDs, Application.ReadWrite.All to list and create service principals, 
#    DelegatedPermissionGrant.ReadWrite.All to create delegated permission grants, 
#    and AppRoleAssignment.ReadWrite.All to assign an app role.
#    WARNING: These are high-privilege permissions!
Connect-MgGraph -Scopes ("User.ReadBasic.All Application.ReadWrite.All " `
                        + "DelegatedPermissionGrant.ReadWrite.All " `
                        + "AppRoleAssignment.ReadWrite.All")

# Step 1. Check if a service principal exists for the client application. 
#     If one doesn't exist, create it.
$clientSp = Get-MgServicePrincipal -Filter "appId eq '$($clientAppId)'"
if (-not $clientSp) {
   $clientSp = New-MgServicePrincipal -AppId $clientAppId
}

# Step 2. Create a delegated permission that grants the client app access to the
#     API, on behalf of the user. (This example assumes that an existing delegated 
#     permission grant does not already exist, in which case it would be necessary 
#     to update the existing grant, rather than create a new one.)
$user = Get-MgUser -UserId $userUpnOrId
$resourceSp = Get-MgServicePrincipal -Filter "appId eq '$($resourceAppId)'"
$scopeToGrant = $permissions -join " "
$grant = New-MgOauth2PermissionGrant -ResourceId $resourceSp.Id `
                                     -Scope $scopeToGrant `
                                     -Clie
```

### entra-docs:docs/identity/hybrid/connect/how-to-connect-group-writeback-enable.md [chunk 4] -- 391 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Group writeback for Microsoft 365 groups
## Modify default behavior for Microsoft 365 groups
### Write back Microsoft 365 groups with up to 250,000 members

The following sections provide guidance on how to modify the default behavior for Microsoft 365 groups.

Because the default synchronization rule that limits the group size is created when group writeback is enabled, you must complete the following steps after you enable group writeback:

1. On your Microsoft Entra Connect server, open a PowerShell prompt as an administrator.
1. Disable the [Microsoft Entra Connect Sync scheduler](./how-to-connect-sync-feature-scheduler.md):

     ``` PowerShell 
     Set-ADSyncScheduler -SyncCycleEnabled $false 
     ``` 

1. Open the [Synchronization Rules Editor](./how-to-connect-create-custom-sync-rule.md).
1. Set the direction to **Outbound**.
1. Locate and disable the **Out to AD – Group Writeback Member Limit** synchronization rule.
1. Enable the Microsoft Entra Connect Sync scheduler:

     ``` PowerShell 
     Set-ADSyncScheduler -SyncCycleEnabled $true 
     ``` 

Disabling the synchronization rule sets the flag for full synchronization to `true` on the Microsoft Entra Connector. This change causes the rule changes to propagate through on the next sync cycle.

## Related content

- [Microsoft Entra Connect group writeback](how-to-connect-group-writeback-v2.md)
```

### entra-docs:docs/identity/hybrid/connect/howto-troubleshoot-upn-changes.md [chunk 10] -- 418 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Plan and troubleshoot UserPrincipalName changes in Microsoft Entra ID
## Teams Meeting Notes issues

When multiple users are registered on the same key, account selection appears where the previous UPN appears. UPN changes don't affect sign-in with security keys.

**Workaround**

To remove references to previous UPNs, users reset the security key and re-register.

You can [enable passwordless security key sign-in, known issue, UPN changes](~/identity/authentication/howto-authentication-passwordless-security-key.md#known-issues).

OneDrive users might experience issues after UPN changes.

Learn [how UPN changes affect the OneDrive URL and OneDrive features](/sharepoint/upn-changes).

Use Teams Meeting Notes to take and share notes.

**Known issues: Inaccessible notes**

When a user UPN changes, meeting notes created with the previous UPN aren't accessible with Microsoft Teams or the Meeting Notes URL.

**Workaround**

After the UPN change, users can download notes from OneDrive.

1. Go to **My Files**.
2. Select **Microsoft Teams Data**.
3. Select **Wiki**.

New meeting notes created after the UPN change aren't affected.

## Next steps

* [Microsoft Entra Connect: Design concepts](./plan-connect-design-concepts.md)
* [Microsoft Entra UserPrincipalName population](./plan-connect-userprincipalname.md)
* [Microsoft identity platform ID tokens](~/identity-platform/id-tokens.md)
```

### entra-docs:docs/identity/hybrid/verify-sync-tool-version.md [chunk 0] -- 411 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Verify your version of the provisioning agent or connect sync
## Verify connect sync
### Verify the connect sync version

This article describes the steps to verify the installed version of the provisioning agent and connect sync.

To see what version of the provisioning agent you're using, use the following steps:

[!INCLUDE [active-directory-cloud-sync-how-to-verify-installation](~/includes/entra-cloud-sync-how-to-verify-installation.md)]

To see what version of connect sync you're using, use the following steps:

To verify that the agent is running, follow these steps:

1. Sign in to the server with an administrator account.
 2. Open **Services** either by navigating to it or by going to *Start/Run/Services.msc*.
 3. Under **Services**, make sure that **Microsoft Entra ID Sync** is present and the status is **Running**.

To verify the version of the agent that is running, follow these steps:

1.  Navigate to 'C:\Program Files\Microsoft Azure AD Connect'
2.  Right-click on **AzureADConnect.exe** and select **properties**.
3.  Click the **details** tab and the version number ID next to the Product version.

## Next steps

- [Common scenarios](common-scenarios.md)
- [Choosing the right sync tool](common-scenarios.md)
- [Steps to start](get-started.md)
- [Prerequisites](prerequisites.md)
```

### entra-docs:docs/identity/monitoring-health/howto-investigate-internet-access-signals.md [chunk 3] -- 386 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Investigate the internet applications blocked by Entra Internet Access policy
## Investigate the signal

4.  Review Microsoft Entra Internet Access forwarding profile for access policies and user assignments. For more information, see [How to manage the Internet Access profile - Global Secure Access \| Microsoft Learn](/entra/global-secure-access/how-to-manage-internet-access-profile).

5.  Review sign-in logs. For more information, see [Learn about the sign-in log activity details](/entra/identity/monitoring-health/concept-sign-in-log-activity-details). Look for users being blocked from signing in and have a Use Global Secure Access security profile.

6.  Review traffic logs. For more information, see [Global Secure Access network traffic logs - Global Secure Access \| Microsoft Learn](/entra/global-secure-access/how-to-view-traffic-logs).

7.  Review audit logs. For more information, see [How to access Global Secure Access audit logs (preview) - Global Secure Access \| Microsoft Learn](/entra/global-secure-access/how-to-access-audit-logs).

## Related content

- [Troubleshoot application access - Global Secure Access \| Microsoft Learn](/entra/global-secure-access/troubleshoot-app-access)
```

### entra-docs:docs/identity/role-based-access-control/administrative-units.md [chunk 6] -- 494 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Administrative units in Microsoft Entra ID
## Currently supported scenarios
### Device management

| Permissions | Microsoft Graph/PowerShell | Microsoft Entra admin center | Microsoft 365 admin center |
| --- | :---: | :---: | :---: |
| Administrative unit-scoped creation and deletion of groups | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| Administrative unit-scoped management of group properties and membership for Microsoft 365 groups | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| Administrative unit-scoped management of group properties and membership for all other groups | :white_check_mark: | :white_check_mark: | :x: |
| Administrative unit-scoped management of group licensing | :white_check_mark: | :white_check_mark: | :x: |

| Permissions | Microsoft Graph/PowerShell | Microsoft Entra admin center | Microsoft 365 admin center |
| --- | :---: | :---: | :---: |
| Enable, disable, or delete devices | :white_check_mark: | :white_check_mark: | :x: |
| Read BitLocker recovery keys | :white_check_mark: | :white_check_mark: | :x: |

Managing devices in Intune is *not* supported at this time.

## Next steps

- [Create or delete administrative units](admin-units-manage.md)
- [Restricted management administrative units](admin-units-restricted-management.md)
- [Administrative unit limits](~/identity/users/directory-service-limits-restrictions.md?context=/azure/active-directory/roles/context/ugr-context)
```

### entra-docs:docs/identity/saas-apps/aqua-platform-tutorial.md [chunk 4] -- 522 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Configure Aqua Platform for Single sign-on with Microsoft Entra ID
## Test SSO

To configure single sign-on on **Aqua Platform** side, you need to send the downloaded **Federation Metadata XML** and appropriate copied URLs from the application configuration to [Aqua Platform support team](mailto:support@aquasec.com). They set this setting to have the SAML SSO connection set properly on both sides.

In this section, you create a user called Britta Simon in Aqua Platform. Work with [Aqua Platform support team](mailto:support@aquasec.com) to add the users in the Aqua Platform platform. Users must be created and activated before you use single sign-on.

In this section, you test your Microsoft Entra single sign-on configuration with following options.

* Select **Test this application**, this option redirects to Aqua Platform Sign-on URL where you can initiate the login flow.

* Go to Aqua Platform Sign-on URL directly and initiate the login flow from there.

* You can use Microsoft My Apps. When you select the Aqua Platform tile in the My Apps, this option redirects to Aqua Platform Sign-on URL. For more information, see [Microsoft Entra My Apps](/azure/active-directory/manage-apps/end-user-experiences#azure-ad-my-apps).

## Related content

* [What is single sign-on with Microsoft Entra ID?](~/identity/enterprise-apps/what-is-single-sign-on.md)
* [Plan a single sign-on deployment](~/identity/enterprise-apps/plan-sso-deployment.md).

Once you configure Aqua Platform you can enforce session control, which protects exfiltration and infiltration of your organization’s sensitive data in real time. Session control extends from Conditional Access. [Learn how to enforce session control with Microsoft Cloud App Security](/cloud-app-security/proxy-deployment-aad).
```

### entra-docs:docs/identity/saas-apps/bustle-b2b-transport-systems-provisioning-tutorial.md [chunk 4] -- 719 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Configure Bustle B2B Transport Systems for automatic user provisioning with Microsoft Entra ID
## Step 5: Configure automatic user provisioning to Bustle B2B Transport Systems
### To configure automatic user provisioning for Bustle B2B Transport Systems in Microsoft Entra ID:

1. Review the user attributes that are synchronized from Microsoft Entra ID to Bustle B2B Transport Systems in the **Attribute-Mapping** section. The attributes selected as **Matching** properties are used to match the user accounts in Bustle B2B Transport Systems for update operations. If you choose to change the [matching target attribute](~/identity/app-provisioning/customize-application-attributes.md), you need to ensure that the Bustle B2B Transport Systems API supports filtering users based on that attribute. Select the **Save** button to commit any changes.

   |Attribute|Type|Supported for filtering|Required by Bustle B2B Transport Systems|
   |---|---|---|---|
   |userName|String|&check;|&check;|
   |active|Boolean|||
   |emails[type eq "work"].value|String||&check;|
   |name.givenName|String||&check;|
   |name.familyName|String||&check;|
   |phoneNumbers[type eq "work"].value|String||&check;|
   |externalId|String||&check;|

1. To configure scoping filters, refer to the following instructions provided in the [Scoping filter article](~/identity/app-provisioning/define-conditional-rules-for-provisioning-user-accounts.md).

1. Use [on-demand provisioning](~/identity/app-provisioning/provision-on-demand.md) to validate sync with a small number of users before deploying more broadly in your organization.

1. When you're ready to provision, select **Start Provisioning** from the **Overview** page.

## Related content

[!INCLUDE [monitor-deployment.md](~/identity/saas-apps/includes/monitor-deployment.md)]

* [Managing user account provisioning for Enterprise Apps](~/identity/app-provisioning/configure-automatic-user-provisioning-portal.md)
* [What is application access and single sign-on with Microsoft Entra ID?](~/identity/enterprise-apps/what-is-single-sign-on.md)

* [Learn how to review logs and get reports on provisioning activity](~/identity/app-provisioning/check-status-user-account-provisioning.md)
```

### entra-docs:docs/identity/saas-apps/claromentis-tutorial.md [chunk 6] -- 400 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Configure Claromentis for Single sign-on with Microsoft Entra ID
## Test SSO

In this section, you test your Microsoft Entra single sign-on configuration with following options.

* Select **Test this application**, this option redirects to Claromentis Sign on URL where you can initiate the login flow.

* Go to Claromentis Sign-on URL directly and initiate the login flow from there.

* Select **Test this application**, and you should be automatically signed in to the Claromentis for which you set up the SSO.

You can also use Microsoft My Apps to test the application in any mode. When you select the Claromentis tile in the My Apps, if configured in SP mode you would be redirected to the application sign on page for initiating the login flow and if configured in IDP mode, you should be automatically signed in to the Claromentis for which you set up the SSO. For more information about the My Apps, see [Introduction to the My Apps](https://support.microsoft.com/account-billing/sign-in-and-start-apps-from-the-my-apps-portal-2f3b1bae-0e5a-4a86-a33e-876fbd2a4510).

## Related content

Once you configure Claromentis you can enforce session control, which protects exfiltration and infiltration of your organization’s sensitive data in real time. Session control extends from Conditional Access. [Learn how to enforce session control with Microsoft Defender for Cloud Apps](/cloud-app-security/proxy-deployment-aad).
```

### entra-docs:docs/identity/saas-apps/convi-base-tutorial.md [chunk 3] -- 563 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Configure Convi.BASE for Single sign-on with Microsoft Entra ID
## Test SSO

![Screenshot shows to copy configuration URLs.](common/copy-configuration-urls.png "Metadata")

[!INCLUDE [create-assign-users-sso.md](~/identity/saas-apps/includes/create-assign-users-sso.md)]

To configure single sign-on on **Convi.BASE** side, you need to send the downloaded **Federation Metadata XML** and appropriate copied URLs from Microsoft Entra admin center to [Convi.BASE support team](mailto:helpcenter@convibase.co.jp). They set this setting to have the SAML SSO connection set properly on both sides.

In this section, you create a user called B.Simon in Convi.BASE. Work with [Convi.BASE support team](mailto:helpcenter@convibase.co.jp) to add the users in the Convi.BASE platform. Users must be created and activated before you use single sign-on.

In this section, you test your Microsoft Entra single sign-on configuration with following options.

* Select **Test this application** in Microsoft Entra admin center. this option redirects to Convi.BASE Sign-on URL where you can initiate the login flow.

* Go to Convi.BASE Sign-on URL directly and initiate the login flow from there.

* You can use Microsoft My Apps. When you select the Convi.BASE tile in the My Apps, this option redirects to Convi.BASE Sign-on URL. For more information about the My Apps, see [Introduction to the My Apps](https://support.microsoft.com/account-billing/sign-in-and-start-apps-from-the-my-apps-portal-2f3b1bae-0e5a-4a86-a33e-876fbd2a4510).

## Related content

Once you configure Convi.BASE you can enforce session control, which protects exfiltration and infiltration of your organization's sensitive data in real time. Session control extends from Conditional Access. [Learn how to enforce session control with Microsoft Defender for Cloud Apps](/cloud-app-security/proxy-deployment-any-app).
```

### entra-docs:docs/identity/saas-apps/directory-services-protector-tutorial.md [chunk 5] -- 528 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Configure Directory Services Protector for Single sign-on with Microsoft Entra ID
## Test SSO

In this section, a user called Britta Simon is created in Directory Services Protector. Directory Services Protector supports just-in-time user provisioning, which is enabled by default. There's no action item for you in this section. If a user doesn't already exist in Directory Services Protector, a new one is created after authentication.

In this section, you test your Microsoft Entra single sign-on configuration with following options.

* Select **Test this application** in Microsoft Entra admin center. this option redirects to Directory Services Protector Sign on URL where you can initiate the login flow.

* Go to Directory Services Protector Sign on URL directly and initiate the login flow from there.

* Select **Test this application** in Microsoft Entra admin center and you should be automatically signed in to the Directory Services Protector for which you set up the SSO.

You can also use Microsoft My Apps to test the application in any mode. When you select the Directory Services Protector tile in the My Apps, if configured in SP mode you would be redirected to the application sign-on page for initiating the login flow and if configured in IDP mode, you should be automatically signed in to the Directory Services Protector for which you set up the SSO. For more information about the My Apps, see [Introduction to the My Apps](https://support.microsoft.com/account-billing/sign-in-and-start-apps-from-the-my-apps-portal-2f3b1bae-0e5a-4a86-a33e-876fbd2a4510).

## Related content

Once you configure Directory Services Protector you can enforce session control, which protects exfiltration and infiltration of your organization's sensitive data in real time. Session control extends from Conditional Access. [Learn how to enforce session control with Microsoft Defender for Cloud Apps](/cloud-app-security/proxy-deployment-any-app).
```

### entra-docs:docs/identity/saas-apps/elium-provisioning-tutorial.md [chunk 5] -- 559 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Configure Elium for automatic user provisioning with Microsoft Entra ID
## Configure automatic user provisioning to Elium

![Screenshot of Provisioning properties.](common/provisioning-properties.png)

1. Select **Attribute Mapping** in the left panel and select **users**.

1. Review the user attributes that are synchronized from Microsoft Entra ID to Elium in the **Attribute-Mapping** section. The attributes selected as **Matching** properties are used to match the user accounts in Elium for update operations. If you choose to change the [matching target attribute](~/identity/app-provisioning/customize-application-attributes.md), you need to ensure that the Elium API supports filtering users based on that attribute. Select the **Save** button to commit any changes.

![Attribute mappings between Microsoft Entra ID and Elium](media/Elium-provisioning-tutorial/userattribute.png)

1. To configure scoping filters, refer to the instructions provided in the [Scoping filter article](~/identity/app-provisioning/define-conditional-rules-for-provisioning-user-accounts.md).

1. Use [on-demand provisioning](~/identity/app-provisioning/provision-on-demand.md) to validate sync with a small number of users before deploying more broadly in your organization.

1. When you're ready to provision, select **Start Provisioning** from the **Overview** page.

## Related content

* [Managing user account provisioning for Enterprise Apps](~/identity/app-provisioning/configure-automatic-user-provisioning-portal.md).
* [What is application access and single sign-on with Microsoft Entra ID?](~/identity/enterprise-apps/what-is-single-sign-on.md)

* [Learn how to review logs and get reports on provisioning activity](~/identity/app-provisioning/check-status-user-account-provisioning.md)
```

### entra-docs:docs/identity/saas-apps/filecloud-tutorial.md [chunk 4] -- 428 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Configure FileCloud for Single sign-on with Microsoft Entra ID
## Test SSO

In this section, a user called Britta Simon is created in FileCloud. FileCloud supports just-in-time user provisioning, which is enabled by default. There's no action item for you in this section. If a user doesn't already exist in FileCloud, a new one is created after authentication.

>[!NOTE]
>If you need to create a user manually, you need to contact the [FileCloud Client support team](mailto:support@codelathe.com).

In this section, you test your Microsoft Entra single sign-on configuration with following options.

* Select **Test this application**, this option redirects to FileCloud Sign-on URL where you can initiate the login flow.

* Go to FileCloud Sign-on URL directly and initiate the login flow from there.

* You can use Microsoft My Apps. When you select the FileCloud tile in the My Apps, this option redirects to FileCloud Sign-on URL. For more information about the My Apps, see [Introduction to the My Apps](https://support.microsoft.com/account-billing/sign-in-and-start-apps-from-the-my-apps-portal-2f3b1bae-0e5a-4a86-a33e-876fbd2a4510).

## Related content

Once you configure FileCloud you can enforce session control, which protects exfiltration and infiltration of your organization’s sensitive data in real time. Session control extends from Conditional Access. [Learn how to enforce session control with Microsoft Defender for Cloud Apps](/cloud-app-security/proxy-deployment-aad).
```

### entra-docs:docs/identity/saas-apps/github-enterprise-server-provisioning-tutorial.md [chunk 5] -- 463 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Configure GitHub Enterprise Server for automatic user provisioning with Microsoft Entra ID
## Change log

|Attribute|Type|
    |---|---|
    |`displayName`|String|
    |`externalId`|String|
    |`members`|Reference|

1. To configure scoping filters, refer to the following instructions provided in the [Scoping filter article](~/identity/app-provisioning/define-conditional-rules-for-provisioning-user-accounts.md).

1. Use [on-demand provisioning](~/identity/app-provisioning/provision-on-demand.md) to validate sync with a small number of users before deploying more broadly in your organization.

1. When you're ready to provision, select **Start Provisioning** from the **Overview** page.

[!INCLUDE [monitor-deployment.md](~/identity/saas-apps/includes/monitor-deployment.md)]

* 02/18/2021 - Added support for Groups provisioning.
* 08/19/2025 - Updated links and mentions of "GitHub AE" to "GitHub Enterprise Server" to reflect the current product name.

## Related content

* [Managing user account provisioning for Enterprise Apps](~/identity/app-provisioning/configure-automatic-user-provisioning-portal.md)
* [What is application access and single sign-on with Microsoft Entra ID?](~/identity/enterprise-apps/what-is-single-sign-on.md)

* [Learn how to review logs and get reports on provisioning activity](~/identity/app-provisioning/check-status-user-account-provisioning.md)
```

### entra-docs:docs/identity/saas-apps/hiretual-tutorial.md [chunk 6] -- 456 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Configure hireEZ-SSO for Single sign-on with Microsoft Entra ID
## Test SSO

In this section, you create a user called Britta Simon in hireEZ-SSO. Work with [hireEZ-SSO support team](mailto:support@hiretual.com) to add the users in the hireEZ-SSO platform. Users must be created and activated before you use single sign-on.

In this section, you test your Microsoft Entra single sign-on configuration with following options.

* Select **Test this application**, this option redirects to hireEZ-SSO Sign-on URL where you can initiate the login flow.

* Go to hireEZ-SSO Sign-on URL directly and initiate the login flow from there.

* Select **Test this application**, and you should be automatically signed in to the hireEZ-SSO for which you set up the SSO.

You can also use Microsoft My Apps to test the application in any mode. When you select the hireEZ-SSO tile in the My Apps, if configured in SP mode you would be redirected to the application sign-on page for initiating the login flow and if configured in IDP mode, you should be automatically signed in to the hireEZ-SSO for which you set up the SSO. For more information, see [Microsoft Entra My Apps](/azure/active-directory/manage-apps/end-user-experiences#azure-ad-my-apps).

## Related content

Once you configure hireEZ-SSO you can enforce session control, which protects exfiltration and infiltration of your organization’s sensitive data in real time. Session control extends from Conditional Access. [Learn how to enforce session control with Microsoft Defender for Cloud Apps](/cloud-app-security/proxy-deployment-aad).
```

### entra-docs:docs/identity/saas-apps/jostle-provisioning-tutorial.md [chunk 5] -- 746 tok `merged_orphan`
source=entra-docs trust=official content_type=A layer=current

```
# Configure Jostle for automatic user provisioning with Microsoft Entra ID
## Step 5: Configure automatic user provisioning to Jostle
### To configure automatic user provisioning for Jostle in Microsoft Entra ID:

1. Review the user attributes that are synchronized from Microsoft Entra ID to Jostle in the **Attribute-Mapping** section. The attributes selected as **Matching** properties are used to match the user accounts in Jostle for update operations. If you choose to change the [matching target attribute](~/identity/app-provisioning/customize-application-attributes.md), you need to ensure that the Jostle API supports filtering users based on that attribute. Select the **Save** button to commit any changes.

   |Attribute|Type|Supported for filtering|
   |---|---|---|
   |userName|String|&check;|
   |active|Boolean||
   |name.givenName|String||
   |name.familyName|String||
   |emails[type eq "work"].value|String||
   |emails[type eq "personal"].value|String||
   |emails[type eq "alternate1"].value|String||
   |emails[type eq "alternate2"].value|String||
   |urn:ietf:params:scim:schemas:extension:jostle:2.0:User:alternateEmail1Label|String||
   |urn:ietf:params:scim:schemas:extension:jostle:2.0:User:alternateEmail2Label|String||

1. To configure scoping filters, refer to the instructions provided in the [Scoping filter article](~/identity/app-provisioning/define-conditional-rules-for-provisioning-user-accounts.md).

1. Use [on-demand provisioning](~/identity/app-provisioning/provision-on-demand.md) to validate sync with a small number of users before deploying more broadly in your organization.

1. When you're ready to provision, select **Start Provisioning** from the **Overview** page.

## Related content

[!INCLUDE [monitor-deployment.md](~/identity/saas-apps/includes/monitor-deployment.md)]

* [Managing user account provisioning for enterprise apps](~/identity/app-provisioning/configure-automatic-user-provisioning-portal.md)
* [What is application access and single sign-on with Microsoft Entra ID?](~/identity/enterprise-apps/what-is-single-sign-on.md)

* [Learn how to review logs and get reports on provisioning activity](~/identity/app-provisioning/check-status-user-account-provisioning.md)
```
