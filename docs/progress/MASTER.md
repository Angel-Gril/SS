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
- [ ] Phase 5: Publishing closure and product quality (0/4 tasks) [details](./phase-5-publish-quality.md)
- [ ] Phase 6: Pilot and release (0/3 tasks) [details](./phase-6-pilot-release.md)

Overall: 29/37 tasks complete (78%).

## Current Status

Phase 4 is complete. Both execution modes use the same exact source/draft authority while preserving
separate billing and Provider paths. The source page now opens or focuses one unified workbench from
a valid device session, prefills exact shop/draft/SKU context, requires a revision-bound explicit
choice when ambiguous, and re-collects the original tab/frame/document immediately before session
open to reject same-URL product or SKU changes. Legacy v1 launch and batch requests fail closed for
multi-SKU drafts. BYOK still reserves a persisted execution intent before every external Provider
POST, runs selected slots serially, reviews attempts locally, and atomically normalizes, stores,
hashes, proves, and binds only accepted bytes with ERP generation charge `0`. Lost responses, worker
restart, page/device teardown, successor claims, and unknown outcomes remain absorbing; no blind
Provider retry or direct Ozon call exists. Final lint, workspace typecheck, 4,257 server tests,
preflight, Chromium desktop/mobile/zoom/forced-color/reduced-motion QA, and fresh source/cloud/local
package gates passed. `INT-03` is the next dependency-ready task. `QA-02` remains blocked until exact
paid Provider approval is recorded. All flags remain default-off; no real Provider request, charge,
ERP ingest, Ozon write, production mutation, VPS access, or deployment occurred.

## Next Steps

1. Converge both modes on `INT-03` ordered-media and publish semantics without weakening the existing
   command-grant, receipt, idempotency, or reconciliation path.
2. After `INT-03`, run the full accessibility/responsive `QA-03` gate and then the complete security
   and regression `QA-04` gate.
3. Do not start a paid `QA-02` probe until an edit-capable endpoint/model, exact credential
   revision, deployed commit, maximum cost, billing evidence path, and explicit approval are
   recorded. Do not repeat the two previously rejected `IMAGE_TO_IMAGE` requests.
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
