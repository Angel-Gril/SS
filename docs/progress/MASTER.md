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
- [ ] Phase 2: Secure single-image BYOK vertical slice (8/10 tasks) [details](./phase-2-byok-vertical-slice.md)
- [ ] Phase 3: Edit operations and batch engine (0/5 tasks) [details](./phase-3-edits-batch-engine.md)
- [ ] Phase 4: Complete dual-mode workbench (0/5 tasks) [details](./phase-4-dual-mode-workbench.md)
- [ ] Phase 5: Publishing closure and product quality (0/4 tasks) [details](./phase-5-publish-quality.md)
- [ ] Phase 6: Pilot and release (0/3 tasks) [details](./phase-6-pilot-release.md)

Overall: 18/37 tasks complete (49%).

## Current Status

Phase 2 is active. `SRV-04` through `SRV-06`, `EXT-04A`, `EXT-05`, `UI-01`, `UI-02A`, and `INT-01`
are complete:
hostile Provider output is normalized, stored, and atomically bound to the exact draft
assignment; database-enforced execution modes keep BYOK at zero ERP AI cost while paid hosted
work requires an exact reservation and charge settlement; the focused Provider page now keeps
session keys background-only and binds permission/evidence to the exact live policy. The minimal
workbench now launches from the exact source product, binds the latest snapshot and one
server-selected SKU hero slot, preserves unresolved Provider outcomes across reloads, and supports
truthful single-result preview, reject, approval, ERP normalization, storage, and exact draft/SKU
binding without publish. The background-only ingest path now durably persists request identity,
uses exact staging leases, recovers receipts across reload and worker restart, renews expired grants
only after authoritative `NOT_COMMITTED`, and removes terminal candidates without exposing bytes in
runtime messages or persistent storage. The next active task is `INT-02`; all new flags remain
default-off and no real Provider call, production mutation, or deployment is authorized until the
remaining fixture gates pass.

## Next Steps

1. Complete `INT-02` through the existing publish intent, grant, receipt, and recovery path.
2. Complete `QA-01` with fake Provider, hostile-image,
   secret-sentinel, stale-draft, idempotency, and zero-ERP-charge gates. Keep all flags dark.
3. After Phase 2 closure, start `EXT-04B` only against fixture and sandbox-approved edit operations.

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
