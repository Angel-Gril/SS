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
- [ ] Phase 4: Release and Cutover (2/3 tasks) [details](./phase-4-cutover.md)

## Current Status

Phases 0-3 are complete locally and Phase 4 is active with `D4.1-D4.2` complete. The unified media entry shipped to both application regions as `0db36e3d / 1.0.384`, while the website pointer remains on `6378b62e / 1.0.364`. D4.3 still has no PASS receipt: the first signed real-product rerun reached a complete logged-in 1688 document, but the old canary still waited for the donor iframe that the new unified entry intentionally suppresses.

The current continuation updates the release-bound canary owner to the shipped product model. It must prove the donor trigger opens the existing media-focus card, the calculator-only surface is hidden there, the donor iframe stays hidden, close/rollback restores the legacy entry, the negative product remains blocked, and Provider/Ozon/ERP mutations remain zero. The next candidate must be rebuilt and signed from this final commit before that evidence can close D4.3.

## Next Steps

1. Rebuild/sign the final commit and rerun the updated release-bound real-product canary with the already authorized logged-in 1688 cookie source.
2. After that canary passes, obtain final-commit fresh normal SUITE/QA04 evidence under the separate cost and mutation boundary.
3. Generate regional canaries, website approval and CAS only after the final commit is deployed and every publication gate passes.
