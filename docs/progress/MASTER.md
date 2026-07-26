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
- [ ] Phase 4: Complete dual-mode workbench (0/5 tasks) [details](./phase-4-dual-mode-workbench.md)
- [ ] Phase 5: Publishing closure and product quality (0/4 tasks) [details](./phase-5-publish-quality.md)
- [ ] Phase 6: Pilot and release (0/3 tasks) [details](./phase-6-pilot-release.md)

Overall: 24/37 tasks complete (65%).

## Current Status

Phase 3 is in progress with `EXT-04B`, `EXT-06`, `EXT-07`, and `UI-03` complete. The extension
workbench now exposes bounded global/per-slot references, full-image editing, same-size PNG-mask
inpaint, keyboard mask controls, stable alternative review, and charge-aware regeneration. Blob
media stays on one-use channels, API keys and Provider calls remain background-only, text and
edit paths share authenticated concurrency, and worker restart cannot erase an unresolved
external-charge marker. Real Chrome responsive, geometry, keyboard, focus, and async-preview QA
passed after fixing the selected-preview layout shift. `QA-02` is the next dependency-ready task,
but it requires newly approved edit-capable endpoint/model credentials and explicit cost approval;
the previously rejected paid requests must not be repeated implicitly. All new flags and
administrator policy remain default-off; no real Provider request, ERP AI charge, Ozon write,
production mutation, or VPS deployment occurred.

## Next Steps

1. Do not start a paid `QA-02` probe until an edit-capable endpoint/model, exact credential
   revision, deployed commit, maximum cost, billing evidence path, and explicit approval are
   recorded. Do not repeat the two previously rejected `IMAGE_TO_IMAGE` requests.
2. When approved, test text generation, reference generation, full edit, inpaint, and async mode
   separately and keep capability evidence exact to endpoint, model, operation, and request mode.
3. Keep production flags off after sandbox evidence. Complete long-batch retained-result lifecycle
   semantics with `BYOK-01`, where the coordinator and UI can keep `expiresAt` truthful together.

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
