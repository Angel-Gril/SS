# Phase 3: Shop, Billing, Publish

- [x] D3.1 Replace donor store manager with device-grant shop projection.
- [ ] D3.2 Add quote/reservation/settlement projection.
- [ ] D3.3 Wire controlled Ozon publish through SS ERP receipts.

## Current Slice

- The donor store selector contains only `{id,name,status}` rows returned by `SS_ERP_EXTENSION_DEVICE_SHOPS`; store credentials, Ozon client IDs and account authority never enter the iframe.
- The donor bridge sets `deviceOnly:true` on its shop read. A healthy package uses the device-scoped route; if that reader is missing or rejects the session, the new workbench fails closed and never falls back to the legacy account-equivalent token branch. Existing popup/settings compatibility callers remain unchanged.
- Draft creation still sends only the selected projected shop ID, snapshot and selected source SKU keys. The device transport and server recheck owner, active grant, shop membership, scopes and draft facts before mutation.
- Focused donor shell, logistics scoped-auth and unpacked MV3 acceptance pass. Provider requests, Ozon writes and production mutations remain zero.

## Remaining

- `D3.2`: project truthful hosted quote/reservation/settlement state while keeping billing IDs and ledgers server-owned.
- `D3.3`: surface only the existing publisher preview/confirmation/recovery receipts; do not add a browser-side Ozon writer.
