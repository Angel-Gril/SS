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
- `QA-02` remains open at `4/5` and overall progress remains `32/37`. The Provider does not expose
  a retained account-specific price record for the alias, but QA-02 does not require live Provider
  pricing sync. A private, versioned backend price/limit policy must bind each exact proposed
  operation/profile and the operator must explicitly approve one single-request maximum. The
  exact-money implementation made no Provider POST or image charge.
- Commit `9e7c8140a17592b76be4b219332f65b58d18cb3f` was pushed and dark-deployed to both app-dir
  VPS targets. International retained a readable approximately 36 MB database backup at
  `/var/backups/ss-erp/ss_erp_20260730_053537.sql.gz`; domestic retained an 8.2 MB backup at
  `/var/backups/ss-erp/ss_erp_20260730_134042.sql.gz`. Both applied the eight pending migrations and
  passed the database guard, runtime upload checks, active service checks, local/public readiness,
  clean-log checks and AI Media dark-state verification. Domestic also passed direct-origin HTTPS,
  certificate, ACME and unknown Host rejection checks for `ss-erp.cn`, `www.ss-erp.cn`,
  `app.ss-erp.cn` and `admin.ss-erp.cn`. Each full verifier returned zero failures and one warning
  for local-only backup retention. All AI/Ozon rollout flags remain off; the authorized deployment
  and schema migration made no Provider POST, image charge, ERP AI generation, media ingest or Ozon
  write, and `.context/` was not staged.
- International now has a deploy-owned mode-`0700` private sandbox checkout at
  `/opt/ss-erp/private/ai-image-sandbox/checkouts/9e7c8140a17592b76be4b219332f65b58d18cb3f`.
  Its exact HEAD, required paid-CLI Git blobs and tracked-worktree cleanliness were verified; frozen
  dependencies were installed and the sandbox TypeScript configuration passed. The ignored checkout
  evidence link resolves to `/opt/ss-erp/shared/ai-image-sandbox`, which remains `deploy:deploy` mode
  `0700`. No Key or private account artifact was transferred, and no Provider command ran.
- The operator then explicitly approved exactly one `TEXT_TO_IMAGE` request for
  `gpt-image-2-count`, profile `OPENAI_SQUARE_SINGLE_V1`, `1024x1024`, `n=1`, with both quote and
  single-request maximum set to exact `CNY amount=119 scale=4` (`CNY 0.0119`). Operation
  `qa02-t2i-20260730-063129-01` made one Provider POST and was not retried. It completed
  `SUCCEEDED` with one 1024x1024 PNG (1,085,256 bytes, SHA-256
  `481527b89ed2e3da85ea1517a10d6227d89c0d17271c92950a98f51a7e044f0b`). Manual review found the
  requested plain white ceramic mug on a light-gray background with no text, logo, watermark or
  extra object.
- Private before/after account snapshots proved a raw quota delta of `5950` and a displayed usage
  delta of `1.19`; both resolve to exact `CNY 0.0119`. Because the Relay billing-log request ID is
  distinct from the upstream response ID, finalizer commit
  `5f6d3dd8ccac5e060189bec427400cc06c3a97ec` added fail-closed attestation v3 correlation to exactly
  one authenticated Token-log entry plus a globally unique append-only entry claim. Independent
  security review found and closed an isolated-claim recovery gap by binding that claim to the exact
  attestation digest. Focused billing tests passed `51` with one Windows skip; lint, the static
  contract, sandbox/Server typechecks, `git diff --check`, full preflight (`445/0` with two expected
  local-package warnings), and the full Server suite (`4488` passed, `194` skipped) passed.
- The official network-free finalizer ran from a clean deploy-owned private checkout of `5f6d3dd`
  and wrote one sanitized receipt v4 (SHA-256
  `83ec0e913baefe0cfb5145d983ce48bf237865d0479725354d792c1e8b9b0423`). It records
  `CHARGED`, `billingGate=PASS`, actual/quoted/maximum `CNY 0.0119`, one billed unit, and
  `sameRequestRetryAllowed=false`. Its exact replay returned the same bytes with `replayed=true`.
  Original intent/report bytes stayed unchanged; all three claim/receipt artifacts are
  `0600 deploy:deploy` and contain no raw request ID, account/Token number, path, meter body or
  secret. Both VPS dark verifiers passed after settlement. This operation incurred one real
  Provider charge of `CNY 0.0119` but made no ERP generation, media ingest, Ozon write, production
  app switch, feature-flag change or `.context/` staging.
- The Relay exposes no configured or documented explicit async task protocol for this alias/profile,
  so async is recorded unsupported without another paid POST. `QA-02` remains open at `4/5` and
  overall progress remains `32/37`: text-to-image evidence cannot authorize reference edit, full
  edit or inpaint. Each of those three operations still needs its own private versioned price/limit
  record, bounded input evidence, explicit one-request maximum approval and separately reconciled
  request. `QA-04`, `REL-02`, `REL-03` and `REL-04` remain dependency-blocked.
