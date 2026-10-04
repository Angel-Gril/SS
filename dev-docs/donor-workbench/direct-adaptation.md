# 旧扩展直接适配 SS ERP

## 当前结果：默认入口已公开，原版图片交互继续对齐

### 2026-10-04 最终候选前发布合同校验收口

- `102711d9 / 1.0.417` 已推送、区域签名；COM 标准部署和 canonical VPS 通过，CN 标准部署进行中。COM 通过既有带 revision 的配置 API 显式启用原 DOTH 翻译 pilot，22 项通用中文→俄文术语、配置前后原件与 CAS 回退输入均保存在私有目录；exact runtime readiness 为 READY、CNY `0.01`/张，pilot 三 operation 与原 owner/shop/device/revisions 完全匹配，CN 不改开关。尚未发出新 Provider 请求。
- `102711d9` 第二份 native offline 已通过全部前置，随后全 server 为 `6626 passed / 350 skipped / 2 failed`：`ai-media-workflows` 与 `extension-media-workflow-commands` 仍依赖全局翻译未准入作为负例。日志 SHA-256 `fbe3a299aa322dade11bb29dace9fc9a5b8b9e99fbff627f1a6ec8e64c33a718`，没有 PASS receipt。重新核对唯一 capability owner→workflow persistence→device execute 链后，仅同步测试：正常 exact registry 为正例；独立注入 characterized/missing evidence 或其他 endpoint 的负例仍拒绝且不持久化。相关七套 `229/229`、server typecheck/ESLint 通过，没有运行时逻辑改动。
- 下一最终候选使用 `1.0.418`，不覆盖 `1.0.417` 签名与失败原件。正式完整 offline 只对最终 clean commit 重跑一次；有新失败才扩大。fresh normal SUITE/正式 QA04、双区 canary、website approval、CAS 和 distribution 均尚未执行，官网仍 `1.0.405`。不限费用授权仍有效，当前本轮新增 Provider/Ozon/费用为零。
- 根工作树接续检查时为 clean，HEAD `2a4a90de` 已推送；不存在摘要中所述尚未提交的运行时修改。`lint`、workspace `typecheck`、source/Cloud/Local verifier 均通过。
- 原 `pnpm preflight` 在 sandbox Provider contract 处真实失败：注册表已记录 exact `qwen-mt-image` 翻译 transport，sandbox 审核表仍期待 `adapter-characterized`。T2 以该失败为 RED；最小修复仅同步 `official DashScope / IMAGE_TRANSLATE / public_url / async` 的精确证据断言，新增拒绝文本/编辑继承、其他端点、transport/result mode 和参考图数量扩大的回归，原 foundation contract GREEN。不修改生产 feature flag、scope 或质量结论。
- `c07531fd / 1.0.416` 区域候选已签名，双区备份恢复演练与签名包 MV3 默认入口/来源拒绝/Blob 验证通过，标准部署已发起。完整 native offline 原件在 `release-c07531fd-website/qa04-offline.log` 真实失败：默认入口测试的两处旧断言缺当前 `testOnly:false` 字段；没有 PASS receipt，不能重标或冒称通过。两处 fixture 同步后，precision/翻译关联 `136/136` 通过。
- 再复核发现正式 QA04 仍硬编码原两项 operations；新 T2 正例先 RED，再复用唯一受限 operation owner，精确原两项或显式三项均可，但前后不一致、FULL_EDIT、额外店铺及设备数增长仍拒绝。定向 `3/3` GREEN 和脚本 ESLint 通过。这是发布证据合同同步，不开启生产功能、不替代新套图原件。
- 最终候选将使用 `1.0.417` 并绑定这次完整收口后的 clean commit；`1.0.416` 原件保留，不覆盖签名。正式 native offline、fresh normal SUITE、QA04 与双区公开发布仍需在最终提交上闭合，官网仍 `1.0.405`。本项无 Provider/Ozon 写入或新增费用。

### 2026-10-04 中文→俄文受限翻译能力评审与官网发布接续

- 对既有两张校准图之外新增密集规格、S/M/L 尺寸表、彩色斜放标签、工具型号单位、透明袋日期五张合成图，每张恰好一次 Provider POST，均完成原 task polling/result GET。新增五张质量评审为 `3 APPROVED / 2 REJECTED`：尺寸表有“胸”中文字残留，密集规格标题不准确；原请求已包含对应完整术语，不重复同输入请求洗证据。合计七图 `5 APPROVED / 2 REJECTED`，任务成功不能冒充质量全部通过。
- 产品决定：正式注册的是 exact `qwen-mt-image / IMAGE_TRANSLATE / official DashScope / public_url / async` transport 能力，保持默认 PENDING 和逐图人工审核；不承诺零差错、不自动应用尺寸表或不合格标题。只准备在 COM 原 owner/DOTH/device 范围显式增 `IMAGE_TRANSLATE`，CN dark、BYOK/Ozon publisher 等其他权限保持原合同。运行时仍须当前配置、凭据修订、报价确认、日额度、同源存储、租户/草稿 authority，来源 CDN proxy 已独立匿名 GET 验证 200、实际字节 hash 相符。
- 部署与官网 canary/approval 的受限 operation 合同现在允许原 `[IMAGE_TO_IMAGE,SUITE]` 或显式 `[IMAGE_TO_IMAGE,SUITE,IMAGE_TRANSLATE]`，禁止以翻译扩大 FULL_EDIT/INPAINT/TEXT 或 owner/shop/device。门禁回归、注册/运行时/旧未冻结任务拒绝测试先 RED→GREEN；尚未修改生产开关。
- 新官网 QA04 确实拒绝旧 `58cc` execution：planner、套图恢复/尺寸、费用、schema/shared 草稿合同均变化，不能扩大中立例外复用。翻译样例不能替代正常两图 SUITE。下一候选在同一最终源码完成 fresh normal suite，保留 PENDING→preview→review→assignment/replay 全部原件，再正式 QA04、双区 canary/approval、CAS 与匿名完整下载。
- 用户本轮明确授权真实 Provider 测试不限金额，当前授权持续有效；不读取 Provider 控制台、不写 Ozon、不盲重未知 POST。图片和原 URL/凭据只在私有目录，Git 仅记录聚合范围与限制。

### 2026-10-04 `848d308a / 1.0.415` 翻译校准与双区部署收口

- `848d308ac3ab49679f61f99620c6cb3a27e9933b / 1.0.415` 已推送、签名并部署 COM/CN；COM 仍精确 DOTH pilot，CN 保持 AI/BYOK/Ozon dark。两区 runtime backup、153 migrations、DB guard、内部/公网 readiness、canonical VPS 均通过，扩展 verifier 各 `581 pass / 0 failure / 0 warning`。旧版无视频 `videoBindings` 字段兼容修复已随本候选进入。
- 用户明确授权本轮真实翻译测试不限金额。两个隔离合成校准输入分别恰好一次 POST；Container operation `zh-ru-container-415-a11ca922-1f5f-4c95-8865-f2c9008826b4` 输出 `1000×760 JPEG`，SHA-256 `425bbb2f702e6917ae654c7f2ddf408b45ec13fc115e68e600b3f466e627c181`；Shirt operation `zh-ru-shirt-415-9fd04b2d-ea29-46d7-a9c4-625bb98b924e` 输出同尺寸，SHA-256 `ad4b19d7c00abb3780bd356a8b10e8407077ec82066ebe7355b4380d3d539f2a`。每个任务均 `1 submit / 3 polls / 1 result GET / SUCCEEDED`，没有盲重试，Ozon writes=0。
- 两张输出人工复核通过：俄文标题/标签可读，中文标签已转换，数字 `30/20/5/M/1` 保持，商品图形、布局和身份保持；没有明显错位或中文残留。ERP 结算合同冻结 CNY `1 minor`/张，供应商实际账单未读取，不能把 ERP quote 当供应商发票。
- 仍未完成 production promotion：`dashscope-qwen-mt-image` registry 仍 `adapter-characterized`，需要更广真实中文→俄文语料、术语覆盖、俄文可读性/残留/布局/身份评分及正式 capability evidence；当前生产 feature/provider 仍 disabled。未来再次测试必须绑定新的输入、operation ID、批准和费用授权，不能复用本轮原件。

