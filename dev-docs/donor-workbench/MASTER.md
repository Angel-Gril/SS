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
- [ ] Phase 3: Shop, Billing, Publish (2/3 tasks) [details](./phase-3-operations.md)
- [ ] Phase 4: Release and Cutover (0/3 tasks) [details](./phase-4-cutover.md)

## Current Status

Phase 2 is complete and Phase 3 is active with `D3.1-D3.2` complete. The donor shop picker is device-only. ERP-hosted quote/reservation/latest-settlement summaries are now server-derived and double-sanitized into the media stage without billing IDs or command authority; the self-supplied API Key path truthfully displays zero ERP generation charge. The 1.0.365 localhost handoff hotfix remains separate in `e83f4e57`; donor migration work is not deployed or published.

## Next Steps

1. Surface controlled Ozon publish only through the existing publisher receipt/reconciliation owner.
2. Keep the production entrypoint unchanged until an allowlisted real-product canary passes.
