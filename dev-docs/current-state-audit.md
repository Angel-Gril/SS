# SS ERP 当前状态审计

接续核对日期：2026-09-08，本轮源码整改基线为 `cede0e4f`。源码加固与备份阶段、后续直接试点分开记录；后者已经执行一次真实 Provider 请求。下方 2026-09-06 的运行记录是历史快照，不能用旧部署记录声明当前线上状态。

## 2026-09-08 接续核对与本轮边界

以下是源码加固与备份阶段记录；授权后的最新外部试点结果见下方“直接试点续接”，不再以此前的“尚未执行 Provider”概括当前状态。

- 真源冲突裁决：`git log -8 --oneline`、clean `git status --short --branch` 和当前源码确认分支已到 `cede0e4f`，原文的 `0ede34eb` 只是较早检查点。QA-04 首尾 clean HEAD 校验已存在；Ozon approval manifest 与 append-only reconcile 已在 `2a05dda7` / `cede0e4f` 完成。旧文档不得被用来重复实施这些修复。
- 新鲜本地基线：QA-04、REL-04、Ozon sandbox 联合合同为 `32 passed / 0 failed`；这不是正式 QA-04 完成证据，也不证明任何真实外部试点或部署成功。
- 本轮实现：REL-04 v2 绑定区域、版本、release evidence、签名和完整 VPS verifier 回执。共享合同为 `packages/shared/src/rel04-release-evidence.ts`，canary 负责生成，website approval 与 API 分发负责消费，`verify-vps-deploy.sh` 负责完整运行验证的结果。VPS 回执仅在全部检查结束、无 failure、候选签名有效且 deployed commit 未漂移时生成；warning 保留，输出不可覆盖。
- 验收边界：新 canary 使用 v2；新 website approval 必须消费 v2 且匹配候选摘要；已签署 v1 的历史官网发布继续验证。缺失、错配、过期或失败的证据必须在网络/设备配对前拒绝。T2 先观察上述负例 RED，再实现并运行发布消费者回归；QA-04 补 staged/untracked/运行后 dirty 的既有行为覆盖。
- 新鲜验证：新增 canary/发布消费者、服务端下载和 verifier JSON 输出用例均先观察到目标 RED 后转 GREEN。十组 Node 合同联合运行 `103 passed / 2 skipped / 0 failed`；server `extensions-download.test.ts` 为 `22 passed / 3 skipped / 0 failed`。跳过项为既有 Windows/POSIX 条件用例。shared/server typecheck、受影响文件 ESLint、server build、Node/Bash 语法、`git diff --check` 和文档 adoption 结构检查通过。
- Git 与证据状态：`e5826543`（QA-04 覆盖）、`e7a3550e`（Ozon 模板）和 `c10cdc61`（发布证据链）均已推送。独立复核发现的签名前 VPS 回执缺口已修复，v2 同时绑定 `vpsStartedAt/vpsVerifiedAt`，所有发布消费者使用已验证签名时间作为下界。
- 提交前追加验证：签名前完成和跨签名窗口均先复现再修复，发布/VPS 五组合同 `78 passed / 1 skipped`，下载服务 `23 passed / 3 skipped`，shared/server typecheck 与受影响 ESLint 通过。独立复核确认时序修复及所有消费者接线，无剩余阻断发现；该复核没有访问外部系统。
- 当前授权：提交/推送、测试、区域候选准备、签名、既有区域 VPS 部署/验收和官网切换已由用户新请求纳入任务。各步骤仍以通过的实际证据为前提；真实 Provider 写入仍缺可对账账户和明确费用上限，Ozon 写入仍缺真实测试商品事实，不能虚构输入。远端备份继续延期，Redis 拓扑改造未包含在本次验收授权中。
- 完整离线门禁：`c10cdc61406d1467bbb5d309214b4824755203f5` 的 clean Git 首尾绑定通过，`pnpm qa:04:offline` 九项全部成功，包括全仓库 lint/typecheck、完整 preflight、server/Web 构建、148 migrations 的隔离 PostgreSQL 回放和扩展双模式构建。source/cloud/local verifier 分别为 `459/464/460 passed`，均 `0 failure / 0 warning`。该结果仍是 offline rehearsal，没有生成 `QA04_FINAL_ACCEPTANCE`。
- Linux 补充验证：同一 commit 的 Git archive 在只读挂载、断网的 Node `22.19.0` 容器中运行 VPS/签名/发布关键合同，`45 passed / 1 Windows-only skipped / 0 failed`；覆盖真实 POSIX 私钥权限分支。镜像 digest 为 `sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90`，没有挂载工作区 ignored 文件或个人 profile。
- VPS 基线与备份恢复：COM 仍运行 `0b8c664a5e58a4a9f580c69ac43a1cc15b42749d`，CN 仍运行 `a986d0f6817d4c1783f510ac56410687817ccdfa`。两地最初各有 1 项过期部署恢复认证失败；按原 runbook 生成新本地备份并在临时库恢复后，两个完整 verifier 都恢复为 `0 failure / 1 warning`，唯一 warning 为远端备份未配置。COM 备份 `48,868,777` bytes / 恢复 `144` 表，认证 SHA-256 `99b6e2b42ebe2e52957b64cdc72ec38e966c820819b6ed9926ae3138146e8c94`；CN 为 `17,367,033` bytes / `143` 表，认证 SHA-256 `44e68fb43899ef2bf93d69828e118ac4b627fdc94da7d1a0ed8f6172485851b5`。两个临时库删除均已复查，旧认证已归档，未清理旧备份。120 分钟的部署备份时效要求保持不变。
- 当前公开面：COM/CN `/ready` 均正常，官网 pointer 分别保持 `1.0.316 / b64b723c` 和 `1.0.311 / d27b3ad8`；本轮没有部署 `c10cdc61`、切换 pointer 或执行 Provider/Ozon 写入。VPS/备份结果只绑定各自当前运行 commit，不能用于新候选的 canary。
- 剩余真实阻塞：三个 Wanx 编辑操作的私有回执仍记录 `UNRESOLVED_ACCOUNT_IDENTITY_MISMATCH`，API Key 所属计费账户与已登录 Bailian 控制台账户不一致；尚未获得新的匹配账单和费用上限，也未获得测试商品包裹/类目/价格事实。用户已授权后续流程，但不能由代理填造这些输入或把旧未结算证据标为 QA-02 COMPLETE。已向用户请求非密资料；正式 canary/官网签署继续受该证据门禁限制。
- 操作记录：脱敏 operator summary 保存在受保护目录，SHA-256 为 `a3be906d112ac60ae0b3992411f57cf90df842d79903444fedbcd93be1eae85f`。它记录本次命令结果与副作用，不是正式 QA-04 或新候选部署回执。

