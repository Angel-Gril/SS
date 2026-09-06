# SS ERP 接管与加固验收

## 验收门禁

| 门禁 | 需要的证据 | 状态 |
| --- | --- | --- |
| 当前状态审计 | `current-state-audit.md` 与当前 Git/命令一致 | 已确认 |
| 文档索引 | active、stale、public、internal 已区分 | 已确认 |
| agent 宪法 | `AGENTS.md` 绑定真实 owner 和命令 | 已确认 |
| owner map | `architecture.md` 记录当前与目标 owner | 已确认 |
| 启动基线 | local env 校验、DB/Redis、Web/API 首屏 | 部分：local env 校验与本地 PostgreSQL/Redis 健康检查、Chrome CDP Web smoke 已通过；本轮未重启完整 API/Worker |
| Git 隐私 | `.env` 未跟踪，阶段按路径提交 | 已确认；远端 visibility 未验证 |
| AI 债务 | 超大 owner、静态 UI 合同、preflight 成本已分类 | 已确认 |
| 第一个安全任务 | 范围、owner、RED/GREEN 和停止条件明确 | 已确认 |

## 证据记录

- 文件路径：根 manifests、`apps/`、`extensions/`、Prisma、CI、公开 docs 和本目录。
- 命令：`pnpm typecheck`、server typecheck、server build、Web build 通过；server tests `5164 passed / 223 skipped`；扩展 CDP 合同 29 条通过。
- 格式：workspace lint `0 errors / 0 warnings`；Prisma `validate` 与 `format --check` 通过。
- 环境：先复现 local env 8 项失败；运行 bootstrap 后 `pnpm env:check -- --profile local --env .env` 为 0 failure。Docker PostgreSQL/Redis 已无损重建并保持 healthy，主机端口只发布到 `127.0.0.1:5432/6379`；本地 compose 网络安全合同 `1/1`。
- 供应链：npm 官方 audit 已降为 `0 high`，剩余 `2 moderate / 2 low`；CI audit/Semgrep 为阻断门。
- 数据库证据：148 migrations；本地 `prisma migrate status` up to date；隔离 PostgreSQL runner replay 全部迁移并通过 103 个物流/设备/来源/发布测试；普通 suite 的 PostgreSQL 文件按显式 runner 执行。
- 已运行本地 Chrome CDP `/login` smoke；未运行远端/生产 smoke、Provider/Ozon 写入、部署和扩展 live worker smoke，因为这些仍需独立环境/授权。
- 历史认证/CDP 工作线在 HEAD `196d11dc` 的 dirty worktree 上通过完整 `pnpm preflight`、生产构建、Web lint/typecheck 和 12 条聚焦契约；该行保留为历史证据，不代表当前 Git 状态。本地 `/ready`、登录/注册桌面与 390px 移动视图无横向溢出。cloud-like 本地进程使用合成 PoW secret 实测登录/注册 pending-to-ready 与登录重新验证；Cloudflare 官方测试 key 实测 Turnstile 登录/注册成功回调，以及 `600010` 失败、按钮保持禁用和显式重试。官方测试合同核对于 2026-09-05：`https://developers.cloudflare.com/turnstile/troubleshooting/testing/`。
- 扩展 source verifier 为 `459 pass / 0 failure / 0 warning`；普通 cloud/local package verifier 分别为 `464/0/0` 与 `460/0/0`，绑定正式 origins 后的 cloud/local verifier 分别为 `471/0/0` 与 `461/0/0`，严格发布打包合同通过。`web_accessible_resources` 已收紧到实际 ERP/marketplace 来源，未使用的 `file:///*` 已删除；打包器与 verifier 共用同一 marketplace WAR 来源策略。CDP launcher 合同 `7/7`，默认只打开 `about:blank`，拒绝带 query/fragment 的回显 URL，并在启动或 worker 验证失败后终止本次 Chrome、清理 launcher 自建 profile。当前机器没有受管扩展 ID `nkkemglcckgmhmcfnjjmcfbdhciafahl` 的安装目录，因此真实 active worker attestation 仍需在受管安装完成后执行。
- 受管扩展自动探测（2026-09-05）：`setup-cdp-chrome.js 9222 --detect-only` 返回 `CDP_STATUS=needs-setup`、`CHROME_RUNNING=yes`、`CHROME_PID_COUNT=50`；现有 Chrome 进程没有 `--remote-debugging-port`，Chrome/Chromium 用户数据、Program Files/ProgramData 目录和 Chrome 外部扩展注册表均未找到固定 ID `nkkemglcckgmhmcfnjjmcfbdhciafahl`。本轮未结束现有 Chrome，也未启动替代 profile；仍需受管安装目录和独立 CDP 启动授权。
- 受管扩展诊断合同已加入 `pnpm diagnose:extension:managed`：自动扫描标准 Chrome/Chromium profile、拒绝 symlink/unbound unpacked 目录、校验 MV3 manifest/worker、可选派生稳定 key 的固定 ID，并仅探测 loopback CDP 版本端点。当前实际诊断结果为 `EXTENSION_STATUS=MISSING`、`CDP_STATUS=NOT_FOUND`、退出码 2；该命令不会结束现有 Chrome 或修改浏览器配置。
- 本轮安全修复已按顺序推送：`96dfe6ad` 收紧图片/视频/rich-content SSRF；`8e16de4e` 增加 PostgreSQL AI quota reservation、类目翻译每请求最多 20 项和未知结果保留额度；`95a22ed8` 增加 source listing durable operation claim；`ed0841ac` 固定 CI Actions SHA 并限制 workflow token；`73b46b59` 修正跨实例 claim 回归测试时序。最终 `pnpm preflight` 退出码为 0。
- 全局用户级工具只读扫描（2026-09-05）：`C:\Users\550W\.codex\skills` 有 654 个 `SKILL.md`，顶层 45 个技能入口是指向未授权 `C:\Users\550W\.cc-switch\skills` 的符号链接，未跟随读取；`C:\Users\550W\.agents\skills` 有 19 个本地 `SKILL.md` 且无符号链接。授权目录内未发现实际用户设置文件，只有 `story-setup` 的 `settings-hooks.json` 模板和 Hook 脚本。gstack Hook/脚本具备条件式 `git pull --ff-only`+`setup -q` 自动更新、遥测 POST、读取 `~/.codex/sessions`、写入 `~/.claude/settings.json` 和本地问题日志的能力；这些均未在本轮执行，实际是否启用仍需读取对应用户配置并另行授权。`story-setup` Hook 模板主要读取项目状态，`session-end` 仅在 `STORY_SESSION_LOG=1` 时写入项目追踪日志，提交校验为 advisory-only。
- 当前代码与文档同步：stage-9 扩展检查点为 `af653843`，备份 retention 修复为 `d2293bc9`，签名轮换与最终运行态回写为 `be6a6374` 及其后续文档提交；本段文档同步后工作树应恢复干净。
- 日本/COM VPS 部署验收（2026-09-05）：严格 host-key SSH 到 `45.76.49.64` 成功；current 已切换到 `be6a63747877ec1f130b7eee6f2f58f39f9b8bf8`，extension `1.0.313` 使用新 key `ss-erp-extension-release-2026-09-05-01` 完成签名和部署。已生成 `/var/backups/ss-erp/ss_erp_20260905_145638.sql.gz`（47,643,443 bytes），临时恢复库检测到 142 张表后删除，目标 attestation 已绑定新 commit；2 个 Prisma migration、API/Web/Worker、数据库、Redis、Nginx/UFW、本地及公网 `/ready` 均通过。AI Media/BYOK policy 仍为全暗态，网站 pointer 保留已批准的 `1.0.311`，不提前发布新扩展；正确的暗部署期望下完整 verifier 为 `0 failure / 1 warning`，唯一 warning 为未配置远端备份。
- 当前候选 cloud/local 均为 193 文件，正式 release verifier 为 `471 pass / 0 failure / 0 warning`；签名 SHA-256 为 `42eace8744b053a5bba88790420e4275a4504b88da6fe490e377a0b64f53d334`。未执行 Provider/Ozon 写入，也未产生 Provider 费用。
- 受管扩展 live smoke（2026-09-06）：找回历史固定路径 `C:\Users\550W\AppData\Local\SS-ERP\managed-extensions\cloud-com\ss-erp-cloud`，同路径升级到 `1.0.313` 后固定 ID `nkkemglcckgmhmcfnjjmcfbdhciafahl` 保持不变。active-worker receipt SHA-256 为 `3abb80bff314d29c87922e847e64d9a4404f91cec0182cedbc4831221e872337`，Unicode smoke receipt SHA-256 为 `f218dbf42be0684fee0950e29354b2cc609fa97c25bc1eaddf33143c3aec532c`；专用 Chromium CDP 已关闭，普通 Chrome 未关闭。
- 扩展页面隔离 smoke：Provider 非密档案保存成功；合成 sentinel key 只进入当前会话，输入框立即清空，DOM/localStorage/sessionStorage 均未发现 sentinel，清除会话后恢复未加载。工作台 390px viewport 无横向溢出，暗态下发布/任务/生成按钮保持禁用；截图和回执保存在用户私有 `C:\Users\550W\AppData\Local\SS-ERP\private\rel04-be6a6374\live-1.0.313`，未产生 Provider/Ozon/ERP 写入或 Provider 请求。
- Provider/Ozon 只读证据：VPS 历史 sandbox 显示 `TEXT_TO_IMAGE` 成功并结算 CNY 0.0119，三次 `IMAGE_TO_IMAGE` 均明确拒绝且结算零费用；DashScope 英俄图片翻译有成功结果但仍无结算费用。当前 server Provider 为 `custom / gpt-image-2`、API key revision 2 存在但价格未配置。Ozon 有 15 个 ACTIVE/5 个 DISABLED 店铺；pilot 绑定店铺有凭据但没有专用测试店铺标记，禁止据此执行 sandbox 写入。
- Provider/Ozon 最新只读验收：日本 VPS 以当前部署 `be6a6374...` 的加密配置执行 Xiaoyi 双域 GET-only 预检，7 个 GET 全部通过，`gpt-image-2` 可见，前后计量响应未变化；证据 manifest SHA-256 为 `023e1d23e4a9de4cf21df23d7abfd8db2f2626531217117c915fb128ae676d17`，`providerPostSent=false`、`chargeObserved=false`，证据目录为 `/opt/ss-erp/shared/ai-image-sandbox/qa02-xiaoyi-readonly-evidence-20260906-be6a6374-01`。Ozon 服务器侧 Seller Info 只读检查绑定店铺哈希 `152cd1b068448e7dc675d259a1ddcfc23e67badc58ac62af9734554a18d9aab5`，返回 HTTP 400 且无 seller 信息；未发送商品/草稿/发布写入。当前仍有 15 个 ACTIVE、5 个 DISABLED 店铺，0 个专用 sandbox/test 配置标记，Ozon 写入继续禁止。
- 受管扩展 ACL 收紧（2026-09-06）：活动 COM 路径及 228 个子项禁用继承，仅保留当前用户 `MOSS\\550W`、`NT AUTHORITY\\SYSTEM` 和 `BUILTIN\\Administrators`；未发现额外主体或 reparse 点，诊断器仍返回 `FOUND / CHROME_STABLE_PATH`。