- The operator next approved one exact `IMAGE_TO_IMAGE` request for the same alias and square
  profile, using source SHA-256
  `481527b89ed2e3da85ea1517a10d6227d89c0d17271c92950a98f51a7e044f0b`, quote `CNY 0.0119`, and
  maximum `CNY 1.0000`. Policy SHA-256 was
  `012c98966d76c55ed7c3874d974396742b4b942d942b1929b5f569d65821979b`; approval SHA-256 was
  `3d34d963b9b64052a73d96ffd175079aff2a7b3416330aa35fefff744ba461fa`. The source, pre-call
  snapshot, Git revision, dark state and official offline approval verification all passed before
  dispatch.
- Operation `qa02-i2i-20260730-083710-01` made exactly one Provider POST and returned a definite
  `REJECTED` v5 report after `155 ms`, with `createRequests=1`, no Provider request-ID hash and
  `PROVIDER_REQUEST_FAILED`. It was not retried. Raw quota and displayed usage both had zero delta,
  and the retained authenticated Token log had no matching consume entry. The official network-free
  finalizer wrote exact receipt v3 SHA-256
  `c05aaa7e31a545e0be6a5107a7300e30d4d10f2ef634d7472a51dd064f5db855`, recording `NO_CHARGE`,
  `billingGate=PASS`, `billedUnits=0`, and `sameRequestRetryAllowed=false`; exact replay returned the
  same bytes. Intent/report bytes remained unchanged, outputs are private and sanitized, and both
  VPS dark verifiers passed.
- This exact relay/alias is now evidenced as text-to-image-only and incompatible with the shared
  `/images/edits` transport. `FULL_EDIT` and `INPAINT` were not dispatched: they have no separate
  authorization and another request against the same rejected transport is not justified. `QA-02`
  therefore remains `4/5`, overall progress remains `32/37`, and all four downstream tasks remain
  blocked until a different edit-capable endpoint/model completes bounded operation-specific
  acceptance.
- The alternate candidate `https://ai.centos.hk` passed a no-key public network preflight. Public
  resolvers and the international VPS returned only Cloudflare public IPv4 addresses, TLS 1.3 and
  hostname verification passed, its API Base canonicalized to `https://ai.centos.hk/v1`, and the
  project URL/SSRF validator accepted it from clean checkout `5f6d3dd`. Unauthenticated bounded GET
  checks made no redirects and confirmed `/v1/models` is credential-gated.
- Public pricing revision `a42d372ccf0b5dd13ecf71203521f9d2` lists `gpt-image-2` with
  `model_price=0.1` under the site's CNY display configuration, but advertises only
  `/v1/images/generations` for image traffic and does not advertise `/v1/images/edits`. This is not
  edit-capability evidence or cost authorization. The public frontend has one generic
  `/v1/images/edits` route constant, but does not bind it to this account, model or upstream
  channel. Private preflight manifest SHA-256 is
  `92d0bf08298d0c9254687ca1e0369200f99dc68c5451180ccf2182937dc3b6b4`.
- The candidate Key pasted into the conversation was considered exposed and was never used. The
  operator rotated it and stored the replacement in a private current-user DPAPI file under
  non-secret revision `centos-key-rotation-20260730-01`. One bounded authenticated GET-only sequence
  then confirmed the Token can access exactly `gpt-image-2` and `gpt-image-2-2k`; both catalogue
  entries and the Token model limit still expose only `image-generation` and `openai`.
- Token quota, displayed usage and the empty Token log were byte-identical before and after the
  read-only checks, proving zero charge. Private read-only summary v3 SHA-256 is
  `6ae534108272abcc84fef7f75abf8114d73304ea7ccca2bdb0283c771c1b510a`, and exact/generic credential
  scans were clean. This proves credential validity and usable reconciliation endpoints, not edit
  capability. Counts remain `4/5` and `32/37`; no Provider POST, charge, production mutation,
  deployment, flag change or `.context/` staging occurred.
- The operator separately approved one exact `IMAGE_TO_IMAGE` request against the alternate
  candidate using `gpt-image-2`, `1024x1024`, `n=1`, source SHA-256
  `481527b89ed2e3da85ea1517a10d6227d89c0d17271c92950a98f51a7e044f0b`, quote `CNY 0.1`, and
  maximum `CNY 1.0`. Policy SHA-256 was
  `f517567b88b83c67fac20d349af1353f9f6f28e65bd3cc74e1b6939a07a13684`; approval SHA-256 was
  `e04bddb16a3cd531c0401e4f72bf3a33bec39d28a8d57b51b9353d265f02609f`.
