# Dual-Mode Extension AI Image Workflow: Task Breakdown

## Delivery Contract

The extension will expose one original SS ERP image workbench with two immutable execution
modes:

- `ERP_HOSTED`: ERP validates the plan and quote, reserves cost, runs the Provider job,
  stores candidates, requires ERP review, applies approved media to the draft, and publishes
  through the existing Ozon publisher.
- `BYOK`: the extension background calls the user's approved AI Provider with a session-only
  key. The user reviews results in the extension, then ERP normalizes and stores the selected
  bytes, binds them to the current draft, and publishes through the existing Ozon publisher.

BYOK bypasses only ERP AI generation charges. It does not bypass device/shop authorization,
storage limits, draft version checks, command grants, publish receipts, or reconciliation.
The extension never stores Ozon credentials and never calls the Ozon Seller API directly.

The UI is a clean-room SS ERP implementation of useful workflow concepts from the reference
extension. Reference source, markup, CSS, assets, branding, copy, identifiers, telemetry, and
unsafe defaults are not copied.

## Effort Scale

- `S`: less than one engineering day.
- `M`: two to three engineering days.
- `L`: four to six engineering days.
- `XL`: seven to ten engineering days.

The values are relative planning units, not delivery promises.

## Phase 0: Contract and Regression Baseline

### Parallel lanes

- Lane A, contracts: `FND-01`, then `FND-03`.
- Lane B, characterization tests: `FND-02`.
- Merge risk: low. Lane A adds focused contracts; Lane B primarily adds tests.

| ID | Task | Priority | Effort | Dependencies | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| FND-01 | Freeze the versioned dual-mode workbench, readiness, Provider, ingest, slot, and publish contracts | P0 | M | None | `ERP_HOSTED` and `BYOK` are closed values; a dispatched task cannot switch mode; hosted and BYOK commands/routes are distinct; public schemas contain no API-key field; global and per-slot state transitions are deterministic and reject unknown values |
| FND-02 | Characterize the current hosted and publish behavior | P0 | M | None | Tests protect hosted quote/maximum-cost confirmation, execute, candidate review, draft apply, stale-draft rejection, `OZON_PUBLISH` idempotency, receipt recovery, and cost reservation/settlement |
| FND-03 | Define shared resource limits and error semantics | P0 | S | FND-01 | Image count, request bytes, result bytes, pixels, dimensions, reference count, Prompt length, concurrency, timeout, and `UNKNOWN_OUTCOME` semantics are versioned and tested on both extension and server boundaries |

## Phase 1: Default-Off Security and Policy Foundation

### Parallel lanes

- Lane A, server authorization: `SRV-01`, `SRV-02`, `REL-01`.
- Lane B, persistence: `SRV-03`.
- Lane C, extension secret boundary: `EXT-01`, `EXT-02`, `EXT-03`.
- Merge risk: medium. Assign one owner each to Prisma migrations, command-grant files,
  system configuration, manifest/build scripts, and runtime message policy.

| ID | Task | Priority | Effort | Dependencies | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| SRV-01 | Add BYOK policy and readiness service | P0 | M | FND-01 | Generation, ingest, and publish are separately default-off; decisions bind owner, shop, device, canonical Provider origin, operation, and policy revision; configuration failure is closed; responses never include secrets |
| SRV-02 | Add a dedicated BYOK ingest scope and command grant | P0 | L | FND-01, SRV-01 | A new scope and operation bind session, token, owner, shop, workflow, draft version, idempotency key, and request hash; old devices do not gain the scope automatically; expiry, revocation, scope loss, and shop transfer fail before mutation |
| SRV-03 | Add non-secret BYOK provenance and idempotency persistence | P0 | L | FND-01 | Migration records actor/device/shop, endpoint-origin hash, model, operation, Provider request ID, Prompt/source/result hashes, asset, draft/SKU/slot, timestamps, publish intent, and ERP AI charge `0`; no key, Authorization value, raw base64, secret URL, or raw Provider body can be stored |
| EXT-01 | Implement closed profile schema and session secret store | P0 | L | FND-01 | Non-secret name/base URL/model/preferences may persist; API key exists only in `chrome.storage.session`; endpoint change, device disconnect, and session clear delete the key and capability evidence; public state returns only redacted metadata such as `hasKey` |
| EXT-02 | Implement exact-origin optional permission broker and package rules | P0 | L | FND-01 | Provider access is requested from a trusted user gesture for one canonical HTTPS origin; cloud package has no mandatory `<all_urls>` Provider access; redirects, embedded credentials, query/fragment endpoints, private/metadata hosts, and origins outside the ERP allowlist are rejected before network I/O |
| EXT-03 | Extend runtime message authorization for new extension pages | P0 | M | FND-01, EXT-01 | Workbench and Provider settings senders have explicit message allowlists; content scripts and web pages cannot read or invoke secret-bearing operations; API key never appears in responses, DOM state, URLs, logs, local/sync storage, or packaged output |
| REL-01 | Add administrator controls and privacy disclosure | P0 | M | SRV-01 | Admin settings separate hosted, BYOK generation, BYOK ingest, and BYOK publish; allowed origins, allowed operations, and maximum concurrency are configurable; every new flag defaults off; UI explains that selected images and Prompts go to the user's Provider |

