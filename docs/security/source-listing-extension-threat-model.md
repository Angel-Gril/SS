# Source Listing Extension Threat Model

Status: Unit 0A baseline, 2026-07-14

## Scope

This document defines the trust boundary for the source-marketplace to Ozon
workflow. It covers page collection, the isolated content-script bridge,
extension-owned UI and service worker code, paired device sessions, command
authorization, ERP workers, and the final Ozon write. It does not make a source
page, an installed extension, or a browser account token an authority for an
ERP mutation.

The first rollout is 1688-first and shop-scoped. Advanced media providers,
optional CDP capture, and broad marketplace rollout remain separate gates.

## Assets

- Tenant-owned source snapshots, listing drafts, media assets, and publish
  attempts.
- Ozon shop identifiers, Client-Id and Api-Key credentials.
- AI provider credentials and quota/cost records.
- Extension device access and refresh credentials.
- Short-lived `ExtensionCommandGrant` tokens and durable
  `ExtensionCommandReceipt` records.
- Actor, workflow version, idempotency, request hash, and audit history.

## Trust Zones

### 1. Marketplace MAIN world

The MAIN world and every value read from `window`, DOM, fetch/XHR responses, or
`window.postMessage` are attacker-controlled evidence. Page code can be changed
by the marketplace, another extension, an injected script, or an XSS payload.

MAIN-world code may only return operation-bounded evidence: page state,
allowlisted network observations, company identifiers, and logistics lookup
results. The operation set and accepted endpoints/headers are allowlisted. The
page realm cannot call `chrome.runtime`, issue a command grant, confirm a
listing, execute media work, or publish to Ozon.

### 2. Isolated content scripts

Content scripts translate page evidence into extension messages. They are a
sanitization and transport boundary, not an authorization boundary. A valid
content script sender still represents its current tab origin. Runtime policy
must validate the extension ID, sender URL, tab URL, origin, scheme, host, and
message type before dispatch.

Command-grant tokens, grant IDs, nonces, reusable credentials, and confirm or
publish intents are not recognized fields in page relay messages. Unknown
message types fail closed. Unit 1 still must replace permissive legacy evidence
objects with a generated strict capture validator; absence of a named field in
today's relay code is not a general-purpose JSON sanitizer.

### 3. Extension-owned UI and service worker

Popup, settings, and future extension workbench surfaces may originate an
explicit user command. They may hold a paired device credential, but they are
not the final authority. The service worker must validate the local sender and
operation allowlist before calling ERP APIs.

The legacy `spb-self-hosted:publish-ozon-workbench-rows` type is a documented
legacy exception for source/Ozon page senders until their replacement ships.
Runtime policy cannot derive authenticated owner/shop rollout context, so it
cannot disable that type conditionally. The ERP route, deferred-job transition,
worker, and final submit endpoint independently reject the legacy account-token
publish path for matching pilot shops. Flag-off users retain compatibility.

### 4. ERP API and database

ERP is the authorization authority. It resolves owner, actor, role, live device
session, JTI, scopes, shop ownership, shop status, platform, feature policy,
workflow ID, and draft version from authenticated server data. Page or extension
payloads cannot override those values.

### 5. ERP workers and external services

Workers consume durable jobs and receipts. AI and Ozon credentials remain on
the server. Provider and Ozon calls happen after authorization and outside the
grant-consumption transaction. Reconciliation of an already accepted Ozon
task remains available even when new legacy submissions are disabled.

## Security Invariants

1. New workflow page messages are evidence-only. They never carry an
   `ExtensionCommandGrant`, command token, nonce, reusable account credential,
   AI key, or Ozon key. The known legacy publish message is a temporary
   migration exception and receives no command grant.
2. `listing:publish` is never a default device scope. It requires explicit
   owner or administrator selection; STAFF cannot create or elevate a paired
   session.
3. Device access checks use both signed token claims and current database state:
   session status, expiry, JTI, owner, actor, role, scopes, and shop grants.
4. A command grant is bound to session, token JTI, owner, optional shop,
   operation, workflow/draft version, idempotency key, canonical request hash,
   and expiry.
5. Grant consumption and creation of one pending `ExtensionCommandReceipt` are
   atomic. Exact replay returns the same receipt. Changed-payload replay,
   expiry, revocation, scope loss, shop transfer, or account change fails
   closed.
6. Receipt creation means durable command admission, not successful provider or
   Ozon execution. Completion is immutable and records success, failure, or an
   explicit reconciliation result.
7. No generic public grant-consume endpoint exists. Each concrete server
   operation consumes its grant at its own boundary.
