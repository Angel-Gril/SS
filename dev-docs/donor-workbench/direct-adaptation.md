# 旧扩展直接适配 SS ERP

## 当前结果：默认入口已公开，原版图片交互继续对齐

### 2026-10-06 类目确认后的权威刷新修复，准备 `1.0.431`

- 用户截图复现：类目弹窗已读取属性，但只选中推荐卡片没有完成保存，过程窗口仍显示“确认官方类目”；此前即使点击确认，保存回执先返回、权威 projection 后刷新，也可能让下一阶段读取旧草稿版本，底部留下“官方属性与当前草稿不一致”。
- 修复：`saveEditor('CATEGORY')` 在确认 mutation 后等待 `REFRESH` 和一次 `EDITOR_READ`，成功后才调用 `resumeAfterConfirmedStep`；刷新失败保留已保存状态并提示显式“重新读取”，不会重复类目写入。类目对话框属性读回后按钮改为“确认类目并继续”，过程和准备栏按钮统一为当前工作台样式。
- 定向 `52 passed`（含类别保存刷新顺序、类目树/属性预览、草稿读回、连续准备和商品分析），隔离 Chrome `--complete-preparation-flow` 与 `--preparation-analysis` 通过；Provider/Ozon/费用均为0。本轮尚未提交、签名或部署，线上仍为 `98f94f1e / 1.0.430`。

### 2026-10-06 `98f94f1e / 1.0.430` 工作台调度与 AI 入口双区公开发布

- 最终修复提交 `98f94f1e2e1854238a54d8fc2b90e4a7b27e6b12` 已推送并双区标准部署、官网公开；U25/U26已闭合。COM/CN三服务和db/Redis健康，官网latest与四个Cloud/Local ZIP都绑定`1.0.430`。COM商品分析true/`qwen-vl-max`、CNfalse、BYOK generation/ingest/publish false，由实际配置读回确认。没有新Provider/Ozon请求或费用，没有读取供应商控制台。
- 最终clean commit完整原生offline PASS，服务端`6960 passed`、真实PostgreSQL scope撤销7项及AI事务210项、迁移升级、lint/typecheck/Server/Web build/双包均通过。正式QA04 SHA `8701118eee1ebf2c2476b8d022a37f6f1f8676edc2f20a99276a6175a9e5fbe0`；producer明确核验服务端执行源码与425suite一致，保留原execution commit、审核和assignment/replay原件，未重新收费。此前中间preflight未完成记录保持原事实。
- 两区候选从Git原始字节构建，使用keyring中现有ACTIVE Ed25519 `ss-erp-extension-release-2026-08-02-01`，未创建或轮换密钥；两份实际签名ZIP通过隔离MV3来源页、默认入口、透明外壳、来源拒绝和图片显示验收。Cloud ZIP SHA COM `40f55684d6c56bfdcf063689f8a5f863f384b3053be3d2f10d803fa9b09c71d7`、CN `4a46335bc75c4cd626e94c9a5b07ba21bd89cd3a7132c6c0bbc54119e6696ead`；Local ZIP SHA COM `b6b01eb5d469c2645f2193f4397ea859e802b28ec9f081e9f9199027877b5d12`、CN `ad1b69fd551e30149a56be7f3905b1da6f62b6f0fc82a71f0a1abfa9d4cb8c5d`。
- 两区部署前和运行后backup/restore通过，COM144/CN143张表，临时恢复库已清理，deployment/runtime目录分离。初次external adapter的Git archive受Windows CRLF转换使gate与原始源码不同，标准部署正确拒绝并未切换current；逐文件与Git blob核对后，以原LF字节安装gate并将未激活release/gate移入私有证据目录，失败原件可恢复，无绕过比较。CN常规备份自动清理了一份超过七天且无部署证据引用的旧备份；本轮新备份仍保留。
- 双区canonical VPS与REL04 canary PASS；canary SHA COM `521a6ba486c0fd8aa83839b2a332e73686b2676d88416f7def26f8845f4cf2dc`、CN `f7e19a85a9560de0d3b4f3bd0822f11d5505bb3db6173280f84224d56897e850`。原pilot owner/shop/三operation保持，仅由当前合法session读回更新准确期望，未扩大店铺权限；COM临时canary设备session由原owner清理，CN走no-shop暗态路径。
- Website approval SHA COM `80be56a0492ce9180bd5cb1467d0d90c32fd86b9a7506e91470c62ed8790b384`、CN `03b42cd1a58fe5b3ea1334df4394c16f3f34bed08d4c67dd0d0aeeb920ff4565`；CAS严格绑定旧429approval和当前运行release封存包/签名。初次传入暂存候选路径被拒绝，无指针变化，修正实际运行路径后通过，未改产品owner。Google/Cloudflare两家公共DNS一致、原生固定公网TLS/大小/重定向验证和匿名完整Cloud/Local下载通过，distribution SHA COM `f287b0683d00371275f772a29908abff548571eff9b7fb1db4050dbacaa37007`、CN `e0b4e05e8ac60f28a14407d43c179d1c4fb798f7653e5f4835b2ee24843379c1`；final publication verifier均PASS。
- 私有原件只在 `C:/Users/550W/AppData/Local/SS-ERP/private/release-98f94f1e-deploy430`、`release-98f94f1e-website` 与区域候选/签名目录。临时account会话及本机/远端token文件按本轮精确key清理，原用户浏览器未接管。本次验证关闭读取调度/连续入口问题；广泛真实商品AI输出质量与原工具所有功能100%一致仍不宣称通过。更新日志严格按Keep a Changelog将本轮条目从Unreleased转入公开发布日期。

### 2026-10-06 工作台读取竞态与 AI 入口修复，准备 `1.0.430`

- [x] U25 读取调度：真实 bridge 行为新增四目标 RED→GREEN。editor 只读不占全局 mutation 锁，相同消息复用一个 Worker 请求；读调用等待原保存及其权威刷新，重复 projection 刷新共用一次读取。editor mutation 仍互斥，拒绝明确为 `NOT_SUBMITTED`；未知写入不重发、迟到读回和六字段 binding fence 保留。
- [x] U26 连续分析入口：官方属性 `load(true)` 等待原读取完成或共同返回失败，不再提前进入缺 schema 的分析；AI 按钮走同一采集/SKU/类目/分析流程，确认类目后自动继续，刷新后的原候选先恢复而不重新开始整条流程。准备窗口显示草稿、SKU、类目、字段与图片的具体下一步，并提供只读重试；并发准备/分析共用原任务及一次费用确认。
- 测试分类为 T2（调度、原请求复用、上下文漂移、失败恢复）和 T3（原窗口连续操作）。桥接、属性、入口与分析窗口目标在旧行为上明确 RED，修复后最终关联 `86 passed`；扩展源码 verifier `611 pass / 0 failure / 0 warning`。独立复核又收口提交前读取不能代替提交后读取、手动刷新不能释放写入锁、suite/assignment恢复后排队读取不悬挂。新行为回归已纳入 preflight；server/shared/依赖、权限、金额和数据库结构未改。
- 隔离 Chrome 连续分析/原请求恢复/候选编辑审核/BYOK设置通过，证据 `C:/Users/550W/AppData/Local/Temp/ss-erp-precision-ui-evidence-bPdIZt`；完整商品准备、多店后续输入、属性/物流/文案/图片明确审核通过，证据 `ss-erp-precision-ui-evidence-F4Qc58`。初次回归暴露刷新恢复候选时误启动准备队列，失败原件 `ss-erp-precision-ui-evidence-6yBpTr` 保留，修正后新鲜通过；fixture 模型结果不冒充真实生产质量。
- AI入口真实物理点击从无草稿→SKU→类目→一次分析/原请求恢复通过（`ss-erp-precision-ui-evidence-7YWUjI`）；失败读取一次→点击刷新→一次恢复读取和可编辑表格通过（`ss-erp-precision-ui-evidence-K8xVsf`），无保存/模型/上架请求。源码默认 MV3 来源页/透明壳/伪造来源拒绝通过（`ss-erp-donor-mv3-evidence-42gNPL`）。为避免重复执行完整发布套件，中间 preflight 停止于打包版本回归，不冒充完整PASS；最终 clean commit 将运行正式原生 offline。
- Provider/Ozon/生产写入均为 0，未读取供应商费用。本轮沿用用户既有提交、推送、签名、双区部署和公开发布授权；下一步必须绑定最终 clean commit 的 offline、签名 MV3、双区部署/VPS、正式 QA04/canary/approval/CAS/distribution。源码中间状态不宣称线上已修复；目前公开仍为 `566f146b / 1.0.429`，COM `qwen-vl-max` 分析开启、CN dark。

### 2026-10-06 `566f146b / 1.0.429` 草稿读取修复双区公开发布完成

