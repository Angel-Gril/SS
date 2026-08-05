# 扩展 AI 图片工作台操作指南

本指南说明 SS ERP Chrome 扩展的 AI 图片工作台如何在两种明确分开的执行方式下运行：
`ERP_HOSTED`（ERP 托管）和 `BYOK`（自带 Provider API Key）。它面向管理员、店铺
操作者和试点验收人员；它不是启用付费 Provider、Ozon 写入或生产流量的授权。

所有开关默认关闭。实际可用性还取决于管理员策略、设备/店铺授权、草稿上下文和模型能力
证据。页面显示“未就绪”时，应先按本指南排查，而不是通过浏览器开发工具、旧扩展包或
直接调用接口绕过限制。

## 两种执行方式

| 项目 | `ERP_HOSTED` | `BYOK` |
| --- | --- | --- |
| Provider 调用方 | ERP 服务端 | 扩展后台 worker |
| 费用 | ERP 给出权威报价、最高费用确认、预留与结算 | 费用由用户自己的 Provider 账户承担；ERP AI 生成费用为 0 |
| API Key | 由 ERP 管理员配置的服务端 Provider 使用 | 用户仅在扩展设置页加载到当前浏览器会话 |
| 候选图 | ERP 任务、审核和候选资产链路 | 先在扩展内审核，再交给 ERP 接收 |
| 最终上架 | 既有 ERP/Ozon 发布器 | 同一个既有 ERP/Ozon 发布器 |

`BYOK` 只绕过 ERP 的 AI 生成计费；它不绕过设备、店铺、草稿版本、素材校验、审核、
发布授权、发布回执或 Ozon 对账。扩展不会保存 Ozon 凭据，也不会直接调用 Ozon Seller API。

## 管理员：先做受控开通

### 1. 先确认当前发布状态

进入管理员后台的“设置”页面，在 AI 分组查看以下配置。它们均为默认关闭，不能因为
页面已经出现工作台入口就假定生产执行可用。

| 配置键 | 作用 | 建议顺序 |
| --- | --- | --- |
| `feature_extension_hosted_ai` | 允许扩展发起 ERP 托管 AI 任务；仍要通过服务端 Provider、报价和租户门禁 | 在准确的托管 Provider 验收后再开 |
| `feature_extension_byok_ai` | 允许自带 API Key 的图片生成 | 先在单一试点范围启用 |
| `feature_extension_byok_ingest` | 允许已审核的 BYOK 图片由 ERP 校验、标准化、存储并绑定草稿 | 在生成质量确认后启用 |
| `feature_extension_byok_publish` | 允许已绑定的 BYOK 素材进入既有发布流程 | 最后启用，且只给批准的试点 |
| `extension_byok_admin_policy` | BYOK 的范围、来源、操作与并发白名单 | 先保存并复核，再打开对应开关 |

`ERP_HOSTED` 还需要管理员在 AI 生图 Provider 设置中配置服务端 Provider、模型和费用
控制。它与用户的 BYOK 档案是两套配置：不要把用户的 Key 复制到管理员后台，也不要把
服务器的 Provider 凭据放进扩展。

托管页面显示的“最高费用”是用户授权 ERP 为这次操作保留/结算的成本上限，不是第三方
Provider 的技术消费限额，也不表示最终一定会收取该上限金额。Provider 侧仍应单独配置余额、
预算或消费告警。

当前 `QA-02`（准确付费 Provider 的 endpoint/model/operation sandbox 验收）未完成时，
这些开关不能替代批准流程。先记录准确 endpoint、模型、凭据修订、最高费用、计费核对
路径和明确审批，再执行受限的付费验收；不要重复结果未知的请求。

### 2. 配置 BYOK 管理策略

`extension_byok_admin_policy` 必须是严格 JSON。默认安全值如下：

```json
{
  "contractVersion": "extension-byok-admin-policy/v1",
  "revision": 0,
  "mode": "off",
  "ownerUserIds": [],
  "shopIds": [],
  "deviceSessionIds": [],
  "allowedOrigins": [],
  "allowedOperations": [],
  "maxConcurrency": 1
}
```

策略三种模式：

- `off`：所有 BYOK 能力关闭。
- `pilot`：必须同时列出精确的 owner、店铺和设备会话 ID；缺任一项即失败关闭。
- `global`：不再按 owner/shop/device 缩小范围，但仍必须配置来源和操作白名单。只应在完成
  试点、费用和安全审查后使用。

