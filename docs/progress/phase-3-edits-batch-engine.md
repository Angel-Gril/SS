# Phase 3: Edit Operations and Batch Engine

Progress: 4/5 tasks.

## Tasks

- [x] `EXT-04B` Add reference/full-edit/inpaint adapters (`P1`, `L`). Acceptance: bounded
  multipart `/images/edits`, references, PNG mask, URL/base64, and explicit async contracts
  work; invalid source/mask dimensions make zero calls; relay dialects remain separate.
- [x] `EXT-06` Build bounded media job engine (`P1`, `L`). Acceptance: capped concurrency,
  pause-after-active, continue, cancel queued, retry/regenerate, alternate preservation, and
  unknown-outcome handling have deterministic tests.
- [x] `EXT-07` Build fact-bound Prompt/SKU slot planner (`P1`, `M`). Acceptance: SKU hero
  and distinct detail roles, overrides, up to four references, stable hash/version, and no
  fabricated product facts.
- [x] `UI-03` Integrate references/full edit/inpaint (`P1`, `L`). Acceptance: users select
  global/per-slot references, edit whole image, draw compatible mask, review alternatives,
  and regenerate a slot; unsupported operations show a concrete disabled reason.
- [ ] `QA-02` Verify exact Provider sandbox capabilities (`P1`, `L`). Acceptance: configured
  relay is tested separately for text-to-image, reference edit, full edit, inpaint, and async;
  evidence stays operation-specific and does not enable production rollout.

## Parallel Lanes

- Lane A: `EXT-04B` and capability evidence updates.
- Lane B: `EXT-06`, `EXT-07`.
- Lane C: `UI-03` against fixture adapters.
- Merge risk: low to medium; new focused modules and existing mask imports are required.

## Notes

- Provider retry can incur an external charge and must never be described as free.
- Text-to-image success alone is insufficient evidence for any edit operation.
- `EXT-04B` uses a strict OpenAI-compatible synchronous multipart adapter for production
  wiring and keeps the explicit asynchronous task dialect isolated as a fixture-only adapter.
  Reference generation accepts one to four bounded images; full edit accepts exactly one
  source; inpaint accepts one source plus a same-size PNG mask converted from the internal
  white-edit convention to Provider alpha semantics.
- Input and output PNG/JPEG/WebP bytes are inspected for MIME, magic, dimensions, pixels,
  animation, and byte limits. Multipart requests have a 50 MiB aggregate limit, malformed or
  oversized streamed responses fail closed, and result URLs never receive Provider
  Authorization.
- Provider permission and credential revision are revalidated before every authenticated
  async poll, before result materialization, and before result acceptance. A dispatched
  timeout remains `UNKNOWN_OUTCOME`, preserves accepted request/task hashes, and cannot be
  blindly resubmitted under the same idempotency key.
- Focused edit/profile/settings/runtime tests passed `106/106`; repository lint, workspace
  typecheck, preflight, cloud/local extension builds, and package verification passed. Package
  verification reported `323` passes, `0` failures, and the two existing local-package
  permission warnings. No real Provider request, ERP AI charge, Ozon write, production
  mutation, VPS deployment, or default-on flag occurred.
- `EXT-07` creates stable versioned plans for one hero per selected SKU and distinct detail
  roles per conservative compatibility group. Prompts quote verified facts as inert data,
  preserve explicit negative guidance, bind every user override and ordered reference set to
  per-slot hashes, and cap plans at `50` selected SKUs, `500` slots, and four references per
  slot.
- Source facts, compatibility groups, and the closed hashed reference catalog are bound to a
  computed authority hash that must be approved again by an injected trusted ERP verifier on
  create, revise, and integrity verification. Evidence identifiers reject URL- and
  secret-like values. Production wiring must inject that verifier from the extension
  background or another trusted controller; the test echo verifier is fixture-only and must
  never be accepted from a page or runtime payload.
- Prompt planner tests passed `13/13`, including forged/revoked authority, recomputed-hash
  Prompt tampering, incompatible SKU references, missing-fact non-fabrication, closed nested
  objects, stable canonical hashes, and plan-size limits. No Provider request or production
  mutation occurred.
- `EXT-06` provides deterministic FIFO scheduling with effective concurrency capped by the
  requested value, authenticated server readiness authority, actual runner/Provider limit,
  and shared contract. Readiness attestation is now strict `v3`; its frozen, non-enumerable
  concurrency authority remains available only to a background coordinator while page
  projections keep the previous public shape.
