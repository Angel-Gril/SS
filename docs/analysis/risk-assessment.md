# Extension Dual-Mode AI Image Workflow: Risk Assessment

## Risk Scale

- `P0`: can expose secrets, charge the wrong party, or publish unintended marketplace data.
- `P1`: can corrupt media/draft state, create duplicate work, or block production rollout.
- `P2`: degrades compatibility, UX, maintainability, or store acceptance.

## P0 Risks

### Secret exposure

**Risk:** a BYOK API key reaches the source page DOM, content script, runtime response,
ERP request, log, persistent Chrome storage, or packaged artifact.

**Controls:**

- key entry only on an extension-origin page;
- key readable only by the background service worker;
- `chrome.storage.session` only for the first release;
- no secret-bearing state returned to content scripts;
- endpoint changes clear the key and require re-entry;
- sentinel tests inspect DOM, messages, requests, logs, local/sync storage, and package output;
- disconnect/session-clear removes the secret.

Persistent "remember key" is deferred until a separately reviewed at-rest secret design is
approved. Chrome extension local storage is not a secure vault.

### Wrong-party billing

**Risk:** a client-forged `BYOK` label bypasses a hosted charge, or a BYOK task creates an
ERP cost reservation.

**Controls:**

- separate hosted and BYOK commands/routes;
- freeze execution mode before dispatch;
- hosted mode remains server-authoritative and always reserves/settles cost;
- BYOK never invokes an ERP Provider adapter or cost service;
- mandatory `ERP AI charge = 0` BYOK provenance;
- database tests assert no BYOK cost reservation and no hosted dispatch without one.

### Provider endpoint abuse

**Risk:** SSRF-like access to private/metadata services, credential forwarding on redirect,
or a malicious response exhausts memory.

**Controls:**

- HTTPS public origins only;
- reject embedded credentials, query, fragment, localhost, private/link-local/metadata hosts;
- admin origin allowlist plus exact optional Chrome host permission;
- `redirect: 'error'`, timeouts, bounded body readers, no cookies;
- do not send Authorization when downloading an output URL;
- output URL needs an independently allowed exact origin;
- prefer bounded `b64_json` when available.

Browser JavaScript cannot prove DNS resolution. An allowlist is therefore mandatory even
with syntactic private-address rejection.

### Unsafe or duplicate Ozon publish

**Risk:** BYOK UI directly calls Ozon, publishes stale/unreviewed media, or duplicates a
submission after timeout/double-click/reload.

**Controls:**

- extension never stores Ozon credentials or calls Seller API;
- generated media must be validated, stored, and bound to the current ERP draft;
- explicit final preview and confirmation;
- `listing:publish`, allowed shop, exact draft revision/version/SKU set;
- existing command-grant request hash, receipt, publisher queue, and reconciliation;
- uncertain outcomes enter recovery, never blind retry.

## P1 Risks

### Mandatory broad extension permissions

The source manifest currently includes `<all_urls>` and other broad permissions; the cloud
build strips some values. BYOK cannot claim least privilege while arbitrary Provider access
is mandatory.

Required change:

- remove broad mandatory cloud host access;
- add `optional_host_permissions` and request one canonical Provider origin from a user
  action;
- retain only marketplace/ERP hosts required by the packaged target;
- no remote code, `eval`, Provider HTML, or external scripts;
- add package verifier failures for broad mandatory access.

### Hostile image data

Provider outputs may contain malformed base64, MIME spoofing, decompression bombs,
animation/multipage content, oversized dimensions, or metadata.

Required ingest behavior:

- stream/bound bytes before allocation;
- allow PNG/JPEG/WebP magic matching the declared type;
- cap pixels, frames/pages, dimensions, per-file bytes, total bytes, and output count;
- decode and re-encode server-side, stripping metadata;
- compute SHA-256 on normalized bytes;
- never store data URLs/base64 in extension storage or message history.

### Endpoint/model/operation capability confusion

A text-to-image success does not prove image edits or masks. Evidence must be keyed by:

```text
canonical endpoint origin + model + operation + request mode
```

