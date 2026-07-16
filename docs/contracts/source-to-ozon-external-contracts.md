# Source-to-Ozon Phase 1 External Contract

Status: Active design contract for Unit 0A
Last verified against repository: 2026-07-14

## Purpose

This document freezes the minimum product, external-service, trust, retention, and rollout contracts required to begin the 1688-to-Ozon Phase 1 workflow. It does not claim that the complete workflow is implemented.

The terms **MUST**, **MUST NOT**, **SHOULD**, and **UNKNOWN** are normative:

- **MUST / MUST NOT**: required before the affected Phase 1 boundary can be enabled.
- **SHOULD**: expected implementation unless measured evidence justifies a change.
- **UNKNOWN**: repository evidence is insufficient; the value or behavior must not be invented.

## Frozen Phase 1 Assumptions

| Area               | Phase 1 decision                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Product shape      | Extend the existing multi-tenant SS ERP. Do not reproduce the reference extension's client-heavy architecture.                                         |
| First source       | 1688 only for the first vertical closure. PDD and Taobao/Tmall network capture are not Phase 1 dependencies.                                           |
| First target       | Ozon shops owned by the authenticated ERP owner, using server-held Seller API credentials.                                                             |
| Pilot breadth      | One to three Ozon categories. The exact category IDs and names are **UNKNOWN** until fixtures and a test shop approve them.                            |
| Workflow authority | ERP database records, services, and workers are authoritative. Browser state and page messages are evidence or UI state, never durable workflow truth. |
| Pairing authority  | An owner or permitted administrator explicitly selects device scopes and shops. `listing:publish` is never granted by default.                         |
| Web publishing     | Owner-only in Phase 1. STAFF pairing/actor inheritance for privileged commands remains disabled until a separate role design is approved.              |
| Ozon writes        | Official Ozon Seller API writes remain server-side. Seller-page cookies and internal seller UI endpoints are supplemental evidence only.               |
| AI/media           | Provider, model, suite size, visible-text policy, image-to-image/edit/inpaint capability, and media input transport are deferred to Unit 0B.           |
| CDP                | Whether passive capture is sufficient and whether `chrome.debugger` is required for any marketplace is deferred to Unit 0B.                            |

Phase 1 may proceed without AI media or CDP decisions. Those later decisions MUST NOT be guessed or smuggled into the 1688-to-Ozon contract.

## Trust Boundaries

| Boundary                                      | Trusted input                                                                            | Allowed responsibility                                                       | Forbidden responsibility                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| MAIN-world page bridge / `window.postMessage` | Bounded, sanitized observations from the current supported page                          | Submit page evidence with source metadata and truncation diagnostics         | Carry a command grant, reusable credential, Ozon/provider secret, or invoke review/publish           |
| Content script                                | Validated sender/tab/origin plus bounded evidence                                        | Normalize and relay page evidence; render page-local UI                      | Decide tenant/shop authorization or construct an authoritative final Ozon payload                    |
| Extension-owned UI and service worker         | Explicit user action plus authenticated extension-device session                         | Request scoped command grants, launch allowed work, poll durable status      | Store reusable account/Ozon/provider credentials for the new workflow or bypass server authorization |
| ERP Web                                       | Authenticated owner session                                                              | Full review, correction, mapping governance, publish confirmation, recovery  | Depend on an open source page or trust client-supplied owner/shop identity                           |
| ERP API                                       | Live account, device-session, scope, shop ownership, workflow version, and rollout state | Validate evidence, own drafts, issue/consume grants, validate final payloads | Trust page claims as authorization or expose Seller/provider secrets                                 |
| ERP worker                                    | Durable job/workflow identifiers and server-loaded owner/shop state                      | Long-running preparation, Ozon submission, polling, reconciliation           | Treat queue payload identity or a previously checked feature flag as permanently valid               |
| Official Ozon API                             | Operation-specific documented Seller API response                                        | Product/catalog/import/price/stock operations                                | Supply ERP tenancy or workflow truth                                                                 |
| Seller page session                           | Explicitly labeled supplemental seller data                                              | Analytics, reverse lookup, logistics, or other permitted auxiliary reads     | Core product creation, authoritative catalog mapping, or final publish                               |

All tenant and shop decisions MUST be derived from authenticated server context and current database rows. `ownerUserId`, `shopId`, `platform`, device session, and scopes from a page or command payload are untrusted claims until resolved server-side.

## Capture and Data-Truth Contract

