# Phase 0: Contract and Regression Baseline

Progress: 3/3 tasks. Milestone verification passed.

## Tasks

- [x] `FND-01` Freeze versioned dual-mode contracts (`P0`, `M`). Acceptance: `ERP_HOSTED`
  and `BYOK` are closed values; mode is immutable after dispatch; hosted and BYOK routes are
  distinct; public schemas contain no secret field; global and slot state transitions reject
  unknown values.
- [x] `FND-02` Characterize current hosted and publish behavior (`P0`, `M`). Acceptance:
  tests protect quote and maximum-cost confirmation, execute, candidate review, draft apply,
  stale-draft rejection, `OZON_PUBLISH` idempotency, receipt recovery, and reservation/
  settlement behavior.
- [x] `FND-03` Define shared limits and error semantics (`P0`, `S`). Acceptance: image,
  byte, pixel, dimension, reference, Prompt, concurrency, timeout, and `UNKNOWN_OUTCOME`
  limits are versioned and tested on extension and server boundaries.

## Parallel Lanes

- Lane A: `FND-01`, then `FND-03`.
- Lane B: `FND-02`.
- Merge risk: low.

## Notes

- No runtime feature is enabled in this phase.
- Existing hosted and publisher behavior must be protected before new integration starts.
- `FND-01` completed with a public TypeScript contract in `shared` and a browser runtime
  contract for MV3 pages. RED: server tests had 12 missing-contract failures and the browser
  test reported the missing runtime file. GREEN: 12/12 server tests, browser contract test,
  and shared typecheck passed. No route was registered and no flag was enabled.
- `FND-02` audit found the requested public behavior already protected by authoritative tests,
  so no duplicate characterization file was added. The extension source workbench contract
  passed, and six server suites covering priced start/retry, review/apply, stale context,
  command-grant receipt replay/recovery, paid execution, and cost controls passed 164/164.
- `FND-03` froze v1 limits for image/reference counts, request/result bytes, dimensions,
  pixels, Prompt lengths, concurrency, and Provider timeout. RED added two server failures and
  a missing browser `LIMITS` failure. GREEN passed 14/14 server contract tests, the browser
  contract test, and shared typecheck. A dispatched request without a definite response maps
  to `UNKNOWN_OUTCOME`; its policy forbids automatic retry without Provider lookup or stable
  idempotency.
- Final security review added RED cases for `providerToken`, `privateKey`, `sk`, and
  `authHeader`; all now fail closed. Final GREEN is 18/18 focused server contract tests plus
  the browser contract test. Full `pnpm preflight` passed on the final code: 3603 server tests
  passed, 158 environment-gated tests skipped, and extension verification reported 0 failures.
  The three existing extension permission warnings remain scheduled for `EXT-02`.