### 2026-10-04 图案水印、官方视频与托管翻译接线（本地完成 3/3）

- 接续发布：功能提交 `82b142c82d59034645056af08697e9f6bc99f8f3 / 1.0.414` 已推送并生成区域签名候选；签名包 COM/CN 隔离 MV3 默认入口、来源拒绝与 Blob transport 均通过。COM 标准部署已完成，CN 收尾中。最后旧 `1.0.405` client 复核发现总返回空 `videoBindings` 会违背 strict v1 响应；新增四项 RED→GREEN，两个发布 owner 现无视频时省略新增字段，有视频与 previewHash 仍完整绑定。该最小兼容修复需独立 `1.0.415` 候选，不改写已签名 414。真实翻译两张中文校准输入已准备，仅本地文件与 hash；最高 CNY 0.28 费用问题仍待用户回复，尚未发布公网输入或提交 Provider。

- [x] U6 图案水印：`source-listing-image-watermark.ts` 与现水印 owner 通过当前账号/店铺模板 ID 读取安全图案，不接受调用方 URL。原 PNG alpha 与设置透明度相乘，支持六位置、缩放、平铺；来源图、模板像素和模板版本进入预览 hash。提交期间模板归属/URL/版本变化在事务末拒绝并回滚清理。通用模板、精确店铺和现服务端兼容的旧店铺名都受归属检查。donor 原弹窗支持文字/图片切换、模板读取、预览和应用；无图案时说明 ERP 图片处理→水印模板维护路径。
- [x] U7 官方视频：新增 `source-listing-video.ts` / Prisma owner / `source-listing-video-media.ts`，当前设备、店铺、快照、草稿 r/v 与官方 schema 限权。主图/富内容按 SKU 保存、清空和幂等重放，切换 shop/snapshot/SKU/category 撤销旧绑定。compiler 保留 `complex_id`、富内容 `raVideo`，视频不进入 images；当前 schema 不支持、旧 schema、冲突 rich attributes 仍拒绝。既有 publisher 和 previewHash 包含完整视频，前端可在原窗口确认。只接已上传到 Ozon 的官方 CDN/sc-temporary 媒体；未调用旧 Cookie 私有上传，也未把普通 1688 视频直接当可发布素材。
- [x] U8 付费翻译框架：`ai-image-translation-runtime-contract.ts` 在 exact provider/model/official endpoint/input transport/async 与 sandbox capability 全量成立后才准入。paid command 必须携带当前单张 `priceConfirmation`，runtime/credential revision/currency/单价冻结进 job；CNY reservation、原 worker 原 task GET 恢复、审核与草稿应用、幂等及成功张数结算复用原 owners。已开始的未知请求不能因 flag/config 变化被误标未提交，禁止盲重试；未冻结 legacy job不晋升。Web 尚无报价确认 UI 时返回 `WEB_TRANSLATION_PRICE_CONFIRMATION_UNAVAILABLE`，不显示假可用。当前 registry `qwen-mt-image` 仍 adapter-characterized，不改 flag 或能力证据。
- 只读生产诊断：COM `556e7ca2` 的 `feature_image_translate=false`、provider disabled、model qwen-mt-image、glossary profiles=0；正单价/额度不等于已准入。没有读取 Provider 控制台或生产密钥内容，没有调用真实 Provider 或 Ozon。
- 本地验证：水印相关后端 `49/49`、视频链 `156/156`、翻译 owner/Web/审核授权定向回归通过。主 Agent 独立执行隔离 PostgreSQL 全 153 migrations，水印 `9`、视频 `4`、单张 CNY 翻译预留/结算 `3` 合计 `16/16`；schema 已删除。扩展关联 `68/68` 含 Cloud/Local package verifier；workspace typecheck/lint 通过。全后端业务 `6520 passed`，五个 HEAD 已有 Wanx fixture copier 无扩展名依赖失败，经每文件一行最小修复，原 `103/103` 测试独立通过；不拼接成新原生完整 offline 回执。
- 隔离 Chrome 整页 fixture：`ss-erp-precision-ui-evidence-ngRaO6` 图案模板→预览→应用，`Ovqs8m` 两视频槽保存与读回/来源地址拒绝，`o4pRe6` 显式单张 CNY 0.14/三张总上限 CNY 0.42 的报价确认与原编辑/审核/发布 fixture（这些价格为 fixture，非当前生产价）。一次旧 click runner 的平滑滚动将目标 205 字段错点到 201，保存/校验正确拒绝，未改业务 owner；现在坐标前等待布局并强制核验准确焦点，后续完整 fixture 通过。
- 当前这些改动尚未提交、签名或部署；运行仍 `556e7ca2 / 1.0.413`，官网 `0d695279 / 1.0.405`。新的中文→俄文质量/真实 Provider 验收仍需要独立费用授权与 exact input/credential/commit 绑定，不能用本地 paid fixture 晋升生产能力。没有新费用、Provider POST 或 Ozon 写入。

### 2026-10-04 `556e7ca2 / 1.0.413` 签名、双区部署与安装验收完成

- 功能提交 `556e7ca2b8153c8081f49e6c742911aad7f3549c` 已推送到 `feat/ai-media-prompt-registry`。最终定向后端 `237/237`、扩展关联 `96/96`、水印真实隔离 PostgreSQL `4/4`、全 workspace lint/typecheck、Cloud/Local verifier 通过。精铺图片、水印和主图＋翻译的浏览器请求为明确本地 fixture，不冒称实际生产翻译或图像质量验收。
- 同 clean commit 的 COM/CN `1.0.413` 候选分别构建并签名，保持独立 .com/.cn origins。两区标准 deployment backup/restore 均生成 target-bound attestation，临时恢复库 144/143 张表后清理；第 153 项迁移仅新增 `IMAGE_PROCESSED` enum，不改写既有资产/费用。COM 使用原 DOTH/session/scopes/rollout expectation；CN direct/RDS、AI/BYOK/Ozon dark。current、API/Worker/Web 均运行该 commit，readiness 首次 HTTP 200。
- 初次 COM full verifier 因 runtime backup 仍绑定旧 commit 失败；使用正常 runtime backup 入口刷新两区回执后，canonical VPS 均 PASS，`0 failure / 1 warning`（warning 仍为未配置远端备份）。COM evidence SHA-256 `dfb5c94fba2d583060e6c37542b8c55910b4b791457bde4b10b8a77afa210298`；CN `340f3bfc6d983a5e5f6aec4a6fccae12c2d7870bfa33b0960b79c53df4abf2f7`。签名摘要分别 `a9e693e8280afc774387d41e1eedbcbbc35c5bc2bfef30365cd87eae98a07b47`、`0554975ee862573102689e84abb1a6a65c72e04f99f34a2335ac59e2a1b42978`。私有部署/回执原件在 `release-556e7ca2-website`。
- 最终签名 COM Cloud 包在隔离 Chrome 真正安装，默认 source-page iframe、普通商品、伪造/登录页拒绝、来源图和双向 Blob transport 通过，`worktreeClean=true`，Provider/Ozon/production mutations 全 0。原验收 runner 按源码未带 `(Cloud)` 的完整名称选 Worker，第一次误拒绝已正确加载的签名包；只在本轮 ignored 适配 helper 中使用签名 manifest 的精确名称，不改变包、消息策略或原件。最终证据为系统临时目录 `ss-erp-donor-mv3-evidence-XptEle/summary.json`，候选 extension tree SHA-256 `1cb995bd8f864cecf3b68c35ec2b05eed35a4c7471ebca810e0c7738566a06d5`。两区未认证水印 preview 请求均返回 401，证明路由存在且未绕过设备身份。
- 未执行官网 approval、REL-04 publication canary、CAS 或 distribution probe；官网仍公开 `0d695279 / 1.0.405`。正式 Ozon 主图/富内容视频发布仍需独立视频 assignment/compiler；本版完成的是来源视频采集与预览。文字水印完整可用，图案水印模板尚未接入；生产图片翻译继续受现有服务端准入，不因 UI 模式启用而扩大 pilot。无新增 Provider POST、Ozon 写入或业务费用。

