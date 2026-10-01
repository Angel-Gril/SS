# 旧扩展直接适配 SS ERP

## 当前结果：原采集器、草稿编辑及自定义托管套图审核已接线；最终包门禁已覆盖新增 precision/BYOK 模块

用户确认以 `C:\Users\550W\Downloads\jp20260803` 的成熟界面与操作流程为基础直接改造。旧目录保持只读，实际复用的源码放在 `extensions/ss-erp/pages/donor/`，入口为 `pages/precision-workbench.html`。当前产品开发不把新一轮付费 suite 或官网发布证据作为界面、采集和草稿接线的前置条件。

之前阶段的“完成”描述证明的是当时的接口/发布边界，不等于旧扩展全部功能已经可用。旧入口在 `donor-workbench-bridge.js/showFrame` 只有 precision flag 关闭时才回退到现有 media-focus 卡片；这是受控回退，不是默认切换完成。当前正式官网已发布 `3723f5dd / 1.0.395`，旧 MASTER 中 `1.0.388 / 1.0.364` 状态已失效；发布事实以 `current-state-audit.md` 的 2026-09-30 顶部记录为依据。

## 唯一 owner 与数据路径

- 旧 UI/CSS、商品表格、SKU 弹窗、图片预览与缩放：`pages/donor/ui/`；`precision-workbench.js` 是调用适配层。
- 本地顺序、并发与不确定结果：`shared/donor-workbench/precision-workflow.js`。`开始执行 → REFRESH → 原 SKU 弹窗 → COLLECT → CREATE_DRAFT → 精确店铺草稿读回`，取消选择不执行写入，未知写入不重试。
- 来源数据：precision 的 1688 入口现在直接调用复用的 `content/donor/adapter-1688.js`，通过 `shared/collectors/donor-1688-capture.js` 编译成既有 canonical Capture V2。原采集器读取本页 DOM、内嵌 JSON/SKU 模型；不请求 ERP 抓取商品，也不等待原页面状态桥接。淘宝/PDD 仍使用现有 SS ERP collector，尚未切换 donor 实现。
- 投影 owner：`workspace-contract.js`，保留 canonical SKU 的价格、零库存、来源 SKU ID，并通过 `mediaKeys` 找 SKU 图；兼容 `skuItems/sourceMainImages/sourceDetailImages`。只在没有 SKU 信息时使用既有产品级降级行。
- 本地 JSON 与直接提示词编译：`prompt-adapter.js`。允许编辑构图、背景、光线和风格；商品主体/SKU 事实仍从来源投影产生。
- 自定义托管创作方向：服务端 `ai-image-creative-brief.ts` 校验有界 `creativeBrief`，`ai-media-planning.ts` 将其纳入请求指纹、冻结输入及计划 hash，`ai-image-suite-prompts.ts` 将冻结方向用于最终 Provider prompt。初始计划仍按既有来源/设备/草稿 authority 唯一绑定，改方向不能自动创建第二个计划；无字段保持原计划结构。方向不是商品事实、参考素材或权限。Wanx 最终总长度仍限 800 Unicode 字符，超限明确拒绝，不截断。
- 同窗口套图审核：iframe 只读投影保留精确 workflow/output 与可审核/应用标记，按钮调用现有 `REVIEW_SLOT`，不让套图走通用 workflow 审核。旧输出、未授权槽位及另一店铺的候选不提供操作；assignment 仍由原 store-draft owner 执行。
- 同窗口发布：`source-workbench-publish-controller.js` 仅重建服务端当前草稿和已绑定素材的请求，复用既有统一 publisher。原“上传 Ozon”按钮先展示店铺、SKU 和图片顺序，明确确认才提交；`STATUS` 使用只读 `getState`，不调用可能重新派发的 `recover`。未知结果保留原请求且禁止盲重试，页面、编辑或版本变化废弃旧预览。权限仍由设备 `listing:publish`、店铺 grant 和服务端发布 readiness 决定，未新增权限。
- 每 SKU 包装：`source-listing-sku-packaging.ts` 为测量值/审核投影 owner，`source-listing-workflow.setSkuPackaging` 保留每 SKU 重量、长宽高，写入既有 `attributes.values.packaging.skuValues`。validator 和 Ozon compiler 逐 SKU 核验并取值，旧完整共同包装仍兼容；没有 schema 迁移。原表格独立保存包装，不清除未保存售价。值必须明确、有限且 >0，当前已选 SKU 必须完整覆盖，未核实/缺行不降级为共同值。
- 快照、身份、店铺、草稿：既有 Worker/device transport、createDraft owner，以及新增 `routes/extension-listing-editor.ts` / `services/extension-listing-editor.ts`。编辑器使用既有 `listing:review/listing:write`、精确店铺/快照/草稿版本、现有 rollout gate 与 source-listing-workflow 的 CAS。未调整 schema、身份或计费模型。
- 草稿保存：价格、折扣前价、货号、官方类目、每 SKU 包装和官方属性直接在原工作台编辑/保存。分类目录、属性 schema 和字典值从现有 Ozon catalog owner 读取；价格、类目、包装、属性 mutation 的操作标识/请求 hash 存入现有不可变 audit `details`，相同操作可以精确重放，异值/异版本/异租户请求拒绝，不重复提升草稿版本。俄文标题/描述通过待审核候选与 `VALIDATE` owner 接线；复制 SKU 行目前仍是本地编辑投影，尚未声明可持久化为服务端 SKU。

