# SS ERP 扩展开发与整合计划

本文是当前版 Chrome 扩展的开发主文档。历史分析仍保存在 `docs/archive/`，但后续扩展整合、核价、采集和货源比价的判断以本文为准。

## 当前结论

扩展继续做成一个 `SS ERP - 松鼠跨境卖家助手`，不要拆成多个独立扩展。

原因：

- 核价、采集、货源比价、Ozon Cookie、ERP Token、汇率和物流配置共用同一套身份与数据。
- 拆成多个扩展会重复申请权限、重复配置 ERP 地址和 Token，也会让用户不知道该点哪个入口。
- 当前代码已经在 `extensions/ss-erp` 内整合了 Ozon 面板、计算器核心、ERP 推送和物流桥接，继续扩展成本最低。

UI 上需要拆模块，而不是拆扩展：

- 核价助手：Ozon 商品页和列表页核价、利润、汇率、物流方案。
- 采集助手：当前页商品采集，支持 Ozon、1688、淘宝/天猫、PDD。
- 货源比价：从 Ozon 主图发起 1688/PDD/淘宝搜图，国内货源先进入 ERP 上品列表，再做比价和上架加工。
- 设置/同步：ERP 连接、Ozon Cookie、店铺分析、配置同步。

Popup 不做按钮墙。第一屏只根据当前页面露出一个最可能需要的主动作，最多再露出一个上下文次动作：

- Ozon 商品页：主按钮“采集到 ERP”，下方仅露出一个上下文次级动作“核价找货源”。
- 1688/PDD/淘宝/天猫货源页：主按钮“核价”，次按钮“采集到 ERP”。
- seller.ozon.ru：同步 Cookie。
- 其他页面：打开设置或提示当前页不支持。

Ozon 搜图、候选货源、批量同步、店铺维护这类低频或多步骤能力，不在 popup 首屏平铺按钮。搜图只保留一个“核价找货源”入口；Ozon 商品页可勾选 1688/PDD/淘宝，默认启用 1688 和 PDD，选择会保存到 `ss-erp:source-search-platforms`，后续默认按上次选择打开。Cookie、店铺分析、经营图表放在 popup 的“同步与维护”折叠区中。

## 旧扩展资产盘点

| 来源 | 有价值能力 | 当前迁移状态 | 下一步 |
| --- | --- | --- | --- |
| `D:\AI Agent\Work\LS\AliPrice - TB以图搜同款 Beta` | 截图搜同款、右键菜单、快捷键、页面翻译类 UX | 第三方打包代码，直接复用价值低 | 只参考搜图入口和交互，不迁移核心代码 |
| `D:\AI Agent\Work\LS\ozon-selection-capture` | Ozon 商品采集、Ozon 主图到 1688/PDD/淘宝搜图、待生成记录、XLS 导出 | Ozon 基础采集已被当前扩展覆盖；1688/PDD/淘宝主图搜图桥已迁入；候选池只作为 Ozon 上下文辅助 | 真实页面回归 PDD/淘宝搜图上传成功率，XLS 导出改为备用能力 |
| `D:\AI Agent\Work\LS\test-extension` | 1688/淘宝/PDD 商品详情采集器，SKU、图片、价格、尺寸、库存提取较完整 | 当前扩展已有 1688/淘宝基础采集；PDD 商品采集第一版已接入 | 用真实 PDD 页面回归，再对齐 1688/淘宝字段质量 |
| `D:\AI Agent\Work\LS\旧自研插件` | Ozon 面板、seller 分析接口、1688/PDD 物流、ERP 配置页、旧 API 参考 | 大部分已迁入 `extensions/ss-erp` | 继续保留 API 参考，避免重复移植已完成模块 |

## 当前 `extensions/ss-erp` 状态

已完成：