下面是只允许一个试点店铺执行文生图的示例。示例中的 ID 必须替换为 ERP 已识别的实际
记录，不要填邮箱、手机号、Key、Bearer 值或其他密钥。

```json
{
  "contractVersion": "extension-byok-admin-policy/v1",
  "revision": 1,
  "mode": "pilot",
  "ownerUserIds": ["user-pilot-001"],
  "shopIds": ["shop-ozon-pilot-001"],
  "deviceSessionIds": ["device-session-pilot-001"],
  "allowedOrigins": ["https://provider.example.com"],
  "allowedOperations": ["TEXT_TO_IMAGE"],
  "maxConcurrency": 1
}
```

规则如下：

- `allowedOrigins` 是精确的公开 HTTPS origin，例如 `https://provider.example.com`；不能带
  路径、查询参数、片段、账号密码、localhost、内网、通配符或私有 IP。若用户的 Endpoint
  是 `https://provider.example.com/v1`，策略中仍填它的 origin，而非 `/v1` 路径。
- `allowedOperations` 只能选 `TEXT_TO_IMAGE`、`IMAGE_TO_IMAGE`、`FULL_EDIT`、`INPAINT`。
  文生图验证成功不代表参考图、整图编辑或局部重绘已被验证。
- `maxConcurrency` 只能是 1–4；正式 `sandbox-pilot` / `publish-pilot` verifier 要求精确为 1。
- 每次策略范围或开关改变时递增 `revision`，便于审核人员识别配置变更。
- 不得在策略 JSON 中填写 API Key、Authorization、密码、URL 查询参数或 Provider 私有链接；
  解析器会拒绝这类值。

推荐顺序是：保存 `pilot` 策略 → 开启生成 → 审核质量与账单 → 开启结果接收 → 仅在完整
草稿/发布演练后开启发布。关闭策略或任意对应开关都会使未授权路径失败关闭，不应改用旧版
扩展来绕过。

部署暗态由 `verify-ai-media-dark.sh` 固定验证 `off`。准备试点快照时，命令形状为：

```text
node scripts/verify-extension-byok-rollout-policy.mjs <sandbox-pilot|publish-pilot> <system-config-rows-json> <exact-expectations-json>
```

expectations 必须逐项列出 hosted 开关、revision、owner/shop/device、origin 和 operations。该
命令只验证配置快照，不调用 Provider、不改开关，也不构成 pilot 审批。

## 用户：配置自带 Provider

### 1. 创建无密钥档案

从扩展“设置”打开“AI Provider 设置”，或从 AI 图片工作台点击“Provider 设置”。
选择已连接且已授权的测试店铺后，新建档案并填写：

1. 档案名称（仅用于本机识别）；
2. Provider Endpoint（公开 HTTPS API Base；裸域名会规范化到标准 `/v1`，已有自定义前缀会在其后补 `/v1`）；
3. 模型标识；
4. 该档案允许的图片操作。

保存的档案只含非秘密元数据（档案名称、Base URL、模型、允许操作和偏好可持久化在扩展的
`chrome.storage.local`）；API Key、能力证据和未决请求状态位于扩展后台的
`chrome.storage.session`。Endpoint 或模型变更会清除会话 Key 与相关能力证据；操作变更后
必须重新检查相应能力。关闭设置页或工作台本身不保证立即清除会话 Key。若管理员未允许该
origin、店铺、设备或操作，页面会显示“运行许可未就绪”，保存档案不能绕过此限制。

扩展升级后，旧档案中的裸域名或未带 `/v1` 的自定义前缀会执行一次安全迁移。迁移会先物理
删除该档案的会话 Key、能力证据、未决探针和 Provider dispatch 记录，再写回规范化 API Base；
用户需要重新加载 Key 并逐操作验证能力。IP literal、单标签域名和含歧义路径的旧档案会失败
关闭，不会静默沿用旧授权。

### 2. 加载 Key 与授权精确来源

