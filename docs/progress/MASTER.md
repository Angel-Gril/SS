# Dual-Mode Extension AI Image Workflow: Master Progress

## Task

Build one SS ERP browser-extension image workbench with two explicit execution modes:

- `ERP_HOSTED`: ERP owns Provider execution, pricing, quota, queue, storage, candidate
  review, draft application, and Ozon publishing.
- `BYOK`: the extension background calls the user's approved AI Provider with a session-only
  API key, the user reviews results locally, ERP normalizes and binds accepted media, and the
  existing ERP publisher performs the final Ozon submission.

The workbench recreates the useful reference workflow in original SS ERP code and visual
language. It does not copy reference source, assets, branding, strings, identifiers, unsafe
credential storage, or direct Ozon calls.

## Analysis

- [Project overview](../analysis/project-overview.md)
- [Module inventory](../analysis/module-inventory.md)
- [Risk assessment](../analysis/risk-assessment.md)

## Plan

- [Task breakdown](../plan/task-breakdown.md)
- [Dependency graph](../plan/dependency-graph.md)
- [Milestones](../plan/milestones.md)

## Project Skill

- [Develop dual-mode AI workbench](../../.codex/skills/develop-dual-mode-ai-workbench/SKILL.md)

## Implementation Phases

- [x] Phase 0: Contract and regression baseline (3/3 tasks) [details](./phase-0-contract-baseline.md)
- [x] Phase 1: Default-off security foundation (7/7 tasks) [details](./phase-1-security-foundation.md)
- [x] Phase 2: Secure single-image BYOK vertical slice (10/10 tasks) [details](./phase-2-byok-vertical-slice.md)
- [ ] Phase 3: Edit operations and batch engine (4/5 tasks) [details](./phase-3-edits-batch-engine.md)
- [x] Phase 4: Complete dual-mode workbench (5/5 tasks) [details](./phase-4-dual-mode-workbench.md)
- [ ] Phase 5: Publishing closure and product quality (3/4 tasks) [details](./phase-5-publish-quality.md)
- [ ] Phase 6: Pilot and release (0/3 tasks) [details](./phase-6-pilot-release.md)

Overall: 32/37 tasks complete (86%).

## Current Status

`DOC-01` is complete. `QA-02` preparation now uses a private canonical closed-schema `v2`
one-request approval with `approvedAt`/`expiresAt`, a positive validity window capped at 60 minutes,
strict UTF-8/duplicate-key/bounded-file checks, and freshness rechecks after DNS, at the immutable
claim, before Provider execution, and at both generation/edit POST boundaries. The offline
`sandbox:ai-image:approval:verify` command rejects submit secrets, non-HTTPS/localhost endpoints,
and any exact request mismatch while performing no DNS, intent/fingerprint, or Provider operation.
Before human approval, the separate `sandbox:ai-image:approval:draft` command can bind the same
non-secret request into one exclusive private canonical file. Independent statement/timestamp
sentinels keep that file impossible for the approval loader to accept until a human reviews every
field and manually replaces only those three values; the command refuses secrets, paid
confirmation, existing approval configuration, unsafe media/endpoints/parents, revision drift, and
overwrites while performing no DNS, Provider, intent, or fingerprint operation.
The request claim is closed to known fields and replay identity binds only actual Provider transport
semantics, so approval, profile/dimension metadata, credential revision, adapter revision, or a new
Operation ID cannot authorize the same paid POST again. Git marker/HEAD drift, dirty tracked files,
and Git inspection errors fail closed; in Git checkouts paid executables must also be tracked and
byte-identical to the bound revision, Git HEAD is re-read after status inspection, and Git receives
a minimal secret-free environment with hooks and fsmonitor disabled. Official sandbox CLIs reject
marker-only release archives; VPS execution requires a private checkout of the deployed revision.
A separate network-free
`sandbox:ai-image:billing:finalize` command now verifies private before/settled billing snapshot
bytes, the v2 intent, v3 submit report, recomputed transport fingerprint, approval-time chronology,
Provider correlation, and all artifact digests before writing one append-only sanitized settlement.
The original intent/report remain byte-identical with `actualCostCents: null`; exact replay remains
idempotent across compatible finalizer revisions, over-budget charges are recorded as
`COST_LIMIT_EXCEEDED`, and settled billing cannot upgrade a `RECONCILIATION_REQUIRED` Provider
outcome. Snapshot identity uses canonical paths plus bigint device/inode evidence, output creation is
bound to one private directory identity, and a different finalizer revision can only return an exact
existing receipt. Focused draft/approval/runner/guard/billing tests passed `114` with one
Windows-only POSIX boundary test skipped; repository lint (existing warnings only), workspace
typecheck, the static
contract, sandbox TypeScript compilation, and full preflight passed. Preflight reported `445` passes
and `0` failures. No implementation task is dependency-ready until an edit-capable endpoint/model
and the exact paid `QA-02` request are explicitly approved; `QA-04` and release remain downstream.
All flags remain default-off; no real Provider request, charge, ERP ingest, Ozon write, production
mutation, VPS access, deployment, or `.context/` staging occurred.