## 直接复用的 donor 文件

| Donor 路径 | SS ERP 位置/处理 |
| --- | --- |
| `ui/panel.html` | 提取原 CSS、主工作台、SKU/过程/预览弹窗；组成 `precision-workbench.html`，未带入原脚本、激活码或第三方凭据表单 |
| `ui/modules/product-editor.js` 与字段/表格依赖 | `pages/donor/ui/modules/`；保留原表格交互 |
| `ui/presentation/views/sku-picker-view.js` | 同结构复制到 donor 目录；使用 canonical row_id，不自动倒计时提交，未知价格显示 `--`，不捏造均码 |
| `ui/presentation/views/preview-view.js` | 同结构复制；预览、前后切图保留 |
| `ui/presentation/controllers/ui-scale-controller.js` | 同结构复制；原 `1440×960` 缩放方式保留 |
| `ui/modules/i18n.js` | 使用本地中文 fallback 薄适配；多语言尚待接线 |
| `content/strategies/adapter_1688.js` | 直接复用至 `content/donor/adapter-1688.js`；去除包装/库存默认猜值、保留零库存/未知价格 SKU，加入采集来源标记；未复制 injector 的网络/debugger 路径 |

原文件 SHA-256：

```text
ui/panel.html                                     5e4ada25fae272898382ce67aec9bc1773fe4d9ad925da4fe08318c500002f56
ui/modules/product-editor.js                     383b17578398dbb3f5b643247385557b6530582976e26d2aecfbccc1fb1176df
ui/presentation/views/sku-picker-view.js          e178494d0a14c073a62e480a78ca15c8384e4d83b5bf4ade0647bc4e51a5195c
ui/presentation/views/preview-view.js             51970a2702bd5adf748600c10263b8c90513684f88ed278cee1258d4cf53e67c
ui/presentation/controllers/ui-scale-controller.js eb6b5dfc126c8f0e52bae11d4eb6b227ddd031497d3492b0f26a1aaa57d1b6d6
```

## 验证与限制

### 2026-10-01 自定义托管方向与同窗口审核