- Ozon 商品页数据面板和列表页信息注入。
- Ozon public/seller 数据聚合，支持推送到 ERP `/api/collect/batch`。
- 计算器核心、佣金、汇率、物流数据和配置同步。
- 1688/PDD 物流查询桥接。
- 1688、淘宝/天猫、PDD 等页面的基础商品采集脚本。
- ERP 连接配置、Ozon Cookie 同步、店铺分析同步。
- Ozon Seller Cookie/company_id 同步已增加无感兜底：优先读取已打开 `seller.ozon.ru` 标签页里的 `document.cookie`，再回退到 `chrome.cookies`、网络捕获的 `x-o3-company-id` 和 ERP 已保存店铺配置，减少用户反复手动同步 Cookie 的情况。
- Popup 已收敛为一个智能主动作，连接状态和计算器数据保留在首屏，Cookie/店铺分析/经营图表同步放进“同步与维护”折叠区。
- Ozon 商品页“核价找货源”已接入 1688/PDD/淘宝主图搜图第一版：popup 采集当前商品主图并转码，service worker 只为用户已勾选的平台创建搜图任务，各平台页面桥负责上传图片并跳转结果。
- Ozon 商品采集会保存富文本简介和源视频元数据到 ERP metadata；富文本会优先用完整商品 slug 请求 Ozon 第二页详情 `layout_page_index=2`，再兜底短 `product_id` 路径。采集器现在不仅识别 `richAnnotationJson / richAnnotation` 老结构，也会兼容 `content / blocks / children / items / nodes / widgets` 这类新版富内容结构。当前只采集保存，不自动把源视频/富媒体重新发布到 Ozon 新商品。
- Ozon 采集到 ERP 的交互入口（popup、Ozon 面板、ERP Web 单采/批量采）默认走 `collectMode=balanced`：首轮先快速保存当前页商品、弹窗可见变体、价格和主图，不等待富内容详情页或 seller 细节接口；后台再静默补跑 `complete` 递归，把完整变体组合、富内容、源视频、类目和子 SKU seller 属性回写到同一条 ERP 采集记录。这样 ERP 最终仍会尽量拿到“每个真实 SKU = 完整属性组合”，但不会把 60+ SKU 商品的首轮采集时间全部压到前台等待。
- Ozon 上架清洗会保留 `AB-1` / `AB-6` 这类安全色号作为变体区分维度，并转为 `Название цвета` 上传；不会把这类色号当作 `Цвет` 字典颜色提交，避免“颜色属性值不正确”和“清洗后只剩尺码导致可变特性重复”同时出现。
- ERP Web 的“扩展采集”入口会先通过 `ss-erp:ping` 检测扩展桥接、扩展版本、ERP 地址/Token 和采集模块状态；如果浏览器仍在旧扩展、桥未注入或 Token 未同步，弹窗会直接显示诊断信息，而不是静默等待后端数据变化。
- 1688/PDD/淘宝/天猫货源页主动作已改为直接写入 ERP `/api/collect/batch`，采集成功后提示“已进入 ERP 上品列表”，并通知已打开的 ERP 采集页刷新。
- 候选货源本地池保留为辅助能力：在 Ozon 商品页打开扩展会记住 6 小时上下文，但不再作为国内货源采集的主保存路径。
- 国内货源核价闭环已接入第一版：Ozon 商品页点“核价找货源”会保存 Ozon 上下文并按已选平台打开 1688/PDD/淘宝以图搜同款；在 1688/PDD/淘宝/天猫货源详情页点“核价”会记录 `Ozon SKU/链接/售价`、`货源平台/链接/SKU/采购价`，切回 Ozon 商品页，并把采购价回填到核价面板的“采购”输入框。记录保存在扩展本地 `ss-erp:source-quotes`，可从 popup 的“同步与维护”折叠区导出 CSV，后续再接 ERP 导出入口。
- 国内货源价格识别已补强：1688/淘宝/天猫采集结果会输出顶层 `price`、`priceText`、`priceCny`、`currency`；PDD 采集器避免把页面里已经是元的价格误当成分再除以 100。
- Ozon 列表页注入样式以 `ss-erp-cloud-1.0.17` 的稳定商品信息卡为基准：保留原有列表卡片布局、采集按钮、展开按钮和展开态样式，不再未经确认重做列表页视觉结构。