The latest offline hardening binds Linux approval-draft writes, paid-request claim/intent artifacts,
and final billing durability syncs to held private directory descriptors with final visible-path and
handle identity checks. Parent or child replacement cannot silently redirect an artifact into a
replacement path before Provider dispatch. Approval drafting and exact-request preflight now share
one no-follow, descriptor-bounded media verifier that pins SHA-256, enforces the shared `50 MiB` edit
limit before reading excess mask bytes, and verifies MIME, dimensions, pixels, single-page state and
meaningful PNG mask alpha. Hostile-media tests cover non-images, animated WebP, read-time growth and
invalid masks; Linux-only tests cover final-entry symlinks and independent parent/child replacement.
Focused tests passed `197` with six platform/environment-specific skips; full server tests passed
`4371` with `194` skipped. The static contract, sandbox compilation, repository lint (existing
warnings only), workspace typecheck, diff check and full preflight passed; preflight reported `445`
passes, `0` failures and two expected local-package permission warnings. Independent reviews found
no P0/P1 issue. An isolated Docker Linux run corrected an over-broad test fault seam and then passed
the two filesystem/media boundary files `8/8` with runtime networking disabled, including all cases
skipped on Windows; production code did not require a change. Phase 3 remains `4/5` and overall
progress remains `32/37`: no exact paid `QA-02` capability evidence exists yet, all rollout flags
remain default-off, and no Provider call, charge, production mutation, VPS access, deployment, flag
change, or `.context/` staging occurred.

A subsequent sanitized read-only audit found both VPS deployments at `c98a2e4`: international kept
the third-party relay under a legacy `openai-images` label with model `gpt-image-2`, zero price and
all AI media/extension flags off, while domestic remained disabled. One bounded authenticated
`GET /models` returned only that already edit-rejected model and made no generations/edits request.
The paid runtime contract now independently restricts `openai-images` to the canonical official API
and requires relays to use `custom`; manually constructed matching legacy v1 generation/edit
contracts fail before Provider resolution, and suite readiness fails closed even with injected
sandbox evidence. Focused tests passed `138/138`. Phase 3 remains `4/5` and overall progress remains
`32/37`: a different edit-capable endpoint/model and explicit one-request approval are still required.
The final regression run exposed one stable-error mapping issue when an existing paid workflow was
replayed after its endpoint changed; quote reconstruction failures now remain
`MEDIA_PROVIDER_CONFIG_CHANGED` and no job is enqueued. Its focused test passed `83/83`. Repository
lint passed with `20` existing warnings and no errors, workspace typecheck passed, full server tests
passed `4376` with `194` skipped, and preflight passed `445` checks with no failures and the two
expected local-extension permission warnings. Bare official origins now bind the effective `/v1`
transport; a pre-existing v1 contract using the older bare-origin hash fails closed and must be
recreated rather than retried. No Provider call, charge, production mutation, deployment, flag
change, or `.context/` staging occurred during these gates.

The remaining `QA-02` promotion path is now structurally bound to exact sandbox evidence rather than
a provider/model-wide label. Each verified record must match the canonical endpoint SHA-256,
operation, input transport, and sync/async result mode. Generation, edit, translation, and paid-suite
dispatch all fail closed on a missing or mismatched binding; accepted asynchronous translation tasks
still retain their existing poll-only recovery path after registry tightening. A static contract
prevents future registry entries from being marked `sandbox-verified` without complete per-operation
bindings. Focused capability/worker/suite tests passed `87/87`, the Server typecheck passed, and the
Provider foundation contract passed. Repository lint passed with `20` existing warnings and no
errors, workspace typecheck passed, full Server tests passed `4383` with `194` skipped, and preflight
passed `445` checks with no failures and the two expected local-extension permission warnings.
Phase 3 remains `4/5` and overall progress remains `32/37`:
there is still no different edit-capable endpoint/model or explicitly approved paid request. All
production flags remain off, and this offline work made no Provider request, charge, production
mutation, VPS access, deployment, or `.context/` staging.

## Next Steps

1. Do not start a paid `QA-02` probe until an edit-capable endpoint/model is selected and the private
   [one-request approval record](../runbooks/ai-image-provider-sandbox-approval.md) binds the exact
   credential revision, deployed commit, operation/profile, source/mask hashes, maximum cost,
   billing evidence path, and an unexpired validity window of at most 60 minutes. The offline draft
   command may prepare the non-secret fields, but its rejection sentinels and digest are not
   approval; a human must complete the documented final review. Execute the paid probe only
   from a private clean checkout of the deployed revision; do not repeat the two previously rejected
   `IMAGE_TO_IMAGE` requests.
2. After a single approved `QA-02` request, retain private before/settled billing snapshot files,
   run the append-only billing finalizer, and record exact endpoint/model/operation/request-mode
   evidence before promoting any capability.
3. Run `QA-04` only after the exact paid `QA-02` evidence exists; then proceed to the owner/shop/
   device pilot and release gates.
4. Do not downgrade to an old extension while a BYOK batch is pending. Drain the batch first or use
   a rollback package carrying the new launch-session and Registry recovery layer.

## Cross-Conversation Protocol

At the start of every development session:

1. Read this file first.
2. Read the active phase file and its referenced plan section.
3. Check the current Git worktree without reverting unrelated user changes.
4. Mark exactly one active task in the native task tracker.
5. After completing a task, update its checkbox, the phase count, the overall count, Current
   Status, and Next Steps before moving to another task.

## Non-Negotiable Invariants

- API keys stay background-only in `chrome.storage.session` for the first release.
- BYOK creates no ERP AI generation reservation or settlement.
- Hosted paid execution always uses ERP cost controls and candidate review.
- Every publish-selected BYOK image is normalized, persisted, hashed, and draft-bound first.
- Both modes publish only through the existing ERP command-grant, receipt, and reconciliation
  path. The extension never stores Ozon credentials or calls Ozon directly.
- Provider capability evidence is exact to endpoint, model, operation, and request mode.
- No reference extension source, assets, branding, strings, identifiers, or unsafe defaults
  are copied.