- T2：提示词输入/持久化/hash、最终实际 Provider prompt、字段和凭据拒绝、原初始计划身份保持先 RED 后 GREEN。源页面和 iframe 的字段传递也完成 RED→GREEN。HTTP/runtime 客户端只允许精确计划版本的创作方向回显，未放开其他 Provider prompt/秘密字段。
- 浏览器 fixture 发现已投影报价在 `parseProjection()` 被当作原 API 响应重解，导致 quote/suite 丢失、生成按钮不可用；新增往返和损坏金额测试后修复。历史候选投影保持往返一致。
- 原窗口真实点击路径完成：SKU/售价/官方类目 → JSON 四方向与手工创作方向 → 准备计划 → 冻结输入 → 确认生成 → PENDING 候选预览 → `REVIEW_SLOT APPROVE` → APPROVED → assignment/readback。双击审核只提交一次，旧输出明确未选用，未授权/驳回/其他店铺候选不提供审核或应用按钮。证据：`C:\Users\550W\AppData\Local\Temp\ss-erp-precision-ui-evidence-FGlSis\summary.json`。
- 上述请求/生成输出/审核/assignment 均为明确的本地浏览器 fixture；后端另外使用现有实际 owner 和本地仓库测试，**尚未证明生产 Provider 或 Ozon 全链路**。本轮没有真实第三方请求、生产写入或费用。
- 发布接缝已完成本地验收：实际 coordinator 的离线垂直测试覆盖 preview→prepare→grant→执行响应丢失→只读 PENDING，executor 只调用一次；源页面 Worker 测试拒绝旧快照、非主 frame、另一商品和客户端自选素材。浏览器 fixture 中 4 次新预览、1 次确认、3 次只读状态核对（null→PENDING→SUCCEEDED），回执显示在原窗口；证据 `C:\Users\550W\AppData\Local\Temp\ss-erp-precision-ui-evidence-lbcgYu\summary.json`。该测试的 READY、执行响应和回执是明确 fixture，不代表真实 Ozon 发布。
- 包装已完成本地 owner/API/原表格验收：不同 SKU 的 350g/620g 及各自尺寸分别保存、读回，compiler 输出分别保持；相同请求 replay 不增加版本。复制 evidence 后的输出继续受现有 attributes JSON `256 KiB/16,384 节点` 限制。改变 SKU 后旧价格/包装不匹配时，编辑器返回明确待修复项，仍可打开修正，不把无效数据降级为已核实。最新联合浏览器证据 `C:\Users\550W\AppData\Local\Temp\ss-erp-precision-ui-evidence-W4ldbB\summary.json`；定向后端联合 12 文件 `296 passed`，包含 hosted plan/prompt、编辑器、workflow、属性、readiness、compiler 与 publisher。
- 已加载源码 MV3 的原采集器/precision iframe/负例 allowlist 通过，页面为 synthetic fixture：`C:\Users\550W\AppData\Local\Temp\ss-erp-donor-mv3-evidence-msEscV\summary.json`。Cloud/Local 未签名测试包输出 `.tmp-precision-workbench-ai-20261001`，分别 `545/541 pass`、`0 failure/0 warning`；之后新增参考图与官方属性接线，不得把此前包或 tree hash 当作最终 release receipt。
- 当前 precision frame/source admission、官方属性、手工俄文文案和自带 API 设置 owner 已接线；新的 BYOK 单图垂直切片已在同一 donor 工作台完成本地 fixture：来源页 launch → MEDIA_READY → readiness → 单次 Provider dispatch → PNG Blob 预览 → 明确审核 → ERP ingest → bound receipt/readback，且未知生成/接收结果只允许只读恢复（证据：`C:\Users\550W\AppData\Local\Temp\ss-erp-precision-ui-evidence-mwphHD`）。参考图分支的 source catalog → Blob preview → REFERENCE handle → setEditReferences → IMAGE_TO_IMAGE → candidate preview → edit-review handoff owner、FULL_EDIT/INPAINT 的 SOURCE/MASK 句柄准入及 donor 控件已接线，并通过 focused tests；图片翻译已接入既有 `CREATE_TRANSLATION` owner，并在 donor 浏览器 fixture 通过（证据：`C:\Users\550W\AppData\Local\Temp\ss-erp-precision-ui-evidence-a2nBmt`）。尚未完成真实 Provider/Ozon 验收；翻译质量、最终安装版验收仍未关闭，不切换默认入口。

### 2026-09-30 原采集器和草稿编辑

