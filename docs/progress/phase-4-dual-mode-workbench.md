# Phase 4: Complete Dual-Mode Workbench

Progress: 3/5 tasks.

## Tasks

- [x] `UI-04` Build original two-pane SKU/media workbench (`P1`, `XL`). Acceptance: context
  header, mode selector, SKU rail, source/reference library, hero/detail slots, Prompt
  inspector, alternatives, and task dock work without copied reference code/assets/copy.
- [x] `UI-05` Add task/review/order/recovery UX (`P1`, `L`). Acceptance: progress, pause,
  continue, cancel queued, keep/reject, regenerate, choose main, reorder, missing/stale checks,
  and publish summary reflect real state; drag has keyboard alternatives.
- [x] `HOST-01` Adapt full ERP-hosted workflow (`P0`, `XL`). Acceptance: extension plan,
  ERP validation/quote, maximum-cost confirmation, queue/storage, candidate review, approved
  draft apply, retry cost confirmation, and publish all work; hosted never uses BYOK ingest.
- [ ] `BYOK-01` Connect batch BYOK review/ingest/binding (`P0`, `XL`). Acceptance: selected
  slots run in background; local review determines ingest; publish-selected outputs are
  normalized/stored/hashed/bound; ERP AI charge is zero; retry warns of Provider charges.
- [ ] `UI-06` Add compact auto-bound source launcher (`P1`, `M`). Acceptance: valid device
  session avoids manual pairing; exact source/shop/draft/SKU context prefills; ambiguous or
  stale context requires explicit choice.

## Parallel Lanes

- Lane A: `UI-04`, `UI-05`.
- Lane B: `HOST-01`.
- Lane C: `BYOK-01`.
- Convergence: `UI-06`.
- Merge risk: medium; existing source scripts receive launcher/readiness changes only.

## Notes

- Mode becomes immutable once execution starts.
- Hosted candidates require ERP review; BYOK results are reviewed locally before secure ERP
  ingest and draft binding.
- 2026-07-27: `UI-04` completed as an original SS ERP workspace. The extension-origin page now
  has a persistent context header, closed mode selector, keyboard SKU rail, four-source media
  library, bounded global/per-slot references, ordered hero/detail slots, Prompt inspector,
  stable alternatives, and a responsive task dock. Batch execution, review ordering, hosted
  dispatch, and BYOK batch ingest remain explicitly disabled for their later tasks.
- Workspace bootstrap/runtime data is exact-key, pure-data, size-bounded, and secret/URL free.
  Runtime revisions apply atomically; cross-SKU generated media, inconsistent task/attempt state,
  stale projections, Prompt changes after dispatch, and reference changes after execution fail
  closed. Pending Provider dispatch is represented as `SUBMITTING`, never `READY`; a worker-restart
  unknown outcome remains absorbing until the user explicitly confirms the charge risk and resets.
- Main generation and edit controllers now fence delayed readiness/uploads against device or page
  invalidation. Late media handles are released, local object URLs are revoked, and duplicate
  same-slot bootstrap preserves a dirty Prompt only while the slot remains editable.
- Real Chromium QA passed at 1440x900, 1024x768, 768x900, 390x844, and a 200% zoom-equivalent
  viewport. The page had no document-width overflow, the task dock did not cover enabled controls
  or the sticky context header, and SKU/library Arrow-key selection preserved focus.
- Full lint, workspace typecheck, 3,861 server tests, preflight, both extension builds, and source,
  cloud, and local package verification passed. Cloud strict verification reported 364 passes,
  zero warnings, and zero failures. Local/source retain only the two existing offline permission
  warnings. `QA-02` remains blocked pending explicit paid Provider approval; no Provider charge,
  ERP ingest, Ozon write, production flag change, VPS deployment, or production mutation occurred.
