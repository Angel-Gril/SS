# Dual-Mode Extension AI Image Workflow: Milestones

## M0: Contract Frozen

Tasks: `FND-01` through `FND-03`.

Exit criteria:

- Dual execution modes and global/per-slot state machines are versioned and closed.
- Existing hosted quote/review/apply, cost, draft, and publish behavior has regression tests.
- Shared resource limits and unknown-outcome semantics are fixed before implementation.

No runtime behavior is enabled at this milestone.

## M1: Default-Off Trust Boundary

Tasks: `SRV-01` through `SRV-03`, `EXT-01` through `EXT-03`, and `REL-01`.

Exit criteria:

- BYOK generation, ingest, and publish are independently default-off.
- API keys are session-only and background-only.
- Provider origins require policy approval and exact optional permission.
- Dedicated ingest authorization and non-secret provenance are migrated and tested.
- Admin controls clearly separate hosted and BYOK policies.

No real Provider call or production asset ingest is allowed yet.

## M2: Single-Image BYOK Dark Closure

Tasks: `SRV-04` through `SRV-06`, `EXT-04A`, `EXT-05`, `UI-01`, `UI-02A`,
`INT-01`, `INT-02`, and `QA-01`.

Exit criteria:

- A fake OpenAI-compatible Provider can generate one image in the extension background.
- The user can review the local result, securely ingest it, bind a new draft revision, and
  explicitly publish through the current ERP publisher.
- Hostile images, stale drafts, revoked scopes, duplicate clicks, redirects, private hosts,
  oversized responses, and unknown outcomes fail safely.
- BYOK produces exactly zero ERP AI cost reservations/settlements.
- The same publish intent produces at most one Ozon receipt.

The implementation remains dark. Real endpoint testing starts only after these gates pass.

## M3: Edit and Batch Engine Complete

Tasks: `EXT-04B`, `EXT-06`, `EXT-07`, `UI-03`, and `QA-02`.

Exit criteria:

- Reference generation, full-image editing, and masked inpaint work only for separately
  verified endpoint/model/operation combinations.
- Prompt/slot planning supports SKU hero and distinct detail roles without fabricated facts.
- Pause, continue, cancel queued work, retry, regenerate, and unknown outcomes have truthful
  deterministic behavior.
- The user's exact third-party relay is sandbox-tested operation by operation.

## M4: Dual-Mode Workbench Complete

Tasks: `UI-04` through `UI-06`, `HOST-01`, and `BYOK-01`.

Exit criteria:

- One original SS ERP extension workbench exposes `ERP hosted` and `My API key` modes.
- SKU rail, source/reference library, hero/detail slots, Prompt inspector, alternatives,
  progress, pause/continue, per-slot regeneration, ordering, and review are complete.
- Hosted mode creates/validates the plan in ERP, confirms maximum cost, queues execution,
  requires ERP candidate review, and applies approved media to the draft.
- BYOK runs in the background, reviews locally, then normalizes, stores, and binds accepted
  outputs without creating ERP AI charges.
- Existing source-page UI is a compact automatically bound launcher, not a second workbench.

## M5: Publish-Ready Quality Gate

Tasks: `INT-03`, `QA-03`, `QA-04`, and `DOC-01`.

Exit criteria:

- Both modes converge on one ordered-draft compiler and existing Ozon publisher.
- Publish is impossible while selected media is local-only, stale, unbound, rejected, or in
  unknown state.
- Desktop and narrow Chrome layouts pass screenshot, overflow, keyboard, focus, zoom,
  reduced-motion, and contrast checks.
- Full lint, typecheck, server tests, extension contract tests, preflight, cloud/local builds,
  package verification, security sentinel, billing, authorization, and idempotency gates pass.
- User/admin documentation accurately explains charges, permissions, session keys, data sent
  to Providers, operation probes, retries, review, and publishing.

## M6: Pilot and Production Delivery

Tasks: `REL-02` through `REL-04`.

Exit criteria:

- Sandbox pilot succeeds for one owner/device/profile.
- Publish pilot succeeds for one explicitly approved shop and exact Provider profile.
- BYOK generation, ingest, and publish can be killed independently without affecting hosted
  jobs or existing receipts.
- Cloud and local extension packages contain the same feature set with correct endpoints,
  verified hashes, and upgrade behavior.
- Database migration, API/web/worker rollout, both VPS readiness checks, extension pairing,
  hosted regression, BYOK fixture ingest, and reconciliation canaries pass.

Production rollout remains scoped until cost, error, duplicate, and reconciliation telemetry
is stable. A successful text-to-image pilot does not automatically enable edit or inpaint.

## Deferred Milestones

These require separate approval after M6:

- Secure persistent-key storage.
- Proprietary relay adapters beyond the verified OpenAI-compatible contract.
- Cross-browser support beyond the current Chrome MV3 package.
- Cross-restart recovery of unfinished Provider jobs whose session key has expired.
