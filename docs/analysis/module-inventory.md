# Extension Dual-Mode AI Image Workflow: Module Inventory

## Current Extension Modules

| Module | Approx. size | Responsibility | Change strategy | Complexity |
| --- | ---: | --- | --- | --- |
| `extensions/ss-erp/background/service-worker.js` | 5,254 lines | Device session, workbench messages, media command orchestration | Add thin imports/dispatch only; keep BYOK implementation outside | Very high |
| `extensions/ss-erp/background/collect-background.js` | 5,688 lines | Collection and browser one-click job orchestration | Reuse patterns only; do not add BYOK core logic | Very high |
| `extensions/ss-erp/content/source-listing-workbench.js` | 1,601 lines | Hosted media cards, suite commands, review/apply UI | Add mode/workbench launcher; do not embed the new full workspace | High |
| `extensions/ss-erp/content/source-costing-panel.js` | 1,540 lines | Source-page panel and independent AI launcher | Route to new workbench and display readiness | High |
| `extensions/ss-erp/pages/media-editor.js` | 735 lines | Reference/full-edit/inpaint input and mask submission | Reuse mask semantics and editor concepts | Medium |
| `extensions/ss-erp/shared/ai-media/image-mask-core.js` | small | Mask representation and validation helpers | Reuse unchanged where possible | Low |
| `extensions/ss-erp/shared/ai-media/image-mask-layout.js` | small | Mask/canvas coordinate mapping | Reuse unchanged where possible | Low |
| `extensions/ss-erp/shared/erp-adapter/listing-workflow-client.js` | 1,734 lines | Device-scoped hosted media/listing commands | Extend through focused clients, not more unrelated methods | Very high |
| `extensions/ss-erp/shared/erp-adapter/source-workflow-device-session.js` | 227 lines | Strict path allowlist and device transport | Add only reviewed BYOK ingest/readiness paths | Medium |
| `extensions/ss-erp/shared/message-security/runtime-message-policy.js` | 410 lines | Sender/type authorization for runtime messages | Add explicit BYOK message policy and sender matrix | High |
| `extensions/ss-erp/pages/settings.js` | 1,822 lines | Existing ERP/logistics settings | Link to a focused AI profile surface; avoid embedding a large editor | High |
| `scripts/build-extension-package.mjs` | medium | Cloud/local manifest rewriting | Preserve optional exact-origin permissions; remove broad mandatory access | Medium |
| `scripts/verify-extension-package.mjs` | medium | Package security/static verification | Add BYOK permission, secret, and remote-code checks | Medium |

## Current Server Modules

| Module | Approx. size | Responsibility | Change strategy | Complexity |
| --- | ---: | --- | --- | --- |
| `apps/server/src/routes/extension-command-grants.ts` | 1,224 lines | One-time media and Ozon publish command authorization | Keep publish path; place BYOK ingest in a new route module | Very high |
| `apps/server/src/services/extension-media-workflow-launch.ts` | 1,420 lines | Hosted media readiness and creation | No BYOK Provider dispatch; expose hosted readiness only | Very high |
| `apps/server/src/services/ai-image-providers.ts` | 1,040 lines | Server Provider validation and requests | Use as protocol/security reference, not as BYOK execution path | High |
| `apps/server/src/services/ai-image-provider-capabilities.ts` | small | Hosted Provider/model capability registry | Keep hosted-only; BYOK evidence uses a separate endpoint-bound store | Medium |
| `apps/server/src/routes/image-upload.ts` | medium | Account-authenticated image uploads | Do not expose directly to devices; reuse validation/storage internals | Medium |
| `apps/server/src/services/image-storage.ts` | 742 lines | Local/OSS/Ozon-CDN image storage abstraction | Reuse for normalized BYOK asset persistence | High |
| `apps/server/src/services/source-listing-media-import.ts` | 451 lines | Internalize captured source media | Extend via a distinct generated-asset contract, not arbitrary URLs | High |
| `apps/server/src/routes/source-listing-workflows.ts` | 1,392 lines | Draft media, publish attempts, workflow state | Reuse draft/publish contracts; avoid a parallel draft model | Very high |
| `apps/server/src/services/ozon-listing-payload-compiler.ts` | 814 lines | Canonical Ozon payload compilation | Reuse exclusively; do not recreate reference payload defaults | Very high |
| `apps/server/src/services/ozon-listing-publisher.ts` | high | Submission, ownership, idempotency, uncertain recovery | Reuse exclusively for both modes | Very high |
| `apps/server/src/config/system-config-schema.ts` | 1,273 lines | Admin configuration defaults/meta | Add separate hosted/BYOK/direct-publish policy keys | High |
| `apps/server/src/services/source-workflow-feature-flags.ts` | medium | Owner/shop/device pilot rollout | Add BYOK and publish controls | Medium |

## New Extension Modules

