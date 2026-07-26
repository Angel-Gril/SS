# Phase 3: Edit Operations and Batch Engine

Progress: 1/5 tasks.

## Tasks

- [x] `EXT-04B` Add reference/full-edit/inpaint adapters (`P1`, `L`). Acceptance: bounded
  multipart `/images/edits`, references, PNG mask, URL/base64, and explicit async contracts
  work; invalid source/mask dimensions make zero calls; relay dialects remain separate.
- [ ] `EXT-06` Build bounded media job engine (`P1`, `L`). Acceptance: capped concurrency,
  pause-after-active, continue, cancel queued, retry/regenerate, alternate preservation, and
  unknown-outcome handling have deterministic tests.
- [ ] `EXT-07` Build fact-bound Prompt/SKU slot planner (`P1`, `M`). Acceptance: SKU hero
  and distinct detail roles, overrides, up to four references, stable hash/version, and no
  fabricated product facts.
- [ ] `UI-03` Integrate references/full edit/inpaint (`P1`, `L`). Acceptance: users select
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
