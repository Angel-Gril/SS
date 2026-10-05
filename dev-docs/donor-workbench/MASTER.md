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

## Historical Phase Acceptance

These checked phases record their original contract acceptance, not complete donor
product parity. Current product gaps and direct-adaptation acceptance belong to the
linked owner below.

- [x] Phase 0: Foundation and Safety (3/3 tasks) [details](./phase-0-foundation.md)
- [x] Phase 1: Donor Workbench Shell (3/3 tasks) [details](./phase-1-shell.md)
- [x] Phase 2: Draft and Media Parity (4/4 tasks) [details](./phase-2-parity.md)
- [x] Phase 3: Shop, Billing, Publish (3/3 tasks) [details](./phase-3-operations.md)
- [x] Phase 4: Release and Cutover (3/3 tasks) [details](./phase-4-cutover.md)

## Current Status

COM/CN applications and public Cloud/Local downloads serve `4df9ec38 / 1.0.421`.
The two-region website gates, CAS and distribution passed. Local direct-adaptation
tasks U9–U20 (12/12 locally) now also cover server-owned offer-row SKU duplication/removal,
copy-aware pricing/packaging/attributes/media/compiler seams, and bounded native Taobao,
Tmall and PDD donor collectors. U17 adds two actual synthetic vision-model calls and U18
adds four independent PostgreSQL copy tests; production vision remains off. They are not
yet committed, signed or deployed. Copy-row real Ozon publishing, other donor platforms'
deep collectors and the new production end-to-end flow remain unaccepted. The user's
latest instruction authorizes committing, pushing, signing and two-region deployment of the
`1.0.422` candidate while website publication remains a separate gate. Current acceptance,
evidence and remaining tasks live only in [direct-adaptation.md](./direct-adaptation.md).

## Historical Continuation Notes

Translation admission now records the exact verified transport with mandatory result
review. Seven zh→ru synthetic samples returned results; five passed and two were
rejected, with failures retained. The next controlled COM pilot can explicitly add
translation to the existing owner/shop/device scope; CN remains dark. A new normal
SUITE is being prepared because native QA04 rejects the old ERP execution source.
The user's unrestricted test-cost authorization persists for this run; no Ozon write
or Provider-console access is authorized. Current facts and pending website gates
are maintained only in [direct-adaptation.md](./direct-adaptation.md).

The `848d308a / 1.0.415` candidate is deployed to COM/CN and verified healthy. The user authorized unrestricted cost for a controlled translation check; exactly two DashScope `qwen-mt-image` zh→ru submissions were made, one per synthetic calibration image, both succeeded and were manually reviewed. ERP quote was CNY 0.01 per image; provider invoice was not read. This does not promote the provider to production because the registry remains adapter-characterized and the broader zh→ru quality corpus is still missing. Public download remains 1.0.405; no website CAS or publication gate ran.

The next direct-adaptation slice is complete locally: image watermark templates, reviewed official Ozon video bindings through the existing publisher, and paid extension translation quote/runtime/billing/recovery wiring. Local PostgreSQL tests (16), extension tests (68), Chrome image-watermark/video/paid-price fixtures, lint and typecheck pass. The full backend run passed 6520 business tests; five pre-existing fixture dependency-copy failures were repaired and their original 103 tests passed independently. No real Provider/Ozon mutation or charge occurred. Production translation remains dark until actual zh→ru capability/quality evidence passes; captured source videos still require official upload before binding. Exact ownership, compatibility and evidence live only in [direct-adaptation.md](./direct-adaptation.md).

Release follow-up complete: `556e7ca2b8153c8081f49e6c742911aad7f3549c / 1.0.413` is pushed, regionally signed and deployed to COM/CN. Full canonical VPS evidence passed in both regions (0 failures, 1 existing remote-backup warning). The actual signed COM Cloud package passed isolated MV3 source-page/default-entry/Blob-channel acceptance against the same clean commit. COM DOTH pilot and CN direct/RDS dark policy remain exact. Public downloads remain `0d695279 / 1.0.405`; no publication approval, REL-04 publication canary, CAS or distribution probe was run. No new Provider/Ozon request or charge occurred. Current evidence and remaining video-publish/production-translation scope live in [direct-adaptation.md](./direct-adaptation.md).

The screenshot follow-up now includes watermark preview/apply with server-owned processed assets, captured source-video preview, and explicit hero-only AI main-image plus translation sequencing. Hero-only planning remains distinct from default gallery planning. Local server/Prisma/extension/browser gates pass with zero Provider/Ozon mutations. Ozon rich-content video publishing remains a separate server contract and is not claimed here. The next release is a controlled `1.0.413` candidate; public downloads and website pointer remain unchanged until the signed two-region gates pass.