8. MAIN-world evidence cannot enable a feature flag or select a rollout tenant,
   shop, device, or platform.

## Message Contract

| Origin | Allowed purpose | Prohibited purpose |
| --- | --- | --- |
| MAIN world | Read page state; emit allowlisted, redacted network evidence; return logistics evidence | Runtime API access, command grant, confirm, media execution, Ozon publish |
| Marketplace content script | Normalize and submit allowlisted evidence types; relay the known legacy publish exception while its server flag permits it | New workflow grant/confirm/publish, owner/shop authority, reusable account token |
| ERP page content bridge | Existing read/collection bridge operations allowed by runtime policy | Command grant, listing confirm, Ozon publish |
| Extension-owned UI | Explicit command intent after user action | Self-assigning scope/shop/owner or bypassing ERP authorization |
| Service worker | Device-authenticated API request and local orchestration | Provider/Ozon secret storage, treating page data as authorization |

Network evidence must use supported endpoint keywords, reject authentication and
session endpoints, redact query values, and retain only safe headers. Named page
globals can still be large; they are consumed locally as tainted collection
input and must be subject to the capture envelope size/truncation ledger before
Unit 1 persistence. They are never command authority.

## Threats And Controls

| Threat | Control | Failure behavior |
| --- | --- | --- |
| Forged `window.postMessage` | Exact direction/type checks; page channels contain no command fields | Ignore message |
| Source page invokes legacy publish | Four server-side checks use authenticated owner/shop/platform rollout context | Reject before job create, enqueue, worker side effects, or Ozon submit |
| Sender URL or tab origin spoof | Extension ID plus URL/origin/tab authority checks | Reject sender |
| Unknown future command type | Central known-type allowlist | Reject by default |
| Grant theft or replay | Short TTL, HMAC digest at rest, exact binding, idempotency and one receipt | 401/403/409/410; no second execution |
| STAFF or stale session elevation | Live actor role, parent, owner, JTI and scope checks | Revoke or deny |
| Cross-tenant confused deputy | Server-derived owner/shop context and restrictive foreign keys | Hide or deny resource |
| Legacy account-token bypass | Contextual publisher flag at route, queue, worker and final submit boundaries | Reject new submit; keep reconciliation |
| Provider or Ozon secret leakage | Server-only encrypted credentials; static extension scans | Build/test failure and credential rotation |
| Command token written to storage/logs | Command token remains in memory for one short operation; scans forbid persistence/logging | Build/test failure and grant revocation |
| Oversized or malformed evidence | Endpoint/header allowlists, structured parsing, server body limits, future truncation ledger | Reject or record explicit truncation |

## Secret Handling

- AI keys, Ozon Client-Id/Api-Key, encrypted shop credentials, and reusable
  account bearer tokens never enter new workflow messages, extension storage,
  logs, screenshots, or support bundles.
- A device refresh credential is not an account token. It remains extension
  local, is rotated on every refresh, and reuse revokes its family.
- A command-grant token is short-lived and single-use. Only its digest is
  persisted. It must not be logged or stored in `chrome.storage`.
- Browser evidence containing authorization, cookie, token, login, session, or
  profile endpoints is rejected or redacted before forwarding.

## Rollout And Reconciliation

The publisher V2 feature is evaluated from authenticated owner, shop, platform,
and optional device context. Master-off and policy-off states retain legacy
behavior. A pilot match, global rollout, or invalid enabled write policy denies
legacy submission. Invalid policy fails closed.

Disabling new submissions must not disable task listing, receipt replay, Ozon
import-status polling, accepted-but-unrecorded recovery, or audit history. A job
with an existing Ozon task ID follows reconciliation; a queued legacy job with
no task ID is stopped before any new provider/Ozon call.

## Incident Response

1. Disable the affected contextual feature and legacy publish entry point.
2. Revoke the device session or scope and all unconsumed grants.
3. Rotate a reused device refresh family; rotate provider/Ozon credentials if
   exposure is suspected.
4. Preserve command receipts, publish attempts, request hashes, actor IDs, and
   policy revision for investigation.
5. Reconcile every Ozon task ID before retrying. Never blindly resubmit an
   unknown outcome.
6. Add the exploit payload and sender context to the security contract test
   before reopening rollout.

## Verification

Run:

```powershell
node --test scripts/extension-source-workflow-security.test.mjs
```

The contract verifies page-sender denial for new command-grant, confirm, media,
and publish types; characterizes the known legacy exception and checks all four
server pilot gates; verifies MAIN-world evidence-only surfaces and absence of
grant fields in page relays; scans for new provider/Ozon/reusable account
credentials and command-token storage/logging; and checks the required
threat-model controls.
