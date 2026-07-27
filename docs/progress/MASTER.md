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
- [ ] Phase 4: Complete dual-mode workbench (3/5 tasks) [details](./phase-4-dual-mode-workbench.md)
- [ ] Phase 5: Publishing closure and product quality (0/4 tasks) [details](./phase-5-publish-quality.md)
- [ ] Phase 6: Pilot and release (0/3 tasks) [details](./phase-6-pilot-release.md)

Overall: 27/37 tasks complete (73%).

## Current Status

Phase 4 is in progress with `UI-04`, `UI-05`, and `HOST-01` complete. The extension-origin Hosted
path now creates an exact fact-bound plan, validates and quotes it, requires maximum-cost
confirmation, executes the paid suite, exposes one-use stored candidate previews, records review,
requires renewed cost confirmation for retry, and assigns approved media to the exact listing draft.
Database locks serialize `ERP_HOSTED` and `BYOK` ownership per owner/workflow/draft revision/version;
Hosted assignment proves the full reservation/settlement graph and never uses BYOK ingest. Existing
same-device suites retain read-only recovery when only the Hosted feature flag is off, while every
mutation remains denied. Final lint, typecheck, 4,085 server tests, preflight, 141 fresh PostgreSQL
migrations plus 83 integration tests, Chromium QA, and source/cloud/local package gates passed.
`BYOK-01` is now active with a P0 release gate: an exact persisted BYOK execution intent must claim
the mode before every external Provider POST, and accepted-result ingest must require that same
intent. `UI-06` waits for `BYOK-01`; `QA-02` remains blocked until exact paid Provider approval is
recorded. All flags remain default-off; no real Provider request, charge, ERP ingest, Ozon write,
production mutation, VPS access, or deployment occurred.

## Next Steps

1. Complete the `BYOK-01` pre-dispatch fence: persist an exact device/draft/slot/Provider attempt and
   claim `BYOK` mode before each Provider POST; keep replay and `UNKNOWN_OUTCOME` semantics absorbing.
2. Connect BYOK batch background jobs, one-use local preview/review, selected-byte ingest, exact
   intent/provenance/draft binding, retry charge warnings, and zero ERP generation charge.
3. Complete `UI-06` only after the Hosted and BYOK coordinators both provide truthful automatic
   source context binding and recovery behavior.
4. Do not start a paid `QA-02` probe until an edit-capable endpoint/model, exact credential
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
