# 扩展产品方向（当前真源）

> 2026-11-11 由产品负责人确认。本文件是浏览器扩展方向、直连通道边界和统一界面的唯一 owner。
> 与本文件矛盾的旧文档（`dev-docs/donor-workbench/` 下的迁移方案、`docs/extension-ai-image-workbench.md`）以本文件为准。

## 目标

扩展是一个轻便、相对独立的 Ozon 上架工具，参照物是精铺上架工具（`jp20260803`）：
填 Key、选类目、点开始、出结果、上传。定位是自己和团队使用，不对外计费。

## 边界

| 事项 | 归属 | 说明 |
| --- | --- | --- |
| 来源商品采集 | 扩展 | 页面解析，不经过 ERP |
| 类目、属性、标题 | 扩展 | 本地类目目录；属性与字典直接读 Ozon |
| 生图（仅翻译 / AI 主图＋翻译 / AI 套图） | 扩展 | 直连用户自己的生图 Provider |
| 上架、库存 | 扩展 | 直连 Ozon Seller API |
| 设备授权 | ERP | 扩展通过 ERP 登录配对获得设备令牌 |
| 生成图片托管 | ERP | `POST /api/extension-device/images`，对象存储优先，按配置回退 Ozon 登录态上传 |
| 最终数据同步 | ERP | `POST /api/extension-device/direct-listings`，只记录结果，不触发 Ozon 写入 |

Ozon Client-Id/Api-Key 与生图 Provider Key 由用户填写，保存在浏览器本地（`chrome.storage.local`）。
这是已接受的取舍：自用场景下换取零配置成本；多人共用电脑时不适用。

## 规则

1. **一个功能一条路径。** 生图只有直连一条执行路径；托管套图、计费、审核、“自带 API”标签页工作台不再出现在界面上。
   新增能力时替换旧入口，不并排新增。
2. **结果必须落在同一处。** 生成的图片进入工作台的图片结果区，可勾选用于上架；不允许出现只能“打开原图”的旁路结果。
3. **失败不丢已付费的结果。** 批量生图逐张落盘，单张失败不影响已完成的图片，可只重试失败项。
4. **ERP 不可用时扩展仍可工作。** 设备未配对或 ERP 不可达时，采集、生图、上架照常；
   受影响的只有图片托管（退回 Provider 链接并提示）和最终同步（提示未同步，可重试）。
5. **一个入口，一套皮肤。** 所有页面只有一个悬浮入口（`content/ss-dock.js`），各功能以标签形式挂在它下面；
   颜色、圆角、阴影、字体、模糊强度只取自 `extensions/ss-erp/shared/ui/tokens.css`。
   接入入口的功能遵守三点：隐藏自己原来的悬浮按钮；页面加载时会自动出现的面板（例如 Ozon 商品页的数据一览）
   默认不显示，从对应标签打开，`isOpen` 只在面板真正展开时为真（否则入口会被当作“有面板展开”而收起）；
   功能离开当前页面时注销标签；站内直接切换到另一个商品时，上一个商品的面板与入口上的状态不沿用（Ozon 是单页应用，页面不会重新加载）。
6. **不暴露内部概念。** 草稿版本、执行模式、设备配对细节、内部闸门错误不出现在用户界面上。

## 冻结范围

保留代码，停止投入，不在界面上新增入口：

- Yandex Market 接入
- 独立 AI 生图工作台页（`pages/ai-image-workbench*`）
- Ozon 列表选品规则引擎
- 1688 以外的货源平台采集适配

## 仍由 ERP 服务端托管路径负责的要求

`AGENTS.md` 中关于服务端身份、租户、金额、状态机、配额与审计的红线，继续适用于 ERP 服务端和 Web。
新增的两个设备接口遵守这些红线：设备令牌 + `capture:write`、店铺归属校验、大小与类型上限、不接受客户端传入的归属字段。

## 权限说明

- 解压加载的开发版 `manifest.json` 把任意 https 主机作为安装即授予的权限；打包发布版由 `scripts/build-extension-package.mjs` 改回“可选权限”。
- 生图需要下载来源商品图（货源平台图片域名）和生图服务返回的结果图（地址由服务商决定），这些主机无法事先列举。
  因此在“设置 → 直连密钥”保存生图服务时，扩展会在用户点击内确认一次“访问所有 https 网站”的权限；已授予时不弹窗。
- 扩展页面自身不发网络请求，全部经 service worker；`verify-extension-package` 对此有检查。

## 实现入口

| 事项 | 文件 |
| --- | --- |
| 生图任务清单、执行器、落盘、上架用图 | `extensions/ss-erp/pages/donor/direct-image-flow.js` |
| 生图结果面板 | `extensions/ss-erp/pages/donor/direct-image-panel.js` |
| 生成图片托管（含降级规则） | `extensions/ss-erp/shared/ozon/direct-image-host.js` |
| 本机类目、无草稿属性工作区、ERP 同步载荷 | `extensions/ss-erp/shared/publish/direct-workspace.js` |
| 直连密钥表单 | `extensions/ss-erp/pages/donor/direct-credentials-form.js` |
| 统一悬浮入口 | `extensions/ss-erp/content/ss-dock.js`、`ss-dock.css` |
| 设计变量 | `extensions/ss-erp/shared/ui/tokens.css` |
| ERP 图片托管服务 | `apps/server/src/services/image-upload-ingest.ts` |
| ERP 上架结果同步服务 | `apps/server/src/services/direct-listing-sync.ts` |

## 验证状态（2026-11-12）

已有证据（均为本地，不联网、不产生费用、不写 Ozon）：

