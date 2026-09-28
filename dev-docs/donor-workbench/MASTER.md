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

Phases 0-3 are complete locally and Phase 4 is active with `D4.1-D4.2` complete. D4.3 production authorization was granted, but the release-bound real-product canary has no PASS receipt: the isolated headless profile never advances the real 1688 document beyond `readyState=loading`, despite an exact final frame/loader. No candidate was deployed or published, and the production entrypoint remains unchanged.

The current uncommitted continuation keeps the donor-derived shell as one continuous precision workspace and reconnects its media entry to the existing server-owned hosted workbench launch path. The primary AI entry and donor trigger now stay inside the existing media-focus card instead of opening a second workbench tab or global iframe on real marketplace pages; the shell contract accepts the hosted plan-create command and lets the Worker resolve donor slot keys to authoritative hosted slot IDs. This is local wiring only and has not produced Provider/Ozon writes or release evidence.

## Next Steps

1. Select and explicitly authorize a repeatable live-canary browser context that has a valid 1688 page session, without weakening release, product-fingerprint, mutation or rollback checks.
2. After that canary passes, obtain separate Provider-cost authorization for the final-commit fresh normal SUITE required by QA04.
3. Deploy and switch the source entrypoint only with same-commit rollback evidence and independent publication approval.
