# Ozon Seller API 兼容性审计（2026-10-23）

## 2026-10-24 组包入口改为全局可进入（用户授权）

用户明确授权不再为组包功能设置指定店铺的独立验收门槛，允许所有账号使用其本人所有 ACTIVE Ozon 店铺。该决定只改变产品可见范围，不把未做过的真实 Ozon 写入、仓库准入或物理打印机测试标记为已验证。

- `/orders/carriage` 对可登录的 `ADMIN`/`USER` 账号可见；店铺选择仍只来自当前账号自己的 ACTIVE Ozon 店铺。
- 组包服务继续由 `context()` 和 `validate()` 作为唯一 owner，严格检查店铺/仓库归属、订单状态、凭据一致性和 Ozon `available_actions`；未知响应仍禁止自动重发。
- `carriageBusinessEligibility: unverified` 继续保留为真实能力诊断字段，表示尚未用真实店铺确认业务准入，不是入口开关，也不阻止用户尝试。失败时显示 Ozon 的实际拒绝并保留幂等/恢复记录。
- 本次只更新入口文案和真源说明，没有调用 Ozon、没有产生费用、没有跨账号授权，也没有执行部署。

本记录先分析公开官方文档、当前源码和既有故障事实；用户随后明确授权接口迁移、Git提交和双区部署。源码已推送并完成区域签名及COM/CN标准部署；未发起人工真实Ozon业务验收。Premium模块不在范围内。本文件记录接口兼容性与实施取证，不替代既有业务、权限或发布owner。

## 2026-10-24 官网消费者修复466双区公开完成

用户批准精确证据复用及提交/签名/双区部署/公开下载后，源码`a2e70f59d4fcbf28879c69bafd912a3556350f78 / 1.0.466`已提交推送。签名ZIP在隔离Chrome两区安装通过，目标clean提交完整native offline通过（后端7514 passed/401既有环境skip、Web/API build、独立PostgreSQL集成/升级回放、Cloud632/Local628）；不将skip算成真实数据库用例。

本轮无新Provider请求或费用，复用原465一次两图/CNY0.20的原件。完整Git tree核对只发生四个获批的官网消费者/测试blob、两份QA04证据桥接文件和文档变化，模型/价格/计费/审核/assignment运行代码保持。当前read-only Provider配置hash、实际10分/张、两条原任务/收费/审核/草稿数据库图及pending全0通过；原测试设备已撤销，现有活动设备由原2台降至1台，原owner/DOTH+BINI/六操作/策略修订保持。正式QA04 SHA`65b34e41c93214b88c5e564565acd3ed48bfb60c75c087e41c820e9fd5d421ce`，原执行commit和原始回执未改写。

COM/CN标准部署均成功，160迁移无待执行项，API/Worker/Web均正常，公网ready/DB/Redis正常。区域签名SHA：COM`61c5f13afad72d2f7d12a72c9d84faf3fc171bf46c6158b66a1184e3d4adb43d`、CN`cdd3c6a23dad7e5b12189564ba3ac59cd6391855f6e87f5cf796d448b9b93e11`。FULL VPS均PASS、0failure，COM SHA`fec0e94b85c3f6492b7d823e04914633bf7b87c3335d9261f53f54432c31501e`、CN`645ba41960c61da2df616c73b47751fa5ad858c0d6a06c1a327c922961526f45`；远端备份未配置的既有warning保留。

双区新REL04、官网approval、CAS、匿名Cloud/Local下载及最终publication verifier均通过。COM approval SHA`1271613e022ebf86eaaab413800299572d5662986ee6764040e9cc4ce0229929`、CN`e248e433ccc6096d605069ce5323563b959a0c068aaa05a52cbb4ff2a719ff43`。当前两区应用及官网下载均为a2e70f59/466。临时双区发布账号会话已撤销，本轮未配对新业务设备；COM仍原试点、CN仍dark，官网开放下载不等于全用户AI开放。

部署异常与停机事实：候选根最初mode0700导致构建用户不可遍历，校正0755/0644后继续；随后因未先生成目标备份attestation停机拒绝，补完整备份恢复才继续。COM默认恢复方式遇应用账号无CREATEDB，实读确认其为本机127.0.0.1 PostgreSQL，使用原本机postgres恢复模式后145表通过；中途把该错误说成RDS是误判，未新建/提权账号。曾丢失一段本地session输出，实际门禁后由活动设备精确名单不匹配而拒绝；只读核实测试设备已撤销，仅保留原BINI设备后生成新expectation，保留DOTH+BINI的生产策略，未扩大任何设备grants。失败的本轮未激活COM目录曾精确清理重建，不删除current；CN两份失败副本改名保留。

CN另遇Prisma官方windows engine下载网络失败，当时未开始目标迁移，明确恢复旧current的API/Worker健康后重跑原签名候选。CN现有RDS应用账号的维护URL仅在备份子进程内派生到postgres，恢复144表通过且临时库删除；未持久写maintenance配置或改账号。部署期间COM/CN确实发生API/Worker停机，不宣称零停机或服务一直可用。

私有原件：`release-a2e70f59-orders`保存候选/签名安装/备份/部署/FULL VPS，`release-a2e70f59-website466`保存唯一完整offline、当前只读核验、QA04/双区官网公开发布回执。用户追加的可视化权限管理在独立工作树开发，不属于此次四文件blob复用范围，尚未纳入466。实际Ozon组包/货签打印和财务实账仍未验证。

## 2026-10-23 465正式验收与CN官网发布，COM兼容缺口已定位

用户明确授权COM/DOTH专用设备一次两图托管套图、最高CNY0.20，不发布Ozon、不读取供应商控制台、不重试未知结果。当前应用候选仍为`c04a19bf8e849939871716baa7e0914aaa5601d2 / 1.0.465`，没有重新部署或更改生产权限；本节后的本地兼容修复尚未提交、签名或部署。