- 真实商品 `845581683597`，在现有已登录 Chrome 的独立只读 world 中执行复用采集器：**16 个 SKU、26 个图片素材，已加载页面上的采集与快照校验分别 67ms / 44ms**。耗时不包括网页首次加载、详情懒加载补采或 ERP 接口。没有 ERP/Provider/Ozon mutation；证据 `C:\Users\550W\AppData\Local\Temp\ss-erp-donor-live-readonly-Art6R0\summary.json`。此证据证明实时采集器，不能替代安装包完整流程验收。
- 商品投影在店铺/草稿 API 返回前先发布，关闭“本地数据已就绪却等待 ERP 才渲染”的延迟；refresh epoch 拒绝旧读取覆盖新数据。
- 4 项 donor parser/canonical 验证、editor client/封闭命令、actor/source sender、owner/revision/精确 SKU 测试通过；后端受影响 **144 passed**，扩展定向 **45 passed**。新增保存 replay/并发/持久化及草稿版本冲突先 RED 后 GREEN；最后的 editor owner **13 passed**，Server typecheck/lint/build 与 diff 检查通过。
- 新浏览器验收在原界面内执行 SKU 选择、填写售价/折前价、保存和官方类目选择，未打开 ERP Web 或独立工作台。还修复了目录加载完成前错误允许确认、空售价请求被桥接拒绝后等待超时，以及保存后售价币种标题不匹配。ERP 响应为明确 fixture，**不是生产保存验收**：`C:\Users\550W\AppData\Local\Temp\ss-erp-precision-ui-evidence-hG3YOa\summary.json`。
- 已加载源码 MV3 的原采集器 synthetic 页面：16 SKU 原工作台投影、negative allowlist、iframe 和无错误通过；`C:\Users\550W\AppData\Local\Temp\ss-erp-donor-mv3-evidence-1BKWvi\summary.json`。该次之后有响应/UX 收口变化，不能复用为正式 release receipt。
- 新测试包输出 `.tmp-precision-workbench-editor-20260930/ss-erp-cloud` / `ss-erp-local`；Cloud **541 pass**、Local **537 pass**，均 `0 failure / 0 warning`。这是本地未签名开发包；本轮未推送、部署或公开切换旧入口。

### A1 历史本地验收

- T2：8 项 workflow 行为先 RED 后 GREEN，覆盖 16 SKU 投影、零库存、精确 SKU/店铺、取消、来源变化、并发、未知写入不重试。提示词构图/光线编辑和新页面禁止直接网络调用也完成 RED → GREEN。
- 受影响来源、授权、权限、域名打包回归 43 项通过；独立 runtime authorization 19 项通过。新页面仍不接触 `chrome.runtime`、Provider/Ozon API、凭据或 account token，命令由来源页桥接提交。
- `extension-precision-browser-acceptance.mjs`：隔离 Chrome 147，真实点击原 SKU 弹窗的 16 选 2；采集/草稿命令各一次、表格仅显示选中的 2 个 SKU；图片解码/预览、空 referrer 初始化及 390px 布局通过。ERP 响应全部为显式 fixture，**不是生产草稿验收**。最新证据：`C:\Users\550W\AppData\Local\Temp\ss-erp-precision-ui-evidence-mDAbxe\summary.json`。
- 独立输出的 Cloud/Local 测试包分别通过 `535/531` 检查，均 `0 failure / 0 warning`；新 UI 的禁止直接 Provider/Ozon 网络请求门禁同时验证了注入违规代码会被拒绝。`git diff --check` 通过。
- `extension-donor-workbench-mv3-acceptance.mjs --precision`：真实源码 MV3 扩展加载与 iframe 商品投影通过，非 allowlist 商品拒绝。页面是拦截的测试商品页，**不是实时 1688 商品验收**。证据：`C:\Users\550W\AppData\Local\Temp\ss-erp-donor-mv3-evidence-vFGh8u\summary.json`；该次源码树摘要 `1d25fd741931b90dc6264236f73ab471905653b38119d2ea847ee90a843e2de1`，之后有 UI/验证器收口变化，不复用为正式 release receipt。
- 当前已接既有托管套图命令、报价/历史读取、显式最高费用确认和有上限的只读轮询；本轮未真实执行这些收费/写入动作。自定义 JSON/提示词尚未接入 hosted createPlan（现有合同只接受 binding/galleryGoals），界面明确标明本地草稿，不能宣称自定义提示词已影响托管输出。
- 仍未关闭：复制 SKU 行的服务端持久化、donor 淘宝/PDD collector、翻译质量、自带 API 最终安装版验收，以及真实 Provider/Ozon 全链路。参考图、全图修图和圈选重绘已经完成独立浏览器 fixture：`--byok-edit-quick`、`--byok-edit-full`、`--byok-edit-inpaint` 均通过 source catalog、Blob 预览、句柄上传、候选预览和审核 handoff；本轮没有 Provider/Ozon 请求、生产写入或费用。
- 本轮无 Provider/Ozon 请求、生产 mutation 或新增费用；未 commit、push、签名或部署本适配版。