1. Missing, explicit zero, empty string, and `null` are distinct values. Unknown freight, stock, weight, and dimensions MUST remain unknown; they MUST NOT be normalized to zero or a convenient positive number.
2. Critical facts MUST eventually record evidence type (`network`, `main_world`, `script`, `dom`, `derived`, or `manual`), source path, confidence, and whether the value was estimated.
3. Collection and persistence limits MUST be reported as `totalCount`, `capturedCount`, `truncated`, and `reason`. UI preview limits are not persistence limits.
4. A source snapshot MUST retain its capture version, platform, source identity, captured timestamp, field evidence, completeness, and truncation ledger.
5. Category/type IDs used for publish MUST come from the current official catalog or a server-validated mapping. AI and browser clients may suggest evidence but MUST NOT invent authoritative IDs.
6. Provider/Ozon secrets, reusable account credentials, cookies, authorization headers, and unrelated raw response bodies MUST NOT enter snapshots, runtime messages, logs, or support bundles.

Observed legacy losses, including the `/api/collect/batch` item limit and SKU/image truncation, remain characterization failures. They are not compatibility behavior to preserve.

## Current Ozon External Operations

The repository currently maps operations to these Seller API paths. This is code-confirmed, not live-contract confirmation.

| Operation                   | Current endpoint                            | Phase 1 treatment                                                                                                |
| --------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Create/update product       | `/v3/product/import`                        | Authoritative create/update write after V2 draft validation                                                      |
| Poll import task            | `/v1/product/import/info`                   | Preserve task ID, per-item result, and errors for reconciliation                                                 |
| Follow existing SKU         | `/v1/product/import-by-sku`                 | Legacy/specialized operation; do not confuse with create/update                                                  |
| Update prices               | `/v1/product/import/prices`                 | Separate operation and validation contract                                                                       |
| Update stocks               | `/v2/products/stocks`                       | Separate operation and validation contract                                                                       |
| Product info                | `/v3/product/info/list`                     | Read/reconciliation                                                                                              |
| Stock info                  | `/v4/product/info/stocks`                   | Read/reconciliation                                                                                              |
| Product attributes          | `/v4/product/info/attributes`               | Read/reconciliation                                                                                              |
| Description category tree   | `/v1/description-category/tree`             | Catalog input; sandbox verification required                                                                     |
| Category attributes         | `/v1/description-category/attribute`        | Schema input; sandbox verification required                                                                      |
| Attribute dictionary values | `/v1/description-category/attribute/values` | Current client discards `has_next`; complete pagination is required before Phase 1 publish for a pilot attribute |

No live Ozon call was made while creating this contract. Every operation used by a pilot MUST pass a current test-shop contract test because Ozon versions operations independently.

### Submission outcome

- The exact submitted payload, shop, workflow/draft version, idempotency key, response task ID, and attempt timestamps MUST be persisted.
- A transport timeout or server failure after Ozon may have accepted a request MUST NOT be treated as definitely failed. It enters an explicit `UNKNOWN` reconciliation state.
- `UNKNOWN` is specified by the plan but is not present in the current `SyncJobStatus` enum. This is an implementation gap, not permission to resubmit blindly.
- A retry MUST reconcile by task ID, offer ID, or other operation-supported identity before creating another external write.

## Legacy Publish Paths and Failures to Remove

The following routes are legacy entry points, not the target unified publisher:

