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

### 完整隔离链路与历史编辑证据复核

- 隔离验收补齐：测试实现检查点为 `a362545d`，新增 `apps/server/src/__tests__/browser-one-click-isolation.postgres.integration.test.ts` 并接入原 PostgreSQL runner。对 `dual_read` 和 `v2_only` 分别通过真实 HTTP handler、Prisma、capture service/repository、默认 workflow adapter、配置 evaluator 与 context owner，完成并发创建同一任务、提交合成 Ozon 来源行、SupplyGoods/subject/snapshot/workflow/draft/event 落库、停在 `review_required`、POST/PATCH 幂等重放和跨 owner 拒绝。身份认证与队列/Ozon 出站边界使用 fixture；不替换被验证的采集、草稿或持久化实现，不把该测试称作真实登录、浏览器或线上草稿验收。
- 本轮为 T1 既有行为覆盖，不修改生产业务规则。既有路由基线为 `64 passed / 1 PostgreSQL 条件 skipped`；补齐后在本机 loopback 的随机 `logistics_test_*` schema 回放 148 migrations，`14 files / 170 tests` 全通过。两条新链路的 publish intent、Ozon attempt 与队列/Provider/Ozon 出站调用均为 0。测试 schema 删除后复查不存在；用不可连接的合成数据库地址另验 `public` schema 在 datasource 导入前被拒绝。server typecheck、定向 ESLint、runner Node 语法与 `git diff --check` 通过。
- Wanx 三次历史操作已逐一核验原审批、intent/fingerprint、成功报告、异步证据、源图、结果图、mask 和人工质量确认的摘要绑定；三张 PNG 均能完整解码为 `1024×1024`，每次原始 create 为 1，poll 分别为 8/9/6。本次没有重发或查询 Provider。报告 SHA-256：I2I `a0671f5c6e4c37d81fc6fb8520e094fc64e668b0ca9f217f0d04975273caed42`；FULL_EDIT `9e1ee9e367e3367e51efedcf5322a568ff1c235299e1b5f0c9fa258a55a912cd`；INPAINT `51060c57b2c39bf4d6d02f40336b1e1c588011d490799d394e41815408778f6d`。原始文件、图片与账户标识继续留在私有/ignored 证据根，不进入 Git。
- 技术与费用分开裁决：历史三项编辑技术/质量验收资料完整，不能继续笼统写成“三项编辑未验收”。本次目视与 INPAINT 像素复算一致：编辑区 25,600 像素、平均通道差 3.418；保留区 1,022,976 像素、平均差 0.015，仅 0.07% 像素有通道差超过 5。保留已批准的轻微蓝灰变化和矩形硬边界限制，不扩大质量结论。三项账单仍为 `UNRESOLVED_ACCOUNT_IDENTITY_MISMATCH` / `actualCost:null`，人工质量确认仍为 `billingDecision:NOT_ATTESTED`；Xiaoyi 的 CNY 0.05999 及 1:1 账户规则不能替它们结算。
- 发布前置仍未关闭：sandbox runbook 关闭的是 `QA-02 technical sandbox acceptance`；billing runbook 仍把未匹配账单列为 QA-02 未关闭部分，`docs/deployment.md` 要求完整 QA-02/QA-04 后才生成正式扩展候选。Provider capability candidate 与区域扩展候选不是同一产物；现有 canary 只核验正式 QA-04 中的 `qa02Prerequisite:COMPLETE`，并不重读 Provider 账单，不能利用这个检查缺口填造 COMPLETE。未找到现成的全暗态维护版豁免；若要先部署修复、继续保持 AI/Ozon 写入关闭，须先明确批准该发布范围及相应验收合同，不直接修改原发布规则。
- 隔离边界保持：本地合成两 owner/两 shop 证明 ERP 数据归属与零发布，不证明真实 Ozon 店铺隔离。DOTH 已有 FBS 库存的反证仍有效，不为它新增“专用测试店”标签，不重试 import/archive。本轮未访问 VPS、查询计费后台、修改线上配置、部署或切换官网；线上健康状态沿用前次快照，未冒充新鲜检查。

### AI 生图/改图功能收口（2026-09-09 本地功能与隔离验收）

- 用户将当前目标聚焦为“把 AI 改图/生图相关功能开发测试完”，不是批准维护版发布。本阶段验证正常四步工作台、四种图片操作、候选审核/接收与精确草稿绑定；不部署、不切官网、不调用真实 Provider/Ozon，不修改生产开关、价格或 capability 晋升。
- 新鲜基线：AI/Web/扩展相关 Node 合同 `97 files / 566 passed`；服务端 AI 定向 172 个文件命令退出 0（其中数据库专用测试仍按环境门禁另跑）。AI PostgreSQL 专用 runner 回放 148 migrations，`21 files / 99 passed`；带历史数据升级及故意非法升级拒绝通过，全部本次测试 schema 清理复查通过。它们是隔离/fixture 验证，不是正式 QA-04 或真实 Provider 放行。
- 已定位并按 T2 修复两项 BYOK 问题：三类改图正/负提示词错误拒绝 LF/CR/TAB；OpenAI ImagesResponse 合法附加 metadata 被误当成未知响应。前者先有 6 个多行正例 RED 后转 GREEN，身份字段与其他控制字符仍严格拒绝；后者先有 4 个解析/真实 client 正例 RED 后转 GREEN，只接受并丢弃 `usage/background/output_format/quality/size`，不以这些字段计算账单或绕过图片校验。联合 66 项定向测试通过。官方文档网页在本机返回 403，响应字段已改由 OpenAI 官方 Node SDK `src/resources/images.ts` 的当前类型交叉核验。
- 浏览器发现并关闭了真实断点：三类改图此前能出图、选图并进入第四步，却没有可用的批准/接收操作；runtime 只把 T2I 结果绑定到普通审核会话。新增显式 `EDIT_REVIEW`，由真实 controller/engine/vault 验证已选 attempt、slot revision 与空闲状态，复核 live tab/document、owner/device、source/draft/SKU/slot 后交由 session owner 保存。保持 `CANDIDATE_READY`，不自动批准、上传或重发；旧 session/v1 序列化形状不变，交接重放证据另存会话键。成功后只释放未选图，保留已交接图；普通 preview/review/ingest 按真实 operation 复核，T2I 生成门禁未放宽。
- 薄 client/page 只传交接 witness 并重新读取权威状态，复用原“批准候选图 → 接收并绑定 ERP”。两个 UI 行为测试先 RED 后 GREEN；真实浏览器进一步发现旧 `is-edit-operation` 样式仍隐藏普通审核面板，已通过页面 class 投影修复并回归，未改 CSS/版式。独立复核时追加“临时 authority 读取失败不能清掉已消费候选”的 RED→GREEN，拒绝本次读取但保留会话与图片，恢复后仍是同一候选且没有额外 Provider 请求。
- 新增 `scripts/extension-byok-edit-review-handoff.test.mjs` 并接入正式 preflight：真实 controller/session/epoch/runtime 组合覆盖三操作交接→显式批准→接收绑定、同一请求重放、manager 重启、保存失败、选图/重生成并发、旧 revision、跨 tab/owner/device/context、过期、UNKNOWN 与候选清理。Provider 与 ERP 接收为明确 fixture；不是实际调用。独立安全复核及额外内存探针无重要发现；D2 scope 和 UI shape 前置 validator 通过，Host 自动 Hook 强制执行仍为 `UNVERIFIED`。
- 主代理复跑 `node scripts/extension-ai-workbench-browser-acceptance.mjs` 退出 0。Chrome 147 中四操作均走原页面/真实 shared client、mask converter、vault、controller、launch session、epoch 与 runtime handler，完成生成→解码预览→交接→显式批准→抵达真实 ingest handler 的 fixture 拒绝边界。每操作仅 1 次 fixture Provider 请求，批准前 ingest 为 0；Enter/Space 激活、1440/390px、无横向溢出、metadata 丢弃与密钥隔离通过。INPAINT 65,536 像素逐个满足 `alpha=255-originalR`，mismatch 为 0，保留 84 个软边缘像素。本次 Chromium/profile 已清理；最终机器摘要 SHA-256 为 `4e8ce16acdae3167c2cfdc3bf70affadafb43f7bbea42d3645cd03cbbb38157a`。交接前已在页面和指南明确提示只保留选图、清理其余临时候选，补充披露后重新通过浏览器与双包验证。
- 最终开发门禁：全仓 lint/typecheck、完整 `pnpm preflight`（含全后端测试与新增交接合同）通过；source/cloud/local 扩展 verifier 分别为 `459/464/460 passed`，全部 `0 failure / 0 warning`。双模式包仅在新建临时目录生成，未签名、未作为正式候选、未覆盖受管安装或旧发布产物。浏览器仍不覆盖真实 Chrome MV3 消息传输授权、真实 ERP ingest 客户端/存储或真实 Provider；这些证据不能被写成完整付费 QA-02、正式 QA-04 或生产放量批准。本轮没有真实 Provider/ERP/Ozon 写入或新费用，没有改线上开关、部署或官网 pointer。
- Wanx 正常托管接线不混入此修复：历史 adapter 仅支持方图、800 字正向且拒绝 negativePrompt；现有套图为竖图，其固定正向约束已达 981 字。最后发包 fence、0 POST 输入失败分类、恢复及内部 USD/外部 CNY 也不能靠一个工厂分支解决。保留已验证 sandbox 的范围，后续需独立的完整正常传输合同，不截断约束、不假装已接通。

### Wanx 接线前置与托管编辑发包收口（2026-09-09）