### 直接试点续接（用户授权后）

- 授权与范围：用户明确委托直接测试，不再要求其填写内部审批字段。保留一次性精确审批、费用记录与失败恢复要求；不把“所有权限”当作真实商品事实或账单。内部整轮参考预算为 CNY 1，单张分配约 CNY 0.25，不是 Provider 硬消费限额。未修改业务开关、库存、部署或官网 pointer。
- Provider 身份核实：当前 Xiaoyi 的图像 API 为 `https://image.xiaoyiapi.xyz/v1`、计量域为 `https://xiaoyiapi.xyz`、模型为 `gpt-image-2`。官方 `/api/status` 显示 USD、每单位 500,000 quota、参考汇率 6.77 CNY/USD。历史 CNY 0.0119 的成功记录属于另一端点，不能充当 Xiaoyi 报价。人民币草稿未批准、未执行，原样保留；美元草稿按现有 owner 生成并校验，内部预留与上限同为 USD 0.036926。
- 真实生成：在 COM 当前部署提交 `0b8c664a5e58a4a9f580c69ac43a1cc15b42749d` 的私有 clean checkout 执行 `TEXT_TO_IMAGE / OZON_PORTRAIT_SINGLE_V1`。前置 GET-only 预检、独立 approval 与无密钥 verify 通过后，仅发送一次生成请求，25.513 秒完成。结果为一张 `1024×1536` PNG，1,569,879 bytes，SHA-256 `d042df51cfaff605b4505f629b47a30df23152a2190bc65e50525cee97b08339`。已目视检查白杯/灰背景，无可见文字、Logo 或个人信息；它是合成测试图，不证明真实商品属性，也不证明编辑或局部重绘能力。
- 账单仍未关闭：同一凭据的 before/after 各 7 个只读请求通过。前置日志为空，后置出现唯一的模型、路径、时间及耗时匹配消费条目，记录 29,995 quota，按平台单位折合 USD 0.05999（参考约 CNY 0.4061323）。但 Token 标记 `unlimited_quota=true`，`total_used` 与 `total_usage` 增量均为零；去缓存复查的 3 个响应仍一致，Cloudflare 状态为 `DYNAMIC`。日志值超过已批准单张上限，因此停止后续付费请求；不能用零累计值宣称 `NO_CHARGE`，也不能把日志换算值伪装成已通过双计量核对的 `actualCost`。原 report 维持 `actualCost:null`，没有生成正式 settlement 或 QA-02 COMPLETE。
- 证据保全：原 CLI 固定写入 checkout 的 `tmp/ai-image-sandbox`，不消费 `AI_IMAGE_SANDBOX_EVIDENCE_ROOT`。本次原始 intent、fingerprint claim、report 未修改；另以独占创建保存字节一致副本到共享私有证据根，并保留 custody 记录。不得用新路径、新 ID 或新 checkout 重发同一 fingerprint。私有观察摘要 SHA-256 为 `86cf26f0610b6df6be371f0ccdd6d63b395c1a78ea933c1feb85983c21f712f0`；原始账单、账号字段、凭据和图片不进入 Git。
- Ozon 真实只读检查：通过现有 OzonClient，对指定 ERP 别名 `DOTH` / Seller `DOIT` 完成 5 个只读 RPC。`ARCHIVED` 查询 total 为 259，`ALL` 查询 total 为 23；只抽样各 10 行，不能据此断言全店没有测试商品。抽样未找到保留测试前缀；一件已归档商品具有类目、包裹重量/尺寸、币种、价格及 VAT，已能从自有店铺取得资料，不必让用户编造参数。但其图片数组为空，测试专用隔离、正常 capture/workflow/compiler 绑定仍未证实；没有复制商品、改库存、import 或 archive。私有证据 SHA-256 为 `5e63a305333cd8296138e5e36c6682c1afefdedf4dc9a94a68375d417d1db271`。
- 测试分类与回归：本次真实 Provider/Ozon 观察为 T3；仅补现有计费 owner 的 T1 特征测试，不改变业务规则或结算格式。先建立 `81 passed / 1 Windows 条件 skipped` 基线，再加入“零累计计量 + 正数消费日志”下拒绝伪造零费用和拒绝无计量支持的收费结算两例；结果为 `83 passed / 1 skipped`，拒绝前不产生结算 claim/receipt，原始 intent/report 保持不变。没有声称对既有实现补做历史 RED。
- 提交前验证：受影响测试文件 ESLint、server typecheck、`git diff --check` 与内部文档 adoption 结构检查通过；GitHub API 只读确认远端为 private。2026-09-08 06:21 UTC 再次读取 COM/CN 当前 commit 与 pointer，仍分别为 `0b8c664a / 1.0.316` 和 `a986d0f6 / 1.0.311`，两地三个服务均 active，公网 `/ready` 均正常。该轻量读回不是重新运行完整 VPS verifier，也不刷新旧备份认证。
- 发布结论：真实单张生成已验证，但完整 QA-02/正式 QA-04 尚未关闭。按现有发布合同，不能为满足进度把该结果升级为正式候选、canary 或官网发布批准；新代码部署、签署官网 approval 和 pointer 切换均未执行。远端备份延期和 Redis 拓扑不变；旧备份恢复认证在部署前仍须按 120 分钟时效重新检查。