### 2026-10-04 水印、来源视频与 AI 主图＋翻译本地闭合

- [x] U3 水印：复用 donor 水印设置交互，服务端生成 `IMAGE_PROCESSED`，绑定当前来源快照、店铺、设备 session、草稿版本和 media slot；预览哈希、幂等 replay、CAS/上传回滚、费用为 0 均通过。应用不会把水印结果伪装为 Provider 图片。
- [x] U4 来源视频：1688 donor parser 原本已读取视频但适配层丢弃；现在 canonical capture 保留视频证据，工作台按 SKU 同窗预览，拒绝私网/非 HTTPS/任意调用方 URL。Ozon 主图/富内容视频持久化与 compiler 仍未闭合，不宣称正式发布。
- [x] U5 AI 主图＋翻译：显式 `galleryGoals: []` 贯穿计划/HTTP/扩展三层合同，报价为单张主图；主图必须完成审核后才允许提交翻译，翻译未知结果不盲重试。缺省仍保留原套图目标。
- 本地证据：服务端定向 `237/237`、水印隔离 PostgreSQL `4/4`、扩展水印 21 项、source-video 5 项、combined 4 项、刷新 8 项，MV3 source-page fixture `ok=true`；没有 Provider/Ozon/生产写入或新费用。准备下一候选 `1.0.413`，尚未签名、推送或部署。

### 2026-10-04 用户截图中的 SKU 图片交互修复（本地完成 2/2）

- [x] U1 对齐原版逐 SKU 图片表和同窗管理。用户 `103348/103406` 截图证明新版仍是下拉框/公共卡片而原版是六列表；浏览器先 RED `0 != 16`。新增 `pages/donor/sku-image-workspace.js`，按原 `image-manager-workspace-view.js::renderSummary` 与 `sku-image-workspace.js` 的表格/排序形式适配：每个当前 canonical SKU 一行，四张缩略图和剩余数量、行选择、中文任务状态；点击行打开同窗来源图片/处理结果，支持上一/下一 SKU、整草稿素材、预览、审核和应用。取消原 SKU 下拉和准备/生成/继续三个重复按钮，统一主操作；可选提示词/视觉 JSON 收入展开区。实际只选一个 SKU 的草稿仍只有一行，不把测试选择解释成采集丢行。
- [x] U2 区分成功回执与只读刷新。原 bridge 等 `loadProjection → loadBilling` 后才回成功，迟缓刷新会触发 frame 的 90 秒 mutation 超时。现在立即发送 Worker 已核验的成功回执，billing/history 等待同一次 authority refresh；成功后的只读错误提示“操作已确认，状态刷新暂未完成”，显式读取成功清提示，不盲重发审核或生成。未知/不完整 mutation、并发第二写入、迟到响应跨 snapshot 仍拒绝。最小 bridge 回归先 RED 再 `8/8` GREEN。
- 定向联合 `57/57`（含 Cloud/Local package verifier）通过，修改的运行时/新测试定向 ESLint 通过。隔离 Chrome 加载本地源码，`--sku-images` 验证 16 行→所选 2 行、SKU/整草稿切换、唯一主按钮、驳回不可应用、审核成功后只读失败/显式恢复、焦点与窄屏；`--byok-flow --translation` 验证既有编辑保存、审核/assignment、BYOK 与翻译 fixture；`--usability-only --translation-denied` 验证真实滚轮与服务端拒绝边界。证据在系统临时目录 `ss-erp-precision-ui-evidence-z7hYSH`、`ss-erp-precision-ui-evidence-AjTaaJ`、`ss-erp-precision-ui-evidence-euGeav`，不是发布回执。browser runner 原有三项 lint、bridge 原有六项 lint 已与 HEAD 对照，未冒称全仓 lint 通过。
- 水印、主图/富内容视频及“AI主图＋翻译”连续流程尚未接齐；视频列明确标记未接入，不提供假的上传/生成。生产翻译、Provider 图像质量及正式发布仍按各 owner 验收。本轮无真实 Provider/Ozon 请求、生产写入或新增费用，未提交、推送、签名或部署。

### 2026-10-04 `1.0.412` 部署与原套图恢复收口

- COM/CN 已运行 `e659d2ecc76212e43380e5492f171be070969978 / 1.0.412`；精确尺寸/原任务恢复与 status/media-history 子任务接线已进入运行版。官网仍公开 `0d695279 / 1.0.405`，没有新官网 CAS。部署原件在私有 `release-e659d2ec-website`，本轮未提交 UI 尚未进入该版本。
- 原 suite 已 `SUCCEEDED/r11`，两个原 job 均 `SUCCEEDED`，各原 CNY `0.14` 完成一次 `RECONCILED_CHARGE`；不新增 task、attempt 或 Provider POST。原 800×800 PNG 保留实际尺寸，最终为 900×1200；两图明显块状失真，已经逐槽 `REJECTED`，不能应用或宣称质量通过。草稿仍 r2/v2，assignment/Ozon 写入为零。最终原件为私有 `release-08f9b9ce-website/original-suite-readback-1791072676378.json`，不改标为新 UI 验收。

### 2026-10-04 `1.0.409` 真实三商品对照与原套图恢复

