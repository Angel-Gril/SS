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
- [ ] Phase 3: Edit operations and batch engine (1/5 tasks) [details](./phase-3-edits-batch-engine.md)
- [ ] Phase 4: Complete dual-mode workbench (0/5 tasks) [details](./phase-4-dual-mode-workbench.md)
- [ ] Phase 5: Publishing closure and product quality (0/4 tasks) [details](./phase-5-publish-quality.md)
- [ ] Phase 6: Pilot and release (0/3 tasks) [details](./phase-6-pilot-release.md)

Overall: 21/37 tasks complete (57%).

## Current Status

Phase 3 is in progress with `EXT-04B` complete. The extension now has bounded reference generation,
full-image edit, and same-size PNG-mask inpaint through a strict synchronous OpenAI-compatible
multipart adapter. Input and Provider result media are inspected, operation-specific capability
evidence remains exact to multipart mode, permission and credential authority are revalidated
around every post-submit network/acceptance boundary, and uncertain submissions retain request/task
hashes without blind retry. The explicit async dialect remains separate and is not selected by
production wiring. The next dependency-ready tasks are `EXT-06` and `EXT-07`, which can proceed in
parallel. All new flags and administrator policy remain default-off; no real Provider request, ERP
AI charge, Ozon write, production mutation, or VPS deployment occurred.

## Next Steps

1. Build `EXT-06` as a deterministic bounded media job engine with pause-after-active,
   continue, queued cancellation, retry/regenerate, alternate preservation, and explicit
   unknown-outcome handling.
2. Build `EXT-07` in parallel as a fact-bound SKU/slot Prompt planner with stable plan hashes,
   distinct hero/detail roles, overrides, and up to four references.
3. Keep `UI-03` pending until the edit adapter and job-engine contracts are both available; do
   not enable production flags or run a real paid Provider sandbox implicitly.

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