- 2026-07-27: `UI-05` completed task progress, pause-after-current/continue, queued cancellation,
  review intent controls, charge-confirmed regeneration, deterministic main/keyboard ordering,
  missing/stale/unknown/expired/unbound recovery summaries, and a read-only publish projection.
  UI actions remain revision-fenced intents; no success is applied optimistically.
- Workspace bootstrap, runtime, publish projection, action intent, and outcome acknowledgements now
  carry the exact `shopId`, `workflowId`, `draftRevision`, and `draftVersion` binding. Slot actions
  require a newer trusted slot revision, publish projections require the exact current workspace,
  runtime, and ordered-media basis, and every command uses a unique UUID so a delayed rejection
  cannot clear a later retry. A `BOUND` candidate moves to the receipt's bound-draft binding only
  after the full ingest receipt matches the source context; invalid receipts clear the workspace.
  `UNKNOWN_OUTCOME` remains absorbing and position zero is always the SKU HERO slot.
- Candidate view/keep/reject controls fail closed with `PREVIEW_CHANNEL_NOT_READY` until the
  hosted or BYOK coordinator supplies a real one-use preview consumer. Coordinator rejections can
  explicitly unlock pending UI through an exact command outcome; cross-draft and cross-shop late
  events are ignored. Non-canonical detail-only launch data is rejected rather than fabricating a
  HERO slot; full detail launch remains owned by `BYOK-01` plus `UI-06`.
- Real Chromium checks passed at 1440x900, 390x844, a 720x450 200%-zoom equivalent, and forced
  colors/reduced motion. There was no horizontal overflow or task-dock overlap, and mobile controls
  met the 44px target. State tests passed 27/27 and media-engine tests 20/20. Full lint, workspace
  typecheck, 3,861 server tests, preflight, both extension builds, and source/cloud/local package
  verification passed; cloud strict reported 364 passes with no warning or failure. No Provider
  request, ERP ingest, Ozon write, production flag change, VPS deployment, or production mutation
  occurred.
- 2026-07-27: `HOST-01` completed the exact-device ERP-hosted path from fact-bound plan creation and
  validation through quote/maximum-cost confirmation, paid suite execution, one-use stored candidate
  preview, review, retry with renewed cost confirmation, and exact listing-draft assignment. Hosted
  assignment requires the complete plan/suite/slot/workflow/job/reservation/settlement graph and never
  calls the BYOK ingest route. Ambiguous transport outcomes remain absorbing and cannot be blindly
  retried.
- A database execution-mode lock now serializes `ERP_HOSTED` and `BYOK` ownership for each exact
  owner/workflow/draft revision/version. Hosted suite creation claims `ERP_HOSTED`; BYOK ingest claims
  `BYOK`; same-mode replay is idempotent and cross-mode races fail closed. Existing hosted suites may
  recover their exact-device plan/projection/preview while only `feature_extension_hosted_ai` is off,
  but every hosted mutation remains disabled. `NO_SUITE` performs no hosted plan read and remains
  eligible for BYOK.
- Final HOST-01 gates passed: lint with only 20 existing warnings, workspace typecheck, 4,085 server
  tests, preflight, 141 fresh PostgreSQL migrations plus 83 database integration tests, focused Hosted
  tests 159/159, controller and Chromium responsive/forced-color/reduced-motion checks, and final
  source/cloud/local package verification. Cloud passed 398 checks with no warning; source/local each
  passed 394 checks with only the two existing offline-permission warnings. All flags remain
  default-off; no Provider request, charge, ERP ingest, Ozon write, production change, deployment, or
  VPS access occurred.
- `BYOK-01` has a P0 release gate: the extension must persist and receive an exact BYOK execution
  intent before every Provider POST. Claiming mode only during accepted-result ingest is too late
  because another device could start Hosted after the external Provider has charged. The persisted
  intent must bind the exact device/shop/workflow/draft/SKU/slot, endpoint hash, model, operation,
  request mode, Provider idempotency key, and request hash; unknown outcomes remain absorbing, and
  ingest must require that same intent.
