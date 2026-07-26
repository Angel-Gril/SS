# Phase 2: Secure Single-Image BYOK Vertical Slice

Progress: 7/10 tasks.

## Tasks

- [x] `SRV-04` Build hostile-image normalization/ingest (`P0`, `XL`). Acceptance: bounded
  verified single-frame PNG/JPEG/WebP input is decoded, metadata-stripped, re-encoded, hashed,
  and stored through existing storage; replay returns the same asset.
- [x] `SRV-05` Bind ingested media to exact draft revision (`P0`, `L`). Acceptance: owner,
  shop, workflow, revision, draft version, SKU, slot, hash, and order are atomic; stale state
  has no partial write; arbitrary external URLs are rejected.
- [x] `SRV-06` Enforce billing separation (`P0`, `M`). Acceptance: BYOK never creates ERP
  AI cost rows; hosted paid work still requires reservation/settlement; forged modes fail.
- [x] `EXT-04A` Add background text-to-image client (`P0`, `L`). Acceptance: only the
  background calls `/images/generations`; cookies/redirects are disabled; response bounds,
  URL/base64 handling, no-auth output download, timeout, and unknown outcome are tested.
- [x] `EXT-05` Store exact capability evidence (`P0`, `M`). Acceptance: evidence binds
  endpoint, model, operation, request mode, policy revision, and time; changes invalidate it;
  text-to-image success does not unlock edits.
- [x] `UI-01` Build focused Provider settings page (`P1`, `L`). Acceptance: profile,
  endpoint/model, permission, session key, and every currently implemented operation probe
  work; deferred edit/inpaint operations remain explicitly closed until `EXT-04B`; key input
  clears and cannot be revealed; there is no remember-key control.
- [x] `UI-02A` Build minimal original single-image workbench (`P0`, `L`). Acceptance: a
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
- `SRV-04` now exposes the device-scoped raw PNG/JPEG/WebP ingest route, re-evaluates the
  same live command resolver used at grant issuance, normalizes hostile bytes, uses only
  ERP-owned local/OSS/R2 storage, and commits asset/provenance/receipt atomically.
- `EXT-04A` now runs only in the background worker with exact-origin permission, bounded
  Provider/result reads, no-auth result download, unknown-outcome handling, and an in-memory
  Blob vault; runtime responses contain only redacted hashes and identifiers.
- `EXT-05` now requires endpoint/model/operation/request-mode/policy-revision evidence before
  generation. A dedicated probe records 24-hour evidence and immediately releases probe bytes.
  Authenticated readiness attestations become maximum-ten-minute, one-use in-memory handles.
- `SRV-05` now commits grant consumption, normalized ERP-owned media, the immediate immutable
  draft successor, exact SKU/slot/order binding, zero-charge provenance, and receipt completion
  in one serializable transaction. PostgreSQL verifies the source/bound draft transition and
  allows later publish intent binding only while the exact assignment remains present.
- `SRV-06` fixes hosted jobs to `ERP_HOSTED` and BYOK provenance to `BYOK` at the database
  boundary. Paid dispatch requires the exact live `RESERVED` reservation, and paid success
  requires its matching append-only charge settlement. PostgreSQL tests prove a forged BYOK
  label cannot bypass hosted billing and exact BYOK replay creates zero cost rows.
- `UI-01` now provides named profiles, session-only key loading, exact-origin grant/revoke,
  device/shop readiness, and exact text-to-image capability evidence. Prepared permission
  tickets are globally one-use, stale async tickets are discarded, device-session changes
  clear every redacted secret/evidence state, and expired or policy-mismatched evidence is not
  shown as valid. Edit and inpaint probes remain visibly disabled because their Provider
  adapters belong to Phase 3 `EXT-04B`.
- UI fixture QA passed at 1280px and 390px with no horizontal overflow or console errors. The
  trusted click requested only `https://relay.example/*`; a secret sentinel was absent from
  DOM, URL, local storage, and session storage after the key field cleared.
- Final foundation review made upload cleanup durable against returned-key and storage-namespace
  drift, records every authorized ingest request in a database-time per-device limiter before
  body parsing, and requires live `byok:media:ingest`/`listing:publish` scopes at publish time.
- Normal Provider dispatch now writes a bounded session tombstone before POST, fails corrupt
  tombstone state closed, and cannot repeat the same request after an MV3 worker restart.
  Successful Provider request IDs are reduced to SHA-256 before vault, ingest, or provenance.
- Provider consent is committed only by the background authority. Page grants require a real
  trusted click, then a one-use ticket, live ERP readiness, exact Chrome permission, and consent
  epoch; concurrent grants merge and device cleanup wins over late page finalization.
- Final verification passed 117 extension BYOK/runtime tests, 184 focused server BYOK tests,
  3,800 full server tests, all 140 PostgreSQL migrations plus the populated historical upgrade,
  workspace lint/typecheck, preflight, and rebuilt cloud/local package verification. Cloud
  verification completed with zero warnings; local retained its two expected packaging warnings.
- Remaining non-blocking Phase 2 debt: terminal upload-staging rows need a retention/prune path;
  publish intent/receipt provenance linking belongs to `INT-02`; and the 100-entry session
  dispatch-tombstone limit needs workbench capacity guidance before a production pilot.
- `UI-02A` now launches only from an exact supported source-product page, re-resolves the latest
  source snapshot and server-authoritative empty SKU hero slot before every operation, and keeps
  product/draft/Provider context out of the URL. The standalone extension page supports one BYOK
  text-to-image request, one-use Blob preview, reject, and local approval while truthfully keeping
  ERP ingest, draft binding, hosted execution, and publishing closed.
- Workbench sessions bind tab and document identity in `chrome.storage.session`. An unresolved
  Provider outcome survives refresh and worker restart without exposing its idempotency key, blocks
  another paid request, and is cleared only by authoritative result attachment or a proven
  pre-dispatch failure. Concurrent generate/review attempts, stale preview events, malformed review
  responses, document replacement, stale captures, and the unrepresentable 500th append ordinal
  fail closed with temporary bytes released where available. Claim and Provider dispatch renew a
  live sliding lease, so a near-expiry paid request can still attach its result while an already
  expired session cannot be revived.
- Final `UI-02A` verification passed 58 focused extension tests, 7 readiness route tests, server
  typecheck, full preflight (3,968 server tests: 3,804 passed and 164 skipped), rebuilt cloud/local
  packages, and package verification. Cloud completed with zero warnings; local retained its two
  expected offline-package permission warnings. Two first-pass timing flakes were hardened by
  asserting one upload winner plus one replay without depending on Promise arrival order and by
  giving the native ESM child-process case a 15-second outer test budget. Their focused suites and
  the complete preflight then passed.
- All BYOK flags and the administrator policy remain default-off. No real Provider request,
  ERP AI charge, production mutation, Ozon write, or VPS deployment occurred in this phase.
