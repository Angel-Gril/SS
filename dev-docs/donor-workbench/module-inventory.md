# Donor Module Inventory

> **2026-11-11 方向变更**：本目录记录的是“保留 donor 界面、把基础设施全部换成 ERP 托管”的迁移方案。
> 该方案已被产品裁决取代：扩展改为精铺式直连，ERP 只做设备授权与最终数据同步。
> 当前真源见 [`../extension-direction.md`](../extension-direction.md)；下文保留为历史记录，其中“禁止直连 Ozon/Provider”的条款不再适用于扩展。

| Area | Donor modules | Reuse decision | Replacement owner |
| --- | --- | --- | --- |
| Page shell | `content/injector.js`, `ui/panel.html`, panel CSS | Reuse interaction model and iframe shell after sanitization | SS ERP MV3 manifest/content bridge |
| Product editor | `ui/presentation/views/product-editor-view.js`, `ui/modules/product-editor*` | Reuse rendering/state boundaries; remove direct credential assumptions | SS ERP draft projection and mutation commands |
| SKU/category | `sku-picker-view.js`, `category-picker-view.js`, attribute search/controllers | Reuse UI; feed server-owned catalog/category contracts | SS ERP source listing routes/services |
| Workflow state | `ui/app/state-store.js`, `ui/app/workflows/run-workflow.js`, workflow stages | Reuse staged state/pause/recovery patterns | SS ERP command receipts and revisions |
| Images | `ui/modules/image-management/*`, image queue/preview views, `image-generation/*` | Reuse image selection, queue and prompt/JSON presentation; replace donor runner with deterministic source-fact prompt adapter and one-use handoff | SS ERP hosted/self-supplied API Key workbench and media-channel contracts |
| Process console | `process-console-controller.js`, process views | Reuse staged status, cancel and retry-safe recovery UX; do not invent pause for ordinary tasks | SS ERP sanitized task projection and command receipts; hosted suite pause/continue stays in its workbench owner |
| Store manager | `store-manager-controller.js`, `ui/modules/ozon/store-config.js` | Rebuilt as a device-only shop picker/read-only grant projection; legacy account-token fallback is forbidden for donor | Device shop grants and server shop owner |
| Billing | donor task estimates/local Provider accounting | Replace with read-only frozen quote, reservation status and latest settlement summary; never expose ledger IDs or make iframe state authoritative | SS ERP suite pricing, cost reservation and settlement owners |
| Provider settings | donor provider controllers/adapters | Do not copy key storage or direct calls | Existing SS ERP self-supplied API Key settings/background worker; key remains session-only |
| Ozon upload | donor `ui/modules/ozon/*`, `ozon-upload-workflow.js` | Remove direct writer; donor only opens the exact extension publish-review workbench and never carries a publish payload | Existing SS ERP publisher preview/grant/receipt/reconciliation |
| License/update | donor license and update-checker | Remove | SS ERP auth, version/publication contracts |

The donor UI has roughly 80 relevant shared/app/presentation files. Porting it wholesale would also import secret-bearing and direct-write modules, so the first implementation should copy only shell/editor/state/image/process layers and replace adapters before packaging.