- 同提交clean物化检出的完整native offline于本轮通过：workspace lint/typecheck、后端7506 passed/401既有环境skip、Web/API构建、独立PostgreSQL集成/升级回放及Cloud632/Local628校验通过。隔离签名ZIP的两区MV3安装通过；安装验收使用合成来源，不冒充真实商品。
- 专用9470在签名Cloud465上合法配对DOTH。使用1688商品928561537986及其绿色XL SKU，从来源页实际操作创建隔离草稿；正式草稿、workbench launch均晚于offline完成，整段没有跳到ERP编辑页。离线期间的准备草稿和计划保留在独立原目录，未执行付费suite，不作为正式时序证据。
- 本次suite的START/CONTINUE均只发送一次，实际最高费用确认、请求和响应已保留。两图生成成功，供应商原图均1008×1344，ERP成品均900×1200；审核前PENDING UI/数据库、两张实际预览字节、审核原响应、两条store-draft assignment及原请求幂等replay齐全。实库两笔SETTLED/CHARGE各10分，合计CNY0.20，每笔仅一次；jobs/costs/recovery/workflows/suites待处理均0，Ozon publish attempts为0。主图为浅灰背景，场景图为暖色窗影，保留青绿色短袖与黑橙图案；这只代表本样本候选审核，不代表通用创作质量或真实Ozon上架通过。
- 正式QA04原生PASS，SHA`043a82b84529f63a0dbc5d9e33211005fdd8a68b0062f74eb4ee704493ec3a75`。首次汇总因restored数据库观察早于pilot-after而拒绝；补做后置只读数据库与已关闭目标读回，再生成新的输入清单，原失败、旧观察和实际关闭时间均保留，未改写任何原件或合同。浏览器准备时还定位到当前Chrome向父页面派发点击未抵达OOPIF；改为目标iframe受信任点击并取证，产品代码未因此修改。
- 双区新REL04 canary均PASS，绑定原区域签名/FULL VPS和本次QA04；COM完整DOTH+BINI策略、原六操作和每设备各自的真实店铺授权保持，CN保持AI dark。canary仅有其受控测试会话写入/撤销，不发Provider/Ozon/ingest写入。
- CN官网approval、CAS、匿名Cloud/Local下载及最终publication verifier均通过。当前CN公开`c04a19bf / 1.0.465`，approval SHA`825243a0edf7751c9f8f45461ac16fc656b74aa5284779497c7d33f0da669109`；COM仍公开`efd4f4ad / 1.0.461`，未执行COM CAS/probe。不能称为双区官网发布完成。
- COM website approval明确拒绝`REL-04 restricted pilot policy evidence has an invalid field set`。生产canary/部署策略已支持`deviceShopIds`，但`scripts/extension-website-publication-approval.mjs`及`apps/server/src/services/extension-website-publication.ts`仍只接收旧七字段；后者在错误发布后还会拒绝实际下载，所以没有删掉字段、改写canary摘要、扩大设备店铺权限或手工改线上代码。
- 本地T2修复仅让两个消费者接收并验证可选map：设备键必须精确对应原session清单，每个非空/无重复店铺列表必须处于原试点名单内，map参与原始policy摘要；旧无map格式、区域/操作/签名/费用合同不变。最小用例先RED再GREEN；新增两组各8项通过，下载整文件56 passed/3既有skip，发布/canary合同73 passed/1平台skip，server typecheck、改动ESLint及diff检查通过。未经改写的本次COM canary已由修复后消费者本地只读验证通过；这不是新网站批准或线上修复。
- 现有`qa04-suite-source-bridge.mjs`只允许文档/CSS与四个既定QA04证据消费者变化，此次服务端下载消费者不在允许集。本轮付费授权已用完；尚未扩大原件复用白名单或再申请/发送套图。继续COM需要明确批准这四个消费者/测试文件的受控复用及新候选部署，保留原始suite身份并验证生成/金额/审核/绑定代码不变；否则仍按现有门禁停止，不将offline或本地parser成功当正式公开成功。
- CN下载验证完成后，双区本轮官网验收账号会话已撤销；COM本轮DOTH测试设备已通过正常owner撤销，单独账户会话及两处本地临时token已清理，9470专用浏览器关闭，9222用户浏览器保持。原suite、图片、收费、草稿和全部失败回执保留。后续受控复用必须将原设备执行身份保留为历史事实，不能把新临时设备嫁接到本次原件上。
- 用户随后明确批准此次消费者兼容修复、精确原件复用、提交签名/双区部署/公开下载；授权不等于完成。source-bridge已仅固定四文件完整原/目标blob，最小正例RED→GREEN，46项完整source-bridge回归通过；具体限制由[验证owner](release-validation.md)维护。可视化权限管理为用户追加的独立功能，保留当前COM试点/CN dark，不混入受控套图复用。

私有原件分三处：`release-c04a19bf-website465`为唯一完整native offline；`release-c04a19bf-fresh465`为先行准备/合法会话记录；`release-c04a19bf-fresh465-r2`为离线完成后的正式来源页、suite、QA04、双区canary及CN公开发布回执。它们位于当前Windows用户`AppData/Local/SS-ERP/private`，不进入Git。真实Ozon组包、货签实打和财务实账仍未验证，Premium未改。

## 2026-10-23 组包与接口诊断双区部署完成

用户在本地实现后明确授权Git提交及双区部署，随后授权复用阿里云登录态处理CN恢复路径。当前运行源码为 `c04a19bf8e849939871716baa7e0914aaa5601d2 / 1.0.465`，已推送至 `feat/ai-media-prompt-registry`；后续文档收尾提交不改变运行候选身份。

- COM/CN均通过标准 `scripts/deploy.sh`、目标签名和前向迁移 `20261023100000_add_ozon_carriage_operations`，共160条迁移。部署后实读API/Worker/Web三进程cwd绑定同一目标release，实际Node仍为 `/opt/ss-erp-node/v22.23.4/bin/node`；两区本地及公网 `/ready` HTTP200，DB/Redis正常。新组包/权限诊断接口匿名均401；这只证明访问控制和运行接线，不证明真实Ozon写入。
- 465签名SHA：COM `4fbaad30f4bcbcca3552f5c86860163a1393caa2e89ff9f61487a09fe376eed5`，CN `31c3361240b33dbb402a0881349f442a4ddc3b58511fac639030aa5eabf8bbe9`。同commit双区域Cloud/Local打包校验通过；未在本轮取得新的完整native offline或正式QA04，不复用464结果冒称465完整回归通过。
- FULL VPS canonical：COM `2026-10-23T11:18:38.628Z` PASS、SHA `28113e70a0a93c38eb37aec4e5dfe9fc8f7bab118ba2e2d1d1878ddaaf32fc59`；CN `12:40:43.559Z` PASS、SHA `b358bec98adad7a70254c51ad5b9cc8457febf440d4c5606a3e21e7652a20e9d`。均0failure/1既有warning（远端备份未配置）。COM回执在私有 `release-c04a19bf-orders-vps-COM.json`，CN回执及两区health、操作日志在私有 `release-c04a19bf-orders-final`。
- CN RDS维护结论更正：控制台账号管理显示现有 `ss_erp_app` 为高权限且允许建库，随后从CN实际连接查询得到 `ss_erp_app|t`。此前“CN账号没有CREATEDB”没有CN实库证据，不能沿用COM默认恢复路径的权限拒绝作结论。本轮未创建RDS账号、未重置密码或修改角色权限。只从已有连接在远端内存派生 `/postgres` 维护URL，临时写入root-only备份环境；恢复成功后于 `12:41:09.431Z` 精确移除该项，业务连接和原账号保持。
- CN部署备份与日常备份目录分别为 `/var/backups/ss-erp`、`/var/backups/ss-erp-runtime`，目标部署前恢复143表、部署后恢复144表，临时库均删除。COM部署后恢复145表，运行备份状态已刷新绑定当前commit。恢复原件/历史attestation按原owner归档，未手写PASS或覆盖旧回执。
- 失败与停机事实保留：Windows tar解包覆盖候选目录mode为777，先被目录权限门禁拒绝，修正为root-owned0755/0644后继续。COM随后因目标恢复attestation缺失而停止API/Worker；仅生成gzip不能替代恢复证明，补完整恢复后重新部署。未切换的本轮失败release曾被精确清除并重建，旧current和既有业务数据未删除，旧release/备份仍可用于恢复。COM后验又发现独立runtime备份状态仍绑定旧commit，刷新正确目录后才取得PASS。标准迁移与上述失败期间确实存在维护停机，不宣称旧服务一直运行或零停机。
- COM保持原DOTH+BINI受限pilot及分析，CN保持RDS/direct-origin/AI dark。两区官网读回仍 `efd4f4ad / 1.0.461`，没有website approval/CAS或公开下载切换。没有人工发起真实Provider/Ozon业务、付费测试或实货签打印；重启后的既有自动同步不计作本轮功能验收。

### 实现合同与本地验证（部署前记录）

最初实现范围为本地开发与隔离验收，不含真实Ozon组包写入、生产迁移、部署或官网切换；之后Git和部署授权及结果以上节为准。Premium继续排除。沿用Fastify/Prisma/Next及既有账户有效用户归属，不借仓库员工全平台可见规则扩大卖家写权限。