在“API Key”区域输入 Key 并点击“加载密钥”。Key 只在扩展后台的 `chrome.storage.session`
中用于当前浏览器会话：输入框会清空、Key 不会回显，也不会写入 ERP、内容脚本、普通页面
DOM（包括来源商品页）、URL、`chrome.storage.local` 或 `chrome.storage.sync`。浏览器会话
结束、清除会话 Key、设备断开或 Endpoint 重绑后，需要重新输入。仅关闭设置页不保证立即清除。

随后直接点击“授权此来源”。浏览器只会申请精确 Provider 来源权限，而不是泛用的所有网站
权限；实际授权覆盖该 `scheme + host + port` 的所有路径（例如 `/v1` 以及同 origin 的其他
路径），并不是只授权某一个 images endpoint，且必须由一次真实点击触发。Provider 返回的
图片若托管在另一个 origin，下载可能需要该结果 origin 的独立授权；下载不会携带 Provider
Authorization，也不使用 Provider cookies。完成测试或不再使用该 Provider 时，点击“撤销
权限”，再点击“清除会话密钥”。精确权限不等于 Provider 已通过隐私、合规、DNS 或数据保留
审查。

### 3. 分操作验证能力

在“模型能力证据”中逐项验证。每项证据绑定 Endpoint origin、模型、操作和请求模式，并有
有效期：

- `TEXT_TO_IMAGE`：文生图；
- `IMAGE_TO_IMAGE`：参考图生成；
- `FULL_EDIT`：整图编辑；
- `INPAINT`：局部重绘。

能力验证可能触发第三方 Provider 的计费。先在 Provider 控制台确认价格、余额和适用条款；
不要把“文生图可用”当成编辑类操作可用的证据。管理员策略、浏览器权限、会话 Key 和该操作的
有效能力证据缺一不可。

同步 Provider 执行采用 240 秒后台截止时间，为 MV3 Worker 在五分钟事件上限前保留结果加密、
回执和未知结果落盘时间；能力验证与单图工作台的页面响应窗口为 315 秒。交互式单图生成不会在
另一个 Provider 请求后排队：没有即时容量时会在发送 Provider 请求前失败。超时后的请求仍按
`UNKNOWN_OUTCOME` 处理，不会因为延长等待而自动重试。

## 从候选图到发布

1. 从已授权的来源商品/草稿上下文打开工作台，核对 Ozon 店铺、草稿版本、SKU 与目标槽位。
2. 选择执行方式。
   - `ERP_HOSTED`：创建事实受限的计划，审核计划与权威报价，确认最高费用后才启动。候选仍
     要逐项审核，批准后才可写入 ERP 草稿。
   - `BYOK`：选择已验证的档案、操作、参考图或遮罩和提示词。Provider 结果先在扩展内审核；
     它不会直接上架。
3. 审核候选图的商品主体、文字、比例和已知事实。驳回会删除本地候选；批准不等于已进入 ERP。
4. 对 BYOK 候选点击“接收已保留图片”或“接收并绑定 ERP 草稿”。ERP 会验证图片格式与资源
   限制、规范化并哈希字节、存储素材，并把它精确绑定到当前草稿、SKU、槽位和版本。草稿变化
   时必须重新读取并审核，不能把旧候选强行写入新草稿。
5. 发布前核对 ERP 权威的店铺、草稿版本、SKU 和图片顺序，勾选最终确认后才提交。发布通过
   既有授权、队列、发布回执与对账链路执行；`PENDING` 只表示等待核对，不是可以再次提交的
   信号。

重新生成也可能产生费用。工作台会要求重新确认：托管模式确认 ERP 的最高追加费用，BYOK
模式确认外部 Provider 可能再次扣费。

## 恢复与故障处理

