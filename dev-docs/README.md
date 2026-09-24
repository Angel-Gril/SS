# SS ERP 内部开发真源

## 2026-09-24 双域登录隔离与首页扩展入口（本地待发布）

- CN 首页偶发进入登录页的 owner 根因已确认：`app.ss-erp.cn` 与 `admin.ss-erp.cn` 曾通过 `.ss-erp.cn` 共享同名 `sserp_token`，两端登录会互相覆盖，任一端退出会清除另一端会话。COM 有相同潜在边界，修复覆盖两区，不做 CN 特判。
- 活动账号 Cookie 已改为 host-only；旧 `AUTH_COOKIE_DOMAIN` 仅用于登录/退出时过期历史父域 Cookie。官方及显式配置的自定义 user/admin Web 主机都使用自身 `/api/*` 反代，用户端认证面单下载也复用该 transport；canonical API origin 仍供扩展配对和公开地址使用。live/remote smoke 只接受非空、未过期、无 `Domain` 的活动 Cookie，并用 cookie-only 身份检查防止 Bearer 掩盖问题。首页新增第一方 `/download` 扩展下载入口。
- T2 Cookie owner、认证 transport、smoke 与首页入口均已完成 RED -> GREEN；429 保持会话属于新增基线 characterization，不冒充实现 RED。认证定向 `20/20`、Web transport/dashboard/双域合同、面单与 smoke transport 合同、Web 生产 build、Web/Server typecheck 与定向 lint 通过。COM/CN 管理员域只读探测均为 `/ready=200`、匿名 `/api/user/me=401`。真实 CDP 390x844 首页为 `scrollWidth=390`、零越界、入口可见、零运行时错误。最终完整 Server 套件为 `6332 passed / 325 skipped / 0 failed`。当前尚未提交、推送或部署，COM/CN 生产仍运行 `6e38f907 / 1.0.362`。

## 2026-09-24 `6e38f907 / 1.0.362` 双区官网公开发布完成

- 订单/扩展体验修复目标提交 `6e38f90732d704ccc6d7d596c59d1a1e49592fd4` 已部署到 COM/CN；COM 保持 DOTH 受限 hosted pilot，仅 `IMAGE_TO_IMAGE/SUITE`，CN 保持 direct-origin/RDS、AI/BYOK/Ozon 全暗。双区发布后 VPS verifier 均为 `0 failure / 1 warning`，唯一 warning 仍为远端备份未配置；正式 pre-publication VPS evidence SHA-256 为 COM `ae305fcf312aa34a0d3e7ac05dc7d9b24307c73a2d4c6292ce1d140831280577`、CN `464eab60ed2eaeafbcaa44ab12ede9d1f8caebbbb35d608a6ee0a2413c8da7fc`。
- COM/CN `1.0.362` 候选已改为串行、独立输出目录构建，关闭并行共享 build 状态导致的 `.com/.cn` origin 污染；release evidence SHA-256 分别为 `dc1d00304e362ccd90ba08c94692291cacb30715ee40279fb22888c4fe036496`、`9efbaed9084be4a009056a1f928a2a134091bbc835a60d3cb1e3784fc6f52c3f`，detached signature SHA-256 分别为 `d175afb18f01767ecf08f298f1e143777a80d5aa2bdb4e00712559a07706b2d8`、`79e665ba6244a8fbbac505cba5848f302bee5d65a3be273114d72b19a7adb45a`。
- COM REL-04 v3 restricted-pilot canary SHA-256 为 `ad640caaf20df2d1dd66a0c9f8b8f487b9d6a761746b8197fdafe1de0e020544`；CN v2 no-shop dark canary SHA-256 为 `2eb537e7dce19e11379799c005c0529b668fb60882214546d8946ad2e84f235b`。官网 approval/CAS 分别为 COM `e6ce583821a41384e853c8cd6cfda70c17aa26f3afc2fa2dc45b430385949d1e`、CN `7a4dd5214725235fd54d9dfbb77a5dabf63e7c99be9175b042a5b3fa3afeeeac`；两区 pointer 现均为 `6e38f907 / 1.0.362`。
- 匿名 distribution probe 与正式 final publication verifier 均通过；COM/CN receipt SHA-256 分别为 `34970df0ae279cd0899d8877ebdd3e28f7e85c3ba7b5c4e70b4dc1eb5657a31a`、`b83491cbd214605aa4baa5b68681108f68ad861c117cdffad0bcdcd0c1aee5d6`。本机固定目录从 `1.0.361` 可恢复升级到 `1.0.362`，固定 ID `nkkemglcckgmhmcfnjjmcfbdhciafahl` 不变；明确 reload 后 active-worker 与 Unicode smoke 回执 SHA-256 为 `702e34406593d020be1ff017bda27d81e159339d9e2a3f5c93e77e916cdeee8c`、`93b27833aad8cbf6bd32340a6ee633c6b1adcd6e417251ce0446f591f8ea0302`。Reload 后原 pilot credential 命中 `REFRESH_REUSE_DETECTED` 并由服务端安全撤销；当前 `1.0.362` Worker 已正规重配为 session `689b6f06-c2a2-4086-837e-92867b466870`，修复后 active-worker 回执 `6160ebea9c1d8ce4a17cd7b2316ce3edf3f70bd91a516ab7d0320d26d5802214` 及最终 hosted-pilot verifier 通过。Reload 并发 refresh 的可靠性作为后续凭据生命周期问题处理。
- 本轮没有 Provider POST、ERP ingest、Ozon 写入或新增费用。账号 token 仅在 canary 进程内存中使用，未落盘；COM canary 临时设备已撤销，CN no-shop canary 未创建设备或店铺。

## 2026-09-24 订单与 Ozon 扩展体验修复

- Ozon 选品规则保存已统一经过设备 owner：已配对设备使用 `/api/extension-device/product-selection/rules`，按 `listing:review/listing:write` 校验；只有完全没有设备 authority 的旧兼容安装才回退 legacy ERP token。修复了“扩展显示 ERP 已连接，但保存提示请配置 ERP 连接”的双通道误报。
- 订单日常视图、统计、pipeline、导出及详情/物流/发货/取消/面单/批量操作均排除 `DISABLED` 店铺；停用店铺的历史订单仍保留在数据库用于费用、物流与审计，不再出现在日常运营集合。店铺页面文案同步改为“停用”，不再声称物理删除订单。
- 订单管理新增高级筛选：Ozon 子状态、采购单关联、物流方式、排序，以及浏览器本地保存/恢复筛选方案；表格将平台 Ozon 状态与 ERP 仓储履约阶段明确分开。未接入入库/出库时，ERP 履约阶段不会伪造仓库事实；截图中“待打包”和“已取消”是不同订单的平台状态，不是同一状态重复计算。
- Ozon 列表扩展的展开 portal 在卡片离开视口、滚动导致锚点完全不可见时自动关闭，避免固定定位残留造成“尸体窗口”。
- 定向验证：server `32/32`（含设备规则与禁用店铺订单隔离）、扩展 UI/runtime/security `23/23`、Web orders contract 通过、server/web typecheck、定向 ESLint、`pnpm verify:extension` `462/462`、`pnpm --filter web build` 通过。独立 headless UI smoke 在 1440px 与 390px 下均无横向溢出。

## 2026-09-23 `4a801476 / 1.0.361` 官网公开发布完成

