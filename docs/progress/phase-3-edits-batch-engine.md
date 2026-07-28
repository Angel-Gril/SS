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
- `QA-02` preparation now requires a private closed-schema one-request approval file. Its reviewed
  SHA-256 is checked before DNS resolution or intent creation, and the endpoint/model/operation,
  request profile, credential/deployed adapter revisions, source/mask hashes, quoted/maximum cost,
  and billing evidence references must match the exact command. Only the approval ID, digest,
  timestamp, currency, and hashed operator/account/pricing/billing references enter the immutable
  intent and sanitized report. Missing, changed, mismatched, extra-field, or non-private approval
  files fail before Provider dispatch.
- Approval/runner/guard focused tests passed `33/33`; the static single-submit contract, sandbox
  TypeScript compilation, repository lint (existing warnings only), workspace typecheck, and full
  preflight passed. Preflight reported `445` passes, `0` failures, and the two expected local-package
  permission warnings. `QA-02` remains open because no edit-capable endpoint/model and no explicitly
  approved paid request exist. No Provider request, charge, production mutation, VPS access,
  deployment, or `.context/` staging occurred.
