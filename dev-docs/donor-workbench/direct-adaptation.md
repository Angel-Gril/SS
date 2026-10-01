# 旧扩展直接适配 SS ERP

## 当前结果：双区 1.0.398 与真实托管套图通过；官网仍为 1.0.395

用户确认以 `C:\Users\550W\Downloads\jp20260803` 的成熟界面与操作流程为基础直接改造。旧目录保持只读，实际复用的源码放在 `extensions/ss-erp/pages/donor/`，入口为 `pages/precision-workbench.html`。当前产品开发不把新一轮付费 suite 或官网发布证据作为界面、采集和草稿接线的前置条件。

之前阶段的“完成”描述证明的是当时的接口/发布边界，不等于旧扩展全部功能已经可用。旧入口在 `donor-workbench-bridge.js/showFrame` 只有 precision flag 关闭时才回退到现有 media-focus 卡片；这是受控回退，不是默认切换完成。当前两区应用部署为 `58cc814e / 1.0.398`，官网仍为 `3723f5dd / 1.0.395`；官网切换与默认入口退出旧流程属于后续验收范围。

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

### 2026-10-02 1.0.398 安装与真实套图；历史恢复阻塞

- `a81d8860` 首先保留实际结构化来源媒体键；真实安装版发现 MV3 客户端同时要求 URL-free 引用，最终修复 `58cc814e8af12fec478f267812068e2f833bddaa` 将公开候选 ID 投影为稳定的 `media-key-sha256:<hash>`，执行仍使用原冻结引用。最小 owner 回归先 RED 后 GREEN，含实际 shipped MV3 parser，`49/49`、server typecheck/lint 与客户端/runtime 定向验证通过。两个实现提交均已推送。
- 该提交完整原生 offline PASS：server `6418 passed / 325 skipped`、AI PostgreSQL `197`、`150` migrations/upgrade，以及 Web/server build 和 source/cloud/local verifier 通过。执行 checkout 是 clean LF detached Git worktree；私有原件为 `release-58cc814e-website/qa04-offline.json` 和 `.log`。不因后续仅文档提交重建候选或重复生图。
- COM/CN 已使用独立区域 `1.0.398` 候选完成签名与标准部署；current、三服务 cwd、数据库/Redis `/ready` 均匹配该提交。COM 保持 DOTH、`IMAGE_TO_IMAGE/SUITE` 和原受限 policy；CN 保持 direct/RDS、AI/BYOK/Ozon dark。两区完整 VPS verifier 各 `0 failure / 1 warning`，warning 仍为远端备份未配置。COM r2 验证后同设备通过合法 reauthorization 更换 session，已另取绑定当前 `cac55bf3…/d6f4d05d…` 集合的 r3 完整 VPS PASS 原件；r2 未改写。

| 不可变产物 SHA-256 | COM | CN |
| --- | --- | --- |
| Cloud ZIP | `babe2436f15b7614495ccfdcc4040670e21867904afbca572ef738c820d554db` | `50f554a20c07b4223ac5de7ec676bc8a8ad9f7ee6be64ed7fafcf696031f19b9` |
| Local ZIP | `c5721f4d57d45eea6aa55aa1bfb300b3c0dd5c7514ce38837106a520c8a80145` | `6de6557e2ff5b756a9f21ed5ec07eb6c2fc15c9755ca8e7e440c254f2c3f2b22` |
| Release evidence | `086a1c5c877c4588d53cac8087df5fd08fa1bb7b7e5a1031368b5cb177ca0fec` | `1e9b3c0a678e42311e380913626891f95c02f0ad2924bcb1a3c72f64834d1191` |
| Detached signature | `1251c37804c7e6276c72c85296f1914a4149b36276684ec61019ce6afd5e9d0a` | `0f1798b79af5cb00ee2735721425ef990c5ea5f4cc69d926c74b92379e0fc74b` |
| Full VPS（COM r3 / CN 原件） | `fe3e1224477c70ce78ef10da79257baf0da99233069588e1cc1e700e7da7d069` | `9fe116397b3237006da84abfaa81a1e0d78e13c36bc02382209b15a7031a1db1` |

