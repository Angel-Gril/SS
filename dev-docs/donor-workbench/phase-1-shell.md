# Phase 1: Donor Workbench Shell

- [x] D1.1 Add sanitized donor iframe shell and source-page bridge.
- [x] D1.2 Port donor state/stage/process presentation with SS ERP adapters.
- [x] D1.3 Port donor image manager/prompt JSON presentation.

## Notes

- The donor iframe shell and `postMessage` source handoff are the primary UX reuse target.
- The migrated shell is implemented under `extensions/ss-erp/`; the donor directory remains unchanged. A source-page content bridge is the only runtime caller, and both bridge and iframe independently sanitize the projection/command contract.
- Preview remains default-off behind `chrome.storage.local['ss-erp:donor-workbench-preview-enabled']`; the current source panel remains the production rollback entrypoint.
- The shell renders collection, draft, category, media and review stages; shop/SKU creation calls the Phase 0 `CREATE_DRAFT` owner. JSON visual description is a local presentation draft and does not call a Provider or claim server confirmation.
- Evidence: static shell contract, offline Chromium at 1440x900 and 390x844, and real unpacked MV3 injection on a synthetic 1688 product page pass. The MV3 iframe received the real content-script capture projection; page errors, unexpected network, production mutations, Provider and Ozon requests were all zero.
