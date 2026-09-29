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
- [x] Phase 4: Release and Cutover (3/3 tasks) [details](./phase-4-cutover.md)

## Current Status

Phases 0-3 are complete locally and Phase 4 is complete through `D4.3`. The final unified media entry `0116a88288203400362d26a11ca39ab6ae54c8de / 1.0.388` is signed and deployed to COM/CN, with a release-bound real 1688 PASS receipt and rollback evidence. The website pointer remains on `6378b62e / 1.0.364`.

The release-bound canary owner proves the donor trigger opens the existing media-focus card during source hydration, the calculator-only surface is hidden there, the donor iframe stays hidden, close/rollback restores the legacy entry, the negative product remains blocked, and Provider/Ozon/ERP mutations remain zero. Those checks passed on the signed 1.0.388 candidate.

## Next Steps

1. Obtain final-commit fresh normal SUITE/QA04 evidence under the separate cost and mutation boundary.
2. Generate regional publication canaries and website approval only after the QA04/publication gates pass.
3. Run distribution probe and CAS separately; do not infer public release from the dual-region deployment.