- 组包业务唯一owner为新增`services/ozon-carriage.ts`；`ozon-client.ts`负责固定官方路径传输；新增持久操作记录保存幂等键、请求摘要、异步task、逐项错误和未知结果，route与页面仅消费。普通订单面单独立，不由打印偷偷建箱。
- 页面放在订单管理的“组包交仓”，复用仓库打印的筛选/操作栏及现有Table、Button、Dialog橙色样式；同页选店铺/仓库→新建箱或托盘→扫码加入订单→确认→货签/交接文件。由实时`available_actions`控制操作；切换上下文丢弃旧响应，进行中的命令从数据库恢复，未知写入禁止自动重发。不以组包确认冒充实际国际发运。
- 服务端验证店铺ACTIVE/OZON/归属、仓库归属、订单posting/仓库/状态、数量与重复、平台可用动作。新命令按仓库串行，跨请求/进程通过唯一锁约束；网络/5xx/无效成功回执均保留UNKNOWN，已知task只读恢复。文件严格限制base64字节及PDF签名，无外部URL代理。
- 另两个独立范围：API Key只读到期/功能权限诊断（独立service、route与店铺UI组件）；已调用API的公开规格/News变更检查（独立script与测试，不使用店铺Key）。三者不同时写同一owner，主Agent统一装配/文档/验证。

实施分类D2，T2用于业务/权限/幂等/合同，先RED再GREEN；T3用于隔离浏览器布局与交互。最小验收覆盖建箱/扫码/逐项错误/异步恢复/未知不重发/跨店跨仓拒绝/PDF边界、真实隔离PostgreSQL并发与迁移、Web桌面与窄屏、API Key未知和过期、官方变更脚本的弃用/移除/Beta报告。完成全部代码后集中运行定向回归和类型/lint，不重复付费生图或无关发布门禁。真实店铺准入和实际货签打印另标未验证。

实施单元：主Agent独占组包服务、client、schema/迁移、组包route、Web页面与菜单；诊断单元独占新能力service/route/测试/独立UI组件；监测单元独占新脚本/fixture测试。join点为独立文件完成后主Agent检查diff、装配并运行集中回归，不由子Agent提交或执行生产操作。

### 本地实现与验证结果

- 组包服务、API route、前向迁移、订单管理页面和导航已完成；数据库记录保存 `requestHash`、`credentialHash`、异步 `taskId`、逐项错误以及 `CLOSED_UNKNOWN` 人工核对的操作者/说明/时间。写操作固定 `skipRetry`，2xx/错误响应均有大小上限；凭据轮换不能拿新凭据核对旧任务，迟到 recovery 不能覆盖人工关闭。
- 组包页面以 Ozon `available_actions` 控制按钮，建箱、扫码/移除、托盘装卸、确认、取消、货签/交接文件预览和打印均在同页；普通订单面单仍走原独立入口。超时/未知状态保留本地请求键；只有服务端明确 `notDispatched` 的业务拒绝才清除浏览器键。
- API Key 诊断仅读取 `/v1/roles`，严格匹配已核实的 path/operationId，直接展示 `expires_at`、到期分类和缺失方法；组包仓库准入仍显示 `未验证`，不从角色名称或创建时间推断。
- 最终定向服务端 9 个文件 `111 passed`；公开规格分析工具 `17 passed`；面单历史合同通过；本机隔离 PostgreSQL 迁移、并发/重连/未知锁/人工关闭 `6 passed`；Web production build、Web typecheck 和 server typecheck/lint 通过。隔离 Chrome 24 组通过，覆盖1440/390布局、组包交互、恢复、PDF真实渲染/打印函数、权限诊断和请求键边界，证据见 `C:/Users/550W/AppData/Local/Temp/ss-erp-carriage-ui-RESzF9/summary.json`。
- 官方当前规格离线检查覆盖 63 个固定调用，组包相关 12 个 path/method **0 条告警**。整体报告仍有其他旧接口的字段弃用、Beta 和一个规格引用缺失，报告状态为 `requires_review`；这不阻塞组包本地实现，也不等于全站或真实店铺兼容已通过。检查原件见 `C:/Users/550W/AppData/Local/Temp/ss-erp-ozon-spec-check-1myfFa`。
- 本阶段没有真实 Ozon 组包、货签打印机、店铺 API Key、Provider/Ozon 业务写入、费用、提交、推送、签名、部署或官网切换。真实仓库是否开通信任验收货位仍需之后在明确授权下核验。

## 2026-10-23 双区部署完成

- 运行源码 `099c26633fac05f7163108934509de860fc3828f` 已提交并推送到 `feat/ai-media-prompt-registry`，两区应用候选 `1.0.464`。此处后的文档收尾提交不改变运行候选身份，不重新部署。
- 最终clean提交的原生offline在 `2026-10-23T07:51:43.646Z` PASS，后端 `7445 passed / 395` 既有环境skip，workspace lint/typecheck、Web/API构建、隔离PostgreSQL权限与AI媒体集成/升级回放及Cloud/Local校验通过；不把skip冒充实库实测。签名ZIP隔离Chrome安装、默认工作台/popup/来源拒绝两区通过，专用浏览器均退出。
- COM/CN签名SHA分别 `440f3f6bd669b6bdbd70e0bbd7b4f0d6f84fc87cdcbda457e86d5a459c85f387` / `e2deb751667b82d06460a597432a28d7545405ab7b718ba8f32fe08e76e8e5d0`。signedAt均取对应VPS实际UTC，没有未来时间或改写旧签名。
- COM标准部署于 `2026-10-23T08:05:03.520Z` 成功，CN于 `08:28:53.258Z` 成功；两区159条迁移均无待执行项，未新增schema或破坏性迁移。标准冻结源码/备份门禁期间API/Worker确实暂停，CN暂停持续约10分钟，不宣称无停机；原release、unit快照、部署前备份保留用于恢复。
- 目标部署备份及部署后日常备份恢复分别验证COM144/CN143张public表，临时恢复库已清理，deployment与runtime目录仍分离。FULL VPS canonical两区均PASS、0failure/1既有warning（远端备份未配置）；COM原件SHA `6c3cdc00b7a7900f0c24a48cc86c7e5f9fe6bd6cbf258499dfcd90eeb62e4003`，CN `4ba2106e895c6cb454a1751bc8568afd9d3f209f5cbac9778208e9f505a7892e`。
- 最后公网 `/ready` 两区均绑定099c2663、DB/Redis正常，API/Worker/Web均active，三进程实际Node路径仍为 `/opt/ss-erp-node/v22.23.4/bin/node`。COM保留DOTH+BINI和原设备逐店授权/六操作及qwen-vl-max分析；CN保持direct-origin/RDS/AI dark。未修改生产权限或模型配置。
- 官网仍是原 `efd4f4ad / 1.0.461`，没有正式新suite/QA04 final、官网approval/CAS或公开下载切换。本轮未主动请求真实Provider/Ozon业务或产生测试费用；服务重启后既有自动同步可能继续运行，不把部署健康检查冒充订单、图片、退货或财务实账验收。
- 私有原件：`C:/Users/550W/AppData/Local/SS-ERP/private/release-099c2663-orders`（签名/浏览器/备份/部署/FULL/health）及 `release-099c2663-website464`（唯一完整offline）。历史中间检查和7431项结果保留，不重标为最终提交证据；本文件中早先审计表以审计时源码为历史基线。

## 2026-10-23 面单选择与预览布局后续修复（本地，尚未部署）

用户截图报 `OZON 未返回唯一的 big_label 面单任务`，同时关闭按钮与打印按钮重叠。根因在464实现：`fetchLabelAsync` 默认强制唯一big_label，即使平台只给small_label也拒绝；旧弹窗把下载/打印放在DialogTitle右侧，与通用Dialog的绝对定位关闭按钮占用同一区域。截图只能证明默认分支拒绝，未取得该订单原始tasks，不能冒称已读取真实small-only回执。旧测试只将big-label-only当正常默认值，没有覆盖only-small默认打印。

本地修复保留单次create和有界poll：未显式选格式时优先small_label，只提供big_label时使用其普通面单；明确选择某格式时仍严格匹配，多个同类任务不猜合并、不重复create。单张/批量/仓库打印共用此owner；取消“所有失败都请先打包”的route误导文案，展示具体平台错误。`LabelPreviewDialog` 提取为可验证的独立组件，标题预留关闭区域，下载/打印另置一行；长订单号/390px窄屏可换行。切换订单立即清空旧PDF并忽略过期响应，清理精确object URL，打印使用iframe ref而非全局ID。

