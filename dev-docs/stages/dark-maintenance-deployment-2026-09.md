# 全暗态维护部署（2026-09）

## 阶段目标与用户流程

将本地已完成的管理员模板来源接口部署到 COM/CN，供现有超级管理员只读验收。新增独立维护验收类别，允许完整 QA-02 尚未完成时使用目标提交的完整 offline rehearsal；维护通过不代表正式 QA-04、REL-04、图片能力或官网发布通过。

操作员确认范围 → 实现原生离线回执和维护门禁 → 冻结验证代码 → 生成区域候选及签名 → 目标数据库备份/临时恢复 → 保存旧官网身份与暗态基线 → 原部署入口依次部署 COM/CN → 完整 VPS 验证及维护 GET 探针 → 保存维护结果。API/Worker/Web 重启可能短暂中断。

## 当前真相与 Owner

| 概念 | 唯一 owner | 调用者与消费者 |
| --- | --- | --- |
| 九项离线门禁与原生回执 | `scripts/qa04-offline-gate.mjs` | 原 QA04 CLI、维护验收；旧默认和 list 模式保持 |
| 维护类型、备份绑定、前后基线与只读验收 | `scripts/dark-maintenance-deployment.mjs` | 维护 CLI；仅消费已有候选签名、原生备份验证、完整 VPS 结果 |
| 签名、VPS 候选身份、暗态策略 | 既有 `verify-extension-release-signature.mjs`、shared `rel04-release-evidence.ts`、`verify-ai-media-dark-policy.mjs` | 维护入口复用，不修改正式发布合同 |
| 部署与恢复 | 既有 `deploy.sh`、`deploy-backup-gate.mjs`、`verify-deploy-backup.sh`、`verify-vps-deploy.sh` | 维护操作继续执行现有冻结源码、备份、migration、健康和回滚流程 |
| 来源与权限 | `ai-prompt-template-source.ts`、既有 source route 和 `requireSuperAdmin` | 只读两个 source；禁止模板列表的隐式初始化 |
| 正式发布拒绝边界 | REL04 parser、官网 CLI/API、能力候选 verifier | 仅补充维护证据拒绝用例；不接受新维护类型 |

维护源码 `63b98b2c4481f80aa74208186e14552d5070a16e` 已推送；独立 LF checkout 的完整原生 offline gate、最终独立源码审查、两区域 `1.0.327` 候选及签名验证已通过。历史 QA04 和付费状态见 `../current-state-audit.md`，验收底线见 `../acceptance.md`，公开运维入口见 `../../docs/deployment.md`。维护操作继续绑定该冻结提交，后续状态文档提交不替换候选身份。

## 调研决策

- research_status: completed: 已直接比较原 QA04、REL04、官网消费者、备份 gate、source owner；独立只读审查已回收并由主 Agent 复核。
- 同类参考为本仓库已有签名/VPS/暗态及不可覆盖 artifact 机制，复用身份与持久化合同；不复制 REL04 的配对、refresh、DELETE 或 BYOK POST。
- 新入口不引入第三方 API、Provider、数据库或部署拓扑。当前公有 API 和 VPS 运行证据需在实际操作时刷新，不把历史健康记录当作新部署证据。
- 不改变付费价值、金额、预算、退款或权益；四次 Wanx 的 CNY 1 占位、质量拒绝与待结算状态继续保留。

## 范围与非目标

- 允许范围：原生 offline PASS 回执、独立维护 evidence/CLI、负例与对应运维说明、目标候选和签名准备、既有双区域维护部署及只读验收。
- 非目标：开启 AI/Media/BYOK/Ozon、生成或接收图片、创建模板或工作流、修改 schema/权限、官网 pointer 切换、受管扩展升级、Redis 拓扑与远端备份建设。
- 权限不变：模板 source 仍需超级管理员；匿名与普通 ADMIN 应被拒绝。源模板存在时校验发布/checksum/PASS 链；明确无发布记录时只标记来源不可用，通用 404 不能证明新路由可用。
- 官网保持要求：部署前后比较相同 commit、version、approval 摘要及 cloud/local 下载摘要；另一旧版本或丢失 pointer 都失败。