- 用户授权继续修复、提交、推送和部署，沿用此前明确官网公开授权；最终提交 `566f146b9dc494bb581f6cf1d97b2b1757ac7b05 / 1.0.429` 已双区签名、标准部署并公开。两份428中间签名原件保留，均未部署或覆盖。源码只改扩展读取/刷新 owner 和测试；未修改 server/shared/依赖、设备权限、金额或 Provider 配置。
- 实际 `acceptEditor/loadEditor/saveEditor` 行为测试在中间代码四项目标 RED→10项GREEN，定向与关联通过并进入 `preflight`。同一binding读取失败只尝试一次、显式刷新恢复、迟到旧读回拒绝、确认保存可推进版本、原UNKNOWN写入不重发。真实隔离Chrome回归 `ss-erp-precision-ui-evidence-smMgov` 验证1次失败读取→真实点击刷新→表格可编辑，零保存请求；完整编辑浏览器 `ss-erp-precision-ui-evidence-RnvFt6` 和两个区域实际签名ZIP的MV3验收均通过。浏览器早期物理点击被类目弹窗遮挡，失败原件保留；修正脚本使用真实关闭按钮后成功，没有修改产品源码绕过弹窗。
- 最终固定提交完整原生offline（服务端6960通过、隔离PostgreSQL210事务回归和迁移升级、lint/typecheck/build/Cloud/Local）与正式QA04通过。QA04 SHA `5841d6275730b53fed2d0472c025bfb28abf08a8c8191c558e3630c3c67edd9b`；原producer确认与425执行提交server/shared/依赖完全一致，明确沿用原suite执行commit而非重标证据，本轮没有新增Provider请求或费用。
- COM/CN部署绑定备份恢复144/143张表，临时恢复库已清理，部署和runtime备份目录保持分离。公开前VPS、REL04 canary、website approval和CAS均通过；COM canary SHA `3aafc116d3102b31fc8ed6efc036d4276514172e03692250fde084c9a5058155`、CN `a358fc6cc7d454f6534a8800eb2b5e8446898ed368726951d47d6de5d8839919`。COM初次VPS因与runtime backup并行读到旧backup状态而失败，后顺序重验通过，失败日志保留。
- 官网approval SHA COM `3eb834bad5cd658e4807f36d28313287a2e2ae63576e1047ac970fcc474c7d1c`、CN `cdb79f0cf3c7c8406dbe3578a5673dc6c411b4329cb9793d5d0740c5e9a1373f`；匿名完整Cloud/Local下载及final publication verifier通过，distribution SHA COM `f5840827c747ac150dd7e7247042a92d6a410c72e064f82ccc5067b0b360ff74`、CN `44086f71eed438fc81d115bbecbfcd552bb29ccac1c404a16436323f31bdf5aa`。Cloud ZIP SHA分别`83ff6106f209460922fab67b92841e0e8a68dd7d0458848939ebe68ae576d238`、`714112bb2fdc1205c9ad655bc85e595f973f02bfd31071bbaad6e9a905d1508d`；Local两区为`0ccb0193a53cc0665410c9a15766afa35173535ed7580716130f0968bd4ebb53`。
- 发布后完整canonical VPS均PASS、0failure/1既有远端备份未配置warning，SHA COM `43e6f0f2792466eef8f4e24a4c48f2b4d34d188c1590a59ac77e195f70d569be`、CN `367f68fda143fc571e2a1eb0aa515ecf0e44f986e4b9cf57cc86e01711018b64`；三服务、db/Redis健康。配置读回COM商品分析true/`qwen-vl-max`、CN false，BYOK generation/ingest/publish均保持false。临时账号session由原owner创建并仅清理本轮key，COM/CN分别移除1/2个Redis key，远端6份及本机4份凭据文件清理；无测试设备新增或用户浏览器接管。
- 私有发布原件只保留在 `release-566f146b-deploy429`、`release-566f146b-website` 与区域candidate/signature目录，不进入Git。未证明任意真实来源图片均可加载、未知Provider分析可恢复或donor功能质量100%一致；本轮仅闭合草稿读取行为与最终公开分发。文档同步提交不重新部署或签名。

### 2026-10-06 草稿上下文刷新问题已修复，准备 `1.0.428`

- 发布前实际函数验证发现原 428 修复的失败 key 清空会引入紧密重读循环，且只读版本 fence 初版误挡正常保存回执；两份已签 428 中间候选保留但未部署/公开，不能以静态 verifier 代替时序验收。最终候选改为 `1.0.429`：完整六字段 binding key、同 key 失败停止自动读取、显式刷新后等编辑器回执再提示成功、只读回执精确 r/v、已确认保存回执允许版本推进；仅结构化 `EDITOR_CONTEXT_REFRESH_REQUIRED` 可触发一次刷新，来源/店铺/草稿身份变化不自动改绑。新实际函数测试在原代码四目标 RED→10项GREEN，关联59项通过并纳入 preflight；Provider/Ozon=0。
- 根因是首次 `EDITOR_READ` 失败后页面保留旧 `editorLoadKey`，导致后续权威 projection 不再触发编辑器重读；桥接层在 listing/handoff 暂时缺失时直接返回通用“草稿编辑上下文已变化”。
- `donor-workbench-bridge.js` 现在在 editor command 首次不匹配时执行一次 `loadProjection({ force: true })`，刷新后仍不匹配才拒绝，并返回 `EDITOR_CONTEXT_REFRESH_REQUIRED` 及设备/快照/草稿读取原因。`precision-workbench.js` 在 editor read 失败时清除 `editorLoadKey`，允许下一次状态回执重试。
- shell 合同、Cloud 包 verifier、JS syntax 和 `git diff --check` 已通过；本轮没有 Provider/Ozon 写入或费用。目标候选为 `1.0.428`，提交、签名、双区部署及官网门禁尚未执行。

### 2026-10-05 `1.0.427` 双区官网公开发布完成

- `3fdc5c430bd1d04990ba3894c2225449a855a867 / 1.0.427` 已完成签名、COM/CN 部署、最终正式 QA04、双区 REL-04 canary、website approval、CAS、DNS 分发探针和匿名 Cloud/Local 完整下载校验。COM approval SHA `9a5a11476f9772b016ceb824b5be69d5ad4fcb7066e4dc7f94093396819ac7ff`、CN approval SHA `0be7726fb10fe65159b1e64de9d588b1c567e63cfb60967bc4ba021002f874ef`；COM/CN distribution receipt SHA `5159d0f3746bb04089eec821df576c686c13460ff40789ae7a14dd234f26dbb8` / `82443958df030ea9490e3bb022026c83b6438d122b324d3a45a27a0c9f8afe88`。两区 `/api/extensions/latest` 实读均返回 1.0.427 和该 commit。
- Cloud ZIP SHA 为 COM `474850f44b2dd6e22edbb470a30a5c96948ccfbb0f9bdbee02a244c47bd63341`、CN `092fe415c015e4ec33a17fd9ae33e4ad00a80cfdad81c600b4fa877963c8064f`；Local ZIP 为 COM/CN `a8be288b258cf1240ea49151b97e44c981eb6ddba71a15c30f438ac7ab0785c0`。发布后 COM/CN 服务、数据库、Redis 均健康，canonical VPS 最终回执 PASS；备份目录 `/var/backups/ss-erp` 与 runtime 目录保持分离。
- COM 商品分析通过同窗真实流程返回严格 `product-preparation-analysis/v1`，筛图为 `KEEP`，一项官方颜色属性候选和俄文候选均标记为待确认；原先两次 UNKNOWN 操作保留且没有自动重试。随后手工去除模型输出中的未经确认材质/耐用性内容，保存并审核了独立文案候选；草稿没有提交 Ozon。COM 商品分析 Provider POST=1（此次单图候选），此前校准 POST 只用于 transport/schema 验证，费用未读取。
- 测试设备和临时账号 session 已按当前运行范围撤销/清理；清理回执只覆盖本轮创建的 session。官网公开下载现为 1.0.427；没有新增 Ozon 写入。

### 2026-10-05 公开发布与 AI 分析启用，425 消息接线修正为 426 候选

