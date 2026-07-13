# Ozon 物流规则运维与验收手册

本文用于乌拉 ERP 的 Ozon 物流规则作用域开通、候选审核、发布、设备分发、回滚和厦门试点验收。

> 当前状态：代码和自动化回归已覆盖核心合同，但真实 Seller 环境的两台设备 20 次循环尚未执行。下列验收项全部待执行，不能据此宣称试点已通过。

## 1. 数据职责

| 数据源 | 负责什么 | 不能证明什么 |
| --- | --- | --- |
| Ozon OpenAPI | 店铺实际配置的仓库和物流方式，是 warehouse/method 绑定依据 | Seller 计费公式、全平台通用费率 |
| Seller 页面采集 | 当前 company、查询位置下的物流模板、候选服务和计费公式 | 所有店铺、仓库、始发城市均相同 |
| Official / Global Calculator | 完整 fingerprint 下的官方报价样本、城市和揽收可用性 | 完整 Seller 公式目录或通用公式 |

判断顺序固定为：OpenAPI 确认真实仓库和方法；Seller 提供候选公式；Official 用完全相同的始发地、目的地、币种、申报价、重量、尺寸和单位校验；管理员确认路线、方法绑定和默认选择后发布。

## 2. 安全与环境边界

- 不上传、不保存、不导出 Cookie、Bearer Token、授权请求头、完整浏览器资料或 raw HAR。
- Seller Cookie 只留在用户浏览器。上传内容只能是规范化字段、最小作用域证据、计数和校验哈希。
- raw HAR 只作为管理员本机诊断材料；工单确需临时保存时，使用独立私有加密存储、短期保留和访问审计。
- 日常日志不得打印完整候选 JSON、响应正文、refresh credential 或 pairing code。
- local 本地版、cloud 国外 VPS、domestic 国内阿里云版使用各自独立数据库和发布指针。
- 同一规范化 JSON 可经校验后分别导入各环境，但必须独立 onboarding、预检、发布和回滚。不得跨环境复制 active 指针或租户私有发布。

## 3. Feature Flags 与认证模式

逐环境核对：

~~~env
LOGISTICS_DISTRIBUTION_ENABLED=true
SS_ERP_DEPLOYMENT_ID=<稳定且唯一的部署 ID>
EXTENSION_DEVICE_JWT_SECRET=<独立的 32+ 字符密钥>
EXTENSION_AUTH_MODE=compat
~~~

- **LOGISTICS_DISTRIBUTION_ENABLED=false**：物流分发 API 关闭。
- **EXTENSION_AUTH_MODE=compat**：迁移兼容模式。仅用于旧扩展过渡，必须显示 legacy token 风险警告并设定结束时间。
- **EXTENSION_AUTH_MODE=device-only**：Unit 9 截止模式。物流 API 只接受设备 audience/scope；旧 token 获取应提示升级或重新配对。
- **AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS** 是普通账号 JWT 的独立迁移开关，不能替代设备认证。

切换 device-only 前，确认两台试点设备均已配对、旧 session 已清理且回滚可用。不要在 20 次验收中途切换认证模式。

## 4. 管理员 Scope Onboarding

入口：ERP 超级管理员的“Ozon 物流规则发布”页面。

### 4.1 前置检查

- 核对环境和 SS_ERP_DEPLOYMENT_ID。
- 选择唯一的 tenant、Ozon shop/company、ERP warehouse 和实际 delivery method。
- 先完成 OpenAPI 仓库/方法同步；没有真实 warehouse/method 记录时停止。
- 核对仓库地址或坐标确属厦门，不得从旧厦门坐标自动推断 origin。
- 试点目的地固定 Russia / Moscow，第一阶段不包含电池货物。

### 4.2 Bootstrap 与 Probe

