# Donor Migration Task Breakdown

## Phase 0: Foundation and Safety

- P0/M: `D0.1` Freeze donor inventory and forbidden module list. Acceptance: inventory and risk docs exist; donor source is read-only.
- P0/M: `D0.2` Add extension-device `CREATE_DRAFT` command owner. Acceptance: write scope, shop grant, feature gate, snapshot/SKU ownership, idempotency and sanitized summary tests pass.
- P0/S: `D0.3` Add listing client/worker message wiring for `CREATE_DRAFT`. Acceptance: strict request/response contract and no caller-owned IDs.

## Phase 1: Donor Workbench Shell

- P0/L: `D1.1` Add sanitized donor iframe shell and source-page bridge beside current panel. Acceptance: one marketplace tab opens the donor-style workspace and receives source capture data without external URL input.
- P0/L: `D1.2` Port donor state/stage/process presentation with SS ERP adapters. Acceptance: collection, draft, category, media and review stages render from server projections; no donor secrets/direct API code ships.
- P1/M: `D1.3` Port donor image manager/prompt JSON presentation. Acceptance: source/reference selection, prompt preview and queue state are projection-only until server command confirmation.

## Phase 2: Draft and Media Parity

- P0/L: `D2.1` Implement extension-side draft creation and selected SKU flow using `CREATE_DRAFT`.
- P0/L: `D2.2` Replace donor generation runner with hosted/BYOK SS ERP workbench adapters.
- P0/L: `D2.3` Port review/apply/assignment UX and exact replay handling.
- P1/M: `D2.4` Port donor process console/pause/recovery UI over command receipts.

## Phase 3: Shop, Billing, Publish

- P0/M: `D3.1` Replace donor store manager with device-grant shop projection and server-side shop selection.
- P0/M: `D3.2` Add quote/reservation/settlement projection and truthful billing states.
- P0/M: `D3.3` Wire controlled Ozon publish only through SS ERP publisher receipt/reconciliation.

## Phase 4: Release and Cutover

- P0/M: `D4.1` Add donor-based package verifier/security regression suite.
- P0/M: `D4.2` Canary the new workbench behind a default-off/allowlist rollout.
- P0/S: `D4.3` Cut source-page entrypoint after independent browser evidence; retain rollback to current workbench.

Parallel lanes: Phase 0 has documentation/inventory and server owner lanes; Phase 1 UI port and adapter contracts can run in separate worktrees after D0.2/D0.3. Draft/media, billing and publish remain serialized around shared server contracts.
