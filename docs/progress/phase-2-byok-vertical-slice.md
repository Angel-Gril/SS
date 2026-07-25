# Phase 2: Secure Single-Image BYOK Vertical Slice

Progress: 0/10 tasks.

## Tasks

- [ ] `SRV-04` Build hostile-image normalization/ingest (`P0`, `XL`). Acceptance: bounded
  verified single-frame PNG/JPEG/WebP input is decoded, metadata-stripped, re-encoded, hashed,
  and stored through existing storage; replay returns the same asset.
- [ ] `SRV-05` Bind ingested media to exact draft revision (`P0`, `L`). Acceptance: owner,
  shop, workflow, revision, draft version, SKU, slot, hash, and order are atomic; stale state
  has no partial write; arbitrary external URLs are rejected.
- [ ] `SRV-06` Enforce billing separation (`P0`, `M`). Acceptance: BYOK never creates ERP
  AI cost rows; hosted paid work still requires reservation/settlement; forged modes fail.
- [ ] `EXT-04A` Add background text-to-image client (`P0`, `L`). Acceptance: only the
  background calls `/images/generations`; cookies/redirects are disabled; response bounds,
  URL/base64 handling, no-auth output download, timeout, and unknown outcome are tested.
- [ ] `EXT-05` Store exact capability evidence (`P0`, `M`). Acceptance: evidence binds
  endpoint, model, operation, request mode, policy revision, and time; changes invalidate it;
  text-to-image success does not unlock edits.
- [ ] `UI-01` Build focused Provider settings page (`P1`, `L`). Acceptance: profile,
  endpoint/model, permission, session key, and per-operation probes work; key input clears and
  cannot be revealed; there is no remember-key control.
- [ ] `UI-02A` Build minimal original single-image workbench (`P0`, `L`). Acceptance: a
  trusted launch binds exact product/shop/draft; user can select BYOK, edit Prompt, generate,
  observe truthful state, reject, or accept; injected UI remains a compact launcher.
- [ ] `INT-01` Add background asset ingest client (`P0`, `L`). Acceptance: accepted Blob
  bytes use dedicated grant/hash/idempotency without normal message history or persistent
  bytes; temporary data clears on reject, expiry, and success.
- [ ] `INT-02` Bridge accepted result to current publisher (`P0`, `L`). Acceptance: final
  shop/draft/SKU/order preview and confirmation use existing publish intent, grant, receipt,
  and recovery; duplicate/reload/timeout yields at most one receipt; no Ozon key/direct call.
- [ ] `QA-01` Prove fixture-based vertical closure (`P0`, `XL`). Acceptance: fake Provider
  covers generation through publish; secret/private-host/redirect/bomb/malformed image/
  revocation/cross-shop/stale/duplicate/unknown tests pass; BYOK AI cost rows equal zero.

## Parallel Lanes

- Lane A: `SRV-04`, `SRV-05`, `SRV-06`.
- Lane B: `EXT-04A`, `EXT-05`.
- Lane C: `UI-01`, `UI-02A` against fixtures.
- Lane D: `INT-01`, `INT-02`, `QA-01` after convergence.
- Merge risk: high at integration; hotspot files require a single owner.

## Notes

- Initial runtime is synchronous text-to-image with concurrency `1` and dark flags.
- Real Provider sandbox testing starts only after all `QA-01` gates pass.