- Pause-after-active, continue, queued cancellation, per-slot retry/regenerate fencing,
  immutable intent hashes, actual Provider request hashes, opaque dispatch references,
  distinct `WAITING` and `UNKNOWN_OUTCOME` states, trusted lookup recovery, stable-idempotency
  recovery, duplicate-charge confirmation, and concurrent recovery serialization are covered
  by deterministic tests. Once an async Provider accepts work, an unproved later error cannot
  be downgraded to an ordinary retryable failure.
- Selected and approved result bytes are protected from capacity eviction. The `16`-entry /
  `50 MiB` vault plans evictions atomically, applies backpressure without partial alternate
  loss, and automatically pauses new Provider scheduling when full. Its existing ten-minute
  hard TTL remains unchanged so the current single-image UI and public `expiresAt` stay
  truthful. A retained-until-switch/reject/ingest lifecycle for batches longer than that TTL
  is explicitly deferred to `BYOK-01` with the batch coordinator and matching UI state.
- Media job engine tests passed `20/20`; readiness/policy tests passed `22/22`; permission
  tests passed `13/13`; vault/cache/readiness tests, lint, workspace typecheck, server tests,
  preflight, cloud/local builds, and package verification passed. No real Provider request,
  ERP AI charge, Ozon write, production mutation, VPS deployment, or default-on flag occurred.
- `UI-03` adds global and per-slot reference selection, whole-image editing, keyboard and
  pointer mask drawing, stable alternative review, per-slot regeneration, and concrete
  operation-disabled reasons to the extension-origin workbench. Source, reference, mask, and
  preview bytes cross page/background boundaries only through one-use `BroadcastChannel`
  tickets; normal runtime messages contain opaque handles and redacted metadata only.
- Text generation and editing are mutually exclusive in the background. Both paths share one
  authenticated device semaphore, unresolved external-charge markers survive worker restart,
  and reset/regeneration requires the exact `external-provider-charge/v1` acknowledgement.
  Ambiguous reference synchronization retains bytes and blocks dispatch until the exact target
  is reconciled.
- UI-03 focused tests passed `68/68`. The legacy text-to-image vertical fixture was updated to
  prove the existing path uses and releases the shared Provider semaphore without weakening
  runtime dependency checks. Repository lint, workspace typecheck, `3861` server tests,
  preflight, cloud/local builds, and source/cloud/local package verification passed; package
  verification reported `354/358/354` passes with `0` failures.
- Real Chrome `150.0.7871.46` QA passed at `390x844`, `768x900`, `1024x768`, and `1440x900`:
  horizontal overflow and offending elements were zero, portrait image/canvas delta was `0px`,
  landscape delta was at most `0.671875px`, keyboard mask drawing worked, and asynchronous
  alternatives preserved focus and DOM identity. A discovered `481px` selected-preview shift
  and `5px` thumbnail shift were fixed with reserved preview geometry and stable block-level
  media; repeat measurements were `0px` position and size change. No external request occurred.
- No real Provider request, external charge, ERP ingest, Ozon write, production flag change,
  production mutation, VPS deployment, or `.context/` staging occurred during `UI-03`.
- `QA-02` preparation now requires a private canonical closed-schema `v2` one-request approval file.
  Its reviewed SHA-256 is checked before DNS resolution or intent creation, and the exact HTTPS
  endpoint/model/operation, request profile, credential/deployed adapter revisions, source/mask
  hashes, quoted/maximum cost, and billing evidence references must match. `approvedAt`/`expiresAt`
  must be canonical ISO timestamps with a positive validity window no longer than 60 minutes;
  invalid UTF-8, duplicate keys, unsupported fields, file growth/change, expiry, and excessive
  future skew fail closed.
- The operator can now run `sandbox:ai-image:approval:verify` before injecting a Key or paid
  confirmation. It verifies the exact deployed revision, source/mask bytes, approval digest/schema,
  endpoint/model/operation/profile, revisions, costs, validity window, and billing references, but
  rejects an environment containing either submit secret. The path performs zero DNS lookups,
  creates no intent/fingerprint, and sends no Provider request. Freshness is rechecked after DNS,
  at the immutable claim, before Provider execution, and at both generation/edit POST boundaries.
- The immutable request schema rejects unknown or secret-bearing fields. Replay identity now binds
  only Provider transport semantics, so changing approval metadata, profile labels, dimensions,
  Operation ID, credential revision, or adapter revision cannot authorize the same paid POST again.
  Git code binding fails closed on marker/HEAD drift, dirty tracked files, or Git errors; Git runs
  with a minimal environment and hooks/fsmonitor/submodule recursion disabled.