- 专用 `9444` profile 在固定目录加载签名候选原字节 `1.0.398`；active Worker 和 Unicode smoke 均通过，原 `9222` 用户浏览器未关闭或重载。COM 真实 1688 source-page canary PASS，SHA-256 `2e37b53af6e743ab8aef2b85ab335ba53f138b7b58074dd042f8189b253aeafe`；原 runner 记录滑块遮挡及物理输入未触发后的受控 DOM fallback，不能称无遮挡或物理点击验收通过。另 COM/CN synthetic installed-package runner 连续三次在 Worker/target/runtime attach 超时，保留全部失败原件并停止盲重试，不能宣称双区该项通过。
- 用户本轮单独授权的一次两图 hosted SUITE 已完成：`cmupv1g9k00015o9sfs2sxoxk` 两槽均 `SUCCEEDED/attempt=1/900×1200 PNG`；原始 START/CONTINUE、审核前 `PENDING` UI 与同期数据库、两份预览及 APPROVE 回执均保留。两笔唯一 `SETTLED/CHARGE` 各 CNY `0.14`，合计 `0.28`，该费用授权已用完，不得再发新的 Provider POST。预览保留收纳盒主体且无可见水印，但两图均接近原背景，未证明明显创作差异或中性棚拍方向达成。
- store-draft assignment 成功：隔离 DOTH 草稿 `r1/v1 → r2/v2`，增加 SKU hero 和 PRODUCT gallery 两条；shipped Worker credential lifecycle owner 使用原请求和原幂等键的 replay 返回 `200/replayed=true`、同一 batch 和两条 assignment。旧失效 session 的 replay 失败原件另行保留。最新 `2026-10-01T19:29:22Z` 只读数据库仍为两条 assignment、两版草稿、两槽 APPROVED、Ozon publish attempts `0`。
- 当前正式 QA04 阻塞与本次成功 suite 无关：全 owner 待处理计数为 `{jobs:0,costs:2,recovery:4,workflows:0,suites:0}`，来自 9 月 29 日旧失败任务。两笔费用释放曾被真实 suite graph 约束拒绝并完整回滚；原因是 admin cost owner 把零计量 suite child 的 `actualCostCents` 写为 `0`，现合同要求 `NULL`。隔离 worktree 已准备最小修复及真实 PostgreSQL RED→GREEN `19/19`，typecheck/lint 通过；尚未整合、提交或部署。原 job/ledger/历史费用未改写。
- 主 Agent 已复读 patch 和 RED/GREEN 原件，并在本机独立 schema 再次重放 150 migrations、复跑同一 19 项最终 GREEN，随后清理该测试 schema。修复位于 ignored `build/cost-release-owner-58cc814e.patch`，SHA-256 `3b902315f3ea80e7eebfbd5611b09917161b71f72757000469ad3b0cf821cba2`；主 Agent 复跑日志 SHA-256 `23b1dff49ac54efa399fc00a55f6a4dc6c719b4654c0889d93ed44fd0176461a`。它只修费用投影，不会关闭四项 recovery；整合成新 backend 提交还会被现有 source bridge 拒绝沿用 `58cc814e` normal evidence，不能假设文档例外同样适用。
- 四个旧任务曾有真实 `880×880` Provider 输出，不能因 ERP 未持久化合格图片而标为 NO_OUTPUT。通用 recovery 与 suite nested runtime 格式不符，且原 dispatch/acceptance 已超过 24 小时；suite 专用 recovery 只支持 RUNNING 有效 claim。现 owner/SQL 没有明确“放弃恢复”终态。仅这四项的受审计终止恢复及另两笔未交付 ERP 预留释放已提交用户确认；未得到答复前不扩展状态合同、不手工 SQL、不删除原件、不缩小 pending 门禁。
- 本地原件交叉核验报告 SHA-256 `28e22578e3c19b9fc40c4b10fc574ad43bfc24f2948eaa59855a2c1f90a511f3`，同时核对两区 ZIP/evidence/signature 字节、审核时间序列、唯一结算和 replay；它是独立私有审计，**不是正式 QA04**。原 launch binding 的 sourceAssetId 为 null，已另建引用真实 normalized reference/审核前数据库的独立 binding（SHA-256 `6aab0f1675b01d611b48b9445976c77382a56b4886f7e257748b136050b23081`），原件未覆盖。
- `19:41:17Z` 目标关闭观察（SHA-256 `2ca42be2eeb299d7245900f213e091c5d3c59d40f18df1fe387276b103aa705d`）通过 OS 核验专用 profile：原 workbench target 已不存在，明确记录 `ALREADY_ABSENT_OBSERVED/closeDispatched=false`；原 Web target 仍在，重新只读核对登录 owner 后实发 exact close，再读两目标均不存在。`9222` 原浏览器身份前后相同，不伪称本轮重新关闭已不存在的页。
- 依据该 v2 原件索引组装正式输入，SHA-256 `9bd5506bd81eda89959cf4142587e72adcc1f86bf8edefcbf9814ba33e1c658f`；选择实际 media execute 的原始 `start-request-2/continue-request-2`，另保留第 1 份 command-grant 原请求。clean `58cc814e` 上实际调用未改写的 native QA04 producer，审核前、Provider/队列/账本、审核与 assignment 的检查已走过，准确在 `qa04-final-suite-evidence.mjs:324` 的 controller 条件拒绝为 `QA04_SUITE_INVALID`（实际历史 pending 非零）。保留拒绝原件，未生成正式 PASS。后续不得为关闭历史项改写本次输入、controller pending 或计费证据。
- 两区匿名 latest 于本轮仍返回 `3723f5dd / 1.0.395`。正式 QA04、REL-04 publication canary、website approval、distribution probe、CAS 尚未执行。donor precision 仍为默认关闭的受控预览；本次旧工作台 hosted suite 通过不等于 donor 全部功能验收、BYOK/Ozon 真实验收或默认入口切换完成。