- 426 最小 wrapper 修复已签名并部署接续；真实分析窗口 `READY`，选择单图并确认后 checkpoint 写入因页面临时注册布尔失效而拒绝，服务端只读证明没有新 `precision-preparation` 操作。源码复核不支持“BYOK invalidate直接清共享注册”的推断；唯一显式共享 invalidate 位于 pagehide，当前已证实的问题是 checkpoint 依赖较早的一次注册。最终 427 适配在每次 checkpoint read/write/clear 前调用原 `registerUi`，原私有 handler 仍核对 frame/device/source/draft，注册失败则零模型调用、不自动重发。实际 adapter+session 测试原4目标失败→15项GREEN，关联68项及两文件lint通过；426原签名不覆写，最终427需新候选和发布门禁。
- 用户已明确授权官网公开切换与 AI 分析开启，既有不限金额测试授权继续有效；不执行 Ozon 写入、不读取 Provider 控制台。COM 通过带 revision 的系统配置 API 开启 `feature_extension_product_vision`，明确 DashScope compatible-mode / `qwen-vl-plus`，沿用已授权同 Provider 凭据，DOTH 返回 `READY`、每日 10 次；BYOK、生图 pilot 和 CN direct/RDS dark 未扩大。
- 425 完整原生 offline（原生全后端 `6960 passed`、独立 PostgreSQL、构建和双包）、同提交 fresh suite `cmuv9jrfj00125ozo63z4exwu`、审核前 UI/数据库、原 START/CONTINUE、两图 preview/review、r1/v1→r2/v2 assignment/replay、队列与 pending 清零、正式 QA04、双区新 canonical VPS/canary/website approval 均通过；没有执行 CAS 或 distribution probe，官网仍 `46e17e00 / 1.0.424`。两次套图 Provider submit 各成功结算 CNY0.14，输出保留收纳盒/把手/纹理但有白边且场景变化小，未宣称创意质量一致。
- 原生 QA04 SHA `ffde02952b7a5be0b9ce59517a9b41b528edd2780096e1ea5fddcc6b4a3afa00`；COM/CN canary `a6e64349ca94847eec35d3ad62cbaf4a065add4598d55bb8fa02da0de9b1d9bb` / `a25e124a9d1adc677d6de0b97652f84573880f9cc74ea1aac77d3d9e0c3d9f40`。私有原件在 `release-089eb83a-website`，失败日志和原输入保留；Windows CRLF checkout 已从原 Git 字节校正，正式 producer 未改；QA04 时间顺序通过新的只读恢复核对闭合，未改旧原件。
- 专用 profile 初次仍运行旧缓存 Worker，正常重载后真实 sender 全部字段正确，却仍被最终 `runtime-message-authorization` 的 precision surface 拒绝。legacy policy 和独立 preparation handler 已有正确合同；唯一缺口为覆盖层没有显式桥接八项 preparation 消息。最小 owner 修复只允许精确 precision iframe 并复核 legacy sender，保持 `isNewRuntimeMessageType=false` 让原独立 handler 执行；其他来源、settings/foreign、失效 binding 仍拒绝。
- 真实 Worker listener 加载两层策略的 32 项测试原先 3 项目标失败，修复后全部通过；关联共 97 项通过。425 签名候选不覆写，修复需要新的 426 候选与对应 offline/VPS/canary/approval；服务端/shared/依赖未改时由原 QA04 producer 判断是否可沿用 425 suite，不新增生图来替代已有原件。
- 首次新两图商品分析通过现有 source-page→owner 发送一次，23 秒后服务端持久操作为 `UNKNOWN`，原编号与每日额度保留，未自动重试。独立一图 transport/schema 校准恰好一次 Provider POST 成功，`product-preparation-analysis/v1` 严格 schema 通过（2611 input / 1088 output tokens）；这是诊断校准，不冒充原 UNKNOWN 恢复或成功草稿 receipt。完整同窗候选和真实模型审核仍待新候选验收；分析 Provider 费用未读取、不冒称 suite 图片计费。

### 2026-10-05 `1.0.425` 已提交、推送、签名并双区部署

- 连续商品 AI 准备、同窗候选编辑/审核、BYOK 独立分析模型、阶段恢复和透明 iframe 已提交到 `feat/ai-media-prompt-registry` 并推送，部署绑定 `089eb83ae7620aa8aaabb54e3fd2e7f801bbdf2e / 1.0.425`。完整本地 `pnpm preflight` 已通过；服务端 typecheck 现显式使用 8 GiB 堆，旧 shell 回归已同步为保留来源页滚动、去除重复遮罩的合同。变更日志按 Keep a Changelog 保留在 `Unreleased`，不将应用部署标为官网公开发布日期。
- COM/CN 的 Cloud/Local 候选分别从同一干净提交的 Git 原始字节构建，正式区域包 verifier 为 Cloud `626`、Local `616` pass，0 failure/0 warning。原 active Ed25519 key `ss-erp-extension-release-2026-09-05-01` 签名并独立验签；实际签名 ZIP 解包后的隔离 MV3 来源页、默认入口、16 SKU 投影、来源拒绝和透明外壳通过。私有浏览器适配只调整仓库/解包目录、正式 Cloud 名称及执行入口，断言和网络拦截保持；这仍是 synthetic 商品安装验收，不是真实模型质量或线上商品全链路证明。
- 两区标准部署已成功，current、API/Worker/Web 全部运行上述提交；153 migrations 无待执行项、suite DB guard、服务启动与本机/公网 `/ready` 通过，`db=ok、redis=ok`。COM 保持原 DOTH `IMAGE_TO_IMAGE/SUITE/IMAGE_TRANSLATE` 精确 pilot，CN 保持 direct/RDS dark，认证仍为既有 `compat`。`feature_extension_product_vision` 和 BYOK generation/ingest/publish 均读取为 `false`；新接口匿名参数探针返回 `401`，没有扩大生产功能或设备授权范围。
- 目标绑定部署备份及部署后 runtime 备份/恢复均完成，COM/CN 分别验证 `144/143` 张 public 表并清理临时库；部署目录 `/var/backups/ss-erp` 与日常目录 `/var/backups/ss-erp-runtime` 保持分离。两区正式 canonical VPS evidence 都为 `PASS / FULL / 0 failure / 1 warning`，warning 仅为既有远端备份未配置。
- 官网 latest 仍为 `46e17e00 / 1.0.424`。本轮未生成新正式 QA04、publication canary、website approval，未执行 CAS 或 distribution probe。部署不代表官网公开分发，也不代表生产商品分析已启用；Provider POST、Ozon 写入和新增测试费用均为 `0`，未读取 Provider 控制台。

| 证据 SHA-256 | COM | CN |
| --- | --- | --- |
| Cloud ZIP | `ed7e91b910b21c72a23b8dbd43103bc14e3f238826cc89ef935d0f170e4c859c` | `ba5a713148fd7b9ad4b1f5e02f84ab308a055e9591365a660418fb336561a49b` |
| Local ZIP | `4fb488aa4376b86c5dc9d34e6ae8942fff49d8be50ef28977182b9c0bd77da20` | `50633c4118d5e5f6f55221d2865254f714b730b08e94a374a4c92fe11f8921b8` |
| Detached signature | `dd065d291cea3797d8389010370114d8c8baf58f486ac899f1e3852c7085d946` | `e5afbd7ffe3f955586ae5a9f29325aaf2ece98027d3863f810325b2da460a804` |
| Canonical VPS | `b4803561e2661b6badaa4f6d8700b0eaa61c9d566d606c0e1f2488ab62607379` | `b193f3876c3360ebef951a04af7eed543c6f729154901e53d9c10f8ce5121d69` |

原件只保留在 `C:\Users\550W\AppData\Local\SS-ERP\private\release-089eb83a-deploy425` 及独立区域 candidate/signature 目录。准备阶段的 origin、签名权限、Windows CRLF gate、既有失败目录与验收参数错误均保留失败日志；原运行版本未在失败尝试中切换。本轮新建的错误 gate 和未激活 release 目录已清理并由 Git 原始 LF 字节重新构建，不移除旧 serving release、签名原件或备份。当前文档同步提交不重签或重部署应用。

### 2026-10-05 连续商品 AI 流程适配（当前开发，未发布）

用户已明确要求继续开发上轮差异分析中的连续流程；本轮目标为同窗采集/SKU、类目确认、图片筛选与商品视觉分析、可编辑属性/俄文文案候选、图片处理及明确审核。复用用户自有 donor 的交互和当前 ERP owner，不修改 donor 目录，不自动发布 Ozon，不改变 COM/CN 生产配置。

- [x] U21 服务端商品分析候选：按设备/店铺/来源快照/草稿版本/官方类目冻结输入，沿用安全图片下载、视觉 transport、额度和持久操作回执；支持原请求只读查询，禁止未知 POST 自动重试。视觉观察不能成为材质、重量、尺寸、认证或库存事实。
- [x] U22 连续阶段和恢复：一次分析回执提供筛图、SKU 视觉报告和文案/属性候选；同窗显示真实阶段，明确确认筛图/属性及文案保存，刷新后从已核对阶段恢复。
- [x] U23 自带 API 文字/视觉：使用 Worker 的当前会话密钥和安全来源图片；独立分析模型、独立默认关闭准入，保留原图片模型、权限、ingest 和 publisher 合同。
- [x] U24 外层与设置：恢复 donor 透明全屏 iframe，去掉额外整页阴影和来源页滚动锁；简洁设置与高级诊断分开。