- Operation `qa02-centos-i2i-20260730-094857-01` passed all offline gates and made exactly one
  `/v1/images/edits` POST. It returned `REJECTED` after `302 ms`, with `createRequests=1`, no
  Provider request-ID hash and `PROVIDER_AUTH_FAILED`. It was not retried. The same Token remains
  valid for catalogue and billing GETs, so this is specific negative evidence for the current
  Token/model/edit route rather than proof that the replacement credential is globally invalid.
- Raw quota and displayed usage were byte-identical before and after, and the Token log stayed
  empty. Exact receipt v3 SHA-256
  `9d1e5db49dc5b76e7de70e36cad88a7429e426b3e93de4207ad62a46c040e2d2` records `NO_CHARGE`,
  `billingGate=PASS`, `billedUnits=0`, and `sameRequestRetryAllowed=false`; replay returned the same
  bytes. Both VPS dark verifiers and credential scans passed. Do not send `FULL_EDIT` or `INPAINT`
  through the same endpoint/Token/model. Counts remain `4/5` and `32/37`; another edit-capable
  endpoint/credential or explicit Provider-side edit enablement is required.
- Offline runtime hardening now permits the `custom` OpenAI-compatible adapter only behind exact
  endpoint/model/operation/transport/result-mode evidence across creation routes, standalone
  readiness, queued generation/edit workers, extension launch integration and paid suites. The
  active API Base is included in every readiness call. A queued generation rechecks the exact
  request before the immutable dispatch fence, so Registry drift with zero network I/O is not
  recorded as submission-uncertain. No failed Provider/model was added to the Registry or reviewed
  derived-image allowlist.
- Reference bounds are operation-specific: text-to-image accepts zero, image-to-image accepts the
  verified range, and full edit/inpaint accept exactly one source. OpenAI-compatible inpaint decodes
  the first PNG/JPEG/WebP source and PNG mask under the shared pixel bound and rejects a dimension
  mismatch before Provider dispatch. Sandbox quality is frozen as `PROVIDER_DEFAULT_OMITTED`.
  Future HTTP 4xx/5xx failures write an exclusive private v1 status sidecar bound to the unchanged
  submit-report digest; it contains no body, URL, Provider code or secret and is not consumed by
  billing.
- The combined affected matrix passed `371/371`; the static sandbox contract, workspace typecheck,
  lint (`0` errors; `20` existing Server and one shared warning), full Server suite (`4509` passed,
  `194` skipped), and full preflight (`445/0` with two expected local-package permission warnings)
  passed. Independent reviews found no remaining P0/P1/P2. This work made no Provider request or
  charge, deployment, flag change, ERP media mutation, Ozon write, or `.context/` staging. `QA-02`
  remains open at `4/5` and overall progress remains `32/37`. After a future custom derived-image
  model produces accepted operation-specific evidence, its exact reviewed contract must be added to
  `scripts/sandbox/ai-media-provider-contract.mjs`; it must not be whitelisted beforehand.
- The reviewed sandbox contract gate now rejects an empty evidence set, duplicate bindings, unknown
  operations and any endpoint/model/transport/result-mode mismatch before a paid derived-image
  capability can be promoted. This prepares the exact `QA-02` promotion boundary but does not add
  either failed relay candidate to the allowlist. Positive edit evidence and separate per-request
  approvals are still absent, so Phase 3 remains `4/5` and overall progress remains `32/37`.
- PackyAPI is a protocol-compatible candidate only: its public docs and no-key preflight describe
  `gpt-image-2`, Sora-group access, synchronous multipart `/v1/images/edits`, and the three edit
  mappings, but no authenticated edit success has been observed. The private policy records bind
  each operation to USD `0.08` quoted cost and USD `1.00` maximum without requiring Provider price
  synchronization. The mocked exact-money edit matrix passed `58/58`; the network-free
  `CANDIDATE_ONLY` review contract passed `27/27` and rejects mixed credentials, endpoint digests,
  reused approvals/pricing/Token-log entries, and non-canonical money. It does not modify the
  Registry and cannot itself produce `sandbox-verified` evidence. Server typecheck and full
  preflight passed at `446/0` with the two expected local-package warnings. Phase 3 remains `4/5`,
  with no Provider POST, charge, flag change, deployment, ingest, Ozon write, or `.context/`
  staging.