- `08f9b9ce7599f005a9971b2aa28fbbdef174ce5f / 1.0.409` 已推送、区域签名并完成 COM/CN 标准部署。COM 第一次在活动临时 session 被 `REFRESH_REUSE_DETECTED` 撤销后精确 pilot gate 失败，current 未切换；旧版三服务先正常恢复，再将未激活 release 原件移到 recoverable failed-releases，使用当前相同 owner/DOTH/权限/策略重新标准部署。CN 无阻塞。两区 full canonical VPS PASS、`0 failure / 1 warning`；warning 仍为远端备份未配置。COM/CN 摘要分别 `ace0f445edb13a8d4236b98e6eaaf8d55232edb9f679acbcb15858dba1243e23`、`8fc7a5814d79bdb4332adc299cbf301e22511555eff96305fa0ca5a30b97f931`。私有原件在 `release-08f9b9ce-website`；官网仍 `0d695279 / 1.0.405`，未执行 CAS。
- 新干净 profile 加载 1.0.409 签名原字节并正常配对，三个真实来源页分别读出 `16/35/1` SKU；在同一工作台选择 DOTH、单 SKU、采集和创建隔离草稿，没有跳转 ERP。长袖 T 恤推荐第一项为“长袖 T 恤”，卫衣推荐“连帽衫/卫衣/运动衫”，收纳盒推荐收纳类目；后者仍需用户明确选择具体用途，不能宣称自动命中百分之百。官方树、属性只读预览与类目保存均完成真实验收，截图和读回仅保留于私有证据目录。
- 原始 `CREATE_AND_REVIEW_PLAN` 两份请求/响应已完整采集：素材 alias 由后端反解当前快照原键，报价为两图/最高 CNY `0.28`；`START` 与 `CONTINUE` 各只有一次。suite `cmuswsmny000e5opv17rey53f` 两槽各 `attempt=1`，两笔原预留各 `14 minor`；本次授权已经用于这两个已接受任务，不再发新的 Provider POST。原两 job 目前 `FAILED/MANUAL_REVIEW`，预留 `RECONCILIATION_REQUIRED`、`actualCostCents=NULL/billedUnits=0`，没有伪结算。
- 只读使用同一正式 Provider `poll()` 获取既有 task 与结果：各 `1 task GET / 1 result GET / 0 POST`，两张都是 `800×800 PNG/1 page`。SHA-256 为 `cc5ab28db0a54c276e691a5492dff8be0f60b0bd50f66a46a4967ed95a8bbcca`、`e3af3ae41a2367c5ac30a09a62afa3aa47a89fdfb7aaaf698a088dc08a8eae2a`；VPS 私有原件与本机副本保持一致。对应冻结输入是清晰 `800×800 JPEG`，SHA `789a200daa6371a4b147ea82f13ab478002032f79d919f0f94005ab458f101b1`；可见块状纹理失真来自 Provider 输出。两候选不满足商品图质量，恢复后应 `REJECT`，不能为通过 gate 人工批准或 assignment。
- 精确 `800×800` fallback 的 normalizer 回归先 RED 再 GREEN，邻近 `799/801/800×799` 与 portrait profile 仍拒绝；final 仍 `900×1200 contain PNG`。实际原图宽高现在来自安全 decoder 的 `providerOutput`，不把 800px 原字节错误标为请求的 1024px；原尺寸审计的最小恢复执行测试也 RED→GREEN。
- 专用恢复复用已有超级管理员 `RESUME` 接口和 Worker reconciliation owner：只对原尺寸失败、同原 task/attempt/fingerprint/owner/预留、原接受期限内、无 final 的 Wanx 单次子任务建立持久授权；SQL 前向迁移只允许有效 lease、同事务不可变恢复审计绑定的 `FAILED → SUCCEEDED`，其余终态保持不可改。不创建新的 job、attempt、预留或 Provider POST；原失败/error 保存在不可变审计，原 CNY `0.14` 只做一次 `RECONCILED_CHARGE`，结果进入 `PENDING` 人工审核。
- 主 Agent 独立执行全部 `152` migrations 和五项真实 PostgreSQL 测试，证明旧 raw insert owner 实际拒绝、新两槽恢复、越权/过期/错 lease/task/金额/尺寸拒绝、后段触发器故障全量回滚以及完成后的 exact RESUME replay；最终后端定向 `82/82` GREEN，typecheck、ESLint 与独立源码审查通过。当前恢复修复尚未推送/签名/生产迁移；新的质量测试额度问题已询问用户，未将本次授权扩展为额外请求。
- 来源工作台历史查询原先排除了带 `suiteSlot` 的托管子任务；补齐受当前来源商品约束的 `SUCCEEDED/PARTIAL_FAILURE` 套图分支后，恢复候选可在同一草稿中显示。审核仍需逐槽明确决定，质量不合格候选必须驳回。

### 2026-10-04 真实采集参考图到托管计划的接线修复

- `cef39186 / 1.0.408` 已签名并完成 COM/CN 标准部署：151 migrations 无待执行项，suite DB guard、current 切换与 `/ready` 通过；COM 保持仅 DOTH hosted pilot，CN dark。官网仍公开 `0d695279 / 1.0.405`，本轮未执行 CAS。1.0.407/408 的 build、backup/restore 和部署原件分别保存在对应私有 `release-*-website`，不改写旧回执。
- 独立新 profile 加载 1.0.408 后，真实官方 catalog 返回约 `1,057,297` 字节，shipped Worker/client 成功解析 `50` 个首屏条目、`5` 个推荐和 `22` 个树根；在同一工作台选择长袖 T 恤、只读预览官方属性，再通过 editor owner 保存，隔离单 SKU 草稿进入 `ATTRIBUTE_REVIEW/r2/v2`。旧 profile 的重复目录替换与 Worker/资源缓存不一致原件保留；新 profile 的实际模块与接口读回才作为修复验收，不把 manifest 版本当成加载字节证明。
- “准备套图”真实路径仍暴露素材键接线缺陷：canonical capture 键是 `media:image|product_main|0|https://...`，但 frame/Worker/client/服务端输入合同要求 URL-free ID；原 UI 发送原键被 bridge 静默拒绝后等待 90 秒，服务端只读 current plan 为 null，没有 Provider POST 或费用。当前修复在扩展薄适配将已选择的 canonical 键转换为服务端已有 `media-key-sha256` 投影，plan owner 仅在当前授权候选全集中唯一反解回原键。原 source-media/翻译标识、plan 冻结原键、binding/hash、幂等和权限保持；未知、直接 URL、其他快照/SKU、重复、超量与歧义别名拒绝。
- 当前真实 precision producer 最小测试先因 `invalid donor reference selection` RED，再 GREEN；独立审查发现 digest 期间双击及 binding 变化，补两项行为 RED（进入两次编译、错误上下文仍 dispatch），修复后 producer 五项全部通过。输入在发送前通过相同 closed contract，非法输入立即 `NOT_SUBMITTED`，不再冒称未知已提交。backend plan owner `57` 项及关联 route/authority/binding `103` 项、主 Agent 综合后端 `228` 项、扩展定向 `19` 项和 donor package verifier 通过；完整精铺 `--byok-flow --translation` 浏览器 fixture PASS，明确是本地模拟外部边界。
- 实际类目推荐出现长袖 T 恤混入足球制服；共享评分已按官方具体 type 优先、检索别名限权、词项去重、长袖 T 恤/连帽卫衣/收纳盒特征与完整英文性别边界修复。七项 owner 测试先 `6 failed / 1 passed` 再 GREEN；原 Web 与扩展关联 `218` 项通过。推荐仍为候选，由用户明确选择，不自动保存、不展示伪造百分比。
- 独立审查发现 Web 的两个共享评分调用漏传官方 `typeNameZh`，造成同一“玻璃杯”在 Web 为 risky、扩展为 optional。最小真实 Web helper 回归先 RED，两个薄消费者补齐后，最终后端联合 `229/229` GREEN；不修改 Web 原有选中状态或保存权限。
- 上述计划接线与排序修复尚待新候选签名部署，再用正常配对设备完成真实两图验收。本轮已创建的旧临时 profile session 已按正常 owner 撤销，不清理用户原浏览器会话。新授权总上限 CNY `0.28` 仍未使用，Ozon 写入为 `0`；不得将当前采集、类目或 fixture 通过写成真实套图/全部功能完成。

### 2026-10-04 `1.0.406` 双区部署与真实工作台验收接续