## Phase 2: Secure Single-Image BYOK Vertical Slice

This milestone intentionally starts with synchronous text-to-image and concurrency `1`. It
proves the trust, storage, billing, draft, and publish boundaries before batch/edit complexity.

### Parallel lanes

- Lane A, server ingest: `SRV-04`, `SRV-05`, `SRV-06`.
- Lane B, Provider path: the text-to-image portion of `EXT-04`, then `EXT-05`.
- Lane C, minimal UX: `UI-01` and `UI-02A` against fixture contracts.
- Lane D, integration: `INT-01`, then `INT-02` and `QA-01` after Lanes A-C converge.
- Merge risk: high at convergence. `schema.prisma`, `index.ts`, `service-worker.js`, manifest
  builders, and command-grant entry points each require a single owner. Core logic stays in
  new modules.

| ID | Task | Priority | Effort | Dependencies | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| SRV-04 | Build device-scoped hostile-image normalization and ingest | P0 | XL | FND-03, SRV-01, SRV-02, SRV-03 | Bounded multipart/stream input accepts only verified single-frame PNG/JPEG/WebP; magic and MIME agree; byte, dimension, pixel, frame, and total limits apply before persistence; server decodes, strips metadata, re-encodes, hashes normalized bytes, and stores via current local/OSS/R2 abstraction; replay returns the same asset |
| SRV-05 | Bind ingested media to an exact listing draft revision | P0 | L | SRV-04 | Owner, shop, workflow, revision, draft version, SKU, slot, result hash, and order are checked atomically; stale state returns conflict without partial mutation; arbitrary external URLs are rejected; generated assets are distinguishable from captured source assets |
| SRV-06 | Enforce hosted/BYOK billing separation | P0 | M | FND-02, SRV-03, SRV-04 | BYOK ingest never creates or settles an ERP AI cost reservation; every hosted paid execution still requires reservation and settlement; database tests cover forged mode labels and replay |
| EXT-04A | Implement background-only OpenAI-compatible text-to-image client | P0 | L | EXT-01, EXT-02, SRV-01, FND-03 | Only the background worker sends `/images/generations`; requests omit cookies, reject redirects, have bounded timeouts and responses, and support `b64_json` plus controlled result URLs; result downloads never carry Provider Authorization; POST timeout becomes `UNKNOWN_OUTCOME` and is not blindly retried |
| EXT-05 | Store exact capability evidence | P0 | M | EXT-04A | Evidence binds canonical base URL/origin, model, operation, request mode, policy revision, and timestamp; any endpoint/model/mode change invalidates it; text-to-image success does not unlock edit or inpaint |
| UI-01 | Create focused BYOK Provider settings page | P1 | L | EXT-01, EXT-02, EXT-05, SRV-01 | Users can name a profile, set endpoint/model, grant/revoke permission, load a session key, and test every currently implemented capability; operations that depend on later adapters remain explicitly closed; key input is cleared after submission and cannot be revealed; no first-release "remember key" option exists |
| UI-02A | Create the minimal original single-image workbench | P0 | L | FND-01, EXT-04A | A trusted source-page launch opens an extension-origin page bound to exact product/shop/draft context; user can choose BYOK, edit a Prompt, generate one result, view truthful state, reject it, or accept it; injected source panels remain compact launchers |
| INT-01 | Implement background BYOK asset ingest client | P0 | L | EXT-03, SRV-04, SRV-05, UI-02A | Accepted Blob bytes move directly from background memory to the dedicated ingest endpoint with a grant, content hash, and idempotency key; base64 and raw bytes do not enter normal runtime-message history or persistent storage; temporary bytes are removed after reject, expiry, or success |
| INT-02 | Bridge accepted BYOK result to current ERP publish flow | P0 | L | FND-02, SRV-02, SRV-05, INT-01 | Extension shows final shop/draft/SKU/media order and requires explicit confirmation; it invokes the existing publish intent, `OZON_PUBLISH` grant, receipt, and recovery path; double-click, reload, or timeout yields at most one Ozon receipt; no Ozon key or direct Seller API request exists |
| QA-01 | Prove the BYOK text-to-image vertical slice with fixtures | P0 | XL | SRV-06, EXT-04A, INT-02 | Fake Provider completes generate, preview, ingest, new draft revision, confirm, and publish; secret sentinel, private host, redirect, response bomb, malformed image, revocation, cross-shop access, stale draft, duplicate action, and unknown-outcome tests pass; BYOK AI cost rows remain exactly zero |