### 2026-10-01 签名与双区部署

- 用户明确授权 push、签名和部署；固定目标 `94fc7460ca8dc29b7fe0cbfccce06ddb03ddbf4a / 1.0.396`。构建只读 Git blobs，两区串行使用独立输出，COM origin 为 `app/admin/ss-erp.com`，CN 为 `app/admin/ss-erp.cn`，Local API origin 固定 `http://127.0.0.1:3001`。正式归档 verifier 各区 Cloud `575 pass`、Local `565 pass`，无 failure/warning；使用现有 Ed25519 key `ss-erp-extension-release-2026-09-05-01`，未轮换 key。

| 产物/证据 SHA-256 | COM | CN |
| --- | --- | --- |
| Cloud ZIP | `51086cb30b5032afd86d3e9814417bf2fe07d7ead9cf514f7e757cf1d52f1565` | `2ada355cbe0175e4d0c7f52cd0b6f347d351447489d606de097ddb96d81da080` |
| Local ZIP | `5c3ffea23f2ba84726c8d10753a2cce03b028960e04d57a03b8d7540ccd37223` | `2462091a0d3c3bbe8a994fd449925325ee026a5e26daeb71839dfdba0320c7d9` |
| Release evidence | `4dd190cc0ba5c019c754beb4714a1b088fab60a3396978c8d95f3e7cf7ec5ac6` | `5de64df6686d7a22c5860191c90ba1cbcfddc6e017cfe5fab09bfd87c1f8bb43` |
| Detached signature | `858ccb3d62ad0d44114186e624b5998e7b7654ae48f6c7e2d5115a068443a975` | `fad70abd6cee1a256708db020a2f95a8a35c9654d19b2a7511ed70a18002c9b8` |
| Deployment backup attestation | `f1661d34f965b5c1c080158dc67240ef99a31b4a61a4cafc074a9bbc927c5ee2` | `1605385aeb982606b8955d840d3d513ac9b012d02240ca217573c6ec59a9b06e` |
| Full VPS verifier | `ea9a111357a4fa77f2a8a3a79201679989f58133498ad0ce365fcb3f426e4412` | `b995af431259ca81c2e0c1c88ff083ea4c8d582d0dab7867f8fbe08814b687f8` |

- COM 首次尝试因缺少 target-bound backup attestation 在 migration 前停止，没有切换 current；立即恢复旧 API/Worker。标准本机 `postgres` 恢复路径验证 61 MiB 备份、144 张 public 表，删除临时库后生成认证；未激活 release 保留在 `/opt/ss-erp/failed-releases/94fc7460-backup-gate-20261001`，随后重新执行 `deploy-pilot.sh` 成功。CN RDS 的既有恢复路径验证 22 MiB 备份、143 张 public 表并成功删除临时库，无需创建新的 maintenance 账号。
- CN 误预置的 COM 原件在部署前按摘要核对并保留为 `94fc7460ca8dc29b7fe0cbfccce06ddb03ddbf4a-wrong-region-COM`，正式候选已替换为独立 `.cn` 构建；两区 current 与各服务 cwd、区域签名均准确绑定目标 commit。
- 两区 150 migrations 无待执行项，suite DB guard（8 functions/14 triggers）、源码封存、SystemConfig OSS、systemd、DB/Redis、本机与公网 `/ready` 通过；CN 四个合法 `.cn` hostname 的证书/就绪检查通过。完整 verifier 各 `0 failure / 1 warning`，唯一 warning 为远端备份未配置；正式原生 JSON 在各 VPS `/var/lib/ss-erp-donor-deploy-evidence/94fc7460ca8dc29b7fe0cbfccce06ddb03ddbf4a/`，不写入 Git。部署备份 `/var/backups/ss-erp` 和日常备份 `/var/backups/ss-erp-runtime` 分离，后者已经刷新为当前 commit；CN 例行 retention 清理 1 个超过 7 天且无证据引用的旧备份。
- COM 保持原 owner `cmpsj2g6800005ow9rrtvqhay`、DOTH `cmq7r8n1700095o7exbet1xle`、active session `cac55bf3-b924-4327-aae4-6bb8db90894e`、rollout revision `15` 和既有 source policy revision，仅 `IMAGE_TO_IMAGE/SUITE`；CN AI/BYOK/Ozon 全暗。donor precision 仍默认关闭且按精确来源 allowlist 预览，未切换所有用户入口。新 editor 匿名调用返回 `401`，两区登录/下载页 `200`。
- 官网仍服务 `3723f5dd / 1.0.395`。本次没有 website approval、REL-04 publication canary、distribution probe、CAS、真实 Provider/Ozon 写入或新增业务费用；应用部署通过不代表官网最新版公开或真实第三方功能验收通过。

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
- 当前 HEAD 为 `1f9d8eba`，本轮已提交但未 push、未签名、未部署；没有 Provider/Ozon 请求、生产 mutation 或新增费用。

