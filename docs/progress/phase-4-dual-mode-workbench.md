# Phase 4: Complete Dual-Mode Workbench

Progress: 0/5 tasks.

## Tasks

- [ ] `UI-04` Build original two-pane SKU/media workbench (`P1`, `XL`). Acceptance: context
  header, mode selector, SKU rail, source/reference library, hero/detail slots, Prompt
  inspector, alternatives, and task dock work without copied reference code/assets/copy.
- [ ] `UI-05` Add task/review/order/recovery UX (`P1`, `L`). Acceptance: progress, pause,
  continue, cancel queued, keep/reject, regenerate, choose main, reorder, missing/stale checks,
  and publish summary reflect real state; drag has keyboard alternatives.
- [ ] `HOST-01` Adapt full ERP-hosted workflow (`P0`, `XL`). Acceptance: extension plan,
  ERP validation/quote, maximum-cost confirmation, queue/storage, candidate review, approved
  draft apply, retry cost confirmation, and publish all work; hosted never uses BYOK ingest.
- [ ] `BYOK-01` Connect batch BYOK review/ingest/binding (`P0`, `XL`). Acceptance: selected
  slots run in background; local review determines ingest; publish-selected outputs are
  normalized/stored/hashed/bound; ERP AI charge is zero; retry warns of Provider charges.
- [ ] `UI-06` Add compact auto-bound source launcher (`P1`, `M`). Acceptance: valid device
  session avoids manual pairing; exact source/shop/draft/SKU context prefills; ambiguous or
  stale context requires explicit choice.

## Parallel Lanes

- Lane A: `UI-04`, `UI-05`.
- Lane B: `HOST-01`.
- Lane C: `BYOK-01`.
- Convergence: `UI-06`.
- Merge risk: medium; existing source scripts receive launcher/readiness changes only.

## Notes

- Mode becomes immutable once execution starts.
- Hosted candidates require ERP review; BYOK results are reviewed locally before secure ERP
  ingest and draft binding.
