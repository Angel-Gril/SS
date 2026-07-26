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
- [ ] Phase 4: Complete dual-mode workbench (1/5 tasks) [details](./phase-4-dual-mode-workbench.md)
- [ ] Phase 5: Publishing closure and product quality (0/4 tasks) [details](./phase-5-publish-quality.md)
- [ ] Phase 6: Pilot and release (0/3 tasks) [details](./phase-6-pilot-release.md)

Overall: 25/37 tasks complete (68%).

## Current Status

Phase 4 is in progress with `UI-04` complete. The extension-origin workbench now provides the
original two-pane SKU/media shell: persistent exact context, immutable execution mode after
dispatch, keyboard SKU and source navigation, bounded references, ordered hero/detail slots,
Prompt editing, alternatives, and a responsive task dock. Bootstrap/runtime projections are
pure-data, revisioned, atomic, cross-SKU safe, and truthfully show pending dispatch as
`SUBMITTING`. Device/page invalidation fences delayed edit media uploads and clears local handles.
Real Chrome responsive, 200% zoom-equivalent, overflow, sticky-dock, and keyboard checks passed.
`UI-05`, `HOST-01`, and `BYOK-01` are now dependency-ready in their respective Phase 4 lanes.
`QA-02` remains blocked until exact paid Provider approval is recorded. All new flags and
administrator policy remain default-off; no real Provider request, ERP AI charge, ERP ingest,
Ozon write, production mutation, or VPS deployment occurred.

## Next Steps

1. Continue Lane A with `UI-05`: connect truthful task progress, pause/continue/cancel, review,
   regeneration, keyboard ordering, missing/stale checks, and publish summary to the workspace.
2. Start `HOST-01` and `BYOK-01` in separate owners now that `UI-04` is stable; keep hosted
   reservation/review and BYOK zero-ERP-generation-charge paths distinct until convergence.
3. Do not start a paid `QA-02` probe until an edit-capable endpoint/model, exact credential
   revision, deployed commit, maximum cost, billing evidence path, and explicit approval are
   recorded. Do not repeat the two previously rejected `IMAGE_TO_IMAGE` requests.

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
