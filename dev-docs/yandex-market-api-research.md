# Yandex Market Partner API 接入与验收

## 2026-10-28 商品管理补齐，准备双区部署

用户明确将 Yandex 扩展为完整日常商品平台，基础改价/库存等操作不只服务于 Ozon 搬运；同时授权同步部署 CN。真实业务测试仍仅 COM，不在 CN 使用店铺凭据，不发真实改价/库存/隐藏/发布请求。

截图根因为 `/products` 使用固定的 `OzonSyncActionDialog`，Yandex 只读目录没有接到 ERP `Product`，同步 Worker 也只有 Ozon 分支。新增 `yandex-product-sync.ts` 为 Yandex 快照 owner，复用原 BullMQ 商品队列及 SyncJob；按 campaign 列表精确补业务目录详情，不把同 business 的其他 campaign 商品导入。先完整读取最多 5000 商品/20仓库，再以 Serializable 事务更新 ERP，失败不保存不完整快照；保留 Yandex 原 SKU（含前导零/字母）、售价、状态和独立同步时间，不复用 Ozon 佣金/买手成本字段。库存优先 AVAILABLE，或明确 FIT-FREEZE/零FIT；未知不冒充0，同组仓库不重复计数。同步只写 ERP 商品快照，不写 Yandex。

`yandex-product-operations.ts` 负责单件/最多100件统一价、划线价、按仓可售库存、隐藏及恢复展示；复用现有 `YandexOfferPublishOperation` 表的带 `kind=PRODUCT_MANAGEMENT` 记录，无新增 schema 或迁移。网页账号会话、产品/店铺/实时 campaign 归属、仓库归属、数据类型/数量和资源限制均服务端执行。共用价格与共享仓库组分别显式确认，不能自动扩大单店影响。状态记录“平台接受”，不提前修改本地价格库存冒充平台读回；UNKNOWN 保留原 body/key、按 business 数据库锁阻断重叠新请求，只在原请求只读回读符合时记收敛成功，未知不重发。商品目录发布开关仍关闭，基础管理由账号/店铺/API准入执行，不复用 AI pilot。

`YandexProductManager` 在现有商品页按平台展示同步、单件/批量管理、进度、未知核对；移除 Yandex 下错误的 Ozon 同步/佣金/库存推送入口，隐藏/恢复使用官方 hidden-offers 而不是伪装成归档。服务端根据 business `warehouseModel` 和 `onlyDefaultPrice` 选择官方仓库/价格方法，不猜测跨店范围。

本地验证：当前相关回归95项（完成后以最终命令计数核验）；隔离 PostgreSQL 161迁移、4项 journal 幂等/并发/未知与同步事务验证通过并清理 schema；Web build、类型/lint 和真实 React `/products` 隔离Chrome流程通过。UI证据 `C:/Users/550W/AppData/Local/Temp/ss-erp-yandex-ui-qNEVax`，涵盖平台分流、任务进度、共用价确认、UNKNOWN原请求及仓库库存；本地fixture写入不代表真实平台写入。

COM当前绑定店铺真实只读一次完整读取921件，settings返回 `warehouseModel=CAMPAIGN`、`onlyDefaultPrice=true`，平台确实存在零FIT及AVAILABLE两类库存；后一轮只读遇到上游 `YandexMarketApiError`，未把失败计为通过、未写数据库或重试业务请求。此阶段尚未提交/部署，COM运行454d272c，CN仍原472；最终签名/双区部署和生产数据读回将继续记录在本段。

## 2026-10-28 当前实现与 COM 只读验收

本轮目标是沿用 `/shops/yandex` 的店铺生态位，完成“已有 Ozon 商品快照 → 可编辑 Yandex 草稿 → 服务端校验 → 显式目录提交”的接线。真实测试仅使用用户在 **COM** 绑定的管理员账号及店铺，不使用 CN。真实商品、价格、库存和物流写入不在本轮验收授权内；`YANDEX_MARKET_PUBLISH_ENABLED` 保持关闭。源码已提交、推送并完成 COM 部署 `454d272c233a2caaacf0f6ca7be981bb5cfc0643`，部署签名候选为 `1.0.473`；官网公开扩展下载保持 `1.0.472`，CN 未访问或部署。

用户随后授权将本轮完成且验证的改动提交、推送并部署到 COM；以下部署及只读核查原件已实际通过，不改 CN，不切换官网扩展公开指针。

### COM 部署与部署后验收

