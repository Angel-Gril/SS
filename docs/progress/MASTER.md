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
- [ ] Phase 2: Secure single-image BYOK vertical slice (0/10 tasks) [details](./phase-2-byok-vertical-slice.md)
- [ ] Phase 3: Edit operations and batch engine (0/5 tasks) [details](./phase-3-edits-batch-engine.md)
- [ ] Phase 4: Complete dual-mode workbench (0/5 tasks) [details](./phase-4-dual-mode-workbench.md)
- [ ] Phase 5: Publishing closure and product quality (0/4 tasks) [details](./phase-5-publish-quality.md)
- [ ] Phase 6: Pilot and release (0/3 tasks) [details](./phase-6-pilot-release.md)

Overall: 10/37 tasks complete (27%).

## Current Status

Phase 1 security foundation is complete. `SRV-01` through `SRV-03`, `EXT-01` through
`EXT-03`, and `REL-01` passed their focused contracts and milestone gates. The server
command-grant route now uses a strict SystemConfig-backed BYOK readiness evaluator, while
the extension dispatcher and future workbench handlers remain dark. The next dependency
ready work is the Phase 2 single-image BYOK vertical slice; all new flags remain
default-off and no real Provider call, production mutation, or deployment is authorized
until its fixture and billing gates pass.

## Next Steps

1. Start Phase 2 with `SRV-04` hostile-image normalization/ingest and `SRV-05` exact
   draft binding; keep the dedicated BYOK grant as the only admission path.
2. Implement `EXT-04A`/`EXT-05` background-only text-to-image and exact capability evidence,
   then build `UI-01`/`UI-02A` against fixtures. Add the authenticated readiness-handle
   endpoint/adapter as part of that vertical slice before requesting any Provider permission.
3. Complete `SRV-06`, `INT-01`, `INT-02`, and `QA-01` with fake Provider, hostile-image,
   secret-sentinel, stale-draft, idempotency, and zero-ERP-charge gates. Keep all flags dark.

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