Changing any component invalidates evidence. BYOK evidence never upgrades hosted production
Provider evidence.

### Retry and recovery

A timeout after Provider POST is `UNKNOWN`, not `FAILED`. Automatic retry is allowed only
when the Provider supports a stable idempotency key or request lookup. Pause acts after the
current request. Cancel is best effort and must not claim remote cancellation without proof.

### Stale draft/media binding

Every ingest and publish action binds owner, shop, listing draft ID, revision, draft version,
SKU identity, source hashes, and result hash. A changed draft fails with a refresh/review
message. No arbitrary output URL is accepted as a draft assignment.

## P2 Risks

### UI/code ownership

Literal reference UI/source duplication creates copyright, impersonation, maintenance, and
Chrome Web Store review risk. Reimplement the workflow with SS ERP tokens, labels,
components, accessibility, and responsive behavior. Do not copy assets, strings, branding,
identifiers, obfuscated code, telemetry, or extension key.

### Monolith growth

Several current entry files exceed 1,500-5,000 lines. New logic must live in focused modules;
entry files only import, route, and coordinate. New server endpoints must not enlarge the
existing 50 KB command-grant route.

### Reference behavior that must not be reproduced

- plaintext persistent AI/Ozon keys;
- direct Ozon Seller API writes;
- broad HTTPS/debugger/unlimitedStorage permissions;
- fabricated stock/dimension defaults;
- failing open after watermark errors;
- expiring Provider result URLs in listing payloads;
- advertised but disabled/disconnected Prompt, recovery, edit, and Provider paths.

## Mandatory Provenance

Record for every imported BYOK result:

- owner, actor, device, shop;
- mode `BYOK`;
- endpoint-origin hash, model, operation, Provider request ID;
- prompt hash and source/reference hashes;
- normalized result SHA-256, MIME, dimensions, asset ID;
- draft ID/revision/version and SKU/slot assignment;
- timestamps and publish intent/receipt IDs;
- ERP AI charge `0`.

Never record API keys, Authorization values, raw secret-bearing URLs, raw Provider error
bodies, or base64. Full Prompt retention requires an explicit policy; hashes are mandatory.

## Default-Off Controls

Add distinct fail-closed controls:

- `feature_extension_hosted_ai`;
- `feature_extension_byok_ai`;
- `feature_extension_byok_publish`;
- owner/shop/device pilot policy;
- allowed Provider origins;
- allowed operations and maximum concurrency;
- persistent-key permission, default false.

Use a dedicated BYOK media-ingest scope. Keep `listing:write` and `listing:publish` separate.
Revoking a device/session/shop invalidates in-flight ingest/publish authorization.

## Release Gates

The feature cannot leave dark/pilot state until all gates pass:

1. Secret sentinel absent from every forbidden channel and cleared on session end.
2. HTTPS/private-IP/redirect/permission/origin/key-reentry tests pass with zero network calls
   on validation failure.
3. Provider response and image resource-limit tests pass.
4. Hosted and BYOK billing-separation database tests pass.
5. Device/shop/draft/SKU authorization and revocation tests pass.
6. Double-click, reload, retry, and uncertain publish tests produce exactly one Ozon receipt.
7. Stale draft and changed media fail closed.
8. Cloud/local packages contain no secret and no remote code.
9. Cloud package has no mandatory `<all_urls>` and requests Provider permission only after a
   user action.
10. Real Chrome desktop/mobile workbench QA passes for keyboard, focus, overflow, image
    loading, pause/continue, and result insertion.
11. Sandbox tests cover the exact user-configured endpoint/model/operation without paid
    production rollout.
12. Privacy disclosure states that selected prompts and images are sent to the user's chosen
    Provider.

## Phase 1 Open Decision

This analysis interprets the user's earlier instruction "connect to our listing API" as:

- BYOK Provider calls happen directly from the extension background;
- generated media is imported to ERP;
- final Ozon submission uses the existing ERP publisher.

It deliberately does not copy the reference extension's locally stored Ozon credentials and
direct Seller API calls. This boundary must be confirmed before task decomposition.