当前可加载目录：

- 本地版：`D:\AI Agent\Work\QE\SS ERP\build\extensions\ss-erp-local`
- 云端版：`D:\AI Agent\Work\QE\SS ERP\build\extensions\ss-erp-cloud`
- 源码目录：`D:\AI Agent\Work\QE\SS ERP\extensions\ss-erp`

建议 Chrome 平时只加载 `build\extensions\ss-erp-local` 或 `build\extensions\ss-erp-cloud`，不要同时加载源码目录和 build 目录，否则会出现看起来“退回旧版本”的混合表现。

部分完成：

- Popup 当前支持按页面识别 Ozon 商品采集、Ozon 到 1688/PDD/淘宝找同款核价、搜图平台选择、国内货源核价回填、国内货源采集到 ERP、seller Cookie 同步；PDD/淘宝搜图已接入同一个“核价找货源”入口，仍需真实页面手工回归。
- 1688 和淘宝/天猫能采集基础数据，但还需要对齐旧 `test-extension` 的 SKU、阶梯价、重量尺寸和图片提取质量。
- Ozon 到 ERP 采集链路可用，国内货源到 ERP 上品列表链路已接通，但翻译、类目映射、属性映射和改款上架前的字段检查还未完整收口。
- Ozon 视频/富媒体目前是采集保存能力，不是发布能力；发布时会过滤源商品的视频封面、富媒体和富文本属性，避免 Ozon 因无效视频封面链接或不可复用媒体字段拒绝新商品。
- Ozon Cookie 同步会按“手动 companyId -> 当前 seller header -> `sc_company_id` cookie -> ERP 店铺已保存 companyId”兜底；用户右上角同步 Cookie 后不应再因为已保存 companyId 缺失而反复要求去 seller 页面手动同步。
- Ozon 佣金同步优先使用 `global-help.ozon.com` 的 CHN 佣金页；若 Ozon 帮助中心返回 403 或 `__rr` 重定向循环，扩展会保存本地 CHN 兜底佣金快照，并在 diagnostics 记录在线同步失败原因。
- Ozon 标题采集如果出现中文标题，不再把中文内容保存为 `publishTitleRu`，也不再作为 ERP 上品列表主标题。扩展在 SKU/批量采集时会优先用 seller insights 返回的非中文标题修复；服务端再兜底从 Ozon 商品 URL slug 生成非中文展示标题，最后才使用 `Ozon SKU <sku>`，并标记 `titleNeedsReview`。`Ozon SKU <sku>` 只表示俄文标题来源失败，不是正常标题方案。
- Ozon 上架标题生成会跳过中文变体值，避免浏览器/Ozon 中文语言环境采到的 `咖啡色`、`浅米色` 等颜色被拼进俄文标题；`52 RU / XL` 这类国际尺码会保留数字和尺码文本。

缺口：

- PDD 商品详情采集已接入第一版，但还需要真实页面回归 `mobile.pinduoduo.com`、`mobile.yangkeduo.com`、`pifa.pinduoduo.com` 的实际字段结构。
- Ozon 主图发起 1688/PDD/淘宝搜图已迁入；PDD/淘宝页面上传桥仍需用真实登录环境回归。
- ERP 中针对国内货源的翻译、Ozon 类目映射、属性映射、图片处理和水印流程还需要继续做成稳定上架链路。
- 旧 `ozon-selection-capture` 的待生成记录目前还是独立 XLS 思路，尚未映射到 ERP 数据模型。

## 目标产品流程