唯一新报告合同为 `product-preparation-analysis/v1`，所有输出保持 `CANDIDATE`；属性应用必须读取原回执并通过现有属性 owner，文案经用户编辑保存后仍待独立审核。稳定合同、幂等、准入与恢复采用 T2 RED→GREEN；蒙版/滚动和阶段交互采用原路径隔离 Chrome T3，定向验证后才扩大受影响回归。当前 Git 基线为 `054a3f61`；本节只记录开发范围，既有 `1.0.424` 公开发布证据不证明新流程已验收。

本地开发验收已完成：服务端定向/关联 Vitest `230 passed`，本机隔离 PostgreSQL `19 passed / 0 skipped`（153 migrations，隔离 schema 已清理），服务端 TypeScript 8 GiB 检查无诊断；Cloud/Local MV3 verifier 分别 `619/615 pass`、0 failure/0 warning。隔离 Chrome 连续流程与自带 API 模型/来源授权 fixture 通过，最近证据在 `C:\Users\550W\AppData\Local\Temp\ss-erp-precision-ui-evidence-QN40Xy`；Provider/Ozon/生产写入均为 0。独立图片读取 owner 使用 `/preparation/image`，不依赖旧 hosted media 开关；生产视觉、BYOK 分析和真实费用仍保持关闭。

### 2026-10-05 `1.0.424` 双区官网公开发布完成

- COM/CN 当前应用、官网 latest 和四个匿名下载 ZIP 均为 `46e17e00622753a8f37ff501697a3cc8d2324baa / 1.0.424`。Git 已推送；完整原生 offline、签名 MV3 来源页/默认入口/Blob、备份恢复、两区 canonical VPS、正式 QA04、COM受限pilot/CN no-shop dark canary、新 website approval、CAS 和 distribution/final publication verifier 全部通过。COM DOTH `IMAGE_TO_IMAGE/SUITE/IMAGE_TRANSLATE`、CN direct/RDS dark、视觉默认关闭保持。
- 最终 suite `cmuuxrscg000c5oh1twpsc50e` 恰好两个原 Provider submit、各 CNY0.14一次结算。审核前PENDING UI及真实数据库、START/CONTINUE原始响应、两张扩展安全Blob预览、逐图审核、隔离草稿r1/v1→r2/v2两条assignment和原请求replay完整保存。待处理jobs/costs/recovery/workflows/suites均0，Ozon0，未读取Provider控制台。上一423 suite两笔CNY0.14成功结果仍按原提交/快照保留，未重标或重复派发；两轮合计ERP CNY0.56。
- 实际图片保持透明收纳盒轮廓、把手、纹理和原场景，900×1200输出有白边且创意变化很小；审核批准仅表示本次隔离草稿候选可用，不证明新场景创作质量或donor全功能100%一致。生产复制SKU Ozon发布、其他平台深采集和视觉配置等未验证范围保持原owner边界。
- 私有原件 `C:/Users/550W/AppData/Local/SS-ERP/private/release-46e17e00-website`。QA04 SHA `99cfbab54af64b2d04f13979aa22e851ac39abb7a3067d7e2ce7515d860fabda`；COM/CN canary SHA `5be85c51c7cca69218d9ef4e266a32cc7c8fa209496ebb23a50269ab8c910c38` / `275788defd457aacf0e891825d8e7cd654d1cf2a4c78ee7ca977b421b6a6f834`；approval SHA `acf54eb8897b9894b49dae82724829183d2ad78e8627cbc82d0ee2ef5965e27b` / `d0ace71d2e97904fcd6cead83e534179a185bcfd4cd72131f779c02aa08f72c9`；distribution SHA `7807446107b2d07ca7973198dfd21b2d2e83dc2c32c2464c133ba29d0548768f` / `fbd8f8aecb54dfe13d1eded16b0630e5a2bafe38537be5b319124dead0cc758e`。两区CAS原旧approval分别`d47abfdb...a79be`、`b586ea84...cb84b4`。
- 初次REL04使用本地路径派生extension ID而被生产CORS拒绝，失败原件保留；改用已有批准的区域extension origin重新运行，同commit通过，未扩大CORS。发布后 full canonical VPS 两区PASS、0 failure/1既有远端备份未配置warning，SHA分别`ba54310d1c0c6278ad8816caba40c51baba963c95615437cc1bca20878e069ae` / `3656ac7fb24ddf91d4cac8edfbc0271897410aa7958739068b7ba05a0e1704a7`。
- 当前轮QA设备由原owner正常撤销；COM/CN临时account Redis sessions分别移除1/2个（COM owner/admin同一账号产生同一key），旧临时session均已过期或失效，远端12个凭据/清理文件和本机16份token副本已删除，原用户浏览器保持。套图、草稿、已结算费用和全部验收原件保留。文档同步提交不会重部署应用或重签候选。

### 2026-10-05 `1.0.423` 双区与 fresh suite；参考图子集预览缺口修正

- `59a8454e553d0bd49320e010beb67010fe9ad717 / 1.0.423` 已推送、区域签名并双区部署；完整原生 offline 和两区 canonical VPS 均 PASS。官网下载仍 `1.0.421`，未执行 CAS。
- 同 commit 收纳盒两图 suite 已 `SUCCEEDED`，恰好两次 Provider submit、两笔各 CNY 0.14 结算；生成 UI、START/CONTINUE 原件和审核前数据库（两槽 PENDING、空 assignment）已保存。预览返回 `409 hosted_candidate_preview_not_available`，只读 loader 证实 plan 的所选参考图 hash 与原完整授权 catalog hash 不同；尚未批准或应用，Ozon=0。
- T2 两个 owner 先实测 RED→GREEN；新增统一冻结参考选择校验，预览核对 plan input asset hash 与原 catalog seal，assignment 核对同一 seal，缺失、篡改或额外字段继续拒绝。原 binding/hash 不改写。定向139项、真实 PostgreSQL210项（含单参考图 preview→assignment→原幂等 replay）、8GB typecheck及相关 lint 全通过；修复候选为 `1.0.424`。PG先前失败原件保留，schema实际列名 `input_snapshot_json` 已核对修正，不修改schema。
- 私有原件在 `release-59a8454e-website`。原 suite 结果保留并可在修复后恢复；最终发布 QA04 需要新执行提交原件，既有不限测试金额授权仍有效，不读取 Provider 控制台、不发布 Ozon。

### 2026-10-05 官网升级接续：正式 PostgreSQL 夹具接线修复

- 用户已明确授权官网最新版公开切换，此前测试费用授权仍有效；不得执行 Ozon 发布或读取 Provider 控制台。`d376bb1a / 1.0.422` 已部署，但尚无该提交的正式 QA04/REL-04/website approval，不能直接 CAS。
- 正式 offline 在独立 checkout 暴露本机 Prisma Client、LF 与数据库连接配置缺口；完整 preflight、server/Web build 已通过，失败原件保留。真实隔离 PostgreSQL `208/209`，唯一失败为旧 hosted-plan 夹具未提供新版 `loadListingDraft`，生产装配已提供该 owner。T1 原失败边界已实测，夹具改用既有草稿服务并保持原计划幂等、变更拒绝和零费用断言。
- 已使用签名 1.0.422 专用 profile 正常配对并从真实 1688 收纳盒取得新快照、空图片 r1/v1 隔离草稿。旧已应用图片草稿保持原状。Provider/Ozon=0；修正后需形成新候选 `1.0.423`，完成同 commit 原生 offline、真实 suite/审核/assignment/replay，再走双区发布门禁。

### 2026-10-05 `1.0.422` 已提交、推送、签名并双区部署

- `d376bb1a49f071f9c9b4eca1615c33539e61c7c2` 已提交并推送；COM/CN `1.0.422` Cloud/Local 候选完成签名、隔离 MV3 安装验收和标准部署。COM/CN 当前 release 均为该 commit，`/ready` 返回 db/redis ok，canonical VPS evidence 通过；备份恢复分别读回 COM 144 张表、CN 143 张表。部署输出与签名原件保存在 operator-private release 目录，不进入 Git。
- COM 保持原 DOTH owner/shop/设备范围及 `IMAGE_TO_IMAGE/SUITE/IMAGE_TRANSLATE` 受限 pilot，CN 保持 direct/RDS、AI/BYOK/Ozon dark。没有 Provider/Ozon 新请求或费用。
- 官网 approval、CAS、distribution probe 和公开 pointer 切换尚未执行，官网仍服务 `4df9ec38 / 1.0.421`。这次用户授权覆盖了提交、推送、签名和部署，不自动扩大到官网公开切换或真实 Ozon/Provider 写入。

### 2026-10-05 `1.0.422` 发布准备（已授权提交、推送、签名、双区部署）