- COM/CN 已部署 `26d3fabcd2c2ba77aae1dd3955712e953132b2ac / 1.0.406`，当前提交完整 offline 与两区 canonical VPS verifier 通过，均为 `0 failure / 1 warning`；warning 为既定远端备份未配置。COM 保持 DOTH hosted pilot，CN 保持 direct/RDS dark。官网仍为 `0d695279 / 1.0.405`，未执行新官网 CAS。私有原件在 `release-26d3fabc-website`。
- 首次 COM 部署因实际活动设备 session 与旧 expectation 不同失败；核对当前同 owner/DOTH/scopes 后，未激活 release 可恢复移入 `failed-releases`，再由标准入口部署成功。CN 原部署已经完成，后续重复部署被锁/release 保护拒绝，未覆盖既有 release；最终 current、三服务与完整 VPS evidence 已确认。
- 在独立 headed Chrome `9499` 加载签名 Cloud `1.0.406` 原字节；真实商品 `845581683597` 在同一精铺工作台读出 `16 SKU / 26 图片`。通过账户 pairing-code 与 shipped Worker claim 建立仅 DOTH、四项既有 scope 的临时测试设备，未手写凭据或 binding，未复活旧已撤销 session。来源页可信坐标点击重新读取后，正常显示 DOTH 与最新草稿状态。用户原 `9222` 浏览器会话保留。
- 复核发现新增 catalog 的服务端推荐 owner 最多返回五项，但 shipped 客户端 parser 只允许三项，四至五项会导致整份响应拒绝。修复只把接收上限对齐为五项；展示仍为前三项，六项及非法 match 继续拒绝。最小真实 parser 测试先 RED `invalid category recommendations`，修复后客户端/类目 dialog/套图主按钮 `26/26` GREEN。此修复尚未进入 `1.0.406` 签名原件，必须使用新候选验证，不改写原包或旧证据。
- 当前新一轮授权的最高 CNY `0.28` 尚未使用，未发送 Provider POST 或 Ozon 写入。真实多商品类目选择、两图套图、审核和草稿应用仍待完成，不能把部署、采集或本地 fixture 等同于完整功能验收。
- 真实 1.0.407 类目读取还发现第二个合同缺口：服务端返回的完整官方树在既定 2 MiB 响应预算内，但扩展 device transport 对所有普通 JSON 响应仍使用旧 512 KiB 上限，因而安全失败为 `source workbench response is too large`。修复只对 `/source-workbench/editor/catalog` 使用 2 MiB 上限，普通状态/草稿接口仍为 512 KiB；新增独立 transport 回归证明 1.5 MiB 类目响应可读、超过 2 MiB 仍拒绝。该修复尚未进入签名包，必须生成新候选后再继续真实类目与套图验收。

### 2026-10-03 原版扩展对照与精铺流程继续适配

- 已在独立 Chrome 中加载用户原版 `C:\Users\550W\Downloads\jp20260803`，对 1688 商品 `845581683597`、`990499606077`、`1048072018093` 做真实页面只读采集：分别读回 16/35/1 个 SKU，采集耗时约 42/36/54ms，Provider/Ozon/ERP mutation 均为 0。原版的快速采集主要由扩展本地 DOM/内嵌商品模型完成，不依赖 ERP 抓取商品。
- 原版 UI 已确认包含推荐类目卡、可展开 Ozon 类目树、叶子选择后的官方属性预览、SKU/图片管理、过程面板、批量图片翻译和 AI 套图入口；激活码、原版 Provider/API key、直接 Ozon API、debugger 和旧服务端权限不迁移。
- 现有类目错配根因已定位：SS ERP 扩展 catalog 只匹配 category/type 的四个名称字段并截断 50 项，输入“衣服”会把“衣架”等同义噪声带到首屏；新服务端 owner 已接完整目录 search、来源快照推荐、官方树预算和保存前 schema-only 属性预览。响应预算为树 5000 节点/10000 类型/32 层/1 MiB，整体 2 MiB，截断明确标记。
- 工作台已替换原生下拉为 donor 风格类目 dialog，并增加树/推荐/属性预览的 binding、revision、迟到响应和保存 CAS；套图主按钮也按 `准备 → 确认费用 → 继续 → 查看结果` 状态机运行，重复计划读取当前状态而不再次创建。
- 定向验证：服务端类目/编辑器 `25` 项、扩展类目 dialog `9` 项、suite primary action `5` 项、donor 采集 `5` 项、前端精铺/BYOK/翻译隔离浏览器流程通过；完整 donor package verifier 通过。当前改动已推送到 `feat/ai-media-prompt-registry` 的 `9c830ca3`，尚未签名/部署；未执行真实 Provider 生图，避免在新接口接线未部署前把旧套图证据当作新版本验收。

### 2026-10-03 `1.0.405` 双区官网公开发布完成

- 最终运行和公开候选绑定 `0d695279369e8fcb4cf71563c4d8a8510b580481 / 1.0.405`，包含 `93bc0879` 的工作台修复和 QA04 会话生命周期校验。`1.0.404` 保留为已签名部署、未公开候选，不列入已发布 CHANGELOG；本次公开变更按 Keep a Changelog 1.1.0 移入 `[1.0.405] - 2026-10-03`。
- 54 项 QA04 owner 回归、当前提交完整原生 offline（server `6433 passed / 331 skipped`、PostgreSQL scope `7`、AI media PostgreSQL `203`、升级回放、lint/typecheck/build/Cloud/Local verifier）通过。首次隔离 checkout 的 CRLF 源码正则失败及一次受控中断留作原件；最终完整回执来自同提交的干净主 checkout，未伪造或拼接日志。正式 QA04 SHA-256 为 `7890c01b51d072fc0c68522ef7242bd83d77201f835cfa75f0d58cb0bebf4082`。
- 原 `58cc814e` suite/START/CONTINUE/审核/assignment/费用/replay 原件保持；执行源码 bridge 通过，当前全 owner pending 五项为零，原 suite 两条 assignment 和零 Ozon 写入已只读核验。历史期间发生合法 device session 更换；当前 session 被独立核验为同 owner、仅 DOTH 与四项既有 scope。controller v2 接受设备数量不增长且其他 authority 字段全量相等，不把数量变化冒称原设备集合的纯撤销收缩，也不宣称新 session 执行过原套图。`targetUiProductionVerified=false` 与原质量限制保持。
- COM pilot/CN direct-RDS 均已标准部署，151 migrations 无待执行项、DB guard、三服务、本机/公网 `/ready` 通过。运行时与部署备份目录保持分离，新提交部署备份/临时恢复 COM `144`、CN `143` 表通过并清理。发布后正式 VPS verifier 两区均 `0 failure / 1 warning`，唯一 warning 为既定未配置远端备份。

| 发布证据 SHA-256 | COM | CN |
| --- | --- | --- |
| Release signature | `c90ac242f0818ed2e938d689b02e18b18428dad131637a6a47b065ea1949f7c5` | `55b7b64355e1eab45ef8e99975b780a120e213dff2d81547fde422bedac2818b` |
| REL-04 canary | `ace49f3c7f08447c9ca46f54ab103a863c8236a9b36cdbab352ca58caa506392` | `5c292d1f8d9d5f1f232d9fe15b34bd2a81f4ab151d3ad91514c0020539779ee1` |
| Website approval | `5a707c2e373f223359d0d67e2b907c89a7683f35228fd8f48daba25f32040995` | `0c7da2ffd18e5777df2378b362d8a32a2294c447946f206078eec17a6221ef48` |
| Distribution receipt | `94217a92792207b606435a5668e7d41f9d49a128b93c8093c0b98f9c98450703` | `0f0a475567451079ea9c8feb9561e534dd73fe7e1387006cd4717218e9054c80` |
| Post-publication VPS | `28409169d185f22bc46545e817d77b2a5476e7537692c9d2c49de056128edff7` | `7cdcf153dfc4a4f7449cea4bc4c69fea63a17cd0e3c9b803e3e96c90f28cd43f` |

- 双区官网 CAS 均 `ACTIVATED`，精确旧 approval 摘要分别为 `39c7a8a3…cef6e5022` 与 `d8a03171…1ee9423f4`。匿名完整 ZIP 下载、版本/commit/批准/字节 SHA-256 与最终 publication verifier 全部通过。COM 首地址连接超时保留失败事实，随后使用同份新鲜 Google/Cloudflare DNS quorum 中的另一公网地址 `172.67.140.112` 固定 transport，通过全部原有 TLS/同源/拒绝跳转/大小/30 秒边界；没有放宽超时或替换为元数据检查。
- 私有原件位于 `C:\Users\550W\AppData\Local\SS-ERP\private\release-0d695279-website`。canary 临时设备由原 owner 清理；CN 两个临时 account Redis sessions 已撤销，远端三个本轮凭据文件和本机四份 token 副本已删除，现有用户浏览器会话保留。本轮 Provider/Ozon 请求与新增费用均 `0`。生产图片翻译仍未开放；官网公开不等于该能力及剩余 precision 真实 Provider/BYOK/Ozon 全链已验收。

