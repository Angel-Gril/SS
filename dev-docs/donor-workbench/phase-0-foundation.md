# Phase 0: Foundation and Safety

- [x] D0.1 Freeze donor inventory and forbidden module list. Acceptance: the donor-workbench inventory/risk documents are current and donor source remains untouched.
- [x] D0.2 Add extension-device `CREATE_DRAFT` command owner. Acceptance: route/service tests cover owner, shop, snapshot, SKU, gate, scope and idempotency boundaries.
- [x] D0.3 Add listing client/worker message wiring. Acceptance: strict transport contract passes and caller cannot provide owner/hash/revision/draft IDs.

## Notes

- 1.0.365 localhost hotfix is separate and already pushed.
- Donor source is at `C:\Users\550W\Downloads\jp20260803`; do not copy license, Ozon, Provider or debugger modules into the production package.
- `CREATE_DRAFT` is accepted only from exact supported 1688/PDD/Taobao/Tmall product-page content scripts. Extension pages, ERP/Ozon pages and source search/home pages are denied; the future iframe must relay through the source-page bridge.
- Focused evidence: server route/service `40/40`, extension source workbench contract, runtime message authorization `19/19`, server typecheck, full lint and source extension verifier `462/0` pass.
