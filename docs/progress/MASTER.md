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
existing receipt. Focused approval/runner/guard/billing tests passed `95` with one Windows-only POSIX
boundary test skipped; repository lint (existing warnings only), workspace typecheck, the static
contract, sandbox TypeScript compilation, and full preflight passed. Preflight reported `445` passes
and `0` failures. No implementation task is dependency-ready until an edit-capable endpoint/model
and the exact paid `QA-02` request are explicitly approved; `QA-04` and release remain downstream.
All flags remain default-off; no real Provider request, charge, ERP ingest, Ozon write, production
mutation, VPS access, deployment, or `.context/` staging occurred.

## Next Steps

1. Do not start a paid `QA-02` probe until an edit-capable endpoint/model is selected and the private
   [one-request approval record](../runbooks/ai-image-provider-sandbox-approval.md) binds the exact
   credential revision, deployed commit, operation/profile, source/mask hashes, maximum cost,
   billing evidence path, and an unexpired validity window of at most 60 minutes. Execute it only
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
