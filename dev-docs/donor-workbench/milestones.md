# Donor Migration Milestones

## M0: Safe Owner

`CREATE_DRAFT` is a device-scoped, idempotent, server-owned command with RED/GREEN tests. No UI cutover.

## M1: Donor Shell

The donor-style full-screen workbench opens from a source page, renders a real capture projection, and contains no direct third-party credentials or writes.

## M2: End-to-End Draft Media

One source item can create a draft, select SKU/category, execute approved media, review and apply through existing SS ERP contracts.

## M3: Operational Readiness

Shop grants, cost/settlement projections, rollback and publish receipts are visible in the same workbench.

## M4: Controlled Cutover

Cloud/local packages pass verifier, an allowlist browser canary passes, and source-page entrypoint switches with rollback evidence.
