# Donor Module Inventory

| Area | Donor modules | Reuse decision | Replacement owner |
| --- | --- | --- | --- |
| Page shell | `content/injector.js`, `ui/panel.html`, panel CSS | Reuse interaction model and iframe shell after sanitization | SS ERP MV3 manifest/content bridge |
| Product editor | `ui/presentation/views/product-editor-view.js`, `ui/modules/product-editor*` | Reuse rendering/state boundaries; remove direct credential assumptions | SS ERP draft projection and mutation commands |
| SKU/category | `sku-picker-view.js`, `category-picker-view.js`, attribute search/controllers | Reuse UI; feed server-owned catalog/category contracts | SS ERP source listing routes/services |
| Workflow state | `ui/app/state-store.js`, `ui/app/workflows/run-workflow.js`, workflow stages | Reuse staged state/pause/recovery patterns | SS ERP command receipts and revisions |
| Images | `ui/modules/image-management/*`, image queue/preview views, `image-generation/*` | Reuse image selection, queue, prompt/JSON presentation | SS ERP hosted/BYOK workbench and media-channel contracts |
| Process console | `process-console-controller.js`, process views | Reuse UX and event presentation | SS ERP sanitized runtime events |
| Store manager | `store-manager-controller.js`, `ui/modules/ozon/store-config.js` | Rebuild as shop picker/read-only grant projection | Device shop grants and server shop owner |
| Provider settings | donor provider controllers/adapters | Do not copy key storage or direct calls | Existing SS ERP BYOK settings/background worker |
| Ozon upload | donor `ui/modules/ozon/*`, `ozon-upload-workflow.js` | Do not copy direct API writer | Existing SS ERP publisher grant/receipt/reconciliation |
| License/update | donor license and update-checker | Remove | SS ERP auth, version/publication contracts |

The donor UI has roughly 80 relevant shared/app/presentation files. Porting it wholesale would also import secret-bearing and direct-write modules, so the first implementation should copy only shell/editor/state/image/process layers and replace adapters before packaging.