## 子阶段计划

| 子阶段 | 结果 | Owner | 完成标准 | 验证 | 不触碰 |
| --- | --- | --- | --- | --- | --- |
| MAINT-01 | 独立回执和维护门禁 | QA04/维护 owner | 正式消费者拒绝维护类型，探针不创建业务/设备状态 | T2 RED→GREEN；类型、lint、受影响回归 | 生产、开关和 schema |
| MAINT-02 | 冻结 clean commit 和区域候选 | 既有打包/签名 owner | 完整离线回执、双区域包和签名绑定同一目标 | 完整 QA04、候选/签名和隐私验证 | 官网 pointer 和真实生成 |
| MAINT-03 | 依次部署 COM/CN 并维护验收 | 既有部署/备份及维护 owner | 前一区域通过后进入后一区域，失败恢复原目录 | 当前备份/恢复、完整 VPS、旧官网身份和 source 语义 | 正式 QA、业务开关和商品数据 |
| MAINT-04 | 真实结果回写和阶段推送 | 本阶段与 current-state owner | 证据绑定且私有材料不入 Git | 字节摘要、Git、临时会话/恢复库清理和回执读回 | 历史证据、Provider 质量结论 |

## 测试、安全与影响

- D2：新维护合同与既有离线生产者必须闭合同一证据；沿用现有基础，不设计新的依赖拓扑。只读审查与实现可独立；每个文件只保留一个写入者。
- 本地实现按 T2：先验证缺失回执/错误类型、脏工作树、错 commit/区域/签名、未来或过期备份/VPS、指针漂移、模板权限/来源错误、非 GET/重定向/过大响应及凭据泄漏拒绝，再实现。
- T1：既有原生备份、发布、源模板 parser 的语义保持，先建立原门禁基线；T3：新候选、真实备份/恢复和两地只读路径，以新运行结果验证。
- 维护探针零业务写入与部署副作用分开记录；后者包含停服、备份/临时恢复及既有 migration 检查，不能称为整轮零写入。
- 每个子阶段通过对应验证后按明确文件提交，禁止混入 `.env`、私钥、生产原始回执、构建或浏览器 profile。

## 验证方法

先运行 QA04 producer 与维护 CLI 的真实文件/HTTP fixture 测试，再复核正式消费者拒绝、原备份/签名合同及类型/lint。最终以新 clean commit 运行完整 offline gate，分别验证区域候选；生产只通过现有冻结源码和备份恢复入口，保留新鲜完整 VPS 与维护 GET 回执。

## 停止条件与未验证

只访问批准区域的签名 origin；先验证冻结证据再读取凭据或发起请求；GET 白名单、15 秒超时、响应大小限制、拒绝重定向、脱敏摘要与不可覆盖的私有输出。备份绑定必须由原 verifier 对同一数据库/UUID/目标 commit 验证并保持默认 120 分钟时效。

任何错误候选/签名、失效备份、非暗态、官网身份改变、维护类型进入正式消费者、无法恢复原版本或新的迁移/停机/费用后果均停止相关操作。本维护范围已完成双区域部署与真实只读 source 验收；Provider 质量、账单最终性、QA-02/正式 QA-04 和正式 REL-04 仍未完成。

## 阶段控制

- schema: sliver-stage/v2
- stage_id: dark-maintenance-deployment-2026-09
- primary_route: 开发执行
- operation: implement
- delivery_kind: behavior_verification
- task_depth: D2
- materialization_trigger: ["cross_owner_drift"]
- risk_lanes: ["identity_permission", "privacy_secret_data", "resource_reliability", "supply_chain_config"]
- evidence_mode: test
- test_level: T3
- route_evidence_kind: null
- effect_class: controlled
- operational_mode: planned
- scope_authorization: confirmed: 用户引用完整维护提案后明确“批准 继续”，覆盖所列维护实现、候选及原部署范围。
- authorization_substage: MAINT-04
- product_decision: confirmed: 允许全暗态维护先于完整 QA-02/正式 QA-04，保持官网和功能关闭。
- active_substage: MAINT-04
- result_status: completed
- truth_writeback: complete
- migration_state: not_applicable
- evidence_refs: [dev-docs/current-state-audit.md, scripts/qa04-offline-gate.mjs, scripts/dark-maintenance-deployment.mjs]