Current local follow-up: screenshot-specific SKU image interaction tasks U1/U2 are complete (2/2 local). The adapted six-column summary opens a same-window source/result manager with SKU navigation and one hosted primary action. Confirmed mutations no longer wait for authority refresh; readback warnings recover through explicit reads. Focused regressions (57), package verification and isolated Chrome fixtures passed. Watermark/video/combined-main-and-translation parity and live image quality remain open. No commit/push/sign/deploy or real Provider/Ozon write occurred in this UI slice. Evidence and limits live only in the [direct-adaptation owner](./direct-adaptation.md).

Runtime correction: COM/CN now run `e659d2ec / 1.0.412`; public downloads remain `0d695279 / 1.0.405`. Original tasks were recovered and settled once, then both candidates were rejected for distortion; no assignment or Ozon publish occurred. The recovery-preparation entries below are historical.

Live follow-up: COM/CN run `08f9b9ce / 1.0.409`. Three real 1688 products passed same-window capture, single-SKU draft and category comparison. The authorized two-image suite reached its original Provider tasks, but their successful 800px outputs were rejected by the old dimension contract and also failed visual quality. A narrowly audited original-task recovery and truthful raw dimensions passed independent PostgreSQL tests; candidates must remain subject to review and these outputs should be rejected. Current limits and evidence live in the [direct-adaptation owner](./direct-adaptation.md#2026-10-04-10409-真实三商品对照与原套图恢复). No new Provider POST or public pointer switch is authorized by these local recovery checks.

2026-10-04 continuation: COM/CN applications now run `cef39186 / 1.0.408`, while official downloads remain `0d695279 / 1.0.405`. Live source-page catalog/tree and category attribute preview/save are verified; hosted preparation exposed a raw capture-key versus URL-free selection mismatch before any Provider dispatch. The server alias resolver, extension producer/async guards and category ranking are being completed in one follow-up candidate. Current facts and the still-unused CNY 0.28 authorization are maintained only in the [direct-adaptation owner](./direct-adaptation.md#2026-10-04-真实采集参考图到托管计划的接线修复). Historical phase counts do not assert this new live flow has passed.

The historical phases above describe their original contract/release acceptance. As of 2026-10-03, COM/CN applications and official Cloud/Local downloads serve `0d695279 / 1.0.405`. The source-page entry mounts the directly reused precision workbench by default; source-listing/source-costing media and publish surfaces are removed from the installable package. The separate calculator remains available for cost/profit and source search only. Current QA04, regional VPS/canary, approval, CAS, distribution and publication verification are recorded in the [direct-adaptation owner](./direct-adaptation.md#2026-10-03-10405-双区官网公开发布完成).

The earlier `8bab3486 / 1.0.401` package was published before the default-entry change; its legacy-surface canary was not reused for the new package. The original `58cc814e` two-image suite, review, assignment and replay remain unchanged. The current QA04 source bridge passed against the exact execution-neutral server transitions and newly collected `0d695279` cleanup readbacks; it does not claim a new precision Provider/Ozon workflow. The four historical failures retain their audited termination and cost facts. No new Provider request or charge occurred; the new CNY 0.28 authorization remains unused.

The user has corrected the direction to direct adaptation of the original `jp20260803` extension. A1.1, A1.2, A2.2, A2.3 and A2.4 are complete locally (5/7 current tasks): actual donor UI reuse, continuous capture-to-draft, the donor 1688 parser with a real product readonly check, the complete local hosted/BYOK/edit/translation workbench slice, and same-window publisher preview/confirmation/receipt wiring. A2.1 now includes draft detail, price/offer ID, official category, per-SKU packaging, official attributes, manual copy candidates and validation; server persistence for locally duplicated SKU rows remains open. A2.3 browser fixtures now cover IMAGE_TO_IMAGE, FULL_EDIT and INPAINT source catalog, Blob previews, SOURCE/REFERENCE/MASK handles, candidate preview and review handoff; the edit panel also refreshes controls when prompt/operation/source/mask inputs change. Provider/Ozon responses in the latest browser flow are explicit local fixtures; translation quality and the broader precision production workflow remain A3 gates. The package verifier requires the precision/BYOK and donor editor modules. The unique scope/evidence owner is [direct-adaptation.md](./direct-adaptation.md). The user's later explicit cleanup request retired the old default UI in `1.0.403`; historical source and prior signed bundles remain available for comparison and rollback.

## Next Steps

The default entry cutover and public distribution are complete. Keep backend permission and payment authority intact, then address A2.1 duplicated-SKU persistence and the remaining donor-specific A3 live flow, other-platform collector and translation/BYOK/Ozon acceptance. Public distribution and historical hosted-suite evidence do not close those separate functionality checks.

The 2026-10-03 usability follow-up is publicly distributed in `1.0.405`: outer workbench scrolling, native table wheel behavior, explicit category selection, independent translation mode/readiness, recoverable BYOK registration, and same-window edit entry behavior are covered by the current owner tests and isolated Chrome fixture. Production image translation remains gated by the server readiness owner and is displayed as unavailable when that gate is closed. This publication does not claim a new production Provider/Ozon workflow on the current device session.