- 服务端：`pnpm --filter server test`（7724 项通过，0 失败）、`pnpm typecheck`、`pnpm lint`。
- 扩展 Node 测试：`scripts/extension-direct-image-flow.test.mjs`、`extension-direct-image-host.test.mjs`、`extension-direct-workspace.test.mjs`、`extension-unified-ui-theme.test.mjs`。
- 无头浏览器夹具，内存桩替代 `chrome.*`、不加载真实扩展：`node scripts/extension-direct-image-browser-smoke.mjs`
  （工作台在 ERP 未连接时加载、填写密钥、生成套图、单张失败重试、结果落盘）与 `node scripts/extension-dock-browser-smoke.mjs`
  （入口自身的行为：四个固定标签、未接入置灰、面板展开时入口收起、注销后回到置灰）。
- 真实扩展形态，Chromium 按 manifest 加载 `extensions/ss-erp`，来源页与 Ozon 页是拦截的夹具页面：
  - `node scripts/extension-dock-loaded-browser-smoke.mjs`：1688 与 Ozon 商品页上各功能的内容脚本接入统一入口、原悬浮按钮被接管、
    页面加载稳定后入口可见、皮肤变量注入到页面、从入口打开核价 / 利润 / 商品信息面板并在收起后回到入口、
    Ozon 站内直接切换到另一个商品后商品信息面板与入口状态属于新商品（面板展开着切换时保持展开）、
    Ozon 站内离开商品页后“采集 / 跟卖”“商品信息”置灰。
  - `node scripts/extension-donor-workbench-mv3-acceptance.mjs`：经弹窗和经统一入口打开工作台、工作台内投影出商品与 SKU、
    伪造的页面消息与非商品地址被拒绝。
- 浏览器夹具收尾合同：`node --test scripts/extension-browser-fixture-cleanup.test.mjs`（用例正常结束、抛错、真实扩展形态三种情况下，
  不遗留浏览器进程与临时用户目录）。
- `pnpm verify:extension`（674 项通过，0 失败）；`cloud` 与 `local` 两个构建产物通过包校验（`cloud` 为严格模式）；
  `scripts/extension-package-auto-bump.test.mjs`（升版、打包、归档校验、暂存的端到端流程）通过。

`pnpm smoke:extension:direct` 依次运行上面三个冒烟脚本。

未验证：

- 真实生图服务的出图与费用；真实 Ozon 上架、改库存；真实 ERP 对象存储托管与结果同步。
- 真实的 1688 / Ozon 页面。上面的真实扩展验收用的是夹具页面，所以宿主页自身的样式和脚本对入口与面板的影响、
  `backdrop-filter` 在真实页面上的观感、保存生图服务时的权限弹窗都没有验证。
- 打包版在只有可选权限时的浏览器内流程（构建与包校验已通过，没有在浏览器里加载打包版走一遍）。
- “仅翻译”与“AI 主图＋翻译”的翻译质量：翻译通过生图服务的图片编辑接口加翻译提示词实现，效果取决于所用模型。

这些项只能由人在真实环境里走一遍，步骤见[真实页面走查清单](extension-real-page-checklist.md)。

已知遗留：

- `scripts/*.test.mjs` 逐个运行：2026-11-12 在 `bc7ac60a` 上共 355 个文件，303 个通过，51 个失败，1 个挂起（`extension-official-attributes-readback`）；
  此后新增的 `extension-browser-fixture-cleanup.test.mjs` 通过。
  与基点 `2eb94768` 在同一环境下对照，没有基点通过而现在不通过的测试；这 52 个在基点上同样不通过，主要两类：
  测试沙箱没有加载 `shared/ui/trust-gate.js`；测试仍读取已改名的 `SS_ERP_RUNTIME_MESSAGE_POLICY`。其余多是已冻结功能
  （独立生图工作台、Ozon 列表选品）的文本断言。
- 做这类对照时有两个容易得出错误结论的地方：基点检出目录要补上 `node_modules`，否则三十多个测试会因缺依赖假失败；
  `extension-package-auto-bump`（5 到 11 分钟）、`extension-byok-workbench-package-verifier`（约 3 分钟）、
  `qa04-final-acceptance`（约 2.5 分钟）是通过的，只是慢，按 120 秒超时会被误判。
- 浏览器测试的进程清理（2026-11-12 修复）：启动的 `chrome.exe` 只是启动器，真正的浏览器进程由它拉起后启动器即以 0 退出，
  只对启动器调用 `kill()` 结束不了浏览器——夹具与两个 precision UI 测试曾因此每跑一次遗留一个无头浏览器（约十个进程、几百 MB），
  一天积累几十个后把机器的提交内存耗尽，表现为 `VirtualAlloc failed`、随机的 js 语法检查失败和浏览器起不来。
  现在三处都改为经调试连接发 `Browser.close`，由 `extension-browser-fixture-cleanup.test.mjs` 守卫；
  跑长测试若出现上述症状，先查是否有遗留的 `ms-playwright` chrome 进程。
- `scripts/extension-donor-workbench-browser-acceptance.mjs` 与 `extension-precision-browser-acceptance.mjs` 的默认场景在基点上同样失败，原因未变。
- 工作台里托管流程的代码（套图计划、审核、计费、自带 API 编辑器）仍在文件中，只是不再作为入口显示；其中 `suiteCommand` 已没有调用点。
- 包没有变轻：service worker 启动时仍加载 `shared/byok/`（43 个脚本）与 `shared/hosted/`（5 个脚本），包校验仍把它们列为必须项，
  冻结的独立生图工作台页也仍随包发布。把它们从加载链和包里摘掉需要单独的产品确认。
