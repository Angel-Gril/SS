# 生图与计费链路收口（2026-09）

## 2026-09-15 用户纠偏后的当前验收

- 用户明确要求完成正常生图和正常计费，成功生成后按已提供的单张费用记账；供应商后台账单核对、免费抵扣、最终结算不是本次功能开发的前置或任务。该决定取代本阶段此前把供应商对账和单张严格改色样本挂在正常功能前的要求；旧试验记录仍保留其原始事实，不改写成供应商已结算。
- 正常 ERP 任务费用的唯一价格来源是服务端确认时冻结的单价，成功获得的有效图片按张数结算到现有 `ai-cost-ledger`。Provider 返回的金额、免费额度或之后修改的配置不能改写已确认单价。图片审核/采用与生成费用分开；未生成有效图片不记成功费用，结果未知先恢复原任务，不盲目重发或猜测成功。
- 币种随新任务报价明确冻结。新的 Wanx 报价使用人民币分，CNY 0.14 记录为 14 分；原 v1/v2 任务保留隐含 USD 的旧语义，不回填历史金额。预算在报价币种内统计，同一个配置限额分别作用于该币种的已结算费用和未决预留，不把人民币和美元直接相加，不引入未经确认的汇率。
- 本轮已定位：正常改图 readiness/worker 要求精确可执行证据，但注册表所有真实 Provider 均无该条目，合法配置也被拒绝；`ai-image-jobs.ts` 与 `ai-image-edit.ts` 优先采用 Provider 金额，缺失时又可能按整单估价结算，存在零计费、越过已确认价格及部分成功多计费问题。
- 唯一 owner：Provider 能力及正常路由/worker 准入由能力注册表和现有运行时合同负责；任务价格计算进入独立费用 owner，并由 generation/edit/recovery 调用；持久结算和幂等继续由既有 repository 与 ledger 事务负责。Web 只展示这些合同的投影。不会引入新支付或钱包模型。
- 验收按 T2 执行最小缺陷 RED→GREEN，覆盖正常入口接通、确认单价、成功张数、重复/恢复不多记、失败与未知结果；随后运行受影响回归和真实 PostgreSQL 链路。只对已知 Provider/model/endpoint/operation 接通，保留身份、租户、密钥、资源限制、功能开关和费用上限检查，不把任意兼容端点默认视为可用。
- 正常准入按已实现的传输合同判断：官方 OpenAI 已登记操作、官方北京 Wanx 已实现操作，以及管理员明确配置的自定义 OpenAI-compatible 文生图协议。未知 Provider/操作和未登记的自定义改图继续拒绝；原精确 sandbox 证据仅表示实际验证事实，不要求先人工晋升每个普通配置，也不伪造供应商结算或效果验收。所有发送继续检查当前权限、原配置身份、资源和预算。
- 普通文生图的只读报价由 `ai-image-generation-quote.ts` 投影单价、币种、张数和最高费用；Web 展示后点击提交即确认。新客户端提交报价指纹，服务端重新核价，变价在创建和预留前拒绝；旧调用者的可选字段兼容保留，客户端不能指定实际金额。任务展示读取 `ai-image-task-cost.ts` 的原冻结价，损坏的历史价格只显示不可用，不使任务查询失败。
- 同一页面中，提交结果未知时保留原幂等键和请求参数。之后即使读到配置/报价拒绝，也不能认定先前请求没有被接收；用户明确确认新报价只更新报价指纹，原键不变，最终由既有 owner/key 唯一约束防止迟到请求形成第二单。已存在任务可在当前配置关闭后只读重放。页面刷新或跳转后的恢复不属于本轮内存状态保证。
- 后续工作的顺序改为正常生成链路与任务计费优先；本轮不再继续供应商账单轮询或重复付费单图校准。历史 CNY 1.50 隔离试验记录不用于冒充正常 ERP 任务费用。

## 当前阶段与事实

- 2026-09-18 接续：原套图计划 `cmu5y1io600025oq82o0epff5` 已创建但尚未批准、START、claim 或扣费；扩展读取计划时因通用响应守卫把规划归属对象的 `key` 当作密钥返回 `SS_ERP_RUNTIME_RESPONSE_SECRET`。提交 `15a42d6f` 将放行限制为 hosted 工作台消息中的精确 `{level: sku|compatibility_group, key}` 对象，并保留其他消息类型及额外字段的拒绝。定向授权 17/17、完整 preflight `6314 passed / 321 skipped`、cloud/local `1.0.335` 候选包校验通过；初始候选未签名，随后已完成签名验签，仍未部署或发布，未产生 Provider 请求/费用；真实套图结果见下一条。
- 2026-09-18 真实套图接续：在自有 QA 来源 Web 工作台完成一次明确 CNY 0.28 最高费用确认并执行，suite `cmu618tna000c5oq8vnn4pkys` 由 `QUEUED/RUNNING` 收敛为 `SUCCEEDED`，2/2 成功、0 失败；两个结果目视通过后分别 `REVIEW_SLOT=APPROVE`，再以 append 目标写入来源商品 target，suite revision 9，两个 slot 均 `application=APPLIED`，来源 target 图片数新增两张。只读 readiness 为 READY，suite counts `queued=0/running=0/failed=0`。无重试、无取消、无 Ozon 写入；真实 Provider 成功计费按冻结报价记录 CNY 0.28。该证据是 Web 托管 owner 的真实运行，不写成修复版 MV3 扩展的独立浏览器证据。候选 `1.0.335` 已用现有受控 Ed25519 key 签名并验签：提交 `15a42d6f`，release evidence SHA-256 `ae4471d1d564b4c28d6ebea2b712676b447c7ea9a2882a7e9286b0aeff88f75b`，signature SHA-256 `ef26b8a1c241477c3e52110ff5eb8dd419e466f681a21e30b89229fa8399fa7d`；签名候选尚未部署/官网发布。
- 2026-09-18 独立 MV3 浏览器接续：专用 profile `mv3-qa-1.0.335` 加载正确 API origin 的 cloud `1.0.335` 候选，扩展设置确认 endpoint `https://ss-erp.com`、deployment `ss-erp-vultr-sg-prod`、DOTH 与 `listing:review`/`listing:write`/`media:execute`；设备 transport 的 hosted `plans/current` 对当前 draft 返回 `plan=null`，随后现有 `listing-assignments` owner 返回 `404 hosted_listing_assignment_not_found`。因此仅通过 fixed version/endpoint/device scope/拒绝边界，未通过独立 store-draft assignment；没有 Provider POST、Ozon 写入或费用。尝试通过 extension plan create 绑定既有 Web plan 也被服务端以 `409 hosted_ai_image_plan_context_stale` 拒绝，未绕过 binding owner。
- 应用后只读核对：两条新 suite APPLY 记录均为 `targetType=collect`、`mode=append`、`state=APPLIED`，来源商品 target 的 `images`/`editedImages` 已包含两张新资产；独立来源商品草稿接口的 `media.assignments` 仍只有既有 `product-main`，符合 `ERP_SOURCE_PRODUCT` 且 `writesStoreDraft=false` 的当前合同。因此本轮应标为“来源商品写回通过；独立 store-draft assignment 未覆盖”，不能把该结果升级成独立草稿 assignment 证据。