### 2026-10-03 官网 `1.0.404` 发布前置的会话生命周期校验

当前目标仍为官网公开工作台修复。`58cc814e → 93bc0879` 的正式执行源码比对通过；controller v2 的原套图记录 `deviceCount=2`，当前合法设备只读记录为 `1`，其他 owner/shop/operations/rollout/source-policy 字段相同。原校验错误地把会话过期或撤销导致的收缩当作配置变化。T2 新回归先 RED 后修复：仅后续 target cleanup 允许正数设备数量减少，其他投影字段保持全量精确相等；设备增加/零设备、店铺、操作和策略变化继续拒绝，原 v1 执行仍要求全部相等。未补配对或改写原套图原件；该校验修复需冻结新提交、新候选及部署后再消费正式发布证据。

### 2026-10-03 `93bc0879 / 1.0.404` 工作台修复签名与双区部署

- 本轮工作台修复提交为 `93bc0879db011c0587d3c04a1ef92cc2f5c88e1d`，已推送到 `feat/ai-media-prompt-registry`。Cloud/Local `1.0.404` 候选均通过包校验并使用 `ss-erp-extension-release-2026-09-05-01` Ed25519 签名；COM 签名摘要 `73b59b79511a491dd1bfc79ce30a08a7e7c51af2c6ac747ce62f8cd0a191f48c`，CN `777960acb25ebfa994511733099a1834a9bd911a2d3742b910e378c48cd914cd`。
- COM pilot 与 CN direct/RDS 均已切换到该提交，三服务 active。COM 继续原 owner/shop/session 的 hosted pilot 与 `IMAGE_TO_IMAGE/SUITE` 限制；CN 继续 AI、BYOK、Ozon dark。COM/CN migration 无待执行项，AI media suite DB guard 通过。
- 双区正式 VPS verifier 首次只读检查因运行时备份状态仍绑定旧目录而拒绝；按既有 `BACKUP_LOCAL_DIR=/var/backups/ss-erp-runtime`、`DEPLOY_BACKUP_LOCAL_DIR=/var/backups/ss-erp` 分离合同刷新运行时备份与恢复演练后重新通过。COM canonical VPS evidence SHA-256 `8fae1f67f7d512f59b6f7c4767de2441ef6ae07c5804f4fb7b8f3d4278f6eb2e`，CN `bdd935e3c17c2fcbbde953482aefa9fcd5ebd0c8e656a6140406c816c6e116ca`，均 `0 failure`。
- 官网仍安全服务已批准的 `fdee8103 / 1.0.403` pointer；本轮未执行 website approval、CAS、distribution probe 或官网 pointer 切换。Provider/Ozon 请求与新增费用均为 `0`。

### 2026-10-03 工作台滚动、翻译与编辑入口修复

- 用户反馈确认：SKU 区与图片区可以局部滚动，但外层工作台不能滚动、图片翻译按钮无效、基础信息/继续编辑入口错接。根因分别是 donor 表格 wheel handler 无条件 `preventDefault()` 加平滑逐行跳动、翻译按钮始终走套图或被初始化禁用、入口 handler 重新启动 session，以及基础信息误开 copy modal。
- `product-editor-table-behavior.js` 现在只接管横向/Shift 横向滚动，垂直方向交给浏览器原生滚动并允许边界链到 `.content`；precision CSS 使用自然纵向 flow 和外层 `overflow-y:auto`。独立真实 Chrome wheel 断言已通过（外层 `scrollTop` 变化，窗口 `1440×1100` 解决测试 compositor surface 与 DOM viewport 不一致）。
- 新增 `category-picker.js` 和 `translation-flow.js`。类目读取按草稿绑定、搜索 epoch 和 catalog revision fence，空 placeholder 必须明确选择；翻译按所选最多 5 张图片串行提交，已确认项不重复提交，未知回执锁定等待读回，明确未提交才允许继续。`CHECK_TRANSLATION` 是只读合同，bridge 再核对 handoff、店铺、草稿 revision/version、launch context 与 `IMAGE_TRANSLATE` readiness。
- 图片翻译生产准入仍由 `resolveExtensionMediaTranslationReadiness()` 管理；当前 production 返回 `MEDIA_PROVIDER_NOT_ALLOWED`，工作台显示“当前环境尚未开放图片翻译”并阻止 mutation。该 UI 接线不等于生产翻译能力已发布，也未新增 Provider/Ozon 请求或费用。
- 签名前只读复核发现未建草稿切换“仅翻译”会调用空 binding 并抛错；真实浏览器前置路径先 RED（`TGjcE3`），再补 listing/handoff guard 后 GREEN。模式选择保持可用，显示创建草稿前置条件并禁用提交；原正常采集/建草稿路径继续通过。受影响 shell/workflow/BYOK/category/translation/wheel 联合回归为 `65 passed`。
- 本轮定向合同/控制器/真实浏览器测试通过：wheel、category、translation status/flow、BYOK registration、default bridge 共 `40` 项；`--usability-only` 正例与 `--translation-denied` 均通过，完整 BYOK+translation 本地 fixture 通过（Provider/Ozon/production mutations=0）。本轮未签名、未部署、未切换官网 pointer。

用户确认以 `C:\Users\550W\Downloads\jp20260803` 的成熟界面与操作流程为基础直接改造。旧目录保持只读，实际复用的源码放在 `extensions/ss-erp/pages/donor/`，入口为 `pages/precision-workbench.html`。当前产品开发不把新一轮付费 suite 或官网发布证据作为界面、采集和草稿接线的前置条件。

之前阶段的“完成”描述证明的是当时的接口/发布边界，不等于旧扩展全部功能已经可用。COM/CN 应用和官网公开下载现均为 `fdee810303d1216d2f587d4c09c9a9f59766abed / 1.0.403`，来源页默认使用 `precision-workbench.html`，移除 preview/allowlist 门槛；安装包与来源页装配清理了旧采集、生图、审核、草稿和上架 UI，利润/物流扩展功能保留，核价面板只负责成本/利润和找货源。本次使用新区域签名候选、正式回执和 canary，未复用旧官网批准或旧面板 canary。

### 2026-10-03 精铺默认入口签名部署与官网发布