T2先验证small-only/default preference错误确实RED，再实现GREEN；面单/下载/client/备货受影响验证37项通过，Web类型/lint、服务端lint和原打印历史合同通过。隔离Chrome真实渲染桌面1440×1000及390×844：关闭与打印矩形不重叠、对话框在viewport内、未加载不可下载/打印、旧订单响应忽略、object URL撤销、打印函数调用均通过。只模拟PDF与API边界，未调用真实Ozon、未驱动物理打印机。截图及summary在 `C:/Users/550W/AppData/Local/Temp/ss-erp-label-preview-E88hQK`；早一次截图捕获在入场动画中，保留但不作为最终视觉证据。当前源码未提交/签名/部署，线上仍099c2663/464。

### 官方大小面单、OGL组包、APIkey与Beta结论

2026-10-23再次从正常浏览器同源公开GET读取官方Swagger HTTP200，最新News仍10-22，序列化SHA仍 `0e7d75b1b4a4ac9ad95186dc8027a10c5f324064ccef2f6a4bcb29824ce8b130`，不是凭截图猜新接口：

- [`PostingFbsPackageLabelCreate`](https://docs.ozon.ru/api/seller/#operation/PostingFbsPackageLabelCreate) 将big_label描述为普通标签、small_label为小标签，并未说这是订单金额大小。创建请求只有posting_numbers，返回可用tasks，普通打印不应强依赖big。官方建议组装后45–60秒再请求；rFBS/Express需查对应业务流程。
- 集包/货位标签是独立业务：[`CarriageContainerCreate`](https://docs.ozon.ru/api/seller/#operation/CarriageContainerCreate) → [`CarriageContainerFill`](https://docs.ozon.ru/api/seller/#operation/CarriageContainerFill) →任务读取/[`CarriageContainerApprove`](https://docs.ozon.ru/api/seller/#operation/CarriageContainerApprove)→[`CarriageContainerLabelGet`](https://docs.ozon.ru/api/seller/#operation/CarriageContainerLabelGet)，另有既有act/get-container-labels。官方2026-05-05新增这组FBS Beta方法，要求warehouse/cargo_type/sort_type和独立container IDs。现项目未实现服务端组包owner；不能把新建container隐藏在“预览单个订单面单”里，也不能把big_label名称直接等同OGL货签。OGL实际适用渠道与仓库准入尚未用店铺接口核验。
- [`APIkey`](https://docs.ozon.ru/api/seller/zh/#tag/APIkey) 的[`/v1/roles`](https://docs.ozon.ru/api/seller/#operation/AccessAPI_RolesByToken) 返回 `expires_at` 与 `roles[].{name,methods[]}`；Auth正文明确API Key有效期3个月。现有连接检测只读seller/info，缺少到期提醒和逐功能权限诊断，建议接入该只读owner；不需因此切换到OAuth或要求用户发Key到聊天。此项本轮仅识别，尚未接线。
- [`BetaIntro`](https://docs.ozon.ru/api/seller/zh/#tag/BetaIntro) 明确Beta请求/响应可能变、会在开发者社区提前一周通知、可用性依Key角色。当前 `/v1/finance/accrual/by-day` 与 `/types` 仍标BetaMethod，面单create已归FBS正式分组；不能因Beta页存在就批量迁移全项目。需跟踪已用方法的官方News、字段合同和错误能力，并用真实金额对账补财务验收。官方Process总述仍引用旧V3列表/旧PDF路径，已被具体operation与后续News覆盖，不能倒退到总述旧例子。

本轮范围为修复普通打印和既有预览布局、回答API更新风险；未实现新组包功能、到期提醒或订阅监控，不把这些记为已完成。

## 2026-10-23 本地迁移实施范围

用户在本轮审计后明确授权全部相关接口更新、迁移与修复，并要求集中验证。结果是以本轮官方合同恢复现有订单、图片、促销、聊天、面单、退货、财务及配送配置功能；不是重做产品或切换数据库。本阶段不含生产业务调用、Ozon写入、Git提交、部署或公开发布。

实施为D2/T2：共用外部合同由 `services/ozon-client.ts` 与领域适配服务负责，队列/direct/route/Web只消费归一化结果；身份、店铺归属、备货状态、收费和发布owner保持服务端。root独占共用client与订单/图片/促销/聊天接线，财务与面单/退货分别单writer并行。验收合同为官方请求/响应、分页完整性、金额/币种、异步任务完成、部分失败、历史财务不双计及原权限回归；URL下载增加受限HTTPS/公共地址/大小/超时/重定向检查，不传店铺密钥。

最小RED先验证缺失的合同，再完成全部实现后集中跑受影响测试、类型检查和必要Web构建；不重复付费套图或无关全量门禁。停止边界为官方字段未知、金额来源冲突或需要真实生产/不可逆数据操作。本轮实测范围、未验证项与完成结果在本节续写，不把本地fixture当真实店铺验收。

## 来源与证据边界

- 官方文档入口：[Ozon Seller API](https://docs.ozon.ru/api/seller/)。用户授权后，在其 Chrome 的独立官方文档标签页正常打开；只读公开文档规格，不读取 Cookie、令牌、卖家业务数据或其他标签页。
- 实际规格：[swagger.json?1792730890539](https://docs.ozon.ru/api/seller/swagger.json?1792730890539)，同源公开 GET **HTTP 200**。浏览器 Resource Timing 记录首次请求 `2026-10-23T04:48:10.540Z`，另一次 `04:49:09.270Z`；解压后原正文均 `4,253,969` bytes。对应北京时间 `2026-10-23 12:48–12:49`。
- 主 Agent 在 `2026-10-23T04:53:36.484Z` 记录解析规格：`JSON.stringify(spec)` UTF-8 为 `3,079,726` bytes，SHA-256 `0e7d75b1b4a4ac9ad95186dc8027a10c5f324064ccef2f6a4bcb29824ce8b130`。此摘要针对重新序列化的 JSON，不能冒充原 HTTP 字节摘要。
- 规格 `openapi=3.0.0`，`info.title=Документация Ozon Seller API`，`info.version=2.1`，共 `482` 个 paths。`2.1` 是规格自报版本，不是发布日期。
- 官方更新日志在同一规格的 `tags[name="News"].description`，页面入口为[更新日志](https://docs.ozon.ru/api/seller/#tag/News)；正文最新日期 `2026-10-22`。下文公告日期、停用日期与字段定义均直接从本轮官方规格读取。
- 当前网络的普通匿名 HTTP 客户端请求 `.ru/.com` 文档及 swagger、`dev.ozon.ru/news/` 返回 403；这代表该访问路径未取到正文，不能解释为 API 停用。浏览器取证已补齐正式规格。未执行反爬绕过。
- 匿名检索期间发现第三方逐日镜像 `vispar-tech/ozon-seller-api-schema`（commit `c68f56a4f53779142440becb732bb8116e20bb69`，`2026-10-23T03:00:49Z`）与本地 `build/ozon-policy-research-20261020.md` 的旧研究记录；它们仅用于定位来源。下文结论已回到本轮官方规格核对，不以镜像或旧记录作为当前合同 owner。

本轮属于 T0 文档取证。文档中的“公告停用日”是官方宣告的日期；已有线上截图仅证明 `/v3/posting/fbs/list` 返回 **400 `obsolete method cannot be used`**。其他接口未凭店铺密钥验证实际停服或服务结果。“当前规格未标记弃用”也不证明相应店铺权限、数据或真实业务链已验收。

## 已核实的版本与停用时间

| 接口 | 2026-10-23 官方状态与时间 | 官方替代及证据 |
| --- | --- | --- |
| `/v3/posting/fbs/list` | `deprecated=true`；当前正文写 **2026-08-31** 停用。`2026-07-10` 更新日志同样明确该日期 | [`/v4/posting/fbs/list`](https://docs.ozon.ru/api/seller/#operation/PostingFbsList)，`PostingFbsList`；旧 operation `PostingAPI_GetFbsPostingListV3` |
| `/v3/posting/fbs/unfulfilled/list` | 同为 `deprecated=true`，公告 **2026-08-31** 停用 | [`/v4/posting/fbs/unfulfilled/list`](https://docs.ozon.ru/api/seller/#operation/PostingFbsUnfulfilledList)，`PostingFbsUnfulfilledList` |
| `/v1/product/pictures/import` | `deprecated=true`，公告 **2026-10-01** 停用；迁移公告为 `2026-09-03` | [`/v2/product/pictures/import`](https://docs.ozon.ru/api/seller/#operation/ProductImportPicturesV2)，`ProductImportPicturesV2` |
| `/v1/actions/products` | `deprecated=true`，公告 **2026-10-13** 停用；迁移公告为 `2026-09-22` | [`/v2/actions/products`](https://docs.ozon.ru/api/seller/#operation/ActionsProducts)，`ActionsProducts` |
| `/v1/actions/products/deactivate` | `deprecated=true`，公告 **2026-10-13** 停用；迁移公告为 `2026-09-22` | [`/v2/actions/products/deactivate`](https://docs.ozon.ru/api/seller/#operation/ActionsProductsDeactivate)，`ActionsProductsDeactivate` |
| `/v3/finance/transaction/list` | 当前 operation **没有 `deprecated=true`**，但正文和 `2026-07-14` 日志均明确 **2026-09-08** 停用 | [`/v1/finance/accrual/postings`](https://docs.ozon.ru/api/seller/#operation/GetFinanceAccrualPostings)、[`/v1/finance/accrual/types`](https://docs.ozon.ru/api/seller/#operation/GetFinanceAccrualTypes)、[`/v1/finance/accrual/by-day`](https://docs.ozon.ru/api/seller/#operation/GetFinanceAccrualByDay)；不能只检查 deprecated 标志 |
| `/v2/chat/list` | 不在当前 paths；`2026-06-09` 官方日志写“方法已过时，已从文档移除” | [`/v3/chat/list`](https://docs.ozon.ru/api/seller/#operation/ChatAPI_ChatListV3)，`ChatAPI_ChatListV3`；移除公告日不冒充实际停服日 |
| `/v2/chat/history` | 不在当前 paths；`2026-02-20` 官方日志写“方法已过时，已从文档移除” | [`/v3/chat/history`](https://docs.ozon.ru/api/seller/#operation/ChatAPI_ChatHistoryV3)，`ChatAPI_ChatHistoryV3`；移除公告日不冒充实际停服日 |
| `/v2/chat/updates/read` | 不在当前 paths；更新日志未检索到该精确路径的迁移公告或停用日期 | 当前已读方法为 [`/v2/chat/read`](https://docs.ozon.ru/api/seller/#operation/ChatAPI_ChatReadV2)，`ChatAPI_ChatReadV2`。这里只确认公开路径/结构，不推断当前账号准入或自动认定为兼容替换 |
| `/v1/categories/tree` | 不在当前 paths；本轮未找到该精确路径停用日期 | 当前分类树为 [`/v1/description-category/tree`](https://docs.ozon.ru/api/seller/#operation/DescriptionCategoryAPI_GetTree)；须按新分类合同评估，不凭名称进行别名映射 |
| `/v2/posting/fbs/package-label` | `deprecated=true`，公告 **2026-11-02** 停用；`2026-09-22` 发布迁移公告 | [`/v3/posting/fbs/package-label/create`](https://docs.ozon.ru/api/seller/#operation/PostingFbsPackageLabelCreate) + [`/v2/posting/fbs/package-label/get`](https://docs.ozon.ru/api/seller/#operation/PostingFbsPackageLabelGet)，由同步 PDF 改为任务流程 |
| `/v1/posting/fbs/package-label/create`、`/v1/posting/fbs/package-label/get` | 均 `deprecated=true`，公告 **2026-11-02** 停用 | 分别转上述 create V3 / get V2；不能保留旧轮询结果结构 |

订单列表时间线存在旧公告，不能只摘最早条目：`2026-04-30` 首次发布 V4 时写过 `2026-06-01` 停用 V3，`2026-07-10` 后续公告与当前 operation 正文改为 `2026-08-31`。财务也有同类历史：`2026-05-06` 原公告写 `2026-07-06`，`2026-07-14` 与当前正文写 `2026-09-08`。chat history 的 `2025-05-13` 旧公告曾写 `2025-07-13` 停用，但后来仍有字段更新及 `2026-02-20` 移除记录；本轮不从历史计划推定精确实际停服日。来源均为本轮[官方更新日志](https://docs.ozon.ru/api/seller/#tag/News)。

## 订单列表 V3 → V4：不能只替换 URL

对照源：[`PostingAPI_GetFbsPostingListV3`](https://docs.ozon.ru/api/seller/#operation/PostingAPI_GetFbsPostingListV3) 与 [`PostingFbsList`](https://docs.ozon.ru/api/seller/#operation/PostingFbsList)；schema 为 `postingv3GetFbsPostingListRequest`、`postingv3GetFbsPostingListRequestFilter`、`v3FbsPosting`、`posting.v4.PostingFbsListRequest`、`posting.v4.PostingFbsListResponse` 及其嵌套组件。

| 合同点 | 旧 V3 | 当前 V4 |
| --- | --- | --- |
| 分页输入 | 必填 `offset`，按数量递增 | `cursor` 字符串；首次空值，后续传上一页 cursor |
| 单页数量 | 文档范围 1–1000 | schema 明确范围 **1–100** |
| 返回包裹 | `result.postings`、`result.has_next` | 顶层 **`postings`、`has_next`、`cursor`** |
| 排序 | `dir` | `sort_dir`，enum `ASC` / `DESC` |
| 状态筛选 | `filter.status` 字符串 | `filter.statuses` 字符串数组 |
| ID 筛选 | `delivery_method_id`、`provider_id`、`warehouse_id` | **`delivery_method_ids`、`provider_ids`、`warehouse_ids`**；最多各1000，元素为 string/int64 |
| 新筛选 | 无 `order_numbers` | `filter.order_numbers`，最多100个 |
| 旧量子筛选 | `filter.is_quantum` | 当前 V4 schema 中无此输入字段 |
| 转写 | `with.translit` | **顶层 `translit`** |
| 商品价格 | `products[].price` 字符串 + `currency_code` | **`products[].price={amount:string,currency:string}`**；产品层无旧 `currency_code` |
| 收件人 | `addressee.name`、`addressee.phone` | 当前 addressee schema 仅 `name`；不得假定 V4 列表继续返回 phone |
| 财务商品字段 | `commission_amount`、`commission_percent`、相关币种等扁平结构 | `commission={amount:number,currency:string,percent:integer}`；`customer_price` 为 money 对象 |
| 运费/费率金额 | `tariffication` 部分金额与币种分开 | `current_tariff_charge` / `next_tariff_charge` 改 money 对象，增加 min_charge 对象 |
| 新包裹字段 | — | `delivery_schema`、`external_order`、`is_click_and_collect`、`scanit`、`volume_weight` |

`filter.since` 与 `filter.to` 在两版均为必填 date-time，UTC 格式；两版方法正文都规定查询区间不得超过 **一年**。V4 仍提供 `filter.last_changed_status_date.{from,to}`，表示状态最后改变的时间段，不能当普通订单创建时间的别名。没有证据说明 V4 强制改成天级日期、莫斯科时间或毫秒时间戳。

V4 的 `shipment_date` 仍是“需完成组装的截止时间/建议交接时间”，超过后可能进入下一费率；`delivering_date` 是交给配送的时间。列表迁移不能用截止时间制造已发货事实。V4 仍返回 `shipment_date_without_delay`、`in_process_at`、`status`、`substatus` 等字段，既有履约 owner 的语义须保留。

分页迁移应以官方 `has_next` 与 cursor 为依据；切换为每页100后，不能保留旧 offset 循环或因只读100条就声称同步完整。金额、币种、电话和嵌套财务字段需在 API 适配 owner 显式归一化，再交由现有同步消费者处理。实际服务端调用、当前数据库落库和 UI 的影响由后续本地调用审计补充；本轮未发送 V4 订单请求。

## 当前仍存在的重点接口及字段风险

| 接口 | 当前官方文档状态 | 已核实结构/近期变化 |
| --- | --- | --- |
| [`/v3/posting/fbs/get`](https://docs.ozon.ru/api/seller/#operation/PostingAPI_GetFbsPostingV3) | 存在，未标记 deprecated，当前正文无停用警告 | 继续作为 V4 备货回读方法；不能因为列表升级就猜测 get 也必须 V4 |
| [`/v4/posting/fbs/ship`](https://docs.ozon.ru/api/seller/#operation/PostingAPI_ShipFbsPostingV4) | 存在，未标记 deprecated | 组装后进入 `awaiting_deliver`；HTTP200不保证成功，官方要求用 V3 get 回读，`ship_failed` 表示组装失败 |
| [`/v4/product/info/stocks`](https://docs.ozon.ru/api/seller/#operation/ProductAPI_GetProductInfoStocks) | 方法存在且未弃用；字段 `total` 已 deprecated | **2026-11-23** 停用 `total`，改 `total_items`；当前顶层 `items`、`cursor`、`total_items`，cursor分页，每页1–1000 |
| [`/v3/product/list`](https://docs.ozon.ru/api/seller/#operation/ProductAPI_GetProductList) | 方法存在；字段将停用 | 同日 **2026-11-23** 停用 `result.total`，改 `result.total_items` |
| [`/v5/product/info/prices`](https://docs.ozon.ru/api/seller/#operation/ProductAPI_GetProductInfoPrices) | 方法存在；字段将停用 | 同日 **2026-11-23** 停用 `total`，改 `total_items` |
| [`/v4/product/info/attributes`](https://docs.ozon.ru/api/seller/#operation/ProductAPI_GetProductAttributesV4) | 存在，未标记 deprecated | 响应为顶层 `result` 数组、`last_id`、`total`；分页仍 `last_id`、每页1–1000。不能把 stocks 的 `total` 公告推广到此方法。`2026-09-25` 增加 `SHOWCASE_SELECT_ACTIVE` visibility |
| [`/v3/product/import`](https://docs.ozon.ru/api/seller/#operation/ProductAPI_ImportProductsV3) | 存在，未标记 deprecated | `2026-07-10` 删除 `items.images360`，并将 `items.offer_id` 标为必填；`2026-09-10` 将 `items.geo_names` 标记弃用。方法本身未被图片导入 V2 替代 |
| [`/v1/returns/list`](https://docs.ozon.ru/api/seller/#operation/returnsList) | 存在，未标记 deprecated | 顶层 `returns` / `has_next`；`last_id`分页、最多500。`2026-10-15` 新增 `returns.courier_delivery` |
| [`/v3/product/info/list`](https://docs.ozon.ru/api/seller/#operation/ProductAPI_GetProductInfoList) | 存在，未标记 deprecated | 当前响应只有顶层 **`items`** 数据数组，不是 `result.items`；同路径调用必须统一响应合同 |

三个 total 字段的迁移公告均发布于 **2026-09-24**，见[官方更新日志](https://docs.ozon.ru/api/seller/#tag/News)。这是未来字段移除，不是这三个方法整体停用。未测试接口不能因路径存在就宣称“全部兼容”。

### 退货：同版本的字段合同不匹配

[`returnsList`](https://docs.ozon.ru/api/seller/#operation/returnsList) 未弃用，但当前官方 schema `GetReturnsListRequestFilter` 没有 `since` / `to`。日期筛选是 `logistic_return_date`、`storage_tariffication_start_date`、`visual_status_change_moment` 三者之一，其范围字段为 `time_from` / `time_to`；官方正文要求同请求只选一种日期筛选。

响应仅定义顶层 `returns` / `has_next`，**没有响应 `last_id`**。请求 `last_id` 表示最后已加载的退货ID，后续分页必须从返回记录的ID推进，不能依赖不存在的响应 cursor。单条记录的运单号为 `posting_number`；状态为 `visual.status` / `visual.change_moment`；退货时间在 `logistic.return_date` 等嵌套字段，库存/保管信息在 `storage`。不存在旧的 `posting.posting_number` 或 `visual_status` 包裹合同。这里能够证实的是当前外部合同与本地字段读取不一致，不能确定何时发生，更不能冒称接口整体已停用。实际落库后果在本地调用审计中补充。

### 近两月与当前调用范围相关的字段公告

以下均直接来自[官方更新日志](https://docs.ozon.ru/api/seller/#tag/News)，追加可选字段或更新说明不代表所有卖家必须立即配置：

| 公告日期 | 变化 |
| --- | --- |
| 2026-10-22 | `/v1/product/import/prices` 更新 `prices.price` 说明；此条不是停用公告 |
| 2026-10-15 | `/v1/returns/list` 新增 `returns.courier_delivery`；`/v1/warehouse/fbs/create` 新增 `courier_return_warehouse_info` |
| 2026-09-28 | `/v5/product/info/prices` 新增 `items.price.declared_price`；`/v3/product/info/list` 新增 `items.declared_price`；`/v1/product/import/prices` 新增 `prices.declared_price` |
| 2026-09-25 | 商品 list / attributes 的 visibility 增加 `SHOWCASE_SELECT_ACTIVE` |
| 2026-09-24 | 三个 total 字段标为弃用并公告11-23切换；旧面单公告10-05起返回新格式 |
| 2026-09-23 | aggregator create/update 新增退货点 `return_point_id` |
| 2026-09-22 | V4 posting list 新增 `postings.scanit`，V3 get 新增 `result.scanit`；另发布促销和面单迁移 |
| 2026-09-14 | import / import-by-sku 更新 `items.old_price` / `items.price` 说明；商品info、价格写入/读取的相关price字段同步更新说明 |
| 2026-09-11 | `/v1/product/import/prices` 将 `prices.auto_action_enabled` / `prices.manage_elastic_boosting_through_price` 标为弃用，未给本轮可确认的移除日期 |
| 2026-09-10 | `/v3/product/import` 将 `items.geo_names` 标为弃用 |
| 2026-09-08 | 图片导入/商品导入更新图片数组说明；不能据此把V1图片方法视为重新启用 |

当前官方 News 没有“2026年10月修改 FBS V4 financial_data/products”的匹配记录；相关结构差异由本轮 V3/V4 schema 对照确认，不附会为近日才发生。

## 图片、聊天、面单、财务的迁移合同

### 图片导入

[`ProductImportPicturesV2`](https://docs.ozon.ru/api/seller/#operation/ProductImportPicturesV2) 请求改为 `items[]`，最多100个商品；每个 item 必填 **`offer_id`**，包含 `primary_image`、`color_image`、`images`。响应是顶层 **`task_id`**，之后用 `/v1/product/import/info` 查询状态。旧单商品请求和旧结果结构不能原样复用。图片 URL、已有图片集合、主图排序和现有发布幂等/审计边界仍需由现有 owner 处理，本轮未测试真实上传。

### 聊天

[`ChatAPI_ChatListV3`](https://docs.ozon.ru/api/seller/#operation/ChatAPI_ChatListV3) 使用 `cursor` 分页，limit 默认30、最多100；响应顶层 `chats`、`cursor`、`has_next`、`total_unread_count`。每个 chats 元素为 `chat` 对象加 `first_unread_message_id`、`last_message_id`、`unread_count`，不是从旧 offset 推导页码。

[`ChatAPI_ChatHistoryV3`](https://docs.ozon.ru/api/seller/#operation/ChatAPI_ChatHistoryV3) 请求保留 `chat_id`、`direction`、`from_message_id`、`limit`，增加/支持 `filter`。默认 `Backward`；`Forward` 时必须给 `from_message_id`。响应是顶层 `messages[]` / `has_next`；limit默认50、最多1000。当前 message 明确定义 `created_at`、`data[]`、`message_id`、`user` 等字段，须对照现有消费者。

[`ChatAPI_ChatReadV2`](https://docs.ozon.ru/api/seller/#operation/ChatAPI_ChatReadV2) 的路径为 `/v2/chat/read`，请求 `chat_id` / `from_message_id`，响应 `unread_count`。本轮只核对接口合同；账号准入、订阅和实际读写能力未验证，不扩展到 Premium 模块。旧 `/v2/chat/updates/read` 的停用原因/日期仍未验证。

### 面单

官方 `2026-09-24` 将新 create/get 从 beta 移入主文档，并公告旧方法自 **2026-10-05** 返回新 FBS 面单；**2026-11-02** 是旧接口计划停用日。新方案不是把同步 PDF 方法改一个版本号：

1. [`PostingFbsPackageLabelCreate`](https://docs.ozon.ru/api/seller/#operation/PostingFbsPackageLabelCreate) 请求 `posting_numbers[]`，1–1000个，返回 `tasks[]`，其中包括 `task_id` / `task_type`（big_label / small_label）。
2. 对每个任务调用 [`PostingFbsPackageLabelGet`](https://docs.ozon.ru/api/seller/#operation/PostingFbsPackageLabelGet)，请求 `task_id`；响应顶层 `file_url`、`status`、`error`。
3. `status.code` 包括 pending / in_progress / completed / error；`status` 另含 `postings_count`、`printed_postings_count`、`unprinted_postings`。不能在任务未完成或部分失败时返回打印成功。

官方仍建议组装后45–60秒再请求面单，并对 rFBS/rFBS Express 提示单独核对相应打印流程。真实面单、下载和打印行为本轮未验证。

### 财务

[`FinanceAPI_FinanceTransactionListV3`](https://docs.ozon.ru/api/seller/#operation/FinanceAPI_FinanceTransactionListV3) 的正文停用警告必须被扫描；`deprecated` 布尔值漏标不能覆盖明确停用公告。新 accrual 方法是新的数据模型：

- [`GetFinanceAccrualPostings`](https://docs.ozon.ru/api/seller/#operation/GetFinanceAccrualPostings)：按 `posting_numbers[]` 查询，1–200个，返回 `posting_accruals[]`。
- [`GetFinanceAccrualTypes`](https://docs.ozon.ru/api/seller/#operation/GetFinanceAccrualTypes)：返回 `accrual_types[]` 字典。
- [`GetFinanceAccrualByDay`](https://docs.ozon.ru/api/seller/#operation/GetFinanceAccrualByDay)：按 `date`（YYYY-MM-DD，最早2022-01-01）和 `last_id` 查询，返回 `accruals[]` / `last_id`。第一页 `last_id=""`，以后传上一页值；last_id有效期 **15分钟**，同一分页必须保持同一 date，否则官方说明返回400。

旧整月 transaction/page/operation_type 的统计、费用分类、退款与利润核算不能仅替换路径。金额正确性和对账语义需单独关闭；本轮未接入、未对账，也未读取真实财务数据。

## 物流路径与 OGL 边界

本轮核对的现用物流路径均在官方规格中存在，未标记 deprecated，当前方法正文也没有停用警告：

| 范围 | 路径 | 官方 operation |
| --- | --- | --- |
| 仓库/配送读取 | `/v2/warehouse/list`、`/v1/warehouse/fbo/list`、`/v2/delivery-method/list`、`/v1/delivery/point/list` | `WarehouseListV2`、`SupplyDraftAPI_DraftGetWarehouseFboList`、`WarehouseAPI_DeliveryMethodListV2`、`DeliveryAPI_DeliveryPointList` |
| FBS仓库配置 | `/v1/warehouse/fbs/create/drop-off/list`、`/v1/warehouse/fbs/create/return-point/list`、`/v1/warehouse/fbs/create`、`/v1/warehouse/fbs/update`、`/v1/warehouse/operation/status` | `WarehouseAPI_ListDropOffPointsForCreateFBSWarehouse`、`WarehouseFBSCreateReturnPointList`、`WarehouseAPI_CreateWarehouseFBS`、`UpdateWarehouseFBS`、`GetWarehouseFBSOperationStatus` |
| rFBS配置 | `/v1/warehouse/erfbs/aggregator/create`、`/v1/warehouse/erfbs/non-integrated/create`、`/v1/warehouse/erfbs/update`，及 aggregator/non-integrated 的 `/delivery-method/update` | `WarehouseERFBSAggregatorCreate`、`WarehouseERFBSNonIntegratedCreate`、`WarehouseERFBSUpdate`、`WarehouseERFBSAggregatorDeliveryMethodUpdate`、`WarehouseERFBSNonIntegratedDeliveryMethodUpdate` |
| 取消 | `/v2/posting/fbs/cancel`、`/v2/posting/fbs/cancel-reason/list` | `PostingAPI_CancelFbsPosting`、`PostingAPI_GetPostingFbsCancelReasonList` |

各 operation 可在[本轮官方规格](https://docs.ozon.ru/api/seller/swagger.json)对应 `paths` / `operationId` 重读。不能把“路径存在”解释为当前卖家已获物流服务、OGL 准入或可使用任意配送商。

与现有物流路径直接相关的官方变更，来源均为[官方更新日志](https://docs.ozon.ru/api/seller/#tag/News)：

| 公告日期 | 变化及影响 |
| --- | --- |
| 2026-10-15 | `/v1/warehouse/fbs/create` 新增请求参数 `courier_return_warehouse_info`；是返回链路配置扩展，未公告替换整个仓库端点 |
| 2026-09-23 | aggregator create 新增 `delivery_method.return_settings.return_point_id`；aggregator delivery-method update 新增 `return_settings.return_point_id` |
| 2026-06-30 | aggregator create/update 新增快递员电话是否与仓库相同的 `is_courier_phone_same_as_warehouse` 字段 |
| 2026-06-11 | 常见错误补充 `/v1/delivery/point/list` 的 `token must be issued for seller, not oauth-client`、`method is not allowed: OZON logistic is disabled`；这些是准入/身份错误说明，不能混称 obsolete method |
| 2026-06-04 | aggregator create/update 的 delivery_costs 新增 `min_weight`、`max_weight`、`min_order_price`、`max_order_price`、`seller_payment`；删除 `max_amount`、`min_amount`、`percent`。若仍提交旧字段，需按实际payload审计 |
| 2026-05-22 | `/v2/delivery-method/list` 响应新增 `delivery_methods.tpl_dropoff_point` |
| 2026-03-24 | 旧 `/v1/warehouse/list`、`/v1/delivery-method/list` 公告2026-04-07停用，转V2；本地共用client已采用上述V2路径，不能把旧公告误判为当前V2也停用 |
| 2026-02-12 | `/v1/warehouse/fbs/update` 的 `address_coordinates` 标为必填 |

当前官方确有 [`/v1/seller/ozon-logistics/info`](https://docs.ozon.ru/api/seller/#operation/SellerAPI_SellerOzonLogisticsInfo)，`SellerAPI_SellerOzonLogisticsInfo`，标题为“连接 Ozon 配送的信息”；响应 `ozon_logistics_enabled` / `available_schemas`（FBO/FBS/UNKNOWN）。更新日志记 `2025-11-11` 新增beta、`2025-12-30` 转入主文档、`2026-04-15` 更新名称与enabled说明。它查询开通状态，**不是运费报价、跨境路线或新的统一 OGL 发布接口**；本轮没有用店铺凭据查询。

对本轮规格 News 进行 `OGL`、`Ozon Global Logistics`、`международ` / `логистик` 及现用物流路径交叉检索，没有得到“现有全部物流端点统一迁移到某个新 OGL endpoint”的证据。**OGL 的精确业务准入、路线、计费、跨境规则和现店可用性仍未验证**，不由其他仓库或配送端点的存在反推。本轮未调用物流业务接口、未修改仓库/配送配置。

## 本地调用与实际影响

审计基线为 `dcfb5482`；开始时工作树干净，服务端当前部署源码为 `d9566394`，本轮没有切换运行版本。对 `apps/server/src/services/ozon-client.ts` 的实际请求字面量去重得到 **51 个官方路径、54 个方法与路径配对**，逐项对照本轮官方 `paths`：

- 7 个路径明确 `deprecated=true`，其中4个已过公告停用日、3个面单路径将在11-02停用。
- 另1个财务路径虽未标记 `deprecated=true`，正文已公告09-08停用。
- 4个路径不在当前规格：旧分类树、旧聊天列表、旧聊天历史、旧聊天已读。缺失不单独证明实际停服。
- 其余39个路径在当前规格存在且未发现方法级停用警告；其中3个有11-23的 total 字段移除公告。此分组不等于39个调用全链路通过，退货等仍有同版本字段错误。

上表额外列出的旧 unfulfilled list 是官方关联公告，不在本地51个路径计数内。本轮排除了 Premium 模块，没有检查或修改其实现。

| 优先级与功能 | 可达的本地调用者 | 当前影响与修复边界 |
| --- | --- | --- |
| P0 订单同步 | `workers/order-sync.ts:133`、`services/order-sync-direct.ts:129` → `getPostingsList` | 已迁移 V4 cursor、顶层响应与 money→字符串/币种归一化；V4任务不推进或金额非法会明确失败。截图中的旧V3拒绝仍保留为历史证据 |
| P1 财务同步 | `workers/finance-sync.ts:38` → accrual day/types | 已迁移按日 `last_id`、类型字典、稳定 `accrual_id`、generation快照；旧账保留且不与新快照双计，未知金额/币种不发布完成标记 |
| P1 商品图片替换 | `routes/product.ts:1136,1215`、`routes/listing.ts:1236`、`routes/collect.ts:5896` → `importProductPictures` | 已迁移 V2 `offer_id/items/task_id`，所有入口等待 import/info 终态后才更新本地图片；失败/超时不重复POST或假称成功 |
| P1 面单（11-02前完成） | `routes/order.ts:855,931`、`services/ozon-label.ts` | 已统一 V3 create + V2 get 任务，支持大小面单、部分失败、数量校验、边界轮询和受限HTTPS下载；旧同步接口已移除 |
| P1 促销商品 | `routes/shop.ts:1057,1101` → V2 | 查询使用 `last_id`，移出活动使用字符串商品ID，保留逐商品错误 |
| P1 客服聊天 | `routes/chat.ts:21,42,74`；Web `/chat` | 已迁移 V3列表/历史与V2 read，API route将嵌套chat/data归一化给现有页面 |
| P1 退货同步 | `routes/return.ts:134` → `ozon-returns.ts` | 已使用官方单一日期过滤、最后记录ID推进、visual/logistic/storage嵌套映射；重复/不推进/20页未完成/不安全ID均失败 |
| P2 商品/库存/价格总数（11-23前完成） | `workers/product-sync.ts:87,106`、价格读取 → client | 兼容 `total_items`，现有items分页保持；total移除不会让读取直接中断 |
| P2 rFBS配送配置 | `routes/shop.ts:763`、`routes/warehouse-command.ts:99` → `updateAggregatorDeliveryMethod` | 类型已改为官方 `min/max_weight`、`min/max_order_price`、`seller_payment`；真实店铺字段是否满足业务仍未验证 |
| P3 未接线残留 | 旧 categories 方法已移除；`getProductInfoBySku`保留顶层 `items` | 未在当前非测试源码查到SKU方法调用者；方法合同已校正，不宣称影响采集 |

订单金额现在由共用 V4 适配层先校验 money 对象并归一化，队列与direct共同消费；非法金额/数量不会写入。`/v3/posting/fbs/get`仍是当前读取合同，未把V4列表对象价格无条件推广到V3详情。

现有扩展另使用卖家网页内部的 `/api/site/...`、公开商品页及globalcalculator接口。这些不在Seller OpenAPI的51路径统计内；官方Seller规格不能证明它们未变。本轮没有用卖家Cookie请求内部接口、抓取订单或发起物流报价，因此其运行兼容性和精确OGL价格仍为未验证。

## 为什么既有绿色测试未阻止这次问题

当前 `ozon-client.test.ts` 主要验证传输、仓库与属性字典等已知合同；`product-promotions.test.ts` 的stub覆盖旧响应归一化。源码/脚本搜索没有找到以当前官方News、弃用日期、spec路径缺失和字段差异为输入的自动对照门禁。固定旧fixture通过，只能证明实现与旧假设一致，不能证明官方今日仍接受。

后续适配应优先增加少量可稳定自动化的owner测试：V4两页cursor/不推进拒绝、money对象及非RUB币种、顶层响应、保留订单状态/截止语义；退货从最后记录ID推进和官方visual/logistic映射；图片offer_id/tasks状态；新面单tasks数组与部分失败；财务新ID/日期分页及金额幂等；聊天cursor/消息结构。公开文档监测同时检查 `deprecated` **和正文停用警告、News后续延期、字段级移除**，不把监测脚本结果冒充真实店铺验收。

本轮先完成官方合同审计，随后按用户授权实施本地迁移。当前已完成代码合同、订单cursor/money归一化、图片异步任务、促销V2、聊天V3、退货嵌套字段、面单任务、财务accrual日快照和配送字段 owner；未调用真实店铺。集中定向测试和服务端类型检查结果写在下方，不把本地fixture当真实店铺验收。

## 当前实现与验收边界

本地代码已完成上述迁移，实际影响仍以真实店铺返回、响应解析、分页与落库证据为准，不能把本地fixture或完整离线套件当作线上接口验收。

本地实现已按T2最小RED→GREEN补充合同测试；面单、订单、财务、退货、图片和促销测试共 `59 passed`，服务端 `typecheck PASS`。仍未执行真实 Seller API 请求、生产修复、费用操作、提交、部署或公开发布；真实店铺返回、OGL报价、财务金额对账和图片真实任务结果仍未验证。

最终集中验证（2026-10-23）：服务端完整 Vitest `7431 passed / 395 skipped`（`7826` tests、`521` files；395 为既有环境 skip，不计入通过），服务端 `typecheck PASS`、ESLint 0 error（修复后无新增 warning）、server build PASS，Web `tsc --noEmit PASS`。本地回归没有使用店铺密钥，也没有发送真实 Ozon/Provider 业务请求。

提交前复核进一步关闭空图片任务误判、V2促销成功ID列表与money字段、聊天Markdown数组、退货number金额、未知配送费分类及rFBS根级delivery_method_id接线；订单两入口共用已验证的汇率计算，面单匿名下载绑定公共DNS/HTTPS/字节上限/PDF签名。新增有意义RED均已确认，更新后定向96项通过；初版7431的全量结果保留为历史，不替代最终提交的原生离线验证。用户已明确授权Git提交及COM/CN部署，准备区域签名候选1.0.464；官网461指针保持，本轮不执行Ozon业务写入或付费套图。
