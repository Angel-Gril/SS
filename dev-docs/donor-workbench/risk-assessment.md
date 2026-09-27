# Migration Risks

## P0

- Credential boundary: donor stores Ozon/Provider keys in extension storage and calls third parties directly. Any copied path must be removed or routed through SS ERP server/device contracts.
- Draft authority: donor's local `productDrafts` cannot become SS ERP listing draft truth. Every create/update must carry owner, shop, snapshot, revision and idempotency.
- Billing/retry: donor's image queue has no SS ERP reservation/unknown-outcome semantics. Hosted generation must stay behind existing suite/command contracts.
- Publish: donor `upload Ozon` must never be wired directly; only existing publisher grant/receipt/reconciliation may publish.

## P1

- Donor iframe is injected into marketplace pages and can preserve a smooth flow, but sender/page binding must use existing MV3 message authorization and exact source identity.
- Donor's large single panel may conflict with SS ERP extension page CSP and package verifier. Use an isolated workbench page/iframe with a thin bridge.
- Donor local state and SS ERP server revisions can drift. Add explicit projection revision and stale-state UI before mutation.

## P2

- Donor's i18n and visual system can be reused, but copy must be adapted to truthful SS ERP states.
- Vendor libraries and docs should stay outside the first production package until their license, size and security implications are reviewed.