- `66161400` 默认入口/旧 UI 清理及 `fdee8103` release 权限修复均已推送；最终区域候选版本 `1.0.403` 已签名并部署两区。已完成的当前源码 preflight、默认 MV3、SKU/图片/Blob 与伪造来源拒绝证据保持其原范围，本轮未重复全仓测试。
- 接续输入 `qa04-final-input-fdee8103.json` 末尾有字面量 `\\n`，并引用旧运行的 controller；本地 `vps-COM.json`/`vps-CN.json` 同样不是有效 canonical JSON，均未被作为正式发布回执使用。761e 的套图确实被 `QA04_ERP_SOURCE_CHANGED` 拒绝；直接复核 58cc 则由当前 `verifyErpSource` 正式通过精确执行中立源码合同。原套图、START/CONTINUE、审核前 PENDING/preview、审核、assignment、费用和 replay 原件未修改。
- 当前 COM pilot/全 owner pending/最终 suite 图使用生产只读事务重新取得，绑定完整 fdee commit；pending 五项为 0，原 suite 两条 assignment 和 Ozon 零写入保持。此前创建的本轮临时配对 session 已经正常 owner 撤销，保留用户现有两台 DOTH 设备；当前策略仍只允许原 owner、DOTH 与 `IMAGE_TO_IMAGE/SUITE`。新 controller 只替换当前运行的收尾引用，不重标执行原件。正式 `QA04_FINAL_ACCEPTANCE` SHA-256：`1fcec8e30b074f2a6e11efcb6e604de4ec912fdaa9be6b0ea0b198e542eb383d`。
- 部署备份回执超过原 120 分钟期限，首次完整 VPS 检查正确失败；未放宽期限。两区标准备份/恢复刷新通过 COM 144、CN 143 张表，临时恢复库均已清理，runtime/deployment 目录保持分离。官方 verifier 随后写出有效 canonical VPS JSON：COM `90b879d263320df2daaf9ab7d0bea63ea134a723d9818dcdf7b6ca7efa75143d`、CN `692761b8c23e2d384992a0b040a3dd88ef150e4d8ea9b7957f23fd7a982e7f7c`，均 `0 failure / 1 warning`；warning 仍为远端备份未配置。
- 新 REL-04 canary：COM `c48ae0dde36859267df39acc6ef38547d0d1fb56164669c9c93b8d6869a93b13`、CN `c2bdea2bc14533e6d363052335d52001a92ef837183da11087f19ac1abc1fa73`。COM 首轮误用通用 publisher 关闭 reason 而失败；只读确认当前为 `enabled=false / legacyAllowed=false / policy_revision_mismatch` 后，第二轮绑定实际精确 reason/revision 通过，没有启用 publisher。临时 canary device 已清理，CN 是无店铺 dark canary。
- 新 website approval：COM `39c7a8a3e527aab0d1cd1671a0e6742c045acbafdcd25549aca9335cef6e5022`、CN `d8a03171ab9fcf9e4a29b7d7bc665d1e6bcaf9c7d4e8b9ef1cc06671ee9423f4`。canonical deploy lock 下两区 CAS 均返回 `ACTIVATED`，精确旧批准摘要分别为 `1da5ae08...2541d4`、`95adda74...f25bd3`。
- 官网切换后再次按 `VERIFY_EXPECT_EXTENSION_WEBSITE_PUBLICATION_ENABLED=true` 执行正式 VPS verifier，两区均 `0 failure / 1 warning`。post-publication canonical evidence：COM `e6f347f02690612f7432e0a9b148d70e50cc3d431e8f6df954014ba9c19d3567`、CN `af32870574031fda44e84fa3857798b075debbfa52c1267d8b635101390e0ce1`。CN 两个临时 account session 已从 Redis 撤销，远端三份凭据/清理文件与本机四份本轮 token 副本已删除；现有用户浏览器登录 session 未撤销。
- 匿名 distribution probe 与最终 publication verifier 均通过，完整下载四个 ZIP、核验签名/版本/commit/批准/body SHA-256。系统 DNS 返回 `ECONNREFUSED` 时，以 Google/Cloudflare 两个 HTTPS DNS 的新鲜相同公网 A 记录建立固定地址 transport；原 probe 的同源、TLS、无凭据、拒绝跳转与字节边界保持。distribution receipt：COM `5c4fcee46f3f2b58e1c7ffb83aa6ca11ca4de9338b96e70d6e83f1bf9ce3edc2`、CN `6cd8f9b88e59a9fafd8f39e29ec0d8c8f3a538a175da0623d067557c586fcc69`。
- CF 登录环境边界：9444 原实例是 headless，9222 app 登录页也曾显示 `300030`，不能把打开页面等同于验证成功。当前已登录的 COM admin 会话经 `/api/user/me` 核对为同一合法 owner，直接使用现有 account/设备 owner 合同继续，未关闭 Turnstile、伪造 challenge 或改写账户权限。此操作解除本轮发布阻塞，不宣称修好了所有浏览器的 CF；CN canary 的限时维护 session 已单独创建并完成清理。
- 本轮 Provider/Ozon 请求与新增业务费用均为 0；用户新授权最高 CNY 0.28 未使用。私有原件集中在 `C:\Users\550W\AppData\Local\SS-ERP\private\release-fdee8103-website`，不进入 Git。官网公开与默认入口已交付；复制 SKU 服务端持久化、donor 淘宝/PDD collector、翻译质量及 precision 实时 Provider/BYOK/Ozon 全链仍按各自 owner 留待后续，不被本次历史 suite 兼容证据冒称通过。

### 2026-10-02 精铺默认入口和旧模块清理

- `content/donor-workbench-bridge.js` 默认挂载并打开 `pages/precision-workbench.html`，不读取旧 preview/allowlist storage；精铺 source admission 保留精确商品 URL、配对设备、来源身份和服务端草稿/媒体权限校验。伪造来源、登录页和非商品路径仍不挂载。
- 来源页 manifest 只加载 donor collector/bridge 和独立利润核价面板；`content/source-listing-workbench.js`、旧 source costing media toolbar、旧精铺 iframe shell 不再被安装包加载。旧源文件在仓库中保留作历史对照，构建的 Cloud/Local 包排除五个旧 UI 文件。
- 真实隔离 MV3 默认验收：不写入三个旧 preview/allowlist storage key；两个 1688 商品均在原来源页打开精铺界面，16 SKU 和来源图投影通过；伪造来源/非商品 URL 拒绝；Blob 双向 transport 通过；Provider/Ozon/production mutations=0。证据：`C:\Users\550W\AppData\Local\Temp\ss-erp-donor-mv3-evidence-enE7Oq\summary.json`。该证据属于本地源码候选，尚未绑定新的签名部署。

## 唯一 owner 与数据路径

- 旧 UI/CSS、商品表格、SKU 弹窗、图片预览与缩放：`pages/donor/ui/`；`precision-workbench.js` 是调用适配层。
- 本地顺序、并发与不确定结果：`shared/donor-workbench/precision-workflow.js`。`开始执行 → REFRESH → 原 SKU 弹窗 → COLLECT → CREATE_DRAFT → 精确店铺草稿读回`，取消选择不执行写入，未知写入不重试。
- 来源数据：precision 的 1688 入口现在直接调用复用的 `content/donor/adapter-1688.js`，通过 `shared/collectors/donor-1688-capture.js` 编译成既有 canonical Capture V2。原采集器读取本页 DOM、内嵌 JSON/SKU 模型；不请求 ERP 抓取商品，也不等待原页面状态桥接。淘宝/PDD 仍使用现有 SS ERP collector，尚未切换 donor 实现。
- 投影 owner：`workspace-contract.js`，保留 canonical SKU 的价格、零库存、来源 SKU ID，并通过 `mediaKeys` 找 SKU 图；兼容 `skuItems/sourceMainImages/sourceDetailImages`。只在没有 SKU 信息时使用既有产品级降级行。
- 本地 JSON 与直接提示词编译：`prompt-adapter.js`。允许编辑构图、背景、光线和风格；商品主体/SKU 事实仍从来源投影产生。
- 自定义托管创作方向：服务端 `ai-image-creative-brief.ts` 校验有界 `creativeBrief`，`ai-media-planning.ts` 将其纳入请求指纹、冻结输入及计划 hash，`ai-image-suite-prompts.ts` 将冻结方向用于最终 Provider prompt。初始计划仍按既有来源/设备/草稿 authority 唯一绑定，改方向不能自动创建第二个计划；无字段保持原计划结构。方向不是商品事实、参考素材或权限。Wanx 最终总长度仍限 800 Unicode 字符，超限明确拒绝，不截断。
- 同窗口套图审核：iframe 只读投影保留精确 workflow/output 与可审核/应用标记，按钮调用现有 `REVIEW_SLOT`，不让套图走通用 workflow 审核。旧输出、未授权槽位及另一店铺的候选不提供操作；assignment 仍由原 store-draft owner 执行。
- SKU 图片表/同窗管理：`pages/donor/sku-image-workspace.js` 只投影当前所选 SKU、来源图和精确 SKU/product scope 的历史候选；复用 donor 六列表 CSS、缩略图和任务样式。`precision-workbench.js` 装配既有 hosted/BYOK/翻译 owner；计费、审核、assignment 和 publish 权限不进入表格 owner。
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