1. 用 tenant -> shop/company -> warehouse -> delivery method 创建 scope candidate，记录 bootstrapId。
2. 基于该 bootstrapId 签发短期 binding probe。
3. 在已配对扩展切换到正确 Ozon 公司，打开 Seller 仓库页，手动执行 probe。
4. Probe 只提交 company、warehouse platform ID 和 method platform ID；不得提交公式、Cookie 或 raw response。
5. 管理员核对 probe 与 OpenAPI 记录相交后，在同一个 bootstrapId 下确认 probe。
6. 交叉 bootstrap 证据必须拒绝。
7. 在同一个 bootstrapId 激活 China / Xiamen origin，保留核对过的 Official directory UID 和名称。
8. 确认最终 scope 同时显示 Xiamen origin 和 Russia / Moscow destination。

任一步 company、warehouse、method、origin 或 destination 不一致，都应取消 probe 并重建 candidate，不能改数据库绕过。

## 5. 候选审核、发布与回滚

### 5.1 导入规范化候选

- 只导入服务端支持版本的规范化 JSON；raw HAR 不得直达发布接口。
- 核对 source checksum、parser/schema version、capturedAt、provider 计数和作用域。
- discovered / attempted / succeeded / failed / empty 必须分开看；done/total 不是发布绿灯。
- 空、部分、未知 schema、无作用域或含凭据的数据进入 quarantine。

### 5.2 路线和方法

- 每个 selected service 必须有明确 destination route；不能把 Belarus/Kazakhstan 误标为 Russia。
- 稳定 service 必须绑定 OpenAPI 的实际 ShopDeliveryMethod；provider ID 相同不代表方法一一对应。
- pickup/courier、actual/volumetric/hybrid 和价格区间变体分别审核。
- Official 只比较完整 fingerprint；零候选或多候选保持 unresolved。
- 厦门试点 selected service 的 Official 差异不得超过 CNY 0.01。
- 活动路线需要的 provider 若 missing/failed/unexpectedly empty，阻止发布。

### 5.3 发布

1. 查看候选与 active release 的稳定服务差异。
2. 选择默认服务，确认路线、方法绑定、Official resolution 和非阻断警告。
3. 重新运行服务端 preflight。
4. 填写原因并提交 expectedSequence。
5. 记录新 sequence、content/effective checksum、active、previous 和审计事件。

草稿保存不等于发布。存在 blocker 时 active 指针必须保持不变。

### 5.4 回滚

- 选择明确的历史 release，核对 checksum，填写回滚原因并重新 preflight。
- 过期、失效或作用域不兼容的内容不得恢复。
- 回滚创建更高 sequence，不倒退序号。
- 回滚后验证两台设备取得新 ETag、active/previous 原子切换并提交 receipt。

## 6. 用户设备分发

1. 用户使用一次性 pairing code 配对当前部署和账号。
2. 设备只获得允许 shop/scope 的短期 access token 和轮换 refresh credential。
3. 扩展按 assignment 请求 effective bundle，并发送 If-None-Match。
4. 304 只更新 server-checked/authorization lease，不能延长 validUntil。
5. 200 先写 staging，再校验 schema、scope、checksum、引用、大小和兼容版本。
6. 校验通过后原子更新 pointer：新版本为 active，旧版本为 previous。
7. 写 durable pending receipt intent，再提交幂等 apply receipt。
8. 网络失败或坏包不得把有效 active/previous 清成空配置。

账号、shop、company、warehouse、ERP origin 或 schema major 改变后，必须重新解析 assignment，不能复用其他 namespace cache。

## 7. 状态处理

| 状态 | 设备行为 | 运维动作 |
| --- | --- | --- |
| valid | 正常使用 active bundle | 检查 receipt 和下一次刷新 |
| stale | 24 小时 grace 内以明显临时状态使用 last-known-good | 立即刷新或重新校验，不得延长有效期 |
| expired | 停止把 server bundle 作为有效报价依据 | 重新发布；必要时由管理员显式启用本地兜底 |
| revoked | 标记 scoped calculator 不可用，清设备授权并停止重试 | 查明原因并重新配对，不得退回其他 scope cache |