- 接续基线为已推送的 clean `a00c78c64f1b238bb7545b14637ed95198603657`。用户继续要求完成 AI 生图/改图，本轮只推进本地实现与隔离验证；以下改动尚未提交或推送，不是新版本部署、官网切换或真实付费请求。
- Wanx adapter 已修复最后发包检查：`requestJson` 复用现有网络层的发包前 callback，在 URL/DNS 检查之后、fetch 之前检查租约和剩余时间。非法输入、DNS 失败、发包前撤销/超时均携带明确未提交证据；fetch 开始后的连接丢失继续为未知结果，已接受后的落盘/轮询失败继续携带同一 task ID。既有方图、800 字、单源图、无独立负向字段、mask 转换及异步报文没有改变。
- 正常托管编辑也接入同一最后检查入口。新 owner 为 `apps/server/src/services/ai-image-edit-dispatch.ts`；worker/factory 只负责传递。先续租，再核验实时开关/租户授权、精确端点/模型/报价、当前凭据、任务/attempt/workflow 身份和 RESERVED 预留，最终任务快照之后不再等待续租。续租期间的取消、预留释放、授权撤回和凭据变化有独立负例；不增加生产开关、不晋升 capability、不更换 Provider 或计价币种。
- 修复两项真实数据库可复现的取消证据丢失：明确未发包却取消时，runner 原先丢弃 `providerSubmissionRejected`，导致额度误留在 `SUBMISSION_UNCERTAIN`；已接受但首次 ID 落盘失败并发取消时，原先丢弃已收到的 `providerJobId`。现在均交给现有 repository 的 `markFailed(details)` 先绑定证据再按取消规则结算：前者只释放一次，后者保留精确 ID 和 `RECONCILIATION_REQUIRED`，不重发、不假设零费用。
- 测试过程：上述发包、续租竞态和取消边界均先观察到目标 RED，再实现 GREEN；已有成功/未知结果路径为表征回归。新增 `ai-image-wanx-edit-dispatch.test.ts` 与真实 PostgreSQL 的 `ai-image-edit-dispatch.postgres.integration.test.ts`，后者已进入既有 AI PostgreSQL runner。最终回放 148 migrations，`22 files / 104 passed`；5 个新数据库用例覆盖 DNS 期间取消零 POST、首次 ID 落盘失败并发取消、FULL_EDIT/INPAINT 的 raw/final 与显式审核、丢响应后的自动及显式重试拒绝。候选逐像素核验、精确 lineage、唯一预留结算与原图不变均有断言。五个本轮隔离 schema 已自动清理，独立读回复核剩余为 0。
- 证据范围：数据库用例运行真实 worker、factory、adapter、输入 reader、runner、workflow/repository 与 PostgreSQL。仅 Provider capability 注入、DNS/fetch、配置/授权/Redis 和对象存储 I/O 为明确合成 fixture；正常 admission 的真实 registry 仍拒绝付费编辑，未写入假的晋升条目。合成预留单位为 USD，不能代替 Wanx 的 CNY 账单。这证明隔离托管链路，不是实际 Provider → ERP 或 MV3 端到端通过。
- 最终本地验证：全仓 `pnpm lint`、`pnpm typecheck`、完整 `pnpm preflight`、server build 与 `git diff --check` 通过；preflight 的扩展 source verifier 为 `459 passed / 0 failure / 0 warning`。独立只读复核发现的续租窗口已补 RED→GREEN 并复查关闭。没有重新生成正式扩展候选、签名或 `QA04_FINAL_ACCEPTANCE`。Sliver 路由/影响分类已执行；Task Decision 校验函数位于 `runtime_decision_contract.py`，收口时补跑通过，前置机器检查遗漏不能回填为已执行，Host 自动强制执行仍为 `未验证`。
- Wanx 正常接线仍有具体协议缺口。本轮重新读取[官方 API](https://help.aliyun.com/zh/model-studio/wanx-image-edit-api-reference)（HTTP 200）：提示词超过 800 字会被截断，HTTP 参数表没有独立 `negative_prompt` 或固定输出尺寸保证；Java 示例的 `size` 不代替 HTTP 承诺。[官方 Base URL 说明](https://help.aliyun.com/zh/model-studio/base-url)区分旧跨业务空间域名与 Workspace 专属域名，协议兼容不代表端点/审批/账单身份相同。源码复算：编辑安全前缀单独 949 字；默认 FULL_EDIT/INPAINT 正向固定开销分别 1419/1302 字，尚未加用户文本；不止套图超限。
- 下一步先在提示词 owner 设计可逐条审查的 Wanx 专用版本化编译合同，完整保留事实、身份、文字、审核与 mask 约束并在物化前验证 800 字上限；再闭合单图输出尺寸、`base64/async` 运行身份和只读 task 恢复到正常 raw/composite/review 链路。不能靠截断、清空负向、把方图当竖图、把翻译恢复直接用于 inpaint 或新增 factory 分支宣布完成。真实调用仍需匹配 Wanx 账单归属和逐次明确费用上限；旧已消费请求不重发。本轮真实 Provider/Ozon 请求、新费用、生产写入、部署和官网切换均为 0。

### Wanx 显式提示词编译合同（2026-09-09 后续本地实现）

- 用户继续上述提示词任务。本节接续而不覆盖上一节的未提交发包/取消修复；当前 HEAD 仍为 `a00c78c6`，本节及上一节代码均未提交/推送。本阶段不接真实 Provider、不开通能力、不改模型配置/价格/schema、生产开关、UI、部署或官网。
- 新增 `apps/server/src/services/ai-image-edit-prompt-contract.ts`，统一维护六条编辑安全义务的原文/中文表示、既有默认模板及显式 `ai-image-wanx21-edit-prompt/v1` 渲染合同。旧英文 policy、FULL_EDIT/INPAINT 正文及负向正文的 SHA-256 均以本次改动前的源码值锁定；模板 key、revision checksum、bootstrap 版本、发布/回滚记录不变。主代理逐条核对身份/数量/结构/固有印字及翻译例外、无新声明、仅审核候选和 mask 保留规则；没有按任意用户文本进行自动翻译或摘要。
- `renderAiPromptRevision` 和 registry 的预览/单件/批量解析接受显式 `renderingProfile`；省略时保持旧输出与快照形状。只有精确已知默认正负模板对才使用短版，任一正文与该默认对不同，两份正文均按原文插值保留。正负要求合并成实际要发送的完整 prompt，负向字段变为空串；整体超 800 Unicode codepoints 直接拒绝，不截断、不重新发布模板。默认固定开销分别为 FULL_EDIT 402 字、INPAINT 399 字，余量由正负用户输入共同消耗；这沿用现有 Wanx adapter 的本地字符计数合同，不证明 Provider 对所有 Unicode 输入的实际行为。
- 新快照单独携带 `renderingContract`，绑定 profile/model、六条义务 ID、源/编译后的安全规则与两份模板摘要、默认/自定义策略、计数与 inline 负向编码规则及 `contractHash`。它不复用结构化输出的 `consumer` 字段，也不把旧 template checksum 当编译身份。既有 workflow fingerprint 已覆盖该快照与最终 resolved 文本；新增回归证明删除/修改这些数据会改变请求身份。FULL_EDIT/INPAINT 默认合同摘要分别为 `133061e3924b65e02cd600a3daf70461b39f49ebcace753a9d7e0270c51a7d70`、`8f49999b311776310b70b16573c73087e1732e26bedd0d08c7e9681be2599609`。
- 同时修复插值 owner 的原文损坏：旧 `String.replace` 会解释用户数据中的 `$&`、`$$`、前后文替换符，并在多变量模板中二次展开数据内的占位符。现在仅对可信模板做一次 callback 替换，数据保持字面值；这是明确的行为修复，不声称异常输入的旧输出字节保持不变。也补充并修复了改动中发现的缺失 revision 错误类型回归。
- T2 先观察 20 个目标 RED，再实现 GREEN；额外缺失 revision 的 2 个负例也先 RED。最终模板/registry/consumer/Prisma-store 合同及新 `ai-image-wanx-edit-prompt.test.ts` 合计 `71 passed`。覆盖 800/801 边界、正负共用限额、多行/美元符/占位符字面值、无效 Unicode/控制字符、跨操作/未知 profile、默认字节不变、管理员自定义原文、单改负向不触发默认替换、批量快照与指纹。真实 Wanx adapter 通过 fixture HTTP 接收与冻结结果逐字相同的 prompt，只有一次 fixture POST；未调用真实 Provider。
- 新鲜验证：全仓 typecheck、lint、完整 `pnpm preflight`、server build、`git diff --check` 通过；扩展 source verifier 仍为 `459 / 0 failure / 0 warning`。本阶段没有重跑数据库专用 runner；上一节的 `104 passed` 只作对应检查点的历史回归证据，不冒充新 profile 的正式数据库/外部验收。D2/T2 Task Decision 在本阶段首次写入前已实际校验通过，Host 自动强制执行仍 `未验证`。
- 独立语义复核因子 Agent 限流未完成，不将部分回复或主代理自查称为独立审查通过。短版仍须在启用前补独立复核及对应 Provider 技术/质量与账单验收。本节完成的是可显式调用、受测的编译合同，尚未由正常 HTTP readiness/Provider factory 自动选择，也未解决实际输出尺寸和只读异步 task 恢复。后续依次关闭这些接线；不复用旧 Wanx 已消费请求或旧单张 T2I 证明新操作。本轮新增真实费用、Provider/Ozon 写入、生产部署及官网切换均为 0。

### Wanx 正常托管入口接线（2026-09-09 本地验收）

- 用户明确继续“接正常托管入口”。本节完成 FULL_EDIT/INPAINT 的本地 HTTP 准入、冻结合同、前景异步执行与审核候选链；不等于真实付费放行、自动异步恢复或发布。HEAD 仍为 `a00c78c6`，保留前两节未提交修改，本节也未提交/推送。
- 沿用已有配置的逻辑 Provider `dashscope-wanx`，只为精确 `wanx2.1-imageedit` 增加 `adapter-characterized` 条目：单源图、FULL_EDIT/INPAINT、`base64/async`，不继承文生图 wildcard、不启用 I2I/套图。低层 adapter 名称保持 `dashscope-wanx21-image-edit`；旧 sandbox 记录不会自动重标或晋升为正常入口证据。真实 registry 仍不能通过付费门禁。
- 新 owner `apps/server/src/services/ai-image-edit-provider-contract.ts` 统一 transport、有效 API Base、方图范围及冻结提示词校验。readiness 与工厂共用它；必须匹配精确 endpoint/model/operation/transport/resultMode 证据。拒绝会被 adapter 静默补 `/api/v1` 的裸 origin，保留空配置的既有官方默认、尾斜线和主机大小写规范化；不改全局 T2I URL 兼容规则或 SystemConfig enum。
- HTTP 创建自动选择 Wanx 短提示词 profile，超长/不合法文本以输入错误拒绝，非 1024×1024 画布以 422 拒绝，均不创建任务或预留。成功仍沿用原接口的 202；没有自动裁切、补白或改变其他 Provider 的尺寸。工作流 service、repository 入库和 runner 执行前检查模板 checksum、非空 release ID 与 snapshot 绑定、原用户文本重渲染结果及完整 renderingContract；空串/null 两端相等也不能作为绑定通过。不重新读取当前 active 模板来改写已冻结请求。重试仍保留原快照，执行前继续校验。
- 修复币种可见性：job repository 的闭合 reservation 投影加入已有 `currency` 字段，托管编辑发包要求 USD；CNY 或缺失币种会拒绝。没有新增数据库字段或汇率换算，没有把 CNY 0.14 当作 USD 14 cents；Provider 实际账单仍是独立证据。
- 独立身份及语义审查已完成并在修正后复查通过，关闭上一节的限流复核缺口。短版改为“固有标签位置”和明确的“白色选区外的一切”；旧英文 policy、默认模板和 revision checksum 保持不变。未发布 v1 候选的固定开销更新为 FULL_EDIT 402 / INPAINT 404 字；policy SHA-256 为 `314ff5613418155ebe6154c60fca3484bd61739a1805c6700da36bdb92474a26`，默认 rendering contract SHA-256 分别为 `24eafb39119cf898fd722e37f4517bd678700533ecc08c771e78e21dc7d482a6`、`674b96c7bfbbb8276003b4b6611fd6ea5f97ee1053013315f23320040d9a5c18`。前节摘要保留为当时本地检查点，不作为当前编译身份或历史付费批准。
- T2 先观察正常入口、证据模式、冻结文本/快照、币种投影及空 release ID 等目标 RED，再实现 GREEN。最终定向 6 文件 `199 passed`，完整后端随最终 preflight 通过（环境专用用例仍按独立门禁运行）。PostgreSQL runner 回放 148 migrations，`22 files / 108 passed`：新增 Wanx FULL_EDIT/INPAINT 走真实 registry 渲染、service、Prisma、工厂、adapter、runner、raw/final、像素合成与显式审核；已有 OpenAI 数据库用例也改为真实 service 准入。每次先落 task ID 再 poll，下载不转发 Authorization，成功只产生一个测试结算。错误输出尺寸保留 ID 与 `RECONCILIATION_REQUIRED`，无候选、不重发。三个本轮隔离 schema 已清理，读回复核剩余为 0。
- 验收边界：HTTP 门禁/参数传递由定向接口测试验证；数据库链路使用真实业务 owner 和 PostgreSQL，但 Provider capability、HTTP/DNS、授权/配置/Redis 和对象存储 I/O 为明确 fixture，Prompt registry 使用其真实内存 store。合成 USD 费用不是实际账单，状态日志中的 sandbox 回执也是测试产物。没有执行真实 Provider → ERP、生产浏览器或 Ozon 验收。
- 完整 preflight 曾发现两个遗漏的验证消费者：离线能力合同未登记新精确模型、预算测试的闭合投影缺少 currency。现已按新边界更新，并增加拒绝 TEXT_TO_IMAGE 继承、额外操作、错误传输/引用数、未审核晋升的负例，不放宽任意 Provider 白名单。最终完整 `pnpm preflight`、lint、typecheck、server build、`git diff --check` 通过；扩展 source verifier 为 `459 / 0 failure / 0 warning`。D2/T2 前置决策和后续范围调整均实际校验；Host 自动强制执行仍未验证。
- 下一步：增加只读 task lookup 与中断后的 FULL_EDIT/INPAINT 恢复，复用原 raw/composite/review 路径，禁止重发；同时补齐能力矩阵要求的逐任务非密凭据修订绑定。真实启用前仍须匹配 Wanx 账单归属、明确费用上限和当前 prompt profile 的技术/质量证据，随后才进行实际 Provider → ERP 与正式 QA-04。本轮实际 Provider/Ozon 写入、新增真实费用、生产配置、部署、官网切换均为 0。

### Wanx 凭据绑定与只读恢复（2026-09-09 本地接续）

- 本节接续用户批准的“补只读异步恢复和逐任务凭据修订绑定”。唯一结果是正常托管 FULL_EDIT/INPAINT 在接受后中断时可只读恢复，继续显式审核；不包括新付费请求、能力晋升、Ozon、生产访问、部署、官网 pointer 或 Git 提交/推送。HEAD 保持 `a00c78c64f1b238bb7545b14637ed95198603657`，此前 dirty 修改均保留。
- D2/T2 前置 Task Decision 已在 owner 写入前实际校验。owner 分工：SystemConfig/运行合同负责凭据身份，Wanx adapter 负责只读查询，`ai-image-edit-artifacts.ts` 负责冻结输入与 raw/final 合成，reconciliation service/repository 负责认领和原子结算。两个独立 lane 分别审查协议/身份和事务/产物；公共产物与 raw 持久化提取按 T1 建立原门禁基线，不重写既有提示词或 schema。Host 自动 hook 强制执行仍为 `UNVERIFIED`。
- Wanx 精确模型使用 `ai-image-provider-runtime/v2`，绑定非密的 SystemConfig `recordId + revision + updatedAt`，同一次数据库语句读取端点、模型、单价、凭据及其元数据。`setConfig('ai_image_api_key')` 也递增 revision，防止同毫秒写入遗漏；其他键的 writer 不变。不保存或哈希密钥。创建、workflow 归一化、重试、worker 最后发包检查和恢复 GET 均消费同一冻结合同。其他 Provider v1 保持原合同；旧 Wanx v1、缺失修订或轮换不自动采用当前账户，不回填历史审批。
- 缺失/损坏凭据修订、无法解密或空/空白 key 均失败关闭。默认 HTTP 配置读取路径的 capabilities、FULL_EDIT/INPAINT 创建和 retry 返回安全的 `503 PROVIDER_NOT_READY`，不创建、不重试、不入队，不回显密钥、密文或内部配置 ID；已观察对应 RED 后修复为 GREEN。
- 官方公开文档于本日重新 GET 核对：[Wanx 编辑 API](https://help.aliyun.com/zh/model-studio/wanx-image-edit-api-reference)、[编辑指南](https://help.aliyun.com/zh/model-studio/wanx-image-edit)。查询为 `GET /api/v1/tasks/{task_id}`，任务与临时结果保留 24 小时，`UNKNOWN` 可表示过期或状态未知。adapter 新增单次 `poll(taskId)`，与前景循环共用解析、单图 metrics、URL 与下载安全边界；所有状态先匹配原 ID。每次恢复最多一个任务 GET 和一个图片 GET，无 POST、无重新接受回调，下载不转发 Authorization。`UNKNOWN`/404 不等于免费，FAILED/CANCELED 也只提供 `billingDisposition: UNKNOWN`。
- 自动恢复只接受新合同完整的精确 Wanx 编辑。原派发时间限定最多 24 小时，不重置接受时间、job ID、workflowAttempt 或原调用 attemptCount；无 ID 的未知提交仍人工复核，禁止重发。认领/写入绑定 job、owner、actor、原 task、workflow attempt、fingerprint、revision、token hash 和未过期 lease。原始输出、合成与规范化共用正常编辑 owner；raw 的 DB 身份、lineage、文件名和存储幂等键也复用同一 owner。原 raw hash 冲突被拒绝，不覆盖历史对象。
- 成功恢复仅生成一个待审核 final；局部重绘仍保留遮罩外像素，raw 不可批准。取消只保留 raw、维持 CANCELLED，无可应用候选。终态账本 SETTLED/RELEASED 及 job 投影保持不变；未知费用保留对账，不能由任务失败状态推断零费用。旧 translation-style complete 不能绕过编辑 raw/final 图。
- 新鲜证据：已有 7 文件 / 94 项基线通过；凭据、查询协议和恢复分流均实际 RED → GREEN。最终完整后端为 `398 files passed / 5357 tests passed / 253 skipped`（环境专用测试按独立 gate 执行），HTTP/config/init 聚焦 `2 files / 21 passed`，新增只读 adapter 用例 `62 passed`。PostgreSQL 最终回放全部 148 migrations，`22 files / 126 passed`：包括两操作恢复、轮换发生在 worker/GET DNS 前或下载后、取消、存储失败重入、raw 冲突、重复/过期/伪造 claim、一次结算、既有 SETTLED/RELEASED 决定，以及错误 ID/尺寸/源图和 UNKNOWN/FAILED。
- 最终完整 `pnpm preflight`、全仓 lint、server/Web typecheck、server build、`git diff --check` 与文档 adoption guardrail 通过；扩展 source verifier 为 `459 / 0 failure / 0 warning`。preflight 曾发现新增测试参数缺类型，已补齐后完整重跑通过。两个独立 owner 复核完成；其发现的默认 HTTP 错误分类与空凭据准入问题已按 T2 修复并复查关闭。本轮 6 个隔离 schema 均由 runner 清理，并只读复核剩余 0；未改业务 schema，未暂存、提交或推送。
- 证据边界：service、Prisma、数据库约束、工厂、adapter、输入 reader、合成/审核和存储 key 推导为真实 owner；Provider HTTP/DNS、能力晋升证据、授权/配置/Redis、对象存储 I/O 为明确 fixture，合成 USD 账本不是实际 Wanx 账单。没有执行真实 Provider → ERP、MV3/生产浏览器或正式 QA-04。
- 本节本地接线与隔离验证已收口。下一步真实验收仍须匹配当前 Wanx 计费账户、明确本次硬费用上限/币种及精确一次性批准，并验证当前 prompt profile 的各操作质量与实际账单，再执行正常 Provider → ERP/正式 QA-04。不得复用旧已消费请求或以 fixture 结果晋升能力。本轮实际 Provider/Ozon 请求、新增真实费用、生产配置、部署和官网切换均为 0。

### 新 Wanx 凭据与付费前准备（2026-09-10）

- 本节接续用户新 Key 已录入后的“继续下一步”。用户明确的本轮总费用硬上限是 **CNY 1**，并已授权只读核对账户；无需再次索取预算或在聊天中发送 Key。本节只做非收费准备，不授权修改线上配置、付费执行、能力晋升、Git 提交/推送、部署或官网切换。
- 新凭据的账户归属已核清：受保护 DPAPI 文件中的新 Key 与北京业务空间专属域名认证相符；同一已认证控制台的登录/主账号与该 Key 记录归属一致。标准 `https://dashscope.aliyuncs.com/api/v1` 的只读模型目录认证也通过，精确模型 `wanx2.1-imageedit` 可见。该标准端点预检使用既有 clean `d0777956` checkout，只证明鉴权，不冒充当前 dirty 源码验收；旧 Key 的三笔历史账单仍未结算，不用新 Key 代为结算。Key 仅存于受保护 DPAPI 文件；私有记录只保留账号摘要和脱敏回执，不保存完整 UID、Cookie 或控制台会话，也不进入 Git。
- 当前实际缺口不是用户未提供 Key：`ai-image-sandbox-billing-settlement.ts` 虽识别 Wanx 指纹，exact attestation v2/v3 仍强制 `NEW_API_QUOTA_AND_TOTAL_USAGE_V1`；v4 只支持 Sub2 累计零，v5 只支持 Xiaoyi 凭单。尚无经过审查的阿里云原生 CNY 账单与任务关联合同，不能把官方单价或 `usage.image_count` 填进 `actualCost`。
- 只读账单核查：费用中心“账单详情”区分定价币种、目录总价、订阅/优惠抵扣和应付金额；“查看用量明细”明确说明原始用量仅供参考、**不作为对账依据**。本日读取的[原生实例账单 API](https://help.aliyun.com/zh/user-center/developer-reference/api-bssopenapi-2017-12-14-describeinstancebill)还说明费用数据延迟约 24 小时、部分实例信息延迟 48 小时，当前月实例汇总不是最终对账数据。未导出无关账户账单，未据此虚构逐请求已结算金额；后续须核实可关联的结算账单来源，而非放宽旧 15 分钟时间窗或把空列表判为免费。
- 试点入口核查：官方 approval draft 从草稿阶段就要求可验证 clean revision；当前 resolver 返回 `SANDBOX_ADAPTER_WORKTREE_DIRTY`。现有 single-submit 仍用固定英文 prompt，直接调用 adapter，不走正常 ERP 的冻结模板/任务/审核链。因此旧 sandbox 成功不能验收新的 `ai-image-wanx21-edit-prompt/v1`，也不能通过旧 clean checkout、测试 capability 或手工伪造 release 绕过门禁。
- 额度核查：现有审批和 guard 只绑定一次请求，没有跨操作的本轮总预算执行绑定。两个审批各写 CNY 1 不等于总限额 CNY 1。私有准备记录仅提出 FULL_EDIT/INPAINT 各一张、各分配 CNY 0.25 的待审分配；官方 CNY 0.14/张仍仅为参考报价，不是实际费用或 Provider 侧硬扣费限制，尚未批准执行。
- 非收费输入准备已完成：沿用受保护的既有 1024×1024 测试杯图和同尺寸 PNG alpha mask，实际解码及摘要校验通过；mask 的 25,600 个编辑像素位于左上角背景。调用当前真实 rendering owner 得到 FULL_EDIT 458 字、INPAINT 462 字，均完整保留约束且低于 800 字；仅为源码默认模板预览，未绑定线上 template release、未生成付费审批。私有 `wanx-trial-preparation-20260910-01.json` 保存精确输入、提示词、摘要、账户核验引用与停止项，明确标为非审批，不进入 Git，也不是原生账单适配实现。
- 新鲜验证：隔离 `.env` 和 Provider 凭据后，审批/账单/Wanx guard 为 `4 files / 178 passed / 2 skipped`；当前 prompt/hosted/media 为 `3 files / 44 passed / 1 skipped`。跳过项为既有平台限制；fixture 不能替代实际 Provider → ERP。独立只读审批审查已由主代理对源码与测试复核。此前本地开发门禁继续保留，但正式 QA-04、真实费用及当前操作质量仍未验收。
- 下一开发入口：先闭合阿里云原生结算账单与任务关联的最小合同，再补当前冻结提示词和 CNY 1 总额绑定的受限试点入口；仍复用现有 owner，不新增旁路放行。形成受审 clean checkpoint 后再生成逐操作审批。本轮没有重新读取明文 Key、发送收费图像请求、改写旧审批/账单、修改 ERP/VPS 配置、调用 Ozon、提交/推送、部署或切换官网。

### 阿里云原生账单观察入口（2026-09-10 本地实现）

- 本节接续用户“继续”，只实现非收费的原生账单读取与待对账评估。D2/T2 Task Decision 已在 owner 写入前执行校验；沿用现有私有文件、精确金额、Git 修订与最终结算 owner，不新增数据库字段、结算 attestation 或能力晋升例外。Host 自动 hook 强制执行仍为 `UNVERIFIED`。
- 新 owner `ai-image-alibaba-billing-observation.ts` 消费封闭 `ALIBABA_NATIVE_BILLING_OBSERVATION_V1`：保留 QueryBill 原始响应字节/摘要、采集人摘要、查询范围和分页，分别保存查询账号、资源归属、账单号和查询请求号的摘要。官方 `RecordID` 是账单号，不是 Wanx `task_id`；账号摘要匹配也不自动证明 Key/RAM 归属。源码不假设 Wanx 的真实 ProductCode/实例映射。
- 金额保留原口径：应付、含信用退款抵扣的支付、不含该抵扣的现金和各项优惠分别输出。使用原始 JSON 数字文本与 BigInt，再进入既有 amount/scale 合同；过高精度、超安全整数、负数和错误币种直接拒绝，不把零现金、空结果、PayFinish 或单行账单当作免费/单请求结算。未提供的可选金额保持 null，未完整分页明确标记；不推算账期最终性。
- 新命令 `pnpm --filter server sandbox:ai-image:billing:inspect-alibaba` 只读指定私有文件，复用有根目录约束、摘要、大小和 canonical JSON 检查的 reader。拒绝凭据、付费确认与旧结算/审批输入混用，首尾绑定同一 clean Git revision。输出始终为 `RECONCILIATION_REQUIRED`、`actualCost:null`、`canFinalize:false`，没有 `billingGate`；不写 intent、claim、settlement 或 registry。使用合同见[公开 runbook](../docs/runbooks/ai-image-provider-sandbox-billing.md#inspect-native-alibaba-bills-without-finalizing)。默认 billing finalizer 的既有结算合同不变。
- T2 先在独立临时 clean Git checkout 对真实 CLI 观察正常原生输入、账户错配和重复金额字段的 3 项目标 RED，再实现 GREEN；首个 Windows loader 路径错误属于 harness 问题，修正后才记录行为 RED。随后摘要缺失、异常日期/隐私投影和无效 Unicode 均观察 RED 后修复。独立审查发现损坏转义 JSON 的平方耗时，512 KiB 输入在有 3 秒预算的子进程中先超时 RED，改为单调游标线性扫描后正常拒绝；复核确认该问题关闭。
- 新鲜定向结果：原生观察/CLI 与既有账单联合 `4 files / 167 passed / 1 skipped`，能力候选合同 `45/45`；server typecheck、独立 CLI/test no-emit 类型检查、定向 ESLint、diff 与文档 adoption 检查通过。脚本测试已放回 scripts 范围，不扩大 server `rootDir`。所有账单均为合成 fixture；临时测试 checkout 和证据目录由测试清理，不是对用户分支提交。未据此声称真实 QueryBill 数据、原生单请求结算、完整 QA-02 或正式 QA-04 通过。
- 此切片已补齐原生账单“可安全读入、保留口径并明确待关联”的入口，**尚未补齐任务→账单的可信关联**，也未伪造关联字段或放宽旧结算门禁。下一步可独立开发当前冻结提示词及本轮 CNY 1 总额绑定的受限试点入口；真正收费前仍需可关联账单来源、受审 clean checkpoint 和逐操作批准。旧 Key 的三笔账单保持原状。本轮 Provider/Ozon 请求、真实费用、生产配置、Git 提交/推送、部署和官网切换均为 0。

### Wanx CNY 1 试点离线准备与核验（2026-09-10 本地实现）

- 本节接续用户“继续”，完成非收费的冻结提示词与整轮额度准备入口。新增 `ai-image-wanx-trial-preparation.ts` 作为唯一准备 owner，既有 approval-draft CLI 仅增加薄分发；`sandbox:ai-image:wanx-trial:prepare` 和 `sandbox:ai-image:wanx-trial:verify` 已注册。D2/T2 Task Decision 在首次 owner 写入前实际校验通过；Host 自动 hook 强制执行仍为 `未验证`。本节没有接通收费执行，也没有用准备清单替代真实 ERP 任务或账单。
- 冻结合同：只接受既定标准北京端点、`wanx2.1-imageedit`、一项 FULL_EDIT 和一项 INPAINT，逐项复用 `assertWanxHostedEditPrompt` 重新校验完整 release/checksum、原始正负输入、最终文本和 renderingContract。输入来自指定私有 canonical JSON，并独立绑定账号摘要、非密凭据修订、整轮 ID 和代码修订。清单明确记录 `OFFLINE_CONSISTENCY_ONLY`：本地自洽的快照不能证明线上 release/workflow 存在，不制造 workflow fingerprint 或来源证明。
- 额度合同：整轮精确绑定 CNY 1，分别校验两项 quote/maximum 的币种、正整数和共同 scale；跨操作用 BigInt 对齐 scale 并累加 **maximum**，超过 1 元的最小精度单位也拒绝。报价、失败状态、空账单、零现金和人工增补字段均不能释放或重置分配。该结果是提议分配的核验，不是执行预留或 Provider 侧硬扣费限额；恒为 `canSubmit:false / actualCost:null`。
- 输入与文件：源图及 PNG alpha mask 均受 10 MiB、1024×1024、完整解码、摘要、私有目录和链接边界约束。复用既有独占 bundle writer，先保存原字节图片，最后保存 manifest；同一证据根下同轮并发只允许一份结果，重复或部分目录不覆盖。verify 只读取留存副本并重算整份清单，拒绝篡改费用、执行状态、前置条件和图片。paid-wire fingerprint 保持原有合同，不加入 round/审批/模板/凭据/代码修订以制造可重放身份。
- CLI 在读取输入前、写入前后验证同一 clean Git revision，31 个实际源码依赖的 tracked membership 已独立复核；拒绝凭据、付费确认及旧审批/账单参数混用。stdout 只输出摘要与受限投影。测试在独立临时 clean checkout 中运行真实 CLI，网络入口被测试进程显式拒绝；没有拿当前 dirty 用户分支冒充已批准候选。
- T2 先对真实 CLI 观察“新入口缺失、整轮超额、冻结文本变化”三项行为 RED，再实现 GREEN。最终新增 owner/CLI 共 `60 passed`，覆盖精确金额、同轮双进程竞争、部分目录、改动媒体、重算外层摘要后的清单篡改、旧付费审批拒绝、凭据隔离、未跟踪/dirty helper 和中途代码漂移。审批与准备定向回归先为 `120 passed / 1 Windows 条件 skipped`，之后新增未跟踪 helper 用例随全量通过。
- 全量门禁的真实记录：第一次隔离 `.env` 的 preflight 暴露旧 `sms.test.ts` 缺少配置数据库 fixture，以及默认并发下两个原生账单 CLI 时限失败。短信问题在独立运行中复现 13 项失败后，仅补 Prisma SystemConfig 读 fixture，保留真实配置/captcha/quota owner；短信、配置与原生账单定向 `41/41` 通过。账单解析原有 3 秒上限未修改，验证进程改用 `VITEST_MAX_WORKERS=2`。第二次完整 preflight 在后端测试处有一次 worker 意外退出、无断言失败，原因尚未定位；不能将这两次命令记录为完整 preflight 通过。
- 随后的结构化全量后端验证使用同样的 `.env` 隔离和两个 worker，`402 files passed / 5476 tests passed / 253 environment-gated skipped`，无断言失败或 worker 错误；新准备 owner 的 45 项与真实 CLI 的 15 项均确认通过。全仓 lint、server/Web typecheck、扩展/审批/发布全部前置合同、sandbox strict typecheck、server build 通过；另行完成扩展 source verifier `459 passed / 0 failure / 0 warning`。本节不重跑数据库专用 runner，不把分项通过写成一张无错误的 preflight 或正式 QA-04 回执。单次 worker 异常继续作为验证环境待查项。
- 两路独立源码审查已完成，主代理对当前源码、定向测试、结构化全量结果与 Git 状态复核。另发现旧 Wanx sandbox POST guard 在多个 await 之后才设置 `submitClaimed` 的并发窗口；独立纯内存探针报告两次模拟 POST，主代理静态核对了该时序。本节无收费入口，不扩大修改该 guard；后续执行接线前必须补并发负例并关闭此窗口。
- 本地准备/核验切片已完成。下一步是可信模板/ERP 工作流来源、原生任务→结算账单关联，以及整轮/逐操作的持久执行预占与精确批准；准备文件不能直接交给旧 fixed-prompt paid CLI。旧 Key 的三笔账单保持未结算。HEAD 仍为 `a00c78c6`，保留进入本轮时的 54 个未提交文件，本轮也未暂存、提交或推送；真实 Provider/Ozon 请求、费用、生产配置、部署和官网切换均为 0。使用合同见[试点准备 runbook](../docs/runbooks/ai-image-provider-sandbox-approval.md#frozen-wanx-two-operation-trial-preparation)。

### Wanx 受控执行预算与审批链（2026-09-10 本地闭环）

- 用户继续要求推进并询问生图/计费测试。本节完成隔离 sandbox 的实际执行接线与本地测试，不将其称为正常 ERP 来源、真实新 Wanx 质量或原生费用验收。历史 Xiaoyi 单张与凭单对账、旧 Wanx 三操作技术/质量结果仍有效；新凭据和当前短提示词的真实联合验收仍未完成，不重发旧已消费请求。
- 首先关闭 Wanx POST guard 的并发窗口：在请求头同步检查后、body/DNS/审批 await 之前领取一次性名额。三种编辑操作在 DNS/审批等待期间的六个并发用例，以及发包前拒绝后的两个重试用例先 RED 后 GREEN；已有未知结果保留用例继续通过。发包前拒绝保持实际 createRequests=0，但不重新开放该 guard；丢响应后保留一次请求和待对账状态。
- 审批 owner 新增闭合 v4，保留 v2/v3：六字段 trialBinding 绑定 round、manifest、私有根身份、账户 UID 摘要、wire fingerprint 与完整冻结 prompt 摘要。合法两操作先因旧 schema RED，再通过 46 项新用例。普通入口拒绝 v4，trial 入口拒绝 v2/v3；旧 approvalEvidence/intent/report 格式保持不变。v4 非审批草稿入口复用原拒绝哨兵，30 项新用例和原准备/旧草稿联合 `106 passed / 1 platform skipped`。
- 新 owner `ai-image-wanx-trial-execution.ts` 接入既有 single-submit，显式 `TRIAL_SUBMIT / TRIAL_VERIFY_APPROVAL` 消费原准备清单。请求文本、源图/遮罩、精确 quote/maximum 均由已复核 manifest 给出；禁止 CLI 改单号、输入、费用或输出目录。私有根摘要同时绑定 canonical path、dev/ino/birthtime，不能靠复制目录或同路径替换继承旧审批。代码与 shared/package.json 等运行依赖均受 clean Git 绑定。
- 实际 POST 前先持久领取原全局 fingerprint/intent，再原子写入整轮预算及按 FULL_EDIT/INPAINT 固定命名的槽位。整轮文件永久绑定原 manifest 与两项 maxima，总额不超过 CNY 1；新审批、另一 checkout、重新分配已消费整轮或未知结果均不释放槽位。最后发包检查再次核验代码、目录/清单、领取记录和审批。额度只是执行授权上限，不是 Provider 侧扣费硬上限或实际费用。
- 真实 single-submit、审批 loader、文件 claim、Wanx adapter 与图片处理组成的合成链先观察 3 项缺失入口 RED，再 GREEN。最终执行 suite 17 项通过，包含两操作、同进程和两个独立 Node 进程竞争、未知响应、新审批、根目录复制/替换、v3 降级和整轮再分配。只替换 Provider HTTP/DNS，发送边界断言预算槽位与全局 claim 已落盘；没有真实 Provider 请求。独立审查发现的混合/重复/未知 CLI flag 和 shared/package.json 跟踪缺口也分别先 RED 后关闭。
- 成功与失败报告均追加不可覆盖的 `wanx.trial-evidence.json`，绑定原报告摘要、trialBinding 和两个 claim 摘要；标记 `ISOLATED_WANX_TRIAL / OFFLINE_CONSISTENCY_ONLY / billingReconciliation:REQUIRED`。原始 report 保持 `actualCost:null`。该分类不能替代真实 ERP 工作流、已结算账单、完整 QA-02 或正式 QA-04，也不以 v4 中的引用字符串证明这些外部事实。
- 原生账单公开事实已重新核对：阿里官方明确推理账单按分钟汇总，通常结束后 2–10 分钟出账，但采用预占+月结，出账不等于实际扣款；实例由 ApiKeyID/业务空间/模型/计费类型/渠道等组成，没有 task_id。QuerySettleBill 当月仅供参考，最终账单次月 2 日 12 点后可查看。当前仍缺实际 Wanx 行的非密 ApiKeyID/实例/产品计费项映射、完整账单与区间唯一调用证据，不能按图片数均摊或用目录价填 actualCost。事实与后续关联边界只维护在[计费 runbook](../docs/runbooks/ai-image-provider-sandbox-billing.md#native-wanx-task-association-and-settlement-boundary)。
- 验证入口另按 T2 修复 `preflight` 把 signal/null exit 当成功的问题：完整脚本只替换外部 spawn 的五个用例，先 2 RED 后 5/5 GREEN，并注册为首个门禁。这不是上一节 worker 意外退出的根因修复。针对旧异常，本节使用经过合成 exit=23 探针验证的临时诊断，记录 worker PID/exit code/signal 及模块生命周期，不记录参数、环境或业务数据；保留 `.env` 隔离、两个 worker 与原有解析时限。
- 最终完整 `pnpm preflight` 退出 0，全部选定检查通过；结构化后端结果为 `405 files passed / 5578 tests passed / 253 conditionally skipped`（共 443 文件），模块完成回执 `errors:0 / reason:passed`。本轮新增 102 项 Vitest 用例全部包含在该结果内；全仓 lint、server/Web typecheck、sandbox strict typecheck、server build 通过，扩展 source verifier 为 `459 passed / 0 failure / 0 warning`。此前 worker 异常本次未复现，根因仍不作已解决声明。没有以分项拼接冒充这次完整命令回执。
- 已完成的本地入口和测试可继续复用；剩余为受审 clean checkpoint、可信 ERP 模板/工作流来源、真实新通道质量与任务→原生账单关联、逐操作实跑批准以及正式 QA-02/QA-04。本节没有读取真实 Key、生成真实付费审批、调用 Provider/Ozon、修改线上配置、部署或官网切换，也没有 Git 暂存/提交/推送。HEAD 仍为 `a00c78c6`；进入本节的 63 项修改均保留。

### 受审检查点与真实取证边界（2026-09-10）

- 用户明确要求先补真实任务来源、账单映射和受审干净代码版本，再进入受控实测。本节形成本地代码检查点并核清真实取证入口；没有把未取得的 ERP/原生账单数据填成通过，也没有发送付费请求。
- 三路独立复核覆盖托管编辑、隔离试点和原生账单观察。托管复核发现：任务已被并发流程置为 `CANCELLED` 或 `FAILED` 时，首次接收身份写入失败所携带的迟到 Provider task ID 会被 runner 异常分支丢弃。`ai-image-edit.ts` 现在将这两种情况交回既有终态感知仓储；不重新打开任务，不重发 POST，不修改仓储/账本合同。修复已独立复核。
- T2 证据：新增两个 runner 用例先因未转发接收证据 RED；真实 Wanx adapter/worker/Prisma 链的两个新增用例也先 RED，而原 126 项通过。修复后相关五文件 `153 passed`，隔离 PostgreSQL `22 files / 128 passed`。数据库断言证明终态和 task ID 保留、无候选资产、重复执行不重发；原 `SUBMISSION_UNCERTAIN` 审计条目与新增 `RECONCILIATION_REQUIRED` 条目同时保留，金额均为 null，不能误删前者来满足单条记录预期，也没有新增 CHARGE/RELEASE。
- 本地验证环境：仅在测试进程把已核实的 `localhost:5432` 连接定为 `127.0.0.1:5432`，没有改 `.env`。原生 Vitest 4.1.7 配置在 `--no-file-parallelism` 设置单 worker 之后仍消费 `VITEST_MAX_WORKERS`；沿用全量 suite 的值 2 曾造成共享 schema 中的额外串行化冲突，数据库 runner 改用进程级值 1 后只剩目标 RED，未放宽事务重试、测试时限或业务规则。本轮为测试启动已有本地 Docker；四个新建隔离 schema 均已清理，复查为 0 遗留，原有数据保留。
- 最终完整 `pnpm preflight` 退出 0，结构化后端结果 `5580 passed / 255 conditionally skipped / 0 failed`，443 个模块完成且 `errors:0 / reason:passed`。新增两个 PostgreSQL 用例在普通 suite 中按既有环境门禁跳过，已在上述独立数据库 runner 实跑通过。全仓 lint、server/Web typecheck、sandbox strict typecheck、server build 通过；扩展 source verifier `459 passed / 0 failure / 0 warning`。这些仍是本地代码/数据库证据，不是 QA-02 或正式 QA-04。
- 真实来源读取必须消费实际 release/revision/发布测试记录，以及 `PrismaAiMediaWorkflowRepository.getOwned` 和 job repository 中的冻结任务、当前 attempt、输入资产摘要。`getById` 自身不做 owner 过滤，采集层必须显式核对；公开 `publicJob/publicWorkflow` 隐藏完整快照和指纹，不能作为完整来源证明。`resolveActiveAiTemplate` 可能初始化默认模板，不可当作纯读取已有发布证据。ERP 黑白 mask 与 trial alpha mask 也不能沿用同一摘要，须绑定正常转换 owner 前后的两份字节。当前 Wanx 普通建单仍受 `sandbox-verified` 门禁且创建后立即 enqueue，不能注入测试能力或提前晋升来制造真实任务。
- 原生账单映射仍未取得：当前私有材料保留的是账户/候选 Key ID/业务空间摘要和只读认证回执，不是实际 ApiKeyID→Wanx 实例/产品计费项→完整账单区间的映射。既有私有根、新 Key 加密文件、凭据修订与媒体目录的 Windows ACL 已只读复查，没有当前用户/SYSTEM/Administrators 之外的允许项；没有解密或输出 Key。账单最低证据继续由[计费 runbook](../docs/runbooks/ai-image-provider-sandbox-billing.md#native-wanx-task-association-and-settlement-boundary)负责，内部 USD 账本不得替代原生 CNY 结算。
- 浏览器取证暂停：只读探测为 `CDP_STATUS=needs-setup / CHROME_RUNNING=yes`，未找到可复用调试端口；没有关闭或重启用户 Chrome。须恢复独立的百炼/费用中心/ERP 登录会话，再读取经授权选定任务与账单的原始证据。已请求用户确认独立核验窗口；不再次索取 Key/预算，不查询或重发已完成的 Xiaoyi 请求。
- 本地提交：`c5f2bedb` 收口隔离验证门禁；`7751a722` 收口 Wanx 托管编辑、原生账单观察、CNY 1 隔离执行及迟到接收证据修复。本文件的文档提交跟随该源码检查点；后续审批仍须绑定执行时的全长 clean HEAD，不能复用旧 `a00c78c6` 或合成测试 checkout。进入本轮的 73 项改动均保留并归入对应检查点，另加本节 runner 回归；私有资料、历史 build 和浏览器 profile 未纳入 Git。没有推送、生产配置变化、Provider/Ozon 请求、真实费用、部署或官网切换。

### 已登录后的模板与账单只读取证（2026-09-11）

- 用户已在独立核验浏览器登录百炼、费用中心和 ERP，并明确确认“尚未创建，继续核对现有模板和账单”。本节沿用 `3aa9d7754894c8cfd1a6588c14322f95da3b924e` 源码检查点，取证开始时工作区干净。当前 ERP 账号的 `/api/user/me` 与 `/api/ai-images/workflows?limit=100` 均返回 HTTP 200；身份为非子账号的超级管理员，个人独立工作流列表为 0 条。这不是全平台任务盘点，也不证明套图或其他账号没有任务；本轮不再要求用户寻找尚未创建的任务。
- 模板来源已取得真实证据。`GET /api/admin/ai-prompt-templates` 的 registry 列表会调用模板初始化，因此没有调用该接口。通过既有 COM 运维连接，在 `REPEATABLE READ` 事务中首先设置并确认 `transaction_read_only=on`，设置 5 秒语句时限，仅查询 `full-image-edit.base`、`inpaint.base` 及其当前 release/revision/testRun。观察到 COM 活动运行目录绑定 `0b8c664a5e58a4a9f580c69ac43a1cc15b42749d`，本节没有改变运行版本。
- 两项模板均为 sequence 2、`PUBLISH`、revision `PUBLISHED`，发布时间为 2026-08-05；关联 testRun 均为 `PASS`，release/revision/testRun 的身份和 checksum 一致。全图编辑 checksum 为 `19db1f922585c1fd47d638412e78a16e54d865ea157d8d9c1ead8fc9ff808895`，局部重绘为 `c24ed46657c3c08c3ca12edb8f284d79f19d0304ec30870bf22e85a339fa3c7a`。原始模板取证文件 SHA-256 为 `4b5b30c9d5967a2fcaa0d48021c2b96912253dfcfd11df338b347d8f6c1232b4`。
- 使用当前纯函数 owner `checksumAiPromptRevision`、`renderAiPromptRevision` 和显式 Wanx rendering profile，对真实导出的修订及既有试点输入做离线核验。checksum 均匹配；FULL_EDIT 458 字、INPAINT 462 字，均通过 800 字约束，独立负向字段为空并按合同内联。这次已绑定真实模板 release/revision，不再只是源码默认值预览；但仍没有真实 ERP workflow/job、Provider task 或付费审批，不能把离线渲染称为线上任务验收。
- 新凭据的非密身份核对已推进到真实用量查询字段：在北京区百炼选择唯一可见的新 Key，视觉模型查询发送的 `apiKeyId`、`filterWorkspaceId` 摘要均与 2026-09-10 已核验记录一致。费用中心 `GetConfig.data.AccountId` 与 `LoadHumanInfo.data.Data.Pk` 也匹配既有账户 UID 摘要；`SellerInfoDto.SellerUid` 是不同身份，没有用它代替费用账户。只保留必要摘要，不解密 Provider Key、不保存会话或请求认证信息。
- 百炼 2026-09-10 页面显示暂无视觉用量；9 月 11 日选定 Key 的查询返回成功、异步查询状态 `Complete`、`totalCount:0`。这里的异步任务号属于用量查询，不是 Wanx 生图 task ID。费用中心 2026-09 月、按计费项/月汇总的 `BssOpenAPI-V3 / ListConsumeSummary` 查询取得独立 COUNT_ONLY 与 DATA_ONLY 原始响应，分别为 `TotalCount:0` 和空数据。它们是控制台 v2 明细响应，不是既有 inspector 接受的 `QueryBill`，没有改名或包装成 QueryBill，也没有运行结算或晋升能力。实际 Wanx 实例、产品/计费项和逐任务账单映射仍未取得，`actualCost:null / canSubmit:false / canFinalize:false`。
- 费用中心当前显示的月概览与明细最终性不同，已在[原生计费边界](../docs/runbooks/ai-image-provider-sandbox-billing.md#native-wanx-task-association-and-settlement-boundary)区分记录；空用量、空月账单、余额或列表价均没有被解释为免费或单请求已结算。旧 Wanx 三笔账单及 Xiaoyi 既有结论保持原状态。
- 私有取证清单 `evidence-index.json` 的 SHA-256 为 `8d448358a38e5737b902c28ea2a587336ac286187e2afa850265cf7161fc8dc1`，绑定 10 个证据文件；清单与响应仅保存在工作区外、关闭继承且仅当前 Windows 用户可访问的目录。文件类型、JSON 读回、逐文件摘要及密钥/令牌/手机号模式扫描通过。这是本轮真实只读与离线 owner 核验，没有重跑先前完整 preflight，也不新增 QA-02/QA-04 通过结论。
- 本轮没有创建 ERP 任务、初始化/发布模板、解密 Provider Key、发送收费图像请求、调用 Ozon、修改生产配置、部署或切换官网。仓库只回写本节、真源索引和计费 runbook，未提交或推送。后续可复用真实模板和非密账户绑定继续离线准备；真实任务创建/来源、实际原生账单关联与逐操作付费批准仍需分别关闭，不能通过能力注入或沿用旧审批跨过这些边界。

### 真实模板来源与离线输入编译（2026-09-11，已完成本地切片）

- 当前步骤：离线输入编译的本地实现与组合验证已收口。来源/接口、Prisma、编译及 CLI 定向组合串行验证为 `5 files / 78 passed`；随后补齐 HTTP `{code,msg,data}` 导出转换流程、原始来源字节保真和 Windows Vitest `maxWorkers:2` 后，受影响组合为 `4 files / 62 passed`，sandbox `tsc`、全仓 typecheck/lint 和完整 `pnpm preflight` 均通过。隔离 PostgreSQL 集成脚本为 `23 files / 131 passed`，这是本节查询层改动的已运行证据，后续字节/fixture/测试配置修复未重跑该数据库脚本。Windows 默认并发上限下完整 server 回归为 `407 files / 5630 passed / 258 conditionally skipped`。独立源码复核发现的交接缺口已处理并复查关闭。用户“下一步 继续开发”授权本地实现和验证，保留已有未提交改动，不执行真实费用、生产或凭据操作。此前记录的 D2/T2 Task Decision 检查不代表本轮重新执行；Host 自动 hook 强制执行仍为 `UNVERIFIED`。
- 本节只维护在当前任务记录内，不另建阶段或第二份计划。主 Agent 是本节、来源/编译 owner 及 API/CLI 的唯一写入者；独立 Agent 只负责 Prisma 的有界发布查询及对应持久化测试。已有只读设计复核已汇合，实施后再次审查并由主 Agent 复核组合证据。
- 结果：超级管理员可通过独立 `GET /api/admin/ai-prompt-templates/:key/source` 读取全图编辑或局部重绘的既有发布来源；离线命令消费两份固定摘要的来源文件与原始提示词/媒体/金额，生成既有 Wanx trial v1 输入，用户无需手填 resolved 文本或快照。旧模板列表/初始化、正常建单、manifest v1、审批 v4 和收费指纹含义不变。
- Owner：`ai-prompt-template-source.ts` 校验 release/revision/发布 PASS 测试链并投影封闭导出；registry 和 route 只委托/鉴权。合法 ROLLBACK 追溯同修订的此前 PUBLISH；Prisma 只做有界 `findPublishedRelease` 读取，来源 owner 在结束时重读活动 release，变更即拒绝，不宣称跨表事务快照。`ai-image-wanx-trial-input.ts` 通过现有渲染、准备和私有文件 owner 编译并检查输入；CLI 只分发和核验配置/clean revision。
- 顺序与验收：① 来源及 API：空库零初始化、正确发布/回滚、错误修订/校验摘要/PASS 链和并发发布拒绝，未登录/非超级管理员拒绝，输出不泄露内部身份字段；② 编译及 CLI：HTTP envelope→`data` 转换、来源交换/篡改、原始字节和摘要保真、生成字段注入、错误媒体/身份/额度拒绝，保留 800 字和 CNY 1 门禁，失败前无输出写入，私有文件与 clean tracked 源码绑定；③ 组合回归、独立审查和唯一真源回写。最终完整 `pnpm preflight` 退出 0，包含 server `5630 passed / 258 conditionally skipped` 及扩展 source verifier `459 pass / 0 failure / 0 warning`；459 不是 preflight 全部检查的总数。本轮完整回归和 preflight 显式设置 `DOTENV_CONFIG_PATH=NUL`；默认 preflight 不含构建、真实浏览器或远端验收。
- 接续修复与复核：CRLF、混合换行两个真实文件用例先以 `WANX_TRIAL_TEMPLATE_SOURCE_MISMATCH` RED；私有 reader 返回已核验原始 bytes，编译 owner 同时核验 bytes 摘要及与 record 的一致性，并原样保存来源副本，随后编译测试 `23 passed`。HTTP 来源 fixture 已经过真实 Fastify route，再按[采集转换流程](../docs/runbooks/ai-image-provider-sandbox-approval.md#published-template-source-and-offline-input-compilation)提取 data；真实 CLI 覆盖 compile→prepare→verify。编译/来源/准备/私有文件组合为 `159 passed / 1 conditionally skipped`；独立审查复核未发现新增高置信问题，新增 bytes 未向公开输出传播。
- 测试环境：此前全量回归为 `5623 passed / 5 failed / 258 skipped`，仅重跑三个文件不足以断言没有回归；接续补验遗漏的 trial-execution 文件 `17 passed`。本机 `availableParallelism=16`，不等同于实际启动 16 个 worker。保持原断言和时限，以 `--maxWorkers=2` 跑完整后端得到 `5630 passed`，再按 T1 将 Windows 默认上限设为 2，并经完整 preflight 复验通过。非 Windows 保留工具默认值，尚未在非 Windows 实跑；结果支持并发负载影响，不能证明旧超时或此前 worker 异常的唯一根因。
- Git 与后续：本节实现完成时 HEAD 为 `3aa9d775`，分支 ahead 3，26 个路径未提交、暂存区为空；后续提交与新鲜验证见下节。本节未推送、部署或切换官网，未使用真实 Provider 凭据、产生费用或创建真实 ERP/Ozon 任务。当前通过结论不是 QA-02、正式 QA-04 或能力晋升。
- 真实性边界：文件 SHA-256 和完整发布链只证明固定来源文件的内部一致性，文件来源认证仍由经授权的实际采集证据负责。发布测试不是 Provider 质量证明；编译输出继续为 `OFFLINE_CONSISTENCY_ONLY / canSubmit:false / actualCost:null`，不清除 `requiredBeforeSubmit`，不制造 workflow/job、原生账单或结算证明。
- 停止条件：需要 schema/角色/生产/费用变化、无法构造有因果关系的 RED，或需要用合成来源晋升真实能力时停止该动作；其余本地独立验证继续。

### 模板来源与编译源码检查点（2026-09-11）

- 用户在恢复原终端进度后要求继续开发。本轮接续上述 26 项改动，按 T1 复核与重跑已有门禁，文档回写按 T0；没有新发现需要 T2 修复的行为缺陷。验证前后逐文件 SHA-256 一致，保留了进入本轮时的全部实现，没有混入其他工作。
- 三条独立只读复核分别覆盖模板来源/API/Prisma、离线编译/CLI/私有文件，以及测试/验收合同，未发现高置信阻断问题；主 Agent 复核源码、消费者、差异与组合结果。认证负例仍使用注入身份钩子，数据库用例证明持久化查询与真实领域发布/回滚，不将其称为线上完整来源 API 验收或实际采集认证。
- 新鲜定向基线为 `9 files / 261 passed / 1 Windows-conditional skipped`。完整 `pnpm preflight` 退出 0：server `407 passed files / 5630 passed tests / 258 conditionally skipped tests`，扩展 source verifier `459 passed / 0 failure / 0 warning`；server/Web 与 sandbox 类型检查随该命令通过。另跑 shared 类型检查和全仓 `pnpm lint`，均通过。本轮验证入口均显式设置 `DOTENV_CONFIG_PATH=NUL`；没有通过默认 `.env` 取得运行凭据。
- 本轮补跑了最终文件内容的隔离 PostgreSQL 门禁。使用本机已有 `postgres:16-alpine` 镜像新建仅绑定回环地址的临时容器和 tmpfs 数据目录，使用合成测试连接；148 个迁移全部回放，`ai-media-postgres-integration.mjs` 为 `23 files / 131 passed`。进程级 `VITEST_MAX_WORKERS=1` 保证数据库 runner 的顺序，不修改业务配置或用户环境文件。结束后查询测试 schema 遗留为 0，临时容器已移除，原本地 PostgreSQL/Redis 仍 healthy。没有重跑不受本次改动影响的 upgrade runner。
- 阶段源码提交：`eb8ee6c60d29012167549a0b74bdc1b5baf9dca1` 固定 Windows 默认 Vitest 并发上限；`8925dbca5e5655ebb408164a08170c127ef3b6f2` 收口模板来源与离线编译、对应测试及 runbook。内部 owner 文档随后的独立提交记录本节。只暂存逐项核对的路径，staged diff 与密钥模式检查通过，忽略的构建、环境、浏览器和私有证据未进入提交。
- 下一步复用已取得的真实模板/账户证据，按 runbook 核实采集认证和固定输入，再分别关闭真实 ERP 任务来源、原生账单关联与逐操作批准。执行必须绑定当时最新的全长 clean HEAD，不能把上述源码提交号当作后续文档提交后的 HEAD。原本的 CNY 1 总额与旧账单状态保持不变；本轮真实 Provider/Ozon 请求、真实费用、生产变更、推送、部署和官网切换均为 0，未新增 QA-02、正式 QA-04 或能力晋升结论。

### HTTP 模板来源离线导入（2026-09-12）

- 用户继续开发，本轮从 clean `45967b424886793b2479aa88e32148e98f5bf7d0` 接续。结果是把已有 runbook 的 HTTP envelope→data 提取步骤接入正式离线命令，使导入结果直接提供后续编译所需的相对文件引用与摘要。唯一业务 owner 为 `ai-image-wanx-template-source-import.ts`；CLI 只装配，来源发布链校验、私有文件和 bundle 写入继续复用原 owner。没有调整 schema、角色、正常建单、编译输入 v1、审批 v4 或收费指纹。
- T2 先用真实 Fastify 路由生成的合成来源响应和真实 CLI 子进程写出两个正向用例，两者分别因不识别模式/参数而 RED；实现后 GREEN。另以返回码与 sequence 的小数精度舍入输入复现两个错误接收 RED，再通过原始 JSON 数字 token 校验关闭。52 项导入测试覆盖 decoded key 重复、深度、UTF-8/BOM/base64、响应大小、逐条 origin/key/source 绑定、采集时间、原始 wrapper/HTTP 字节、直接消费者引用、错误配置、代码漂移及已有目录不覆盖；受影响六文件组合 `192 passed`。
- 新入口为 `sandbox:ai-image:wanx-trial:sources:import`，复用现有 sandbox、clean revision、私有根和 round 身份配置，并独立绑定 `AI_IMAGE_SANDBOX_ERP_ORIGIN`。导入模式读取两份已采集响应，不发起 HTTP/DNS 或认证请求。每份响应上限 256 KiB，必须是对应来源 URL 的 HTTP 200 与 `{code:1,msg:'ok',data}`；全部校验完成后才保存原 captures、两份 HTTP bytes、两份规范化来源及最后写入的转换清单。后续 CLI 测试直接消费返回的 `templateSource:{path,sha256}` 走完 compile→prepare→verify，没有手工重建引用或请求收费。
- 两条独立复核分别覆盖源码安全/字节边界及 CLI/测试/文档合同，均已完成且未发现高置信功能缺陷，主 Agent 已复核结论。第二条首次因模型限流失败，随后重试完成；runbook 据复核收窄了拒绝导入专用设置的四个离线模式表述，没有修改 single-submit 或付费协议。
- 2026-09-12 最终完整 `pnpm preflight` 退出 0：server `408 passed files / 5684 passed tests / 258 conditionally skipped tests`，扩展 source verifier `459 passed / 0 failure / 0 warning`；server/Web 与 sandbox 类型检查随命令通过。独立 sandbox 类型检查、shared 类型检查和全仓 lint 也通过。八个源码/测试/配置文件在组合与完整验证期间 SHA-256 一致。本轮验证入口显式设置 `DOTENV_CONFIG_PATH=NUL`；未新增数据库、构建、浏览器或外部运行验收结论。
- 源码及 runbook 已提交为 `279904a4bddfa0f4152da6e667f4c5e1d2b71373`；内部 owner 文档随后独立提交。提交前明确核对九个源码/测试/配置/runbook 路径，staged diff 和密钥模式检查通过，私有资料、临时日志、构建及环境文件未纳入 Git。后续执行绑定当时最新的全长 clean HEAD，并按实际采集类型保留原始证据；本入口要求真实 HTTP capture，不能把既有 SQL 读取结果改名作为 HTTP 响应。原有已规范化来源文件的编译路径继续可用。
- 输出固定为 `IMPORTED_NOT_AUTHENTICATED / OFFLINE_CONSISTENCY_ONLY / REQUIRES_CAPTURE_REVIEW / canSubmit:false / actualCost:null`。摘要及采集人/时间元数据只证明文件交接一致性，不证明实际登录、模板当前仍活动、ERP 工作流来源、Provider 质量或账单关联。真实采集、付费、Provider/Ozon 请求、生产变更、部署与推送均未执行；操作格式由[来源导入 runbook](../docs/runbooks/ai-image-provider-sandbox-approval.md#import-captured-source-responses-offline)维护。

### 真实只读复验与首笔校准准备（2026-09-12）

- 用户明确要求继续测试、采集和验收。本轮复用已有独立核验 Chrome，只操作 ERP、百炼用量与费用中心的选定页面，并验证上次私有清单摘要仍为 `8d448358a38e5737b902c28ea2a587336ac286187e2afa850265cf7161fc8dc1`。这是 T3 真实只读与现有命令验收，不再用新增本地套件数量代替真实 Provider 进度。
- ERP `/api/user/me` 返回 200，当前会话仍为超级管理员、非子账号；个人 `/api/ai-images/workflows?limit=100` 返回 200、0 条。该结果不代表全平台或其他账号没有任务。两项新模板来源 URL 均返回 Fastify `Route ... not found` 的 404，线上尚无这些路由；没有调用会初始化模板的列表入口，没有部署新代码。
- 百炼对既有新 Key 的北京区 `Online / Vision` 查询，覆盖 2026-09-11 整日及 2026-09-12 00:00 至约 01:02。两次统计和明细查询均成功并达到 `asyncTaskStatus:Complete`，明细 `totalCount:0`；请求中的 Key/业务空间摘要与前次记录一致。异步查询 ID 保持为用量查询身份，不作为 Provider 图像 task ID。
- 费用中心对 2026-09 的 `ListConsumeSummary / consumeDetailBillV2MonthSummary / MONTHLY / BILLING_ITEM` 重新执行 COUNT_ONLY 与 DATA_ONLY，均为 200，分别为 `TotalCount:0` 与空数据。随后刷新并只读核对 `GetConfig.data.AccountId`、`LoadHumanInfo.data.Data.Pk`，两者摘要均匹配既有已审费用账户；身份响应只保存必要摘要，没有保存会话/认证字段。这些仍是控制台明细观察，不是 QueryBill、实际单次费用或结算回执，`actualCost:null / canFinalize:false`。
- 已记录并独立复核一项顺序冲突：准备 owner 的 `requiredBeforeSubmit` 包含 `TRUSTED_TASK_TO_SETTLED_BILL_LINK`，审批 runbook 也将其列为真实发包停止项；但首笔请求自己的实际计费样本与结算关联只能在请求后产生。本轮没有删除或放宽该字段、结算标准或正常 ERP 门禁。提出的最小裁决是独立批准首笔单请求隔离校准，先取得首个 Provider task/原生计费样本，再按原标准核验关联；正常 ERP、完整 QA-02 与正式 QA-04 继续待验收。本节准备结束时仍等待裁决与批准，后续执行结果见下节。
- 来源准备复用已有经认证 SQL 发布取证，保留原始文件及 `4b5b30c9d5967a2fcaa0d48021c2b96912253dfcfd11df338b347d8f6c1232b4` 摘要，通过当前来源 owner 校验并记录到规范化来源的转换关系，未伪装为 HTTP capture。源图为已有 1024×1024 白杯测试图，SHA-256 `5d2627b439825054a0205afc97fab6444cffa64085c31e68f8f37781520b6e32`；alpha mask 摘要为 `f5a5d6945d37b0616f9606d1832f48dcf47710b37fda494bd5ce115bfb14fe3b`。二者实际字节与旧记录一致，正常 preparation owner 的图片/遮罩/提示词与金额校验通过；这不是 ERP workflow/job 来源证明。
- 建立真正的 detached Git worktree，冻结受审源码 `a8be87bf08d278bf85f7cbb83a361c451afecd62`，按锁文件离线安装依赖，下载数为 0；前后 Git 均 clean。该执行 checkout 独立于随后仅记录证据的主工作区文档提交，不是合成 fixture checkout。使用该冻结源码的正式 CLI 完成 compile→prepare→verify→FULL_EDIT approval-draft，全部在禁止网络、无 Provider Key 的进程中通过。轮次 `wanx-calibration-20260912-01` 的输入摘要为 `93e56e86d204063726e2b63ad98afc909189551588891d7376e9daf3ed30ab22`，准备清单摘要为 `89dad33761a677a06f0409e19552fd6ad19360a8ca435a9e11352840a84568ca`；全图编辑草稿摘要为 `6946f1a9ffc895bd73170f59a1a5b1ce460c2b543ae42bee5c5d146c9a0af31d`。真实 approval verifier 对未批准草稿按预期返回 `SANDBOX_APPROVAL_SCHEMA_INVALID`，未创建 intents 或 execution claim。
- 首笔建议仅 FULL_EDIT 一张：把杯子后方灰背景改为均匀浅蓝灰，保持杯子、把手、数量和阴影；参考报价 CNY 0.14，单操作授权上限 CNY 0.25，仍沿用整轮 CNY 1。第二个 INPAINT 槽位只有准备输入，没有批准或领取。上述上限是本地执行授权预算，不是已验证的 Provider 端硬消费限制；正式批准还须覆盖新凭据使用、指定图片/提示词发送、同 task 查询/结果下载、账单只读核对及失败/未知结果不重发。所有产物仍为未批准、未对账状态。
- 本轮私有清单绑定 38 个文件，摘要为 `0096d914473a3463ac9ad35be91f389c6659bdaa5abc14793b6367833c56392a`；新目录关闭 ACL 继承且仅当前 Windows 用户可访问，JSON 读回、逐文件摘要及凭据模式扫描通过。真实图像请求、费用、ERP 任务创建、Provider Key 解密、Ozon 写入、生产配置、推送、部署和官网切换均为 0。当前完成的是实际只读复验和可审阅的首笔隔离测试包，账单验收仍未通过。

### 首笔 Wanx FULL_EDIT 隔离实测（2026-09-12）

- 用户引用完整操作/预算/代码/清单范围后明确回复“批准这一次隔离测试”，同意先取得首笔任务与计费样本、再验收关联的顺序。批准仅覆盖新凭据、既定白杯源图与冻结提示词的一次 FULL_EDIT，以及同 task 查询、结果下载和账单只读核对；参考报价 CNY 0.14、单次授权上限 CNY 0.25，整轮仍为 CNY 1。没有批准 INPAINT、额外生成、失败/未知结果重发、正常 ERP 放量或部署。本次是明确的首笔隔离范围裁决，不删除 `requiredBeforeSubmit`，不改变结算标准。
- 发包前重新核对指定新 Key/业务空间用量和费用账户的本月明细，查询成功且仍为空。批准文件先通过冻结源码的无网络 verifier。临时 PowerShell 启动包装器将 `ConvertFrom-Json` 得到的 UTC DateTime 再按本地时间解析，误报批准过期；两次尝试均在 launcher claim、凭据读取与进程启动之前退出，没有 Provider 请求。保留原文件和续期链，按带时区的 DateTimeOffset 修正包装器后使用同一操作许可；实际消费的批准 SHA-256 为 `832a82f1b2cab3fadc5c755b6af29d5df4efd9c9a78b073c6f0b3d0222f7e4fa`。本机系统 DNS 的代理保留地址未用于放宽安全校验，冻结执行器既有公共 DoH 路径核验公网地址后正常执行。
- 实际执行继续使用 clean `a8be87bf08d278bf85f7cbb83a361c451afecd62` worktree 和清单 `89dad33761a677a06f0409e19552fd6ad19360a8ca435a9e11352840a84568ca`。新凭据只在本次启动进程中解密并通过子进程环境传入，没有出现在命令参数、日志或 Git。执行在北京时间 03:02:47 至 03:03:13 完成，报告耗时 `26011 ms`，进程退出 0、stderr 为空；创建请求 **1 次**，同任务 GET 轮询 **5 次**，结果下载 **1 次**。
- 技术结果为 `SUCCEEDED`，得到一张 `1024×1024` PNG、`939381 bytes`，图片 SHA-256 为 `030c5a3b508bd07a59d1192f3c5f417d10605bff54ef483bac2a8fb63982d2e4`；Provider task ID 摘要为 `1b8e6e2be7b45e043d1059e94bc7816bd70ef2ee2b3dd63893012b28d6652072`。原始 task ID、intent、结果报告、异步回执及绑定报告的 trial evidence 均留在私有目录；trial evidence 摘要为 `6681752fb78de5d5f768994f56c23ee64b9b2553f844eb050e6c419f8fa2d7b9`。执行目录只有 `round.json` 和 `FULL_EDIT.claim.json`，没有 INPAINT claim；本次 slot/intent/launcher claim 全部保留，不退款或重置为可重发状态。
- **本次改色质量不通过。** 主 Agent 和独立 Agent 实际对照两张图片后，一致认为背景仍偏暖灰，未明确变为要求的浅蓝灰。左上背景平均 RGB 从 `[196.30,194.78,193.56]` 变为 `[196.10,192.45,191.06]`，上方背景带从 `[198.49,197.04,195.32]` 变为 `[198.89,195.25,193.01]`，与该目视结论一致。白杯数量、轮廓、把手与主要阴影基本保留，未见新增文字/标志/配件；不声明逐像素保留或用户质量确认，也不根据单次结果认定唯一根因。本次图片没有接收进 ERP、绑定草稿或发布，能力没有晋升。
- **账单仍待对账。** 在成功后约 8 分钟与 32 分钟再次按相同 Key/业务空间的 Online/Vision 范围查询，用量查询均 Complete、`totalCount:0`；当月 ListConsumeSummary 的 COUNT_ONLY/DATA_ONLY 仍为 0/空。未把空结果解释为免费，也未把报价 CNY 0.14 写入 `actualCost`。用量统计的覆盖或延迟以及 ApiKeyID→实例/计费项→本次 task 的完整关联仍未验证。
- 当前费用中心明细页真实提示：费用消耗数据延迟 24 小时、实例信息延迟 48 小时，当月最终明细于次月 3 日 12 点出具，此前查询不作最终对账依据；该 DOM 取证摘要为 `edb8367eaeb99eae161bd566f49ea3880579c4ad633d9863ae00685e7ecee81d`。后续只读复查可从 2026-09-13 03:03 后开始，实例字段继续按其延迟观察；这些时间不保证单任务关联已成立，亦不替代最终结算。结果保持 `ISOLATED_WANX_TRIAL / RECONCILIATION_REQUIRED / actualCost:null`。
- 执行证据清单绑定 80 个文件，SHA-256 为 `cd34d09b1258e6d94130621ce049a642dfbdc12b41bf64887e98d7631fd702a7`；图片/回执摘要、JSON 读回、凭据模式扫描及冻结 checkout clean 状态通过。本轮验证分类为 T3 实际单请求、结果质量和账单观察，加 T0 真源回写；没有修改产品源码、重跑无关套件、执行第二次 Provider 创建、写入 Ozon、推送或部署。结论只覆盖这次技术调用成功；改色质量、完整任务—账单关联、正常 ERP、完整 QA-02 和正式 QA-04 仍未通过。

### 首笔账单回显与颜色对照准备（2026-09-12）

- 用户继续要求推进。恢复用量与费用明细的只读页面后，11:42 首次取得 1 条模型用量和 1 条原生账单记录。页面恢复使 Key 筛选回到全部 Key，因此没有直接将该用量宣称为指定 Key 证据；随后仅复用页面实际发出的两种 telemetry 只读查询，并从真实计费实例取出、核对既有摘要后补入 `apiKeyId`。16:07 两种指定 Key 请求均返回 200/Complete，`wanx2.1-imageedit` 的 `callSuccessCount:1`、`image_number:1 张`。原请求认证信息只在内存中用于同一端点，没有保存认证请求头或令牌。
- **已取得此前缺失的原生映射。** `ListConsumeSummary` 返回的 `InstanceId` 六段结构中，前三段的 Key ID、业务空间、模型与本次已审范围一致；资源购买账户和资源归属账户也都匹配已核验费用账户。实际记录为北京区、`ProductCode:sfm`、`CommodityCode:sfm_inference_public_cn`、`BillingItemCode:image_number`（大模型图片生成量）。这是本次账户/Key/业务空间/模型/区域/计费项的实际证据，不是从通用格式或目录价猜测。
- **当前账单行显示“免费额度”，临时应付为 CNY 0。** `LineItemType:免费额度`、`ConsumeType:后付费`，`RequireAmount`、目录/单价及优惠后的金额字段均为字符串 `0`，`Currency:CNY`。账单的 `BillingQuantity` 仍原样保留为 `0 张`；用量侧为成功一次、生成一张，未为凑数改写任何字段。此记录按月汇总且不包含原生图像 task ID，仍是当月临时明细；不能据此写最终 `actualCost:0`、自动结算或宣称完整单任务结算验收。匹配观察的摘要为 `7a74ce611a0a7c16ecba5c8f3ff282a41cc4a1bfb9161d4ee4994959567e0755`，正式结算边界保持不变。
- 改色问题按 `ce-debug` 继续调查：真实源图摘要、冻结提示词摘要、当前 v1 渲染合同及 `description_edit` 操作绑定均核对一致，完整提示词为 458 字，包含原操作要求；本地追踪未见输入被替换或截断的证据。保护条款的表述、颜色要求的明确程度和模型遵从性仍是候选解释，单个样本不足以证明唯一根因。本轮独立提示词调查因模型限流未完成，未记作独立审查通过；v1 文本/合同、默认入口和历史快照均未改动。诊断记录摘要为 `686a182fead16a9b3192b3583c768a1b61feaa5877c43deecf30266f46030bf7`。
- 准备阶段形成一个**当时未批准的新对照请求**，只把用户颜色描述从“均匀浅蓝灰色”明确为“均匀、明确可见的浅蓝灰色（目标背景主色 #D9E5EB）”。源图、模型、负向要求、模板及渲染合同完全不变；离线断言确认生成的完整提示词仅发生上述替换。仍使用冻结 `a8be87bf08d278bf85f7cbb83a361c451afecd62`，正式 CLI 的 compile→prepare→verify→approval-draft 全部在无 Key、禁止网络环境中通过。新轮次 `wanx-color-contrast-20260912-02` 的清单摘要为 `36abe181c6dbe43f951fb80e118c03eb0ddb38b9acc46b9b3784184d265038f4`，草稿摘要为 `b52bdba5f985569ac357b12d2e04a551383ec5162b7f81b1107e890900056f8c`，审阅包摘要为 `0cb0bab6e40292822f9ea1dbfbc5be2506969ef652d5ed1b09789afdc9685c55`。
- 对照建议仅一张 FULL_EDIT：参考报价仍为 CNY 0.14，单次授权上限 CNY 0.25；即使首笔临时账单为零，仍保留它的 CNY 0.25 最大授权额，两笔保守累计 CNY 0.50，低于原整轮 CNY 1。原任务和旧 claim 不重发/不重置；准备结束时新对照尚未获精确一次性批准，INPAINT 也没有批准或领取。此次只验证颜色描述这一输入变量的效果，不将候选假设称为已修复原因；后续批准与执行结果见下节。
- 新跟进清单绑定 109 个文件，摘要为 `8c9f09df67913d8a1324765fccb493bc5e49cdc3c67927b37782fb55517505b4`；JSON、摘要及凭据模式检查通过。本节准备阶段新增真实图像请求为 0，累计创建总数仍为 1；没有解密 Key、修改产品源码、改动结算合同、写入 ERP/Ozon、部署或推送。本节完成 T3 真实用量/原生账单映射与离线对照准备、T0 真源更新；最终账单、改色质量及正常 ERP 验收仍未关闭。

### 颜色对照 FULL_EDIT 实测（2026-09-12）

- 用户引用上一节固定范围后明确回复“批准这一次颜色对照”。本次一次性授权绑定同一已核验 Key、白杯源图、Wanx 2.1、冻结代码和清单 `36abe181c6dbe43f951fb80e118c03eb0ddb38b9acc46b9b3784184d265038f4`，仅执行一张 FULL_EDIT，并允许同 task 查询、下载和账单只读核对。实际批准文件 SHA-256 为 `17101b68b12cea78865ac6466f628b0e9ab60148cff049398aeaa55fb8c4e4b3`，发包前已通过冻结源码 verifier；不是第三笔或 INPAINT 的授权。
- 执行继续使用 clean `a8be87bf08d278bf85f7cbb83a361c451afecd62` worktree。北京时间 16:45:38.762 至 16:46:06.517，耗时 `27755 ms`，创建 **1 次**、同任务 GET 轮询 **5 次**、下载 **1 次**，进程退出 0、stderr 为空；无重试。技术结果 `SUCCEEDED`，输出一张 `1024×1024` PNG、`941291 bytes`，图片 SHA-256 为 `2be3fed009c701e2ac3ffad3665fa5d2b1600f02312b7eb67da5db1eaad70ea6`，Provider task ID 摘要为 `59010e87b02b756ef2919454db0045aa3e62bac735f4e73f9a704c5709a956d7`。报告与 trial evidence 的摘要绑定通过，后者 SHA-256 为 `8b79f2ab2ce120d5b25f728b481443fb8c4a798a94cdc5e0aa08e0a3fe10cdd7`。
- **背景改色与主体保持均未通过。** 主 Agent 重新对照原图和结果，并核回独立视觉 Agent 的完成结论：背景及把手孔内仍偏灰；杯身和把手出现青蓝偏色，杯口下移、杯身变矮、把手变窄且外轮廓改变。阴影形状和明暗也有变化；数量仍为一只，未见新增文字、标志或配件。这是 Agent 视觉复核，不是用户质量确认，也不声明逐像素测量或唯一根因。
- 区域采样支持上述颜色观察：对照图左上背景 RGB 为 `[231.51,230.66,228.68]`、上方背景带为 `[228.60,227.74,225.68]`，蓝减红仍分别为 `-2.83 / -2.92`；杯身正面从原图 `[221.76,221.35,221.05]` 变为 `[243.59,248.54,248.70]`，蓝减红变为 `+5.11`。仅将颜色描述明确到 `#D9E5EB` 未使本例通过；一次模型采样不足以排除随机性或确定唯一原因。v1 提示词/合同与历史快照保持原样，后续本地诊断优先评估明确编辑区域或掩码，不自动追加收费改词测试。
- **第二笔用量和费用仍待回显。** 北京时间 17:02 的指定 Key 查询已完成，仍为 `callSuccessCount:1 / image_number:1`；月汇总明细仍仅一行“免费额度 / 后付费 / RequireAmount:"0" / BillingQuantity:"0" / CNY”。此前已取得的原生账户/Key/业务空间/模型/计费项映射有效，但这次观察没有反映第二笔，不证明两笔均免费。该月汇总行不含图像 task ID，也没有两笔各自的最终费用；不按次数均摊或把报价写成实收，两份原报告均保留 `actualCost:null` 和待对账状态。继续按[原生计费边界](../docs/runbooks/ai-image-provider-sandbox-billing.md#native-wanx-task-association-and-settlement-boundary)核验延迟、完整关联与最终性。
- 新 Key 累计真实创建 **2 次**，两次均未重试，两个执行目录都仅有原 `round.json` 和 `FULL_EDIT.claim.json`；没有 INPAINT claim。两笔各 CNY 0.25 的授权上限保守累计为 **CNY 0.50 / 整轮 CNY 1**，首笔临时免费不释放预算或已消费的 claim。这是授权上限累计，不是实际费用，也不是已验证的 Provider 端硬限额。
- 第二次质量记录 SHA-256 为 `4f7d1682cb899e0a7875c8a0ef6c959c7a56b00785d8010f72a7f1e456139f03`；新增独立执行证据索引绑定 **138 个文件**，SHA-256 为 `0ed7896d6059d8101a927563a9b1855a21f3eb4f1fa2386beba658daddb0b29c`。旧 80 项、109 项索引及其全部文件摘要均重新匹配，没有覆盖原回执；私有目录 ACL、JSON/图片摘要、审批与 claim 绑定和冻结 checkout clean 状态已复核。原始签名下载 URL 仅保留于受保护私有证据，未进入 Git。
- 本节验证为 T3 真实请求/质量/账单观察与 T0 真源回写；收尾的 33 个本地链接、21 个锚点、证据摘要引用、新增文档凭据模式检查和 `git diff --check` 均通过，不重复无关全套门禁。主仓库基于文档检查点 `944e1ce9` 收尾，产品源码与冻结执行版本没有变化；未接收图片进 ERP、绑定草稿、晋升能力、执行 Ozon 写入、推送或部署。正常 ERP 任务来源、质量、完整任务—账单关联、QA-02 与正式 QA-04 仍未通过。

### 剩余五项的执行入口

| 项目 | 已有入口与本轮进展 | 下一步必需的输入或授权 |
| --- | --- | --- |
| Provider 费用账户与 pilot | Xiaoyi 单张已完成[离线凭单对账](../docs/runbooks/ai-image-provider-sandbox-billing.md#xiaoyi-console-bill-and-account-credit-review)，原审批币种差异保留；新 Wanx 两笔 FULL_EDIT 技术成功、改色均未通过，颜色对照另有主体变化。原生计费实例映射已取得，17:02 用量仍为一次/一张、临时账单免费额度/应付零，第二笔未回显，具体证据见上节 | 保留两笔 task、占位和图片，不重发；继续只读核验第二笔用量、完整任务关联与最终结算，本地优先评估编辑区域/掩码。任何新真实请求仍需独立精确批准。正常 ERP 任务来源、旧 Wanx 三笔账单、完整 QA-02 与能力晋升仍未关闭；无需重新索取 Key/整轮预算或查询 Xiaoyi 旧金额 |
| Ozon 测试店与商品事实 | 归档参数/主图/私有准备包齐备；审核任务 500 源码修复及两种 rollout 的完整 PostgreSQL 隔离链路通过；线上临时配置已恢复 | 按发布门禁部署修复后重验 ERP 审核草稿。DOTH 样本有 FBS 库存，真实专用测试隔离仍未成立，本地测试不能授权 import/archive |
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