- 用户已明确授权本轮提交、推送、签名和 COM/CN 部署，撤销此前“全部完成前不提交”的发布等待。目标候选版本为 `1.0.422`，通过原发布脚本生成，不改写源 manifest 的历史 `1.0.264`。候选必须绑定最终 clean commit，COM 维持既有 DOTH 三 operation pilot，CN 维持 direct/RDS dark；新视觉配置默认关闭。
- 发布前审查修复非空复制行缺少 provenance 时跳过校验的问题：完整草稿 ID、快照/hash、r/v 和原复制事件缺一则拒绝；无副本的旧薄草稿兼容。新增 helper/复制/垂直编译 `28/28`，加现 hosted plan 回归合计 `85/85`。旧计划调用断言新增内部 listingDraftContext，原 HTTP 未开放该字段；`57/57` 通过。
- 默认 4GB Node 堆使完整 preflight 的 server typecheck OOM，8GB 运行通过类型检查；第一次全 server 的唯一失败为上述旧测试参数，修正后重新执行完整门禁。独立 PostgreSQL 的11项、Server/Web build、两类扩展包和浏览器证据均保持对应真实范围。没有用失败日志写出 PASS 或重标旧 release 原件。
- 最终完整 preflight 在 8GB Node 堆下全部通过（包括全 server 和源扩展 verifier `586/586`）；Server/Web 生产构建、最终 helper/plan `85/85` 和独立 PostgreSQL `11/11` 复验通过。最新 PG 原件 `ss-erp-product-vision-pg-ta2a2d/summary.safe.json`，output SHA `725cb9b114883cf4c2d8e6d1832d8b6dfa58d898e5b85545aa9daa488285f9e9`。107 个明确项目路径已检查，不包含 env、密钥、profile 或临时发布原件。
- 当前准备形成最终发布提交和区域候选签名/双区切换；运行与官网下载仍 `4df9ec38 / 1.0.421`。官网 website approval/CAS/分发 probe 不在本次四项授权内，更新日志继续保留 `Unreleased`；没有新 Provider/Ozon 请求或费用。

### 2026-10-05 自动属性、物流定价与连续准备（本地验收完成）

- 用户要求所有功能与验收完成后再提交、推送或部署。本轮没有 Git 提交、签名、部署、官网 CAS 或生产配置修改；运行/下载仍为 `4df9ec38 / 1.0.421`，本地 HEAD 为 `d76698d9`。下方历史“未实测”描述按本节新增证据更新，不能据此宣称 donor 全功能或线上新接口已经通过。
- [x] U14 自动属性：设备 editor 增只读 `/attribute-suggestions` 与 `ATTRIBUTE_SUGGESTIONS` 保存动作，复用可信来源、逐 SKU 标准字段和官方词典候选。设备只能提交当前 schema、candidate ID/hash，服务端重新核对；保存保留 SOURCE/provenance，不伪造 MANUAL、尺寸、材质或认证。品牌、颜色、尺码、材质、性别、季节的来源映射可用，未匹配字段继续手填。候选窗口核对当前快照/店铺/草稿/版本，拒绝迟到结果与覆盖未保存属性；零候选可显式“改为手工补充”，不会产生保存/批准，上架 VALIDATE 仍检查必填。
- [x] U15 物流定价：`extension-listing-logistics-pricing` 复用原有效发布版本、精确店铺仓库/起讫地授权与 shared 物流公式。设备另须已有 `logistics:discover/read`；界面显式选择路线、服务、电池状态，不默认第一项。基于已确认 SKU 包装，最多八次只读报价核对售价与价档；报价不写草稿、Provider 或 Ozon，既有物流 owner 仍保存下载授权回执。完整 selection/release/checksum/binding/SKU/费用被冻结，过期或变化拒绝应用。成本/毛利/佣金/汇率改变会清自动运费；明确手工运费保持手工来源。佣金无精确类目证据时仍手填，汇率只接受有来源且七天内的 RUB→CNY 数据。
- [x] U16 连续准备：同窗按草稿→官方类目→属性→包装→定价→文案审核→图片审核/应用→最终校验推进；缺资料或审核时暂停，确认原步骤后继续。多店逐店准备，未完成前店不发后店创建请求；支持下一店在原 SKU 弹窗显式选择。来源/快照或处理中店铺变化会停止后续步骤，不把新店误记为旧店完成。不自动生成、批准或发布 Ozon；停止不声称取消已经发送的请求。
- 未知初次 COLLECT/CREATE_DRAFT 现在保留原 source/shop/snapshot/SKU 上下文，通过“核对建草稿结果”只读 REFRESH/EDITOR_READ 恢复；实际 SKU 集合、r/v 与唯一草稿必须匹配。只有匹配的草稿被优先使用，不能用同店同数量的其他草稿替代。核对不闭合继续阻止新写入。保存被拒绝不会推进队列；保存已确认而只读刷新失败保留成功与刷新警告，不标记 UNKNOWN、不清 unrelated recovery。
- T2 先实测 RED→GREEN：切店铺后 await 返回、属性候选竞态/dirty/零候选、物流路线变化/回包/金额与 lease、未知建草稿只读恢复、保存拒绝错误推进、定价 busy 不恢复等均保留最小 owner 回归。根 Agent 联合 14 个扩展脚本 `105/105`；全 server `6868 passed / 357 skipped`（450 passed files、45 environment-specific skipped files），workspace lint/typecheck、server build 与指定扩展/脚本 ESLint 通过。没有用 skipped 测试声称数据库实测通过；实际 PG 证据见下一节。
- Chrome 全流程 fixture `ss-erp-precision-ui-evidence-lPb7u1`：自动属性→保存成功但刷新失败→包装→店铺物流→修改费用使运费/预览失效→重新报价→俄文候选与明确审核→已有已审核图片应用的只读核对→VALIDATE→第二店选择/建草稿。原手工编辑、包装/字典、套图/审核/assignment 和发布交接 fixture `ss-erp-precision-ui-evidence-xkNFEt` 通过；最终源码空候选 `ss-erp-precision-ui-evidence-pmalgI`、未知建草稿只读恢复 `ss-erp-precision-ui-evidence-p3HZAg` 通过，均无真实第三方/生产写入。这些模拟结果不替代当前新版生产套图、物流质量或实际 Ozon 上架验收。
- 当前源码实际 MV3/action-popup/同页来源 iframe/Blob 双向验收 `ss-erp-donor-mv3-evidence-HqPNtX` 通过；extension tree SHA `dbb69df3fa398ce7f30d3fbd9592bc95577288c338bcf0dd98718d532b1ddf77`，dirty/未签名。本地临时 Cloud/Local verifier `590/586`、0 failure/warning；生成物不进入 Git，不是正式发布候选。
- 保留限制：复制行已接入本地同窗编辑、图片行、独立价格/包装和移除，但尚未执行真实 Ozon 发布；纯 RUB/hybrid 物流公式仍按原 shared evaluator 拒绝，不能虚构最低价或零运费；来源视频仍需官方上传才可发布。淘宝/天猫/PDD native_v2 已通过隔离验收，其他 donor 平台和完整 i18n、全商品视觉质量及新版真实 Provider/物流/Ozon 全链路尚不能宣称完成。按用户“全部完成后再提交”的要求，保持未提交。

### 2026-10-05 真实视觉校准与独立数据库证据

- [x] U17 本轮此前未验证的视觉 transport 和数据库路径已补证。只读确认 COM 普通文字模型为 DeepSeek，不具备本功能所需的视觉合同，因此新增独立 `ai_product_vision_provider/base_url/api_key/model`；API key 敏感加密、feature/provider 默认关闭，未把生图或文本密钥隐式继承到视觉生产配置。
- 在既有用户不限金额测试授权内，由专用 `product-vision-live-calibration.ts` 诊断进程复用已确认 official DashScope 凭据，仅内存调用 `qwen-vl-plus`，对两张脚本合成图各执行一次 POST，没有自动重试、账单/控制台读取、Ozon 或业务数据/生产配置写入。蓝色收纳盒、红白条纹上衣返回符合真实视觉 JSON 合同；颜色/形状/条纹等可见观察基本符合输入，未猜材质/尺寸/认证，盒子部分组件保留不确定表达。usage totalTokens 为 `861/831`；这是两张校准图的模型/transport 证据，不等于全部真实商品质量、开启生产视觉或真实套图通过。
- 本轮真实 Provider POST 总计 **2**，供应商可能产生模型费用，实际账单未读取，不能再报告整轮零费用。安全原件 `ss-erp-vision-live-79861ac492894ff0ba12b6396a8dac14/calibration.safe.jsonl` SHA `aa36901902892fc66ed83a0ade40c82e1ca30f389f5930dc54c963f03729f4b2`；路径为本机临时私有诊断目录，不提交输出、凭据或图片到 Git。
- 独立本机 PostgreSQL 执行真实 153 migrations、7/7 tests、0 skipped：视觉原子 quota/claim/receipt、UNKNOWN 保额度、断开 Prisma 后新 client/service 恢复、SKU 变更与 publish grant 撤销同事务、故意 trigger 失败原子回滚。运行 schema 已 DROP 并读回不存在，Provider/Ozon=0；不把新 client 恢复描述成 kill 生产 Worker。根 Agent 重验安全摘要 `ss-erp-product-vision-pg-XQdsHJ/summary.safe.json`，test output SHA `5e7d83e2ce7407e74afcba90fd546c38141d02853c74b49c2b41cf7b1b95a79b`。

