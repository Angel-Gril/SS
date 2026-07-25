# Phase 1: Default-Off Security Foundation

Progress: 7/7 tasks.

## Tasks

- [x] `SRV-01` Add BYOK policy/readiness (`P0`, `M`). Acceptance: generation, ingest, and
  publish are separately default-off; decisions bind owner, shop, device, origin, operation,
  and policy revision; failures close; responses contain no secrets.
- [x] `SRV-02` Add dedicated BYOK ingest scope/grant (`P0`, `L`). Acceptance: grant binds
  session, token, owner, shop, workflow, draft version, idempotency key, and request hash;
  old devices do not gain scope automatically; expiry/revocation/transfer fail before write.
- [x] `SRV-03` Add provenance/idempotency persistence (`P0`, `L`). Acceptance: required
  non-secret actor, Provider, content, asset, draft, slot, charge-zero, and publish identities
  persist; keys, Authorization, raw base64, secret URLs, and raw Provider bodies cannot.
- [x] `EXT-01` Implement profile schema/session secret store (`P0`, `L`). Acceptance:
  non-secret profile metadata may persist; key is only in `chrome.storage.session`; endpoint
  change, disconnect, or session clear deletes key and capability evidence.
- [x] `EXT-02` Implement optional permission broker/package rules (`P0`, `L`). Acceptance:
  exact canonical HTTPS origin is requested from a trusted gesture; cloud package has no
  mandatory arbitrary Provider access; invalid/private/disallowed origins cause zero I/O.
- [x] `EXT-03` Extend runtime message authorization (`P0`, `M`). Acceptance: workbench and
  settings senders have explicit allowlists; content/web pages cannot read secrets; keys never
  reach responses, DOM, URLs, logs, local/sync storage, or package output.
- [x] `REL-01` Add admin controls/privacy disclosure (`P0`, `M`). Acceptance: hosted, BYOK
  generation, ingest, and publish are separate; origins/operations/concurrency are
  configurable; all flags default off; Provider data disclosure is visible.

## Parallel Lanes

- Lane A: `SRV-01`, `SRV-02`, `REL-01`.
- Lane B: `SRV-03`.
- Lane C: `EXT-01`, `EXT-02`, `EXT-03`.
- Merge risk: medium; serialize Prisma, grants, config, manifest, and message policy hotspots.

## Notes

- No real Provider call or production ingest is allowed at this phase boundary.
- Persistent API-key storage is explicitly excluded from the first release.
- `SRV-01` completed with strict versioned policy parsing and a fail-closed readiness
  evaluator. RED was a missing service module. GREEN passed 14 policy tests plus server
  typecheck. Decisions bind owner, shop, device session, canonical origin, operation, and
  policy revision; no secret-bearing field is accepted or returned.
- `SRV-03` completed with a closed Zod input contract, owner/idempotency replay and conflict
  handling, a Prisma repository, and a non-secret `ExtensionByokMediaProvenance` model. The
  migration stores only hashes for Provider origin/request, Prompt, source/reference/mask,
  and result; it has no key, Authorization, raw Prompt, URL, base64, or Provider-body field.
  Database checks permanently force `execution_mode = BYOK` and `erp_ai_charge_cents = 0`,
  bind device/actor/shop/workflow/draft/asset authority, and allow publish intent/receipt
  identities to attach only once. Focused tests (25), full server tests (3642 passed),
  temporary-schema Postgres migration/integration tests, build, and repository preflight all
  pass. No real Provider call, production migration, or production mutation occurred.
- `SRV-03` hardening closed the post-review gaps: create inputs cannot attach publish IDs;
  intent/receipt linking is one-shot and database-bound to the same Ozon command, owner,
  shop, workflow, revision, actor, and device session; BYOK provenance references now
  participate in the media-asset immutability trigger; user-controlled identifiers reject
  URL/query/fragment/data/Authorization forms and common raw credential prefixes. Asset
  identity validation takes a `FOR SHARE` lock to serialize concurrent updates. Focused
  tests (36), Prisma validation/typecheck, and isolated migration suites pass.
- `EXT-01` now persists only normalized non-secret profile metadata in local storage. API
  keys are opaque values held only in `chrome.storage.session` inside an endpoint/model
  identity envelope; capability evidence is accepted only with a matching session key,
  exact operation/request mode, non-expired timestamps (maximum seven days), and a current
  profile identity. Endpoint/model rebinding, session clear, and device disconnect clear
  session credentials/evidence. Nine focused tests plus package syntax verification pass.