## 实施回写

- actual_result: MAINT-01 至 MAINT-04 完成；COM/CN 均运行冻结提交 63b98b2c，签名、目标备份恢复、完整原生 VPS、各 46 个 GET 维护验收、临时凭据清理及最终运行/官网身份读回均通过，证据索引与真源已回写。
- changed_owners: qa04-offline-gate、dark-maintenance-deployment、对应测试与 package/preflight 入口；公开部署步骤和架构索引同步。
- plan_deviation: 使用现有原生备份 verifier，不复制备份规则；source 复用真实 parser，保持已批准的明确缺失来源分支。未改原部署/签名/权限/schema 实现。早期实现审查因限流失败的记录保留；冻结提交与接受输入上的最终独立源码审查已完整回收，主 Agent 已对当前 owner、测试与 Git 复核。
- fresh_evidence: maintenance 51/51、QA04 producer 24/24；REL04 23/23；官网 API/模板来源 49 passed/3 条 Windows 条件 skipped；原生备份/VPS/官网/能力合同组合 73 passed/6 条平台 skipped。目标提交完整 offline 九项通过（后端 5822 passed / 258 条条件 skipped），最终独立源码审查通过；两地完整 VPS 均 0 failure / 1 warning，两个 source 均 AVAILABLE，各 46 个 GET 维护验收通过。新行为保留 RED→GREEN；收口文档按 T0 读回、链接、隐私和 diff 校验。
- remaining_risk: Provider 图片质量、正式账单、正常 ERP 完整业务链、QA-02/正式 QA-04 与正式 REL-04 未完成；四次 Wanx 的 CNY 1 占位不恢复。两地远端备份仍按既有决定未配置，Redis 副本/集群及专用告警未新增。
- next_substage: 无，本维护阶段已收口；后续回到生图与计费阶段的离线质量诊断及原账单观察，正式账单最终性不早于 2026-10-03 12:00（北京时间）复查。
- git_checkpoint: 运行源码 63b98b2c4481f80aa74208186e14552d5070a16e 已推送；阶段状态和操作说明独立提交，不改变冻结候选身份，私有回执和凭据不入 Git。

## MAINT-02 执行记录

- `21004dc0` 已建立独立 clean worktree，锁定依赖全部离线安装，Prisma Client 使用原 schema 生成。首次完整离线回放在扩展 Ozon runtime 合同停止，未生成原生 PASS；日志 SHA-256 为 `489a27889dc518bcf0537e2305d39b9ccb0860f1d3861afc6440afa65570accb`。
- T1 根因：独立 Windows checkout 的三份扩展源文件为 CRLF，原测试使用双 LF 文本分隔符截取函数；与主工作区规范化后的源码摘要逐一相同。测试读取端统一行尾后，直接对原 CRLF checkout 和主工作区分别运行，18 项均通过，未修改扩展运行代码。
- 附加运行时 fixture 核对发现物流规则测试缺少浏览器原生 `AbortController`/timer globals，3 个场景在运行前失败。补齐 VM globals 后 23 项通过；其他受查 runtime 文件通过。两项修复仅影响测试 fixture，保持原业务断言和限制。
- Windows 全局 `core.autocrlf=true` 与根进程中的本地 API env 曾分别触发旧文本合同和云包 HTTPS 检查。最终使用新建 LF checkout，并把本地数据库/Redis 配置与 server dotenv 限定在对应进程；失败日志完整保留，不作为通过证据。
- `63b98b2c` 的九项完整 offline rehearsal 于 2026-09-14 15:12 UTC 通过：后端 5822 passed / 258 条条件 skipped，PostgreSQL scope 7 项、AI Media 集成 131 项及升级回放、Server/Web 构建与 cloud/local 扩展全部通过。本次四个隔离测试 schema 均已删除；未清理其他历史测试 schema。原生回执 SHA-256 `9a5d70e97aced49d17205995280756ff6194f6d1e75838357e81b0bdfbfaf524`，完整日志 SHA-256 `35a228ad1b7985a91fdfa81ccdf560d70bb89d09c6ef08f7bb24a0377e28c2f9`。
- 最终独立源码审查绑定同一提交与接受输入 SHA-256 `f535948dd174710e5794ba30e6320c174fc6fc03fccb0f1badf98699817add76`，结论无阻塞；形式化候选记录和独立协调上下文通过校验。该结构校验不表示宿主 Hook 已自动强制执行。
- COM/CN `1.0.327` 均从冻结 Git blob 打包并通过完整归档、四件套暂存与签名验证；使用现有 `ss-erp-extension-release-2026-09-05-01`，未轮换密钥。COM evidence/signature SHA-256 为 `69afa640263e6f4361b442f5d3e157235fe17879e1748e055148ba3b099020de` / `c83bfe718b809bc2f550496b51c6fe3c0fdda806e1a28994a441cdd37b12d453`；CN 为 `1145d7cd213f106e0a868a671d8fe373e37c6f005cc6b1424e7e59996a3ce35e` / `a39fa8257fca722635f9193a20812c3a4cfc2fdae3fb9dce2d01c08ae0d8e76d`。

