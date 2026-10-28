# Yandex Market Partner API 接入与验收

## 2026-10-29 运营能力对齐已完成本地接线（待提交）

本轮在不改schema、不调用真实Yandex/Ozon写入、不产生费用的边界内，完成商品、订单与物流同窗运营入口：商品价格预览与批量调价 owner；Yandex订单原生状态/装箱/标记/DBS轨迹/面单；FBS/Express first-mile交接批次读取、人工确认、ACT/INBOUND PDF与差异/运输Excel文档。所有mutation均先实时归属校验、持久ORDER/SHIPMENT journal、同订单/批次锁、首次发送与UNKNOWN核对分离；HTTP 200不直接等同平台完成。FBY保持只读，LaaS仅平台确认/取消，Yandex订单号与Ozon posting/物流ID不互换。

本地验证：Server TypeScript、Web typecheck/build、6个Yandex定向服务/route/client/contract测试85项通过；商品 owner 23项、first-mile owner 11项、隔离PostgreSQL商品8项及UI隔离Chrome runner 29请求通过。真实COM只读及当前已绑定店铺仍未执行履约写入；CN不使用店铺凭据。待补：统一PG runner加入订单/交接 journal 测试后运行，随后再决定提交/部署。

## 2026-10-29 运营能力对齐实施合同

用户要求Yandex在商品、订单、仓库配送与面单中提供和Ozon相近的日常操作。沿用现有Next/Fastify/Prisma/Redis与账号/店铺权限；不换栈、不新增数据库迁移、不替换原Ozon规则。仅本地开发与COM只读验收，本阶段不发真实平台商品/履约写入、物流建单或费用，不调整生产开关。

Owner方向：`yandex-market-client.ts`负责官方API/有界响应；`yandex-order-contract.ts`负责原生订单、装箱/动作准入投影；新增`yandex-order-operations.ts`负责实时店铺/订单归属、显式命令、持久幂等、未知核对和异步operation，不让route/UI决定平台状态；操作复用现有Yandex journal并以`ORDER_MANAGEMENT`标记，无schema变化。现有商品管理owner承接批量定价/内容预览适配，现有订单页与Yandex店铺页为消费者，不另建平行ERP。

可用旅程：订单同步/列表→同窗读取最新订单和平台仓库/配送→按适用履约模式完整装箱→确认备货/交接/DBS配送或取消→结果核对→面单预览/下载。FBS/DBS/FBY/LAAS按官方能力判定，不把Ozon组包等同Yandex箱号；无法可靠执行的动作明确说明原因。未知mutation只核对原请求，禁止更换key重复发送；HTTP200不等于平台状态成功。PDF使用官方固定host、无redirect、字节/超时/格式上限；凭据不进入浏览器/日志/Git。

验收：T2先写client/owner/route失败用例再实现，覆盖跨店/租户、原生字段与动作、装箱数量/商品完整性、operation顺序/未知恢复、API限流/超时、内容/价格校验；使用本机隔离PostgreSQL证明幂等和并发，T3真实React浏览器验证原订单页入口/错误/恢复/面单。COM真实只读仅证明权限与返回，不冒称空店铺真实履约成功。非目标：独立Ozon Delivery/LAAS外部账号新凭据与仓映射、自动收费与物流建单、真实履约写入、打印机实物验收。


## 2026-10-29 订单同步与类目修复已统一双区部署