- Git 源码提交 `454d272c` 已推送 `feat/ai-media-prompt-registry`，18 个明确路径包含功能、回归和 Keep a Changelog 的 Unreleased 记录；工作树及暂存内容已检查，无凭据或私有 artifact 混入。
- 标准 `deploy-pilot.sh` 完成目标提交绑定的签名候选验证、备份恢复（146 张 public 表，临时库已清理）、161 条迁移检查（无待执行迁移）、封存源码、current 切换及三服务重启。本次标准流程确实短暂停止 API/Worker，未跳过门禁；COM 原两店/三活动设备和六操作策略未改变。
- `verify-vps-deploy.sh` 完整通过，0 failure / 1 warning；唯一 warning 是远端备份存储未配置、本地备份可用。API/Worker/Web 的实际进程 cwd 均属于目标 release，本地/公网 ready、DB/Redis 均通过。
- 部署后直接使用远端当前源码再次读通六类 Yandex 接口，目录/卡片各读取 5 条、类目样本 180 参数，3 个 Ozon 商品草稿按真实资料缺失保持阻断。官方只读 `POST /v2/auth/token` HTTP 200，确认绑定 Key 声明商品目录、价格、库存写权限；这是权限信息读回，未调用任何业务写接口，不等价于真实提交成功。
- `/shops/yandex` 本地及 COM 公网 HTTP 200；未登录调用 settings、目录读取和发布路由均返回 401。真实登录浏览器的新版生产页面交互本轮未验证，本地隔离浏览器流程证据仍独立保留。
- COM `/api/extensions/latest` 仍返回 `1.0.472`。本次没有扩展功能改动，473 仅为现标准应用部署合同需要的 commit 绑定签名候选，没有 website approval、CAS 或公开下载变更。
- 部署/签名/备份/VPS/权限及业务只读证据仅在私有 `C:/Users/550W/AppData/Local/SS-ERP/private/release-454d272c-yandex-com`；最终业务只读时间 `2026-10-28T13:38:16.920Z`，三服务读回时间 `2026-10-28T13:39:20.365Z`。Yandex/Ozon/Provider 业务写入和新增费用为 0。

### 不真正上架时能验证什么