- `4a801476c6be26e169053f088a90378f9010cce0` 已在 COM/CN 运行并通过发布后 verifier。COM 继续是受限 hosted pilot，仅 `IMAGE_TO_IMAGE/SUITE`；CN 继续 direct-origin/RDS、AI/BYOK/Ozon 全暗。
- COM REL-04 v3 受限 pilot canary 通过，回执 SHA-256 为 `74aec87bca2729739771f1d654e69050c7d69d33ed4e35414fcf8ecb337ebd9d`；CN v2 no-shop dark canary 通过，回执 SHA-256 为 `665719571a7f6e2e36faa9d056d47ee54f0b2e8b5e4a9da39778f470fea5069a`。COM 重新读取的 active sessions 为 `42f4d334-07a9-4435-9ede-0e81786a80c8`、`4326ce27-4a51-459a-bf71-3a639133494b`；此前报告的 session 顺序拒绝已由按服务端当前顺序重读关闭。
- 官网 approval/CAS 已分别完成：COM approval `4f6e6dd0a760032bc80949ce85b79a94626318aae938ac720b87d2ec681a57ad`，CN approval `bad88575d7216060be01a59676a4abccf9acd3cfaf32dcd261fbb098fc7b64d9`。两区 distribution probe 与 final publication verifier 均通过，官网 pointer 现为 `4a801476 / 1.0.361`。
- 区域 distribution receipt：COM `9ca6a933b71eac54b5026c917f23413074d4ccc30b922c332f6ecbee7e180db9`，CN `4a3afa9619c6bd01da7387e806be0df9348138aeb7763a8ea3fbe8d139182092`。两区发布后 VPS verifier 均 `0 failure / 1 warning`，唯一 warning 仍为远端备份未配置。
- 官网同路径 live 验收已完成：固定目录 `C:\Users\550W\AppData\Local\SS-ERP\managed-extensions\cloud-com\ss-erp-cloud` 从 `1.0.334` 原子替换为 `1.0.361`，固定 ID `nkkemglcckgmhmcfnjjmcfbdhciafahl` 保持不变；reload 后 active-worker 回执 SHA-256 为 `7e3a9ae61fd4d28ad99f2a5d4e8adbaf33cb82098e1ecd6ca002830fa1b7afc6`，Unicode smoke 回执 SHA-256 为 `14c4302151b23446341c251476bd4d060b495191655eaf2028036e8d7b889d3e`。旧目录保留为同级可恢复备份；9222/9444 未触碰。
- 本轮没有 Provider POST、ERP ingest、Ozon 写入或新增费用。canary 短时 account token 已从两区 root-only 文件删除；VPS publication bundle 与本机私有发布证据保留供审计。

## 2026-09-23 QA04 发布验证隔离边界

- `6aba7a8c` 的 CN no-shop 实现已推送，目标 commit 完整 offline 已通过；但正式 QA04 正确暴露旧 source bridge 以整棵 `apps/server` 为粒度，导致仅官网发布 validator 的变化也被误判为 ERP suite 执行源码变化。
- source bridge 现仅对两个固定官网发布文件使用执行中立例外，其余 server/shared/schema/依赖仍逐 Git object 严格相同；回执记录受保护 server inventory 摘要及两个排除文件的前后 object ID。完整 producer `51/51` 与 ESLint 通过。该 follow-up 必须形成新 clean commit 后重新取得 offline 和正式 QA04；不重跑 Provider suite，不复用 `6aba7a8c` offline 冒充新提交。

## 2026-09-23 CN 无店铺 REL-04 暗态验收