### 2026-10-05 SKU 复制与淘宝/PDD/天猫采集（本地验收完成）

- [x] U18 SKU 复制：donor 的复制行为已接入服务端 `offerRows` 合同。原始 `selectedSkuKeys` 和冻结 capture 保持不变；服务器生成确定性 `listing-copy:<sha256>` 行键及独立 offer ID，复制已确认价格/包装/属性快照但不复制媒体 assignment。复制行可在同一编辑器中保存独立价格、包装、官方属性和图片行；同一 operation key 重放不新增版本/行，复制行可单独移除，来源行与历史仍保留。来源 SKU 被移除、快照/哈希/row provenance 错误、复制链和损坏映射均拒绝；freshness、grant 和校验在复制后失效并需重新核对。
- 后端复制垂直回归 `98/98`，新增真实 PostgreSQL copy `4/4`（与视觉 7 项合计 `11/11`，153 migrations 实际应用，schema 清理确认）；最新 PG 回执 `ss-erp-product-vision-pg-KnOx01/summary.safe.json`，test output SHA `cdc59f860efa7f6c5425d658547673fffb8e9cc553c5f61838d7bf8a8464a0a6`（原件路径私有）。验证跨实例恢复、CAS、原键 replay、grant 撤销、触发器失败回滚和腐败映射拒绝。复制行尚未执行真实 Ozon 发布。
- 扩展 client/合同闭合复制与移除动作：`SKU_DUPLICATE {sourceSkuKey}`、`SKU_COPY_REMOVE {rowKey}`，返回 DTO 只含 rowKey/sourceSkuKey/offerId/pricing/packaging；client 对绑定、复制键、价格、包装、嵌套私密字段和媒体 scope 做 exact 校验。定向 editor/client `16/16`，同窗复制未知回执/幂等 replay/独立价包/图片行/移除副本 fixture `ss-erp-precision-ui-evidence-1P4PNl` 通过，无 Provider/Ozon。
- [x] U19 donor marketplace collector：只读复用 `jp20260803` 的淘宝、天猫、拼多多数据读取概念，接到现有 MV3 source capture v2；严格 URL/当前商品 ID、bounded main-world/network/script/JSONP 解析，不执行页面脚本，不读取密钥，不放开 debugger。真实 SKU ID/规格路径/图片、分币价格、零库存、kg→g 包装与 evidence sourceType 保留；foreign recommendation、错误 URL、getter/cycle、超预算脚本拒绝。normalizer/legacy `21/21`，source contracts 与旧 collector `18/18`；MV3 隔离页面对 Taobao/Tmall/PDD 各自 native_v2 `16 SKU`、`stock=0`、source SKU ID/属性和来源图通过，Provider/Ozon=0。
- U18/U19 当前均为本地源码/隔离浏览器证据，仍未提交、签名、推送或部署。复制行的生产 hosted plan、图片审核/媒体权威和正式发布 compiler 已接入服务端 copy context 并通过本地负例；生产真实套图、Ozon 上架和官网门禁仍未执行。其他 donor 平台（Temu、AliExpress、WB、JD 等）保留既有 fallback，未宣称全部平台达到原版深度。
- [x] U20 复制行消费者已收口：属性、包装、物流、文案、视觉、媒体候选/应用、hosted plan/authority、BYOK launch/ingest、视频、水印及发布编译均使用有效行键；复制媒体不自动克隆 assignment，原来源资产与来源事实只读映射。服务端消费者回归组合 `189/189`，物流/属性/规划/复制组合 `145/145`，另一组服务端新旧回归 `272/272`；扩展 editor/client `16/16` 和本地浏览器独立通过。真实 11 项 PostgreSQL 隔离回归和最后一次 Cloud/Local verifier 均通过；完整生产 Provider/Ozon 套图和发布仍按独立授权与门禁执行。

### 2026-10-05 看图 JSON 与同草稿 SKU 调整（本地接续）

- [x] U12 托管看图：精铺图片窗口同窗选择当前 SKU/共有 1–5 张来源图→分析→JSON 预览→显式应用到原可编辑提示词。视觉请求进入独立 `product-vision-workbench`，不是给旧规则计划伪造 modelOutput：结果仅为视觉观察与创作建议，不写 verifiedFacts/属性/计划，不自动审核、生图或发布，原 model-planning gate 仍 NOT_READY。原版视觉/自动属性的完整流水线仍未关闭。
- 系统配置 owner 新增 `feature_extension_product_vision=false`、显式 `ai_product_vision_model`（不继承普通文本模型）、`ai_user_daily_product_vision_limit=10`。设备 `/vision/capability` 只读，`/vision/analyze` 必须原 review/write/media:execute、AI tenant 和原来源工作台策略均通过。主体/snapshot/goods/shop/SKU/图片/r/v 前置绑定；Provider POST 前再次核验草稿及冻结配置。没有修改生产开关或读生产凭据。
- 服务端复用公共图片下载的 DNS/SSRF/redirect 限制，图片严格单帧、16M pixels/8MiB 输入，旋转/缩放为 <=1024px/1MiB JPEG。多模态 transport HTTPS、固定公共 DNS、无 cookies/redirect、单次 POST，最多五图、JSON响应<=64KiB、请求<=120秒；原子每日次数和原执行 claim 持久化，receipt 使用既有 cache 表，无 schema 迁移。Provider 后失败/错误JSON/保存失败保留 UNKNOWN 与额度，不重POST。cache原件读取按 owner/draft/op/hash，不依赖当前凭据/模型；数据库 SQL 本轮仅参数化 fixture 验证，独立 PostgreSQL 恢复演练未验证。
- 原 real capture 可能使用带 URL 的 structured media key，本轮通过 `source-media-public-key.ts` 复用原 hosted-plan 的 SHA-256 alias；候选和看图服务共享该投影，仍对 owned 当前来源 key 精确还原，未接受外部 URL 或扩大图集合。新增 alias 正例真实先 422 RED，再 owner 最小修改 GREEN，原 hosted-plan 57 项回归通过。
- [x] U13 SKU 调整：复用原 SKU 弹窗，以当前所选项初始化并显示全部来源 SKU；同一草稿允许增/减现有来源 SKU，不伪造复制 SKU。新 `EDITOR_SAVE/SKU_SELECTION` 仍用原 device-editor/read/write 和 source ownership；原领域 `changeSkuSelection` 增可选 expectedDraftVersion/operationKey 幂等支持，Web 无 key 行为兼容。原 pricing/media/copy/attributes/validation 失效与发布 grant 撤销保持，原素材/价格/账本审计不删除；未知保存核对只重放原 body/key。
- 设备实际 transport 的新文案 capability/generate 与 vision capability/analyze 路径及 210s 有界分析超时已补齐：现底层此前未放行上轮新文案路径，这次最小真实 transport RED→GREEN；普通读取仍10s。UI等待略长于底层、未知请求不自动重试。消息只允许精确来源商品主frame/document，扩展普通页和来源登录页不能发起。
- 主 Agent 独立执行后端八套 `254/254`（看图/transport/config/SKU/editor/domain/copy/hostedplan）及 server typecheck/build；扩展十二脚本 `79/79`，实际 device transport/原 BYOK ingest额外回归通过。新增 source/UI/client/config/service/test ESLint 通过；旧 donor SKU picker 的既有 no-cond-assign 仍在，本轮未为 lint 修改其业务。新视觉/client/transport 测试已加入 preflight，没有跑完整发布 offline。
- 浏览器 `ss-erp-precision-ui-evidence-b2te4G`：原草稿选 `sku-1/sku-7` 改为 `sku-1/sku-2`、图片区跟随新选择；当前SKU/共有图分析→丢失回执→原 key 恢复→JSON应用→草稿版本变化后的迟到结果拒绝，未启用保持手工；恢复成功替换旧错误提示。原完整编辑/审核/assignment/发布交接模拟回归 `ss-erp-precision-ui-evidence-wt6bqx` 通过。均用本地 Provider/Ozon fixture，无真实 POST、费用或上架。
- 最终本地临时 Cloud/Local package verifier `586/582`，0 failure/warning；实际 MV3 来源页/action-popup/无新Web页验收 `ss-erp-donor-mv3-evidence-BcjGYH`，tree SHA `1b26e1517c08df39a0459059de1a330a4e8298a53f30f8ef76d0ce49e8324f6e`，工作树 dirty，未签名。未提交/push/部署，线上仍 `4df9ec38 / 1.0.421`。下一主问题是逐 SKU 自动属性、自动物流定价、完整连续处理与多店；SKU 复制并生成新规格依然未支持。真实多模态模型质量/配置和独立数据库验证尚未完成，不宣称已生产可用。

