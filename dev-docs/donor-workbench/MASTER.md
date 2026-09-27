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
- [ ] Phase 1: Donor Workbench Shell (0/3 tasks) [details](./phase-1-shell.md)
- [ ] Phase 2: Draft and Media Parity (0/4 tasks) [details](./phase-2-parity.md)
- [ ] Phase 3: Shop, Billing, Publish (0/3 tasks) [details](./phase-3-operations.md)
- [ ] Phase 4: Release and Cutover (0/3 tasks) [details](./phase-4-cutover.md)

## Current Status

Phase 1 is active. Phase 0 established the donor inventory, server-owned device `CREATE_DRAFT`, and strict extension transport. The 1.0.365 localhost handoff hotfix remains separate in `e83f4e57`; donor migration work is not deployed or published.

## Next Steps

1. Create the donor-derived iframe workbench shell without donor credential/direct-write modules.
2. Connect source capture and `CREATE_DRAFT` projections to the shell.
3. Add browser evidence before changing the production entrypoint.
