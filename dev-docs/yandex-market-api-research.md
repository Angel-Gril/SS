# Yandex Market Partner API 研究（只读）

## 研究边界与来源

- 研究日期：2026-10-24（Asia/Shanghai）。
- 主要来源：Yandex Market Partner API 官方中文文档，revision `r21727032`，入口为 [`index.md`](https://yandex.ru/dev/market/partner-api/doc/zh/index.md?revision=r21727032)。
- 所有 URL 均为 `yandex.ru/dev/market/partner-api` 官方文档或官方 Yandex Market API 规范仓库；本文件没有调用真实店铺、没有发送 Yandex 请求、没有保存 API Key。
- API 生产主机：`https://api.partner.market.yandex.ru`。请求版本必须以官方当前 operation 页面为准，不能把 Ozon endpoint 或 Ozon 的店铺 ID 直接套用到 Yandex。

## 认证、店铺和权限模型

### API Key 是第一阶段默认方案

官方已将 OAuth 标记为过时；新集成应在 Yandex Market 卖家后台创建 API Key，并通过 `Api-Key: <token>` 请求头发送。API Key 长期有效，直到在后台删除；创建时可以按方法组配置权限。来源：[`授权`](https://yandex.ru/dev/market/partner-api/doc/zh/concepts/authorization.md?revision=r21727032)、[`创建和使用 API-Key`](https://yandex.ru/dev/market/partner-api/doc/zh/concepts/api-key.md?revision=r21727032)、[`API-Key 方法访问类型`](https://yandex.ru/dev/market/partner-api/doc/zh/concepts/access.md?revision=r21727032)。

当前与 SS ERP 第一阶段直接相关的 scope：

| 目的 | 官方 scope |
| --- | --- |
| 商品目录/卡片/销售条款写入 | `offers-and-cards-management` |
| 商品和卡片只读导入 | `offers-and-cards-management:read-only` |
| 价格写入/读取 | `pricing` / `pricing:read-only` |
| 库存、订单处理、装箱和订单状态 | `inventory-and-order-processing` |
| 仅订单读取 | `inventory-and-order-processing:read-only` |
| 店铺和仓库设置 | `settings-management` |

正式接入必须由用户在 Yandex 卖家后台生成并粘贴 Key；SS ERP 只应保存加密凭据引用和 scope 快照，不应把 Key 写入日志、前端、Git 或普通测试 fixture。真实店铺写入和 Key 使用需要另行授权；本研究没有获得该授权。

### `businessId`、`campaignId` 和仓库 ID 不是同一个 ID

- `GET /v2/campaigns`（operation：`getCampaigns`）返回当前 API Key 可访问的店铺列表，使用 `pageToken`/`limit` 分页；API Key 返回的是该柜台下的店铺集合，不能据此猜测子代理店铺。来源：[`用户的商店列表`](https://yandex.ru/dev/market/partner-api/doc/zh/reference/campaigns/getCampaigns.md?revision=r21727032)。
- `campaignId` 是某个 Yandex 店铺的技术标识；`businessId` 是柜台/商家级标识。官方明确警告不要把卖家后台展示的“商店 ID”或营销广告 ID 当成 `campaignId`。商品目录、跨店默认价格、仓库组使用 `businessId`；店铺销售条款、店铺订单、店铺库存/价格使用 `campaignId`。
- 接入时应先通过 `getCampaigns` 建立 `campaignId ↔ businessId ↔ shop` 映射，再读取设置和仓库；所有后续请求必须使用服务端保存的映射，不接受用户在 URL 中任意替换 ID。店铺必须归属于当前 ERP 用户/组织。
- `GET /v2/campaigns/{campaignId}`（`getCampaign`）读取店铺资料；`GET /v2/campaigns/{campaignId}/settings`（`getCampaignSettings`）读取店铺设置。来源：[`商店资料`](https://yandex.ru/dev/market/partner-api/doc/zh/reference/campaigns/getCampaign.md?revision=r21727032)、[`存储设置`](https://yandex.ru/dev/market/partner-api/doc/zh/reference/campaigns/getCampaignSettings.md?revision=r21727032)。

## 商品导入、类目和发布

Yandex 的“商品发布”不是把 Ozon SKU 原样 POST 到另一个平台，而是两层合同：柜台商品目录（business）和店铺销售条款（campaign）。建议采用以下顺序：

1. 从 Ozon/ERP 读取商品、SKU、图片、俄文标题/描述、品牌、尺寸/重量、条码和税务字段，保留 `sourcePlatform=OZON` 与源商品 ID；这部分是 ERP 内部导入，不是 Yandex API。
2. `POST /v2/categories/tree`（operation：`getCategoriesTree`）读取 Yandex 类目树；`POST /v2/category/{categoryId}/parameters`（`getCategoryContentParameters`）读取该类目的必填/可选特性。
3. `POST /v2/businesses/{businessId}/offer-mappings/update`（`updateOfferMappings`）新增或修改目录商品。官方要求新增商品的 `name`、`description` 使用俄语，并强调类目特性必须与目标类目匹配；条码、图片、合规文件、标签、尺寸/重量等字段不能靠 Ozon 字段名猜测。
4. `POST /v2/businesses/{businessId}/offer-mappings`（`getOfferMappings`）读回目录商品和处理状态；`POST /v2/businesses/{businessId}/offer-cards`（`getOfferCardsContentStatus`）读卡片是否创建、内容状态及缺失特性；必要时使用 `POST /v2/businesses/{businessId}/offers/recommendations`（`getOfferRecommendations`）读取价格/内容建议。
5. 若该店铺支持独立销售条款，调用 `POST /v2/campaigns/{campaignId}/offers/update`（`updateCampaignOffers`）修改店铺级可售条款；否则先以 `GET /v2/campaigns/{campaignId}/settings` 检查是否只能使用柜台默认价格。官方页面明确说明，旧的 `available`/`quantum` 等参数已被弃用，隐藏商品应使用 hidden-offers 方法。

图片注意事项：Yandex 文档要求传递可访问的商品图片/媒体字段，但没有授权 ERP 直接把 Ozon 私有 URL 暴露给 Yandex。实现时应先把已归属 ERP 的图片转成受控、可过期或平台要求的公网 URL，并记录 `mediaHash/source`；不能把 Ozon 防盗链 URL 直接提交。

关键官方页面：

- [`添加产品和更改信息`](https://yandex.ru/dev/market/partner-api/doc/zh/reference/business-offer-mappings/updateOfferMappings.md?revision=r21727032)
- [`目录中有关产品的信息`](https://yandex.ru/dev/market/partner-api/doc/zh/reference/business-offer-mappings/getOfferMappings.md?revision=r21727032)
- [`按类别划分的产品特性`](https://yandex.ru/dev/market/partner-api/doc/zh/reference/content/getCategoryContentParameters.md?revision=r21727032)
- [`获取商品卡片内容状态`](https://yandex.ru/dev/market/partner-api/doc/zh/reference/content/getOfferCardsContentStatus.md?revision=r21727032)
- [`类别树`](https://yandex.ru/dev/market/partner-api/doc/zh/reference/categories/getCategoriesTree.md?revision=r21727032)

### 不应继续使用的旧目录接口

官方变更记录（2026-03-11/12）确认以下旧方法已经删除：

- `GET v2/campaigns/{campaignId}/offer-mapping-entries`
- `POST v2/campaigns/{campaignId}/offer-mapping-entries/updates`
- `POST v2/campaigns/{campaignId}/offer-mapping-entries/suggestions`
- `POST v2/businesses/{businessId}/offer-mappings/suggestions`

来源：[`主要更新`](https://yandex.ru/dev/market/partner-api/doc/zh/changelog/main.md?revision=r21727032)、[`过时的方法和参数`](https://yandex.ru/dev/market/partner-api/doc/zh/changelog/deprecated.md?revision=r21727032)。新适配器应只实现 `offer-mappings`/`offer-cards` 路径，不能复制旧 Ozon/Yandex 代码中的 `offer-mapping-entries`。

## 价格和库存

### 价格

- `POST /v2/campaigns/{campaignId}/offer-prices`（`getPricesByOfferIds`）读取店铺指定商品价格。
- `POST /v2/campaigns/{campaignId}/offer-prices/updates`（`updatePrices`）写入店铺商品价格。
- `POST /v2/businesses/{businessId}/offer-prices`（`getDefaultPrices`）读取柜台默认价格；`POST /v2/businesses/{businessId}/offer-prices/updates`（`updateBusinessPrices`）写入适用于所有店铺的默认价格。
- `POST /v2/businesses/{businessId}/offers/recommendations`（`getOfferRecommendations`）可用于发布前的价格建议/状态检查，但不能替代 ERP 自己的成本、物流和利润计算。

2026-03-10 官方把若干价格接口的 `limit` 上限降到 500，并将 `offerIds` 上限降到 500；实现要使用 `pageToken`/`limit`、批量上限 500 和重试退避，不能沿用旧的 2000 批量。来源：[`主要更新 2026-03-10`](https://yandex.ru/dev/market/partner-api/doc/zh/changelog/main.md?revision=r21727032)。

### 库存

- 无仓库组：`POST /v3/businesses/{businessId}/offers/stocks`（`updateStocksOnPartnerWarehouses`）写入合作伙伴仓库库存；`POST /v3/businesses/{businessId}/offers/stocks`（`getStocksOnPartnerWarehouses`）读取。
- 有仓库组：`PUT /v2/campaigns/{campaignId}/offers/stocks`（`updateStocks`）更新组内库存；`POST /v2/campaigns/{campaignId}/offers/stocks`（`getStocks`）读取。官方说明组内只需写入任一仓库，其余仓库会自动同步。
- `POST /v3/businesses/{businessId}/warehouses`（`getPartnerWarehouses`）读取无组仓库；`POST /v2/businesses/{businessId}/warehouses`（`getPagedWarehouses`）读取有仓库组柜台的分页仓库及状态。不能用已弃用的 `GET /v2/businesses/{businessId}/warehouses`。

库存同步必须先确定履约模型（FBS、DBS、Express、FBY、LaaS）和仓库类型；不能把 Ozon 的 FBS/FBY 状态直接映射为 Yandex 的库存仓库。来源：[`有关余额和营业额的信息`](https://yandex.ru/dev/market/partner-api/doc/zh/reference/stocks/getStocks.md?revision=r21727032)、[`传递有关余额的信息（仓库组）`](https://yandex.ru/dev/market/partner-api/doc/zh/reference/stocks/updateStocks.md?revision=r21727032)、[`传递有关余额的信息（合作伙伴仓库）`](https://yandex.ru/dev/market/partner-api/doc/zh/reference/stocks/updateStocksOnPartnerWarehouses.md?revision=r21727032)。

## 订单、履约和物流

### 读取与状态机

- 新代码应优先使用 `POST /v1/businesses/{businessId}/orders`（operation：`getBusinessOrders`）读取柜台订单。它可以聚合店铺订单、按状态/更新时间分页，并配合通知做增量同步。
- 旧 `GET /v2/campaigns/{campaignId}/orders`（`getOrders`）和 `GET /v2/campaigns/{campaignId}/orders/{orderId}`（`getOrder`）在官方文档中已标记弃用；官方说明 `getOrder`/`getOrders` 将在 2027-01-18 后不稳定、2027-04-12 禁用。新适配器不能把这两个 GET 作为唯一数据源。
- Yandex 订单状态包括 `PROCESSING`、`DELIVERY`、`PICKUP`、`DELIVERED`、`CANCELLED` 等；`PROCESSING` 的关键子状态包括 `STARTED`（已确认）和 `READY_TO_SHIP`（已组装待发货）。订单状态不能按 Ozon 的 `awaiting_packaging` 等字符串直接复用。
- 对 FBS/DBS 订单，`PUT /v2/campaigns/{campaignId}/orders/{orderId}/boxes`（`setOrderBoxLayout`）用于提交箱子布局、每箱商品及标记码；`PUT /v2/campaigns/{campaignId}/orders/{orderId}/status`（`updateOrderStatus`）用于从 `PROCESSING/STARTED` 转为 `PROCESSING/READY_TO_SHIP`，或按允许原因取消。状态变化可能返回 operation，必须轮询 `GET /v2/operations/{operationId}`（`getOperations`）而不是立即假设成功。

### 通知和增量同步

Yandex 提供可选的 API 通知：卖家后台“设置 → API 和模块 → API 通知”配置 HTTPS URL。通知覆盖新订单、订单更新/状态变化、取消请求、取消、退款/非购买等；启用时 Yandex 会发送 `PING` 验证，接收端需在约定时限返回 `200`。官方说明通常通知须在 10 秒内响应，通知失败会暂停发送，长时间不可用会断开；实现必须快速 ACK、异步入队、幂等处理和重放保护。来源：[`如何使用通知`](https://yandex.ru/dev/market/partner-api/doc/zh/push-notifications/index.md?revision=r21727032)、[`通知请求格式`](https://yandex.ru/dev/market/partner-api/doc/zh/push-notifications/reference/sendNotification.md?revision=r21727032)。

通知不是订单真源：通知只触发增量同步，仍需调用官方订单读取接口回读完整订单并校验版本/状态。

### 物流、货件和标签

- `POST /v2/campaigns/{campaignId}/orders/{orderId}/boxes` 是订单装箱/标签码提交入口，不能把它等价为 Ozon 组包。
- `GET /v2/campaigns/{campaignId}/orders/{orderId}/delivery/labels`（`generateOrderLabels`）返回单个订单所有箱子的 PDF 标签；可通过 `format` 请求 A9/A7/A4 等版式。
- `GET /v2/campaigns/{campaignId}/orders/{orderId}/delivery/labels/data`（`getOrderLabelsData`）返回打印所需的结构化标签数据，可用于 ERP 预览/本地打印；真实打印机仍需独立验收。
- `GET /v2/campaigns/{campaignId}/first-mile/shipments/{shipmentId}/orders/info`（`getShipmentOrdersInfo`）查询货件中哪些订单可/不可打印标签。
- `GET /v2/delivery/services`（`getDeliveryServices`）读取配送服务目录；订单中的配送服务 ID、送货方式和仓库/货件必须使用 Yandex 返回值。
- 货件/FBY 供应模块使用官方 `shipments`/`supply-requests` 方法族；不能假定 Yandex 的 FBY、FBS、DBS、Express、LaaS 拥有相同的组包/面单语义。第一阶段建议先做 FBS 商品与订单读取，标签预览，状态回读；供应交接和打印机接入作为后续授权范围。

官方物流模型概览：[`方法概述`](https://yandex.ru/dev/market/partner-api/doc/zh/overview/index.md?revision=r21727032)、[`FBS`](https://yandex.ru/dev/market/partner-api/doc/zh/overview/fbs.md?revision=r21727032)、[`DBS`](https://yandex.ru/dev/market/partner-api/doc/zh/overview/dbs.md?revision=r21727032)、[`FBY`](https://yandex.ru/dev/market/partner-api/doc/zh/overview/fby.md?revision=r21727032)、[`Express`](https://yandex.ru/dev/market/partner-api/doc/zh/overview/express.md?revision=r21727032)、[`LaaS`](https://yandex.ru/dev/market/partner-api/doc/zh/overview/laas.md?revision=r21727032)。

## 与 Ozon 同步的边界

“从 Ozon 搬到 Yandex”应在 ERP 内部拆成三条可审计链路，而不是平台直连：

1. Ozon → ERP：调用现有 Ozon 只读商品/图片/库存/订单同步 owner；建立 ERP 商品快照和来源映射。
2. ERP → Yandex 目录：根据 Yandex 类目树和特性 schema 生成待审核的 `offer-mappings/update` 草稿，用户确认俄文标题、类目、条码、图片、税务和尺寸后写入。
3. ERP → Yandex 店铺：在已确认 `businessId/campaignId/warehouseId` 后分别同步价格、库存，再读取目录/卡片/价格/库存状态；订单和物流是独立适配器，不能复用 Ozon 状态枚举或面单接口。

Yandex 不提供“用 Ozon API 直接代发 Yandex 商品”的隐式桥接；Ozon API 只负责 ERP 的来源数据，Yandex API 负责目标店铺写入。每次写入都应记录平台、店铺、源版本、请求幂等键、响应 operationId/错误和回读结果。

## 第一阶段建议范围与授权门禁

### 建议第一阶段（可以先做本地/离线和只读）

1. `yandexMarketShop` 凭据/店铺 owner：加密保存 API Key 引用、business/campaign 映射、scope 快照和连接状态。
2. 只读连接测试：`getCampaigns`、`getCampaign`、`getCampaignSettings`、仓库读取；不写商品、不写库存。
3. Ozon/ERP → Yandex 草稿映射：类目树、类目属性、俄文标题/描述、图片 URL、条码、重量/尺寸和税务字段；在 ERP 中显示缺字段和待确认项。
4. Yandex 商品目录写入：仅在用户显式确认后调用 `updateOfferMappings`，随后 `getOfferMappings`/`getOfferCardsContentStatus` 回读；支持可恢复 operation 与幂等。
5. 价格/库存只读预览；完成 field mapping、批量 500、分页、速率限制和失败重试后，再单独开放价格/库存写入。
6. 订单只读同步：优先 `getBusinessOrders`，通知 endpoint 只做增量触发；暂不自动推进状态、不打印实物标签。

### 必须另行授权的范围

- 使用真实 Yandex API Key、访问真实店铺和仓库。
- `updateOfferMappings`、店铺价格/库存更新、订单装箱、订单状态变更、取消、退款、供应/货件确认等任何写入。
- 真实图片公网转存、标签 PDF 生成/下载、打印机连接和物流状态写回。
- 生产通知 URL、定时同步任务、跨店批量发布或将所有 Ozon 店铺自动镜像到 Yandex。

当前已完成第一步源码接线：Yandex 店铺沿用加密 `Shop` 凭据 owner（`clientId` 保存 campaign ID，`apiKeyEncrypted` 保存 Api-Key），新增只读 `YandexMarketClient`、店铺归属路由和 `/shops/yandex` 管理页；连接测试成功后在 `Shop.config.yandexMarket` 保存非敏感的 campaign/business/履约映射快照，并支持 ERP/Ozon 商品草稿预览。另已接入受显式 `confirm=true`、字段完整性、幂等键和持久操作记录保护的 `offer-mappings/update` 发布 owner，但默认受 `YANDEX_MARKET_PUBLISH_ENABLED` 关闭，避免未经授权触发真实店铺写入；未知响应不会自动重发。尚未调用真实 Yandex 店铺，库存/价格/订单/物流写入和真实发布验收仍未完成，不能解释为“Yandex 全量已接入”或“所有店铺可用”。

## 官方兼容性提醒（截至研究日期）

- 认证优先 Api-Key，OAuth 仅作为迁移兼容，不作为新接入方案。
- 订单读取优先 `POST v1/businesses/{businessId}/orders`；旧 campaign GET 订单方法已弃用。
- 商品目录使用 `offer-mappings`/`offer-cards`；已删除旧 `offer-mapping-entries` 和旧 suggestions 方法。
- 2026-03 官方把部分价格/bids 的批量上限降至 500；所有客户端必须使用服务端可配置批量上限，而不是写死旧值。
- 2026-03-04 起 campaigns、orders、region children 的 `page`/`pageSize` 已标记过时，使用 `pageToken`/`limit`。
- 规范可从官方 GitHub 获取，用于生成客户端，但生成代码仍需经过 SS ERP 的凭据、租户、幂等、审计和资源限制 owner：[`OpenAPI 说明`](https://yandex.ru/dev/market/partner-api/doc/zh/concepts/openapi.md?revision=r21727032)、[`官方规范仓库`](https://github.com/yandex-market/yandex-market-partner-api)。