- Packy credential revision `packy-sora-key-rotation-20260801-01` previously passed a bounded
  same-origin GET-only observation at `https://www.packyapi.ai/v1`, but a later local UTF-16 stdin
  attempt exposed its Authorization value in stderr while Undici rejected the header before network
  dispatch. The `-01` DPAPI artifact is quarantined and must never be restored. Replacement revision
  `packy-sora-key-rotation-20260801-02` is stored in the active current-user DPAPI path with a
  current-user/SYSTEM/Administrators ACL and passed non-plaintext DPAPI metadata validation.
  Main-base policies and approval drafts bound to `-01` remain invalidated. The first official
  preflight from clean commit `ac41efa` issued only three bounded BEFORE GETs and failed closed on
  Packy's canonical empty Token-log envelope; it wrote no evidence bundle and made no POST or charge.
  Three separate bounded GET-only diagnostics confirmed the reviewed quota/usage schemas and that
  this exact empty envelope and message digest match the historical observation. The helper now
  accepts only the exact two-key empty envelope or its existing successful Token-log schema. Its
  focused Windows matrix passes `55` with four POSIX skips, its Linux `--network none` matrix passes
  `59/59`, and sandbox typecheck plus targeted script ESLint pass. Clean commit `e4503e9` then
  completed the official seven-GET sequence under replacement revision `-02`. The private eight-file
  bundle's manifest SHA-256 is
  `9f3dbc30bf2b78b99ede50bdfd285d3f932580cab1ddc5a52812ae7cbacb7b0f`; fixed routes, response
  hashes/lengths, exact model visibility, byte-identical meter pairs, ACLs and credential scans all
  passed independent verification. It records no POST and no charge.
- A replacement private I2I proposed policy binds USD `0.08`/USD `1.00` and has SHA-256
  `9b91a0fa1f3e98177ea5d085e3201e9146b617af7368c351f9e1080324f980cb`. Its schema-v3 draft has
  SHA-256 `1f2d3bb6389856ed63c0ea443a6196a250bd8e1606a3aa2d327129aca71976e4`, binds prepared source
  `5d2627...6e32`, retains all review sentinels, and is rejected by the offline verifier with
  `SANDBOX_APPROVAL_SCHEMA_INVALID`. It does not reuse the earlier `481527...f0b` Centos source
  authorization; those exact bytes are unavailable locally. `QA-02` stays `4/5`, overall progress
  stays `32/37`, and no Registry, rollout, deployment, ingest, Ozon mutation, Provider POST or charge
  occurred.
- The operator subsequently approved the exact Packy I2I request bound to source `5d2627...6e32`.
  Pre-call manifest/snapshot SHA-256 values are `e9cef9fb...172df` and `f653a02f...2f99e`; final
  approval SHA-256 is `de530a1d...38da4`, and official no-key verification passed. Operation
  `qa02-packy-i2i-20260801-e4503e9-01` made one guarded POST without retry and received a definite
  HTTP 400 `REJECTED` result after `1118 ms`, with `createRequests=1`, no Provider request-ID hash,
  no image and report SHA-256 `02ab909a...a4c3e`. Raw quota, displayed usage and Token log were
  byte-identical across the `329871 ms` settlement window. Receipt SHA-256 `0107a287...cb363`
  records `NO_CHARGE`, `PASS`, zero billed units and no same-request retry; replay was byte-identical.
  Six execution records were copied into a private archive with manifest SHA-256
  `43a2a316...e31eaf`; private run-summary SHA-256 is `e1e2c545...c1c896`. A 38-file credential
  scan, ACL checks and the offline dark-deployment guard passed. This is negative evidence for the
  shared Packy edits transport, so `FULL_EDIT` and `INPAINT` were not sent and must not reuse this
  approval. Counts remain `4/5` and `32/37`; no
  Registry, rollout, deployment, ingest or Ozon mutation occurred. The static sandbox contract,
  candidate review `27/27`, dark-deployment guard and full preflight `446/0` passed; preflight kept
  only the two expected local-extension permission warnings.
- `createRequests=1` in the rejected Packy report means that one guarded HTTP POST crossed the
  dispatch boundary and received HTTP 400; it does not mean that the Provider created an edit task.
  The null Provider request ID, unchanged meters and empty consumption log are consistent with no
  accepted or billed task. Packy's public instructions require a `sora`-group token, while the
  retained model/quota responses do not expose that group. At that checkpoint a future attempt
  therefore required exact group confirmation plus either Provider route confirmation or a
  materially different reviewed request contract; the consumed request must not be retried.
- The operator subsequently confirmed through MOSS that the active credential is in the Sora group;
  this is an operator assertion, not successful route evidence. An offline-only
  `PACKY_GPT_IMAGE_2_SQUARE_EDIT_V1` profile now binds the exact Packy identity, documented
  `quality=high`, `output_format=png`, `response_format=url` multipart fields, exact-money v3
  evidence, a dialect-bound request fingerprint and PNG output. Default-profile downgrade,
  endpoint/model mixing, legacy cents, unknown dialects and non-PNG results fail closed. Provider,
  approval, guard, runner and billing focused tests passed `275` with two skips; Server/sandbox
  typechecks and the static contract passed. Full preflight passed `446/0` with the two expected
  local-extension permission warnings. No Provider request or charge occurred, and counts remain
  `4/5` and `32/37`.
