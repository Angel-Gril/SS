# Phase 2: Draft and Media Parity

- [x] D2.1 Implement extension-side draft creation and selected SKU flow.
- [x] D2.2 Replace donor generation runner with SS ERP hosted/BYOK adapters.
- [x] D2.3 Port review/apply/assignment UX and replay handling.
- [ ] D2.4 Port process console/pause/recovery UI over command receipts.

## Completed Slice

- The donor draft stage calls the existing device-scoped `CREATE_DRAFT` owner with only the selected shop and source SKU keys. The server still derives owner, device, snapshot, capture hash, workflow identity and initial draft revision.
- The donor media stage selects one processing SKU, source references and editable visual JSON/positive/negative prompts. A deterministic local adapter compiles source-fact-bound prompt text without a second AI planner request and without inventing product facts.
- The iframe exposes one `OPEN_MEDIA_WORKBENCH` command. The source bridge first preserves any live source-page SKU selection; if the server returns `choice_required`, it replays once with the user's processing SKU plus the server binding. The iframe cannot call `chrome.runtime`, provide authority fields or dispatch Provider/Ozon requests.
- After the existing service-worker owner rechecks the source tab, persisted handoff, shop grant, draft revision and device authority, it opens the established ERP-hosted/self-supplied API Key workbench. An optional prompt is staged only in `chrome.storage.session`, bound to the exact workbench tab plus source/draft/SKU context, expires within ten minutes and is consumed once. Review-only, candidate-present, unknown-outcome and non-empty-input states consume without applying it.
- Focused evidence: prompt adapter/handoff, donor shell, workbench client/runtime, runtime authorization and source-listing contracts pass; isolated Chromium proves multi-SKU prompt regeneration, source-SKU locking and the final launch command; the actual AI workbench proves the donor prompt reaches the Provider fixture across the existing four-operation/review flow. Unpacked MV3 source-page injection also passes. Real Provider requests, Ozon writes and production mutations remain zero.
- The review stage now loads the bounded server media history for the exact selected listing revision, renders sanitized candidate previews and exposes only `REVIEW_APPROVE`, `REVIEW_REJECT` and `APPLY_APPEND` when the authoritative item state permits them. Every mutation opens the existing independent confirmation page; the bridge cannot approve or assign directly.
- Confirmation completion triggers a fresh status/history read. The original persistent mutation intent and listing client continue owning the stable review/apply idempotency keys; the donor surface only displays the returned replay bit as “no duplicate write”. Candidate URLs are independently reduced to public HTTPS and reject localhost, private/link-local IPv4, metadata hosts, credentials, fragments and IPv6 literals.

## Remaining

- `D2.4`: drive process, pause and recovery presentation from authoritative command receipts rather than optimistic iframe state.