1. Ozon 商品页打开扩展或页面面板。
2. 用户可以直接核价，看到售价、汇率、佣金、物流、利润和建议采购价。
3. 用户点击以图搜货源，扩展用 Ozon 主图打开已勾选平台的搜图结果；默认打开 1688/PDD，淘宝由用户按需开启。
4. 用户在 1688/PDD/淘宝/天猫货源详情页有两个清晰动作：
   - 点“核价”：记录货源 SKU、货源链接、采购价、Ozon SKU、Ozon 链接和售价，自动回到 Ozon 商品页，把采购价填入核价面板并重新计算。
   - 点“采集到 ERP”：读取标题、价格、SKU、规格、库存、图片、重量尺寸、属性和链接，同步到 ERP `/collect` 自助上品列表。
5. 国内货源采集进入 ERP 后，保留中文源标题并标记需要翻译/审核，不把中文标题当作 Ozon 上架标题。
6. ERP 继续完成标题/描述翻译、Ozon 类目/type 映射、属性映射、图片处理和水印，然后通过 `/api/collect/publish-ozon` 上架到 Ozon。

## MVP 收口范围

第一轮只做能跑通的主链路：

- Popup 使用当前页智能主动作，不平铺多个按钮。已完成第一版：Ozon 商品页采集到 ERP，Ozon 商品页核价找货源，1688/PDD/淘宝/天猫货源核价回填，1688/PDD/淘宝/天猫采集货源到 ERP，seller.ozon.ru 同步 Cookie。
- Manifest 接入 PDD 商品详情采集页面。第一版已完成，覆盖 `*.pinduoduo.com` 和 `*.yangkeduo.com`。
- 从 `test-extension` 迁移 PDD 采集器到共享采集模块。第一版已完成：`extensions/ss-erp/shared/collectors/pdd-product.js`。
- 国内货源采集主路径复用 ERP `/api/collect/batch`，统一进入 `/collect`；`sourceCandidate` 只保留为 Ozon 上下文和比价辅助数据结构。
- 国内货源核价主路径使用 `sourceQuote`：它记录已选择的真实货源、采购价、货源 SKU 和 Ozon SKU，并负责回填 Ozon 核价面板；它不替代国内货源采集入 ERP。
- 从 Ozon 商品页发起搜图任务，迁移旧图片上传桥接。1688/PDD/淘宝第一版已接入同一个入口，支持保存平台选择，待真实页面回归。
- ERP 后续补齐翻译、类目映射、属性映射和改款上架前检查；如果要做“一对多候选货源比价”，再新增专门候选货源 endpoint。

## 实现优先级

1. 文档和边界：本文档、模块划分、当前状态清单。
2. PDD 商品采集：补 manifest 匹配、迁移提取器、统一字段到现有采集 payload。第一版已完成，待真实页面回归。
3. Popup 智能主动作：首屏只保留一个当前页动作，维护动作折叠收起。第一版已完成。
4. 搜图桥接：迁移 1688/PDD/淘宝上传与结果页跳转，但入口必须接在 Ozon 商品页主动作后或页面面板里，不能新增成多个常驻按钮。1688/PDD/淘宝第一版已完成，并支持保存平台选择，待真实页面回归。
5. 国内货源入 ERP：1688/PDD/淘宝/天猫商品页采集后直接写入 ERP `/collect`。已完成第一版。
6. 比价与 ERP 上架加工：把采购价、运费、汇率、佣金、翻译、类目映射和属性映射结果写入 ERP，并进入 Ozon 上架链路。

## 验证清单

每次改扩展后至少执行：

```bash
pnpm verify:extension
```

本轮新增的 Ozon 回归测试：

```bash
node --test scripts/extension-ozon-variant-currency-scope.test.mjs
node --test scripts/extension-ozon-list-overlay-ui.test.mjs
```

国内货源采集进入 ERP 的回归测试：

```bash
node --test scripts/extension-source-collect-to-erp.test.mjs
node --test scripts/extension-erp-submit-collect-routing.test.mjs
```

国内货源核价回填的回归测试：

