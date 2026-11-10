# Donor Workbench Migration Overview

> **2026-11-11 方向变更**：本目录记录的是“保留 donor 界面、把基础设施全部换成 ERP 托管”的迁移方案。
> 该方案已被产品裁决取代：扩展改为精铺式直连，ERP 只做设备授权与最终数据同步。
> 当前真源见 [`../extension-direction.md`](../extension-direction.md)；下文保留为历史记录，其中“禁止直连 Ozon/Provider”的条款不再适用于扩展。

## Confirmed Intent

Build the next SS ERP browser extension from the user-owned `jp20260803` workbench donor. Preserve its mature in-page workspace interaction while replacing its unsafe/local infrastructure with SS ERP device authority, hosted/BYOK contracts, draft ownership, billing, review, idempotency, and controlled publish.

## Current Systems

- SS ERP extension: `extensions/ss-erp/`, MV3 service worker, source-page content scripts, hosted/BYOK workbench pages, device transport and strict runtime-message policy.
- SS ERP server: Fastify routes, Prisma/PostgreSQL, source capture/snapshot owner, listing draft owner, AI media queue/settlement, review/application ledger, Ozon publisher.
- Donor extension: `jp20260803/content/injector.js` injects a full-screen iframe; `ui/panel.html` and `ui/panel.legacy.js` own the editor; `ui/app/state-store.js` and `ui/app/workflows/run-workflow.js` own staged workflow; presentation controllers/views own product, SKU, category, image, process and store UI.

## Target Shape

Adapt the actual donor UI, editor and workflow modules with minimal CSS changes and replace their infrastructure adapters with SS ERP services. SS ERP remains the owner for identity, shop access, draft creation/revision, Provider calls, cost reservation/settlement, review, assignments and Ozon publish. Current functional scope and evidence live in [direct-adaptation.md](./direct-adaptation.md); the previous shell-only cutover is not complete donor parity.

## Non-Goals

- Do not copy donor branding, license logic, secrets, direct Ozon API, direct Provider calls, or broad `debugger`/wildcard permissions.
- Do not make client state authoritative for listing drafts, charges, approvals, or publishing.
- Do not deploy the donor migration as part of the `1.0.365` localhost hotfix.