- 2026-09-17 后续接续：`8addb54a / 1.0.332` 已完成完整离线、正式 QA04、COM/CN 部署和官网分发，COM 同路径升级与活动 Worker/Unicode 验证通过。INPAINT 原图及画笔真实验收通过，一次生成成功并唯一结算 CNY 14 分，累计四张/CNY 0.56；遮罩外像素变化为零，选区有可见灰色痕迹，已真实审核拒绝且未采用。套图尚未创建/收费；其早期草稿阶段限制已定位并进入下节修复，COM 临时试点已恢复、未决任务为零，原两张套图预算保留。
- 2026-09-17 本次接续：`d026eeaa / 1.0.331` 已完成 COM/CN 部署、官网分发及发布后 VPS 验证；第三张 IMAGE_TO_IMAGE 已通过真实 MV3 生成、审核和精确草稿空槽写入，累计三张/CNY 0.42。INPAINT 尚未发送，原图预览被 CORP 拦截的问题已定位并进入下节修复；两区仍未全量开放，剩余一张 INPAINT 与两张套图使用原六张/CNY 1 上限。
- 2026-09-17 接续：`8bbf8ac1 / 1.0.330` 已完成 COM/CN 正式部署、完整 VPS、暗态 canary、官网分发和 COM 受管升级；正常 FULL_EDIT 与 TEXT_TO_IMAGE 各成功一张、各唯一结算 CNY 14 分。生产 MV3 复验定位两处扩展适配遗漏，修复和当前未完成边界见[生产扩展集成复验](#生产扩展集成复验)。本轮费用保持 CNY 0.28，原六张/CNY 1 总额不因跨日或修订重置，旧图片和 claim 不重发、不改写。
- 2026-09-16 后续用户已明确要求完成其它模式、生产扩展写入、四项旧 Web 合同、全量启用及浏览器超时问题，进入[剩余功能实现与全量启用](#剩余功能实现与全量启用)。下方 `eeb8dccd / 1.0.329` 仍是已发布基线，新源码未用旧回执冒充已部署。
- 2026-09-16 接续：最终源码 `eeb8dccd` 已推送并完成正式 QA04、COM/CN 应用部署、暗态 canary 和官网 `1.0.329` 发布；COM 受管目录已由实际起点 `1.0.326` 升级到 `1.0.329`。完整结果及验收范围只维护在下方[双区正式发布与受管升级](#双区正式发布与受管升级)；上轮 `81072d68` 的真实 FULL_EDIT 与费用原件保留，不重复生成。
- 上轮完成状态：**最终源码已推送，COM/CN 应用部署及完整 VPS 验证通过；一次正常 FULL_EDIT 真实验收通过，临时配置已恢复**。本次未全量启用生图，未切官网扩展指针。供应商账单不再阻塞本次功能验收。唯一实现结果与测试证据见[最新接续](../current-state-audit.md#生图报价与扩展入口接续2026-09-15)及[此前修复](../current-state-audit.md#正常生图与按价计费修复2026-09-15)，本次运行事实见下方“正常流程真实验收与应用部署”；历史单图试验、原生账单和预算事实保留在[当时执行记录](../current-state-audit.md#第六次方向前置-inpaint-与额度重指定2026-09-15)。
- 2026-09-14 离线诊断已完成：四次 wire 请求均与冻结报告一致，未发现 prompt 截断、变量注入、函数选择或遮罩方向错误；官方 `strength` 参数不适用于 INPAINT。合成验收参考证明选区内渐变可以同时满足目标色和遮罩外零变化，但不代表 Provider 能达到该效果。诊断和参考均为离线证据，不改变生产行为。
- 2026-09-14 13:16 的只读追踪显示指定 Key 今日用量已回显 1 次、原生账单明细仍为 4 条且第四条免费抵扣、当前应付零；最终账单仍受次月出具和约 24 小时延迟规则约束，继续保持 `canFinalize:false`。
- 2026-09-14 13:28 的外部只读验收已确认账户、第四次任务 GET、今日用量和四条免费抵扣明细；原生 task→bill 关联、正式结算和正常 ERP 链路仍未证明。线上 ERP 工作流/Web Media 均关闭，完整 QA-02/QA-04 继续未完成。
- 开始基线：`ae65fd15`，主工作区 clean；继续沿用 Next/Fastify/Prisma/Redis/MV3。
- 同一新 Wanx Key 已执行 2 次 FULL_EDIT、4 次 INPAINT，均未重试；六个改色样本质量均未通过，逐笔费用状态以当前状态审计为准。
- `scoped-print-preview-v2` 仍只供离线查看；隔离实验版未晋升到普通 hosted 路径。
- 原五笔 CNY 1.25 保守占位已完整保留；用户另行明确批准把未消费的 CNY 0.25 改用于唯一方向前置 INPAINT，旧 FULL_EDIT 已撤销。第六次执行后累计占位 CNY 1.50/1.50，剩余零；免费抵扣不恢复预算，旧审批、scope、claim、原图和报告保持。

## 生产扩展集成复验

- `8bbf8ac1` 原生完整 offline 完成于 `2026-09-16T15:21:49.409Z`，后端 6267 passed / 317 条条件跳过、PostgreSQL 187 passed、scope 撤销 7 passed，149 个迁移及构建、类型、lint、三种扩展校验通过。正式 QA04 绑定该源码的真实 FULL_EDIT，双区签名、备份恢复、部署、暗态 canary、完整 VPS 和官网 1.0.330 下载验证均已完成。唯一 VPS warning 仍是已决定延期的远端备份。
- COM 受管目录由 1.0.329 同路径升级到 1.0.330；原生 active worker 拦截了旧 Worker 缓存。保存失败证据后仅重载专用 9444 实例的扩展，实际主脚本字节与安装目录一致，Unicode smoke 通过。原 9222 浏览器和订单标签保留，未修改其权限。
- FULL_EDIT 正常 Web 请求一次完成，42.051 秒，一张有效图、一次 Provider attempt、唯一 CNY 14 分 CHARGE；真实页面已审核并 APPEND，原图保留。临时单张配置已恢复。随后本轮正常 TEXT_TO_IMAGE 使用独立 `wanx2.1-t2i-turbo`，13.185 秒成功，1024×1024 PNG，一次请求、一张有效图、唯一 SETTLED/CNY 14 分费用，页面显示费用和候选。脚本最初没有接受正常 HTTP 202，使用原提交响应和原任务 GET 完成恢复，未重发。两张图均已实际查看，普通单杯展示质量通过。
- 专用 MV3 已通过正常 Web 设备配对。试点只允许既有 DOTH 店铺，误选 BINI 时草稿创建在业务准入处拒绝；随后按正常“更新授权”切换到 DOTH，旧自建设备会话已撤销，自有 QA 精确快照草稿创建成功。设备只有来源采集、草稿编辑、草稿审核和媒体执行权限，不执行 Ozon 商品写入。
- 新 ERP_SOURCE 编辑入口被真实 Worker 的传输白名单拒绝，`erp-launch-grants/consume` 尚未发送。T2 最小组合测试先复现 `ERP_SOURCE_LAUNCH_UNAVAILABLE`，再仅将这个精确 POST 路径加入既有白名单；尾斜线、query、fragment、绝对 URL、相邻接口和 GET 继续拒绝。
- 独立复核另发现成功 `CREATE_WORKFLOW` 回执包含 `action/replayed`，直接交给只接受四字段的 editor session 会使已入队任务被误报失败。修复只在 worker 薄适配层投影 `workflowId/operation/status/revision`，保留 session 严格白名单。实际 client→worker→coordinator 的三操作、三状态组合先 RED 后 GREEN，并验证重启后使用已保存 completion、零追加 POST。根 Agent 组合验证 37 项通过；服务端、shared、生成和计费 owner 未改。
- 两个新收费 claim 已消费，I2I/INPAINT/两槽套图的四张尚未执行。为发布修复版，COM pilot 已实际恢复，凭据 revision 增至 8，未决 job、费用、恢复、workflow、suite 均为零。双区尚未全量开放。两处扩展补丁已推送为 `619853fa`；后续发现下节所述服务端/数据库缺口，在剩余付费前停止了该提交尚未完成的 offline，保留为已被后续修复取代的运行记录。旧两张保留原任务和费用，不能通过改写查询提交冒充新源码执行；最终源码另用尚未执行的一张 I2I 取得真实验收。
- 当前私有原件继续在 `completion-20260916`；新修复发布材料与已执行 1.0.330 原件分开保存。普通扩展编辑器沿用一次点击创建任务的交互；本轮单价与最高费用已经用户批准，实际 POST 前仍核对当前配置、单参考和一次性 claim，不声称验收了独立的编辑器报价确认面板。

### 真实草稿槽位与生产写回补齐

- 付费前沿完整 owner 核查确认三处阻断：MV3 创建的 listing-draft workflow 没有 `contextSkuKey/contextSlotKey`，因此 Web 将候选判为过期且应用 owner 拒绝；生产能力投影硬编码 `!production`；数据库 INSERT 函数仍只允许 fake。此前局部成功或绿色模拟套件不能证明真实草稿写回已完成。
- 创建前冻结目标：Web 复用当前 AI 精确槽位选择，将 `target:{skuKey,slotKey}` 绑定到 ERP_SOURCE 一次性 grant、扩展 session、恢复同一性、命令幂等、服务端 workflow 和 INPAINT 来源/蒙版 metadata。新 ERP_SOURCE 编辑请求必须携带合法 target；普通 native v2 的旧字段合同保留。无 SKU 使用 `skuKey:null`，不能把内部产品级占位符伪装为真实 SKU。
- 标准空槽及现有 assignment 的校验进入 `packages/shared/src/ozon-listing-draft.ts`，Web 与服务端共用。产品级为 `product-main` / `product-gallery-1..7`，真实 SKU 的标准主槽为 `sku:<skuKey>:hero`；既有槽仍核对 scope/sku。服务端同时通过当前草稿、版本与现有 AI context owner 复核；错目标或过期目标在发包前拒绝，没有放宽 Web 的过期检查。
- 生产应用能力现在遵循原 workflow/Web media 开关。真实图片必须来自受支持 Provider，并绑定同任务、owner/actor、workflow、model、operation、request fingerprint 的 SETTLED 费用预留；原 CHARGE/RECONCILED_CHARGE 的金额与成功单位一致性约束保留。生产 fake 仍由应用 owner 拒绝，撤销沿用原 APPLY 历史，不重新收费。
- 新增兼容迁移 `20260917021000_allow_settled_ai_listing_draft_applications`，只替换原应用 INSERT 校验函数，保留独立 source、actor、slot、immutable 触发器及所有旧迁移。真实隔离 PostgreSQL 先证实旧函数拒绝已结算 Wanx（23514），再验证新函数允许真实费用链的申请、幂等回放和撤销；16 条旧 fixture 审计记录的数量与内容摘要完全不变。部署需应用第 150 个迁移；应用回滚须保留兼容的新约束函数，以免拒绝已存在真实记录。
- 根 Agent 的当前组合验证为后端七文件 250 项、Web/MV3 与正式证据合同 58 项通过，均零失败。各 owner 的真实 PostgreSQL 14 项、类型和定向 lint 已通过；正式最终源码的完整 native offline 仍需重新取得。原生 Worker 文件直接使用根 ESLint 会报既有的 150 条 browser-global/unused 诊断，改动前后逐条规则/消息一致；新源码使用项目现有门禁及定向语法/合同验证，不修改无关旧诊断。
- 新源码会使用已批准的一张 I2I，在 COM 自有账号、真实精确槽位完成生成、审核、APPEND 和配置恢复，再生成对应源码的正式 QA04。私有 bootstrap 只允许该 case，不能全量 enable；配置 CAS/加密备份、未决任务保留凭据、丢回执恢复、预算和其它模式保留已经真实隔离 PostgreSQL 验证。签名候选可先用于专用本地 QA，证据明确区别于官网发布；官网分发仍在正式验收和区域暗态检查后执行。既有两张不重复生成，总体仍最多六张/CNY 1。
- 正式 QA04 producer 新增 `NORMAL_IMAGE_DRAFT_FLOW_INPUTS` 变体，通过 JSON pointer 读取真实 I2I/INPAINT 的数据库阶段、UI、浏览器和 bootstrap 恢复原件；从任务、输入/输出、唯一费用、审核事件、APPEND 审计及草稿版本推导结果，不接受调用者 PASS。任务必须在本次 offline 完成后开始，且执行源码与目标提交相同。实际 PNG 解码验证尺寸，保留正常 I2I 输出的空尺寸列；按真实事件 owner 的字段顺序校验 JSONB payload/hash，审核事件的空 jobId 也保持原样。原 FULL_EDIT 分支与正式消费者形状不变，根 Agent 最终 27 项 producer 回归、语法和 lint 通过。

### INPAINT 原图传输与三张原件接续

- `d026eeaa` 原生完整 offline 已通过：后端 6290 passed / 321 条条件跳过，PostgreSQL 191 项与 scope 撤销 7 项、150 个迁移及类型、lint、构建、双模式扩展通过。该提交的 I2I 于自身 offline 完成后执行，唯一 Provider attempt、唯一 SETTLED/CNY 14 分 CHARGE；实际 1024×1024 杯子图经人工查看后，在真实页面审核并 APPEND 到产品主槽，草稿 r1/v1→r2/v2。bootstrap 配置已恢复，正式 QA04、COM/CN 签名部署、暗态检查、官网 1.0.331 分发和发布后 VPS 验证通过。原两张保留原提交、claim 与费用，未重新生成。
- INPAINT 的 grant、launch、edit-source 均 HTTP 200，失败发生于扩展 `<img>` 直接显示 ERP CDN 原图：响应的 `Cross-Origin-Resource-Policy: same-origin` 阻止跨源嵌入，图片宽度为零，画笔因此保持禁用。只读 Blob 探测已验证同一原图可正常解码为 1024×1024；未上传 mask、未创建 INPAINT claim、未请求 Provider。
- 扩展预览 owner 新增受限 Blob reader；页面只负责生命周期。沿用已有公网 URL 校验和图片容器解析，限制 20 MiB、15 秒、类型/实际尺寸/动画，拒绝重定向且不携带凭据；本地回环仅在包的显式 host 权限允许时使用。取消、替换或关闭页面会中止读取并释放 object URL，迟到响应不能覆盖新预览。网站 CORP、扩展权限、服务端生图/计费/数据库均不改。
- T2 先在真实页面脚本测试中复现“没有 fetch 且仍直接嵌入跨源 URL”，再实现并通过；新增七项资源/安全/竞态回归、既有图片解析与遮罩/预览回归通过。T3 的正式签名包原图加载、实际画笔与剩余生产流程仍需在修复版本安装后验收，不能用只读探测代替。
- 为避免仅扩展改动重复消费真实图片，正式 producer 为草稿分支增加显式 v2：分别绑定 `executionGitCommit`、`executionOfflineQa04` 和目标提交 offline，所有原阶段、浏览器、动作及恢复记录仍校验原执行提交，原门禁必须在原任务开始时有效。既有 `verifyErpSource` 继续逐项证明后端、shared、迁移和依赖一致；目标 UI/完整 MV3 不据此自动宣称通过。v1 同提交合同和回执字节保持，新增分支 39 项 producer 测试通过。
- 生产修复准备前已恢复 COM 普通试点，凭据 revision 11→12，未决 job、费用、恢复、workflow、suite 全零；CN 仍关闭。已有三张 CNY 0.42 不变，剩余三张不得重置或重发历史 claim；最终两区各日预算 1000 分、COM100/CN5 用户日次数及全量启用继续按用户原授权执行。私有原件在 `completion-20260916`，不进入 Git。

## 正常流程真实验收与应用部署

### 早期草稿套图接续（2026-09-17）

- 真实扩展工作台在自有 PRODUCT_ONLY、`CATEGORY_REVIEW` 草稿读取 `/plans/current` 返回 409 `hosted_ai_image_plan_context_stale`；没有创建计划、suite claim 或新 Provider 请求。根因是正常启动及 mode lock 已支持活动草稿阶段，但 plan authorize、候选预览 authority 与关闭功能后的恢复读取仍硬编码 `MEDIA_REVIEW`。
- 唯一阶段 owner 沿用 `extension-hosted-ai-image-plan.ts` 的 `isExtensionHostedAiImageActiveDraftStage`；计划、预览和恢复读取复用它。预览仍要求工作流与草稿阶段一致，身份/店铺/设备/版本/快照约束不变，已发布、发布意图、非活动和阶段不一致继续拒绝。PRODUCT_ONLY 的内部 SKU 锚及套图原生槽位由原 planner/批量 assignment owner 维护，不新增商品事实或改成单图槽位。
- T2 已先复现 11 项 plan/authority 阶段失败及 1 项恢复装配失败，再实现；根 Agent 的四文件 116 项定向验证通过，独立后续链路复核包含产品级两槽规划、报价/START 和批量写回。完整门禁和真实两张套图仍须在最终修复源码上验证。采用须一次按原顺序写入两个已批准槽位，不能用只写 collect 的 `APPLY_SLOT` 冒充草稿采用。
- `1.0.332` 的 INPAINT 技术、计费和遮罩外保留已通过，视觉质量拒绝的原件及真实 REJECT 审核保留。按原已批准用例和本阶段开头的用户纠偏，图片效果/采用与有效输出计费分别记录；不得把该样本写成质量通过，也不因拒绝返还或重置已消费的 CNY 14 分。原六张/CNY 1 范围仍只剩套图两张。
- 修复需要新后端源码与新原生离线证据，不能通过旧 I2I 源码一致桥接冒充新代码执行；当前套图正式证据变体和仅两张的受控 bootstrap 正在本地准备，所有历史任务、claim、费用与输出原件保持不变。

- 用户当前明确要求真实线上流程验收、推送最新版本并准备部署；既有签名与两区 VPS 部署授权继续适用。此次采用正常功能验收部署，沿用原签名、备份恢复、部署、回滚和完整 VPS verifier；不冒用管理员只读维护范围，不伪造正式 QA04/REL04 或官网发布证据。
- 固定应用源码为 `81072d68fde57236aeaed1398f62c4d555c9373f`，双区扩展候选为 `1.0.328`。原生离线回执完成于 `2026-09-15T13:48:48.898Z`，后端 6124 passed / 262 条条件跳过、AI Media PostgreSQL 135 passed，构建和双模式包验证通过；该回执仍为 `completesFormalTask:false`，不为纯进度记录重跑全套或更换部署候选。
- 本次真实调用限定 COM 已验证的自有管理员账号、官方北京 `dashscope-wanx / wanx2.1-imageedit / FULL_EDIT`、一张 1024×1024 图片，服务端冻结单价与最高任务费用均为 CNY 0.14。原 CNY 1.50 隔离试验占位保持，不能用于本次正常任务。未知结果只恢复原任务；不另发生成请求，CN 不重复付费生图。
- 临时配置只开放该 owner 的正常全图编辑、Web 图片应用和已有采集兼容入口；不改共享日预算、已有文本 AI、原采集规则或 Ozon 发布。配置控制器调用原 setConfig、加密 owner 与预算 owner，保存加密原值并以 CAS 恢复；凭据 revision 单调增加，存在未决任务时先关闭新提交并保留当前凭据。实际恢复必须有回执，图片、任务、费用和审计不删除。
- 独立复核发现私有恢复工具的 Serializable 旧快照会漏看晚到的已准入任务。真实 PostgreSQL 先复现 RED，再仅将工具事务改为 ReadCommitted，保留配置表锁、CAS 与原全局预算锁，随后 18 项验证通过、零跳过。此工具修复不修改应用源码或冻结候选。
- COM 已通过真实备份恢复、部署、完整 VPS（零失败、一项已决定延期的远端备份提示）与公网读回。`2026-09-15T16:30:32.020Z` 至 `16:31:33.797Z` 的正常任务完成唯一一次真实 FULL_EDIT，约 61.8 秒；输出为 1024×1024 PNG、961,359 bytes，SHA-256 `2167d22ee3c36f6148438ba183b30c8678b87767e1748ed37bec03765fb1f5fd`。白杯、右侧把手、浅灰背景及自然阴影符合本次一般展示优化要求，未见新增文字、水印、标志或矩形色块；不据此宣称精确改色或每次生成质量保证。
- 真实页面已完成一次提交、候选预览、一次 APPROVE 与一次 APPEND。数据库独立核对为一个工作流、一个任务、一次 Provider 执行、一张有效图片、一笔 CHARGE，状态 SETTLED、币种 CNY、实际 14 分；目标保留原图并新增一张，只有一条 APPLY 记录。审核和采用没有新增生图或费用。`2026-09-15T16:43:39.090Z` 的恢复后复核仍保持这些记录。
- 配置已实际恢复并读回：工作流关闭、原 Provider 与功能范围还原，凭据 revision 从 2 经激活的 3 增至恢复后的 4；待处理 job、费用预留、恢复和 workflow 均为零。共享预算、原文本 AI 和其他采集规则保留。临时浏览器上下文及本次自建标签已关闭，用户原订单标签、登录态和浏览器权限保留。COM 正常流程汇总回执 SHA-256 为 `cf6ffccbab62ada52d5db2828ee0b43927bb06f7a3ddb43490a4d37a16584c61`。
- CN 已在 COM 真实验收和配置恢复后部署同一代码；真实备份恢复、迁移检查、服务切换、完整 VPS 及公网读回均通过。两区均运行 `81072d68`，VPS 各零失败、一项已决定延期的远端备份提示；COM/CN 原生 VPS 回执 SHA-256 分别为 `039379bf2ae893b1792abeb573a01acff989b502f9eff79b76aa5feda0f42091` / `a55bc48682d9ae1e6b22b38462b7d270afe0c587ed7c832b22043e2c2bbb36ff`。CN 原生检查完成于 `2026-09-15T17:14:30.716Z`，初次下载回读时因本机时钟稍慢被严格时间校验拒绝；时间达到后使用原 parser 和完全相同字节复验通过，未改时间、回执或门禁，也未重复整套检查。
- 浏览器证据使用既有真实账号的登录 Cookie，在内存中转入自建隔离上下文并校对同一 owner；没有合成身份或 Provider 替身。原常规上下文出现跨域请求超时及资源加载迟滞，隔离上下文最终通过实际页面、手动任务刷新和全尺寸候选预览。短暂的权限对照只作用于自建上下文，销毁前有效状态为 prompt，原窗口未改权限；本次没有证明原常规浏览器超时的具体根因已修复。
- 此次覆盖正常 FULL_EDIT 的真实生成、存储、审核、追加及任务计费；不覆盖普通 TEXT_TO_IMAGE、INPAINT、完整生产 MV3、BYOK/Ozon 写入或官网发布，也不把未展示的 FULL_EDIT 报价 UI 当成已验证。两区官网仍分别为 `1.0.316` / `1.0.311`；CN 没有重复付费生图或复制本次临时启用配置。此次验收和部署已完成，后续全量启用与未覆盖场景须按各自实际范围推进。
- 生产原件继续仅保存在私有 `real-image-acceptance-20260915` 及 `normal-live-full-edit-81072d68-20260915` 目录。首次 COM 部署因 Windows 源码归档的 CRLF 与 Git blob 的 LF 不一致，在切换前被原 gate 拒绝；保留失败原件后改用既有 materialize 生成的 canonical 源码，11 个 gate 文件逐项匹配。区域签名包不受影响，未改发布门禁。

## 浏览器读取恢复与发布证据接续

以下保留修复和发布准备期间的检查点；最终执行结果见[双区正式发布与受管升级](#双区正式发布与受管升级)，不再以本节早期的“尚未部署”概括当前运行状态。

- 接续基线为 `7670e015`，应用仍运行 `81072d68`。上次配置恢复来自单账号单张验收后的明确恢复范围；官网分发有独立签名、暗态 canary、指针切换和升级流程。一次 FULL_EDIT 只证明其本次正常生成、审核、应用及 CNY 14 分计费，不能代替其他模式或生产 MV3 的证据。
- 已确定的应用缺陷：JSON API GET 没有完成期限，响应头或 body 挂起会使 Dashboard 永久 loading；原布局把读取失败当作失去登录。图片面板三个读取使用整体失败语义，健康历史会随另一路错误丢失；历史失败仍保留优先任务排除集合，阻止详情回退；切目标不能取消旧请求。旧常规浏览器网络故障的触发条件尚未复现，不将本轮正常响应、代理地址或 HTTP 版本当作该根因的证明。
- T2 owner：`apps/web/src/lib/api.ts` 只为 JSON GET 增加覆盖响应头与 JSON body 的 30 秒期限，透传调用方取消并清理 timer/listener；写入无新增默认期限，无自动重发。`dashboard-session.ts` 把认证读取分类为已认证、暂不可用、取消；只有合法成功身份可渲染受保护内容，真实 401 仍由原 API 路径清理并跳登录。布局展示超时/断网/维护和显式重试，按每轮独立请求对象绑定结果，防止 A→B→A 复用旧身份。
- 图片读取 coordinator、面板和应用记录消费者接收取消信号；三个主读取保留各自成功结果，历史失败清理排除集合以启用现有详情回退。原 2 秒/30 秒轮询、最多 20 个详情请求、服务端权限、任务写入及费用规则保持。
- 最小 API 与会话行为均先 RED→GREEN；修复后 37 项受影响组合通过，Web 类型检查、六个受改文件 lint 和生产构建通过。额外覆盖写入不继承 GET 期限、预取消零请求、晚到 401 不清理新会话。旧 listing-log 测试已随会话 owner 接线更新，原 API 401 `returnTo` 行为仍由真实本地 HTTP 用例验证。最终完整发布门禁待源码冻结后执行。
- T3 使用实际 React、DashboardLayout、API 与会话 owner，仅替换 Next 路由和周边导航，身份为本地合成数据；只连接本地服务，不能冒充生产身份或 Provider 验收。`2026-09-16T05:32:08.161Z` 的 `after-request-clock-01` 完整通过：新版在实际请求开始后 30.015 秒显示超时，基线仍 pending；超时和断网后分别一次真实点击触发一次新 GET 并恢复，A→B→A 等待新身份，维护和 401 跳转/清 token 符合原合同。两个自建 target 无运行时异常或外部 origin，其独立上下文已销毁。主 Agent 复核原件和四张关键截图；此前从导航起点计时或读到旧 document 的失败采样保留，未为适配测试更改应用期限。
- 生产只读诊断在真实 Web `/privacy` 发起：`2026-09-16T04:56:25.636Z` 常规浏览器对 app/API `/api/user/me` 均成功（约 312/465 ms）；未复制 Cookie 的隔离上下文返回预期 401。最早以 API `/ready` JSON 页发起的 CSP 拒绝属于诊断页选择错误，不作为 Web 故障证据。用户原订单标签、浏览器权限和登录态保留。
- 发布工具缺口已核实：`qa:04:offline` 只生成 `SS_ERP_QA04_OFFLINE_REHEARSAL`，正式 `QA04_FINAL_ACCEPTANCE` 只有消费者而无汇总入口。新增入口须绑定目标提交的原生九步回执与完整日志、四类已有 QA02 技术原件和正常 ERP 费用原件；保留历史币种差异与后续质量反例，不把供应商最终结算重新引入功能门槛。若复用 `81072d68` 费用证据，必须程序核对服务端、shared、schema 和相关依赖未变，并明确新 Web 尚未生产验收。
- `pnpm qa:04:final` 已补齐纯离线原件校验及不可覆盖输出，`pnpm test:qa04:final` 已纳入 preflight。15 项定向验证全部通过，包含伪完成字段、缺项/未知结果、摘要变更、硬链接、旧日志与脏源码、错金额/重复费用、业务/依赖变化拒绝、质量反例保留及原 REL04 消费者兼容。独立复核后，根 package 仅允许本次两个固定 QA 命令注册，新增 postinstall/build 变化拒绝已先 RED→GREEN；源码和测试 lint 通过。此前与离线/REL04/维护/官网消费者联合 121 项通过；实际正式回执尚未生成，须使用最终提交重新执行的原生离线证据。
- Web 提交 `535965fdcdeaaafce410e7d2b7a5d6da25837d86` 已推送并读回远端匹配。T3 回执 SHA-256 为 `a2258cfe05636d233277529c3d0bd6d0d7f5398a14c1f716da4020877d6e2f25`；本地 fixture 两个端口已关闭，自建上下文已清理，用户原浏览器保留。新 `1.0.329` 的准备和签名操作脚本已就绪，但尚未执行打包、签名或部署。
- 汇总入口提交为 `73c40a01`。首次原生门禁在 preflight 的旧域名静态合同处失败：它仍要求 Layout 自带已移入 API owner 的 `getLoginPath`。全面检索另发现一键审核交接合同有相同旧断言，均按当前 session→API 401 的接线更新，原 returnTo、admin 路径、域名与审核断言保留；42 项受影响组合及定向 lint 通过，产品代码未再改动。失败原件保留，须在这次测试修复后的新提交重新取得完整原生回执。
- 此准备阶段的私有证据位于 `browser-recovery-20260916`；截至上述源码检查点没有新增 Provider 请求、费用、Ozon 写入、生产配置修改或部署。T2I 的原报告、intent、approval 仅从已授权主机只读取回并核对原摘要。

## 双区正式发布与受管升级

- 最终运行源码为 `eeb8dccd07664ecdf3a7cfb7ac511705d444f4ac`，已推送到原分支。`535965fd` 的 Web 读取恢复与 `73c40a01` 的正式原件汇总入口均包含其中；`6358427f`、`eeb8dccd` 仅对齐已移动 owner 和取消信号的旧静态断言，没有更改业务行为。后续进度文档提交不替换此运行提交，也不触发重新签名或部署。
- 该提交的原生九项离线门禁完成于 `2026-09-16T06:33:44.448Z`，全部 PASS：后端 6124 passed / 262 条条件跳过，AI Media PostgreSQL 135 passed、scope 撤销 7 passed、数据库升级回放、lint/typecheck、生产构建和双模式扩展通过。source/cloud/local verifier 分别为 459/464/460 passed，均零失败。失败后的最终完整门禁已实跑，不用分项结果拼接通过结论。
- 正式 `QA04_FINAL_ACCEPTANCE` 已由原 `qa:04:final` 入口汇总，绑定上述离线原件/日志、四类历史技术原件、六项质量反例及 `81072d68` 正常 ERP CNY 14 分费用。服务端、shared、schema、依赖及构建/安装脚本的源码桥接通过；原件继续保留 `targetUiProductionVerified:false`，不把历史样本提升为所有配置或新 UI 的生产验收。正式回执 SHA-256：`51386c072bd6a8484d09b574108d1114632587f55c332baf0cccb5f907a010f8`。
- 沿用已授权的区域签名、备份恢复、部署、原生完整 VPS、暗态 canary、官网签名/CAS 激活和实际下载验证，两区全部完成。官网 cloud/local 包分别匹配本区域签名候选，版本均为 `1.0.329`；发布后再次运行完整 VPS 均为零失败、一项既定远端备份延期提示。实际备份恢复及迁移检查通过，无待执行迁移；临时 canary 账户和设备会话已清理。

| 区域 | 当前应用 / 官网扩展 | 发布后完整 VPS 原件 SHA-256 |
| --- | --- | --- |
| COM | `eeb8dccd` / `1.0.329` | `53805aecaf716a73ee3127493f70ad7d73e07dd72f4e7a3b36b2cfad660bce1e` |
| CN | `eeb8dccd` / `1.0.329` | `185fca643c19a1d6a21b4d4da61976928ce2310c2b17166598d9c58cdeb33d20` |

- CN 官网激活时本地 SSH 封装超时，原 `UNKNOWN_OUTCOME` 保留。独立读取确认指针已切换后，在原部署锁内绑定已批准摘要、沿用原 CAS 参数，由原命令返回 `ALREADY_ACTIVATED`，随后才执行实际下载验证；没有创建第二次发布批准或覆盖原失败证据。两区时钟与本机略有差异时等待真实时间达到再校验原字节，未修改回执时间或放宽门禁。官网探针使用进程内双源实时 DoH，原公网地址、TLS 和摘要校验保留，系统/浏览器 DNS 未改。
- COM 常规浏览器在新部署上实际打开 `/help`，自然身份 GET 为 200/code 1，约 518 ms，受保护布局和帮助标题可见、登录 loading 结束；采样 `documentComplete:false` 原样保留。真实 QA 列表搜索到图片详情后，已保存图片组件解码 1024×1024 PNG、961359 bytes，摘要与上轮生成原件一致。原任务仍为 `SUCCEEDED / APPROVED / APPEND / SETTLED / CNY 14 分 / 1 张`；候选元素采样未解码，范围仅为 `SAVED_IMAGE_COMPONENT_AND_WORKFLOW_GET`。自建业务标签已关闭，原订单标签及既有标签保留，新增生成和非会话业务写请求均为零。
- COM 受管扩展的实际升级起点为 `1.0.326 / 0b8c664a`，并非官网旧版 `1.0.316`。隔离升级与原同路径 runner 均通过：固定 ID 不变，193 个安装文件与签名候选一致，一个非密 profile 指纹保留；session 密钥、vault key 与设备访问缓存清除，local/sync 无密钥泄漏，旧目录备份保留。安装树 SHA-256：`5b19205b487104cb3091346048238eeb461d983e7ad1cacfab4ba292b4404ad1`；同路径升级回执：`a12f9cadca21c50690d9a500e7a992e6df47f9a510c673afcf968ee2e6ade227`。
- 扩展运行验证已定位并解决专用 profile 的旧 Worker 缓存：manifest 已为 `1.0.329`，活动主脚本仍与 `97326fda` Git blob 逐字节一致（327857 bytes），而签名候选为 327937 bytes；差异是工作流交接不匹配分支的返回结构。已在本次专用离线浏览器仅执行一次目标扩展自重载，新的活动主脚本与当前候选精确一致，非密 profile 指纹保留、session 密钥等禁止状态均为空。未修改候选、删除缓存或放宽 attestor；操作说明已在原部署 runbook 补充新进程仍可能复用缓存时的核验与恢复步骤。
- 原生 active-worker 与 Unicode CLI 均以零退出码通过，主 Agent 再用原 parser 和当前安装文件独立复核，两个回执绑定同一新 Worker。active-worker SHA-256：`8a5765350693c9f36650551262190e47f84a6234206d05ed52bb9946ff2d8fed`；Unicode：`13d3d5283bdf3f585a693c161a3305791b01b623bfb57011b841e2b332803bbc`；运行收口原件：`77f52928a4586946d4b1de66e9cb1042e337787305a651c9125e8fb82cbc65d2`。专用 9444 监听和 profile 进程均已归零，既有专用 profile 保留；最初未完成初始化的新 profile 已单独清理，所有失败和源码对照原件保留。原浏览器未关闭或重启，主 Agent 只读确认原订单标签仍在；此结果只证明专用实例的活动运行验证，没有重载原浏览器中的扩展。
- 额外全部 Web 合同扫描为 137/141，四个未纳入现行 preflight 的旧合同仍失败：AI 设置旧文案、打印日期旧表达式、`editorLocked` 旧正则、五个文件的既有系统确认框。已用 `81072d68` 的精确 Git blob 实跑复现相同四项失败；未删除、跳过或放宽，不能宣称全部 Web 合同绿色。基线证据保存在私有 `web-contract-baseline-81072d68/baseline-notes.md`。
- 本轮新增 Provider 生成、费用和 Ozon 写入均为零。业务配置保持验收恢复后的基线，未全量开启生图；COM 原有 generation master 为 true、Provider 为 disabled，不误记为所有总开关均 false。正常 FULL_EDIT 的真实生成/审核/APPEND/CNY 0.14 证据仍来自上轮，本轮仅复核读取和费用状态。其它正常模式的生产生图、完整生产 MV3 业务写入与全量启用未新增验收；原常规浏览器底层网络故障的具体触发条件尚未复现，已修复的范围是应用永久等待与错误恢复。供应商账单仍不属于未完成任务或功能前置。
- 本轮生产原件及汇总报告仅保存于私有 `read-recovery-release-20260916/final-eeb8dccd`，不进入 Git。当前文档回写属于 T0，只检查证据绑定、链接、diff 和私密内容；不为文档提交重跑整套门禁、付费生图、签名或部署。

## 剩余功能实现与全量启用

- 当前输入是用户对列出余项的明确完成要求，覆盖正常功能补齐、必要真实流程验收和生图全量开放；既有推送/部署授权持续有效。旧 CNY 1.50 实验及已消费的单张批准仍不复用，新增真实请求须在具体输入、当前报价和总费用边界可复核后执行，供应商后台账单不作为前置。
- 已核实的功能缺口：正常 Wanx I2I 未登记/接线，尽管现有 adapter 和历史独立 I2I 技术原件已支持 `description_edit`；只能使用一张参考图、1024 方图和 800 字，不能承诺多参考。套图的运行、尺寸、提示词、CNY 费用与异步恢复仍有 OpenAI/旧 USD 假设；生产扩展源图/蒙版入口另有无条件 503。只打开开关不能关闭这些缺口。
- owner 分工：正常 I2I 由 capability/admission、media workflow、normal generation worker 和既有恢复 owner 负责；套图由 suite runtime/paid execution/repository/worker 负责；全仓共用严格的操作配置快照，文生图模型/价格可独立覆盖，参考/全图/局部继续使用原编辑模型和价格。默认覆盖为空，旧调用者和旧 USD 任务保持；业务价钱仍由服务端确认时冻结，不从 Provider 响应定价。
- 全量范围采用显式 rollout 语义，保留旧 allowlist 默认和关闭总开关时的拒绝；全量模式只放开已认证租户的功能准入，不改变角色/数据归属、设备/店铺授权、每用户次数和全局预算。生产启用须在相应实现和实测完成后操作，当前没有因这项源码工作开启开关。
- Web owner：三份旧断言按当前实际文案、日期 formatter 和父级禁用条件修正；确认框迁移到既有 SystemDialogProvider，异步批准绑定当前草稿与目标代次，替换对话框或卸载时取消旧请求。普通 Web API 实际请求优先使用既有同区同源代理，公开 URL 和扩展配对仍保持 canonical API 地址；不改系统 DNS/代理/浏览器权限，不把未复现的旧连接超时宣称已证明根因。
- 测试分类：旧静态合同按 T1 建立原失败基线后修复；确认状态、正常准入、配置/币种/恢复及 rollout 按 T2 执行最小 RED→GREEN；真实 UI、生产模式和扩展写入按 T3 保留具体输入/结果。只在整合后运行受影响回归和最终发布门禁，不重复已完成的付费质量校准。

### 本轮实现与已批准验收范围

- 用户已采用本轮配置和预算方案：四种正常操作各一张、套图两个槽位，总计最多六张、CNY 1；服务端报价统一 CNY 0.14/成功有效图片。每区日预算 CNY 10，COM 用户每日次数 100、CN 5 保持。旧 CNY 1.50 占位保持；每例只提交一次，未知结果只恢复原任务。扩展写入终点为自有 QA 来源及 ERP 测试草稿，Ozon 商品写入不在此范围内。既有区域签名、部署、官网发布和受管升级授权持续有效。
- 正常 Wanx 单参考 `IMAGE_TO_IMAGE` 已接入原 adapter、工作流、generation worker 和恢复 owner：一张参考、1024 方图、800 Unicode 字符、一次一张，完整合并正负提示词，超限拒绝。冻结价格和凭据 revision，发包前复查权限；已接受或未知的任务不会因队列重投再次 POST。正常链路 321 项定向验证通过，真实 PostgreSQL 已验证同一任务恢复、单次发包及唯一 CNY 14 分费用。
- 套图已接通 Wanx 专用短模板、CNY 价格版本和 v3 runtime；1024 方图输出等比 contain 至 900×1200，不裁切或拉伸。恢复使用 suite 自己的租约及独立审计 claim，最多 10 次、15 分钟；不占业务 revision 或混用 generic reconciliation 计数。旧 OpenAI/custom USD/v1 合同保持，合法旧 USD/v2 物化路径补齐。
- 规划前由 `ai-media-planning-sources.ts` 从实际来源字节冻结 hash，复用同范围资产并仅补齐未知尺寸/MIME；付费入口继续拒绝无 hash 引用。最多 25 张、单张 10 MiB、合计 50 MiB、12 MP、整轮 60 秒；进程最多两个底层任务，每 owner 一个，同 scope 合并，超时后名额保留直到底层结束。来源及并发拒绝分别有最小 owner 回归。
- 新迁移 `20260916110000_enable_wanx_reference_image_suites` 以单事务更新兼容校验函数，新增 Wanx/CNY/单参考严格约束，不改历史行、金额或列。真实失败回滚已验证。149 个迁移、24 个 PostgreSQL 文件、186 项全部通过；另 551 项套图/模板测试通过，80 项数据库条件测试由显式 PostgreSQL runner 覆盖。部署必须包含此迁移；产生新 Wanx 行后，应用回滚保留兼容函数，不恢复拒绝新记录的旧 CHECK。
- 操作配置 owner 一次严格快照读取 Provider、密钥、revision 和价格；独立文生图覆盖为空时保持旧语义，指定模型却缺正价时拒绝。生产扩展源图和蒙版入口使用同一正常准入，原两处无条件 503 已移除；身份、设备/店铺、数据归属、配额和输入限制保留。显式全租户 rollout 仍受总开关控制，省略 mode 的旧空 allowlist 继续关闭。
- 四项旧 Web 合同已修复并纳入 preflight；全部 51 个 Web 合同文件为 175/175、零跳过。确认框真实组件浏览器 14 场景通过；CNY/USD 从服务端到实际扩展 DOM 的七场景通过。普通官方 Web 的同区请求改走既有同源 `/api`，canonical URL 和扩展配对不变。历史底层网络故障的触发条件仍无证据，部署后验证实际同源请求，不把本地修复当作历史根因证明。
- 集成复核发现独立 `worker.ts` 仍默认读取文生图配置，会在指定独立模型后拒绝套图；现已显式选择 `IMAGE_TO_IMAGE`。实际入口 callback 的回归先 3 RED，修复后 99 项受影响验证通过，类型/lint 通过。原八份独立 I2I 技术原件及摘要已核对，旧 Wanx reviewed 静态清单同步补齐该操作，并增加缺失/替用文生图证据的拒绝负例；相关 51 项通过，没有把本次正常生产入口标为已实测。
- 全仓 lint、类型和受影响定向验证通过；整合 preflight 的全部静态合同通过，后端为 6232 passed / 313 条条件跳过，唯一失败是旧 dispatch 测试仍仅模拟 `getConfig`，新严格快照读到了默认配置。测试已改为在数据库边界提供同一配置，保留真实快照 parser，相关 26 项通过。失败日志保留；最终 clean 提交的原生九项 offline 仍须完整实跑，不能以定向补验替代。
- 正常线上新源码实测、正式 QA04 和区域发布仍待完成。上述本地结果不表示已全量启用；本轮截至此检查点新增 Provider 请求、费用、Ozon 写入、生产配置修改及部署均为零。私有证据集中在 `completion-20260916`，不进入 Git。

### 自有草稿的扩展入口与套图目标补齐

- `290853b6336e97b5f0649073df31377920e0e584` 已推送，最终原生九项 offline 于 `2026-09-16T13:25:05.298Z` 全部通过；它仍只是该源码的离线证据。本轮尚未制作/签名候选、部署或发出真实生图请求。
- 实测入口复核发现两项此前本地链路没有覆盖的缺口：现有 MV3 来源工作台依赖真实 marketplace 原生采集 handoff，ERP 自有 QA 来源/草稿没有可信启动入口；`HOSTED_WORKBENCH_CREATE_PLAN` 没有透传 `galleryGoals`，默认是 hero 加七个 gallery 槽位。Web 两槽计划不会自动成为当前 device/draft 的 hosted plan，不能直接写绑定记录、伪造采集 handoff 或手改计划/hash 来完成验收。
- 当前请求明确要求从 ERP 自有 QA 来源/草稿完成真实扩展写入，并批准只生成两个套图槽位，因此补齐正常产品入口后再冻结候选。ERP 启动只接受已配对设备和服务端核验的自有草稿，复用现有 owner/shop/device、版本、feature、报价与 command-grant；明确区别 ERP 来源与原生 marketplace 采集，启动本身不发 Provider 请求或 Ozon 写入。
- owner 分工：可信 ERP launch 由独立启动 owner、必要薄后台/bridge/route 和 Web 来源草稿按钮负责；套图目标由 hosted plan 合同、客户端、服务端 plan binding/idempotency 和真实工作台控件负责。`galleryGoals` 使用现有规划 owner 的枚举；省略时保留旧默认，显式 scene 由 owner 生成 hero+scene，不允许调用者直接指定费用或篡改冻结计划。已有活跃计划不静默替换，同一幂等键的不同目标应拒绝。
- 两项按 T2 先 RED→GREEN，并补真实组件/DOM 的 T3 验证。完成后只在新冻结源码上重新取得所需发布证据；`290853b6` 的 PASS 保留原适用范围，不用于未验证的新接口。六张、CNY 1、固定 QA 白杯原图、CNY 14 分成功张数计费及无 Ozon 商品写入的已批准范围保持。
- 套图目标已贯通普通控件、runtime/client、HTTP 和 hosted planning。后端 153 项、真实 PostgreSQL 16 项、八个扩展脚本通过；实际 hosted→planning 创建 hero+scene，重复回放保持一个计划，改变目标、换客户端 key 或恢复默认均返回冲突，不新增计划、版本或费用。旧 plan-binding PostgreSQL fixture 缺少原本必需的创建审计，已在同一事务补齐，未改数据库约束或业务 owner。
- 根 Agent 的最终 DOM 验证绑定实际 HTML/CSS/controller/client，四场景通过：scene 单选真实上行、请求等待期间锁定、读取到真实形状的权威计划/两槽/runtime 后继续锁定、390px 无横向溢出。边界是本地合成 HTTP 数据，一次本地建计划 POST，零 Provider/生产请求；不替代线上验收。早期 checkbox 值断言、错误合成 slot key 及不足以区别未知状态的断言均保留并注明纠正，最终证据只用 `gallery-goals-browser/receipt.json`（SHA-256 `53972ad4a18af53f1d30c40260dcd78e28d1da864ab7cf5bdc38419342b1b548`）。自建浏览器上下文和三个 fixture server 均已清理。
- ERP 来源启动已接通：账号认证端签发 120 秒随机 ticket，device 端核对同一 owner/actor/session/deployment、有效店铺、当前草稿/采集版本、feature 和 scope 后，使用 Redis 原子 CAS 单次消费。默认关闭、Noop Redis、非法 origin、发表态草稿和过期/重复票据均拒绝。页面不传账号 JWT 或自定 owner/role；后台保留明确 `ERP_SOURCE` 来源，复用正常工作台和编辑器的 tab/document session、报价和 command-grant，不制造 marketplace 采集回执。
- 后端 owner 为 `extension-erp-source-launch.ts` service/route；后台 owner 为 `shared/erp-adapter/erp-source-image-launch.js`，主 worker、会话、页面 bridge 和 message policy 仅作接线；Web 由 `extension-erp-source-launch.ts` 消费者协调器及来源草稿组件的可见入口负责。空 BYOK profile/key 不阻止正常 ERP 托管。独立复核发现并关闭同 owner 重配新设备后仍复用旧 ERP 工作台的问题，旧 device authority 被拒绝，清理重入没有死锁。
- 最终定向证据：后端 grant 17 项、独立真实 Redis CAS/TTL/限额三项通过；根 Agent 组合验证为后端十文件 178 项，以及新 MV3/Web 25 项通过。新增三份扩展合同和 Web 启动合同已注册 preflight。Web 设备核验、账号 ticket 请求、扩展打开分别有 8/15/30 秒期限，无自动重发；当前 scope、草稿切换、未保存图片/遮罩和卸载会取消旧请求。
- Web 的六项真实组件 DOM 验证通过，使用实际来源工作台、API、启动协调器和页面 bridge，仅替换本地网络/扩展响应及两个无关子面板。无商业发布资料的已保存 PRODUCT_ONLY 草稿可打开工作台；明确选择原图后可进入 INPAINT；等待、未保存修改及移动端行为正确，票据未进入 DOM/URL/storage。私有回执 `erp-launch-web/receipt.json` SHA-256 为 `826770e2b97b1787569d9c659d277a25f99ee044bfc1f4a6e9cf40b81e5b95a5`，两个本地 ticket 均仅消费一次，自建 context/server 已清理。以上不是生产 MV3 或新增图片验收，真实六张仍等待修复后的最终候选。

## 本地交付与 Owner

### 按顺序完善：先处理图片质量（2026-09-15）

- 用户已明确要求按当前六类清单依次完善。先推进图片质量，再处理正式对账、真实 ERP 全链、Ozon、正式发布和运维；外部证据或新增成本等待不改变已完成门禁的结论。
- 当前证据：第五次 INPAINT 564 字中，操作方向前有 350 字，全部传参和 mask 已离线核对；顺序对效果的影响仍是假设。官方 guide 允许动作或最终结果描述，但没有证明首段权重；watermark 默认 false 且位于右下角，不等于当前左上灰卡片；prompt_extend 仅见 SDK 示例，不引入未核清的 HTTP 参数。
- 第一个实现范围（T2）：在现有 prompt owner 增加仅供 INPAINT 已审默认模板使用的方向前置 profile。六条 v2 policy、模板约束与 negative 原样保留，只结构化调整块顺序，不对已渲染的用户文本做 split/replace；旧默认、v1/v2、自定义模板和普通 hosted 的既有行为保持。preview 继续不可发送，独立 experimental tag 只在 trial 显式接受且完整重验冻结快照。
- 根 Agent 负责 `ai-image-edit-prompt-contract.ts`、`ai-prompt-templates.ts`、trial prompt/input 薄接线与定向测试；预算 Agent 负责 campaign/execution 与新的不可变重指定 owner 及测试，各自独立 owner。先 RED→GREEN，再组合回归与冻结。
- 单张固定 INPAINT 已在可审阅输入和机制完成后取得新的明确批准并执行；普通“完善”指令没有被当作费用用途变更授权。旧五笔、scope、grant、claim 保留，旧 FULL_EDIT 已被撤销；真实授权、调用和未通过结论统一见[第六次实测](../current-state-audit.md#第六次方向前置-inpaint-与额度重指定2026-09-15)，不以免费抵扣或新目录恢复额度。

| 范围 | 唯一实现 owner | 调用者与消费者 | 验收边界 |
| --- | --- | --- | --- |
| 隔离实验提示词 | 根 Agent：`ai-image-edit-prompt-contract.ts`、`ai-image-edit-provider-contract.ts`、`ai-image-wanx-trial-input.ts`、`ai-image-wanx-trial-preparation.ts` 及定向测试 | 原编译/准备 CLI、single-submit 的 trial 路径 | 新实验 profile 显式选择且绑定完整快照；preview 仍不可发包，普通 hosted 仍固定 v1；历史 v1/preview 摘要不变 |
| 跨 round 累计上限 | 预算 Agent：新的 campaign 预算 owner、`ai-image-wanx-trial-execution.ts` 与专用测试 | trial claim 及最后发包校验 | 同一物理私有根绑定账户和 CNY 1；读取并保留历史已消费槽位，跨进程累计，超限在发包前拒绝；失败/未知/免费不释放金额 |
| 已批准的固定追加 | `ai-image-wanx-trial-campaign.ts`、`ai-image-wanx-campaign-authorization.ts`；execution 复用原 claim | 离线 campaign CLI、v4 草稿/核验、single-submit | 只对原四笔各 0.25 的完整历史追加 0.50，累计 1.50；原记录不变，绑定获批提案与新执行输入，INPAINT 质量通过才可 FULL_EDIT |
| 原生控制台明细 | 账单 Agent：新的 ListConsumeDetails 观察 owner、必要的共享原生 JSON/金额 reader 及测试 | 根 Agent 接入现有 billing CLI；真实私有采集回放 | Count/Data 原始响应及查询范围保真；账号、分页、日期、精确金额、免费抵扣分别验证；只输出脱敏观察，不能生成正式结算或晋升能力 |
| CLI、组合门禁和真源 | 根 Agent：billing CLI、package scripts、对应 CLI 测试、`dev-docs/` 和必要 runbook | 操作员、后续 Agent、正式原生证据回放 | 完成源码/命令验证后，使用真实已采集账单回放；准备新的可审阅输入，任何新真实请求等待单独批准 |

## 顺序与测试门禁

1. **T2**：先在各 owner 写失败用例，确认缺失行为 RED，再实现 GREEN。共享 JSON reader 若提取，按 **T1** 先建立 QueryBill 原门禁基线并保持其输出/拒绝合同。
2. 实验 profile 仅在明确 trial 语境接受；不修改按量金额、账户身份、正常托管开关、Provider 或原 v4 审批字段含义。
3. 累计预算在本目录的已核对账户作用域内执行；历史占位按最大授权额导入，不能按临时零费用抹去。并发预占必须先于当前操作槽位，最后发包前再次核验。
4. 控制台观察保留 ListConsumeDetails 身份和 native 日期/数量/金额，不包装成 QueryBill。字节完整性不等于采集认证；待对账状态与 `actualCost:null` 继续保留。
5. 组合回归、类型检查、构建与适用的完整门禁通过后形成单一目的提交；真实账单回放和后续实测分开记录。不得以 mock、测试数量或免费额度替代真实质量/结算验收。

## 当前执行记录

- 已完成当前真源、代码与 Git 基线核对；以上三个范围可并行实施，各自只写所列 owner。
- 实验 profile：18 项新增用例中 14 RED、4 原有拒绝基线保持通过；实现后连原 prompt/preview/preparation 为 114 项通过。补齐 v4 到 single-submit 的实验 INPAINT 正例与两种 v1 摘要零 POST 拒绝，未改变真实请求 fingerprint 含义。
- 跨 round 预算：13 项初始 RED；补齐只读观察、并发进程、故障留锁及篡改等 21 项。独立复核发现同前缀普通文件误当目录，再以 3 RED 修复并增加 6 项兼容/拒绝回归；最终 campaign 27 项与 execution 20 项组合 47/47 通过，复核确认问题关闭。
- ListConsumeDetails：50 项初始 RED；内嵌 JSON 空白、凭据键拒绝另有 RED→GREEN。最终新 59 项及旧 QueryBill 48 项通过，T1 提取保持旧合同；CLI 已新增实际子进程正反例，并纳入 sandbox strict typecheck。
- 真实私有账单与历史预算已在工作树只读回放，结果及私有摘要统一记录于[当前状态审计](../current-state-audit.md#生图实验与累计计费本地收口2026-09-13)。这一步不产生结算，也不消费第四次槽位。
- 当前源码已冻结；完整 preflight 通过，包含后端 5808 passed / 258 条条件性 skipped、扩展 459 pass / 0 failure / 0 warning；全仓 lint、sandbox strict typecheck、定向 CLI lint 和 server build 通过。20 个受改源码/配置/测试文件在整轮门禁前后 SHA-256 一致。该结果是本地门禁，不能代替独立 PostgreSQL/Provider/正式 QA-04 验收；独立 clean 检出上的后续回放与新输入准备见下条。
- 提交前 staged diff 检查发现新原生 JSON helper 的文件尾多余空行，按 T0 清理并复核 diff；门禁后没有其他源码调整。
- 源码已提交为 `18ec006d`，真正独立 clean 检出及离线锁定依赖已就绪；该提交上的正式账单 CLI、预算只读回放、新输入 compile→prepare→verify→approval-draft 均已完成。未批准草稿被收费前核验拒绝，原审批/claim/report 未改，未创建新执行预占。详细结果以当前状态审计为准，不复制第二份账单或输入清单。
- 上述 2026-09-13 本地交付记录未产生新的 Provider 请求；随后第四次实测、118 项新鲜定向测试、质量复核及费用观察见[2026-09-14 接续记录](../current-state-audit.md#第四次实验接续与质量验收2026-09-14)。本次未修改产品源码、未执行 ERP/Ozon 写入、推送或部署。

<a id="剩余外部验收"></a>

## 历史供应商试验观察

以下保留原单图试验的未验证事项，不再作为本次正常功能的前置。本轮已停止该试验与供应商账单轮询，正常任务费用按上方用户纠偏后的规则执行。

- 2026-09-15 第六次单张重测已执行，主/独立质量复核仍拒绝，旧 FULL_EDIT 已撤销；累计占位达到 CNY 1.50 上限。六条临时免费抵扣明细已核对，第六次当日用量仍延迟；原生关联与最终结算未关闭，详细结果统一回写[当前状态审计](../current-state-audit.md#第六次方向前置-inpaint-与额度重指定2026-09-15)。
- 新实验提示词的真实质量、正常 ERP 任务来源与候选接收链、非零扣费分支及正式单任务最终结算尚未通过。
- 前六次输入和单次审批均已消费，不得重用；保留结果与全部占位，新实测另需完整预算和具体审批绑定。
- 当前离线诊断未证明质量根因；本次追加的继续执行条件已失败，新的生成需要新的具体方案与批准。原生账单只读核对、质量阈值和正式结算要求保持。
- 外部账单最终性遵守原计费 runbook，不能仅凭日期、零应付或单条时间窗匹配宣称完成。