## 第一个安全任务

- 任务目标：建立内部真源和阶段边界，使后续 P0 修复可以按独立 owner 验证、提交和回滚。
- 为什么足够小：只新增项目规则和内部文档，不改变产品、API、schema 或运行行为。
- 触碰 owner：`AGENTS.md`、`dev-docs/`。
- 不触碰内容：用户当前验证码/CDP 改动、公开文档、生产状态和凭据。
- 验证方法：adoption/constitution/stage guardrail、链接与 diff 检查。
- 停止条件：guardrail 发现占位、owner 冲突、私密内容或当前用户改动混入 staged scope。

## 分层完成标准

- 阶段 1：已完成，内部真源 guardrail 与 local env 校验通过。
- 阶段 2：已完成。固定 seed 凭据删除；cloud/production 禁止 Noop Redis；水印/上传/缩放 URL 统一受公网或受控本地 reader 限制；负例与全量后端回归通过。
- 阶段 3：已完成，高危生产依赖已降为 0 high 并阻断，CI audit 可执行且阻断，关键 PostgreSQL integration 有隔离 runner，schema format 检查通过。
- 阶段 4：已完成，`collect.ts` 标题 owner 已拆分；本地 Chrome CDP Web 最小 smoke 通过。
- 阶段 5：已完成，Redis 上传限流原子化、故障失败关闭、生产审计默认开启，支付配置/人工充值审计覆盖已补齐。
- 阶段 6：已完成，server lint 为 0 errors / 0 warnings。