- CN 当前账号无 shop，因此新增显式 `REL04_NO_SHOP_DARK_CANARY=true` 的 CN-only 全暗态 canary 合同；只读确认账号店铺列表为空，不读取店铺级 publisher capability、不创建 shop 或设备 session。回执不证明店铺级发布/设备能力；COM pilot 和普通 dark canary 不变。实现、验证和发布后果见[当前状态审计](current-state-audit.md#2026-09-23-cn-无店铺全暗态-rel-04-合同修复)。
- 实现提交 `6aba7a8cd616dcbf64dca34c4c3cea6474bd6059` 已推送；完整 offline 九步通过，server `6329 passed / 325 skipped`、AI Media PostgreSQL `197/197`、source/cloud/local 扩展分别 `462/467/463` 且零 failure/warning。尚未为后续 bridge commit 生成 offline、签名候选、部署或新 VPS/canary 回执。官网继续保持 `b41097d6 / 1.0.354`；旧 `2f2f5bb9 / 1.0.360` 及 `6aba7a8c` 的证据都不能重标给后续提交。

## 2026-09-22 `1.0.359` fresh suite 与 QA04 事后只读取证

- `1570a17b99bd8c38b251282184a9d60322a72a5d` 已推送并部署 COM/CN，扩展版本 `1.0.359`；目标 commit 的完整 offline、双区候选/签名、备份恢复与完整 VPS verifier 已通过。COM 继续只允许 DOTH `IMAGE_TO_IMAGE/SUITE`，CN 继续 direct/RDS 全暗；两区唯一 warning 仍为未配置远端备份。
- COM 原 1688 收纳盒 v4 快照 `a8f4ee01-93e1-4e1a-9a01-8348f7dbe964`、隔离草稿 `draft-fdf62d87-5b9d-424c-9870-8c05414ae7ab` 已完成唯一一次两图 SUITE `cmuc7p053001r5olq8wssceqa`。两槽均 attempt 1、900x1200 PNG，经安全预览与真实批准后原子写入 SKU hero 和 PRODUCT gallery；草稿 `r1/v1 -> r2/v2`，相同 assignment 请求 replay 保持两条。两笔唯一 `SETTLED/CHARGE` 各 CNY 0.14，总计 CNY 0.28；无 Provider 重试，Ozon publish attempt 为 0。
- 执行时保留了生成完成且审核前的原始 MV3 UI、预览和审核记录，但遗漏同期数据库读取。生产库仍保留完整不可变 workflow events、审核 payload/hash、草稿 `r1/v1` 与 `r2/v2`、assignment 外键及 Ozon 零写入。正式 QA04 suite v3 producer 按 T2 RED -> GREEN 新增 `POST_APPLICATION_EVENT_DERIVATION_V1`：只在两份事后只读数据库快照完全稳定、事件哈希与时间线能证明 UI 读取时尚未审核、草稿历史和 assignment 全部相互绑定时接受；不允许调用者 PASS、重写历史状态或复用旧摘要。完整 producer `50/50` 与 ESLint 已通过。
- 官网仍服务旧 pointer `b41097d6 / 1.0.354`。本节 producer 改动需要形成新的 clean commit，重新取得该提交的 offline，再以 `1570a17b` 作为显式 execution bridge 生成正式 QA04；之后才可执行 COM v3/CN v2 canary、website approval、distribution probe 和 CAS 到 `1.0.359`。当前不得再执行 Provider suite，本次 CNY 0.28 授权已用完。

## 2026-09-22 `1.0.358` 双区暗部署与 fresh suite 前置

- `9634f8b69b6616295cb0fb36001289a8af9873f9` 已推送并部署 COM/CN；独立 MV3 原套图完成安全预览、两槽审核、DOTH store-draft assignment 与原请求幂等重放，未执行 Ozon publish。两区完整 VPS verifier 均为 `0 failure / 1 warning`，仅远端备份未配置；COM/CN 备份恢复分别验证 144/143 张表并清理临时库。
- 官网仍服务已批准旧 pointer `b41097d6 / 1.0.354`。为当前源码取得 fresh normal suite，已在真实 1688 收纳盒页取得 v3 快照 `4484986b-72b2-4d1d-8673-31d37ae74329`，并通过 Web 创建 DOTH 隔离草稿 `draft-fb93d3ff-a5d7-4a3c-a04c-9dd543274433`；草稿 `r1/v1`、空 assignment，目前尚无新 Provider POST、费用或 Ozon 写入。
- `9634f8b6` 的 offline 因 Windows/PostgreSQL 时钟差导致 Wanx 租约测试失败。测试 owner 已在真实隔离 PostgreSQL 下按 RED -> GREEN 改为用数据库时钟等待租约，AI PostgreSQL 与升级回放通过；本节所在新提交仍需取得正式 offline 证据。必须完成新提交的 offline、双区区域候选/签名/部署和新的 suite 后，才能生成正式 QA04、canary、website approval 与官网 CAS；不得复用旧 commit 原件。

## 2026-09-22 显式 launch grant 计划绑定恢复修复

- 当前接续修复已完成本地实现与真实隔离 PostgreSQL 验证：新配对设备不会通过普通 successor lineage 跨过 `REFRESH_REUSE_DETECTED` 自动接管旧 suite binding；只有来源草稿页发出的、由同物理设备消费的 `ERP_SOURCE_LAUNCH_GRANT` 才能在精确 owner/device/deployment/scope/draft/suite/no-assignment 条件下恢复原 plan binding。
- 定向 server `42/42`、全量 server `6324 passed / 324 skipped`、typecheck/lint 与真实 PostgreSQL `6/6` 通过。此段记录修复的提交前状态；后续部署与 MV3 验收结果以上方新状态为准。

## 2026-09-21 `3fc4eb91` 双区部署完成，官网 pointer 保持旧版本

- 修复提交 `3fc4eb91f409f665b7a725cf9cbb1093dcfc5010` 已推送到 `origin/feat/ai-media-prompt-registry`，并完成 fresh `pnpm qa:04:offline`：server `6320 passed / 324 skipped`、AI Media PostgreSQL `196/196`、扩展最终 `463 pass / 0 failure / 0 warning`。
- COM 与 CN 均已切换到 `3fc4eb91 / 1.0.355`，三服务、150 migrations、post-migration suite guard 和公网 `/ready` 通过。COM 继续受限 hosted pilot，仅允许 `IMAGE_TO_IMAGE/SUITE`，owner/shop 为 `cmpsj2g6800005ow9rrtvqhay` / `cmq7r8n1700095o7exbet1xle`，active sessions 为 `42f4d334-07a9-4435-9ede-0e81786a80c8` 与 `90238535-db06-4ce1-937a-854550c4d7c8`。CN 使用 direct-origin、外部 RDS，AI/BYOK/Ozon 全暗。
- 独立区域候选严格分区并使用同一 commit：COM cloud/local SHA-256 为 `3dc6bd6d5f4c196609d0d32402ad35f222e4677542bc796be4ca926a94a73f35` / `31bdf0b0b629671b97adf4de70614b8ea238512832270da42846d5b2026b9988`；CN cloud/local 为 `b1ea3b36fb40983a44925f76137300d5540563ec8240a19f95d276c7308d2c49` / `da99adfd269873225cf3bf3997313839ea3c406556c3054cf6b925f25e04a3fc`。两区 detached signature 均由 active Ed25519 key `ss-erp-extension-release-2026-09-05-01` 独立验签，COM/CN signature SHA-256 分别为 `69c59c091450f3acf0b388aeff626632a72702531197dcfdd97ba5a2e0c4757c` / `ba0ef6340589a696f03576fe7ed776d758c19e4d83e00d53b59920fc6299095f`。
- 完整 VPS verifier：COM `0 failure / 1 warning`，canonical evidence SHA-256 `726208ba462db590f9ac435827918b6ffd61a00139fefea5b479634644182852`；CN direct/RDS `0 failure / 1 warning`，canonical evidence SHA-256 `681f662530bc8f7e7cc5b7630d37fbfbc4045ee1c639759d15f553048f6cad7b`。唯一 warning 均为既定未配置远端备份。CN RDS restore 通过 `143` 张 public 表；COM 本机 restore 通过 `144` 张 public 表，临时恢复库已清理。
- 官网仍安全服务旧 pointer `b41097d6050cb3f5bdea0ae675b12ce7b0fd6dc4 / 1.0.354`，没有执行 website approval、canary、distribution probe 或 CAS。没有 Provider POST、Ozon 写入或新增业务费用。
- 本轮为 CN RDS 恢复而创建的 `ss_erp_maint_20260921`、`ss_erp_maint_20260921b` 与 `ss_erp_maint_20260921c` 均已在控制台显示“锁定中”；删除操作触发阿里云安全验证，未将删除写成已完成，待人工完成安全验证后删除。密码未写入文件、Git、日志或 VPS。

## 2026-09-21 MV3 设备凭据业务 `410` 误清理修复（已随 `1.0.355` 部署）

- 受控 Chrome `Target.closeTarget -> Web bridge wake` 证明合法配对的 MV3 Service Worker 重启会保留同一 device session/JTI、local refresh credential 和 session access；原“Worker 重启丢失凭据”诊断不成立。COM 只读数据库同时证明故障 session 仍为 `ACTIVE`，refresh family 仍为 `ACTIVE`，generation 1 refresh credential 从未消费且没有 refresh/reuse event。
- 根因位于 `source-workflow-device-session.js`：transport 原来把所有 HTTP `410` 都当成设备身份撤销并调用 `clearIfCurrent`，因此过期的 hosted candidate preview ticket 或 command grant 会删除仍有效的设备 refresh credential。修复后仅明确的设备身份错误码清 credential；业务资源 `401/410` 保留配对并返回 `http_error`，由上层重建工作台、preview ticket 或 command grant。
- T2 门禁已按 RED -> GREEN 完成：新增 preview/grant 业务 `410` 负例和“合法配对 -> 业务 410 -> 新 Worker manager 仍可 beginOperation”的重启回归。credential/lifecycle/transport 48 项、hosted/ERP launch 15 项、`pnpm verify:extension` `462/462`、workspace typecheck 和定向 ESLint 通过。
- 本轮没有 Provider POST、Ozon 写入、官网 CAS 或新增业务费用。源码随本节所在提交固化但尚未部署；受控 reauthorization 后 COM pilot 当前 active session 为 `42f4d334-...` 与 `90238535-...`，后续部署 expectation 必须重读这两个当前 ID。`04f9ff9e` 的 offline、签名、VPS、suite 原件和官网旧 pointer 均不得重标给后续提交；正式发布链必须从新 commit 重新运行。

## 2026-09-21 `04f9ff9e` 双区部署基线（历史）

- `04f9ff9efc8f92427ef94046ea258c64555a8e5e` 已部署到 COM/CN，扩展版本均为 `1.0.354`；COM 保持受限 hosted pilot（仅 `IMAGE_TO_IMAGE/SUITE`），CN 保持 RDS/direct-origin 和全暗态。两区 API/Web/Worker 与公网 `/ready` 通过，150 migrations 无待执行项。
- COM fresh VPS verifier 为 `0 failure / 1 warning`，CN direct-mode fresh verifier 为 `0 failure / 1 warning`；唯一 warning 是远端备份未配置。COM evidence SHA-256 为 `adb91045bd4bf995212d78a4471e9e965ad371f742ec1b94210c1e195a34b096`，CN evidence SHA-256 为 `74463c41aae3b9cac49567cf03549ee89320d2d54f11d7b86015993d8ab8472c`。
- CN RDS 恢复演练通过 `143` 张 public 表；临时高权限 maintenance 账号 `ss_erp_maint_20260920` 已删除，owner/admin canary sessions 也已清理。没有 Provider POST、Ozon 写入或新增业务费用。
- 双区新候选已签名并预置：COM cloud/local `4d602704...b45a` / `7e5d8975...0bac`，CN cloud/local `47b2a2e1...90fb` / `8ffe5213...69cd`。官网 pointer 仍为旧 `b41097d6 / 1.0.354`，未执行新 CAS 激活。
- 新 commit 的 `pnpm qa:04:offline` 已通过：server `6320 passed / 324 skipped`、AI Media PostgreSQL `196/196`。正式 QA04 final 暂不能生成，因为历史 normal ERP suite evidence 被正确拒绝为 `QA04_ERP_SOURCE_CHANGED`；禁止改写旧 QA04 JSON 或跳过该 gate。下一步是重新取得绑定 `04f9ff9e` 的 fresh normal ERP suite evidence，再生成 COM v3/CN v2 canary、website approval、distribution probe 和最终 publication verifier。

## 2026-09-20 受限 hosted pilot 官网发布合同收口（待新提交发布）

- 双区 `e33f68d1 / 1.0.354` 应用部署及完整 VPS verifier 已通过；COM 保持 DOTH 受限 hosted pilot，CN 保持 RDS/direct-origin 全暗态。CN v2 dark canary 已通过并完成临时账号/设备清理，但官网 pointer 仍为 `1.0.332`。
- 正式官网 owner 原来只接受全暗态 canary，与 COM 长期受限 pilot 冲突；禁止临时关闭 pilot、复用 CN 回执或手填 PASS。REL-04 producer 现保留原 v2 暗态字节，并为 COM 新增 v3 `SS_ERP_REL04_RESTRICTED_HOSTED_PILOT_CANARY`：重读精确 owner/shop/device session、rollout/source policy 和 `IMAGE_TO_IMAGE/SUITE` 白名单，要求 FULL_EDIT/INPAINT、BYOK、Ozon publisher 关闭，只执行 readiness GET、临时设备生命周期和清理，不发送 Provider/Ozon/ingest 请求。
- website approval、activation、probe 和最终 publication verifier 通过同一 canary SHA 接受 v2/v3，历史 v1/v2 保持兼容；pilot policy 同时修复为拒绝白名单外开启的图片操作。发布/canary 74 项（1 条平台跳过）、维护 51 项、QA04 48 项和受影响 ESLint 已通过。
- 该改动会改变正式候选 package inputs，必须形成新 clean commit 后重跑 offline、重建/签名/部署双区 `1.0.354`、重新生成 VPS/canary/approval。`e33f68d1` 的签名、VPS 和 CN dark canary 只保留为本轮发现合同缺口的历史证据，不得重标用于新提交官网发布。

## 2026-09-20 MV3 1.0.354 UX 与真实套图验收已完成（官网待发布）

- `68846923 / 1.0.354` 已在独立 MV3 专用 profile 完成新的两槽真实套图：suite `cmu9bfp8r000o5ohoh4kp9rwe` 为 `SUCCEEDED`、revision 9、2/2 attempt 1；两张 900x1200 PNG 经安全预览后审核通过，审核 mutation 后 UI 两次均立即显示“ERP 托管权威状态已更新”，关闭了原 authority refresh 假失败问题。
- 新 DOTH QA 草稿 `draft-269de912-c844-41d6-9f52-1bf66a282817` 由 r1/v1 原子写入为 r2/v2，新增 SKU hero 与 PRODUCT gallery 两条 assignment；完全相同的 transport request replay 返回 `replayed=true`，assignment 仍为 2。两笔 reservation/settlement 均为 `SETTLED/CHARGE` CNY 0.14，总 CNY 0.28；Ozon publish attempt 为 0。
- 目标提交完整 offline 已通过：server `6319 passed / 324 skipped`、AI Media PostgreSQL `196/196`、升级回放和三种扩展验证通过。实际生产证据同时确认 1688 原图为 baseline JPEG、ERP normalized reference 为 progressive JPEG、BullMQ completed job 按 `REMOVE_ON_COMPLETE` 清理、COM restricted pilot 前后配置不变；QA04 suite v2 producer 已以 RED -> GREEN 覆盖这些现行合同及 extension-only execution bridge，48 项回归通过。
- 官网 pointer 仍为 `1.0.332`。下一步是提交 producer 改动，以新提交重跑 fresh offline，重建/签名/部署双区 `1.0.354` 候选，再生成正式 QA04、区域 canary/approval 并通过 CAS 发布；不得复用 `68846923` 候选冒充新 commit。

## 2026-09-20 独立 MV3 全链与双区 1.0.353 已完成

- 独立 MV3 已在真实 source 页完成 plan binding、suite、安全预览、两槽审核、store-draft assignment 和幂等 replay；草稿 `1/1 -> 2/2`，两条 assignment 保持唯一，两笔结算各 CNY 0.14，`ozon_publish_attempts=0`。完整证据见[阶段 owner](stages/ai-image-billing-closure-2026-09.md#2026-09-20-mv3-10353-全链验收与双区部署)。
- COM/CN current 均为 `617e8518a9218422e1174fe193b493b4a38e42e7 / 1.0.353`。COM 继续受限 hosted pilot；CN 继续 direct-origin、RDS 和全暗态。两区完整 verifier 均为 `0 failure / 1 warning`，canonical evidence SHA-256 分别为 `dd340f10...fe1f`、`c90ea2cb...5018`。
- 官网 pointer 仍为 `1.0.332`；未执行 Ozon publish、官网发布或 CN hosted pilot。当前仅保留审核后即时 authority refresh 的可恢复 UX 提示作为后续收口，不再把 RDS maintenance 或 store-draft owner 列为主阻塞。

## 2026-09-18 COM hosted pilot 部署接续

## 2026-09-19 MV3 source-page transport 修复（未部署）

- 独立 hosted AI 工作台新增受限 `source-listing-workbench-ai-image-suite-relay` 消息：扩展工作台页只能请求 Worker 查找唯一匹配的 marketplace source 商品页，Worker 再把原始意图转回该 source content-script；source 页重新发送原有 authoritative command，owner/device/shop/binding 仍由 Worker 和服务端重读，extension page 不能直接执行 suite mutation。
- relay 仅允许 `/pages/ai-image-workbench.html`、`/pages/ai-image-workbench-launch.html` 发起；source tab 必须为当前平台和商品 ID 的唯一 HTTPS 商品页，重复/缺失 source tab 直接拒绝。source workbench 的 `CREATE_AND_REVIEW_PLAN` 仍复用既有 plan create -> binding -> review owner。
- 定向 source workbench contract、relay VM 测试、`pnpm verify:extension`（462 pass）、workspace typecheck/lint 通过。未部署、未执行 Provider POST、Ozon 写入或新增费用；远程真实 store-draft assignment 仍待新候选部署后验收。

## 2026-09-19 双区 1.0.341 部署完成

- COM 已切换 `5a20822cb259d48775526f0f378a34d9c806e047 / 1.0.341`，候选 cloud/local SHA-256 为 `7c14dd39710b9c667653b3eeecf0957fc3670506e05426d48dd094286a0b2418` / `8208dc55c62893cfcfe825cdd9c87b37563497bb90913c1a12b724273f50899e`；签名 SHA-256 `0c8e5d9f4e89e67c34526c828d9cf74bd2c48634d001f2bea4b1f51b985aa7a0`。hosted pilot 合同精确绑定既有 COM owner/shop/device sessions，允许操作仅 `IMAGE_TO_IMAGE/SUITE`，未启用 FULL_EDIT/INPAINT、BYOK 或 Ozon publisher。
- CN 已切换同一 commit/version，`.cn` 区域候选 cloud/local SHA-256 为 `ea961476316183b4003ff352556295dd2b06abb52106914740de8d99e4518e8f` / `9cbea2fea400acabce9c3a346ac8fd87348c45655fda19430142c63c3de3e09e`；签名 SHA-256 `95c5899f8c9056bb33e4b039899d157112e06c92237d51e0481661f678de55fc`。CN 使用 RDS、direct-origin HTTPS 和全暗态 AI/BYOK 配置。
- COM/CN 完整 VPS verifier 均为 `0 failure / 1 warning`，唯一 warning 是既定未配置远端备份。canonical evidence 均由部署后的普通 Node 22 runtime writer 生成并落盘为 root-owned 0600：COM `062366d0b730b7fd2878169413b286cb47dc904afcd3959cbd48bb14f0857464`，CN `ac3b484cfb0d1dcf8ffb275937964c846e806da52ed5111aeb98070bd9be706`。
- 双区部署未执行 Provider POST、Ozon 写入、官网 pointer 切换或新增费用。下一步仍是用 `1.0.341` 独立扩展在远程真实 source page 完成 plan binding、suite、slot review 和 store-draft assignment；COM/CN 部署通过不替代该浏览器证据。

- 部署合同修复提交为 `959ae65f`、`8bc1a19f` 并已推送。`deploy-environment.mjs` 现在在受限执行边界显式透传 `AI_MEDIA_ROLLOUT_EXPECTATION` 与 `AI_MEDIA_PILOT_EXPECTATIONS_JSON`；pilot scope 合同精确要求 `capture:write`、`listing:review`、`listing:write`、`media:execute`，并按 `allowedOperations` 只开启 `IMAGE_TO_IMAGE`、`SUITE`。定向部署合同 `9 passed / 1 skipped`，AI dark/pilot 合同通过。
- COM 已切换到 `8bc1a19f90744444dba95012bc2468312efbda72`，扩展候选 `1.0.340`。cloud/local ZIP SHA-256 为 `2b885a6200a7e4d31e9b4427efe4620ec15423fab3da81f635f6ae3bf560e05d` / `21f0332594df5f1c4df1146db8b5d3f45ca7f60d7520975051c01e21cde9eeeb`；签名 SHA-256 `3af46922583a6962df15a2c92bea063f8c236e0005272531fb856166c770e7b7`，候选四件套和 detached signature 均为 root-owned 0644、按 commit 分目录预置。COM `/ready`、API/Web/Worker、迁移和 post-migration suite guard 均通过。
- COM hosted-pilot 运行合同已实际通过：owner `cmpsj2g6800005ow9rrtvqhay`、DOTH `cmq7r8n1700095o7exbet1xle`、两个 active device session `42f4d334-07a9-4435-9ede-0e81786a80c8` 与 `b864be4c-9bf9-4304-aa2e-5ef2c49a72db`，四项 device scope 精确匹配；`FULL_EDIT`/`INPAINT`、BYOK、Ozon publisher 保持关闭。多次失败候选目录均移动到 `.failed-*` 归档，未切换 current 时服务按合同保持/恢复旧版本。
- COM 运行备份已按运维合同分离：`BACKUP_LOCAL_DIR=/var/backups/ss-erp-runtime`，deployment attestation 继续在 `/var/backups/ss-erp`；目标 commit 的备份和本地临时恢复演练通过，public 表 `144`。完整 cloudflare-mode VPS verifier 主检查 `0 failure / 1 warning`，唯一 warning 为远端备份未配置；cloud/local、签名、官网旧 pointer 保持 dark。
- 本次没有 Provider POST、Ozon 写入、官网 pointer 切换或新增业务费用。VPS verifier 的 canonical evidence writer 仍受 Node 22 生产运行时缺少 TypeScript loader 影响，控制台主验证已保留为 `0 failure / 1 warning`；未手写伪造 evidence，待单独修复 verifier loader 后再写回 canonical JSON。

## 2026-09-18 部署接续

- 备份目录分离修复已推送为 `7b4503ac00fc605a6210c2484ba0ff632ac0443a`：VPS verifier 现在要求 runtime `BACKUP_LOCAL_DIR` 与 deployment `DEPLOY_BACKUP_LOCAL_DIR` 都是 canonical 非根目录且必须分离；合同测试 `13 passed / 7 skipped`。CN runtime 备份已切到 `/var/backups/ss-erp-runtime`，deployment attestation 保留在 `/var/backups/ss-erp`。
- CN 已更新到 `7b4503ac / 1.0.338`：目标 attestation SHA-256 `482b07f0d2a76f96160dbd002e97e81070d2e82c393e8b667402902758a386ef`，direct-mode VPS verifier `0 failure / 1 warning`，API/Web/Worker 和四个 `.cn` `/ready` 均通过。cloud/local 包 SHA-256 分别为 `bcec3872daabe831b9542d8a076dabcc194478eefc0bde1f479b30c31ab8bc95`、`541db0611e52db406dea7186bae7781e4eee2ded47f4fdf2d8436d5a63b0d857`，签名 SHA-256 `530c79200a2cd05d38f8c2dfcbc52321e0731ed84c967208dfa6417c95e24b4d`。

- `0f5ea6d1 / 1.0.337` 是本次目录分离修复前的 CN 部署基线；其备份、migration、dark gate 和 direct-mode 验收证据保留为历史记录，当前运行状态以上述 `7b4503ac / 1.0.338` 为准。
- COM 仍运行 `40c3db87298a48bb7de385badb366af509a94f48`，三服务与 `/ready` 已恢复正常；其 `feature_extension_hosted_ai=true`、套图/工作流/source listing pilot 为 DOTH allowlist，正式 `verify-ai-media-dark.sh` 固定要求 off，因此本轮没有切换 COM，也没有关闭或绕过已授权 pilot。COM 目标候选和备份仍待明确 pilot 部署策略。
- CN 备份取证时发现 `/etc/ss-erp-backup.env` 的 `BACKUP_LOCAL_DIR` 与 `DEPLOY_BACKUP_LOCAL_DIR` 复用 `/var/backups/ss-erp`；本次部署 gate 按应用 env 语义通过，未修改后台备份配置。该配置漂移列为后续运维修复，不作为部署成功条件隐藏。
- 本轮没有 Provider POST、Ozon 写入、官网 pointer 切换或新增 AI 费用；独立 MV3 store-draft assignment 边界仍未关闭。
- COM pilot 合同已提交为 `3b01c1b4`：`verify-ai-media-pilot-policy.mjs` 要求显式 owner/shop/active device session、scope、AI/source rollout revision，并强制发布关闭；合同测试 `7/7` 通过。该合同尚未接入通用部署入口或改变 COM flags，因此 COM 仍未部署新版本。

本目录记录当前项目状态、技术组合、owner 边界、阶段执行和验收证据。公开安装、使用、部署与运维说明仍由 `docs/` 负责。

## 当前真源索引

- [当前状态审计](current-state-audit.md)
- [技术选型与基础决定](technical-selection.md)
- [架构与 Owner Map](architecture.md)
- [验收与停止条件](acceptance.md)
- [2026-09 项目加固阶段](stages/project-hardening-2026-09.md)
- [2026-09 生图与计费收口阶段](stages/ai-image-billing-closure-2026-09.md)
- [2026-09 全暗态维护部署阶段](stages/dark-maintenance-deployment-2026-09.md)

## 文档职责

- `current-state-audit.md`：当前代码、Git、运行、文档、风险和进入点。
- `technical-selection.md`：沿用或迁移技术组合的唯一决策理由与外部证据 owner。
- `architecture.md`：当前进程、模块、数据、权限和部署边界的宏观投影。
- `acceptance.md`：本地、数据库、浏览器、安全和发布各证据面的最低门禁。
- `stages/`：只有跨 owner 或有序工作才物化；一份文件同时承载计划、当前子阶段和回写。

## 更新规则

- 先更新唯一 owner，再更新引用它的消费者；禁止复制第二份状态表。
- 当前代码和新鲜命令证据高于旧计划与历史发布记录。
- `docs/plans/` 和 `docs/archive/` 是历史/专题证据，不自动代表当前实施状态。
- `docs/deployment.md` 的线上记录只证明对应提交和日期；不能证明当前工作树已部署。
- 内部决定变更时更新本索引；完成的阶段保留为历史证据并明确结束状态。
- 推送前检查本目录是否包含密钥、手机号、客户数据、生产回执或不可公开的商业信息。

## 当前状态

- 2026-09-18 当前接续（未部署）：VPS canonical evidence writer 已移除生产 Node 对 TypeScript loader 的运行时依赖；纯 JS 合同 owner 为 `packages/shared/src/rel04-release-evidence-runtime.mjs`，TS 文件只保留类型面与 re-export。`vps-verification-evidence.test.mjs` 新增禁用原生 TS stripping 的普通 Node 子进程门禁，10/10 通过；shared typecheck、workspace lint/typecheck、extension verifier 通过。source-page MV3 计划缺口已补齐：真实 marketplace content-script 复用既有 source-only `ai-image-suite-command` 消息，新增 `CREATE_AND_REVIEW_PLAN` 高层 intent；Service Worker 每次重读 handoff、草稿和设备授权，调用现有 hosted plan create→binding→review owner，页面不能提交 owner/device/shop/binding。无 plan 时 source workbench 显示“创建并审核 AI 套图计划”，聚焦 source workbench 合同通过；尚未部署或执行新的 Provider/Ozon 写入，下一步为提交、COM/CN 候选部署及新的远程 MV3 store-draft 真实验收。
- 2026-09-18 接续：修复 hosted 套图计划 GET 被扩展响应安全层误判的问题。托管计划公开投影中的业务归属 `{level, key}` 仅在 hosted 工作台消息且对象字段精确时放行，BYOK/其他运行时响应仍拒绝 `key` 和所有密钥形状。提交 `15a42d6f`；定向授权 17/17、完整 preflight `6314 passed / 321 skipped`，cloud/local `1.0.335` 候选均已生成并通过包校验；初始构建时未签名，随后已完成签名验签，仍未部署、未产生 Provider 费用。原套图计划的真实批准、执行和写回结果见下一条。
- 2026-09-18 真实套图接续：沿自有 QA 来源计划完成一次 Web 托管两槽执行，suite `cmu618tna000c5oq8vnn4pkys` 最终 `SUCCEEDED`，2/2 成功、0 失败、冻结 CNY 0.28；两个候选均人工审核通过并追加到来源商品 target，当前 suite revision 9、两个 slot application 均为 `APPLIED`，队列 `queued/running/failed` 均为 0。图片已目视核验，无文字、水印或 Logo；该真实运行通过 Web 套图 owner，不替代修复版 MV3 扩展的独立浏览器 QA。`1.0.335` 候选已签名并独立验签（signature SHA-256 `ef26b8a1c241477c3e52110ff5eb8dd419e466f681a21e30b89229fa8399fa7d`），仍未部署或官网发布。
- 上述两次 APPEND 的真实应用记录和来源商品 target 图片数已从 2/3 增至 4；`/api/source-listing-workflows/...` 的独立 `media.assignments` 仍只有原有 `product-main` 一项。原因是 hosted suite 合同的 `ERP_SOURCE_PRODUCT`、`writesStoreDraft=false` 语义；因此当前证据证明来源商品写回通过，不证明独立 store-draft assignment 已新增。
- 2026-09-18 独立 MV3 浏览器接续：专用 Chrome profile `mv3-qa-1.0.335`（CDP 9444）已替换为正确 API origin 的 cloud `1.0.335` 候选；扩展设置显示 runtime `gdibahdfhkbiaaapnnnclmedepkfinek`、`https://ss-erp.com`、deployment `ss-erp-vultr-sg-prod`，DOTH 及 `listing:review`、`listing:write`、`media:execute` 权限均已配对。设备 transport 的 hosted `plans/current` 对当前独立草稿返回 `plan=null`；同一固定设备 transport 按现有 `extension-hosted-ai-image-listing-assignment/v2` 合同调用 `listing-assignments`，服务端严格返回 `404 hosted_listing_assignment_not_found`。因此独立 MV3 通过了版本、endpoint、设备/权限和拒绝边界证据，但未完成独立 store-draft assignment；未新增 Provider POST、Ozon 写入或费用。原因是既有 Web 套图计划尚未形成当前草稿的 extension plan-binding，不能绕过该 owner 直接写 assignment。

- 2026-09-18 远程 VPS 独立 MV3 完整验收：在 COM VPS 当前 `40c3db87298a48bb7de385badb366af509a94f48` 上，使用已配对设备、DOTH pilot 和 cloud `1.0.335` extension transport，创建隔离 QA draft `draft-7e7bb644-d41e-4d35-bd59-41297f0d3e0a`（source `af03f038-312e-4685-8325-91041e11e62a`、snapshot `084e5753-2014-4dd5-87ca-cfbd80ee1e36`）。Hosted plan `cmu6gigk5001q5oq8mb8tnmv2` 创建 `202`、显式 `galleryGoals=[scene]` 后审核通过；suite `cmu6gkcsu00205oq8n47fnp7l` 经 `START -> CONTINUE` 收敛 `SUCCEEDED`，2/2 成功、0 失败、每槽 `attempt=1`，每槽 CNY 0.14，总冻结/结算 CNY 0.28。两个候选均为 900x1200 PNG，私有目视证据无文字/水印/Logo；两个槽经 extension review `APPROVED` 后由现有 `listing-assignments` owner 原子写入，draft `revision/draftVersion 1/1 -> 2/2`，新增 SKU hero 与 PRODUCT gallery 两条 assignment。重复相同幂等键返回 `replayed=true`，数据库 assignment 仍为 2 行；两个 reservation/settlement 均为 `SETTLED/CHARGE`、14 cents。该流程未执行 Ozon publish，`ozon_publish_attempts=0`，未产生额外 Provider POST、重试或取消。完整链路现已通过远程 VPS/独立 MV3 验收；候选图片与摘要保留在用户私有目录 `C:\Users\550W\AppData\Local\SS-ERP\private\mv3-remote-suite-cmu6gkcsu00205oq8n47fnp7l`，不进入 Git。

- 2026-09-16 剩余功能收口：正常 Wanx 单参考、套图与 CNY 计费、生产扩展上传入口、四项 Web 合同及同源请求已完成本地实现；用户已批准六张/CNY 1 实测及双区全量启用配置。实现、迁移、验证和未执行边界统一见[本轮实现与已批准验收范围](stages/ai-image-billing-closure-2026-09.md#本轮实现与已批准验收范围)，原运行版本仍以下一条为准。
- 2026-09-16 接续：Web 读取恢复已随 `eeb8dccd` 完成正式 QA04、COM/CN 部署和官网扩展 `1.0.329` 发布；COM 受管扩展升级、原生运行验证与常规浏览器读取通过。最终证据、旧 Worker 缓存恢复及未覆盖范围统一见[双区正式发布与受管升级](stages/ai-image-billing-closure-2026-09.md#双区正式发布与受管升级)；下面的 `81072d68` 结果保留为上轮正常 FULL_EDIT/费用基线，不重复付费生成或供应商账单轮询。
- 正常生成与任务计费已按用户纠偏完成本地修复；最终源码已推送，COM/CN 应用部署及一次真实 FULL_EDIT 验收通过，临时配置已恢复。配置恢复、真实费用及双区运行的最新事实只维护在[阶段 owner](stages/ai-image-billing-closure-2026-09.md#正常流程真实验收与应用部署)，源码实现与离线证据见[最新接续](current-state-audit.md#生图报价与扩展入口接续2026-09-15)。供应商后台对账不再作为功能前置；以下隔离实测及账单条目保留为历史证据。
- 按顺序完善进入图片质量项：用户已批准重指定 CNY 0.25，冻结 `3db2eebf` 完成唯一一次方向前置 INPAINT，27.010 秒技术成功、质量仍拒绝。类文字在本样本未见，但目标色和自然边界未通过；累计占位 CNY 1.50，剩余零，旧 FULL_EDIT 已撤销。第六条原生明细已回显免费抵扣、当前应付零，新增当日用量及正式结算仍待核对。授权、实测及最新状态只维护在[第六次执行记录](current-state-audit.md#第六次方向前置-inpaint-与额度重指定2026-09-15)。
- 生图/计费接续（2026-09-15）：源码 `14b5ade3` 的完整离线门禁通过；受控追加已实现并完成一次获批 INPAINT，16.365 秒技术成功但仍质量拒绝，FULL_EDIT 按条件停止。第五条免费抵扣明细已回显，当前应付零；累计保守占位 CNY 1.25，条件剩余 0.25 不可重分配。图片质量、原生任务归属、正式账单和正常 ERP 全链仍未解决，完整证据只维护在[本次实测记录](current-state-audit.md#第五次-inpaint-重测与新增明细2026-09-15)。
- 最新无费用接续：第五次请求的 adapter/提示词/源图/mask 离线重放通过，未发现传参截断或方向错误，质量根因仍未确认；13:07 五条原生明细保持免费抵扣，当日用量仍延迟。COM/CN `/ready` 正常且仍为 `63b98b2c`。未完成部分已按“待修复、已有实现但缺真验收、外部前置、运维延期”整理在[剩余工作入口](current-state-audit.md#剩余工作的执行入口)，本轮无新增生图或收费请求。
- 上一维护运行检查点为 `63b98b2c`：COM/CN 全暗态维护部署、完整 VPS 与管理员模板 source 只读验收已通过；当时官网扩展保持 `1.0.316` / `1.0.311`，受管扩展未升级。该历史维护结果只维护在[维护阶段](stages/dark-maintenance-deployment-2026-09.md)，当前运行事实见[正常流程真实验收](stages/ai-image-billing-closure-2026-09.md#正常流程真实验收与应用部署)。
- 最新本地修复（2026-09-15）：VPS 回执导出器已修复符号链接入口静默成功的问题，Windows native/tsx 与 Linux 最低 Node 版本的真实子进程验证通过；尚未重新部署。T2 证据和具体范围见[回执入口修复](current-state-audit.md#vps-回执链接入口修复2026-09-15)。
- 历史已验证：对应提交的完整 preflight、生产域名/Turnstile/USER+ADMIN 只读 smoke、COM 受管扩展固定 ID 同路径升级、active worker、Unicode smoke、官网指针与 cloud/local 下载摘要；不自动覆盖本轮新改动。
- 当前主要待办：正常生图/计费的运行验收范围与未覆盖模式见[阶段 owner](stages/ai-image-billing-closure-2026-09.md#正常流程真实验收与应用部署)；供应商样本与最终账单只保留历史观察。管理员 source 路由已真实验收；Ozon ERP-only 源码修复随维护上线，线上草稿流程仍待按原隔离边界重验，DOTH 样本有 FBS 库存，不能当作已证实的专用测试店。两台 VPS 的 Redis 最近盘点均为 standalone、无副本/集群和专用告警；远端备份仍按决定未配置。Node ESM 提示已解决，Next build 的 flat-config 检测提示仍属工具链限制。
- 推荐下一步：以[正常功能修复记录](current-state-audit.md#正常生图与按价计费修复2026-09-15)推进配置、发布与运行验收；不再继续旧单图付费校准或把供应商最终账单当作功能前置。历史占位与原件保留，Ozon/生产启用按实际授权范围执行。
- 最新功能收口（2026-09-09）：按用户要求优先修复 AI 工作台。四操作的隔离浏览器生成、预览、显式批准和接收入口已验证；改图审核交接、多行提示词、合法响应 metadata 和临时核验失败保留候选已修复。完整 preflight、lint/typecheck 与双模式扩展包通过。真实付费通道、MV3/ERP 外部验收和 Wanx 正常托管接线仍不在该通过结论内，详情只维护在[当前状态审计](current-state-audit.md)。
- 后续托管接续（2026-09-09）：Wanx 发包前错误分类、正常编辑的最后授权检查及并发取消证据传播已修复，真实 PostgreSQL 隔离链路通过；Wanx 正常提示词、尺寸与恢复接线仍待完成。新鲜验证和下一步只维护在[当前状态审计](current-state-audit.md)。
- 最新提示词进展（2026-09-09）：显式 Wanx 800 字编译合同、独立快照绑定及字面插值已实现并通过本地门禁；正常入口选择、尺寸、异步恢复和真实付费验收仍待补齐，独立语义复核受限流影响未完成。详情见[当前状态审计](current-state-audit.md)。
- 最新正常入口进展（2026-09-09）：Wanx FULL_EDIT/INPAINT 的准入、1024 方图限制、冻结提示词校验和前景异步执行已接线；独立审查、完整 preflight 与 108 项 PostgreSQL 回归通过。真实能力未晋升，自动恢复、凭据修订及实际付费验收继续按[当前状态审计](current-state-audit.md)推进。
- 最新恢复进展（2026-09-09）：Wanx 逐任务非密凭据修订和只读异步恢复已接入，复用原 raw/合成/审核与账本路径；126 项 PostgreSQL 回归通过。最终门禁与实际付费验收状态只维护在[当前状态审计](current-state-audit.md)。
- 最新付费前准备（2026-09-10）：新 Wanx 凭据只读归属与标准端点认证已核清，CNY 1 本轮总限额已明确；原生账单关联、当前提示词和总额度试点入口仍需开发。输入准备、222 项定向通过及收费停止项只维护在[当前状态审计](current-state-audit.md#新-wanx-凭据与付费前准备2026-09-10)，旧凭据历史账单不因此结清。
- 最新原生账单进展（2026-09-10）：只读 QueryBill 观察入口及安全负例已实现；始终保持待对账，不生成结算回执或晋升能力。实现范围、212 项定向通过和剩余关联门禁只维护在[当前状态审计](current-state-audit.md#阿里云原生账单观察入口2026-09-10-本地实现)。
- 最新非收费试点进展（2026-09-10）：冻结提示词与 CNY 1 整轮准备/核验命令已实现，60 项新用例和后续全量后端通过；始终不可收费。完整 preflight 曾出现一次 worker 异常退出，原因未定位，不能用分项重验冒充完整回执。证据、验证环境待查项和执行前置只维护在[当前状态审计](current-state-audit.md#wanx-cny-1-试点离线准备与核验2026-09-10-本地实现)。
- 最新受控执行进展（2026-09-10）：隔离试点的 v4 审批、持久预算/槽位和实际发送接线已完成本地测试；完整 preflight 已通过，新增 102 项 Vitest 用例、全量后端 5578 项通过。真实新通道与原生费用仍未验收；最新证据及旧 worker 异常的诊断边界见[当前状态审计](current-state-audit.md#wanx-受控执行预算与审批链2026-09-10-本地闭环)。
- 最新检查点（2026-09-10）：本地源码 `7751a722` 已完成分域审查，修复终态迟到接收证据丢失；最终完整 preflight 与 128 项隔离 PostgreSQL 回归通过。真实来源/账单取证等待独立登录会话，未发送付费请求、未推送或部署；详见[受审检查点与真实取证边界](current-state-audit.md#受审检查点与真实取证边界2026-09-10)。
- 最新只读取证（2026-09-11）：独立登录后已补齐两项真实模板发布/测试记录，并核对新 Key、业务空间及费用账户；现有数据仍不足以建立真实任务与原生账单关联。结果、私有证据摘要及后续边界见[当前状态审计](current-state-audit.md#已登录后的模板与账单只读取证2026-09-11)。
- 最新模板来源与离线编译检查点（2026-09-11）：来源导出、离线编译及原始字节保真已形成本地源码提交，Windows 测试并发配置单独提交；三条独立复核、完整 preflight、全仓类型检查/lint、sandbox 类型检查和最终代码的隔离 PostgreSQL 回归通过。尚未推送，真实任务、付费与账单关联门禁保持未关闭。提交、验证证据与下一步只维护在[当前状态审计](current-state-audit.md#模板来源与编译源码检查点2026-09-11)。
- 最新 HTTP 来源导入（2026-09-12）：原始响应到编译来源引用的离线入口已完成本地实现与验证，完整 preflight、类型检查、lint 和两条独立复核通过；T2 证据、提交与真实认证边界只维护在[当前状态审计](current-state-audit.md#http-模板来源离线导入2026-09-12)。
- 首笔实测前的真实复验（2026-09-12）：当前用户无 AI 工作流，新来源 HTTP 路由线上返回 404；指定新 Key 的对应日用量及本月账单明细为空，账户绑定重新核对通过。已用既有真实 SQL 模板与杯子测试图完成冻结源码上的离线准备；当时的顺序冲突、批准范围及私有证据保留在[当前状态审计](current-state-audit.md#真实只读复验与首笔校准准备2026-09-12)，后续实际执行见下一条。
- 首笔实测与早期观察（2026-09-12）：用户已批准并执行一次 Wanx FULL_EDIT，真实创建/轮询/下载链成功；背景未达到浅蓝灰要求，质量不通过。调用后约 32 分钟内的用量/账单观察为空，未晋升能力或重发。执行回执、启动时间误报修正和质量证据保留在[当前状态审计](current-state-audit.md#首笔-wanx-full_edit-隔离实测2026-09-12)，后续账单回显见下一条。
- 首笔账单回显与对照准备（2026-09-12）：指定 Key 显示成功一次、生成一张；原生实例的账户/Key/业务空间/模型/地区/计费项已对上，临时账单为“免费额度、应付 CNY 0”，最终结算仍未关闭。当时完成的对照准备及证据保留在[当前状态审计](current-state-audit.md#首笔账单回显与颜色对照准备2026-09-12)，后续执行见下一条。
- 最新颜色对照实测（2026-09-12）：用户已批准并完成第二笔 FULL_EDIT，技术成功，明确色号后背景仍偏灰且杯身颜色/形状发生变化，质量不通过。两笔均未重试，授权上限保守累计 CNY 0.50；17:02 用量和临时账单仍未反映第二笔费用。质量复核、执行索引和剩余验收只维护在[当前状态审计](current-state-audit.md#颜色对照-full_edit-实测2026-09-12)，未推送、部署或晋升能力。
- 最新费用验收（2026-09-12）：用户截图与官方费率一致；17:39 用量已回显两次/两张，17:45 取得两条分别匹配任务完成时间的原生明细，每条使用一张、抵扣一张、当前应付零。费率、计量及免费抵扣分支已核对，非零扣费未测试，正式结算和改图质量仍待关闭；无需为本轮另建“付费 Key”。[费用测试验收表](current-state-audit.md#费用测试验收表与双笔明细2026-09-12)维护全部证据，本轮未新增收费请求。
- 最新选区修复（2026-09-12）：Web 局部重绘不再因超过 100 笔而丢失旧选区，达到绘制上限时保留选区并提示。6 项新增回归、真实组件浏览器前后验证及 Web 类型/lint/构建通过；两次 FULL_EDIT 质量失败仍未关闭。实现、资源边界、私有证据及未验证范围只维护在[选区保留修复](current-state-audit.md#web-局部重绘选区保留修复2026-09-12)，本轮没有新增 Provider 请求或部署。
- 区域校准准备（2026-09-12）：左上 160×160 背景选区已复核，两组本地合成的遮罩外像素变化均为零。INPAINT 输入清单及当时未批准的草稿已离线核验；提案上限与前两笔保守累计 CNY 0.75/1。准备证据保留在[区域校准准备](current-state-audit.md#inpaint-左上背景区域校准准备2026-09-12)，后续授权与执行见下一条。
- 最新 INPAINT 实测（2026-09-13）：用户已批准并执行一次，28.7 秒完成，未重试；选区出现灰色面板和类文字痕迹，颜色及边界质量不通过。独立本地合成后遮罩外像素变化为零；第三笔明细已显示使用一张、免费抵扣一张、当前应付零，但当日用量统计尚未对齐，正式结算仍待验收。[实测与第三笔费用观察](current-state-audit.md#inpaint-区域实测与第三笔费用观察2026-09-13)维护完整证据；累计授权上限 CNY 0.75/1，未推送、部署或晋升能力。
- 最新离线诊断（2026-09-13）：三个真实 v1 输入在当前代码下可完整重放；新增仅澄清文字/标志规则范围的显式候选，当前托管和试点仍拒绝该候选，默认路径不变。9 项新增用例及 245 项受影响回归、server 类型/lint/sandbox 类型检查和构建通过。第三笔当日用量已在 04:16 回显并与明细对齐；候选生图效果与最终结算仍未验收。证据与边界见[提示词范围诊断与离线候选](current-state-audit.md#提示词范围诊断与离线候选2026-09-13)，没有新增 Provider 请求。
- 最新开发收口（2026-09-13）：源码 `18ec006d` 已提交并通过完整 preflight、类型/lint/构建；独立 clean 检出上的原生账单正式回放和历史预算核验通过，仍为三条免费抵扣明细、CNY 0.75/1 保守占位。第四次具体 INPAINT 的编译、准备、核验和拒绝执行的未批准草稿已完成；新请求尚未批准，质量、正常 ERP 链与完整计费验收仍待关闭。[本阶段证据](current-state-audit.md#生图实验与累计计费本地收口2026-09-13)维护冻结代码、输入及摘要。
- 最新接续实测（2026-09-14）：原终端已取得的第四次授权经未发送核验后接续，单次 INPAINT 技术成功但颜色及边界质量拒绝，累计授权占位已达到 CNY 1。118 项定向测试与独立像素复核通过；第四条原生明细已显示免费抵扣一张、当前应付零，今日用量与正式结算仍待核对。完整证据、文档漂移裁决和下一步只维护在[当前状态审计](current-state-audit.md#第四次实验接续与质量验收2026-09-14)。
- 最新离线诊断（2026-09-14）：四次 adapter 请求和冻结输入已逐项重放，未发现 prompt、函数或 mask 合同错误；官方文档确认 `strength` 不适用于 INPAINT。合成目标色/内部渐变参考已生成，仅用于解释验收阈值，不晋升 Provider 能力。质量根因和新预算仍未关闭，详情只维护在[当前状态审计](current-state-audit.md#离线质量诊断与合成验收参考2026-09-14)。
- 最新费用追踪（2026-09-14）：指定 Key 今日用量已回显 1 次，第四条原生明细为免费抵扣、当前应付零；最终账单仍未出具，继续保持待结算状态。
- 最新外部只读验收（2026-09-14）：账户身份、第四次任务 GET、今日用量和四条免费抵扣明细均已核对；线上 ERP 工作流关闭且模板 source 返回 404，正常 ERP/QA-02/QA-04/正式结算仍未完成。下一次账单最终性检查不早于 2026-10-03 12:00（北京时间）。
- 最新本地接续（2026-09-14）：已修复原终端遗留的 Wanx 门禁超时，源码核验批量化后原用例从 54.269 秒降至 7.169 秒。最终代码 `55b426fb` 的完整 offline rehearsal 九项通过，含后端 5818 项、PostgreSQL 集成/升级回放和双模式扩展；正式 QA-02/QA-04 与维护部署范围裁决仍未关闭。证据与下一步只维护在[接续门禁记录](current-state-audit.md#接续门禁失败与源码核验提速2026-09-14)。
- 维护部署收口（2026-09-15）：批准范围内的实现、完整 offline、独立源码审查、区域候选/签名、备份恢复、COM/CN 部署与维护 GET 验收已完成，临时会话及恢复库已清理。详细证据只维护在[维护阶段](stages/dark-maintenance-deployment-2026-09.md)，正式 QA、图片能力与账单状态不随维护通过而提升。