## MAINT-03 执行记录

- 新鲜环境核对：COM env 的存储兜底为 `ozon-cdn`，使用现有 `cloud-bootstrap` 校验；CN 为 OSS，使用 `cloud-r2` 校验。两地原配置均保留，未把后台 OSS 配置与 env 兜底混为一体；现有环境 warning 保留。
- 工具副本由精确 Git blob 导出，上传摘要核对通过。Windows tar 解包后的 group/world 写位已在独立 root 工具目录收紧，再通过原可信 keyring 检查；没有修改当前服务目录。
- COM 已完成目标提交备份及 144 张 public 表的临时恢复，恢复库已删除并只读确认。原生认证摘要 `eb666d929a9c3ab6759d00be2e59dc1a530f72743e60a20f8c1c21b0d4e9eda8`；维护绑定实际调用原 `verify-deploy-backup.sh`，保留 120 分钟期限。
- COM VPS 的 Node `22.22.1` 构建缺少 TypeScript 运行支持：默认加载返回 `ERR_UNKNOWN_FILE_EXTENSION`，显式 strip-types 返回 `ERR_NO_TYPESCRIPT`。已用当前部署内锁定安装的 `tsx` loader 实际加载同一 shared 合同成功；仅维护工具进程使用该 loader，生产服务配置不变。首次绑定失败日志保留，后续原生绑定成功且未重做已通过的备份恢复。
- COM 部署前维护 GET 基线已通过，保存原官网 `1.0.316` 的完整身份；短时超级管理员会话已撤销。
- 阶段文档的 `controlled` execute gate 明确要求独立动作门禁，不能把阶段范围当作部署授权。此次沿用会话中已明确批准的维护目标及副作用，单独验证实际 COM 目标、恢复和健康/停止控制的 effect 记录，并通过维护范围的 release-readiness 校验；没有把阶段文本或结构校验当作新用户授权。
- COM 原 `deploy.sh` 于 2026-09-14 16:04 UTC 成功切换到 `63b98b2c`；区域包在构建前后均完整复验，源码已封存，migration 无待执行项，后置数据库/暗态 gate、systemd 切换和健康检查通过。原回滚目录保留。
- 首次完整 VPS 检查为 0 failure / 1 warning，但因从 `current` 逻辑路径启动，回执导出器入口比较未匹配，未生成文件；该运行不作为完整维护回执。只读无参数诊断确认逻辑路径 exit 0 且未进入口，实际发布路径正确进入参数拒绝分支。随后从同一提交的实际发布目录重跑完整 verifier，仍让 `DEPLOY_DIR` 监视 `current`，并增加非空回执检查；不手写或拼接 PASS。
- COM 第二次完整 VPS 取得原生回执，0 failure / 1 warning，唯一 warning 为远端备份未配置；回执 SHA-256 `3ed80889734c2a5e8357d8c3cc3c11030c9847b9fe724f843db5defede91467a`。维护验收 SHA-256 `46fe28896d264766b1eaf01bb3de8c3b9353a20db7a65906ed343bf5445c090a`：46 个请求均为 GET，两个 source 均为 `AVAILABLE`，匿名拒绝，暗态与原官网 commit/version/approval/cloud-local 摘要全部保持。
- COM 验收前，本地操作封装漏带 package 命令已有的 `tsx` loader，随后一次网络失败以及 Windows trace loader URI 格式错误均保留失败记录。未证实该次网络失败的底层根因；最终使用原 CLI/loader 与仅记录路径、状态、耗时的旁路跟踪完整通过，未调整 15 秒限制或来源/权限规则。所有五次临时会话均已确认失效，明文 token 与临时会话引用已清理，临时恢复库数量为零。
- CN 备份配置使用 Shell 转义，已按原 runbook 的 shell source 语义加载，不用 Node dotenv 解析替代；首次拒绝发生在备份写出前。随后目标备份、143 张 public 表临时恢复及原生绑定通过，恢复库删除已确认。CN 部署前 42 个 GET 基线通过，官网保持 `1.0.311`，临时管理员会话已撤销；COM 完整通过后才开始 CN 原部署流程。
- CN 原 `deploy.sh` 于 2026-09-14 16:48 UTC 完成；migration 无待执行项，后置数据库/实际存储/暗态 gate、systemd 和健康检查均通过。完整 VPS 验证含四个 `.cn` HTTPS host，结果 0 failure / 1 warning；原生回执 SHA-256 `82a553f184550d971edf6fa343cbd0aacac3a3520e6850d4ca52041f673de365`。维护验收 SHA-256 `57012c17e26c1aaf727759529d3e4fda0b3514db8fa16d8b991a84fad72f0249`，46 个 GET、两个 source AVAILABLE、匿名拒绝、旧官网完整身份和暗态保持。