- `EXT-02` adds a clean-room exact-origin permission broker. It rejects non-HTTPS,
  credentials, query/fragment, private/metadata, trailing-dot, IPv6-literal, and malformed
  hosts before Chrome permission I/O; consumes one native trusted event once; handles
  callback-only and Promise Chrome APIs; and requests only an exact optional origin from
  the click task. Cloud packages keep arbitrary Provider access optional and the verifier
  rejects wildcard-port host/page matches. Eight focused tests, cloud/local builds, and
  package verification pass. The server grant path now evaluates authenticated readiness
  directly; the extension permission path still requires the Phase-2 readiness-handle
  endpoint/adapter before any real permission request or Provider call is enabled.
- `SRV-02` adds the dedicated `BYOK_MEDIA_INGEST` operation and `byok:media:ingest`
  device scope. The scope is absent from default pairing scopes, and the resolver requires
  an authenticated SRV-01 decision whose owner/shop/device/origin/operation context and
  policy revision match. Command identity is bound to the session JTI, shop, workflow,
  draft version, idempotency key, and request hash; the transaction consumer rejects expired,
  revoked, transferred, disabled, or non-Ozon shops before consuming a grant. Enum and
  binding-check migrations are deliberately split so PostgreSQL commits the enum value
  before a constraint references it. Focused SRV-02 tests (29), command-grant/device
  regressions (160), typecheck, Prisma validation, and diff checks pass.
- `REL-01` adds four independent default-off SystemConfig switches for hosted generation,
  BYOK generation, BYOK ingest, and BYOK publish, plus a strict revisioned policy for
  public Provider origins, operations, pilot owner/shop/device IDs, and concurrency. The
  admin AI panel is a collapsed, explicit control surface with data/fee disclosure; it
  never accepts or displays a Provider key. The server loader uses `getStrictConfig` and
  composes the policy into the SRV-01 evaluator, so malformed persisted values fail closed.
  Server route/config tests (including atomic rejection of secret-bearing policy updates),
  UI contract, typecheck, and lint checks pass.
- `EXT-03` adds an exact extension-origin sender matrix for the future AI workbench and
  Provider-settings page. Content scripts, ERP/web pages, legacy settings, and popup pages
  cannot invoke the new channels. A background-only dispatcher validates closed payloads,
  accepts the session key only once from Provider Settings, verifies an authenticated
  owner/device/shop/draft/provider/model/operation/policy binding with a ten-minute handle
  TTL, and sanitizes all handler responses against field-form, prefix, JWT, data-URL, and
  dynamically supplied secret values. No new handler is registered yet, so the path returns
  `HANDLER_UNAVAILABLE` and remains dark. Extension security tests (9), profile (9),
  permission (8), legacy runtime (20), source-workflow (7), package verification, and
  syntax checks pass.
- Final Phase-1 adversarial review closed the remaining trust-boundary gaps before any
  Provider handler was enabled: profile, permission, and runtime origin parsing now reject
  single-label/split-horizon names, reserved suffixes, malformed/Unicode hosts, and private
  aliases consistently; optional permission requests consume only a background-owned,
  synchronously pre-verified readiness bridge plus one trusted gesture; the service worker
  now routes every new message through the dedicated dispatcher and wires the readiness and
  dynamic secret-response guards; public responses reject base64/image-byte fields and raw
  Provider URLs. The provenance migration is transactional with bounded lock and statement
  timeouts. Updated extension security/profile/permission tests pass; all hooks still have
  no operational handler or readiness adapter, so the feature remains fail-closed.
- Phase-1 milestone gates pass: full server suite (327 files, 3705 passed, 161 skipped),
  workspace lint (existing warnings only), recursive typecheck, preflight (0 failures),
  isolated PostgreSQL migration/integration suites including all three new migrations,
  server/web builds, and cloud/local extension package verification. `prisma generate`
  remains blocked on this Windows workstation by the running local server's locked
  `query_engine-windows.dll.node`; no generated client or production database was changed.
- All Phase-1 flags remain default-off. No real Provider request, paid charge, production
  migration, VPS mutation, or deployment occurred.
