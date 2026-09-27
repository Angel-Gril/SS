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
- [ ] Phase 3: Shop, Billing, Publish (1/3 tasks) [details](./phase-3-operations.md)
- [ ] Phase 4: Release and Cutover (0/3 tasks) [details](./phase-4-cutover.md)

## Current Status

Phase 2 is complete and Phase 3 is active with `D3.1` complete. The donor shop picker now requests only the scoped device shop projection and fails before the legacy account-token branch if the device reader is unavailable. Candidate review, append-to-draft and task recovery retain their existing server owners; hosted suite pause/continue remains in the AI workbench owner. The 1.0.365 localhost handoff hotfix remains separate in `e83f4e57`; donor migration work is not deployed or published.

## Next Steps

1. Add quote/reservation/settlement projections without exposing internal billing identities.
2. Keep Ozon publish behind the existing publisher receipt/reconciliation owner.
3. Keep the production entrypoint unchanged until an allowlisted real-product canary passes.