## MAINT-04 最终收口（北京时间 2026-09-15）

| 区域 | 运行提交 | 官网扩展版本 | 模板来源 | 完整 VPS | 临时会话/恢复库 |
| --- | --- | --- | --- | --- | --- |
| COM | `63b98b2c` | `1.0.316`，原身份不变 | 两个均 AVAILABLE，匿名拒绝 | 0 failure / 1 warning | 0 / 0 |
| CN | `63b98b2c` | `1.0.311`，原身份不变 | 两个均 AVAILABLE，匿名拒绝 | 0 failure / 1 warning | 0 / 0 |

- 最终只读盘点确认两地 API/Worker/Web 均 active，MainPID 的工作目录分别匹配原 systemd owner 的目标 `apps/server` / `apps/web`，公网 `/ready` 为同一目标提交且 DB/Redis 正常。原回滚发布目录仍在；官网 commit/version/approval/cloud-local 摘要再次与基线逐项一致。
- COM 五次、CN 两次临时会话均已确认失效；明文 token 和临时会话引用已清理，两地临时恢复数据库均为零。原始失败/成功日志、签名、备份认证和正式消费者隔离证据保留在私有目录。
- 通过原生 parser 复核 offline、签名、备份、baseline、VPS 和维护验收的身份/时间/字节绑定后生成只供索引使用的 `MAINTENANCE_COMPLETION_EVIDENCE_INDEX`，SHA-256 为 `6a4eb02e551b2bc45adea88d03aee6bd20cd9acc207f1deeed733e0dbeb5481d`；索引不替代任何原生门禁回执。
- 本轮实际执行了构建、签名、备份/临时恢复、维护停服重启和部署；没有发送 Provider 生成或 Ozon 写入，没有初始化/发布模板、创建工作流、接收图片、切换官网 pointer 或升级受管扩展。AI/Media/BYOK/Ozon 保持原暗态，维护通过不晋升正式 QA、账单或图片能力。
