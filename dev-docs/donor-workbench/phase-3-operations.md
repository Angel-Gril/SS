# Phase 3: Shop, Billing, Publish

- [x] D3.1 Replace donor store manager with device-grant shop projection.
- [x] D3.2 Add quote/reservation/settlement projection.
- [ ] D3.3 Wire controlled Ozon publish through SS ERP receipts.

## Current Slice

- The donor store selector contains only `{id,name,status}` rows returned by `SS_ERP_EXTENSION_DEVICE_SHOPS`; store credentials, Ozon client IDs and account authority never enter the iframe.
- The donor bridge sets `deviceOnly:true` on its shop read. A healthy package uses the device-scoped route; if that reader is missing or rejects the session, the new workbench fails closed and never falls back to the legacy account-equivalent token branch. Existing popup/settings compatibility callers remain unchanged.
- Draft creation still sends only the selected projected shop ID, snapshot and selected source SKU keys. The device transport and server recheck owner, active grant, shop membership, scopes and draft facts before mutation.
- Focused donor shell, logistics scoped-auth and unpacked MV3 acceptance pass. Provider requests, Ozon writes and production mutations remain zero.
- The suite projection owner now emits a closed billing summary per slot: execution mode, quote currency/minor units, frozen estimated/maximum amounts, reservation status and the latest settlement kind/actual amount/billed units. Repository reads do not select reservation or settlement IDs for this surface.
- `SETTLED` requires a charge settlement, `RELEASED` requires a release settlement, and reservation currency/amounts must equal the frozen slot quote. Drift fails as stale context. Extension wire validators accept the additive v1 field but reject extra IDs; the hosted command adapter validates then intentionally omits billing from command/workspace state.
- The donor bridge reads billing through the existing authoritative suite GET and keeps the raw response content-script private. The iframe receives only the current listing-bound quote and per-slot summaries. ERP-hosted shows estimated/maximum and settled/released states; “自带 API Key” shows ERP generation charge `0.00` and leaves Provider billing to that account.
- Full preflight passes with Server `6339 passed / 325 skipped` and extension verifier `475/475`; isolated desktop/mobile Chromium and unpacked MV3 remain free of Provider, Ozon and production I/O.

## Remaining

- `D3.3`: surface only the existing publisher preview/confirmation/recovery receipts; do not add a browser-side Ozon writer.