2026-10-28 再次读取官方 [测试订单](https://yandex.ru/dev/market/partner-api/doc/zh/concepts/sandbox.md) 和 [目录提交](https://yandex.ru/dev/market/partner-api/doc/zh/reference/business-offer-mappings/updateOfferMappings.md)，当前 revision `r21843295`：sandbox 的 `fake=true` 用于测试订单，不是商品目录沙箱；`updateOfferMappings` 当前没有 `dry-run` / `validateOnly` 参数。不能用空商品、故意错误商品或未传价格库存的真实目录写入冒充无副作用探测。

零商品写入可验证真实连接和读取权限、来源资料、末级类目/参数字典、ERP 预览与提交前拒绝，以及离线模拟的成功/拒绝/未知结果恢复。现有六类真实读取和官方令牌权限信息读取已通过，绑定 Key 声明包含目录、价格、库存写权限；平台接单、图片抓取、异步审核和销售准入只有实际目录提交与回读才能证明。未传价格库存也仍然属于真实商品目录写入，不能解释为纯只读测试。

### 唯一 owner 与调用方向

- `apps/server/src/services/yandex-market-contract.ts`：官方 ID、分页、类目树、属性字典及属性联动限制合同。
- `apps/server/src/services/yandex-market-catalog.ts`：校验 campaign/business 真实归属、目标末级类目、参数和预览摘要；不接受调用者指定任意 business。
- `apps/server/src/services/yandex-market-offer-draft.ts`：ERP/Ozon 来源字段映射；Ozon 类目不当作 Yandex 类目，数字 Ozon SKU 不当作条码。支持来源真实条码、原生描述属性 4191 和品牌属性 85，无来源数据不猜填。
- `apps/server/src/services/yandex-market-client.ts`：仅访问官方固定 origin，Api-Key 只在服务端使用；拒绝重定向，响应流最多 8 MB，单请求超时最多 30 秒。类目大字典允许最多 100,000 个值，前端搜索每次只展开最多 200 个未选候选。
- `apps/server/src/routes/yandex-market.ts`：网页账号会话和店铺归属、受开关保护的发布、持久幂等与操作记录。复用已有数据模型，无新增迁移或权限模型。
- `apps/web/src/components/yandex/`：目录/卡片错误、来源商品分页和最多 50 件选择、俄文标题/描述/品牌/条码编辑、末级类目及必填/选填属性、重新预览与显式提交。权限、状态和字段合格性由服务端判定。

编辑后原预览失效；提交必须带 `expectedDraftHash`，服务端重新读取来源商品和目标合同，内容变化则在发送前拒绝。官方返回 `status=OK` 但逐商品存在 errors 时记为拒绝，不假报成功。未知结果保留原 body 与幂等键；重放先读取已有 journal，再考虑新的发布开关和来源数据，因此关闭开关不会把旧 UNKNOWN 误报为未发送。目标店铺不可访问时仍保留未知态，不声称旧请求未执行。

### 官方与真实只读证据

- 官方文档复核 revision `r21820164`，官方 OpenAPI commit `c0a1323252ec9b44162d9cd2660309f14c57832f`；复核 `getOfferMappings`、`getOfferCardsContentStatus`、`getCategoriesTree`、`getCategoryContentParameters` 和 `updateOfferMappings` 的实际响应、分页与属性约束。
- COM 已绑定店铺：campaign、settings、business offer-mappings、offer-cards、categories/tree、category parameters 六类接口均真实 HTTP 200。目录/卡片各读 5 条，目录存在下一页；卡片中发现 2 条内容错误。类目树 11,028 节点，样本末级类目 180 个参数；合法大字典超过 20,000 个枚举值，不再错误拒绝该响应。
- 当前本地源码客户端在 COM VPS 内存执行只读复核通过，未覆盖或部署远端源码；数据库连接设置只读，凭据仅在内存解密，不进入 Git 或普通 artifact。
- 3 个已有 Ozon 商品预览被缺描述/类目/品牌/条码正确阻断；其中 1 个真实 Ozon info/attributes 回读得到 25 个属性、0 个条码、没有描述属性 4191。该样本缺资料属于平台实际返回，不能用自动填充掩盖。
- 服务端 7 文件 69 项定向回归通过，覆盖租户、字段映射、类目/属性联动、逐商品错误、预览变化、关闭开关后的 UNKNOWN 回放；本轮新增稳定行为均观察 RED 后实现 GREEN。Server/Web TypeScript、修改范围 ESLint 和 Web production build 通过；构建保留现有 Next.js ESLint plugin 未检测到的配置提示，不影响本次成功结果。
- 隔离 Chrome 真实 React 流程通过目录/卡片错误、来源选择、类目/属性编辑、草稿预览、发布关闭后解锁、UNKNOWN 原请求核对及 390px 无横向溢出。证据目录：`C:/Users/550W/AppData/Local/Temp/ss-erp-yandex-ui-0tffVa`。这是本地 fixture 接口的 UI 行为证据，不替代生产页面或真实平台写入验收。
- 本轮 Yandex/Ozon/Provider 写入、生产数据库业务写入、费用均为 0。临时 Key 输入会话及本轮隔离浏览器已关闭。

### 尚未完成

真实 Yandex 商品提交/卡片回读闭环、价格库存同步、Yandex 订单和物流/Ozon 配送对接、ERP 图片稳定公网转存、全类目通用映射及新页面生产登录浏览器验收仍未完成。已部署代码与本轮证据说明目录读取、授权和草稿准备可用，不能称为商品已真实上架、可销售或 Yandex 全量接入。下一阶段应先用资料完整的商品核对目标草稿和图片稳定性，再在明确授权后执行真实目录提交及卡片状态回读。

## 研究边界与来源

- 研究日期：2026-10-24（Asia/Shanghai）。
- 主要来源：Yandex Market Partner API 官方中文文档，revision `r21727032`，入口为 [`index.md`](https://yandex.ru/dev/market/partner-api/doc/zh/index.md?revision=r21727032)。
- 所有 URL 均为 `yandex.ru/dev/market/partner-api` 官方文档或官方 Yandex Market API 规范仓库；2026-10-24 初始研究没有调用真实店铺。后续授权及只读测试结果以上述当前记录为准，本文不保存 API Key。
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

正式接入必须由用户在 Yandex 卖家后台生成并粘贴 Key；SS ERP 只应保存加密凭据引用和 scope 快照，不应把 Key 写入日志、前端、Git 或普通测试 fixture。2026-10-28 用户已授权使用其 COM 绑定凭据进行只读测试；真实店铺写入仍需要明确授权。

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

2026-10-24 初始接线沿用加密 `Shop` 凭据 owner（`clientId` 保存 campaign ID，`apiKeyEncrypted` 保存 Api-Key）；连接测试在 `Shop.config.yandexMarket` 保存非敏感映射快照，目录发布由 `YANDEX_MARKET_PUBLISH_ENABLED` 关闭。2026-10-28 已继续实现目录读取、草稿编辑/校验并完成真实 COM 只读接口测试，具体结果与尚未部署/写入的边界见本文顶部当前记录。

## 官方兼容性提醒（截至研究日期）

- 认证优先 Api-Key，OAuth 仅作为迁移兼容，不作为新接入方案。
- 订单读取优先 `POST v1/businesses/{businessId}/orders`；旧 campaign GET 订单方法已弃用。
- 商品目录使用 `offer-mappings`/`offer-cards`；已删除旧 `offer-mapping-entries` 和旧 suggestions 方法。
- 2026-03 官方把部分价格/bids 的批量上限降至 500；所有客户端必须使用服务端可配置批量上限，而不是写死旧值。
- 2026-03-04 起 campaigns、orders、region children 的 `page`/`pageSize` 已标记过时，使用 `pageToken`/`limit`。
- 规范可从官方 GitHub 获取，用于生成客户端，但生成代码仍需经过 SS ERP 的凭据、租户、幂等、审计和资源限制 owner：[`OpenAPI 说明`](https://yandex.ru/dev/market/partner-api/doc/zh/concepts/openapi.md?revision=r21727032)、[`官方规范仓库`](https://github.com/yandex-market/yandex-market-partner-api)。