### 2026-10-04 同窗定价与托管俄文文案（本地接续）

- [x] U10 实用定价：原按钮打开同窗工具，按每 SKU 的采集采购成本（缺失须填写）、确认运费、佣金/广告/其他比例费、包装/国内杂费、目标销售毛利和折扣计算 CNY/RUB 售价及划线参考价。反算属于 `shared/calculator-core/profit-engine.js`，明细复用 `enrichQuote`；比例之和须小于 100%，缺运费不默认为零，RUB 必须显式汇率。预览/填表只编辑本地，原 PRICING 显式保存才写草稿；保留货号、VAT 和其他编辑。店铺/草稿/SKU/成本/费用/币种漂移撤销旧预览。
- 没有把全局物流缓存当成当前店铺官方报价：精铺尚缺 warehouse/origin/destination 完整 scope；运费标为用户估算，佣金和汇率须确认。自动物流、donor GUOO 价档/尾程公式尚待适配，划线价不等于 Ozon 促销配置。
- [x] U11 同窗俄文生成：复用 `source-listing-ai-copy.ts` 的可信来源、已确认类目属性、模板、每日额度和持久幂等。设备新增 `/editor/copy-capability` 和 `/editor/copy-generate`，现 editor owner 核对 owner/device/shop/snapshot/goods/r/v 和原 review/write scopes。生成不审核、不发布，AI 候选经原 `applyAiCopyCandidate` 明确批准；事实漂移不可审。同 key 并发仅调用一次模型，第二次正确标记 replay；未知响应保留原 key，409 in_progress 继续保持未知，禁止自动重生成。生产能力默认受原准入限制，未核实/开启生产开关；未启用时继续手工。
- T2 RED→GREEN：主 Agent 独立执行 server 五套 `65/65` 与 typecheck，扩展定价/session/client/source-only/donor/runtime/workflow `56/56`；新脚本已注册 preflight。UI/core/client/bridge/新测试 ESLint 通过。Worker、workspace contract、runtime policy、旧浏览器 runner 历史 lint 按 HEAD 对比无新增（分别 157/2/3/3）；不是全扩展 lint 零错误。本轮未运行完整 release offline。
- 同窗 Chrome fixture `ss-erp-precision-ui-evidence-3t8kdc` 通过：两 SKU 计算→费用变化撤销→填表→显式保存；生成丢失回执→原 key 核对→候选预览→明确审核；关闭能力保持手工。原完整编辑/包装/类目/属性/套图/审核/assignment/发布交接 fixture `ss-erp-precision-ui-evidence-uHj5Ct` 通过；这两份使用模拟 Provider/Ozon，不能证明新的生产文案质量或正式发布。
- 实际源码 MV3 安装 `ss-erp-donor-mv3-evidence-p7rb0K` 的 Chrome action popup 物理点击、同页 iframe、普通商品/伪造来源拒绝/图片解码通过，tree SHA `7efe4d813fbd18697bc8dc995a70aa459c370e1a7965d8ffcf3446e39cc0a5c5`，工作树 dirty。本地临时 Cloud/Local verifier `585/581`、0 failure/warning；未签名，不是生产候选。
- 剩余：`runVision` 真多模态 JSON、逐 SKU 自动属性、物流自动报价、SKU 复制/选择变更持久化、多店连续处理。现规则规划的 model gate 仍 NOT_READY，BYOK 图片 operation 不具备文字/视觉能力。本轮未提交/push/签名/部署，无真实 Provider POST/Ozon 写入或费用。

### 2026-10-04 产品流程差距审计与同页弹窗入口修复（本地）

- 当前运行和官网公开包均为 `4df9ec387b75c0f26c8a483c42d33940c03a892c / 1.0.421`。用户尚未测试最新安装包，但源码已经足以证明：发布和套图合同通过不等于原版连续操作全部适配。ERP 服务端负责权限、草稿、费用、审核和发布；这些 owner 不要求用户导航到 ERP Web 页面。
- 当前入口差距：popup 仍通过旧 collector 提交来源采集，并提供 `ss-erp:open-source-workflow-handoff` / “打开 ERP 继续”，Worker 的兼容 handler 会创建 `/collect/source` 标签页。该跳转是旧 CTA 的主动操作，不是采集成功后自动跳转。精铺 iframe 已有同窗 SKU/店铺建草稿、价格/货号/包装、类目/属性、图片处理/审核/应用、发布预览/确认/回执接线；Web 跳转不是这些接口的必要前置。
- 原版连续功能的真实缺口见下表。原始参考只读，`jp20260803/ui/app/workflows/run-workflow.js` 的 `runVision` / `runText` 与当前 `shared/donor-workbench/precision-workflow.js` 已逐项对照。

| 用户操作 | 当前实现与差距 | 继续适配的 owner |
| --- | --- | --- |
| 开始执行后连续处理商品 | 当前只串联读取→采集→所选 SKU 建草稿；后续依靠手工编辑，原版筛图/视觉分析/自动俄文和属性链未完整接入 | precision workflow；文案/图片服务端 owner |
| 图片转视觉 JSON / 提示词 | `compilePrompt()` 只有可编辑的 composition/background/lighting/style 编译，没有原版 `runVision` 看图步骤 | prompt adapter 与现有托管/BYOK 能力 |
| 俄文标题和描述 | 当前为手工候选编辑、保存和审核，没有原版自动 `runText` 流程 | copy editor 与 source-listing 文案 owner |
| 定价工具 | 当前按钮仅滚动到价格表，佣金/利润/物流模板与自动填写尚未适配 | 现有 calculator / pricing owner，扩展仅应用计算结果 |
| 复制/增删/重新选择 SKU | 复制行仅在本地，保存会拒绝；已有草稿的选择锁定；批量图片入口部分隐藏，尚无对应持久化流程 | source-listing 草稿 owner 与精铺 editor |
| 多店、库存和视频 | 当前每次绑定单店，库存管理隐藏；来源视频仅预览，发布只接受已上传 Ozon 的官方媒体，普通来源视频上传尚未完成 | 现有 shop/draft/publisher/video owner |
| 多平台采集和语言 | 1688 使用 donor collector，淘宝/PDD 仍使用原 SS collector；界面语言切换暂禁用。类目推荐两版均为规则评分，但目录与规则不同 | collectors / category recommendation / donor i18n |

- 本轮验收范围：只关闭来源商品 popup 与精铺入口分裂。`popup.js` 主按钮改为“打开精铺工作台”，保留独立货源核价，移除 popup 旧采集/恢复 handoff/ERP CTA。新消息只发到原 tab 的主 frame；bridge 只接受本扩展精确 popup sender 和唯一 `type`，拒绝任意 URL payload、foreign/content sender。只确认 iframe 打开，不伪称采集/草稿/页面加载已完成；重复打开保留编辑，不新建 Web 标签页。兼容 Worker handoff API 未删除，不改权限、费用或服务端写入规则。
- T2：上一接续已观察新 popup/default-entry 的 5 个目标失败再实现；本轮相关 10 脚本 `52/52`，触及文件 ESLint、diff 检查通过。source verifier `576`、临时 Cloud/Local 包 verifier `584/580`，均 0 failure/warning；临时包未签名、未作生产候选。HEAD 的两个旧脚本原本已失败：listing-workbench 要求加载已退役旧 UI（仍作为历史失败记录，本轮不改）；handoff 要求已移除旧面板 CTA，仅该受影响脚本更新为当前入口，保留原 Worker persistence/security/URL 合同。没有为通过测试重新挂载旧 UI。
- 真实隔离 Chromium `147.0.7727.15` 安装当前源码，调用实际 Chrome action popup，并用物理点击打开同页 iframe；确认不存在新增 ERP/其他 page tab、正常商品入口、登录/伪造 URL 拒绝、来源图片解码通过。证据 `ss-erp-donor-mv3-evidence-4vvoDg/summary.json`，extension tree SHA `bc04fb46d42af7bd6cc1fd4ac322bb911100218aafba2012964f788199716d13`，`worktreeClean=false`，只能证明本地工作树，不是签名/上线 canary。SKU 图片交互 fixture `ss-erp-precision-ui-evidence-J75zEa` 通过（选中两 SKU、同窗来源/结果、明确驳回；未做 assignment），不冒称新完整生产套图通过。
- 初版追加验收脚本尝试先关闭已打开工作台再测 popup，因 iframe 缩放/物理坐标未关闭而失败，原件保留；最终改为从初始隐藏 iframe 由真实 popup 直接打开，直接验证本次入口，未以 DOM 调用替代 popup 点击。关闭按钮在真实 MV3 的坐标验收未闭合，不能用本轮入口通过覆盖它。
- [x] U9：来源商品 popup 同页精铺入口（本地验收完成）。本轮未提交/push/签名/部署，无 Provider POST、Ozon 写入或费用。下一优先级为连续工作流、自动文案/视觉分析和实用定价，再处理 SKU 持久化；不能再次用发布回执代替产品交互验收。