- At that preparation checkpoint, commit `9b6cc058091837aa17641871c94138e9c164c0a6` had been pushed
  and used in a detached private checkout to prepare operation
  `qa02-packy-i2i-documented-20260801-9b6cc05-01`. Proposed pricing policy
  SHA-256 is `8744574db12812666ba16b4a7725d8dd617fcddb03b7f98bd722ae4dd002977c`; non-approval draft
  SHA-256 is `1bad6cdb203914f54dfb1935b6c50b977cd2b0f9e8c6f4427e9bc253bd061da1`. The draft binds source
  `5d2627...6e32`, retains its review sentinels, and is rejected by the official no-key verifier.
  Private ACL/digest checks passed. The proposed USD `0.08` quote and USD `1.00` maximum still
  required new explicit authorization at that point; no credential read, Provider GET/POST, or
  charge had occurred during preparation.
- Offline evidence hardening now fully decodes sandbox output before success, rejects truncated and
  animated media, enforces shared byte/pixel/MIME limits, and requires exact approved dimensions.
  Post-acceptance validation failure remains `RECONCILIATION_REQUIRED` and keeps the known Provider
  request-ID hash. Candidate review separately binds `requestedSize` to reported width and height.
  Focused runner tests passed `61/61`, candidate review passed `29/29`, and Server/sandbox
  typechecks, targeted lint, the static contract and diff checks passed. Full preflight passed
  `446/0` with the two expected local-extension permission warnings. No Provider call or charge
  occurred, and counts remain `4/5` and `32/37`.
- The operator approved the prepared documented Packy request as
  `qa02-packy-i2i-documented-20260801-9b6cc05-01`. From clean commit `9b6cc05`, the runner sent one
  `PACKY_GPT_IMAGE_2_SQUARE_EDIT_V1` multipart POST with `quality=high`, `output_format=png`,
  `response_format=url`, and omitted `input_fidelity`; it did not retry. Packy returned definite
  HTTP 400 after `991 ms`. Report SHA-256 `2ce500d9...460ae` records `REJECTED`, one create request,
  no Provider request-ID hash, and no image. Pre-call/settled manifest SHA-256 values are
  `0916cb23...cab42` and `57c33eb2...0b954`; quota, displayed usage, and Token log were byte-identical.
  Attestation SHA-256 `9bfcbf8d...e3dff` produced official receipt SHA-256
  `c62bbc57...42d36`, which records `NO_CHARGE`, `PASS`, zero billed units, and no same-request
  retry; replay preserved the exact bytes. Archive manifest SHA-256 is `3a59161e...c97cc`, and
  run-summary SHA-256 is `4c0c402a...c81fa`. Exact/generic credential scans and private ACL checks
  passed. This closes the documented Packy attempt as negative evidence; `FULL_EDIT` and `INPAINT`
  were not sent. `QA-02` remains `4/5`, overall progress remains `32/37`, and no Registry, rollout,
  deployment, flag, ERP ingest, or Ozon mutation occurred.
- Xiaoyi is now the next candidate based on stronger first-party route evidence. Its documentation
  explicitly binds `gpt-image-2` to synchronous multipart `/v1/images/edits` and also publishes an
  `/async` edit path. Public status binds image calls to `https://image.xiaoyiapi.xyz/v1`; public
  pricing revision `a42d372c...1f9d2` lists USD `0.07` before group adjustment. Public DNS returned
  `23.144.68.169`, TLS hostname validation passed, and private public-preflight summary SHA-256 is
  `720e0f12...28757`.
- Xiaoyi uses separate image and billing hosts. The official GET-only helper now has a closed v2
  Xiaoyi identity that separately validates and pins `image.xiaoyiapi.xyz` and `xiaoyiapi.xyz`,
  permits only the exact model-catalogue GET plus six fixed meter GETs, binds the billing origin in
  private evidence, and preserves Packy v1 evidence bytes. Focused tests pass `69` with four
  platform skips; Server/sandbox typechecks, target lint and the static contract pass.
- The billing finalizer shares that immutable identity and enforces it in both directions: the
  Xiaoyi API digest accepts only the Xiaoyi billing origin, and that origin cannot settle another
  API Base. Existing Provider logs remain same-origin. Combined preflight, settlement and finalizer
  tests pass `137` with five platform skips, including mixed-origin rejection.
- Full Server tests pass `4616` with 199 platform skips; workspace and sandbox typechecks, target
  lint, the static contract and `git diff --check` pass. The complete repository preflight passes
  `446` checks with zero failures and two existing extension-permission warnings.
- The Xiaoyi Key pasted into chat is exposed and was not used. It must be revoked, replaced and
  written to a new current-user DPAPI revision before authenticated preflight. No authenticated GET,
  Provider POST, charge, Registry mutation, deployment, flag, ERP ingest or Ozon write occurred.
  `QA-02` remains `4/5` and overall progress remains `32/37`.
- The exposed Xiaoyi credential was revoked and replaced under revision
  `xiaoyi-image-key-rotation-20260801-01`. From clean pushed commit `f8ee687`, the exact dual-origin
  authenticated preflight completed seven Provider GETs with model `gpt-image-2`; all three meter
  bodies remained byte-identical. Private manifest SHA-256 is `db10c750...f1c33` and records no POST
  or charge. Four additional credential-free Cloudflare DoH GETs resolved the two hosts' A/AAAA
  records.
