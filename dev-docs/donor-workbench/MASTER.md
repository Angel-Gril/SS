# SS ERP Donor Workbench Migration

Task: Rebuild the SS ERP browser extension workbench from the user-owned `jp20260803` donor UI while preserving SS ERP server authority for identity, shops, drafts, media, billing, review, idempotency and publishing.

## Documents

- [Project overview](./project-overview.md)
- [Module inventory](./module-inventory.md)
- [Risk assessment](./risk-assessment.md)
- [Task breakdown](./task-breakdown.md)
- [Dependency graph](./dependency-graph.md)
- [Milestones](./milestones.md)

## Progress

- [x] Phase 0: Foundation and Safety (3/3 tasks) [details](./phase-0-foundation.md)
- [x] Phase 1: Donor Workbench Shell (3/3 tasks) [details](./phase-1-shell.md)
- [x] Phase 2: Draft and Media Parity (4/4 tasks) [details](./phase-2-parity.md)
- [x] Phase 3: Shop, Billing, Publish (3/3 tasks) [details](./phase-3-operations.md)
- [ ] Phase 4: Release and Cutover (0/3 tasks) [details](./phase-4-cutover.md)

## Current Status

Phases 0-3 are complete locally. The donor shop picker is device-only; hosted billing is server-derived and double-sanitized; review/apply/task recovery retain their existing owners. The donor review stage opens the established extension workbench for publish preview, explicit confirmation, receipt and recovery, and contains no Ozon command or direct API path itself. The 1.0.365 localhost handoff hotfix remains separate in `e83f4e57`; donor migration work is not deployed or published.

## Next Steps

1. Add donor-specific package/security verification coverage for the complete migrated surface.
2. Run an allowlisted real-product canary while the production entrypoint remains unchanged.
3. Cut over only after separate package, canary and publication approvals with rollback evidence.