### 2026-10-04 `1.0.421` 双区官网公开发布已完成

- 最终应用/签名/双区官网 pointer 均绑定 `4df9ec387b75c0f26c8a483c42d33940c03a892c / 1.0.421`。native offline、正式 QA04、canonical VPS、双区 REL-04 canary、website approval、CAS、Cloud/Local 匿名完整下载和 publication verifier 均已完成；COM 下载消费者 404 已解决。COM 保持原 DOTH 翻译受限 pilot/逐图审核，CN dark；没有把旧 UI canary 当作全部精铺流程一致的证据。
- 私有原件目录 `release-4df9ec38-website`：正式 QA04 SHA `eac67e3a42eabcfb7101c4f5fbe1a7a2597cdc9f1af0d9ee7d6b7feffc82a31a`；COM/CN approval SHA `d47abfdbd78d7369e26fb1b3ecdd329c553c867fad3ef42242c3d653ad4a79be` / `b586ea84d757b2c159a882eae087ec3dc3fe9116937ff562337ea4d2d8cb84b4`；distribution SHA `a8cf0b32b160b1def217d78b1e588343946f361d066514d23a238708ee18a6af` / `ca6517fa1db26e8c91c3e911f526a83887a5b59666b19b085f891982eb19ee69`。发布后 canonical VPS 两区均 PASS、0 failure/1 原远端备份 warning。本轮审计只读核对这些原件，没有重做生图、CAS 或部署。
- `CHANGELOG.md` 将已随 421 公开的功能从 Unreleased 归入该版本、合并重复条目，并使用已存在提交的 compare 链接；本地 U9 修复仅记 Unreleased。

### 2026-10-04 `1.0.420` 官网CAS后COM消费者兼容收口

- `f4b133e6bd796620663f8a103479b54bfe173ecc / 1.0.420` 完整native offline9 gates通过（server6628、PG209、Cloud584/Local580）；正式QA04 SHA `9af42607ce030181eb573f586241790216d3f5cde6ae56c251a45dc6c801f3e6`，明确保留c4execution、新target offline及cleanup读回，生图执行源码一致。双区部署/VPS、REL04 canary、approval均通过；物理officiallauncher与新create-plan按钮已真实创建/审核两槽计划、报价CNY0.28，但未START，无新增费用。
- 双区CAS实际完成，COM/CNapproval SHA `9a03b1d085e3505558a6e0395566e2dc62bf9ebeb6379346164b306293f87892` / `782984605982d5f56a0a4abaf41cd0254b7a2ba3ced0e2ab769c09be48abaeb3`。CN完整匿名下载两ZIP及publication verifier通过，distribution SHA `1b6da0e14150aaa86de00925dbb27c7dbce5cb65ac0401a48226fbdc35b74b4e`；COM源站latest与公开端均404，publication消费者TS仍硬编码两项operation，而脚本签名门禁允许显式三项，不能说双区分发完成。
- 受控恢复COMpointer：验证current420摘要和原405批准/region/version后，用既有durable atomic writer恢复旧pointer，保留420pointer原件；源站latest立即200、1.0.405。CN继续公开420，不重复CAS或回滚已通过区域。API/Worker/Web均active，无Provider/Ozon。现CODE受限产品范围仍原DOTH翻译pilot、CNdark。
- T2新增真实signed fixture+latest+ZIP consumer正例先404 RED，再最小仅允许exact两项或exact三项；TEXT/FULL_EDIT/INPAINT额外操作签名证据仍拒绝。下载回归34/3既有skipped、server typecheck/eslint GREEN。下一1.0.421仅改publication consumer，属于QA04已明确execution-neutral文件，不改schema/生图/费用/设备权限，原fresh suite/审核/assignment/replay可保留绑定419execution并重新生成target证据；不新增Provider请求。

### 2026-10-04 `1.0.419` 双区验收、fresh normal suite 与计划按钮修复

- `c4a391e1344bee6ceba18652b57e05ed2245b7af / 1.0.419` 已推送、区域签名、COM/CN 标准部署。两区 canonical VPS 均 0 failure / 1 warning（原远端备份未配置）；COM DOTH 受限翻译 pilot 与 CN dark准确，签名包 MV3 默认入口/来源拒绝/Blob 双向通过。完整 native offline 9 gates PASS：server 6628/350 skipped、scope PG7、AI PG209、升级回放、build/lint/typecheck和 Cloud584/Local580均通过；receipt/log SHA `f8af08a6ca272738b211546d3080fe46a5d8c55d38245e0fb5982ea5693fd340` / `7c5d54da36aa12d633fea82bdaf3445f2fd669fbf71e17e05c5db15a4fe16742`。
- 原卫衣 `990499606077` 两图真实正常生成并各结算一次 CNY0.14，但纹理失真和scene不达标，两槽已明确 REJECT，未assignment。另收纳盒 `1048072018093` 通过原空草稿owner选择，生成两图 `cmutpk2vn003m5oe1erq31tw6`，各attempt1、900×1200 PNG、原CNY0.14一次CHARGE；审核前PENDING UI/DB、START/CONTINUE原响应、两图preview与逐图review完整。容器主体/提手/凹槽无新增文字或水印，人工批准只用于隔离草稿验收；两图接近来源背景，不能宣称scene创意效果优秀。
- DOTH草稿 `draft-3509f416-a246-4dc5-bfa5-e9ffe9ea7063` r1/v1→r2/v2增加2 assignment；原请求与原幂等键replay返回200/replayed=true、同batch及两条素材。全owner pending五计数0、只读队列保留策略REMOVE_ON_COMPLETE、Ozon attempts0。正式原生QA04通过，SHA `269b706cb9994012119650e81fc6e99b8d3f579c5a4b59350cba98f7faddb6f2`，保留卫衣反例和既有技术反例，不改写质量结论。新Provider POST4、ERP费用CNY0.56、Ozon写入0、未读取Provider控制台。
- 真实官方launcher物理点击通过，但创建计划按钮发现已退役 source relay listener 缺失。通过既有授权runtime plan client证实服务端plan-binding正常；T2 controller正例先RED，再删除该页旧relay函数，统一调用runtimeClient.createPlan，保持source/草稿binding、galleryGoals与deterministic idempotency。controller/runtime/authorization定向27、ESLint通过。该修复只改扩展UI调用，不改服务端执行源码、权限、费用和schema；最终公开候选1.0.420绑定新clean commit，并以明确c4 execution和新target offline/cleanup验证源码一致，不重新收费。
- 官网仍1.0.405，尚未进行最终双区canary、website approval、CAS或distribution。私有运行原件在fresh-normal-storage419-20261004、fresh-normal-20261004（驳回卫衣）与release-c4a391e1-website。

### 2026-10-04 最终候选前发布合同校验收口

- `102711d9 / 1.0.417` 已推送、区域签名；COM 标准部署和 canonical VPS 通过，CN 标准部署进行中。COM 通过既有带 revision 的配置 API 显式启用原 DOTH 翻译 pilot，22 项通用中文→俄文术语、配置前后原件与 CAS 回退输入均保存在私有目录；exact runtime readiness 为 READY、CNY `0.01`/张，pilot 三 operation 与原 owner/shop/device/revisions 完全匹配，CN 不改开关。尚未发出新 Provider 请求。
- `f4cebd01 / 1.0.418` 首次 native offline 在 PG integration 处失败，无 receipt，原日志 SHA `75ac66fc48b2a924304a55954a3f22478ab756c6271d80f2f4bbfd6eb9e549a1`。根因已证实是测试隔离：共享 schema 的 recovery claimDue 看到其他 fixture 的 due jobs；手工 Prompt fixture 缺严格 revision checksum、PASS test run 和 release testRunId。修复仅改测试 owner：按本测试 job ID 过滤 claims，并建立符合真实 source contract 的 Wanx Prompt revision/release。随后 26 个 PG 文件 `209/209`、153 migrations 和 upgrade integration 全通过；生产 claimDue、Prompt resolver、schema 未改。
- 最终提交将在该测试修复上生成 `1.0.419`，完整 offline 只重跑一次；之前 `1.0.418` 的候选和失败原件保留。官网仍 `1.0.405`，fresh normal SUITE/QA04、双区 canary、approval/CAS/distribution 尚未执行。当前无新增 Provider/Ozon 请求或费用。
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