- Approval/runner/guard focused tests passed `66/66`; the static single-submit contract, sandbox
  TypeScript compilation, repository lint (existing warnings only), workspace typecheck, and full
  preflight passed. Preflight reported `445` passes, `0` failures, and the two expected local-package
  permission warnings. `QA-02` remains open because no edit-capable endpoint/model and no explicitly
  approved paid request exist. No Provider request, charge, production mutation, VPS access,
  deployment, or `.context/` staging occurred.
- Post-call billing is now a separate immutable overlay created only by the network-free
  `sandbox:ai-image:billing:finalize` command. Submit reports are v3 with absolute start/completion
  timestamps while their `actualCostCents` remains `null`; the finalizer never edits the v2 intent or
  v3 report. It derives artifacts from one private evidence root and Operation ID, recomputes the
  transport fingerprint, verifies private before/settled snapshot bytes and digests, binds the
  approval and request chronology, and rejects pre-dispatch or cross-artifact evidence.
- Billing claims are append-only and concurrency-safe. Exact replay returns the first immutable
  receipt across compatible finalizer revisions; changed decisions conflict. `CHARGED` requires a
  positive settled cost, `NO_CHARGE` requires zero, over-maximum cost is retained as
  `COST_LIMIT_EXCEEDED`, and billing settlement never turns `RECONCILIATION_REQUIRED` into success or
  permits the same request to be retried.
- Snapshot distinctness is proven with canonical paths and bigint device/inode identities. Output
  creation rejects linked parents before mutation, retains one verified private directory identity
  throughout the write, and uses descriptor-relative paths on Linux. A finalizer revision that did
  not own the claim can only byte-verify and return the existing receipt; it never enters a write
  path.
- Git binding now proves each paid CLI/security module in a Git checkout is tracked and
  byte-identical to the bound revision and rechecks HEAD after worktree inspection. Official CLIs
  reject marker-only release archives; VPS execution requires a private checkout of the deployed
  revision. Focused
  approval/runner/guard/billing tests passed `95` with one Windows-only POSIX mode/symlink test
  skipped. The static contract, sandbox
  TypeScript compilation, repository lint (existing warnings only), workspace typecheck, and full
  preflight passed; preflight reported `445` passes, `0` failures, and the two expected local-package
  permission warnings. `QA-02` remains open; no real Provider request, charge, production mutation,
  VPS access, deployment, or `.context/` staging occurred.
- A separate `sandbox:ai-image:approval:draft` command now creates one private canonical `v2`
  near-final record from the exact non-secret endpoint/model/operation/profile, deployed revision,
  pinned source/mask bytes, billing references, and bounded cost proposal. It rejects API keys,
  paid confirmation, Authorization, existing approval configuration, unsafe endpoints/media, dirty
  or unverifiable code, non-private parents, and existing output paths before any write. It performs
  no DNS, Provider, intent, or fingerprint operation.
- The draft contains independent non-authority sentinels for `statement`, `approvedAt`, and
  `expiresAt`; the production approval loader rejects it until a human reviews every bound field and
  manually replaces only those three values. Writes are exclusive and durable, verify persisted
  bytes, use private POSIX modes, and recheck bigint parent/leaf identities. Draft/approval/runner/
  guard/billing focused tests passed `114` with one Windows-only POSIX boundary test skipped; the
  static contract, sandbox TypeScript compilation, repository lint (existing warnings only),
  workspace typecheck, full server tests, and preflight passed. Preflight reported `445` passes,
  `0` failures, and the two expected local-package permission warnings. `QA-02` remains `4/5` and
  open because no edit-capable endpoint/model or explicitly approved paid request exists. No real
  Provider request, charge, production mutation, VPS access, deployment, or `.context/` staging
  occurred.
- Additional offline hardening keeps Linux approval-draft creation, persisted-byte verification,
  leaf inspection, and durability sync bound to one held private parent descriptor; a visible parent
  swap cannot redirect the draft and fails the final identity check. The billing finalizer now also
  syncs its held output-directory descriptor and rechecks the visible path and descriptor identity
  after that sync. Non-Linux draft creation retains canonical path and before/after identity checks
  under the local ACL trust boundary.
- Draft and Provider edit limits now derive from the versioned shared workbench contract, including
  the `50 MiB` aggregate source-plus-mask limit for `INPAINT`. OpenAI-compatible URL normalization
  and `AiImageJobError` identity live in network-free leaf modules, so offline draft generation does
  not load DNS or the Provider stack while existing imports retain one error constructor identity.
  Focused draft/URL/Provider/billing/single-submit tests passed `158` with two platform-specific
  skips; full server tests passed `4364` with `190` skipped. The static contract, sandbox TypeScript
  compilation, repository lint (existing warnings only), workspace typecheck, diff check, and full
  preflight passed; preflight reported `445` passes, `0` failures, and the two expected local-package
  permission warnings. Independent review found no P0/P1 issue. `QA-02` remains open and all rollout
  flags remain default-off; no Provider request, charge, production mutation, VPS access,
  deployment, or `.context/` staging occurred.