| Route / component                               | Current behavior                                                                                                | Required migration behavior                                                                                                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/listing/batch`                       | Builds and sends `/v3/product/import` directly                                                                  | Pilot shops MUST be blocked or routed through the validated V2 draft publisher                                                                                            |
| `POST /api/listing/ozon/import-by-sku`          | Sends `/v1/product/import-by-sku` directly                                                                      | Pilot shops MUST be blocked or routed through an explicitly compatible operation                                                                                          |
| `POST /api/listing/browser-one-click-jobs`      | Creates a legacy browser one-click publish job                                                                  | Block for V2 pilot shops before job creation                                                                                                                              |
| `PATCH /api/listing/browser-one-click-jobs/:id` | Can ingest bounded rows/evidence, reconcile an existing `taskId`, and enqueue or recover the legacy job         | Continue bounded evidence ingest and existing-task reconciliation, but block any ready/recovery transition that would enqueue or resume legacy publish for V2 pilot shops |
| `browser-one-click-listing` worker              | Creates temporary goods, watermarks, then calls the legacy collect publish route with an internal account token | Re-evaluate rollout before side effects and immediately before final submission                                                                                           |
| `POST /api/collect/publish-ozon`                | Contains both import-by-SKU and `/v3/product/import` builders                                                   | Remains the authoritative legacy choke point; pilot shops MUST fail closed here even if an internal/account token reaches it                                              |

The extension message `spb-self-hosted:publish-ozon-workbench-rows` and stored account-token fallback are legacy. Client-side hiding is UX only; server-side route and worker checks are authoritative.

### Fabricated values are defects, not defaults

| Observed legacy behavior                                                           | Repository evidence                                                               | Phase 1 rule                                                                                            |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------- |
| Missing listing stock becomes `0`                                                  | Listing schema and collect clone-prefill paths                                    | Unknown stock remains `null`/missing and blocks any operation that requires a known stock               |
| Missing weight becomes `500g`                                                      | Collect clone-prefill and publish dimension resolver                              | Remove; require evidence or explicit manual input                                                       |
| Missing dimensions become `100 x 100 x 100mm`                                      | Listing schema, collect clone-prefill, publish resolver, and attribute resolution | Remove; require evidence or explicit manual input                                                       |
| Missing manufacturer becomes random `manufacturer-*` with `dictionary_value_id: 0` | Collect publish attribute injection                                               | Remove; a required compliance/manufacturer field is a readiness blocker                                 |
| Missing `old_price` may become approximately `price * 1.2`                         | Legacy listing/publish builders                                                   | Treat as an explicit pricing rule only when approved and recorded; never present it as a collected fact |
| `value                                                                             |                                                                                   | fallback` treats explicit zero as missing                                                               | Multiple collect/publish paths | Replace with null-aware validation where zero is a valid observed value |

The reference extension's synthetic `999` stock and `500g / 300 x 200 x 100mm` packaging are also explicitly rejected. They are not SS ERP requirements.

## Extension Command Grant and Receipt Contract

### Operations and scopes

| Operation        | Required device scope | Shop binding                                                                                   |
| ---------------- | --------------------- | ---------------------------------------------------------------------------------------------- |
| `SOURCE_CAPTURE` | `capture:write`       | Optional when capture is not shop-specific                                                     |
| `LISTING_WRITE`  | `listing:write`       | Required when mutating a shop-bound workflow                                                   |
| `LISTING_REVIEW` | `listing:review`      | Required when review is shop-bound                                                             |
| `MEDIA_EXECUTE`  | `media:execute`       | Required when media belongs to a shop-bound workflow                                           |
| `OZON_PUBLISH`   | `listing:publish`     | Always required; shop must be active, Ozon, owner-held, and granted to the live device session |

The default pairing scope set remains logistics-only. New workflow scopes are owner-selected, and `listing:publish` MUST NOT be silently added.

### Grant binding and issuance

A grant is bound to all of the following:

- live device session ID and current token JTI;
- owner user ID;
- shop ID where applicable;
- operation;
- workflow ID and positive draft version together, or both absent;
- idempotency key;
- SHA-256 hash of the canonical JSON command envelope;
- issue and expiry timestamps.

Canonical JSON sorts object keys, preserves array order, and rejects sparse arrays, cycles, non-finite numbers, non-plain objects, and non-JSON values. Therefore object key order does not change a command, while array order does.

The current grant TTL is 60 seconds by default, with an allowed range of 1 second to 5 minutes. A device session may have at most 50 unconsumed, unrevoked, unexpired grants. The raw grant token is returned only to the caller; only its HMAC digest is persisted. Production uses a dedicated command-grant secret distinct from JWT secrets.

An exact issuance retry for the same session and idempotency key returns the same grant and deterministically derived token. Reusing that key with any changed binding or request hash returns a conflict.

### Atomic consumption

Grant consumption MUST run in a serializable database transaction with row locking and MUST revalidate:

- grant binding and token digest;
- live session status and expiry;
- current JTI;
- owner and actor account status;
- direct owner actor policy for this phase;
- current operation scope;
- current device-shop grant, shop ownership, platform, and shop status.

The first valid consume atomically marks the grant consumed and creates exactly one `PENDING` receipt. No Ozon or provider network call occurs inside this transaction.

An exact replay returns the existing receipt and MUST NOT execute the external side effect again. Binding mismatch, expiry, revocation, invalid session, missing scope, or invalid shop fails closed. A receipt means **durable command admission**, not successful Ozon/provider execution.

### Receipt completion and immutability

- `PENDING` may transition once to `SUCCEEDED` with a result or `FAILED` with a failure code and optional result.
- Repeating the exact completion is idempotent.
- A different second completion conflicts.
- Consumed grants, revoked grants, and completed receipts are immutable; database constraints and triggers enforce this independently of service code.
- Grants and receipts use restrictive foreign keys so deleting a session, owner, shop grant, grant, or receipt cannot silently erase audit history.

There is no generic public consume endpoint. The server-side handler for each privileged operation consumes the grant immediately before durable command admission and then owns receipt completion.

## Rollout and Fail-Closed Contract

`source_workflow_rollout_policy` and the corresponding SystemConfig master switch are read together from the database on every evaluation. This evaluator is stateless and MUST NOT use the process-local ten-second feature cache.

Relevant stable keys are:

- `feature_source_capture_v2`
- `feature_source_listing_workflow`
- `feature_source_ozon_publisher_v2`
- `feature_source_network_capture`
- `feature_ai_media_workflow_v2`
- `feature_source_listing_web_media`
- `feature_source_listing_extension_workbench`

Later operation-specific AI flags are introduced only by their owning implementation units.

| Master / policy result                                | V2 enabled | Legacy allowed | Required behavior                              |
| ----------------------------------------------------- | ---------: | -------------: | ---------------------------------------------- |
| Master missing or explicitly false                    |         No |            Yes | Default rollback state                         |
| Master malformed                                      |         No |             No | Configuration failure; block writes            |
| Config database unavailable                           |         No |             No | Fail closed across all API instances           |
| Master true, policy missing/malformed/unknown feature |         No |             No | Configuration failure; block writes            |
| Required server context missing/invalid               |         No |             No | Block; do not fall back to page/body context   |
| Policy `off`                                          |         No |            Yes | Explicit compatibility state                   |
| Pilot rule misses                                     |         No |            Yes | Legacy remains available outside the pilot     |
| Pilot rule matches                                    |        Yes |             No | V2 only for the matching context               |
| Policy `global`                                       |        Yes |             No | V2 only, still subject to normal authorization |

`SOURCE_CAPTURE_V2` is the only staged exception because capture migration needs a shadow period before V2 becomes authoritative:

| Matching capture rule stage | V2 write | Legacy write | Read authority                                                |
| --------------------------- | -------: | -----------: | ------------------------------------------------------------- |
| `shadow_write`              |      Yes |          Yes | Legacy; compare the immutable V2 snapshot out of band         |
| `dual_read`                 |      Yes |          Yes | V2 first, explicit legacy fallback with incomplete provenance |
| `v2_only` or omitted        |      Yes |           No | V2 only                                                       |

Outside a matching pilot, or while the capture master/rule is explicitly off, the effective capture stage is `off` and legacy remains available. Malformed policy, unavailable configuration, or invalid trusted context still disables both paths. A capture `stage` on any other feature is invalid.

`SOURCE_LISTING_WORKFLOW` has an independent `listingStage` with the same values. `shadow_write` persists the server draft while legacy records remain authoritative; `dual_read` resumes the server draft first and permits an explicit legacy fallback; `v2_only` makes the server draft authoritative. Outside a matching pilot its effective stage is `off`. A `listingStage` on any other feature, or a capture `stage` on the listing workflow, is invalid.

Policy modes are strict: `off` accepts no extra fields; `global` accepts only the owning feature's `stage` or `listingStage`; `pilot` requires at least one allowlist dimension. Publisher, mapping, and listing-workflow pilots require a shop allowlist and may not be device-only. Every configured pilot dimension must match server-derived context.

For `SOURCE_OZON_PUBLISHER_V2`, valid context requires a non-empty owner, shop, and database-derived `OZON` platform. Routes and workers MUST check `legacyAllowed`, not only `enabled`, because malformed or unavailable configuration disables both paths.

MAIN-world data and runtime-message payloads cannot enable a feature. Extension flags may be returned only through an authenticated ERP runtime response.

## Retention Contract

### Existing configuration baseline

| Data                                | SystemConfig default | Schema lower bound | Current enforcement                                                                        |
| ----------------------------------- | -------------------: | -----------------: | ------------------------------------------------------------------------------------------ |
| Collected records archive age       |             365 days |            30 days | Configuration metadata says archive/statistics only; no worker currently consumes this key |
| Minimum collected records per owner |                  200 |                  0 | Not currently consumed by a cleanup/archive worker                                         |
| Successful `SyncJob`                |              30 days |              1 day | Daily cleanup deletes when global retention dry-run is false                               |
| Failed `SyncJob`                    |             180 days |              1 day | Daily cleanup deletes when global retention dry-run is false                               |
| Local temporary images              |              30 days |              1 day | Daily cleanup deletes when global retention dry-run is false                               |
| OSS raw images                      |              15 days |              1 day | Cleanup disabled by default and separately dry-run by default                              |
| OSS watermarked images              |              60 days |              1 day | Cleanup disabled by default and separately dry-run by default                              |
| OSS temporary images                |               7 days |              1 day | Cleanup disabled by default and separately dry-run by default                              |

The general retention worker defaults to dry-run. The OSS cleanup worker defaults to disabled and dry-run. These safety defaults are operational facts, not substitutes for workflow-aware retention.

### Phase 1 minimums

1. A versioned raw source snapshot MUST NOT be deleted before 365 days, and archival MUST retain at least the latest 200 collected records per owner. These values adopt the existing collect-retention defaults as the initial Phase 1 floor.
2. The exact submitted Ozon payload, task ID, and successful attempt audit MUST be retained for at least 30 days.
3. Failed attempts and their exact payload/error evidence MUST be retained for at least 180 days.
4. `UNKNOWN`, pending, or otherwise unreconciled attempts MUST NOT be deleted until reconciliation reaches a terminal state and the applicable terminal retention period then elapses.
5. Grants and receipts MUST remain while their workflow/publish attempt is retained. A longer independent command-audit duration is **UNKNOWN** and requires an explicit retention decision before cleanup is added.
6. Snapshot JSON retention is independent of image-object retention. Current 15-day OSS raw-image retention does not prove a 365-day reproducible media snapshot. Long-term media retention remains deferred to Unit 0B/storage-cost review.
7. Cleanup MUST preserve referenced originals, immutable audit links, and reviewed derivatives. No cleanup may infer that a database reference is disposable from object age alone.

Current gaps: collect archive/minimum-keep settings are not implemented, `SyncJob` has no `UNKNOWN` state, and command grants/receipts have no cleanup policy. Phase 1 rollout MUST keep destructive cleanup off for these new records until those gaps are closed.

## Explicit Unit 0B Deferrals

The following are intentionally unresolved here:

- exact PDD/Taobao/Tmall response signatures and sanitized fixtures;
- whether passive MAIN-world fetch/XHR evidence is sufficient per marketplace page variant;
- whether CDP is needed, and Chrome Web Store versus controlled-enterprise distribution;
- AI generation/edit/translation Provider and exact model versions;
- multi-reference, mask, size, Prompt, cancellation, polling, and result-form limits;
- provider input transport: multipart bytes, staged upload, or signed public GET URL;
- signed-URL lifetime and maximum provider fetch/poll duration;
- default generated suite size and visible Russian/Chinese text policy;
- identity consistency, Cyrillic readability, and Chinese-residue thresholds;
- actual provider cost, quota reservation, and commercial charging;
- long-term media/object retention beyond the Phase 1 database audit contract.

No Phase 1 implementation may encode assumptions for these items. Unit 0B closes marketplace and media sub-gates independently.

## Open Evidence Required Before Pilot

- Select and record the one to three pilot Ozon categories and test-shop IDs.
- Capture sanitized real 1688 fixtures, including a product with more than 100 SKUs, and record every truncation boundary.
- Verify null versus zero through page bridge, service worker, `/api/collect/batch`, Prisma metadata, and source profile.
- Run current Ozon endpoint contracts against a sandbox/test shop and preserve request/response fixtures without credentials.
- Add an explicit `UNKNOWN` publish-attempt reconciliation state.
- Implement or explicitly exempt raw-snapshot archive/minimum-keep enforcement.
- Decide command grant/receipt audit retention before any cleanup job targets those tables.
- Measure snapshot size before choosing compression, chunking, or payload limits.

## Repository Evidence

- Approved plan: `docs/plans/2026-07-13-001-feat-source-to-ozon-ai-workflow-plan.md`
- Ozon operations: `apps/server/src/services/ozon-client.ts`
- Legacy listing routes: `apps/server/src/routes/listing.ts`
- Legacy collect/publish routes: `apps/server/src/routes/collect.ts`
- One-click worker: `apps/server/src/workers/browser-one-click-listing.ts`
- Device sessions/scopes: `apps/server/src/services/extension-device-session.ts`
- Command contract: `apps/server/src/services/extension-command-grants.ts`
- Command persistence: `apps/server/src/services/extension-command-grants-prisma.ts`
- Command constraints/triggers: `apps/server/prisma/migrations/20260714190000_add_extension_command_grants/migration.sql`
- Rollout evaluator: `apps/server/src/services/source-workflow-feature-flags.ts`
- Retention defaults: `apps/server/src/config/system-config-schema.ts`
- Database cleanup: `apps/server/src/workers/data-retention-cleanup.ts`
- Object cleanup: `apps/server/src/workers/oss-cleanup.ts`