- `XIAOYI_GPT_IMAGE_2_SQUARE_EDIT_V1` now binds only synchronous `IMAGE_TO_IMAGE`, the exact
  Xiaoyi endpoint/host/model, one `1024x1024` source, `n=1`, default multipart fields and exact money.
  Dedicated adapter, approval, runner, claim and finalizer checks reject model/profile/operation,
  digest, legacy-money and dual-origin mixing. `FULL_EDIT` and `INPAINT` remain unavailable. Focused
  tests pass `302` with two platform skips; the full Server suite passes `4646` with `199` platform
  skips. Sandbox and workspace typechecks, the static contract and diff checks pass. Repository lint
  has zero errors and only the existing `20` Server plus one shared warning. The complete repository
  preflight passes `446/0` with the two existing local-extension permission warnings.
- An independent security review found and closed a generic-profile operation downgrade. Exact
  Xiaoyi route/model identity and the `IMAGE_TO_IMAGE` allowlist are now checked separately at the
  approval, runner, claim and settlement boundaries; generic-profile `FULL_EDIT` and `INPAINT`
  regression fixtures fail before dispatch or settlement.
- Public USD `0.07` base price times the highest published enabled group ratio is USD `0.2002`.
  Operation `qa02-xiaoyi-i2i-20260801-f189dfa-01` was explicitly approved with quote USD
  `0.210001`, maximum USD `1.000000`, scale `6`, then sent exactly one synchronous multipart POST
  from clean pushed commit `f189dfa`. It did not retry. Xiaoyi returned definite HTTP 400 after
  `1858 ms`; report SHA-256 `0457ffa6...82d5` records `REJECTED`, one create request, no Provider
  request-ID hash and no image.
- Pre-call/settled manifest SHA-256 values are `7c273351...3a30` and `e845170a...759e`; all three
  meter bodies were byte-identical. Exact attestation SHA-256 `c22c5729...dfe7` produced v3 receipt
  SHA-256 `98bb603e...5ad7`, with `NO_CHARGE`, `PASS`, zero billed units and no same-request retry;
  replay preserved the exact bytes. Archive manifest SHA-256 is `f4fa78fc...c656`, and run-summary
  SHA-256 is `f5b3e8a0...9aaf5`. Credential and ACL checks passed. No image existed for quality
  review. This exact Xiaoyi route/account/profile is now negative evidence and cannot authorize
  `FULL_EDIT`, `INPAINT` or a renamed retry. Progress remains `4/5` and `32/37`.
- A follow-up check of Xiaoyi's first-party image guide clarified that its synchronous curl example
  sends only `model`, `prompt`, and `image`; `/v1/images/edits/async` is a separate contract. The
  offline `XIAOYI_GPT_IMAGE_2_MINIMAL_EDIT_V2` profile therefore keeps logical `1024x1024`, `n=1`,
  one source, exact money, and `IMAGE_TO_IMAGE`, but omits `n`/`size` from the wire and rejects every
  extra, duplicate, missing, mask, or `image[]` field before dispatch. V1 remains byte-compatible
  negative evidence and has a distinct replay fingerprint. Approval, runner, claim, guard, and
  finalizer derive the V2 dialect independently; focused tests pass `323` with two platform skips,
  and the full Server suite passes `4661` with `199` platform skips. Server/sandbox/workspace
  typechecks, static contract, diff checks, and lint pass; lint retains only the existing `20` Server
  plus one shared warning. Preflight and standalone source-extension verification report `446/0`
  with the two existing local-package permission warnings. Independent security review found and
  closed minimal-adapter multi-source and direct-guard operation/mask bypasses; a fixed historical V1
  fingerprint now protects compatibility. This is offline preparation, not positive capability
  evidence or approval. No credential was read, no Provider request or charge occurred, and counts
  remain `4/5` and `32/37`.
- The operator then approved the separate minimal operation
  `qa02-xiaoyi-minimal-i2i-20260801-78fe4c7-01` from clean pushed commit `78fe4c7`, with the pinned
  source, quote USD `0.210001`, and maximum USD `1.000000`. Pre-call manifest SHA-256 was
  `8021ef61...bcc72`, and final approval SHA-256 was `792d7587...c28a2`. The guarded V2 adapter sent
  exactly one synchronous multipart POST containing only `model`, `prompt`, and `image`; it did not
  retry. Xiaoyi returned definite HTTP 400 after `795 ms`. Report SHA-256 `a46f67fb...85516`
  records `REJECTED`, one create request, no Provider request-ID hash, and no image.