## Phase 3: Edit Operations, Prompt Planning, and Batch Engine

### Parallel lanes

- Lane A, Provider adapters: `EXT-04B`, then operation-specific `EXT-05` evidence updates.
- Lane B, planning/state: `EXT-06`, `EXT-07`.
- Lane C, editor: `UI-03` using existing mask semantics and fixture adapters.
- Merge risk: low to medium because each area is a new module. The existing media editor and
  mask helpers should be reused through imports rather than duplicated.

| ID | Task | Priority | Effort | Dependencies | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| EXT-04B | Add reference generation, full edit, and masked inpaint adapters | P1 | L | QA-01, EXT-05 | Multipart `/images/edits` supports bounded reference images, full edit, and PNG mask; source/mask dimension mismatch causes zero Provider calls; URL/base64 and explicit async task contracts are normalized; relay-specific dialects remain separate adapters |
| EXT-06 | Implement bounded media job engine | P1 | L | EXT-04B, EXT-05 | Queue has server-capped concurrency; pause stops new scheduling after the active request; continue, cancel queued, slot retry, and regenerate have deterministic states; alternate attempts preserve the selected result; unknown outcome requires lookup/idempotency evidence or an explicit duplicate-charge warning |
| EXT-07 | Implement fact-bound Prompt and SKU/slot planner | P1 | M | FND-01 | Plans support selected-SKU hero slots and distinct shared detail roles; users can override each Prompt and up to four references; stable plan/hash/version exist; missing dimensions, material, stock, certification, or package contents are never fabricated |
| UI-03 | Integrate reference selection, full edit, and inpaint | P1 | L | EXT-04B, EXT-06 | User can choose global/per-slot references, edit a whole image, draw a PNG mask using existing coordinate semantics, review alternatives, and regenerate one slot; unsupported operations remain visibly disabled with a concrete reason |
| QA-02 | Verify exact Provider/model/operation sandbox compatibility | P1 | L | EXT-04B, UI-03 | The configured third-party endpoint is tested separately for text-to-image, reference edit, full edit, inpaint, and async mode; evidence is operation-specific; testing uses bounded non-production inputs and does not enable production rollout |

## Phase 4: Complete Dual-Mode Workbench

### Parallel lanes

- Lane A, shell and media workspace: `UI-04`, `UI-05`.
- Lane B, hosted adapter: `HOST-01`, including extension-side plan/quote creation.
- Lane C, BYOK coordinator: `BYOK-01` on top of the batch engine and ingest client.
- Merge risk: medium. The standalone workbench owns its CSS namespace. Existing
  `source-listing-workbench.js` and `source-costing-panel.js` receive launcher/readiness
  changes only.

| ID | Task | Priority | Effort | Dependencies | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| UI-04 | Build original two-pane SKU/media workbench | P1 | XL | EXT-06, EXT-07, UI-03 | Persistent context header, segmented mode selector, keyboard-accessible SKU rail, captured/SKU/uploaded/generated source library, reference selection, ordered hero/detail slots, Prompt inspector, alternatives, and fixed task dock work without copying reference source/assets/copy |
| UI-05 | Add task, review, ordering, and recovery UX | P1 | L | UI-04 | Progress, pause-after-current, continue, cancel queued, keep/reject, slot regenerate, choose main, reorder, missing-slot checks, stale-draft handling, and publish summary reflect real state; drag ordering has keyboard alternatives |
| HOST-01 | Adapt the full ERP-hosted workflow to the new workbench | P0 | XL | FND-02, SRV-06, UI-04 | Extension can create a fact-bound hosted plan, receive ERP validation and quote, confirm maximum cost, execute queue/provider/storage, review candidate, apply approved media, retry with renewed cost confirmation, and continue to draft publish; hosted jobs never use the BYOK ingest route |
| BYOK-01 | Connect batch BYOK jobs to review, ingest, and binding | P0 | XL | INT-01, EXT-06, EXT-07, UI-04 | Selected slots run through the background Provider engine; local review controls which attempts are ingested; every publish-selected image is normalized, stored, hashed, and bound; ERP AI charge remains zero; external Provider charge warnings appear on retry |
| UI-06 | Add compact source launch and automatic context binding | P1 | M | HOST-01, BYOK-01, UI-05 | Existing AI button opens one workbench without manual extension pairing steps when a valid device session exists; exact source product, shop, draft, and selected SKU context are prefilled; ambiguous or stale context requests an explicit choice |