官方研究复核了两个相反方向：Ozon Delivery可为其他销售渠道配送，需要独立配送准入；Yandex LAAS则可在后台绑定Ozon凭据和FBS仓，拉取Ozon来源订单并由Yandex仓处理。`sourcePlatform=OZON`表示来源而非承运商。未找到中国Yandex店默认使用OGL的官方证明。[Yandex LAAS](https://yandex.ru/support/marketplace/ru/tools/laas)、[中国跨境](https://partner.market.yandex.com/welcome/crossborder_cn)、[Ozon Delivery](https://logistics.ozon.ru)与官方OpenAPI为来源；研究技能草稿仅在ignored build，结论由本owner维护。

订单读取、类目修复源码a3149424已推送；CN首次尝试因缺目标备份认证安全停止（current未切换，API/Worker实际短暂停止后已恢复），目标认证补齐后同提交重试又遇到保留release目录拒绝；失败目录已保留。后续在切换前受控终止旧a314部署以补齐审查发现的Yandex旧通用发货/取消/备货旁路。当前两区均仍运行9cae6511，所有服务active，不将a314称为已上线。旧候选475与日志保留，新部署将绑定最终提交并在开始前完成两区备份恢复及COM当前pilot核查。

最终本地边界：Yandex的旧单件/批量发货、取消和备货明确拒绝，页面禁用，不允许仅改ERP后假报平台成功；旧同步直连接口按平台分流。订单保存使用本机已验证的事务与shop级锁，再核对租户/平台/ACTIVE/凭据，拒绝过期快照回退及数据超限；保留原生状态、实际币种、配送服务/合作类型/track/来源，商品金额与配送金额分别留存。Yandex目录发布仍关闭，不增加数据库schema、收费或真实物流写入。

153项定向回归通过；7项本机隔离PostgreSQL（含订单持久化、重放、时间线、旧状态回退、内部采购/国内运单保留、部分页失败及凭据变化）通过并清理schema。真实React订单页Chrome通过Yandex同步/进度、承运商/原生状态和写操作禁用，未访问Ozon接口；UI证据`C:/Users/550W/AppData/Local/Temp/ss-erp-yandex-ui-IjgrM5`。COM真实订单30天查询返回0单，读取合同/权限通过，不证明非空真实订单履约；无Yandex/Ozon/Provider业务写入或费用。


最终源码`ed36dbffaa6c7190afb8acd221b05e568c42ec41`已提交推送，区域签名候选476已验签，COM标准部署完成且FULL VPS通过（0failure/1既有remote backup warning）。COM从部署源码实际读取近一年13个窗口订单，返回0单、创建/更新均0；随后重同步921件商品，921件全部保存mapping类目ID和名称。观察时间`2026-10-28T17:08:14.137Z`，仅ERP商品/店铺同步快照更新，Yandex/Ozon/Provider业务写入及费用0。CN最终ed36标准部署也已完成，目标备份恢复、161迁移检查、重启后ready及FULL VPS通过，0failure/1既有remote backup warning；三服务cwd绑定目标提交的最终读回时间`2026-10-28T17:19:53.138Z`。私有证据root为`release-ed36dbff-yandex-orders`，旧a314失败/取消原件不覆盖。

## 2026-10-28 Yandex 订单同步实现与物流研究

官方资料能确认多平台物流合作，但没有证明当前中国Yandex店默认使用Ozon/OGL，不能简化成“Yandex orderId 直接调用 Ozon Seller 发货”。Yandex 官方 LaaS/Fulfillment 说明（[外部平台集成](https://r.jina.ai/https://yandex.ru/support/marketplace/ru/tools/laas)）是：卖家在 Ozon 建 FBS 仓、在 Yandex 选择“集成其他平台→Ozon”、提供 Ozon ClientID + Admin Read only/Product/Warehouse/Posting FBS 权限 Token，并将 Ozon FBS 仓映射到 Yandex 仓；Yandex 拉取外部订单后组包并送 Ozon 分拣中心。这是 Yandex LAAS 作为外部平台履约编排，不能拿 Yandex 订单号冒充 Ozon posting。

中国跨境官方说明（[crossborder_cn](https://partner.market.yandex.com/welcome/crossborder_cn)）描述的是 FBS：卖家存储、包装并交到 Yandex 投递点，由 Yandex 配送和清关；未证明所有中国店铺默认启用 OGL 或 Ozon 物流。Ozon 官方 Delivery 独立流程（`/v1/delivery/check` → `/v2/delivery/checkout` → `/v2/order/create`）也不能由当前 Yandex API Key 直接代替。当前 ERP 没有独立的 Ozon-LaaS 凭据/仓库映射 owner，因此本轮只接 Yandex 原生订单读取，不自动创建 Ozon 物流单、组包单或额外费用。

新增 `yandex-order-contract.ts` / `yandex-order-sync.ts`：使用官方 `POST /v1/businesses/{businessId}/orders`，每次最多30天、游标分页、`fake=false`、严格 campaign 归属；保存 Yandex 原生 `status/substatus`、`sourcePlatform`、`delivery.serviceName/deliveryServiceId/deliveryPartnerType`、轨迹、shipment、delivery dates、programType 和 externalOrderId。状态映射到 ERP 仅用于展示：PROCESSING/STARTED→待打包，PROCESSING/READY_TO_SHIP→待发货，DELIVERY/PICKUP→配送中，DELIVERED→已送达，CANCELLED/RETURNED→异常/取消；不复用 Ozon 状态字符串。订单项、付款+cashback、币种和价格不猜填；同步失败不保存部分页，事件写入 source=`yandex`。

订单页同步入口按店铺平台分流：Yandex 显示“同步 Yandex 订单”，只读保存到 ERP；Ozon 继续使用原同步窗口。Yandex 发货、取消、备货、面单、boxes/组包仍禁用；后端也拒绝旧通用路由，不会只改ERP状态假报成功，直到独立 Ozon-LaaS 凭据、仓库映射、Yandex 状态写入及标签合同完成。COM 真实只读订单窗口 `2026-09-29..2026-10-29` 返回0单且业务验证通过，未写订单、Yandex、Ozon或Provider；这是空数据的成功读取，不能宣称真实订单履约通过。订单同步代码的本地定向、类型/lint、Web构建已通过，待与mapping类目修复统一提交部署。

## 2026-10-28 类目漏读已确认，本地修复待发布

用户截图显示商品列表全部“未提供类目”。COM只读核查：ERP921条、categoryId非空0条；按ERP当前列表抽查15件，官方 `getOfferMappings` 返回15条，其中 `offer.marketCategoryId` 全部缺省，而 `mapping.marketCategoryId/marketCategoryName` 全部存在，包含“Листовые чаи”“Жилеты для взрослых”“Конструкторы детские”等。原件观察时间 `2026-10-28T15:08:36.864Z`，只在私有 `release-9cae6511-yandex-dual/category-readonly-*`，无数据库或Yandex写入。样本证明本次为ERP漏读，不能将15件外推为921件全部已由平台分类。

官方当前 `getOfferMappings` 文档复核 revision `r21847170`：`offer` 是卖家提交信息，`mapping` 是平台卡片及实际归类，后者可在平台尚未识别时缺省。旧 `collectYandexProducts` 只解析offer并丢弃mapping，导致同步categoryId为空；旧fixture只把类目放在offer内，未覆盖官方实际mapping分支。无需新增类目API。

本地修复由既有 `yandex-product-sync.ts` owner执行：优先保存mapping实际类目ID及名称，同时保留offer原提交ID和来源；仅在mapping确实没有ID时使用offer类目，均缺省则保持未知，不猜填。`projectYandexProduct` 只有元数据类目ID与数据库categoryId匹配才投影categoryLabel，避免错配显示。新增RED→GREEN回归覆盖mapping单独返回、两者不一致、原类目保留及两者均缺；PostgreSQL回归扩充原同步事务读回断言。修复不改变schema、权限、发布开关和订单写入/物流边界；订单只读同步已在本地接线，线上双区仍 `9cae6511`。

本轮验证：类目同步/商品列表/client/worker共4文件31项通过，本机隔离PostgreSQL4项通过（schema已清理），Server TypeScript及修改范围ESLint通过。无真实平台写入/费用，生产数据库仅只读；线上已有商品须在修复部署后重同步才能补回类目。

当前Yandex接入范围已复核实际client/routes/worker：店铺认证、商品目录/类目属性、商品快照、价格/库存、隐藏/恢复、搬运草稿和受开关保护的目录提交已接线；真实改价/库存/隐藏/目录发布未测。Yandex原生订单只读同步、ERP状态/配送字段保存和订单页平台分流已接线并完成本地验证；增量通知、订单履约/取消、装箱、发货/配送状态、面单/货签和物流/组包写入尚未实现。现有Ozon订单和组包模块不代表Yandex可用，官方API研究文档也不等于已实现，不宣称所有Yandex API已接入。

## 2026-10-28 商品管理已推送、双区部署完成

用户明确将 Yandex 扩展为完整日常商品平台，基础改价/库存等操作不只服务于 Ozon 搬运；同时授权同步部署 CN。真实业务测试仍仅 COM，不在 CN 使用店铺凭据，不发真实改价/库存/隐藏/发布请求。

截图根因为 `/products` 使用固定的 `OzonSyncActionDialog`，Yandex 只读目录没有接到 ERP `Product`，同步 Worker 也只有 Ozon 分支。新增 `yandex-product-sync.ts` 为 Yandex 快照 owner，复用原 BullMQ 商品队列及 SyncJob；按 campaign 列表精确补业务目录详情，不把同 business 的其他 campaign 商品导入。先完整读取最多 5000 商品/20仓库，再以 Serializable 事务更新 ERP，失败不保存不完整快照；保留 Yandex 原 SKU（含前导零/字母）、售价、状态和独立同步时间，不复用 Ozon 佣金/买手成本字段。库存优先 AVAILABLE，或明确 FIT-FREEZE/零FIT；未知不冒充0，同组仓库不重复计数。同步只写 ERP 商品快照，不写 Yandex。

`yandex-product-operations.ts` 负责单件/最多100件统一价、划线价、按仓可售库存、隐藏及恢复展示；复用现有 `YandexOfferPublishOperation` 表的带 `kind=PRODUCT_MANAGEMENT` 记录，无新增 schema 或迁移。网页账号会话、产品/店铺/实时 campaign 归属、仓库归属、数据类型/数量和资源限制均服务端执行。共用价格与共享仓库组分别显式确认，不能自动扩大单店影响。状态记录“平台接受”，不提前修改本地价格库存冒充平台读回；UNKNOWN 保留原 body/key、按 business 数据库锁阻断重叠新请求，只在原请求只读回读符合时记收敛成功，未知不重发。商品目录发布开关仍关闭，基础管理由账号/店铺/API准入执行，不复用 AI pilot。

`YandexProductManager` 在现有商品页按平台展示同步、单件/批量管理、进度、未知核对；移除 Yandex 下错误的 Ozon 同步/佣金/库存推送入口，隐藏/恢复使用官方 hidden-offers 而不是伪装成归档。服务端根据 business `warehouseModel` 和 `onlyDefaultPrice` 选择官方仓库/价格方法，不猜测跨店范围。

本地验证：12文件95项相关回归通过；隔离 PostgreSQL 161迁移、4项 journal 幂等/并发/未知与同步事务验证通过并清理 schema；Web build、类型/lint 和真实 React `/products` 隔离Chrome流程通过。UI证据 `C:/Users/550W/AppData/Local/Temp/ss-erp-yandex-ui-qNEVax`，涵盖平台分流、任务进度、共用价确认、UNKNOWN原请求及仓库库存；本地fixture写入不代表真实平台写入。

COM绑定店铺真实只读一次完整读取921件，settings返回 `warehouseModel=CAMPAIGN`、`onlyDefaultPrice=true`；另一轮只读遇到上游 `YandexMarketApiError`，未把失败计为通过、未写数据库或重试业务请求。最终部署源码 `9cae651128978044971d9f60d77cb2b65f823aad` 已推送 `feat/ai-media-prompt-registry`，区域签名候选 `1.0.474` 均验签通过，COM/CN均完成标准部署、备份恢复、161迁移检查（无待执行迁移）、三服务重启和本地ready。两区标准部署确实有API/Worker停机窗口；COM现有pilot、CN AI/BYOK/Ozon dark和Yandex目录发布关闭策略不变。官网扩展仍472，无website approval/CAS。

部署后 COM已执行一次授权的“平台只读 → ERP商品快照写入”：由0导入921条，920条有价格；数据库实际明细中919件平台没有返回库存行，2件明确返回FIT/AVAILABLE正数。原有“零FIT”来自前一轮接口探测，不能当作本次同步同一份数据。故本次仅2件标记可售库存已知，其他显示未知而非伪造0。成功时间 `2026-10-28T14:34:12.908Z`，唯一原件 `COM-erp-snapshot-import.json`；写入仅ERP商品快照，Yandex/Ozon/Provider业务写入及费用0。

COM部署后真实六类读取和令牌权限信息再次通过，仍具备商品/价格/库存写权限；商品管理的新同步/管理能力已上线，但真实改价、库存写入、隐藏/恢复仍未执行。两区公网ready及 `/products` 均HTTP200，官网latest仍472；COM/CN FULL VPS均0failure/1既有远端备份未配置warning，CN三服务目标cwd最终读回时间 `2026-10-28T14:56:45.166Z`。新页面生产登录浏览器交互未验证，不用HTTP200替代该证据。

CN前两次部署在Prisma引擎下载处失败，尚未切换current；Node只读诊断复现连接官方CDN间歇超时。临时将 `binaries.prisma.sh` 固定到当前官方DNS地址并保持TLS校验后，同提交重新标准部署成功；下载完成即移除该行，`/etc/hosts`恢复前后SHA一致。失败源码与日志保留；仅清理本轮两份失败目录的node_modules（各943M）释放磁盘，未删业务备份或活动release。最终区域签名、完整部署/备份/VPS日志、临时配置清理和ERP读回仅在私有 `C:/Users/550W/AppData/Local/SS-ERP/private/release-9cae6511-yandex-dual`。

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

真实 Yandex 商品提交/卡片回读闭环、价格库存写入实测、Yandex 订单和物流/Ozon 配送对接、ERP 图片稳定公网转存、全类目通用映射及新页面生产登录浏览器验收仍未完成。价格库存读取与基础管理代码已由本文顶部后续阶段补齐并双区部署；不能将其解释为商品已真实上架、可销售或 Yandex 全量接入。下一阶段应先用资料完整的商品核对目标草稿和图片稳定性，再在明确授权后执行真实目录提交及卡片状态回读。

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