## 本地预览与回退

预览仍要求现有 donor enabled 与精确商品 allowlist，同时设置新的 `ss-erp:precision-workbench-preview-enabled=true`。它只选择前端入口，不授予店铺、写入或生图权限。新 iframe 先通过 READY 收到投影，在空 referrer 时核验允许的 parent origin 并固定后续消息来源；页面输入不能成为服务端权威。

示例仅在新测试扩展自己的 Service Worker DevTools 执行：

```js
chrome.storage.local.set({
  'ss-erp:donor-workbench-preview-enabled': true,
  'ss-erp:donor-workbench-preview-allowlist:v1': ['1688:845581683597'],
  'ss-erp:precision-workbench-preview-enabled': true,
});
```

刷新同一商品页后“工作台”和 AI 按钮使用新界面。关闭 precision flag 会回到旧入口；清除 donor enabled 或该商品 allowlist 会卸载预览。禁止据此开启新的服务端 pilot 权限。

最新已验证的本地测试包输出在 `.tmp-precision-workbench-ai-20261001/ss-erp-cloud` 与 `ss-erp-local`，它早于继续进行的参考图/属性接线。之前阶段测试包仍保留；均不覆盖旧 release 产物，不是签名公开版本。

## 持续开发顺序

- [x] A1.1 直接复用原工作台、表格、SKU 弹窗、预览与缩放。
- [x] A1.2 在同一窗口接采集/所选店铺与 SKU 的草稿创建，并完成本地行为/浏览器/MV3 验证。
- [ ] A2.1 扩展草稿详情/字段保存和类目属性 owner 接口：**详情、售价/货号/官方类目、每 SKU 包装、官方属性、文案候选和 VALIDATE 已接线**；复制行的服务端持久化仍待完成。
- [x] A2.2 接通 donor 原 1688 采集器，完成 canonical 映射及同一实时商品的 SKU/图片只读验收；其他平台另行接线。
- [x] A2.3 接自定义提示词、单图/套图、修图、翻译与 hosted/自带 API 设置，同一工作台显示审核和应用：**自定义 hosted 方向、BYOK 单图、参考图/FULL_EDIT/INPAINT owner flow/控件、图片翻译 CREATE_TRANSLATION 入口、套图审核/应用、自带 API 设置和私有 frame/session owner 已完成本地接线与浏览器 fixture**；真实 Provider、翻译质量和最终安装版验收属于后续 A3 运行验收。
- [x] A2.4 接现有 ERP publisher 的预览、明确确认和回执到原上传按钮；本地 owner/浏览器 fixture 已通过，真实发布属于 A3。
- [ ] A3 在功能链完成后执行对应实时商品与第三方验收，再生成签名发布候选。

用户明确要求完整功能通过后排除旧扩展。当前保留旧入口作为回退；A2.3/A2.4 与最终功能验收完成后切换默认入口并退出旧媒体流程，不能因仅采集/编辑通过而提前删除共享权限、计费或 publisher owner。