## Phase 5: Publishing Closure and Product Quality

### Parallel lanes

- Lane A, publish parity and recovery: `INT-03`.
- Lane B, accessibility/responsive behavior: `QA-03`.
- Lane C, security/package regression: `QA-04`.
- Merge risk: medium at publish client and manifest verifier entry points; keep one owner for
  each hotspot and run combined tests after every merge.

| ID | Task | Priority | Effort | Dependencies | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| INT-03 | Unify ordered media and Ozon publish semantics | P0 | L | HOST-01, BYOK-01, INT-02 | Both modes use the same current draft compiler, ordered media validation, publish grant, receipt, queue, and reconciliation; publish is disabled for local-only, rejected, unknown, stale, or unbound selected slots; failure/reload recovery never creates a second submission |
| QA-03 | Complete accessibility and responsive Chrome QA | P0 | L | UI-06, INT-03 | At 1440x900, 1024x768, 768x900, and 390x844 there is no overlap, clipping, or incoherent overflow; keyboard-only navigation, focus return/traps, live task announcements, 200% zoom, reduced motion, fixed image aspect ratios, and WCAG AA contrast pass screenshot and DOM checks |
| QA-04 | Run security, billing, authorization, package, and full regression suites | P0 | XL | INT-03, QA-02 | Secret sentinel, endpoint/redirect/permission, hostile image, stale draft, scope revocation, billing separation, idempotency, one-receipt, remote-code/eval, cloud/local package, lint, typecheck, server tests, preflight, extension builds, and package verification all pass |
| DOC-01 | Document profile setup, charges, permissions, failure recovery, and privacy | P1 | M | UI-06, INT-03 | Help text distinguishes ERP-hosted charges from external BYOK charges, session key behavior, per-operation capability testing, image data disclosure, retry risk, draft review, and existing ERP publish ownership |

## Phase 6: Pilot and Release

### Parallel lanes

- Lane A, rollout controls and observability: `REL-02`.
- Lane B, exact sandbox evidence: final `QA-02` runs for approved profiles.
- Deployment is sequential after all gates pass.

| ID | Task | Priority | Effort | Dependencies | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| REL-02 | Release through owner/shop/device pilots | P0 | M | QA-03, QA-04, DOC-01 | BYOK generation, ingest, and publish can be disabled independently without affecting hosted mode; first pilot is sandbox-only, then one-shop publish; audit events and receipts are visible; rollback leaves already-stored assets and receipts consistent |
| REL-03 | Build, sign, distribute, and verify cloud/local extension packages | P0 | M | REL-02 | Both packages contain the same completed feature set with environment-correct ERP endpoints; version increments once; installation/upgrade preserves non-secret profiles but not session keys; package hashes and smoke results are recorded |
| REL-04 | Deploy server/web changes and run post-deploy canaries | P0 | M | REL-03 | Database backup/migration, API/web/worker restart, readiness, default-off flags, both VPS environments, extension pairing, hosted regression, BYOK fixture ingest, and publish reconciliation checks pass before any pilot flag is enabled |

## Deferred Work

These tasks are intentionally outside the first production release:

- Persistent "remember API key" support, pending a separate reviewed at-rest secret design.
- Provider-specific Wan, Nano Banana, Responses API, or proprietary async relay adapters.
- Automatic Provider job recovery after browser restart when the session key no longer exists.
- Browser-side Ozon credentials or direct Ozon Seller API calls; these are prohibited, not
  deferred.

## Global Release Gates

1. No BYOK secret is observable outside background/session storage.
2. BYOK creates no ERP AI reservation or settlement; hosted paid execution always does.
3. Every publish-selected result is normalized, persisted, hashed, and bound to the current
   draft before publish.
4. A duplicate click, reload, network timeout, or reconciliation run produces at most one
   Ozon receipt and submission.
5. Exact endpoint/model/operation evidence exists before the operation is enabled.
6. Cloud package has no mandatory arbitrary Provider host permission and no remote code.
7. The workbench passes keyboard, responsive, overflow, and visual checks.
8. No reference extension source, assets, branding, strings, identifiers, or unsafe defaults
   are present.
