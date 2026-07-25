# Phase 3: Edit Operations and Batch Engine

Progress: 0/5 tasks.

## Tasks

- [ ] `EXT-04B` Add reference/full-edit/inpaint adapters (`P1`, `L`). Acceptance: bounded
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