| 页面状态或错误 | 正确处理 |
| --- | --- |
| 策略/店铺/设备/来源未就绪 | 让管理员检查对应开关、`pilot` 范围、origin 和操作；不要修改扩展代码或手工放宽权限。 |
| Key 不可用 | 回到 Provider 设置重新加载当前会话 Key；不会从任何持久位置恢复 Key。 |
| 缺少来源权限 | 在设置页直接点击“授权此来源”；确认 Endpoint 的 origin 与策略白名单一致。 |
| 缺少能力证据 | 只对当前 Endpoint、模型、操作和请求模式执行受控验证；不要用另一操作的成功记录代替。 |
| `UNKNOWN_OUTCOME` 或 Provider 请求结果未知 | 假定 Provider 可能已接收或扣费。不会自动重试；先刷新状态、查看 Provider 控制台/请求记录和账单。只有查询证据、稳定幂等证据或明确接受重复扣费风险后，才创建新的请求；排队但尚未提交的任务可以取消，已提交的远端任务不保证能取消。 |
| 扩展后台重启/浏览器会话结束 | Key 与部分临时授权会被清除。先重新连接、检查能力与未完成任务；不要把“页面恢复”当成 Provider 未执行的证明。 |
| ERP 接收未知、待处理或本地回执保存失败 | 对同一候选使用“核对接收回执/接收已保留图片”，不要重新生成。只有 ERP 明确 `NOT_COMMITTED` 时，才可能以同一幂等身份重传同一图片字节。 |
| 草稿已变化 | 从来源商品页重新打开工作台，读取当前草稿后重新审核。 |
| 发布结果待核对 | 使用“核对发布结果”，不要重复点击“确认提交 Ozon”。一个草稿版本只能沿同一发布回执恢复。 |

如需紧急停止，用户先清除会话 Key 并撤销来源权限；管理员把策略切回 `off` 并关闭相应功能
开关。不要删除已经绑定的资产或发布回执来“重置”，它们仍是审计和对账证据。

## 隐私、数据与费用

- Prompt 与所选图片会发送到该 Provider；仅提交您有权处理、且符合 Provider 条款的数据。
  供应商可能在其自身系统中记录或处理这些数据，SS ERP 无法替代您对其隐私、留存、地域和
  计费条款的审查。
- `ERP_HOSTED` 也不是“数据永远留在 ERP”：ERP 服务端会把对应的 Prompt、负面 Prompt、尺寸、
  参考图、原图或 Mask（取决于操作）发送给管理员配置的外部 Provider。Hosted 与 BYOK 的区别
  是调用方和计费归属，不是“一个出网、一个不出网”。

| 操作 | 发送给 Provider 的数据 |
| --- | --- |
| `TEXT_TO_IMAGE` | 模型、Prompt、负面 Prompt、尺寸 |
| `IMAGE_TO_IMAGE` | Prompt、所选参考图和必要的尺寸/操作参数 |
| `FULL_EDIT` | Prompt、原图和必要的编辑参数 |
| `INPAINT` | Prompt、原图、PNG Mask 和必要的编辑参数 |

- BYOK 的 API Key 不发送给 ERP。ERP 接收到的是用户明确批准的候选图片字节及必要的绑定、
  哈希和非秘密溯源信息；溯源记录使用 Prompt、来源/参考图和结果的哈希，不保存 API Key、
  Authorization、原始含密 URL 或图片 Base64。
- 已接收的图片本体会由 ERP 校验、规范化、存储并绑定草稿（本地或经配置的 OSS-compatible
  存储后端）；ERP 不是“只保存哈希”。之后适用 ERP 的素材、草稿和发布审计规则。
  BYOK 生成的 ERP AI 生成费用为 0，但外部 Provider、网络、订阅、存储或正常 ERP 服务费用
  不会因此自动免除。
- 托管模式的报价、最高费用确认、预留和结算由 ERP 负责；用户不应在扩展里填写服务器 Provider
  的凭据。
- 不要在提示词、文件名、策略 JSON、截图、工单或聊天记录中粘贴 API Key、Bearer token、
  Provider 私有 URL、真实客户个人信息或不必要的商品敏感资料。

## 管理员试点验收清单

在扩大范围前，至少确认：

1. cloud/local 扩展包为当前版本，设备、店铺和来源草稿均为试点范围内的真实授权对象；
2. 双包来自一次 `pnpm package:extension`，版本一致，SHA-256 与 canonical release evidence
   复验通过，并已另行取得真实签名和官网分发回执；
3. `pilot` 策略只包含最小 owner/shop/device/origin/operation 集合，`maxConcurrency` 为 1；
4. Provider 能力证据精确匹配 endpoint、模型、操作和请求模式，且未过期；
5. 已审阅 Provider 定价、外部费用上限、未知结果处理和账单核对路径；
6. 已完成候选审核、ERP 接收、草稿绑定、发布预览与单一发布回执恢复的演练；
7. 只有在准确付费 `QA-02`、安全/计费回归和发布审批都完成后，才考虑扩大开关或改为
   `global`。