- Approval drafting and exact-request preflight now share one no-follow, descriptor-bounded media
  verifier. It pins SHA-256, verifies PNG/JPEG/WebP decode, dimensions, pixels and single-page state,
  checks meaningful PNG mask alpha, and rejects an over-limit `INPAINT` mask before reading its
  bytes. This closes the prior gap where a manually assembled approval could reach preflight without
  the draft command's full hostile-media checks.
- Linux paid-request claims now hold both the `intents` and descriptor-relative `.fingerprints`
  directories through claim, intent, durability sync and final identity verification. Parent or
  child replacement cannot silently redirect an artifact into a replacement path; the command
  returns `SANDBOX_EVIDENCE_DIRECTORY_CHANGED` before Provider dispatch. Hostile-media regression
  tests cover non-images, animated WebP, read-time growth and invalid mask alpha, while Linux-only
  tests cover final-entry symlinks and independent parent/child replacement. Focused tests passed
  `197` with six platform/environment-specific skips; full server tests passed `4371` with `194`
  skipped. The static contract, sandbox TypeScript compilation, repository lint (existing warnings
  only), workspace typecheck, diff check and full preflight passed; preflight reported `445` passes,
  `0` failures and the two expected local-package permission warnings. Independent reviews found no
  P0/P1 issue. `QA-02` remains open at `4/5`, all rollout flags remain default-off, and no Provider
  request, charge, production mutation, VPS access, deployment, or `.context/` staging occurred.
- The first isolated Linux execution exposed a test-injection defect rather than a production
  defect: the child-open hook matched an earlier ordinary `.fingerprints` durability open, so the
  intended post-parent-descriptor swap never occurred. The hook now matches only
  `/proc/self/fd/<fd>/.fingerprints`. A Docker Linux image built from the clean `8ac06a8` Git archive
  and supplied only that corrected test file read-only passed both filesystem/media files `8/8`
  with `--network none`. This provides real Linux coverage for parent replacement, child replacement,
  orphan fail-closed claims, final-entry symlinks, hostile media and mask semantics. Production code,
  rollout flags and task counts remain unchanged; no Provider request or external charge occurred.
- A 2026-07-29 sanitized production audit found both VPS deployments at `c98a2e4`. International had
  the third-party relay persisted under the legacy `openai-images` label with `gpt-image-2`, a
  configured credential, zero cost, generation off and every AI media/extension rollout flag off;
  domestic remained disabled without a credential. One bounded authenticated model-catalog GET
  returned HTTP 200 with only `gpt-image-2`, so there is no untested edit candidate on that account.
  It made no generations/edits call and incurred no image charge.
- RED tests then proved a legacy v1 runtime contract could previously pair the same relay URL with
  the misleading official Provider identity. The network-free runtime contract now permits
  `openai-images` only for the canonical official API and requires relays to use `custom`.
  Generation and edit worker regressions manually construct the legacy same-relay contract and prove
  it fails before Provider resolution; suite readiness also returns `PROVIDER_CONFIG_INVALID` even
  with injected sandbox evidence. Related focused tests passed `138/138`. `QA-02` remains open and
  task counts remain `4/5` and `32/37`; a different edit-capable endpoint/model plus explicit
  one-request approval is still required.
- Full regression testing exposed one error-classification issue for an existing paid workflow whose
  active endpoint no longer matched its frozen quote. Quote reconstruction failures in that replay
  path now remain `MEDIA_PROVIDER_CONFIG_CHANGED` and cannot enqueue work; the focused launch suite
  passed `83/83`. Repository lint passed with `20` existing warnings and no errors, workspace
  typecheck passed, full server tests passed `4376` with `194` skipped, and preflight passed `445`
  checks with no failures and the two expected local-package permission warnings.
- The official bare origin now canonicalizes to the effective `/v1` transport. A v1 contract frozen
  by older code from the bare-origin text has the old hash and deliberately fails closed; the
  operator must reconcile any associated reservation and recreate the work rather than retry it.
  Common `/v1` contracts retain their hash. All paid media flags remain off, and these gates made no
  Provider request, charge, production mutation, deployment, flag change, or `.context/` staging.
