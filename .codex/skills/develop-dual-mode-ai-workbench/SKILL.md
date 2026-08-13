---
name: develop-dual-mode-ai-workbench
description: Maintain, review, test, package, deploy, or resume the completed SS ERP browser extension dual-mode AI image workbench. Use for ERP-hosted image generation, BYOK Provider profiles and background calls, reference generation, full-image editing, inpaint, batch SKU media slots, generated-asset ingest, draft binding, extension publish coordination, release packaging, and pilot verification.
---

# Maintain the SS ERP Dual-Mode AI Workbench

## Start Every Session

1. Inspect the Git worktree. Preserve unrelated user changes and never include `.context/` or
   historical `build/` artifacts.
2. Treat the committed source, focused contracts, release scripts, and current operator
   authorization as the source of truth; do not recreate deleted planning/progress archives.
3. Before changing an unfamiliar module, read the relevant source contract, runbook, and test.

Do not restart analysis or repeat completed work. Treat MASTER as the cross-conversation
source of truth.

## Enforce the Product Boundary

Keep two distinct execution paths behind one extension workbench:

### ERP_HOSTED

- Create a fact-bound plan and obtain ERP validation and pricing.
- Require explicit maximum-cost confirmation.
- Use ERP quota, budget, cost reservation, Provider queue, storage, and settlement.
- Require ERP candidate review before applying approved media to the listing draft.
- Publish only through the existing draft compiler, `OZON_PUBLISH` grant, receipt, queue, and
  reconciliation path.

### BYOK

- Accept a user Provider endpoint, model, and API key only on an extension-origin page.
- Call the AI Provider only from the extension background worker.
- Keep the key only in `chrome.storage.session`; return only redacted state such as `hasKey`.
- Let the user review Provider results in the extension.
- Send accepted bytes through the dedicated device-scoped ERP ingest path for validation,
  normalization, hashing, storage, provenance, and exact draft/SKU/slot binding.
- Record ERP AI generation charge as zero and never create an ERP AI cost reservation.
- Publish only through the same existing ERP publisher used by hosted mode.

BYOK bypasses ERP AI generation charges only. It does not bypass device/shop authorization,
storage limits, draft revision checks, command grants, publish receipts, or reconciliation.

## Treat These as Release-Blocking Invariants

- Never expose an API key to content scripts, page DOM, URLs, logs, runtime responses, ERP
  requests, `chrome.storage.local`, or `chrome.storage.sync`.
- Clear the key and capability evidence when the endpoint changes, the device disconnects, or
  the browser session is cleared.
- Never store Ozon credentials in the extension or call the Ozon Seller API from the browser.
- Never accept an arbitrary Provider result URL as listing media. Normalize and persist the
  bytes first.
- Never publish a local-only, rejected, unknown, stale, or unbound image slot.
- Never treat text-to-image success as evidence for reference edit, full edit, or inpaint.
- Never blindly retry a timed-out Provider POST. Mark it `UNKNOWN_OUTCOME` unless a stable
  Provider request lookup or idempotency contract proves retry safety.
- Never fabricate product dimensions, material, stock, certification, package contents, or
  other facts in Prompt planning or Ozon payloads.
- Never enable a new production flag by default.

If any invariant fails, stop rollout work, add a regression test, fix the cause, and record
the decision in the active progress file.

## Apply Network and Media Safety

- Canonicalize Provider origins. Require HTTPS, no embedded credentials, no query/fragment,
  an ERP administrator allowlist decision, and an exact optional Chrome permission requested
  from a trusted user gesture.
- Reject localhost, private, link-local, and metadata targets before network I/O. Use
  `redirect: 'error'` and `credentials: 'omit'`.
- Do not forward Provider Authorization when downloading a result URL.
- Bound request/response bytes, image count, dimensions, pixels, frames, references, Prompt
  length, concurrency, and timeouts using the versioned shared contract.
