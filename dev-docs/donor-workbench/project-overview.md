# Donor Workbench Migration Overview

## Confirmed Intent

Build the next SS ERP browser extension from the user-owned `jp20260803` workbench donor. Preserve its mature in-page workspace interaction while replacing its unsafe/local infrastructure with SS ERP device authority, hosted/BYOK contracts, draft ownership, billing, review, idempotency, and controlled publish.

## Current Systems

- SS ERP extension: `extensions/ss-erp/`, MV3 service worker, source-page content scripts, hosted/BYOK workbench pages, device transport and strict runtime-message policy.
- SS ERP server: Fastify routes, Prisma/PostgreSQL, source capture/snapshot owner, listing draft owner, AI media queue/settlement, review/application ledger, Ozon publisher.
- Donor extension: `jp20260803/content/injector.js` injects a full-screen iframe; `ui/panel.html` and `ui/panel.legacy.js` own the editor; `ui/app/state-store.js` and `ui/app/workflows/run-workflow.js` own staged workflow; presentation controllers/views own product, SKU, category, image, process and store UI.

## Target Shape

The donor UI becomes the extension workbench shell and state/presentation layer. SS ERP server remains the owner for identity, shop access, draft creation/revision, Provider calls, cost reservation/settlement, review, assignments and Ozon publish. The migration uses a strangler path: add a donor-based workbench beside the current panel, prove contracts, then switch entrypoints.

## Non-Goals

- Do not copy donor branding, license logic, secrets, direct Ozon API, direct Provider calls, or broad `debugger`/wildcard permissions.
- Do not make client state authoritative for listing drafts, charges, approvals, or publishing.
- Do not deploy the donor migration as part of the `1.0.365` localhost hotfix.