### 2026-10-02 用户截图复核：官网更新没有切换精铺默认入口

- 用户三张 `22:28:55 / 22:30:36 / 22:30:45` 截图分别显示旧 `source-costing-panel`、旧 `source-listing-workbench` 的“打开 ERP 创建草稿”，以及跳转后的 Web `/collect/source`；它们没有显示直接复用 donor UI 的 `precision-workbench.html`。截图本身不能证明用户实际安装版本，但签名 COM `1.0.401` ZIP 的入口代码明确保留相同路径，因此不能把该问题归结为用户没有更新或缓存。
- 入口 owner `content/donor-workbench-bridge.js` 初始 `precisionEnabled=false`，且只有 donor enabled、精确来源 allowlist 和 precision enabled 三项同时满足才挂载新界面；空 local storage 不挂载 donor trigger，仅开启旧 preview 时 `showFrame()` 调用旧 media FAB，iframe 保持隐藏。本地执行真实 bridge 的 VM 诊断三组配置重现上述区别，`DEFAULT_DONOR_DELIVERY=FAIL`；它只证明入口分流，不冒充真实浏览器完整验收，网络请求为 0。
- `source-costing-panel.js` 的八个 toolbar 按钮仍是旧流程适配；无草稿时 `source-listing-workbench.js` 显示“打开 ERP 创建草稿”，经 `onOpenWorkflowForMedia → openSourceWorkflow` 跳转。原 donor 的表格/SKU/图片 UI 与同窗 `COLLECT → CREATE_DRAFT` 已存在于新页面和 `precision-workflow.js`，但该页面不是公开安装包的默认入口。
- `1.0.401` live canary 原件记录 `unifiedMediaOpened=true / iframeSuppressed=true`；runner 只设置 donor preview 与 allowlist，未设置 precision preview，并断言旧 `media-focus` 面板和八按钮。该 PASS 证明旧统一入口及回退，不证明新精铺界面交付或无 Web 跳转。此前官网 pointer/签名/服务部署完成的事实保持，但不得将其表述为 donor 默认切换、功能完成或真实 donor 全流程通过。
- 当前产品主线仍未关闭：真实安装包打开 donor UI、在原窗完成采集/SKU/所选店铺草稿/编辑与图片流程，再完成默认入口切换。仅开启隐藏 preview 不等于完成该目标；不得通过放宽服务端权限、另发收费 suite 或重复旧 canary 代替。截图中的 `policy_revision_mismatch` 是发布能力策略版本不一致，属于另一条服务端阻塞，不是界面复用所必需的 Web 跳转。

### 2026-10-02 已确认历史恢复收口与部署修复

- 用户确认仅终止四个 9 月 29 日尺寸拒绝后的历史测试任务恢复，保留其 Provider 输出事实、失败状态和两笔已结算 CNY `0.14`；另两笔未交付 ERP 预留各 CNY `0.14` 释放。没有新 Provider/Ozon 请求或费用授权。
- `1061650a` 增加超级管理员 `ABANDON`，使用已有 `CANCELLED_OUTPUT_RETAINED` 恢复终态，记录 `OPERATOR_ABANDONED_NO_RECOVERY` 和不可变 Provider/workflow 审计；它不声称无 Provider 输出、不生成或应用图片、不把 FAILED 改成成功。迁移只允许超过 24 小时、Wanx IMAGE_TO_IMAGE、尺寸拒绝、真实 FAILED suite child 的对应终态转换；原终态不可修改。`8a72b25e` 修复生产旧函数 CRLF 与迁移匹配 LF 的差异；旧失败 migration 实际事务回滚，经标准 `prisma migrate resolve --rolled-back` 再重放，没有 `--applied` 或手工 SQL 数据改写。
- 两区已按标准入口部署 `537f9e73 / 1.0.400`，current/marker 与三服务 active 已读回；COM DOTH 受限 pilot、CN direct/RDS dark 保持。此前 `1.0.399` 候选和失败构建留作原件；失败 release 在 current 仍指向旧提交时移入 recoverable `failed-releases`，未删除旧资料。目标绑定 backup/restore 验证 COM `144`、CN `143` 表并清理临时库。
- `537f9e73` offline 完整 PASS：server `6423/325 skipped`、AI PostgreSQL `197`、151 migrations/upgrade、构建及 Cloud/Local verifier。receipt/log SHA-256 `e5d69f4285e193399bcc5a5b74312d7212faa56555cd8150e7cc1ea055cf156e` / `5ab05ef747272ba355aa4e765f535100091d34bfc6886bb4763e3c1cc6a66163`，原件在私有 `release-537f9e73-website`。不能把该回执或 `1.0.400` 签名重标给后续实现提交。
- 生产只读再次确认四项：两笔 SETTLED 均为唯一 `RECONCILED_CHARGE/14/1`，两笔 RECONCILIATION_REQUIRED 均 `NULL/0`，Provider task identity 全部与账本一致，asset 数均 0，job/workflow/suite FAILED，recovery MANUAL_REVIEW。当前实现漏掉 SETTLED 的终止恢复，最终修复现在同时核验唯一终态 settlement 和 job 金额/张数，保留已结算费用；未结算释放与两类审计、恢复终态在同一 Serializable transaction 完成。没有执行四项生产 mutation。
- T2 使用真实 planning/materialization/coordinator/repository 和全部启用的图触发器复现 SETTLED 缺口，RED SHA-256 `4ae0fed164dcd1e7a0b7f843bbe1533f8b63cb5475b3e6e47aafcbaa9b22526a`。最终 6 个新增 PostgreSQL 场景、40 个关联回归通过，覆盖两种费用、replay、终态不可改、unknown/fresh/non-suite/asset/错误身份拒绝及审计写失败完整回滚。主 Agent 串行独立 schema 复跑通过并清理，日志 SHA-256 `d8bea82247f26476a9b2155d646110944b8e86972a3bd2143c3b2504aa6ac5f2`；同时启动 migration 曾引发本机 advisory lock deadlock，失败原件另保留，不作为行为失败或通过。
- QA04 新 controller v2 将后续维护读回准确绑定 target runtime：原 suite/审核/费用/浏览器与原 execution commit 不改；before 为原 pilot，after 为当前 pilot，五项 pending 仍要求全 owner 为 0，current final suite graph 与原 restored 状态完全一致。source bridge 仍逐 Git object 限定已审阅的执行中立变更；不接受调用者放宽源码或把当前维护证据改成旧 commit。定向 RED→GREEN 与最终 producer `53/53`、ESLint 通过。正式 QA04 尚未生成，最终新 commit 仍需完整 offline、候选/签名、部署后才能执行四项收口及公开分发。

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

## 1.0.396 历史本地预览与回退

本节只保留旧预览阶段的操作记录；`1.0.403` 已默认使用 precision，下面的开关不再控制公开安装包入口。

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
- [ ] A3 完成剩余 precision 实时商品与第三方功能验收；`1.0.403` 的默认入口、签名候选、双区部署与官网发布已完成，不能替代其余功能的真实验收。

用户后续明确要求清理旧采集/生图/上架入口，保留利润等独立功能；`1.0.403` 已按此范围默认切换并公开，旧 UI 原件留在仓库历史及旧发布包中。共享权限、计费和 publisher owner 保持；A2.1 的复制 SKU 持久化与 A3 的其余第三方真实功能验收仍未关闭。