### 2026-10-01 当前 HEAD 最终本地 fixture

- 默认 donor fixture：`C:\Users\550W\AppData\Local\Temp\ss-erp-precision-ui-evidence-A7hVLe\summary.json`，覆盖 16 SKU 选择、`COLLECT → CREATE_DRAFT`、价格/货号、包装、官方类目/属性、俄文文案候选/审核/VALIDATE、托管套图 `START → REVIEW_SLOT → ASSIGN`、publish preview/confirm/status；`pageErrors=0`、Provider/Ozon/production mutations=0。
- BYOK 与翻译 fixture：`C:\Users\550W\AppData\Local\Temp\ss-erp-precision-ui-evidence-nMABkC\summary.json`，覆盖单图未知结果只读恢复、PNG Blob 预览、显式审核、ingest/readback 和 `CREATE_TRANSLATION`。
- 参考图、全图修图、圈选重绘 fixture 分别通过 `--byok-edit-quick`、`--byok-edit-full`、`--byok-edit-inpaint`；Cloud 包验证 `568 pass`、Local 包验证 `564 pass`，均 `0 failure / 0 warning`。完整 `pnpm preflight` 已通过（server `6417 passed / 325 skipped`）。

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

签名部署候选：COM 本机四件套在 `C:\Users\550W\AppData\Local\SS-ERP\private\extension-release-candidates\94fc7460-1.0.396`；CN 在 `build/donor-release-cn-94fc7460-1.0.396`。各区 VPS `/var/lib/ss-erp-extension-releases/94fc7460ca8dc29b7fe0cbfccce06ddb03ddbf4a` 为不可变四件套，detached signature 在对应 `/var/lib/ss-erp-extension-release-signatures/` 目录。旧测试包继续保留，不能替代正式区域候选或官网分发证据。

## 持续开发顺序

- [x] A1.1 直接复用原工作台、表格、SKU 弹窗、预览与缩放。
- [x] A1.2 在同一窗口接采集/所选店铺与 SKU 的草稿创建，并完成本地行为/浏览器/MV3 验证。
- [ ] A2.1 扩展草稿详情/字段保存和类目属性 owner 接口：**详情、售价/货号/官方类目、每 SKU 包装、官方属性、文案候选和 VALIDATE 已接线**；复制行的服务端持久化仍待完成。
- [x] A2.2 接通 donor 原 1688 采集器，完成 canonical 映射及同一实时商品的 SKU/图片只读验收；其他平台另行接线。
- [x] A2.3 接自定义提示词、单图/套图、修图、翻译与 hosted/自带 API 设置，同一工作台显示审核和应用：**自定义 hosted 方向、BYOK 单图、参考图/FULL_EDIT/INPAINT owner flow/控件、图片翻译 CREATE_TRANSLATION 入口、套图审核/应用、自带 API 设置和私有 frame/session owner 已完成本地接线与浏览器 fixture**；真实 Provider、翻译质量和最终安装版验收属于后续 A3 运行验收。
- [x] A2.4 接现有 ERP publisher 的预览、明确确认和回执到原上传按钮；本地 owner/浏览器 fixture 已通过，真实发布属于 A3。
- [ ] A3 在功能链完成后执行对应实时商品与第三方验收，再生成签名发布候选。

用户明确要求完整功能通过后排除旧扩展。当前保留旧入口作为回退；A2.3/A2.4 与最终功能验收完成后切换默认入口并退出旧媒体流程，不能因仅采集/编辑通过而提前删除共享权限、计费或 publisher owner。