- Settled manifest SHA-256 was `f86ba3b9...5a3c3`; raw quota, displayed usage, and Token log were
  byte-identical across the POST window. Exact attestation SHA-256 `06598b9b...62218` produced v3
  receipt SHA-256 `5fe9b606...4f887`, with `NO_CHARGE`, `PASS`, zero billed units, and no
  same-request retry; offline replay preserved the exact bytes. Archive manifest SHA-256 is
  `d436381b...c2b1d`, and private run-summary SHA-256 is `5a286b63...7c542`. Credential scans found
  zero matches, and private ACL/reparse checks passed. This closes the documented V2 contract as
  negative evidence. No Registry, deployment, flag, ERP ingest, or Ozon mutation occurred. Progress
  remains `4/5` and `32/37`; a Provider-confirmed material permission/contract change or a different
  edit-capable Provider is still required.
- A sandbox-only Alibaba Wanx 2.1 candidate now supplies a materially different official async JSON
  transport without changing the Xiaoyi evidence. Separate
  `DASHSCOPE_WANX21_IMAGE_TO_IMAGE_ASYNC_V1`,
  `DASHSCOPE_WANX21_FULL_EDIT_ASYNC_V1`, and
  `DASHSCOPE_WANX21_INPAINT_ASYNC_V1` profiles bind the Beijing legacy API Base,
  `wanx2.1-imageedit`, operation-specific Provider function, bounded source/mask data URLs, one
  submit, accepted task, bounded polling, metered one-image success, and an official DashScope OSS
  result host without Authorization forwarding. Inpaint deterministically converts local alpha to
  Wanx white-edit/black-preserve bytes, and the guarded JSON request binds the derived digest.
- Raw task/result recovery material stays private; a sanitized async sidecar retains hashes and
  counts. Guard and adapter share an idempotent task persistence callback, while the guard's
  bounded `32 MiB` clone reader cannot wait on clone cancellation. Poll/download uncertainty is
  reconciliation-only and cannot resubmit. Approval, claim, runner, async guard, provider, and
  finalizer focused suites pass `292` tests with two skips; the full Server suite passes `4699`
  with `199` skips. Repository lint has no errors and only the
  existing `20` Server plus one shared warning; workspace/sandbox typechecks, static contract, diff
  checks, and full preflight `446/0` pass with the two existing local-extension warnings. The
  exposed Alibaba credential was not used, and no Provider request, charge, VPS access, deployment,
  flag, ERP ingest, Ozon write, or `.context/` staging occurred. These changes unblock downstream
  offline rehearsal only. `QA-02` remains `4/5`, overall progress remains `32/37`, and final release
  dependencies remain closed until three positive live Wanx operation evidence chains are accepted.
- PicPi credential revision `picpi-sub2-20260801-r2` subsequently passed authenticated model
  catalogue inspection and exposed `gpt-image-2`. Operation
  `qa02-picpi-i2i-20260801-de951b7-01` bound the exact PicPi API Base/edit endpoint, generic
  `OPENAI_SQUARE_SINGLE_V1` multipart profile, one reviewed `1024x1024` source, quote USD `1.00`,
  and maximum USD `1.00`. From clean revision `de951b7`, the guard sent exactly one POST. PicPi
  returned definite HTTP 400 after `2025 ms`; report SHA-256 `87a574b0...f239f` records `REJECTED`,
  one create request, one response-ID hash, no image, and no retry.
- Authenticated `/v1/usage` raw SHA-256 `654b930e...3efcf` showed this Key's today and lifetime
  `requests=0` and `actual_cost=0`. Closed cumulative-zero attestation v4 SHA-256
  `a82fded6...0764f` produced receipt v5 SHA-256 `e2ed71a3...65cd`, recording `NO_CHARGE`, `PASS`,
  zero billed units and `sameRequestRetryAllowed=false`; offline replay was byte-identical. Private
  archive/run-summary SHA-256 values are `a91d8105...3476` and `3708060f...fe36`; hashes, ACLs,
  reparse checks and credential scans passed. This is negative evidence for the exact PicPi
  route/account/model/profile, not permission to retry or test `FULL_EDIT`/`INPAINT`. No Registry,
  deployment, flag, ERP ingest, or Ozon mutation occurred. `QA-02` remains `4/5`, overall progress
  remains `32/37`, and all four downstream tasks remain blocked on positive edit evidence.
- The official read-only helper supports a distinct DashScope Wanx catalog-only v3 preflight for the
  reviewed legacy API Base and exact `wanx2.1-imageedit` model. Its DNS gate binds the DoH Question,
  rejects truncated or non-IN responses, compares complete A/AAAA CNAME paths, and accepts only
  bounded, fully chain-bound CNAME answers. Loops, unrelated records, a missing terminal, mismatched
  targets, and chains longer than eight hops fail before credential input.
  Workspace hosts, billing-origin mixing, malformed DashScope envelopes, multiple catalogue rows,
  model substitutions, task/synthesis routes, guessed billing paths, and POST remain unreachable.