- Treat Provider output as hostile. Verify magic/MIME, decode, reject animation/multipage,
  strip metadata, re-encode, hash normalized bytes, then store via the existing abstraction.
- Bind ingest and publish to owner, actor, device, shop, workflow, revision, draft version,
  SKU, slot, source/result hashes, idempotency key, and request hash.

## Build in Focused Modules

Keep new Provider, profile, permission, capability, job-engine, Prompt-planning, ingest,
provenance, publish-coordinator, and standalone workbench logic in focused modules.

Treat these files as merge hotspots with one owner at a time:

- `apps/server/prisma/schema.prisma` and migration order.
- Extension device scopes and command-grant operations.
- `apps/server/src/config/system-config-schema.ts` and admin settings.
- `apps/server/src/index.ts` route registration.
- `extensions/ss-erp/background/service-worker.js`.
- Runtime message policy.
- Manifest, package builder, and package verifier.
- Existing source listing workbench and costing panel.

Use hotspot files only for thin registration, dispatch, or launch integration. Do not expand
existing multi-thousand-line modules with the new core implementation.

## Recreate the Reference Workflow Cleanly

Reimplement useful concepts: named Provider profiles, SKU rail, source/reference library,
hero/detail slots, two-pane workspace, task progress, pause/continue, alternate attempts,
per-slot regeneration, ordered media, review, and publish summary.

Do not copy reference source, markup, CSS, assets, branding, text, identifiers, obfuscated
code, telemetry, extension keys, credentials, or unsafe defaults. Use SS ERP naming, visual
tokens, contracts, accessibility, and state models. Reproduce behavior only when it is both
observable and compatible with this skill's security invariants.

## Execute a Task

1. Confirm prerequisites from the dependency graph.
2. Inspect the smallest relevant source and existing tests.
3. Add a failing characterization or contract test before changing fragile behavior.
4. Implement the smallest complete slice that meets the task acceptance criteria.
5. Test focused modules first, then the affected workspace.
6. Run `git diff --check` and review for secrets, unrelated files, stale flags, and duplicated
   logic.
7. Record decisions and release evidence in the active operator-controlled release artifact,
   never by restoring deleted planning archives.

Do not mark a task complete merely because code exists. Its acceptance criteria and required
tests must pass.

## Use Parallel Agents Safely

At the start of each implementation phase, use the parallel lanes in the task breakdown.
Assign one bounded task per agent with acceptance criteria and relevant paths.

- Parallelize new modules and tests with low file overlap.
- Serialize hotspot files and Prisma migration ordering.
- Ask agents not to modify progress files when multiple lanes are active; reconcile progress
  once in the root agent after integrating results.
- Verify every agent result locally. Run combined tests after merging lanes.
- If one lane is blocked, continue independent lanes and record the blocker rather than
  weakening a boundary.

## Verification Gates

Run focused tests named in the active task. At milestone boundaries also run the applicable
full gates:

```text
pnpm lint
pnpm -r typecheck
pnpm --filter server test
pnpm preflight
pnpm build:extension:cloud
pnpm build:extension:local
pnpm verify:extension
```

Before real Provider sandbox testing, require the fixture vertical slice, secret sentinel,
hostile-image limits, billing separation, stale-draft, idempotency, and one-receipt tests.
Before production pilot, require exact endpoint/model/operation evidence, cloud/local package
verification, accessibility/responsive QA, default-off flags, rollback controls, and both VPS
canaries.

## Progress and Handoff

After each completed task, report the exact commit, tests, remaining gates, feature flags,
release bindings, and whether any Provider charge or production mutation occurred.

When handing off, report completed task IDs, tests run, remaining gates, current flags, Git
state, and whether any real Provider charge or production mutation occurred.

## Complete and Clean Up

The generated analysis, plan, and progress archives were intentionally removed after the
implementation reached completion. Keep this project skill as the maintained operational
boundary; do not restore the deleted archives or remove this skill automatically.