### 用户凭单澄清与独立准备

- 用户提供了本次消费详情截图，并明确该账户充值为“1 CNY 兑换 1 个显示 USD 额度”；本次现金成本应按该 1:1 账户规则记录，不适用此前读取的平台通用外汇参考值。截图请求 ID 的 SHA-256 与已保存 Token 日志完全匹配，模型单价乘分组倍率亦与消费值一致。金额已由用户确认；不再登录 Provider 管理后台复查本次金额，不重新提交图像请求。
- 原截图、请求 ID 和用户声明均保留在私有目录；澄清记录 SHA-256 为 `a41d0b9a4a05faa10ae7f72f91f21fca47a458665be707baea0166d6b3cbdac4`。它只纠正此前的现金换算依据，不删除旧观察、不改原 intent/report/approval，也不冒充事前审批或银行流水验证。
- 对账 owner 新增 attestation v5 / receipt v6：仅支持该 Xiaoyi 图像 API 的成功单张 T2I，使用已保存的唯一消费日志、私有截图、逐请求用户确认和固定 1:1 账户规则。旧 v1-v4 双计量或累计零合同不变。原审批币种若为 USD、确认现金成本为 CNY，则记录 `COST_BASIS_MISMATCH`，不跨币种比较并宣称限额通过；现金与原数值上限分开保留。
- 该实现按 T2 先复现“不支持新凭单格式”的 RED，再实现 GREEN。settlement 合同为 `96 passed / 1 Windows 条件 skipped`；能力候选及 CLI 绑定合同合计 `46 passed`。覆盖同币种预算、跨币种不可通过、错误请求/账户/截图/时间/充值比例、费用少报、不可变重放、修改回执冲突和原始资料不变。能力候选消费者继续拒绝 v6 自动晋升，包括其中现金预算为 PASS 的记录；未把人工凭单当成完整 QA-02 或发布批准。
- Ozon 主图已核实：归档商品 `images` 数组为空不代表没有图片，其 `primary_image` 有对应 Ozon CDN 资源。本机首次下载被公网地址校验拒绝，未放宽门禁；随后在 COM VPS 使用同一下载 owner 成功读取并检查单页 JPEG，1773×2364、401,557 bytes，SHA-256 `4d7e96794279e9bf908511c53d280aafecfbf6fc8f63dbae249c493d894f5ffd`。历史类目、包裹、价格、VAT 和对应图片已组成私有准备包，SHA-256 `cb5a1ea27d67a6369a86a20cb1a4de805d83e38561877f61901bc2902f57ca1c`；它不是 production compiler envelope 或写入批准。
- Ozon 隔离存在明确反证：前次 `ALL` 的 10 行样本中 7 行 `has_fbs_stocks=true`，因此不得继续把 DOTH 当成已证实的专用测试店。保持其现有商品、库存和 publisher 不变；可继续核对 ERP-only 草稿准备路径，但在隔离条件成立前不执行 import/archive。
- 离线凭单执行已完成：`4c315052` 实现和 `f60d070d` 真源记录已推送；在 COM 的独立私有 clean `f60d070d` checkout 中运行原 billing CLI，未加载 Provider 凭据或查询管理后台。新增 v6 receipt 的 SHA-256 为 `b75643e213470a3b0fa65db0b85d948c5c4cc126cf0b403ebdc404700af5f951`，实际成本为 CNY 0.05999。原 quote/maximum 的 USD 基准继续作为 `COST_BASIS_MISMATCH` 保留，原 report/approval 字节未改。金额核对已完成，不应再向用户索取这笔金额；该回执不是能力晋升或完整 QA-02 的替代品。
- ERP-only 实跑与回滚：确认该真实源 SKU 在 ERP 中没有旧 SupplyGoods、SourceCaptureSubject 或同名任务后，仅给指定 owner/shop 临时开启 `SOURCE_CAPTURE_V2=shadow_write` 与 `SOURCE_LISTING_WORKFLOW=dual_read`。正常账户会话、配置 CAS 及恢复均通过；`POST /api/listing/browser-one-click-jobs` 返回 500，生产日志定位为 Prisma `P2010`：无法反序列化 `pg_advisory_xact_lock` 的 `void` 返回列。数据库复核同名任务为 0，未创建采购资料或草稿；两开关、原 rollout policy 已恢复，临时会话已撤销，publisher 仍为 false / revision 38，Provider/Ozon 写入为 0。
- 根因修复：`apps/server/src/routes/listing.ts` 的幂等事务改为仓库已有的 `SELECT 1 AS "locked" FROM pg_advisory_xact_lock(...)` 模式，保留原锁键、种子与事务范围。此前单元测试把 `$queryRaw` 固定返回为整数，且该接口文件未进入 PostgreSQL runner，因而漏掉驱动返回类型错误。新增接口回归让实际 SQL 经过 Prisma/PostgreSQL，其余身份/商店/任务存储使用 fixture；先观察 HTTP 500 的 RED，修复后 `65/65` 通过，并由独立连接证明锁在事务内持有、事务结束后释放。相关审核/开关回归 `57/57`，加入既有 PostgreSQL runner 后 148 migrations 回放及 `13 files / 168 tests` 全通过。独立只读对照在 Prisma 6.19.3 / PostgreSQL 16.13 复现同类错误并验证新查询；不是用 mock 成功冒充生产草稿完成。
- 当前线上仍未应用此修复：本轮未修改 VPS 运行包、部署或官网 pointer。ERP-only 草稿创建须在修复版本按既有发布门禁部署后重新验收；DOTH 的专用测试隔离问题仍独立存在，不能因修好 500 而解禁真实 import/archive。