- The first real catalogue preflight failed before credential input with
  `SANDBOX_READONLY_DNS_FAILED` because the original resolver rejected DashScope's legitimate DoH
  CNAME owner chain. Its evidence ID was not consumed; no credential was decrypted, no authenticated
  GET or POST was sent, and no charge occurred. A separate credential-free resolver observation
  returned public DashScope A and AAAA answers but did not prove authentication or model visibility.
  Focused tests pass `95` with four platform skips; the full Server suite passes `4735` with `199`
  skips. Target lint, sandbox TypeScript compilation, the static contract, and diff checks pass.
  Full repository preflight passes `446/0` with the two existing local-extension permission
  warnings. `QA-02` remains `4/5`, overall progress remains `32/37`, and no deployment, flag, ERP
  ingest, or Ozon mutation occurred.
- From clean pushed revision `7001a43e8531f44a3428ec757c63194098f816af`, the DNS-corrected helper
  sent one authenticated catalogue GET and received HTTP 200. The v3 schema rejected the live row
  before persistence because DashScope uses `output.models[].model`, not the assumed `model_id`; the
  evidence ID was not created. A second pinned GET-only diagnostic retained the private 1022-byte
  response under SHA-256 `a30c5462...e5cf2cb` and confirmed exactly one matching
  `wanx2.1-imageedit` row, with no credential reflection and no Provider POST.
- The v3 parser now binds the observed success/pagination envelope and exact `model` field while
  rejecting extra top-level/output fields, contradictory row aliases, failed envelopes, inconsistent
  totals, multiple rows, and legacy `model_id`/`id` substitutions. This is a versioned live
  response-shape contract; Provider drift fails closed rather than silently broadening evidence.
  Focused tests pass `109` with four platform skips; the full Server suite passes `4749` with `199`
  skips. Sandbox typecheck, target lint, the static contract, and diff checks pass; full preflight is
  `446/0` with the two existing local-extension permission warnings. This diagnosis is not edit
  capability or billing evidence. `QA-02` stays `4/5`, overall progress stays `32/37`, and no paid
  task, deployment, flag, ERP ingest, or Ozon mutation occurred.
- From clean pushed revision `6948460a41a2038e3a5c48b589b291ce179ab407`, credential revision
  `dashscope-wanx-beijing-rotation-20260801-01` completed official v3 evidence with exactly one
  authenticated catalogue GET. Manifest SHA-256 is `d3099295...43c5f`; its single 1022-byte model
  response SHA-256 is `5d2dd214...1d578`, and the record hash matches those bytes. It proves
  authentication plus one exact `wanx2.1-imageedit` row while explicitly recording separate billing
  evidence required, no Provider POST/charge observation, and no edit-capability verification.
- Credential scans found zero matches. The evidence directory/files have explicit protected
  current-user/SYSTEM/Administrators ACLs and no reparse points. Private policy SHA-256
  `e6b4d5a6...e6c4f6` still only proposes CNY `0.14` quote/CNY `1.00` maximum; draft SHA-256
  `b2f3e0c0...941369e` remains unapproved. `QA-02` stays `4/5`, overall progress stays `32/37`, and
  no task, synthesis, poll, download, paid operation, deployment, flag, ERP ingest, or Ozon mutation
  occurred.
- Operation `qa02-wanx-i2i-20260801-3ac48e4-01` is the first positive live Wanx edit result. The
  operator disclosed before dispatch that the DPAPI Key and authenticated Bailian console belong to
  different billing accounts, so the console snapshot was explicitly excluded. A capability-only
  policy (`d4a1f162...561a7f`), pre-call record (`28163310...bdcda`), and exact approval
  (`0dff1d18...9654a`) retained the CNY `0.14` quote, CNY `1.00` maximum, and one-request boundary
  without claiming account-specific billing visibility.
- The runner sent exactly one async create request, polled only its accepted task eight times, and
  downloaded one result without forwarding Authorization. Report SHA-256 `a0671f5c...caed42`
  records `SUCCEEDED`, `createRequests=1`, one 1024x1024 PNG of 951,543 bytes, and image SHA-256
  `f6d90b58...9da24`. Async-evidence SHA-256 is `97776d79...ca3194`; task identity hashes agree and
  credential scans across the seven execution artifacts found zero matches. Technical visual review
  found the requested warm-beige background change while preserving the mug identity and geometry,
  with no unexpected text, logo, watermark, or object. Human confirmation remains pending.
- No billing finalizer or formal receipt ran. Private sidecar SHA-256 `9150eb29...6bec93` records
  `UNRESOLVED_ACCOUNT_IDENTITY_MISMATCH`, `actualCost=null`, and `sameRequestRetryAllowed=false`.
  This proves positive `IMAGE_TO_IMAGE` capability but does not close the billing gate, authorize a
  retry, or satisfy `FULL_EDIT`/`INPAINT`. Progress remains `4/5` and `32/37`; no deployment, flag,
  ERP ingest, VPS, or Ozon mutation occurred.
