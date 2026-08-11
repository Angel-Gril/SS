# Extension seamless sync and Ozon list performance

## Scope

This analysis compares the installed reference extensions with SS ERP for three workflows:

1. connecting an enabled extension to an authenticated ERP session;
2. keeping the current Ozon Seller Cookie binding fresh;
3. enriching Ozon buyer-list cards without blocking page rendering.

The reference packages are treated as behavioral examples only. Their code, assets, credentials, request proxies, and permission defaults are not copied.

## Reference behavior

### Penguin 5.2.2

- ERP authentication is read from a website Cookie when a request needs it. It is not a persistent backend connection.
- Seller requests are executed in an already-open Seller tab with same-origin browser credentials.
- List discovery combines a broad subtree observer with repeated scans and per-card waits.
- Seller enrichment is primarily per SKU and sequential.

This produces a convenient login experience, but its broad Cookie lookup, raw credential logging, externally supplied messages, and generic URL proxy are outside the SS ERP security boundary.

### Maozi 3.0.7

- The ERP bearer token is polled from page local storage every two seconds and copied into extension storage.
- Seller requests are relayed through an open Seller tab. A separate command can refresh that tab.
- List discovery reacts to a narrower product container and filters some self-inserted nodes.
- Enrichment remains predominantly per SKU.

The targeted observer is useful. Copying an account bearer token, exposing a generic API proxy, broad host permissions, and automatic page refresh are not acceptable for SS ERP.

## SS ERP implementation

### Seamless ERP connection

The logged-in ERP topbar now performs a silent, bounded device bootstrap when the extension has no authorization:

- the ERP page creates a one-time pairing code through its authenticated account session;
- the trusted packaged ERP bridge sends only the code, deployment ID, and device label to the extension;
- the resulting device session is created only when the account has exactly one active Ozon shop, and is limited to that shop plus the single `capture:write` scope;
- exact owner, session, shop, and scope equality is verified before the connection is accepted;
- the account token is never copied into extension storage;
- an existing paired, invalid, unreachable, or cross-account session is not silently replaced;
- immediately before a silent claim runs inside the worker's serialized claim queue, it atomically
  rechecks that authorization is still required, so a manual higher-scope pairing that completed
  first cannot be replaced or downgraded;
- multi-shop accounts retain the explicit shop-selection pairing flow.

When an extension is installed, upgraded, or starts with an ERP page already open, the worker injects the idempotent bridge only into the ERP origins declared in the packaged manifest. The bridge emits a same-origin ready event and the page retries the bounded bootstrap. Normal MV3 worker wake-ups do not reinject scripts. No page reload is required.

### Seller Cookie lifecycle

Cookie synchronization remains a device-authorized ERP write, not an unrestricted browser Cookie export.

- a completed `https://seller.ozon.ru/*` tab schedules a Cookie-only sync;
- relevant Ozon authentication Cookie changes schedule the same flow;
- worker startup checks for an existing Seller tab before scheduling;
- a successful device claim schedules the first sync;
- bursts are debounced for 750 ms and share one in-flight request;
- `sc_company_id` changes retain the existing full company-switch maintenance path;
- removed/added Cookie replacement bursts are coalesced and full maintenance is serialized;
- after a removed auth Cookie settles for 750 ms, the worker rechecks live auth Cookies; if none remain and the captured company still exactly matches the ERP shop binding, it clears only the stored Cookie through the existing device-scoped CAS/UNKNOWN guard;
- both Cookie-store queries must succeed before absence is authoritative; a partial Chrome Cookie
  API failure keeps the ERP Cookie and company capture intact;
- after the guarded ERP clear succeeds, the worker checks once more for a replacement login,
  clears the captured company only when auth is still absent, and always broadcasts a new cache
  epoch so metrics from the signed-out account cannot remain visible;
- company removal or replacement immediately invalidates buyer-list cache epochs before new metrics can render;
- ordinary lifecycle events do not run analytics or graph synchronization;
- exact live company/shop matching still fails closed;
- Cookie values are not logged, and Seller tabs are never reloaded automatically.
- device claim, device clear, Cookie company changes, and captured `x-o3-company-id` changes all invalidate background and content cache generations.

### Buyer-list discovery

Before this change the page performed an initial scan, a subtree-triggered scan, a full scan every 500 ms for 20 seconds, and then a full scan every two seconds indefinitely. Each scan repeated seven overlapping selectors and additional full-page SKU queries.

The new scheduler performs:

- one initial combined-selector scan;
- incremental discovery from MutationObserver `addedNodes`;
- `href` observation for Ozon virtual-card reuse;
- filtering of SS ERP-owned DOM to prevent feedback loops;
- root coalescing with an 80 ms debounce;
- one visible-page safety scan every 10 seconds;
- a `WeakMap<Element, SKU>` guard so a reused card can be rebound to its new SKU;
- detached/reused-card checks before an asynchronous response renders.

This reduces scheduled full scans from roughly 60 per visible minute to at most 6, a 90% reduction, while preserving a low-frequency recovery path for unobserved Ozon UI changes.

### Buyer-list enrichment

Ordinary list cards now use the `list-card` profile:

- `includeOffers` is explicitly false; seller-offer detail remains available in publish workbench flows;
- Seller analytics and Seller search start concurrently;
- the global Seller request limit remains three, so parallelism does not increase the page-wide request burst;
- variant detail is requested only when the selected card fields require weight or dimensions;
- public full-product fallback checks only title, brand, and category for list cards instead of requiring variants and model IDs;
- direct list aggregation reuses the existing background cache and in-flight deduplication;
- cache keys include the live Seller company, enrichment profile, SKU, offers mode, and detail mode;
- the in-memory cache is capped at 300 entries and is not used when company context cannot be resolved.
- Seller list work is globally limited to three active requests, 60 pending requests, and an 18-second queue deadline; interactive work is ordered ahead of list preload work.
- `list-card` requests skip the legacy-token, per-SKU ERP cache GET and blocking cache POST; the full workbench retains that compatibility path.
- a failed or expired variant-detail request no longer discards analytics/search data that already succeeded.

For the default card, the primary per-SKU path changes from four sequential requests (analytics, search, offers, detail) to two concurrent requests plus detail only when configured fields need it. Public fallback remains available for missing list fields.

## Deliberate follow-up work

The following are separate improvements, not prerequisites for this change:

- a device-scoped ERP KPI batch-read endpoint to replace the legacy-token, per-SKU cache read;
- page-level batching for automatic product-pool writes triggered by selection rules;
- production telemetry for card discovery time, cache hit rate, Seller response latency, and rate-limit responses;
- a short-lived Seller-tab request context to reduce repeated Chrome permission/tab lookup IPC.

These need their own response schemas, tenant boundaries, and load tests. They should not be implemented as a generic URL proxy or by persisting raw Seller Cookies in the content page.