```bash
node --test scripts/extension-source-quote-store.test.mjs
node --test scripts/extension-source-quote-flow.test.mjs
node --test scripts/extension-source-price-extraction.test.mjs
```

涉及具体平台能力时，需要手工验证：

- Ozon 商品页：面板加载、商品采集、推送 ERP、核价结果。
- Ozon 列表页：信息卡注入不阻塞页面滚动。
- 1688 商品页：标题、价格、SKU、图片、重量尺寸。
- 淘宝/天猫商品页：标题、价格、SKU、图片。
- PDD 商品页：标题、价格、SKU、图片、库存。
- 1688/PDD/淘宝搜图结果页：图片上传、跳转、错误提示。
- ERP 页面：采集完成通知、`/collect` 上品列表记录可见。

PDD 采集器单测：

```bash
node --test scripts/extension-pdd-collector.test.mjs
```

搜图与候选货源辅助能力相关单测：

```bash
node --test scripts/extension-source-candidate-store.test.mjs
node --test scripts/extension-image-search-job.test.mjs
node --test scripts/extension-image-search-integration.test.mjs
```

## 暂不做

- 暂不拆成多个扩展。
- 暂不把后端密钥、OSS/R2 密钥或 Cloudflare Token 放进扩展。
- 暂不把 Premium 模拟作为用户可见卖点；相关代码只在明确需要和合规可接受时保留。
- 暂不把 XLS 作为主流程，最多保留为导出备份。

## 待确认问题

- 是否需要新增“一对多候选货源/比价记录”接口；当前国内货源主链路已复用 `/api/collect/batch`。
- ERP `/collect` 是否需要增加更明显的“待翻译/待类目映射/待属性映射”筛选和批处理视图。
- PDD 目标页面范围：`mobile.pinduoduo.com`、`mobile.yangkeduo.com`、`pifa.pinduoduo.com` 是否都要支持商品详情采集。

## 2026-06-11 调试记录

- `parsePriceWithCurrency is not defined` 的根因是 Ozon 变体解析函数引用了 `collectOzonViaApi()` 内部的局部价格解析变量。已改为顶层安全 helper，并把 `currency` 显式传给 `extractOzonVariants()`。
- 列表页 UI 误改的直接原因是把“不要 popup 按钮墙”的要求错误套到了 Ozon 列表页 overlay。已按 `C:\Users\550W\Downloads\ss-erp-cloud-1.0.17\ss-erp-cloud\content\ozon-list-overlay.js` 恢复稳定样式，并新增静态测试防止再次回到误改的轻量详情样式。
- 云端版比本地版更容易读到 Ozon 列表 Premium 数据，通常是因为云端能走 ERP 缓存/线上授权链路；本地版依赖本机后端、Token、Cookie、seller 授权和本地缓存状态。两版前端采集原理一致，但后端数据链路和缓存命中率不一定一致。
- 国内货源采集没有出现在 ERP 的根因是 popup 原先调用 `ss-erp:source-candidate-upsert`，只写入扩展本地 `chrome.storage.local`。现已改为 `ss-erp:collect-source-to-erp`，service worker 通过 `SS_ERP_CLIENT.submitCollect({ items })` 写入 ERP `/api/collect/batch`，local/cloud 适配器会按 `items` 自动走批量采集接口。
- 国内货源核价采购成本已改为保守策略：1688/淘宝/天猫优先识别已选 SKU 行价格；未选 SKU 且页面展示价格区间时取高价；同时采集国内运费字段，`source.price` 保留商品单价，`source.shippingFee` 保留运费，回填到 Ozon 面板的 `costCny` 使用 `商品单价 + 国内运费`。PDD 继续优先普通价字段，并补充运费和总成本字段。
- 旧 `D:\AI Agent\Work\LS\ozon-selection-capture` 的国内货源逻辑是 DOM 文本估算 `商品价 + 运费 - 首单减免`，可参考运费识别，但没有准确绑定 1688 选中 SKU；当前扩展不扣新人/首单优惠，避免核价偏低。
