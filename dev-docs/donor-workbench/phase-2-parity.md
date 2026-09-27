# Phase 2: Draft and Media Parity

- [ ] D2.1 Implement extension-side draft creation and selected SKU flow.
- [ ] D2.2 Replace donor generation runner with SS ERP hosted/BYOK adapters.
- [ ] D2.3 Port review/apply/assignment UX and replay handling.
- [ ] D2.4 Port process console/pause/recovery UI over command receipts.

## Current Slice

- The donor media stage now exposes one `OPEN_MEDIA_WORKBENCH` command. The parent source bridge translates it to the existing `ss-erp:source-ai-workbench-open` transport; the iframe cannot call `chrome.runtime`, provide authority fields, or dispatch Provider/Ozon requests.
- The existing service-worker owner rechecks the live source tab, persisted handoff, shop grant, draft revision and device authority before opening the established SS ERP hosted/BYOK workbench. Multi-SKU ambiguity remains explicit and is handed back to the existing SKU choice flow.
- Focused evidence: donor shell contract, runtime authorization/source workbench contracts, isolated Chromium desktop/mobile acceptance and unpacked MV3 source-page acceptance all pass. No Provider, Ozon or production mutation occurred.
