# Extension Dual-Mode AI Image Workflow: Project Overview

## Confirmed Task

Build one SS ERP browser-extension image workbench with two explicit execution modes:

1. `ERP_HOSTED`: SS ERP owns the Provider call, pricing, quota, budget, queue, storage,
   review, draft mutation, and Ozon publish lifecycle.
2. `BYOK`: the user supplies an OpenAI-compatible Provider endpoint, model, and API key.
   The extension background calls that Provider directly, then imports the validated result
   into SS ERP and uses the existing ERP Ozon publish authorization and recovery path.

The BYOK mode reproduces the useful workflow concepts of the supplied reference extension:
named Provider profiles, reference selection, SKU hero/detail generation, a two-pane media
workspace, task progress, pause/continue, slot retry/regenerate, ordered media, and an
explicit final publish action. It is a clean-room implementation using SS ERP naming,
components, contracts, and visual language. Reference code, assets, branding, obfuscated
identifiers, unsafe defaults, and disconnected behavior are not copied.

## Publish Semantics

"Reference-style direct publish" means a shorter extension UX, not browser-side Ozon
credentials or an untracked Ozon write:

```text
ERP hosted
source page -> extension workbench -> ERP media job -> ERP cost/queue/storage
            -> review -> listing draft -> command grant -> ERP Ozon publisher

BYOK
source page -> extension workbench -> background Provider client -> local result review
            -> device-scoped ERP asset ingest -> ordered listing media
            -> explicit publish confirm -> command grant -> ERP Ozon publisher
```

Both modes keep shop authorization, current draft revision checks, publish idempotency,
receipts, uncertain-outcome reconciliation, and rollout controls on the ERP server. BYOK
bypasses only SS ERP's AI Provider charge. Storage and publish quotas still apply.

## Repository Architecture

The monorepo uses pnpm workspaces and Node.js 22+:

| Area | Stack | Primary entry points |
| --- | --- | --- |
| Browser extension | Chrome MV3, packaged JavaScript/HTML/CSS | `extensions/ss-erp/manifest.json`, `background/service-worker.js`, source content scripts, extension pages |
| API/worker | Fastify, TypeScript, Prisma, BullMQ-style worker modules | `apps/server/src/index.ts`, route modules, worker modules |
| Web ERP | Next.js 15, React, TypeScript | `apps/web/src/app`, `apps/web/src/components` |
| Shared contracts | TypeScript and generated/plain JavaScript contracts | `packages/shared`, extension `shared/` modules |
| Tests | Vitest plus Node contract/static tests | `apps/server/src/__tests__`, `scripts/*.test.mjs` |

Important build and verification commands:

```text
pnpm lint
pnpm -r typecheck
pnpm --filter server test
pnpm preflight
pnpm build:extension:cloud
pnpm build:extension:local
pnpm verify:extension
```

## Existing Hosted Media Architecture

The current extension already exposes image translation, AI suite, image-to-image,
full-image edit, and masked inpaint entries. Its hosted path uses:

- device pairing and scoped credentials;
- one-time command grants for media and publish mutations;
- exact listing workflow and draft version binding;
- source-media internalization and immutable hashes;
- server-side Provider configuration and capability gates;
- cost reservation, daily quota, global budget, queue, and worker execution;
- pending candidates, review decisions, draft application, rollback, and Ozon publish.

This path remains authoritative for `ERP_HOSTED`. The new UI may orchestrate it, but the
hosted pricing and execution code must not be shared with or weakened by BYOK.

## BYOK Target Architecture

### Extension-owned components

- Execution-mode selector with an unambiguous `ERP hosted` or `My API key` state.
- Named endpoint-bound Provider profiles.
- Session-only secret storage in the background worker for the first release.
- Exact-origin optional Chrome permission requested only from a user gesture.
- Background-only OpenAI-compatible Provider adapter.
- Bounded generation/edit task engine with pause, continue, cancel, and slot retry.
- Two-pane image workbench with SKU strip, sources, selected/reordered media, and results.
- Local result review and explicit publish confirmation.
- Device-scoped result ingest and publish bridge to ERP.

### Server-owned components

- A dedicated BYOK policy/readiness endpoint and default-off rollout controls.
- A device-authenticated generated-asset ingest endpoint.
- Image byte, MIME, pixel, animation, dimension, and size validation.
- Re-encoding/metadata stripping and OSS/R2/local storage through the existing abstraction.
- Owner, actor, device, shop, listing draft, source hash, result hash, endpoint-origin hash,
  model, and request provenance.
- A zero-ERP-AI-charge BYOK record, separate from hosted cost reservations.
- Existing listing draft compiler, `OZON_PUBLISH` grant, receipt, queue, and reconciliation.

## Provider Compatibility Scope

The first implementation targets an original OpenAI-compatible adapter:

- JSON `POST /images/generations` for text-to-image;
- multipart `POST /images/edits` for reference generation and full-image edit;
- multipart edit with a PNG mask for inpaint;
- URL and `b64_json` outputs;
- synchronous responses and an explicit, contract-driven async task mode;
- endpoint/model/operation-specific capability probes.

Wan, Nano Banana, arbitrary Responses API relays, and relay-specific payload dialects are
separate adapters, not aliases for a successful text-to-image probe. They can be added after
the core boundary and tests are stable.

## Key Design Decisions

1. API keys never enter content scripts, page DOM, ERP requests, logs, or persistent local/sync
   storage in the first release.
2. BYOK networking runs only in the extension background worker.
3. Provider endpoints require HTTPS, a canonical public origin, no embedded credentials,
   no query/fragment, no redirects, an admin allowlist, and exact optional host permission.
4. Provider outputs are hostile input until decoded, bounded, validated, normalized,
   re-encoded, hashed, and stored by ERP.
5. A Provider timeout after submission is an unknown outcome and is not blindly retried.
6. Changing the endpoint requires key re-entry. A capability result is bound to exact
   endpoint origin, model, and operation.
7. BYOK never creates or settles an ERP AI cost reservation. Hosted mode always does.
8. Ozon credentials remain on the ERP server. The extension never calls Ozon's Seller API
   directly and never reuses seller cookies for publishing.

## Reference Extension Findings

The reference provides useful product ideas but is not a reliable implementation baseline:

- its main workbench is a legacy monolith;
- Provider and Ozon keys are stored as plaintext in `chrome.storage.local`;
- host permissions and CSP are excessively broad;
- advertised Prompt planning is not enabled in the normal execution path;
- retry/recovery arguments are passed by callers but ignored by the runner;
- generated Provider URLs are not consistently persisted before listing;
- `b64_json` parsing exists but upper layers reject it;
- full edit/inpaint and layered PSD are hard-disabled;
- missing stock and dimensions can receive unsafe fabricated defaults;
- direct Ozon writes bypass ERP ownership, idempotency, and reconciliation.

Only the interaction model and valid protocol behavior are inputs to the clean-room design.
