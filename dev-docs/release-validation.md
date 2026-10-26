# 改动范围验证与正式发布

本页负责验证范围、重复检查去重、本地执行恢复和套图证据复用；不复制产品权限、金额或发布合同。正式业务原件仍由 QA04 owner 校验，发布绑定仍由 REL04、签名批准、CAS 与匿名下载探针负责。

## 2026-10-26 原始执行与当前补充资格分离

用户已批准仅针对本次完整两图原件新增 schema6。schema1–5不变；schema6要求原配置采样发生在真实START前，
消费原launch、来源frame/草稿读回、PENDING、六组原HTTP回执、图片、两笔CNY0.10及数据库/队列/幂等原件。
历史翻译三键缺失保持缺失，不再生成假的历史完整pilot或noNewTabs结论。另取当前完整pilot（含准确逐设备店铺
范围、模型、预算）、同签名候选免费物理导航、完整targets前后列表、frame parent绑定、截图/Worker/安装树和
专用浏览器清理证明。报告明确拆开历史未验证与当前验证；不允许补充证据替代原费用/审核/首次assignment。
原生无末尾换行的JSON只在新模式按原始SHA读入，仍拒绝重复键/额外空白；不重写原件或放宽全局reader。

source bridge仅再允许此次四个独占CDP捕获器及测试从不存在到精确审核Git blob的完整过渡，标记
`REVIEWED_SUITE_CAPTURE_TOOL`；缺失一个、任意新字节、mode变化及相邻业务代码仍拒绝，不能按路径豁免未来producer。
目标提交自己的native offline、签名包、双区部署/VPS、当前只读和官网门禁仍必需。当前实现/原件与未完成状态
只维护在[直接适配记录](donor-workbench/direct-adaptation.md#2026-10-26-受控补充验收合同已获批准正在实现)。

## 2026-10-23 官网消费者兼容修复的精确原件复用

用户已明确批准每设备店铺证据的官网兼容修复、受控复用本轮465套图原件、提交签名与双区部署/公开发布，不新增Provider请求或费用。此次例外只适用于`extension-website-publication.ts`、`extensions-download.test.ts`、`extension-website-publication-approval.mjs`、`extension-release-publication.test.mjs`的已审查四文件完整Git blob迁移；准确原/目标object ID由source-bridge owner固定，并记录`REVIEWED_WEBSITE_EVIDENCE_CONSUMER`。四文件缺失、部分修复、mode变化或后续任意新内容仍拒绝；相邻Provider/金额/权限代码和其他未知路径不豁免。原suite请求、审核、账本、assignment/replay和原执行commit保留，目标仍需自己的native offline、签名安装、双区部署/VPS、最新只读模型及数据库、正式QA04和各区canary/approval/CAS/下载验证。本次不是按路径永久放宽运行TS，也不授权默认全量AI。用户随后提出的可视化权限管理属于独立功能，不混入本例外。

此精确复用路径已于2026-10-24由`a2e70f59 / 1.0.466`真实正式QA04及双区公开发布关闭；原件、新提交offline/运行验证、失败与停机事实只见[接口owner](ozon-api-compatibility-audit.md)。没有再次付费生图，不将此结果推广至后续管理UI或其他后端变更。

## 2026-10-17 多店合同受限复用的真实发布验收

用户明确批准后，四个证据消费者/测试修复 `efd4f4ad / 1.0.461` 的19项定向、152项受影响回归通过；新提交自身完整native offline、区域签名/MV3、双区部署及当前只读runtime与完整数据库图通过，原460执行/控制/两笔收费原件未修改。新schema2输入严格引用原schema1控制SHA，正式QA04确实PASS；随后双区canary/批准/CAS及四包匿名下载最终验签通过，无新Provider请求或费用。准确时间、原件SHA、两轮COM网络失败及最终成功、CN现有账号切换既有dark canary模式和清理仅维护在[直接适配owner](donor-workbench/direct-adaptation.md)。这证明本次多店验收消费者变更的受限复用路径，不泛化为任意运行代码可免费复用，不证明尚未实跑的新CSS UI producer。

## 2026-10-16 实现范围

用户已授权按改动缩短调试和发布验证，并要求提交、推送本轮优化。当前源码提交仅涉及本地脚本、验收消费者、定向测试及日志；未签名、部署或调用 Provider/Ozon。生产及官网继续 `2e97c9d3 / 1.0.458`。本地定向验证不是正式 QA04，也不允许凭其回执公开发布。

唯一清单仍为 `scripts/preflight.mjs:preflightSteps()`；`change-validation-plan.mjs` 只从此清单选择检查，`change-validation.mjs` 读取 Git 与工作树，`change-validation-runner.mjs` 执行本地命令和保存回执。输入识别或范围不确定时扩大验证，不能由调用者传入“低风险”覆盖。

## 日常修复入口

```powershell
# 默认只预览改动范围和检查清单，不执行检查或外部动作
pnpm validate:change

# 包含指定完整提交之后的已提交改动，以及当前 staged/unstaged/untracked
pnpm validate:change --since <完整40位commit> --build

# 实际运行；目录必须尚不存在且位于仓库外的私有目录
pnpm validate:change --build --run --output "C:\私有证据\new-run"

# 用上次 receipt.json 或编号 checkpoint 恢复，输出另一个全新目录
pnpm validate:change --build --run --output "C:\私有证据\new-run-2" --resume "C:\私有证据\new-run\receipt.json"
```

| 改动 | 本地选择 | 仍需验证 |
| --- | --- | --- |
| 指定 Markdown/文本文档 | diff check | 文档读回与链接；不冒充测试通过 |
| Web/扩展指定目录 CSS | 所属 Web 类型/现有 Web 合同，或扩展 verifier；可选所属构建 | 当前界面、滚动、遮挡等真实浏览器检查 |
| 普通 Web 页面/组件 | Web 类型和现有 Web 合同；可选 Web build | 原用户操作与受影响界面 |
| 明确订单 owner | 服务端类型、Vitest related；删除时完整 server test；可选 server build | 数据状态变化时数据库与线上回读 |
| 权限、设备、AI、金额、依赖、共享合同、发布脚本及未识别路径 | 原完整本地 preflight；可选完整构建 | 相应正式发布/数据库/真实业务证据 |

混合改动按更大范围处理；可执行mode、重命名来源不明、symlink/submodule/合并冲突拒绝或扩大范围。源码路径不插入 shell 命令；Windows 直接用 Node 启动 pnpm JS 入口，文件名不会进入 cmd.exe。当前流程优化自身属于发布脚本变更，因此自动选择 full，不能用它自己的“快路径”自证完成。

## 去重与本地恢复

正式 `qa:04:offline` 的 workspace typecheck 在同一父调用中成功后，内部完整 preflight 只去除已覆盖的 server/web typecheck。独立 `preflight` 仍完整；没有 skip 环境变量或命令行捷径。九阶段原生 receipt、日志阶段命令和 verifier summary 仍被原消费者严格读取。原清单的所有其他检查顺序保留；未增加无边界并发。

本地回执记录源码、依赖/配置环境摘要、命令、退出状态、耗时及原日志SHA；每步保存不可覆盖 checkpoint。恢复只允许明确列出的无外部状态 Node 合同检查，在源码/环境/命令及原日志全部一致时复用。构建、类型检查、数据库、浏览器、Provider、部署、签名和公开发布不从该缓存跳过；失败/信号/未知退出不能成为绿色。中途输入变化停止；完整源码摘要在开始/结束计算，中间只核对HEAD、Git状态、当前改动及配置，避免每一步重复读全仓。

这类 receipt 固定 `formalReleaseEvidence=false`，QA04/REL04不接受。无改动显示 `NO_CHANGES`，不显示“测试全部通过”。普通本地缓存是加速工具，不是防篡改的生产证明。

## 原始套图证据的受限复用

`qa04-suite-source-bridge.mjs` 比较原执行与目标提交的完整 Git tree，并要求原提交为目标祖先。允许指定文档或已有纯 CSS blob 变化；2026-10-17用户明确批准多店验收修复后，另只允许四个现存QA04证据消费者及其测试：`qa04-final-suite-evidence.mjs`、`qa04-final-acceptance.test.mjs`、`qa04-suite-source-bridge.mjs`、`qa04-suite-source-bridge.test.mjs`（均在scripts下）。四路径须原/目标同时存在且均100644，不允许新增、删除、可执行或symlink转换；记录独立`QA04_EVIDENCE_CONSUMER`变更种类，不豁免原业务证据。其他代码、依赖、schema、权限、manifest、配置、构建/发布脚本、证据producer/fixture/金额profile及下载service仍拒绝。CSS含外部URL、import、转义或可执行构造也拒绝。没有用静态import猜测任意业务代码“肯定无关”。

原套图的来源页、START/CONTINUE、PENDING、预览、审核、费用、assignment/replay、执行commit及其native offline原件全部保持不变。目标提交仍需自己的fresh native offline及新的双区VPS、canary、批准/CAS/下载证据。新输入可增加：

```json
"suiteReuse": {
  "currentRuntime": { "path": "私有绝对路径", "sha256": "原生只读回执的SHA256" },
  "currentUi": { "path": "私有绝对路径", "sha256": "仅CSS复用时要求的原生UI回执SHA256" }
}
```

`qa04-suite-current-runtime.mjs` 通过现有suite配置owner读取当前选用的Provider快照；PostgreSQL强制只读，输出仅模型/价格/凭据修订等合同生成的摘要，不能从旧job frozenConfig伪造current。须匹配原suiteRuntime的hash/pricing及费用合同，观察时间在目标offline之后且距核验不超过一小时。单张收费owner未改变。命令使用 `node --import ./apps/server/node_modules/tsx/dist/loader.mjs scripts/qa04-suite-current-runtime.mjs --commit <target> --output <new-private-file>`；凭据从既有私有环境注入，不写入命令参数或回执。

多店pilot原生名单须为1–50个合法、唯一ID并包含实际binding.shopId；执行前后完整授权字段仍须相同，不将单次DOTH操作误报为只授权DOTH。count费用profile的schema2后续只读清理沿用现有pending/final图完整比对、当前commit/time/readOnly及deviceCount不增长检查，并必须新增`executionControl`引用原schema1控制回执，严格核验原before/after、原模型费用profile和浏览器执行时间；不能删除BINI权限、修改原after时间或把历史任务配置当当前配置。schema1原时序及设备数量相同约束保持。新候选需完整自己的离线/签名/部署/当前runtime证据，此修复不授权新增生图、改费用或省略官网门禁。

CSS复用还由 `qa04-suite-target-ui-readback.mjs` 只读检查已打开的专用浏览器：签名候选、ZIP SHA、完整安装目录、活动Worker主文件、当前工作台可见控件、目标CSS blob与实际CSSOM、实际截图。不会导航、reload、点击、配对或提交业务请求；`--help`列出精确输入。QA04读取该截图字节和时间/commit；COM REL04再绑定当前区域签名，CN dark保留独立区域签名及同版本身份。当前producer只支持来源页工作台已加载的扩展pages CSS，Web CSS或content CSS不因此自动获准复用。目标UI仍需人工/浏览器覆盖具体改动；可见控件/截图不等于完整交互验收。

当前已用真实Git仓库和完整合成原生记录验证文档/CSS复用及负例；当前模型producer另经本机真实PostgreSQL隔离schema验证、凭据修订hash变化和清理通过。新UI producer的签名包浏览器真实运行尚未执行，本轮不声称新版生产发布流程已通过。

## 验证与剩余边界

T2先观察失败再实现；对应owner的范围选择、缓存篡改、退出传播、输入变化、Git mode、源码差异、模型配置/价格漂移、审核/费用/幂等原件与错误候选UI绑定均有定向回归。入口 `pnpm test:validation-flow` 97/97通过；正式offline合同27/27、最终QA04消费者66/66、本机PostgreSQL原生只读producer1/1通过，0 skipped。改动脚本ESLint、Node语法与diff检查通过。PG首次因localhost解析未连接本机容器，明确使用127.0.0.1后真实通过，隔离schema已删除；未使用生产连接。无需因纯文档收尾重复完整后端套件。

本轮没有改变双区部署拓扑或移除备份恢复：标准部署仍全量安装/构建。独立Web/API/扩展产物部署和跨机可验证构建缓存尚未实现；需后续在现有release/source/回滚owner闭合，不得在服务器临时跳构建。正式offline仍完整，当前去重只节省重复的两个类型检查，不宣称31分钟已经压缩到某个未经测量的数字。任意后端/下载接口变更仍可能要求新suite；本轮安全复用仅覆盖已证明的文档/样式范围。