试点默认验证有效期 7 天，随后 stale grace 24 小时；实际以 release envelope 为准。

## 8. 手动兜底与支持

Seller/Official 手动采集、本地 HAR、同步 JSON 和手动重新选择物流方式继续保留，作为管理员采集、诊断和断网应急工具。它们不是普通用户日常路径；local fallback 不能静默覆盖健康的 server active，也不能自动升级为发布。

排障只记录非敏感字段：

- environment/deployment、tenant、shop、company、warehouse、origin、destination。
- assignment/channel/release、sequence、ETag、content/effective checksum。
- parser/schema/extension version、capturedAt、validatedAt、validUntil、staleUntil。
- active/previous hash、pending receipt、receipt 结果、rollback target。
- provider 成功/失败/空计数、blocker 和 Official delta。

禁止附带 Cookie、token、refresh credential、完整请求头、raw HAR 或未净化正文。

## 9. 两台设备 20 次真实验收

### 9.1 每次共同通过条件

- 命中同一个已验证 tenant/shop/company/Xiamen warehouse/Russia-Moscow assignment。
- schema/scope/checksum 正确，golden input 结果一致，Official delta 不超过 CNY 0.01。
- active/previous 不丢失、不跨 scope，receipt 持久化且幂等。
- 无 Cookie/token/raw HAR 上传或日志泄漏。
- 记录设备、时间、sequence、ETag、结果、receipt ID 和证据链接。

### 9.2 待执行清单

- [ ] 01 Device A：首次配对、200 下载、staging -> active、receipt。
- [ ] 02 Device B：独立配对、同一 release、独立 receipt。
- [ ] 03 Device A：浏览器重启后恢复 active 并刷新。
- [ ] 04 Device B：浏览器重启后恢复 active 并刷新。
- [ ] 05 Device A：相同 ETag 返回 304，不改变 validUntil。
- [ ] 06 Device B：相同 ETag 返回 304，不改变 validUntil。
- [ ] 07 Device A：离线启动，保留仍 valid 的 last-known-good。
- [ ] 08 Device B：离线启动，保留仍 valid 的 last-known-good。
- [ ] 09 Device A：恢复网络，去重并补交 pending receipt。
- [ ] 10 Device B：恢复网络，去重并补交 pending receipt。
- [ ] 11 Device A：扩展 reload/update 后 pointer 修复和刷新。
- [ ] 12 Device B：扩展 reload/update 后 pointer 修复和刷新。
- [ ] 13 Device A：发布下一 sequence，active/previous 原子切换。
- [ ] 14 Device B：取得同一新 sequence，无跨设备状态复用。
- [ ] 15 Device A：执行回滚发布，取得更高 sequence。
- [ ] 16 Device B：取得回滚 release 并提交 receipt。
- [ ] 17 Device A：receipt 网络失败后有界重试且不重复应用。
- [ ] 18 Device B：并发手动刷新被去重，active 保持一致。
- [ ] 19 Device A：再次重启、刷新、计算并核对利润/运费。
- [ ] 20 Device B：再次重启、刷新、计算并核对利润/运费。

### 9.3 立即停止条件

- 任意跨 tenant/shop/company/warehouse/scope 数据或 cache 复用。
- required cycle 的 schema/checksum/apply 失败，或 receipt 无法在有界重试内对账。
- 物流 API 5xx 阻断 discovery、pull、receipt、publish 或 rollback。
- 健康循环意外进入 no-config、stale、expired 或 revoked。
- Official delta 超过 CNY 0.01，或 golden input 运费/利润出现无法解释的差异。
- 发布指针和强制审计事件不能在同一事务完成。
- Seller 捕获为空、出现未知必需字段，或活动 provider missing/failed/unexpectedly empty。

出现任一停止条件，保留证据并回滚最后一个已知良好 release。只有 20 项全部完成、两台设备 receipt 可追溯且停止条件未触发，才能记录“Unit 9 真实验收通过”。当前结论仍为待验证。
