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

The historical phases above describe their original contract/release acceptance. The official COM/CN website still serves the prior `8bab3486 / 1.0.401` package until this change is released. The new source-page entry now mounts the directly reused precision workbench by default; source-listing/source-costing media and publish surfaces are removed from the source-page manifest. The separate calculator remains available for cost/profit and source search only. This local change invalidates the previous release evidence and needs a new candidate before publication.

The earlier `8bab3486 / 1.0.401` package was signed and published before this default-entry change; its canary verified the legacy media-focus surface and is not reusable for the new package. The installed MV3 suite on `58cc814e` completed two images, review, store-draft assignment and exact replay for CNY 0.28; that authorization is exhausted. The four historical tasks were abandoned through the audited owner, preserving two settled charges and releasing two undelivered ERP reservations. New default precision acceptance is read-only and has no Provider/Ozon/ERP mutations; a fresh candidate, QA04/publication gates, and final regional deployment are still required.

The user has corrected the direction to direct adaptation of the original `jp20260803` extension. A1.1, A1.2, A2.2, A2.3 and A2.4 are complete locally (5/7 current tasks): actual donor UI reuse, continuous capture-to-draft, the donor 1688 parser with a real product readonly check, the complete local hosted/BYOK/edit/translation workbench slice, and same-window publisher preview/confirmation/receipt wiring. A2.1 now includes draft detail, price/offer ID, official category, per-SKU packaging, official attributes, manual copy candidates and validation; server persistence for locally duplicated SKU rows remains open. A2.3 browser fixtures now cover IMAGE_TO_IMAGE, FULL_EDIT and INPAINT source catalog, Blob previews, SOURCE/REFERENCE/MASK handles, candidate preview and review handoff; the edit panel also refreshes controls when prompt/operation/source/mask inputs change. Provider/Ozon responses in the latest browser flow are explicit local fixtures; translation quality, final real installed-package acceptance and production workflow remain A3 gates. The package verifier now explicitly requires the precision/BYOK and donor editor modules. The unique scope/evidence owner is [direct-adaptation.md](./direct-adaptation.md). The old default entry will be retired only after complete replacement functionality passes, as requested by the user.

## Next Steps

Prioritize the user's actual donor workflow: verify the installed precision page and its same-window capture, SKU/shop selection, draft editing and media flow, then deliver the default entry cutover. Keep backend permission and payment authority intact. Do not issue another paid suite with the exhausted authorization or use a legacy-surface canary as evidence of precision UI delivery. A2.1 persistence and donor-specific A3 acceptance remain open.