## 当前发布边界

- 当前结果：`可继续开发`，不是 `可发布`。
- 本地代码、CI、隔离数据库和 server/Web 构建证据已收口。
- 本地认证 challenge、扩展静态/package 权限、SSRF、AI quota、跨实例 operation claim 与 CI 供应链门禁已收口；受管扩展 live worker 仍未验证。
- 生产部署、真实 Provider/Ozon、线上健康、Redis 集群与外部告警、CN 远端备份仍未验证。

## 停止条件

- 接管完成条件：adoption 与 constitution guardrail 通过，owner/验证/阶段真相可由后续 Agent 直接消费。
- 不能继续开发的条件：P0 负例无法先 RED、owner 不清、测试与代码事实冲突，或不能隔离用户现有改动。
- 必须问用户的条件：需要产品行为改变、生产访问、真实费用、凭据、数据迁移、停机、公开发布或删除旧接口/文档。
- 不能发布的条件：高危供应链门禁失败、集成测试/构建未完成、Git scope 不清、生产/浏览器/Provider/Ozon 证据缺失。

## 漂移检查

- 是否把现有项目当空项目重写：否，沿用当前组合与 owner。
- 是否跳过了内部真源：否，本目录为当前索引。
- 是否无确认改写了宪法或文档结构：否，用户明确要求按审计流程实施。
- 是否保留了旧概念污染当前主线：历史计划保留但不作为当前状态 owner。
- 是否出现多个 owner：未发现新的重复 owner；后续拆分必须保持薄 route/adapter。
- 是否用测试通过冒充用户验收或发布准备：否，生产、浏览器、Provider/Ozon 与发布均标记未验证。