- Capability evidence can no longer authorize a whole provider/model entry by label alone. Exact
  `sandboxEvidence` records bind canonical endpoint SHA-256, operation, input transport, and result
  mode. Generation, reference generation, full edit, inpaint, translation, and paid-suite execution
  check the active request against those fields before Provider dispatch. Text-to-image evidence
  therefore cannot unlock an edit operation, and evidence from one relay cannot unlock another.
- The provider foundation contract rejects wildcard, malformed, duplicate, or operation-incomplete
  verified evidence. Accepted asynchronous translation tasks preserve their poll-only recovery even
  if the current Registry is later tightened. Focused capability/worker/suite tests passed `87/87`,
  Server typecheck and the Provider contract passed. Repository lint passed with `20` existing
  warnings and no errors, workspace typecheck passed, full Server tests passed `4383` with `194`
  skipped, and preflight passed `445` checks with no failures and the two expected local-package
  permission warnings. Task counts remain `4/5` and `32/37`, and no Provider call, charge,
  production mutation, VPS access, deployment, flag change, or `.context/` staging occurred.
- The newly supplied custom relay candidate exposed a real bare-Base compatibility gap before any
  paid call: server runtime identity already used the effective `/v1` transport while extension
  profiles and older frozen custom contracts could retain the raw origin or prefix. Server and
  extension now share one strict HTTPS multi-label-DNS API-Base contract, append `/v1` to a bare
  origin or custom prefix, reject operation paths and ambiguous encodings/separators, and reject IP
  literals, single-label hosts, trailing dots, userinfo, query/fragment and dot segments. Existing
  legacy custom runtime hashes fail closed before Provider resolution and must be recreated rather
  than retried.
- Extension profile upgrade now performs a serialized fail-closed migration before any public or
  background use. When canonical identity changes, it invalidates generated-result authority,
  physically removes that profile's session Key, capability evidence, uncertain probes and Provider
  dispatches, then writes canonical metadata; cleanup failure exposes neither the migrated profile
  authority nor a rebound secret. Rollback and concurrent-reader regressions prove old authority
  cannot revive.
- Direct sandbox output no longer overloads one endpoint digest. Approval verification is v2 and new
  submit reports are v4 with explicit `apiBaseSha256` for Registry promotion and
  `operationEndpointSha256` for the exact guarded POST. Billing finalization reads historical v3
  reports without reinterpreting their operation-endpoint hash and emits a dual-hash v2 receipt for
  v4. Intent, fingerprint and replay identity remain unchanged. Combined focused tests passed
  `246` Server checks with one Windows skip plus `95` extension checks; full Server tests passed
  `4422` with `194` skipped, lint had `0` errors and `20` existing warnings, workspace typecheck
  passed, preflight passed `445/0`, and cloud/local package verification passed `449/0/0` and
  `445/2/0` at build version `1.0.264`. Independent review found no P0/P1 issue.
- The candidate's authenticated read-only model catalogue returned HTTP 200 and listed only the
  exact `gpt-image-2-count` alias. The Key is retained only in a private DPAPI file outside the
  repository, and private catalogue/billing snapshots remain outside Git. Read-only billing checks
  established the paired quota/usage meters needed for settlement without making a Provider POST.
- International sandbox costs now use closed exact-money objects (`currency`, integer `amount`,
  integer `scale`) without changing the ERP production billing domain. New approval v3, intent v3,
  submit report v5, billing attestation v2 and receipt v3 artifacts preserve `CNY 0.0119` exactly;
  legacy cents approval/intent/report/attestation/receipt generations remain readable but cannot be
  mixed with exact evidence. Exact intent/report evidence independently binds the API Base and
  operation-endpoint hashes, and settlement requires both raw-quota and displayed-usage deltas to
  prove the same actual cost. Canonical parsing rejects exponent/hex/decimal-string legacy cents,
  over-limit costs and cross-generation approvals before DNS or dispatch.
- Focused exact-money tests passed `166` with two platform-specific skips. The static contract,
  sandbox TypeScript compilation, diff check, repository lint (`20` existing warnings, no errors),
  workspace typecheck, full Server tests (`4468` passed, `194` skipped), and a clean full preflight
  rerun passed. Cloud/local/source package verification passed `449/0/0`, `445/2/0`, and `445/2/0`
  at build version `1.0.264`.
- `QA-02` remains open at `4/5` and overall progress remains `32/37`. The exact alias still lacks a
  retained authenticated pricing artifact for each intended operation/account configuration, and
  the operator has not explicitly approved one maximum cost. This work made no Provider POST,
  charge, production mutation, VPS access, deployment, flag change, or `.context/` staging.
