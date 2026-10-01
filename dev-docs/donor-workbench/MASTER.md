# SS ERP Donor Workbench Migration

Task: Rebuild the SS ERP browser extension workbench from the user-owned `jp20260803` donor UI while preserving SS ERP server authority for identity, shops, drafts, media, billing, review, idempotency and publishing.

## Documents

- [Project overview](./project-overview.md)
- [Module inventory](./module-inventory.md)
- [Risk assessment](./risk-assessment.md)
- [Task breakdown](./task-breakdown.md)
- [Dependency graph](./dependency-graph.md)
- [Milestones](./milestones.md)
- [旧扩展直接适配与当前功能缺口](./direct-adaptation.md)

## Progress

- [x] Phase 0: Foundation and Safety (3/3 tasks) [details](./phase-0-foundation.md)
- [x] Phase 1: Donor Workbench Shell (3/3 tasks) [details](./phase-1-shell.md)
- [x] Phase 2: Draft and Media Parity (4/4 tasks) [details](./phase-2-parity.md)
- [x] Phase 3: Shop, Billing, Publish (3/3 tasks) [details](./phase-3-operations.md)
- [x] Phase 4: Release and Cutover (3/3 tasks) [details](./phase-4-cutover.md)

## Current Status

The historical phases above describe their original contract/release acceptance. The official COM/CN website now serves `3723f5dd / 1.0.395`, as recorded at the top of `../current-state-audit.md`. They do not prove complete donor product parity: the old production trigger still routes to the SS ERP media-focus card.

The directly adapted workbench is now pushed, signed, and deployed to COM/CN at `58cc814e / 1.0.398` with independent regional origins and signatures. Both full VPS verification receipts pass with the existing remote-backup warning. COM retains its restricted DOTH hosted pilot; CN remains dark. A dedicated installed MV3 hosted suite completed two images, review, store-draft assignment and exact replay for CNY 0.28; this authorization is exhausted. Four historical recovery records and two unresolved reservations still block formal QA04 and publication. The isolated cost projection fix is tested but not integrated or deployed; an explicit terminal abandonment contract awaits user confirmation. Synthetic installed-package attach failed three times and must not be claimed as passed. Evidence and acceptance limits are maintained only in the direct adaptation owner. The website pointer and old default entry remain unchanged.

The user has corrected the direction to direct adaptation of the original `jp20260803` extension. A1.1, A1.2, A2.2, A2.3 and A2.4 are complete locally (5/7 current tasks): actual donor UI reuse, continuous capture-to-draft, the donor 1688 parser with a real product readonly check, the complete local hosted/BYOK/edit/translation workbench slice, and same-window publisher preview/confirmation/receipt wiring. A2.1 now includes draft detail, price/offer ID, official category, per-SKU packaging, official attributes, manual copy candidates and validation; server persistence for locally duplicated SKU rows remains open. A2.3 browser fixtures now cover IMAGE_TO_IMAGE, FULL_EDIT and INPAINT source catalog, Blob previews, SOURCE/REFERENCE/MASK handles, candidate preview and review handoff; the edit panel also refreshes controls when prompt/operation/source/mask inputs change. Provider/Ozon responses in the latest browser flow are explicit local fixtures; translation quality, final real installed-package acceptance and production workflow remain A3 gates. The package verifier now explicitly requires the precision/BYOK and donor editor modules. The unique scope/evidence owner is [direct-adaptation.md](./direct-adaptation.md). The old default entry will be retired only after complete replacement functionality passes, as requested by the user.

## Next Steps

Continue from the direct adaptation owner: resolve the explicitly scoped historical recovery contract, then assemble the preserved fresh suite evidence and complete publication gates. Do not issue another paid suite with the exhausted authorization. A2.1 persistence and donor-specific A3 acceptance remain separate; the successful legacy hosted suite does not prove complete donor parity or permit retiring the old default entry.
