---
name: migrate-donor-workbench
description: Migrate the user-owned jp20260803 browser-extension workbench into SS ERP while preserving server-owned device, shop, draft, billing, review, assignment, and publish contracts.
---

# Migrate The Donor Workbench

Start by reading `dev-docs/donor-workbench/MASTER.md`, then the active phase file and only the analysis/plan documents needed for the current task. Update both the phase checkbox and MASTER counts immediately after a task passes its acceptance criteria.

Use `C:\Users\550W\Downloads\jp20260803` as an authorized donor source. Reuse and adapt its iframe shell, product/SKU/category editor, image manager, JSON visual-description and prompt UX, process console, pause/recovery state, and i18n structure. Keep the donor directory read-only; migrated source belongs under the SS ERP extension tree with a documented donor mapping.

Do not copy donor license/update logic, Ozon or Provider credentials, direct Ozon/Provider requests, debugger permission, wildcard host access, old service origins, or client-owned publish/billing authority. Replace those modules with existing SS ERP device transport, source listing workflow, hosted/BYOK media, cost settlement, review/application, and publisher contracts.

For every new mutation, change the server owner first and require exact owner/device/shop/snapshot/draft revision fields. Extension pages are projections and command callers, never authority owners. Use RED -> GREEN for stable routes/contracts and real browser evidence for iframe/workflow behavior.

Keep the current extension available as rollback until the donor-based workbench passes package verification, source-page browser acceptance, allowlist canary, and publication gates. Do not combine migration commits with unrelated hotfix deployment evidence.