### 剩余五项的执行入口

| 项目 | 已有入口与本轮进展 | 下一步必需的输入或授权 |
| --- | --- | --- |
| Provider 费用账户与 pilot | Xiaoyi 单张成功且已消费用户截图/1:1 充值规则完成[离线凭单对账](../docs/runbooks/ai-image-provider-sandbox-billing.md#xiaoyi-console-bill-and-account-credit-review)，原审批币种差异保留 | 不再查询这笔金额或重发该请求。完整操作验收、旧 Wanx 账户错配及能力晋升仍是独立事项 |
| Ozon 测试店与商品事实 | 归档参数/对应主图及私有准备包齐备；ERP-only 实跑发现幂等锁 500，已在源码修复并通过真实 PostgreSQL 回归；所有临时配置已恢复 | 按发布门禁部署修复后重验 ERP 审核草稿。DOTH 样本有 FBS 库存，专用测试隔离仍未成立，继续禁止 import/archive |
| 新提交与部署证据 | `c10cdc61` 已推送且完整 offline gate 通过；旧 v1 已签署发布继续验证 | 部署流程已获本轮授权，仍须补齐 QA-02/正式 QA-04，生成目标 clean commit 的区域四件套与签名，并取得对应运行包的新 canary |
| 备份、Redis、域名验收 | 两地当前运行版本完整 verifier 均为 `0 failure / 1 warning`，本地备份/临时恢复/认证刷新已完成；远端备份继续延期 | 副本/告警仍需独立的可用性、运维、成本/停机决定；新部署需重新收集该提交的域名和完整 VPS 回执 |
| 官网公开指针 | 两地仍服务旧批准版本；本轮没有切换 pointer | 切换流程已获本轮授权，待目标区域真实暗态 gate 通过后，按现有 signed approval、CAS、下载 probe 和同路径升级流程执行 |

工作流授权以本轮用户请求为准；表格记录的是仍需补齐的输入与证据，不能替代费用限额、商品事实或逐次审批绑定。

## 现状证据

以下各节保留 2026-09-06 的历史审计上下文。当前 Git、验证结果和授权范围以上方接续记录为准。

- 项目根目录：`D:/AI Agent/Work/QE/SS ERP`。
- 当前分支：`feat/ai-media-prompt-registry`，跟踪 `origin/feat/ai-media-prompt-registry`。
- Git evidence state：实现检查点 `0ede34eb` 已提交，包含 QA-04 Git provenance 和 Ozon sandbox v2 receipt/production compiler envelope 加固；认证、扩展发布、SSRF、AI quota、durable operation claim、CI pin、Web 配置合同、受管扩展诊断、部署备份 retention、typed production smoke token、Ozon Key 只写修复和 Ozon 只读 preflight 均有独立检查点。两地运行包仍绑定 `a986d0f6`，因为后续改动只涉及仓库工具、合同和文档，未触发新的运行部署。
- 未跟踪文件：无。
- 嵌套 Git 仓库：只发现项目根 `.git`；`git submodule` 在当前 Windows Git 环境因缺少 Unix helper 未完成验证。
- 现有 agent 指令文件：审计前未找到；本次按用户授权新增根 `AGENTS.md`。
- 现有内部文档：审计前没有统一真源；`docs/plans/` 含历史实施计划但状态跨度较大。
- 现有公开文档：`README.md`、`docs/PROJECT-OVERVIEW.md`、`docs/README.md`、`docs/RUNBOOK.md`、`docs/deployment.md`。
- package/framework 文件：根 `package.json`、`pnpm-lock.yaml`、`apps/web/package.json`、`apps/server/package.json`、`packages/shared/package.json`。
- 启动/测试/构建脚本：`pnpm dev`、`pnpm typecheck`、`pnpm lint`、`pnpm preflight`、server Vitest、Web build、扩展 verifier。
- schema/migration：`apps/server/prisma/schema.prisma`，148 个迁移；本地 `prisma migrate status` 为 up to date。
- 部署脚本：`scripts/deploy*.sh`、`docker-compose*.yml`、`deploy/systemd*` 与扩展签名/分发 gate。
- 配置模板：`.env.example`、`.env.staging.example`、`.env.production.example`；真实 `.env` 被 Git 忽略。
- 已知启动证据：类型检查、后端测试、Web build、扩展静态验证通过；`bootstrap-local-env.mjs` 修复当前 ignored `.env` 后，local profile 校验为 0 failure。
- 当前用户请求：按优先级继续验收并解决受管扩展、Provider、Ozon 与生产运行瓶颈；远端备份暂不配置。VPS 与 skills 已获授权，但 Provider 费用和 Ozon 测试店写入仍必须绑定精确的一次性批准。

## 产品边界

- 当前产品看起来是什么：面向 Ozon 跨境卖家的 SaaS/本地双模式 ERP，包含 Web、API、Worker、PostgreSQL/Redis、对象存储和 Chrome 扩展。
- 当前产品不是：通用多租户基础平台、微服务集群、K8s 平台或完全由浏览器端承担业务真相的扩展。
- 用户确认的方向：沿用当前功能和技术组合，按审计顺序修复治理、安全、供应链和可维护性问题。
- 旧名称、旧概念或过期语义：`docs/LAUNCH-OPTIMIZATION-PLAN.md` 与 `docs/plans/saas-remaining-tasks.md` 中部分待办已被后续代码完成，不能直接当当前 backlog。
- 用户明确否定或延期的方向：不换栈、不执行破坏性数据库操作，远端备份暂不配置；未满足费用/测试店门禁时不执行真实 Provider/Ozon 写入。

## 已确认的演进边界

- 当前必须交付：关闭已证实的 P0 安全边界，恢复可信依赖/CI 门禁，建立当前真源，并做最小结构收敛。
- 已确认的下一阶段能力：在当前单体与扩展边界上继续迭代，不增加新基础设施。
- 当前不实现但不能堵死：后续真实浏览器回归、Provider/Ozon 试点和生产发布仍消费现有合同与 gate。
- 明确不会做：本轮不切换框架、数据库、认证模型、支付模型或部署拓扑。
- 只是设想，不得影响当前架构：K8s、微服务拆分、API 多实例等只有出现可观测容量或组织触发条件后再评估。
- 临时 fallback 真源迁移：从分散的 `docs/plans/` 状态描述迁到本目录；公开文档保留公开职责，不移动历史文件。

## 技术栈适配

- 当前前端：Next.js 15 App Router、React 18、TypeScript、TailwindCSS、Radix UI、TanStack Query。
- 当前后端：Fastify 5、TypeScript、Prisma、BullMQ、Vitest。
- 当前数据库：PostgreSQL 16，Redis 7 负责会话、队列与分布式控制。
- 当前第三方服务：Ozon、Cloudflare Turnstile/R2、S3-compatible OSS、阿里云/腾讯云短信、Sentry、AI 图片 Provider。
- 当前部署方式：单 VPS，Nginx + systemd 或 Compose，API/Web/Worker 分进程。
- 结论：沿用但修正。
- 证据：现有组合已通过类型、构建、5164 个后端测试和扩展合同验证；风险集中在外部运行证据，而不是框架不适配。
- 用户需要决定：本轮无需新的产品决定；真实部署、费用、凭据与迁移仍需单独授权。

## 调用链和 owner

| 功能/概念 | 当前入口 | 真实 owner | 下游展示/adapter | 风险 |
| --- | --- | --- | --- | --- |
| Web 会话 | `/api/auth/*` | `apps/server/src/lib/auth.ts` 与 Redis session | 登录/注册页面、扩展 Bearer adapter | cloud/production 已拒绝 Redis disabled；生产只读会话已验证，Redis 集群拓扑仍未验证 |
| 图片远程读取 | `/api/images/*`、水印服务 | `apps/server/src/services/source-public-image-download.ts` | image-upload route、watermark、Web 图片处理页 | URL/重定向/字节/像素边界已统一；线上外部地址回归未验证 |
| 上传配额 | image-upload route | `apps/server/src/lib/upload-limiter.ts` | Web 图片管理 | 云端 Redis Lua 原子计数已完成；Redis 集群拓扑仍未验证 |
| 数据模型 | API/Worker | `apps/server/prisma/schema.prisma` + migrations | Prisma repositories/services | schema 大且格式检查未进入日常 gate |
| 扩展发布 | `pnpm package:extension` | release/package/verify 脚本和签名证据 | 官网下载 API、MV3 扩展 | preflight 单一串行入口过重 |
| 项目真相 | 根 README 与公开 docs | `dev-docs/README.md` 索引的内部 owner | Agent、开发者、阶段验收 | 审计前缺少唯一当前状态 |

## 文档盘点

| 文件 | 当前角色 | 状态 | 建议动作 |
| --- | --- | --- | --- |
| `docs/PROJECT-OVERVIEW.md` | public | active | keep，维护公开产品/架构入口 |
| `docs/deployment.md` | public | active | keep，线上记录必须绑定提交与日期 |
| `docs/RUNBOOK.md` | public | active | keep，继续承载运维步骤 |
| `docs/plans/*.md` | internal history | stale | keep，不作为当前阶段状态 owner |
| `docs/archive/` | history | active | keep，不回流当前决策 |
| `dev-docs/*.md` | internal truth | active | 按 owner 职责更新 |

## AI 债务和假成功

- 重复页面/组件/API：多个超大 route/page/extension 文件聚合了多个职责，存在高变更冲突风险。
- mock/假数据：大量合同测试有价值，但 Web 的源码字符串测试不能替代真实浏览器行为。
- 自定义 wrapper：扩展发布与部署 gate 很完整，但 `preflight` 串行包含 132 个步骤，定位和耗时成本过高。
- 多套状态/请求/权限模式：账号 token 与设备 session 已有明确迁移边界；旧兼容路径必须继续由 rollout gate 限制。
- 旧备份/死文件：ignored 的 `*.orig`、大量 build 历史产物不进入 Git，但会增加本机扫描噪声。
- 已修复的假成功：CI audit/Semgrep 已阻断；审计日志生产失败会抛 `AUDIT_LOG_WRITE_FAILED`；上传配额已使用 Redis Lua 原子计数；PostgreSQL 关键集成有隔离 runner。
- 用户级工具边界：`C:\Users\550W\.codex\skills` 的 45 个顶层技能入口指向未授权的 `C:\Users\550W\.cc-switch\skills`，其内容未审计；允许目录内的 gstack 工具包含自动更新、遥测、会话导入和 Hook 设置写入能力，但没有证据表明这些 Hook 在当前用户配置中已启用。下一步必须先取得 `.cc-switch` 或实际用户配置的独立授权，不能把技能目录中的模板当作运行态证据。
- 日本/COM VPS 当前运行 `a986d0f6817d4c1783f510ac56410687817ccdfa`：API/Web/Worker、DB/Redis、Nginx/UFW、148 migrations、双 `/ready` 和暗态 verifier 均健康；`ss_erp_20260906_073135.sql.gz`（47,647,846 bytes）已完成 144 表临时恢复演练，attestation SHA-256 为 `6354965d20d5a6fd7caadb35557bc8b3a67275b387274f4cced5198a01172568`。远端备份按用户决定暂不配置，verifier 唯一 warning 为本地备份。
- 国内/CN VPS 当前运行同一 `a986d0f6817d4c1783f510ac56410687817ccdfa`：外部 RDS、Redis、Nginx/UFW、148 migrations、四个 `.cn` HTTPS host、双 `/ready` 和直连 verifier 均健康；`ss_erp_20260906_171253.sql.gz`（15,600,762 bytes）完成 141 表临时恢复演练，attestation SHA-256 为 `dadc95dfe5b952aeea188b6283b950597f3f41c68e1947bb42c8433e3eb82d75`。远端备份按用户决定暂不配置，verifier 唯一 warning 为本地备份。
- 公开扩展仍为已批准的 `1.0.316`，固定 ID `nkkemglcckgmhmcfnjjmcfbdhciafahl` 保持不变；VPS 暗部署候选为 `1.0.317`，cloud/local SHA-256 分别为 `e9ab7c3d258e4f8edd8795aabcc3d0ed0115e5e9565299c16e44dfb1ed7ca4be`、`c692326cc3231d0692fbc746d307c1a4f13abc5105d5687a6ed4378b0ac7f358`。候选 release evidence SHA-256 为 `cb25890f2bf0477fd632bd6899c2d77f172b09454b45df1b7938e1578cc29685`，签名 SHA-256 为 `208c9c3d90d106d6ae83300972d3e6e96d02d284c3addb092698f80ca9820fb8`；官网仍明确保持 `1.0.316` 指针。专用 CDP 已关闭，普通 Chrome 未操作。
- 最新外部只读预检：Xiaoyi 双域 7-GET 预检成功且无费用；DashScope 当前 credential 仍能读取 `wanx2.1-imageedit`，阿里官方价格页于 2026-09-06 仍列出 CNY 0.14/成功图片，私有价格观察 SHA-256 为 `ede27c30...524a62`。既有 Wanx IMAGE_TO_IMAGE/FULL_EDIT/INPAINT 技术结果成功但计费账户未关联，不能提升 Registry 或替代新 pilot 批准。
- Ozon Seller Info 根因复核：此前 `b4383731...572fd` 的 HTTP 400、`code=3 Invalid Api-Key` 来自错误绑定的占位店铺，并非操作员指定测试店。生产库另有三条未禁用记录共用同一 Client ID；操作员指定测试店 `DOTH / Client ID 4980990` 已在 `a986d0f6` 通过零重试 Seller Info，只读回执 SHA-256 为 `c56b173ee0843b3ab5438f868296d540a766c5f1905dbcfb6fc4661982379094`，没有商品写入。店铺 API Key 详情现只返回配置状态，替换凭据不再解密旧值；Ozon 写入仍需独立的精确 pilot 批准。
- 生产 smoke 使用目标部署前的 `3d3333ef` 600 秒 typed USER/ADMIN token helper 对当前运行中的 `a986d0f6` 复核；此前通过的域名隔离、Turnstile 拒绝、17 个用户只读端点、管理员只读状态和 cloud/OSS runtime 保持有效，本轮未上传图片，AI Media/BYOK/Ozon Publisher 仍全暗态。
- 受管扩展活动 COM 目录及其 228 个子项已完成 ACL 收紧：禁用继承，仅允许当前用户、SYSTEM、Administrators；无 reparse 点或额外主体，固定路径身份诊断保持 `FOUND`。
- 当前可以继续开发：本地代码、server/Web 构建、测试和 owner 内重构均有可重复门禁。
- 仍需单独验收：可对账的真实 Provider pilot、专用 Ozon 测试店写入/回滚、Redis 集群拓扑/外部告警和 CN 远端备份；生产域名、公开扩展、受管 active worker 与基础只读运行态已不再属于未验证项。
- Redis 新鲜只读盘点：COM/CN 均为 `redis_mode=standalone`、`role=master`、`connected_slaves=0`、`cluster_enabled=0`；未发现 Prometheus/Alertmanager、Redis 专用 systemd timer 或告警 cron。当前应用只读 `/ready` 能证明 Redis 可用，不能证明高可用、容量告警或故障切换。建设告警/集群需要外部基础设施和独立运维授权，本轮未修改生产拓扑。
- Redis 诊断合同：`pnpm diagnose:redis` / `scripts/diagnose-redis-runtime.sh` 只读执行 `PING`、`INFO`、`CONFIG GET`、systemd unit 枚举和用户 cron 枚举，分别输出运行可用性、拓扑、副本、持久化、客户端压力和告警发现状态，不打印认证信息。COM/CN 实际结果均为 `REDIS_RUNTIME_STATUS=PASS`、`REDIS_TOPOLOGY=standalone`、`REDIS_REPLICATION_STATUS=no_replicas`、`REDIS_ALERTING_STATUS=not_detected`、`REDIS_PERSISTENCE_STATUS=rdb_only`；该工具不改变 Redis 配置，也不把健康状态升级为高可用验收。
- 开发体验盘点：`pnpm --filter web lint` 为 0 error/0 warning；Next `15.5.25` build 仍提示 flat ESLint config 未被其 legacy 检测器识别。引入官方 plugin 会产生 47 个既有 `<img>` 警告且不能消除 build 提示，已撤销无收益依赖变更，保留为低优先级工具链项。
- Node ESM 提示已通过 `apps/web/package.json` 的显式 `"type": "module"` 关闭；依赖 Web TypeScript 源文件的 28 个合同测试不再输出 `MODULE_TYPELESS_PACKAGE_JSON`，Web typecheck/lint/build 均通过。该声明由 `web-next-dist-dir.test.mjs` 固定，Next plugin 检测提示仍独立保留。
- Ozon 写入前门禁：`0ede34eb` 起，execute 只接受 `ozon-listing-production-compile-adapter/v1` envelope，不再接受手写 `{items:[...]}`；它要求 24 小时内的 v2 preflight receipt 及精确 SHA-256，并绑定同一凭据 revision、ERP 店铺别名、Ozon Seller 名和 offer ID。写入前再次读取 Seller Info；网络禁止 redirect、响应限 2 MiB；归档只有在只读复查 `is_archived=true` 后才记 `ARCHIVE_VERIFIED`。合同测试 `10/10` 通过，真实 Ozon 写入仍未执行。
- Ozon v2 只读 preflight：COM VPS 从加密数据库唯一选择 `DOTH / Client ID 4980990`，对 reserved offer `ss-erp-sbx-v2-20260906-0ede34eb-01` 执行新门禁；结果为 `READY_FOR_SEPARATE_WRITE_APPROVAL`、Seller `DOIT`、`offerExists=false`、`networkWritesSent=false`，回执 SHA-256 `3dbeef2949c8a943ae11a1cb92d6ca710d3ab9f0a46279fad900f229d7b1d6d1`，VPS 与本机受保护目录逐字节一致。历史 v1 回执 `5bb18366...ee646` 只保留审计，不能用于 execute。
- Ozon production compiler 输入盘点：同一 `DOTH / 4980990` 店铺当前 `sourceListingWorkflow` 为 0，`PUBLISH_INTENT_RECORDED` 可导出草稿为 0；未读取商品正文、图片或客户数据。写入前必须先通过正常 ERP 流程创建纯测试草稿并完成来源、类目、属性、图片、包裹与价格权威审核，不能手写 envelope 绕过 owner。ERP 别名 `DOTH` 与 Seller `DOIT` 的业务对应仍需操作员确认。
- Ozon 测试素材准备：操作员已确认 `DOTH` 对应 Seller `DOIT`，并授权只写 ERP 的测试工作流/图片。固定 1200x1200 单页 PNG 明示 `TEST ONLY / NO REAL PRODUCT / NOT FOR SALE`，源 SHA-256 `f53b25e7...d7b74`；通过 600 秒临时 USER session 上传到 COM 默认 OSS，回执 SHA-256 `ec11f958...3701b`。公网重新下载 63,671 bytes 后 SHA 一致；临时 session 已撤销并复核无 600 秒内短时 session，Provider/Ozon 请求均为 0。
- Ozon 测试工作流配置边界：`DOTH` owner 当前有 165 个 supply goods、1 个 Capture subject/1 个 snapshot，但 `SOURCE_CAPTURE_V2`、`SOURCE_LISTING_WORKFLOW`、Ozon mapping read/write 与 publisher 均为 `master_off`。正常 API 创建新 Capture/Workflow 会失败关闭；未绕过 gate 直写 Prisma。继续需要 exact owner/shop 的临时 `SOURCE_CAPTURE_V2=shadow_write` 与 `SOURCE_LISTING_WORKFLOW=dual_read` pilot，publisher 必须保持关闭，并需由操作员提供测试商品真实的包裹重量/长宽高、定价/币种/VAT 和类目方向。
- QA-04 归属：`fbb5f11d` 起，离线 gate 在首尾分别验证相同 Git root、精确 40 位 HEAD 和完整 clean porcelain，拒绝 staged/untracked/运行中漂移。`0ede34ebd479157b96de946e0bd8347dbc2b8a7e` 上的九项 rehearsal 全部通过：server `5165 passed / 223 skipped`，source/cloud/local extension verifier 均 `0 failure / 0 warning`，scope-revocation 与 AI Media PostgreSQL 148 migrations 回放通过。准确付费 Provider QA-02 仍未完成，因此没有生成或宣称正式 `QA04_FINAL_ACCEPTANCE`。

## 危险接管动作

- 是否要创建或改写 agent 宪法：是，用户已明确要求按审计流程修复并继续。
- 是否要确认内部真源目录：使用此前审计推荐的 `dev-docs/`，用户已要求按该流程执行。
- 是否要移动/归档/删除旧文档：否。
- 是否要重命名产品或公开文案：否。
- 是否要删除旧 API/字段/路由：否。
- 是否要改变 Git/发布流程：只做当前分支阶段提交与 push；本轮按用户授权执行 VPS 备份/恢复、attestation 刷新、pilot 撤销和暗态恢复，不创建 tag、GitHub Release 或绕过签名门禁部署。

## 下一步

- 推荐下一路线：本地开发可继续；需要发布时进入 `验收`/`发布准备`，补齐外部运行证据，不把本地绿灯当作发布授权。
- 为什么不是直接开发：多 owner 修复需要一个持久顺序，防止安全、CI 和结构更改互相污染。
- 第一个安全任务：建立治理和运行基线，确保后续提交有唯一范围和验收 owner。
- 需要用户确认：Provider 每个真实操作仍需独立精确费用上限和一次性批准；Ozon 写入仍需有效凭据且可证明为专用测试店。远端备份按用户决定暂不配置，受管扩展 live worker 已完成独立验收。
- 停止条件：出现产品行为改变、数据迁移、真实费用、凭据、部署、公开发布或无法隔离用户现有改动。
- 未验证项：远端仓库 visibility、Redis 集群/外部告警、可对账 Provider pilot、Ozon 纯测试工作流/compiler envelope/写入/归档、REL-04 canary 对区域候选四件套的精确摘要绑定，以及 CN 远端备份。