| Proposed module | Responsibility | Dependencies | Complexity |
| --- | --- | --- | --- |
| `shared/byok/profile-schema.js` | Closed profile schema, canonical endpoint identity, redacted public view | URL parser, Web Crypto hash | Medium |
| `shared/byok/profile-store.js` | Session-only secret store and non-secret preference persistence | `chrome.storage.session` | High |
| `shared/byok/permission-broker.js` | User-gesture exact-origin optional permission request/revoke | `chrome.permissions` | Medium |
| `shared/byok/provider-client.js` | Background-only generations/edits request orchestration | profile schema, response limits | High |
| `shared/byok/provider-response.js` | Bounded URL/base64/error/task normalization | byte readers, MIME helpers | High |
| `shared/byok/provider-polling.js` | Explicit async task polling and unknown-outcome handling | provider response | Medium |
| `shared/byok/capability-evidence.js` | Exact endpoint/model/operation probe evidence | profile schema | Medium |
| `shared/byok/media-job-engine.js` | Slot jobs, concurrency, pause/continue/cancel/retry state machine | provider client | High |
| `shared/byok/prompt-plan.js` | SKU hero/detail slot plans and user overrides | source facts, reference selection | High |
| `shared/byok/generated-asset-ingest-client.js` | Device-scoped upload/import with content hash/idempotency | ERP device transport | High |
| `shared/byok/listing-publish-coordinator.js` | Ordered media, final preview, command grant, publish receipt | ingest client, existing publisher client | High |
| `pages/ai-image-workbench.html` | Standalone extension-origin workbench shell | packaged CSS/JS only | Medium |
| `pages/ai-image-workbench.css` | Original SS ERP two-pane responsive workspace | existing extension visual tokens | Medium |
| `pages/ai-image-workbench.js` | UI rendering and controller composition | job engine, profile public state, publish coordinator | High |
| `pages/ai-provider-settings.html/js/css` | Named BYOK profiles and capability test UI | profile store, permission broker | High |

## New Server Modules

| Proposed module | Responsibility | Dependencies | Complexity |
| --- | --- | --- | --- |
| `routes/extension-byok-media.ts` | Device-authenticated policy, ingest, and provenance endpoints | device auth, feature flags | High |
| `services/extension-byok-policy.ts` | Default-off owner/shop/device/origin policy | SystemConfig, rollout snapshot | Medium |
| `services/byok-generated-asset-ingest.ts` | Decode/stream bounds, image validation, normalize, hash, persist, bind | image storage, draft identity | High |
| `services/byok-media-provenance.ts` | Mandatory non-secret audit/provenance record | Prisma repository | Medium |
| `services/byok-listing-media.ts` | Attach ingested assets to the current draft/media assignment | source listing draft services | High |
| `repositories/byok-media-provenance-repository.ts` | Persistence and idempotency | Prisma | Medium |

## Reused Contracts

- Device session scopes and allowed-shop checks.
- One-time command grants and idempotency request hashes.
- Listing draft revision/version/SKU identity.
- Existing media assignment and canonical Ozon payload compiler.
- Ozon publish receipts, reconciliation, and rollout gates.
- Image storage backends and upload quotas.
- Hosted AI cost reservation and settlement, only for `ERP_HOSTED`.
- Existing mask semantics and server-side inpaint composition for hosted mode.

## Reference Concepts to Reimplement

| Concept | Keep | Do not copy |
| --- | --- | --- |
| Two-pane media workspace | SKU strip, source tabs, selected/reordered images, status cards | HTML/CSS/source identifiers, branding, strings, artwork |
| Provider profiles | Named profiles, endpoint/model/mode, operation checks | Plaintext persistent keys, forced Provider rewrites |
| Generation plan | SKU hero plus distinct detail roles | Disconnected Prompt planner flags and fabricated facts |
| Task controls | Progress, pause after current task, continue, slot retry/regenerate | Ignored recovery arguments and blind retries |
| Result handling | Insert into ordered media and explicit publish preview | Expiring Provider URLs and rejected base64 outputs |
| Publish UX | Multi-item summary and task result visibility | Local Ozon secrets, direct Seller API writes, unsafe stock/dimension defaults |

## Focused Test Surfaces

### Extension

- Profile schema, session secret isolation, endpoint/key rebinding.
- Runtime-message sender policy and secret redaction.
- Exact-origin optional permission request/revoke.
- Provider generations/edits/mask/URL/base64/error/async contracts.
- Job state machine, pause/continue/cancel/retry, unknown outcome.
- Workbench layout/keyboard/responsive behavior.
- Result ingest, ordered media, draft staleness, publish confirmation/replay.
- Cloud/local packaging and Chrome Web Store permission checks.

### Server

- BYOK policy fail-closed behavior.
- Device/session/shop/scope authorization and revocation.
- Image magic/MIME/pixel/animation/decompression validation and re-encoding.
- Content-hash idempotent ingest and draft binding.
- Mandatory non-secret provenance.
- Hosted cost reservations always present; BYOK cost rows always absent.
- Current draft/SKU requirement and one Ozon receipt under duplicate actions.
