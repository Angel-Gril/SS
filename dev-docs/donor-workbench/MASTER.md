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
- [ ] Phase 2: Draft and Media Parity (2/4 tasks) [details](./phase-2-parity.md)
- [ ] Phase 3: Shop, Billing, Publish (0/3 tasks) [details](./phase-3-operations.md)
- [ ] Phase 4: Release and Cutover (0/3 tasks) [details](./phase-4-cutover.md)

## Current Status

Phase 2 is active. `D2.1` and `D2.2` now connect the donor draft/SKU and image-prompt UX to the existing device-owned draft command and hosted/self-supplied API Key workbench. Prompt text is compiled locally from verified source facts and transferred once through an exact tab/draft/SKU-bound `chrome.storage.session` handoff; it is not a server plan, billing fact or authority input. The 1.0.365 localhost handoff hotfix remains separate in `e83f4e57`; donor migration work is not deployed or published.

## Next Steps

1. Port review/apply/assignment and exact replay UX over existing SS ERP contracts.
2. Port pause/recovery and confirmed command receipts into the donor process console.
3. Keep the production entrypoint unchanged until an allowlisted real-product canary passes.
