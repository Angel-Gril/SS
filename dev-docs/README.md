## 2026-10-29 Yandex 运营对齐已部署

b601f8e / 1.0.478 已推送并完成 COM/CN 双区部署；商品价格预览/批量管理、Yandex 原生订单工作台、FBS/Express first-mile 交接、DBS 运单与平台面单/交接文档接线完成。两区备份恢复、数据库/构建/ready 门禁通过，真实 Yandex/Ozon 业务写入仍未执行。准确 owner 见 [Yandex Market API 研究](yandex-market-api-research.md)。

# SS ERP 内部开发真源

## 2026-10-29 Yandex订单同步与类目修复已双区部署

最终提交`ed36dbff`已推送并完成COM/CN标准部署，内部区域签名476；153项回归、7项本机PG、类型/lint/Web构建及订单页Chrome通过。COM已重新同步921件、921件类目ID/名称齐全，近一年13窗口订单读取0单；只更新ERP快照，无真实平台业务写入或费用。双区FULL VPS及三服务目标cwd读回均通过，各0失败/1既有远端备份warning；官网仍472，Yandex履约写入与LAAS外部Ozon配置仍未完成。准确停机/失败与官方物流结论见[Yandex owner](yandex-market-api-research.md)。

## 2026-10-29 Yandex订单同步最终验证，双区发布准备

类目修复与原生订单只读已接线；审查补齐旧Yandex发货/取消/备货假成功旁路拒绝、事务归属和旧快照保护。153项相关回归、7项本机PG及真实订单页Chrome通过；COM30天真实读取0单，不能冒称实际履约通过。旧a314的CN部署已停止恢复，双区current仍9cae6511；准确官方物流结论、停机/失败及最终发布边界见[Yandex owner](yandex-market-api-research.md)。

## 2026-10-28 Yandex 订单只读同步与类目修复准备统一发布

官方LAAS可条件集成Ozon FBS仓和外部订单，但不是直接把Yandex订单号调用Ozon Seller API；当前新增Yandex原生订单读取/状态物流字段保存及平台分流同步入口，真实COM空窗口读取通过，未发货/取消/面单/组包写入。类目漏读修复和订单同步本地验证尚未推送。详见[Yandex owner](yandex-market-api-research.md)。
## 2026-10-28 Yandex 类目漏读已确认、本地修复待发布

COM抽查15件官方mapping均有类目，而ERP旧同步只读offer导致921条categoryId为空；已补实际类目/名称及一致性投影回归，尚未提交部署。Yandex原生订单只读、平台分流和旧履约旁路拒绝已接线，LAAS外部Ozon授权/仓映射、履约写入、面单和物流组包仍未实现，不能将现有Ozon模块视为已接入。唯一证据与功能边界见[Yandex owner](yandex-market-api-research.md)。

## 2026-10-28 Yandex 日常商品管理已推送、双区部署完成

`9cae6511`已推送并完成COM/CN标准部署，签名候选474；95项回归、4项真实本机PG、类型/lint/Web构建及商品页隔离Chrome通过。COM已将921件Yandex商品与920份价格导入ERP，平台只返回2件明确可售库存、其余未知；改价/库存/隐藏管理接线已上线，未发真实平台写入。双区FULL VPS和三服务读回通过，各0失败/1既有远端备份warning，官网仍472。CN下载网络失败、临时配置恢复/失败生成物清理及准确证据仅见[Yandex owner](yandex-market-api-research.md)。

## 2026-10-28 Yandex 目录与 Ozon 商品搬运草稿已推送、COM 部署通过

源码 `454d272c` 已提交推送并按标准流程部署 COM，内部签名候选473；备份恢复/迁移检查/VPS及三服务读回通过，VPS 0失败/1既有远端备份warning。69项定向、类型/lint、Web构建与隔离Chrome通过；部署后六类真实 Yandex 读取、Ozon 草稿预览及官方令牌权限读取通过。仅使用COM，CN未访问/部署，官网仍472，真实平台业务写入/费用0。准确 owner、官方无商品dry-run边界和剩余业务仅见 [Yandex 接入与验收](yandex-market-api-research.md)。

## 2026-10-27 `ee6b8999 / 1.0.472` 双区部署与官网公开发布完成

COM/CN 已运行 `ee6b8999ea0aa6b1227b22c10433a70b4c485a3d / 1.0.472`。正式 QA04、REL-04 双区 canary、website approval、CAS、Cloud/Local 匿名 distribution probe 与最终 publication verifier 均通过；COM hosted pilot 保持现有两店/三活动设备范围，CN 保持 AI、BYOK、Ozon dark。COM/CN VPS verifier 均 PASS，各保留 1 条既有远端备份未配置 warning。真实两图 suite 的审核、assignment、幂等回放、数据库读回和 CNY0.20 原件未重跑，Provider/Ozon/新增费用均为 0。准确签名、VPS、canary、approval、distribution 和 post-publication 原件见私有 `release-ee6b8999-website`。

## 2026-10-27 471真实套图与独立草稿应用通过，官网仍470

COM/CN当前均运行`295bbc6f / 1.0.471`，公开latest均仍`999d7b12 / 1.0.470`。9482合法DOTH设备从真实来源精铺完成新采集/隔离草稿、两图、预览、双审核、首次store-draft assignment和幂等回放；六组原始HTTP、PENDING/最终数据库与队列证据齐全，ERP总CNY0.20/Ozon0。尚缺套图前同提交完整native offline原件，现合同不接受事后补跑；已申请保留真实原件、免费修正验收顺序，不再收费。正式QA04/双区canary/approval/CAS/分发探针未执行；唯一证据与未完成边界见[直接适配owner](donor-workbench/direct-adaptation.md)。

## 2026-10-26 `999d7b12 / 1.0.470` 双区官网公开发布完成

COM/CN 已运行并公开服务 `999d7b12d95c0937735aab20a4ad262d87a6c8be / 1.0.470`。两区部署、runtime 备份恢复、FULL VPS verifier、正式 QA04、REL-04 canary、website approval、CAS、匿名 Cloud/Local distribution probe 和最终 publication verifier 均通过；官网 API 实读为 1.0.470。COM/CN VPS 各 0 failure、1 warning，唯一 warning 为远端备份未配置。临时 canary Redis session、token 和专用浏览器均已清理。本轮 Provider/Ozon 请求及费用为 0。

准确候选、签名、QA04、canary、approval、distribution 回执及免费导航证据只见私有 `release-999d7b12-website470` 目录；产品与验收边界仍由[直接适配 owner](donor-workbench/direct-adaptation.md)维护。

## 2026-10-26 补充验收模式实现中，当前完整 pilot 已只读通过

用户已批准的 schema6 将历史执行控制界线约束到真实 START 前，历史完整pilot/noNewTabs不倒填；旧schema1–5语义保持。
143项相关回归通过后，独立复核补强预算记录、实际iframe/完整target列表和规范化ERP域名拒绝。
当前COM完整只读pilot、模型/单张CNY0.10及预算不变已实核通过（正常两设备、DOTH+BINI、六操作），
免费同候选导航及最终回归仍在进行；未生成正式QA04或公开切换。唯一实现与证据边界见[直接适配owner](donor-workbench/direct-adaptation.md#2026-10-26-受控补充验收合同已获批准正在实现)。

## 2026-10-26 原始 offline 日志已恢复，正式验收剩余边界已集中核对

同cc96a1e3原终端完整stdout已恢复并通过原offline分项校验，无新增费用；旧运行的pilot采样顺序/完整选键和入口前后页签证明仍不满足现合同，尚未修改验收语义或公开切换。原件、精确时序及待用户确认的无新增生图收口方案仅见[直接适配 owner](donor-workbench/direct-adaptation.md#2026-10-26-原始-offline-stdout-已恢复正式-qa04-合同缺口已集中核对)。

## 2026-10-26 fresh suite 原始回执取证已修复

真实 START/CONTINUE、双审核、首次 store-draft assignment 和原请求幂等回执及数据库读回已闭合；正式 QA04 的原离线日志和完整 pilot qualification 输入仍待核验，未公开切换。唯一根因、原件及清理边界见[直接适配 owner](donor-workbench/direct-adaptation.md#2026-10-26-start-漏捕根因修复新的真实套图业务原件已闭合)。

## 2026-10-25 `cc96a1e3 / 1.0.469` Yandex guarded integration 双区部署

`cc96a1e3ba2de43bff179b9a1593de1d03325002 / 1.0.469` 已推送并完成 COM hosted-pilot、CN direct/dark 双区标准部署。两区均通过目标 commit 绑定的 deployment backup/restore、Yandex offer 迁移、扩展签名包校验、API/Worker/Web 重启及 `/ready`、DB、Redis 只读核验；COM 与 CN 均保持原有 rollout 策略。CN 部署期间修复了临时 pnpm wrapper 递归覆盖真实入口的问题，临时构建缓存和 wrapper 已清理，旧版本与失败目录未删除。`YANDEX_MARKET_PUBLISH_ENABLED` 仍关闭，没有真实 Yandex/Ozon/Provider 业务写入或新增费用。官网公开扩展指针未切换，当前记录仅证明应用部署完成，不代表官网最新版公开发布或 Yandex 真实店铺验收完成。准确合同与 API 边界见 [Yandex Market API 研究](yandex-market-api-research.md)。

## 2026-10-24 Yandex Market Partner API 只读研究

Yandex Market 已完成店铺接入、`Api-Key` 连接测试、campaign/business 映射、Ozon/ERP 商品草稿预览及受显式确认/幂等/未知态保护的商品目录发布 owner；发布默认由 `YANDEX_MARKET_PUBLISH_ENABLED` 关闭，尚未调用真实 Yandex 店铺，库存/价格/订单同步、物流标签和真实发布验收仍未开放。官方合同、`businessId/campaignId` 和授权边界见 [Yandex Market API 研究](yandex-market-api-research.md)。

## 2026-10-24 扩展权限可视化管理已双区上线

超级管理员`/admin/settings`新增结构化用户/店铺/设备/平台与托管AI范围管理，复用原batch/expectedRevision/审计。功能与旧翻译重复写入修复已提交推送，两区运行`d6e693a3`（内部签名468），标准部署/备份恢复/FULL VPS及生产HTTP/管理员页只读验收通过，各区24项配置前后完全一致，COM原试点/CN dark保持。109项后端、11项前端新行为+3项原合同、类型/lint、Web/API build及隔离Chrome流程通过，新增Provider/Ozon/费用0。官网仍为已公开验收466，本次后台功能无需重装扩展；组包已存在、真实仓库准入/实货签未测。唯一证据和边界见[访问管理owner](extension-access-administration.md)。

## 2026-10-24 466双区官网公开发布完成

`a2e70f59 / 1.0.466` 已提交推送、区域签名并完成COM/CN标准部署、备份恢复、FULL VPS、签名ZIP的MV3安装和完整native offline。按用户批准的精确四文件blob复用原465两图/收费/审核/assignment/幂等原件，当前模型/价格及数据库只读核对、正式QA04、双区REL04/官网approval/CAS/四包匿名下载和final verifier均通过；新增Provider/费用/Ozon为0。COM原DOTH+BINI试点、CN dark保持。部署失败及实际停机、新增管理界面仍独立未上线的边界仅见[接口owner](ozon-api-compatibility-audit.md)，受控复用见[验证owner](release-validation.md)。

## 2026-10-23 465正式套图通过，CN官网已公开，COM消费者兼容待发布

`c04a19bf / 1.0.465` 的完整native offline、真实DOTH两图、预览审核、两条store-draft assignment/幂等、正式QA04及双区REL04已通过，ERP实际CNY0.20/Ozon发布0。CN官网approval/CAS、匿名Cloud/Local下载和最终验签完成；COM官网仍461，签名器和下载消费者拒绝已批准的每设备店铺证据`deviceShopIds`。两个消费者已本地修复并通过定向回归，尚未提交/部署；扩展本体及生图/金额/权限不变。用户现已批准精确四文件Git内容的受控原件复用和后续提交/签名/双区部署，不再发付费请求；独立权限管理界面另行实现。唯一证据、失败顺序和当前边界见[接口与组包owner](ozon-api-compatibility-audit.md)，复用限制见[验证owner](release-validation.md)。

## 2026-10-23 组包交仓与面单修复已双区部署

源码 `c04a19bf / 1.0.465` 已提交推送、区域签名并完成 COM/CN 标准部署；组包前向迁移、备份恢复、两区 FULL VPS 与三服务/公网 ready 通过。CN 已实读现有 RDS 账号 `rolcreatedb=true`，无需新建或提权，临时维护连接已移除；此前“CN账号没有CREATEDB”未经CN实库核实，已更正。COM原pilot、CN dark保持，官网仍461，未CAS。真实店铺组包准入与实货签打印仍未验证；准确证据、部署失败及停机边界只见[接口与组包owner](ozon-api-compatibility-audit.md)。

## 2026-10-23 面单默认类型与弹窗本地修复

截图问题定位为默认强制big_label与关闭/打印布局重叠；已改为优先平台小面单、仅普通格式时继续兼容，错误不再一律归因未打包。独立预览组件同时修正旧请求/PDF清理，37项定向、Web类型/lint及隔离Chrome桌面/390px布局、竞态和打印函数检查通过。尚未提交部署，线上仍464；官方普通/小标签与集包货签独立，API Key到期权限检查和Beta财务监测是待办，唯一记录见[接口与面单owner](ozon-api-compatibility-audit.md)。

## 2026-10-23 Ozon 接口迁移已推送并双区部署

COM/CN应用均运行`099c2663 / 1.0.464`，源码已推送。订单/图片/促销/聊天/面单/退货/财务与配送合同已迁移；最终clean提交native offline、后端7445passed/395既有skip、区域签名MV3、两区备份恢复与FULL VPS均通过，ready/DB/Redis正常。标准门禁期间API/Worker有停机，COM原试点/分析与CN dark保持；官网仍461，无官网CAS或新增付费测试，真实订单/图片/财务对账未冒称通过。准确原件、版本与未验证边界仅见[接口迁移owner](ozon-api-compatibility-audit.md)。

## 2026-10-22 双区安全补丁维护完成

COM/CN应用均运行`d9566394 / 1.0.463`；三服务实际进程为独立Node22.23.4，内置OpenSSL3.5.9、Sharp0.35.5/librsvg2.63.2、Undici8.12.3及系统CA已实读确认。目标备份/日常恢复、完整native offline、签名MV3及双区FULL VPS通过，DB/Redis正常；COM原试点及商品分析、CN dark保持。High由11降至1，braces仍无上游发布修复，未忽略CI告警；官网仍公开461，未CAS、无新Provider/Ozon/费用，Premium未改。准确版本、失败/取消记录、回滚材料与剩余边界仅见[安全运行时维护](security-runtime-maintenance.md)。

## 2026-10-17 `efd4f4ad / 1.0.461` 双区官网公开发布完成

多店 QA04 修复已推送，461 自身完整 native offline、签名包 MV3、双区标准部署/备份恢复/FULL VPS 通过。原 460 两图及 CNY0.20 收费原件不变，当前模型/价格与完整数据库只读核验通过，正式 QA04、COM v3/CN v2 canary、官网批准/CAS、四包匿名下载及最终验签均通过；两区应用和官网均为461。本轮新增Provider/费用/Ozon均0，临时发布设备与账号凭据已撤销清理；COM 保持 DOTH+BINI 与商品分析，CN 保持 dark。COM 本地网络下载超时及实际成功原件均保留，不宣称所有网络路径稳定。准确候选、回执及剩余边界只见[直接适配owner](donor-workbench/direct-adaptation.md)，受限复用合同见[验证owner](release-validation.md)。

## 2026-10-17 460真实套图闭合，正式发布被QA04单店合同拒绝

用户授权的COM/DOTH两图已成功，CNY0.20；审核前原件、审核/store-draft assignment/幂等、pending全0及队列读回通过。QA04仍将真实DOTH+BINI pilot强制等同单店，原生拒绝`QA04_SUITE_INVALID`，未改写证据或公开指针。新增合同修复范围待用户确认，本轮不再新增费用；测试设备/会话及9470已清理。首次默认BINI误建的隔离草稿、正确DOTH草稿、准确原件与官网未完成边界统一见[直接适配owner](donor-workbench/direct-adaptation.md)。双区应用460/官网458保持。

## 2026-10-16 佣金修复460已推送、签名并双区部署

COM/CN均运行 `5b7ba450 / 1.0.460`，native offline、双区签名MV3、备份恢复/FULL VPS/ready通过。用户明确授权后COM pilot已通过现有管理员配置owner扩至DOTH+BINI，CN保持dark；COM签名460真实佣金同步/断网保留通过。官网仍458，付费正式验收与公开切换未执行；新签名包已交付本机Downloads用于教程。OGL精确规则与新增公开API仍未核验，不混入佣金修复。唯一部署/策略/费用及证据记录见[直接适配owner](donor-workbench/direct-adaptation.md)。

## 2026-10-16 官方佣金同步与备用误报本地修复

已从官方动态正文及普通Excel读取费率，修复备用冒充同步成功、失败覆盖缓存和品牌/类型误选；87项定向、Cloud/Local632/628及全新MV3真实同步/断网刷新通过。工作树尚未提交或发布，已交付签名459不含此修复，线上/官网仍458；旧列表静态测试及旧lint的已复现基线不计通过。具体owner、原始证据和不付费发布边界只见[直接适配owner](donor-workbench/direct-adaptation.md)。

## 2026-10-16 Ozon 修复459已提交签名，按用户选择暂缓公开发布

修复源码 `43a8007c1bb8144d321325d6983088ffdd4733ce` 已推送，COM/CN `1.0.459` 候选均已签名、验签及真实MV3安装通过。用户选择“仅提交和签名，付费验收暂缓”后，未发送新Provider请求；已安全停止此前启动的部署/离线检查，两区current/官网仍458且服务、DB/Redis正常。没有正式QA04、website approval/CAS或公开下载切换；准确签名、停止/恢复和未验证边界仅见[直接适配owner](donor-workbench/direct-adaptation.md)。

## 2026-10-16 Ozon 列表展开与采集入口回归本地修复

已修复旧清理留下的列表启动未定义调用、被误删的展开事件及列表/详情采集入口；计算器保持独立，旧上下文storage错误改为可捕获刷新提示，佣金文档精准host补齐。88项定向回归、Cloud/Local开发包626/622项及隔离Chrome真实点击通过；用户已要求提交、签名并公开发布，准备新459候选，官网仍458。原故障、证据、恢复范围与尚未验证边界仅见[直接适配owner](donor-workbench/direct-adaptation.md)。

## 2026-10-16 验证范围与发布流程本地优化

已接入 `validate:change` 按Git改动选择本地验证、可恢复原日志回执、QA04同进程类型检查去重，以及文档/纯CSS目标的受限历史suite复用；原始业务证据、当前配置、签名/目标界面和正式发布检查仍分别验证。本轮按用户要求形成源码提交，不包含签名、部署或官网切换，生产/官网继续458；独立组件部署、构建缓存和新UI producer真实签名浏览器验收尚未完成。范围、使用方式、T2验证及限制统一见[验证流程owner](release-validation.md)。

## 2026-10-16 `2e97c9d3 / 1.0.458` 双区官网公开发布完成

COM/CN 应用及官网 Cloud/Local 下载均为 `2e97c9d39ed6eb075830ad6aabe5d386cbdc8761 / 1.0.458`。同提交 native offline、签名包 MV3、备份恢复、FULL VPS、真实来源页两图套图、审核、store-draft assignment/幂等、正式 QA04、双区 canary/approval/CAS、四包匿名下载及最终 publication verifier 均通过；COM 下载消费者遗漏已真实关闭。临时发布/QA 凭据与专用9470已清理，用户9222和业务原件保留。两区过期备份/失败部署生成物清理已完成；未识别到可删除的 R2 数据库备份桶，图片桶未动。准确费用、质量边界、回执及保留项仅见[直接适配owner](donor-workbench/direct-adaptation.md)。本次收尾提交仅更新日志和文档，不改变运行候选身份。

## 2026-10-16 正式457 QA04通过，CN已公开，COM下载消费者修复准备458

最后r9已完整保存两图PENDING→preview→审核→两条store-draft assignment→原请求replay，正式QA04 PASS；双区canary/approval/CAS通过，CN匿名Cloud/Local下载及final verifier通过。COM匿名probe真实404，定位服务端下载消费者漏接已批准六项配置；已在canonical部署锁下恢复原签名456指针，CN457及应用a899保持。唯一service及实际Fastify下载测试最小RED→GREEN，准备新的458候选标准部署/发布，不改写457原件或绕过fresh suite门禁。准确原件、短暂404及回滚、清理数量与当前未完成边界仅见[直接适配owner](donor-workbench/direct-adaptation.md)。

## 2026-10-16 最新构建已部署，官网发布等待最后来源页原件

双区已运行 `a8998f55 / 1.0.457`，同提交 native offline、签名包MV3、备份恢复及FULL VPS验收通过；官网仍公开原456。供应商两轮503未决均已受审计关闭并释放ERP预扣，本日新的两图已成功，用户确认在9470手动审核并应用，草稿及两条assignment正确，但正式验收的预览/审核原响应未被采集，不能补造QA04。最后一次独立run尚未发出Provider请求，9470已显示1688登录验证，等待用户仅完成登录后由Agent继续取证。两区已清理过期后台备份及失败部署副本的生成缓存，R2数据库备份未配置、图片桶未动；准确数量、回执、未验证边界仅见[直接适配owner](donor-workbench/direct-adaptation.md)。

## 2026-10-15 官网最新构建发布准备

用户授权切换公开下载。前轮507指定商品同窗采集、两张1086×1448原图→900×1200成品、审核/两条store-draft assignment及幂等已通过，ERP CNY0.20/Ozon0，临时9470与QA身份已清理；原记录保留。当前补齐QA04来源页schema5及COM固定六项配置的发布消费者，准备可识别的新候选457及其完整门禁，官网仍原456；事实与原件只见[直接适配owner](donor-workbench/direct-adaptation.md)。

## 2026-10-14 `5071312a` 窗口及竖图修复双区部署完成

`5071312a72afb89d7786e4ee80437b5a39d60bd8` 已推送、区域签名及标准COM/CN部署，API/Worker/Web同current、DB/Redis与ready正常；目标及日常备份恢复、两区FULL VPS canonical均PASS。内部候选仍456，官网继续原 `e978c9bd / 1.0.456`；未执行官网CAS。签名包已在9470原隔离profile更新并保留合法设备会话，指定商品928561537986的新来源页被真实1688滑块遮挡，尚未提交新采集/套图、无本轮新增Provider/Ozon/费用。用户手动验证后从现有窗口继续同窗草稿、两图、审核、assignment与幂等；准确回执与原件仅见[直接适配owner](donor-workbench/direct-adaptation.md)。

## 2026-10-14 `7250c766` 双区部署，指定商品真实套图待尺寸接线

共享SKU归属修复已两区部署，FULL VPS/备份恢复/ready通过；928561537986绿色XL新采集、计划与真实START/CONTINUE通过，但供应商结果未通过严格原图尺寸检查。两图ERP预扣CNY0.20已由既有owner释放，原失败保留；独立校准得到1086×1448完整3:4竖图，尺寸owner91项本地GREEN，SQL真实RED已确认，前向SQL/正式验收/部署未完成。用户最新要求先分析类目及文案全屏覆盖，原因与真实费用边界只见[直接适配owner](donor-workbench/direct-adaptation.md)；官网仍原456。

本地后续修复已完成但尚未提交/部署：新增前向迁移允许已验证的1086×1448 count原图并通过完整PG升级回放；精铺子窗口CSS恢复有界不透明布局和独立滚动，分析入口/停止流程不再叠加属性窗口或复活后续步骤。隔离浏览器15组窗口验收、服务端138项定向、AI媒体PG升级、扩展618项静态验证和68项工作台回归通过；未新增Provider/Ozon请求。

## 2026-10-14 `83a5aee3` 订单履约修复已双区部署

订单备货/V4回读、平台备货→国内在途、详情四阶段和截止时间修复已提交推送，COM/CN 的 API、Worker、Web 均运行 `83a5aee3deac07daa82ec55aa0262b868d8ac302`。双区标准部署、目标备份及日常备份恢复、FULL VPS canonical、服务和公网 ready/DB/Redis通过；COM按用户授权保留现有功能开关，CN dark。官网扩展仍公开旧 `e978c9bd / 1.0.456`，没有 Provider/Ozon 写入或费用；准确回执、未验证边界及回滚只见[直接适配owner](donor-workbench/direct-adaptation.md)。

## 2026-10-14 Ozon 备货与详情履约显示本地修复

已核实官方 V4 备货→`awaiting_deliver` 与 `shipment_date` 截止语义；平台回读驱动国内在途，ERP 备货按钮及旧入口统一 owner，详情四阶段替换误判“已发货”。113项定向、真实隔离PG3项、Web构建/类型与独立Chrome组件验证通过；尚未提交/部署或操作真实Ozon，准确范围仅见[直接适配owner](donor-workbench/direct-adaptation.md)。

## 2026-10-12 `809e4348` Web 单独部署完成

订单筛选 UI 已在 COM/CN 两区单独构建并切换到 `809e434822759eff0d5a3a42b9c62ff0bcf56e5d`；仅 `ss-erp-web` 使用该 Web 产物，API/Worker、扩展和官网公开指针继续保持 `e978c9bd / 1.0.456`。两区 Web 登录页、服务 active、DB/Redis ready 均通过。没有扩展签名、官网 CAS、Provider/Ozon 请求或费用。

## 2026-10-10 `e978c9bd / 1.0.456` 双区官网公开发布完成

最终456已推送、签名、原生offline、标准双区部署/备份恢复/FULL VPS、真实两图审核/store-draft assignment/幂等、正式QA04、COM/CN canary/approval、CAS、四个匿名下载及final publication verifier全部通过。两区latest/应用均456、ready/DB/Redis正常；455未知主图ERP0.10按授权释放且原UNKNOWN保留，本轮新增ERP0.30/Ozon0。临时账号/设备/9466已清理，用户9222和业务原件保留。准确失败/恢复、质量及原件边界仅见[直接适配owner](donor-workbench/direct-adaptation.md)。

## 2026-10-10 524未知结果终止已授权，本地owner修复准备456

用户明确批准释放455未知主图ERP CNY0.10预扣并继续发布；本地新增精确count/无ID/不可变dispatch资格和受审计ABANDON，不伪造供应商无输出或零费用，不重试旧请求。定向/实库回归已通过，最终456候选待提交后offline、签名、双区部署与真实suite/正式QA04/官网门禁；生产仍455、官网448，准确事实仅见[直接适配owner](donor-workbench/direct-adaptation.md)。

## 2026-10-10 455 双区部署完成，官网被供应商524未决主图阻塞

最终 `72bd796b / 1.0.455` 已推送、签名、原生offline、双区标准部署/备份恢复/FULL VPS通过；来源转存和参考复用真实通过，454已结算主图恢复按授权关闭且原CNY0.10保留。455新的两图suite场景成功、主图供应商HTTP524且无task ID，费用/恢复各1未决，未重试。官网仍448，正式QA04及公开门禁未执行，临时设备/会话/测试浏览器已清理；准确事实及下一处置边界只见[直接适配owner](donor-workbench/direct-adaptation.md)。

## 2026-10-10 454 双区部署与来源图真实通过，455修复计费和恢复准备

COM/CN 已运行 `2a2015b1 / 1.0.454` 且服务健康；新真实9图转存、公网SHA及扩展解码通过，套图已复用该来源资产。两图任务场景成功、主图因尺寸合同拒绝，ERP原两笔CNY0.10已结算/Ozon0。用户批准保留旧失败主图测试费并受审计关闭恢复；未来尺寸不合格不提前结算、已结算恢复从不可变接收事件核验的修复已本地验证。最终455候选待完整发布，官网仍448，准确边界仅见[直接适配owner](donor-workbench/direct-adaptation.md)。

## 2026-10-10 来源图真实验收通过，套图参考复用修复准备454

453签名扩展真实1688新快照9图已转存ERP OSS/R2，数据库/公网SHA/扩展匿名解码通过；套图START成功后CONTINUE在Provider发包前409参考资产编码冲突，无费用/Ozon写入，原件保留。参考复用owner已RED→GREEN并通过真实PostgreSQL27项；须新454候选部署后再取得正式QA04与公开发布证据，官网仍448。准确进度仅见[直接适配owner](donor-workbench/direct-adaptation.md)。

## 2026-10-10 `ae4d6986 / 1.0.453` 双区应用部署完成

来源图异步转存、OSS/R2 displayUrl、精铺自动只读刷新已随 `ae4d69861be0e6a56c15db0fd301c3866547f74e / 1.0.453` 部署到 COM/CN。两区签名包 MV3 安装、部署备份恢复、canonical VPS、`/ready`、DB/Redis 和运行配置均通过；COM 保持原 DOTH hosted pilot，CN 保持 direct/RDS dark。官网 Cloud/Local 下载仍安全服务 `66c9396c / 1.0.448`，尚未执行新 website approval/CAS/distribution probe。Provider/Ozon/新增费用为 0。准确证据见[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-10 来源图片异步转存本地完成

V2/legacy新快照采集不等待网络，后台按准确owner/snapshot/mediaKey分页转存到ERP-owned OSS/R2，列表/工作台使用独立显示地址，精铺自动更新时保留未保存编辑；快照原件和草稿版本不变。实现`be6d8ffd`已提交推送，真实本机PostgreSQL8项、后端150项、扩展/Web55项及隔离Chrome自动切图通过，服务端构建和类型/lint通过。未签名/部署/公开更新，生产452/官网448保持。证据及资源边界仅维护在[直接适配owner](donor-workbench/direct-adaptation.md)。

## 2026-10-10 `6e028c70 / 1.0.452` 双区应用部署完成

订单履约五阶段、二级筛选、确认备货审计及采集图片防盗链修复已部署到 COM/CN，服务、DB/Redis、`/ready` 和运行 commit 均通过；官网扩展继续公开 `1.0.448`。采集图根因是 1688 Referer 防盗链，生成图已核实由 ERP-owned OSS/R2 兼容对象存储和数据库 MediaAsset 记录共同承载。订单独立 PostgreSQL runner 2 项通过、服务端定向55项、Web typecheck/lint和图片/订单回归通过。准确范围见[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-09 采集图片加载与订单履约阶段收口（本地验收完成）

已确认采集图空白是 1688 CDN 的 Referer 防盗链：带 `https://app.ss-erp.com/` 返回 403，去掉 Referer 返回 200；不是数据库或对象存储缺图。来源图片现在统一由 `SourceProductImage` 使用 `no-referrer`，ERP `/api/cdn` 图片匿名 CORS，失败显示占位。生图资产已核实通过 ERP-owned OSS/R2 兼容后端写入对象存储并在数据库保存元数据。

订单履约 owner 已统一为五个上层阶段：采购备货、国内在途、仓库处理、出库发运、异常；仓库处理包含待打包/待发货，出库发运包含配送中/已送达，异常包含取消/其他异常。新增服务端 `stock_ready` 审计动作和同店权限检查，列表/管线/详情共享阶段与二级状态解析。定向服务端33项、Web订单/图片5项和 Web typecheck 通过，尚未提交或部署。

## 2026-10-09 `66c9396c / 1.0.448` 双区官网公开发布完成

448 已完成推送、原生 offline、区域签名、双区标准部署、备份恢复、FULL VPS、真实 9458 精铺采集/草稿/START/CONTINUE、两图 Provider 套图、审核、独立 store-draft assignment、幂等 replay、正式 QA04、COM/CN canary、website approval、CAS、匿名 distribution probe 和最终 publication verifier。COM/CN 官网 latest 与 Cloud/Local 下载均实读 448；COM 商品分析继续 qwen-vl-max，CN direct/RDS dark。真实 suite 两笔 ERP CNY0.10 settled、Ozon0；447 的失败 count 任务已按新合同释放 ERP CNY0.10 预扣并保留原失败/供应商未知费用事实。临时发布账号/9458已清理，用户9222保留。准确原件只维护在[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-09 count响应与当前图片过程本地修复完成，准备448

用户批准的首图选择、count未交付受审计释放和当前图片过程/历史折叠已本地完成；Provider137项/追加匿名下载、owner66项、PG10+8及Chrome过程与iframe恢复通过。447生产套图的失败/未决预扣保持原件，未重发Provider；线上447、官网434，准备最终448候选，准确边界仅见[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-09 `9f074c87 / 1.0.447` 双区部署与 VPS 验收完成

447 已推送、区域签名、标准双区部署及 FULL canonical VPS 验收通过，DB/Redis 与三个服务正常；同提交原生 offline、7197 项后端回归、构建和签名安装通过。COM 分析开启/原 DOTH pilot、CN direct/RDS dark 保持。用户通过9457滑块后完成真实采集/草稿/ERP精铺入口，两图suite一张成功/CNY0.10 settled，另一张因供应商请求1却返回3而拒绝；cost/recovery各1待闭合，正式QA04/官网门禁未完成、官网仍434。未重发Provider/Ozon或读取账单；新增count终止恢复合同已提交范围确认，详情仅见[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-09 446 完整套图及正式 QA04 已通过，CN 官网消费者修复准备447

同一446套图已完成持久化审核回执恢复、真实UI应用、两条store-draft assignment和原请求幂等重放；正式QA04 PASS，无新Provider请求/Ozon写入。双区canary均通过，但CN官网批准消费者错误拒绝`disabled/custom`（所有AI/BYOK/上架仍dark）；服务端下载消费者同样存在该缺口。两处T2正例RED→GREEN，启用/未知provider和非dark拒绝、37后端及33发布回归通过。当前官网仍434，准备447新干净候选，详情仅见[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-09 `d64649fd / 1.0.446` 双区部署完成，官网仍待正式 QA04

1.0.446 已提交、推送、COM/CN 签名验签并按标准入口部署；两区 `/ready`、DB/Redis、部署 commit、签名包 MV3 安装和备份恢复通过。COM hosted pilot 仍限原 owner/shop/device/operation，CN direct/RDS dark。修复版新增候选图片 `crossOrigin="anonymous"`，真实 Chrome 预览两图均解码 900×1200，原始 CDN/CORP 保持不变。

修复版新的两图 suite 已真实 START/CONTINUE 一次，Provider POST 2 次，ERP 结算最高 CNY 0.20；两槽 attempt 1、SUCCEEDED、原始图片和审核前 PENDING 证据均保留。新版原生预览已通过并完成两图目视确认；当前同一 suite 的审核 readback/正式 QA04 输入、双区 canary、website approval、CAS、distribution probe 尚未闭合，官网两区仍安全服务 `14985551 / 1.0.434`。没有 Ozon 写入，也未读取 Provider 控制台或账单。

准确实现和失败原件仅维护在[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-08 count候选预览/应用修复准备444

443正式freshsuite已真实两图成功/CNY0.20，但preview被旧normalizer检查409，不能公开。Preview/assignment消费者已接冻结runtime和真实raw验证，108定向及215实库/升级回放通过；尚未部署修复或执行官网CAS。旧失败输出/原件保留，新444继续同一发布授权，准确事实见[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-08 官网443切换准备：count正式QA04合同与新隔离草稿

正式QA04新增精确count/CNY10 schema4，完整59项及count主Agent回归通过，ERP/扩展运行源未变，目标仍b3282d37/443。目标native offline、签名专用Chrome、正常DOTH配对/1688采集/隔离草稿/两槽计划已准备；尚未发起新生图，官网仍434。截图旧独立工作台重复入口已核实，界面退役不由后台合同验收冒充；准确边界与后续证据仅见[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-08 `b3282d37 / 1.0.443` 双区部署与普通 Wanx 配置替换完成

COM/CN同commit标准部署、签名MV3安装、备份恢复、canonicalVPS及publicready已通过。两区普通TEXT/I2I/FULL_EDIT/INPAINT和suite均配置提供的custom/count服务及加密Key，CNY0.10/张、旧Wanx文字override清空；模型/价格/Keyrevision实际读回通过，原店铺/feature权限不扩大，CN功能仍dark、COM商品分析保留非Wanx的qwen-vl-max。最终server7189项与214项实库通过，本轮3次真实合成图Provider校准、Ozon0。官网仍434，新正式QA04/CAS未执行；证据与限制仅维护在[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-08 普通 count 最终候选443准备部署

442全量7172项通过但17个离线CLI因图片profile依赖被拒；协议标识已拆为无依赖合同，原CLI及图片关联84项、类型/lint通过，图片行为不变。最终443继续已授权双区部署与普通Wanx配置替换；旧失败候选未部署，证据边界见[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-08 普通 count 最终候选442

完整本机AI Media实库214项通过，候选441在类型检查发现新增成品metadata可空判断遗漏，已修正并通过类型检查；未部署441或替换生产普通模型配置。最终442继续已授权的双区部署与全部Wanx新请求配置切换，准确记录见[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-08 普通 count 生图/改图接线完成，441双区候选准备

用户授权清除普通Wanx新请求配置并双区部署。指定count服务已接普通TEXT/I2I/FULL_EDIT/INPAINT、明确CNY报价、raw真实尺寸与规范成品及mask外区保护；三次真实合成图传输校准、8项实库/287项定向与类型/lint通过。普通文字/视觉分析不是Wanx，保留qwen-vl-max。当前尚未提交或部署，后续配置与发布边界仅维护在[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-08 双区 `5ebe68b1 / 1.0.440` 部署及 COM 新套图模型生效

COM已通过现有管理员配置owner切换托管套图到提供的 `ai.big-model-api.top / gpt-image-2-count`、加密Key及CNY0.10/张；单张10minor/两张20minor/执行就绪实际读回通过，普通图片操作原配置与qwen-vl-max分析保留。CN保持direct/RDS dark，两区服务、备份恢复、签名MV3与canonical VPS通过。无新生图POST/费用或Ozon写入；官网仍1.0.434，新提交正式QA04与公开pointer尚未执行。唯一准确证据/验证限制见[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-08 SQL 套图合同兼容完成，最终候选440

439完整构建及7120后端测试通过后，native offline发现旧SQL拒绝新版Wanx/count冻结；前向兼容迁移已取得真实Postgres RED→GREEN、211项AI Media及升级回放通过，原身份/金额/引用/恢复guard保留。尚未部署或写入生产模型；最终440继续原授权COM新模型/CNY0.10，CN dark。官网仍434，完整QA04不由分项验证替代，准确事实见[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-08 独立 Worker 验收接线修正，最终候选439

438完整检查发现独立 Worker VM仍注入旧全局读取函数，4项失败已复现并修正，独立CNY/普通图片隔离回归也通过。没有部署438或保存生产模型配置，最终439从新提交继续同一授权部署；原签名和失败证据保留。准确范围见[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-08 COM 套图新模型与 CNY0.10 配置接线准备

用户授权切换提供的模型、域名和 Key，并指定单张预扣 CNY0.10。为保留普通图片操作，套图新增独立加密/修订配置 family；原默认 inherit，CN dark 与商品分析保持。配置/运行/报价关联202项与定向 lint已通过，尚未执行生产配置写入；后续提交、构建和部署证据仅维护在[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-08 `136aa330 / 1.0.437` 已推送、签名并双区部署

GPT2套图质量修复及发布前兼容收口已完成提交/推送、区域签名、完整preflight/build、双区标准部署、备份恢复、实际签名包MV3及canonical VPS验收；两区应用均运行`136aa330 / 1.0.437`，db/Redis正常。COM AI分析开启、CN direct/RDS dark保持；生产Provider/Key修订/价格读回完全不变，COM默认仍Wanx。官网公开下载仍1.0.434，本轮未执行正式QA04/网站canary/approval/CAS/distribution，也没有新增Provider/Ozon请求。当前准确证据只维护在[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-08 文字生图 fallback 兼容边界修正，最终候选437

436完整检查的7077项通过、2项Wanx隔离回归失败，暴露fallback误适用全部Provider。已限定仅custom恢复原文字生图兼容，Wanx图片编辑仍不继承文字生图；原2项RED→关联132项GREEN，未部署436、未新增费用。最终437的后续部署见最新记录，旧候选与失败日志保留；见[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-08 Provider 发布审查目录收口，最终候选 `1.0.436`

435中间候选已签但完整preflight在静态Provider审查目录拒绝新注册项，未部署。现已按实际证据补齐count精确端点单参考记录和通用GPT2未晋升记录，保留扩大引用/操作/端点时拒绝的回归；最终候选436继续绑定新clean commit验证和双区部署。当前线上和官网仍1.0.434，未新增Provider请求；事实见[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-08 已授权提交和双区部署，准备 `1.0.435`

真实两图质量修复已通过，发布前进一步收口文字生图兼容、普通I2I请求隔离及单参考计划预览。当前提交/签名/部署由本次用户明确授权；生产Provider/Key/报价保持当前配置，新模型启用与官网公开仍需各自配置和正式回执。准确事实只维护在[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-08 原精铺模型真实质量对照通过，修复仍未部署

用户提供测试Key后，在COM VPS隔离进程按 `ai.big-model-api.top / gpt-image-2-count` 完成两次真实单参考请求；两张原图1008×1344→全画幅900×1200均成功，上下白条0行，主图棚拍/场景背景与光照区别明确。本地后端profile、冻结、归一化及该精确端点的单参考准入已接齐，凭据轮换发包前拒绝；不扩大多参考/改图/局部重绘证据。无Ozon/ERP草稿或生产配置写入，未读供应商账单。本轮源码仍未提交、推送、签名或部署，线上仍1.0.434；完整事实见[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-08 套图白边/创作差异定位，原精铺模型适配未发布

真实原件证实 `1.0.434` 白边由方图→900×1200的白底contain后处理产生；Wanx套图缺少可信的顶层编辑要求。4次独立质量校准均未达到换背景/无色条要求，失败结果未应用；用户随后明确批准按原精铺接口/模型适配并指定 `https://ai.big-model-api.top / gpt-image-2-count`。本地已补1008×1344高质量multipart、全画幅等比归一化、可信槽位指令和冻结/准入接线，新能力保持未晋升。真实GPT2质量验收等待该服务API Key的安全录入；线上仍1.0.434，未提交/推送/部署本轮实现。唯一证据与范围见[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-07 `14985551 / 1.0.434` 双区官网公开发布完成

Agent 自建 9444 专用浏览器加载实际 COM 签名包，完成新隔离 DOTH 草稿的两图真实 suite、审核、store-draft assignment 和原幂等 replay；正式 QA04、双区 REL-04 canary、website approval、CAS、完整匿名 Cloud/Local 下载和最终 publication verifier 均通过。两区 `/api/extensions/latest` 与运行应用均为 `14985551 / 1.0.434`，db/Redis 健康；COM AI 分析保持开启、CN dark。ERP 结算 CNY 0.28，Ozon 写入零，临时测试设备/账号会话已清理，用户 9222 浏览器保留。图片创作质量限制和原件摘要只维护在[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-07 专用 Cloud `1.0.434` 已加载，撤回无证据的 session allowlist 归因

Agent 已自行启动独立 9444 Chrome 并加载未修改的 COM 签名 Cloud `1.0.434`，保留用户 9222 浏览器；正常接口配对、真实 1688 采集、新隔离 DOTH 草稿和两槽计划审核通过。先前手工 START 含服务端 strict schema 不允许的 `authorityHash`，`command_context_forbidden` 不能证明 session allowlist 拒绝；当前原范围 pilot 只读核验也通过。真实 START/CONTINUE 尚未执行，正式发布仍待完整离线回执与 fresh suite，详见[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-07 `14985551 / 1.0.434` 双区应用部署完成，官网仍待正式 QA04

COM/CN 已按标准入口部署 clean commit `149855518f39e0475571e8ab6fc382530a177b7f / 1.0.434`；COM 保持受限 hosted pilot，CN 保持 direct/RDS dark。双区备份恢复、canonical VPS evidence、`pnpm qa:04:offline` 与签名包校验通过，未产生 Provider/Ozon 请求或费用。正式 fresh normal ERP suite、QA04、REL-04 canary、website approval、CAS、distribution probe 尚未完成，因此官网 pointer 仍保持旧版本。准确证据与限制见[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-06 `21bbd220 / 1.0.432` 类目与属性读回修复双区公开完成

COM/CN 应用、官网 latest 和 Cloud/Local 下载均已公开 `21bbd220cad4ee9d97f0e51db59d6a7afdaeecc4 / 1.0.432`。类目确认后等待真实草稿读回、被替代属性请求不阻断新版本、过程窗口当前步骤入口与统一按钮均有定向及签名包浏览器证据；正式 QA04、双区备份恢复/VPS/canary/approval/CAS、匿名完整下载和发布后验收通过。COM 商品分析保持开启、CN dark；无新增 Provider/Ozon 请求或费用，临时会话已清理。准确原件和限制仅维护在[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-06 类目/属性读回时序收口，最终候选 `1.0.432`

431中间候选尚未部署，复核发现保存期间读回空返回及被替代属性请求阻断新版本分析，已在实际函数中 RED→GREEN 收口。59项关联回归、保存回执先于projection的Chrome流程和过程窗口当前步骤/按钮统一验收通过；最终候选改为432。线上仍为 `98f94f1e / 1.0.430`；唯一证据与界限见[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-06 类目确认后的权威刷新修复，准备 `1.0.431`

用户实测发现类目属性已经读回时，连续准备仍可能停在“确认官方类目”，根因为类目保存回执先于 bridge 的权威 projection 刷新返回。扩展现在等待刷新和编辑器读回后再继续；类目窗口明确区分“已选中”与“确认类目并继续”，过程/准备按钮样式统一。定向保存、类目对话框、连续准备和隔离 Chrome 回归通过；当前线上仍为 `98f94f1e / 1.0.430`，准备新候选。准确范围和发布边界见[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-06 `98f94f1e / 1.0.430` 工作台调度与 AI 入口双区公开发布完成

COM/CN 应用、官网 latest 和 Cloud/Local 下载均已切换到 `98f94f1e2e1854238a54d8fc2b90e4a7b27e6b12 / 1.0.430`。完整原生 offline/正式 QA04、签名 MV3、双区备份恢复/VPS/canary/approval/CAS、公共 DNS 和匿名完整下载均通过；COM AI 商品分析保持开启，CN dark。真实 Provider/Ozon 请求和新增费用均为零；当前证据和限制只维护在[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-06 工作台读取调度与自动 AI 入口修复，本地验收通过

只读请求互斥、重复刷新互相作废、官方字段未等待读回即进入分析的根因已复现并修正；AI 入口接入同窗商品准备，已有候选先恢复。定向 owner 和隔离 Chrome 连续 AI/完整准备流程已通过，正在准备 `1.0.430` 候选；线上仍为 `566f146b / 1.0.429`。当前证据与发布边界只维护在[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-06 `566f146b / 1.0.429` 草稿读取修复双区公开发布完成

COM/CN 应用、官网 latest 和 Cloud/Local 下载已更新到 `566f146b9dc494bb581f6cf1d97b2b1757ac7b05 / 1.0.429`。实际函数 RED→GREEN、读取失败一次后明确刷新恢复的真实 Chrome、签名 MV3、最终完整 offline/QA04、双区备份恢复/VPS/canary/approval/CAS/匿名完整下载和发布后 VPS 均通过。COM 商品分析保持 `qwen-vl-max` 开启、CN 保持 dark；本轮无 Provider/Ozon 请求或新增费用，临时账号凭据已清理。证据和限制仅维护在[直接适配 owner](donor-workbench/direct-adaptation.md)，公开日志遵循根 `CHANGELOG.md`。

## 2026-10-06 草稿上下文刷新修复准备发布

来源页精铺工作台首次读取失败后的旧状态与草稿上下文提示正在收口。发布前实际函数验证发现428中间修复会触发重读循环并误挡保存回执，最终改为429：同binding失败停止自动重读、显式刷新恢复、迟到读取拒绝、保存回执正常推进版本。10项真实函数回归及59项关联验证通过；两份428签名保留但未部署/公开，线上仍为 `1.0.427`。准确证据只维护在[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-05 `3fdc5c43 / 1.0.427` 双区官网公开发布完成

COM/CN 应用和官网 latest 均已切换到 `3fdc5c430bd1d04990ba3894c2225449a855a867 / 1.0.427`。完整 offline、正式 QA04、双区 canonical VPS/canary、website approval、CAS、匿名 Cloud/Local 下载和 final publication verifier 均通过；COM/CN `/ready` 正常，AI 商品分析在 COM 以 `qwen-vl-max` 开启，CN 继续 dark。真实商品分析返回 `product-preparation-analysis/v1` 候选，原未知操作未重试；人工修订后的俄文文案已在隔离草稿保存并审核。没有 Ozon 写入；套图新 Provider 费用仅来自先前 `1.0.425` fresh suite，未新增一轮套图费用。准确证据只维护在[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-05 官网发布与 AI 分析启用接续

用户已授权新版公开发布并保持 AI 分析开启。`1.0.425` 完整原生 offline、fresh suite/审核/assignment/replay、正式 QA04、双区 VPS/canary/approval 已通过，官网尚未 CAS。最小消息策略修复进入426后，真实checkpoint注册生命周期又需收口；最终准备 `1.0.427` 替代候选，两处扩展 owner 均 RED→GREEN，未改服务端计费/权限源码。COM 托管 `qwen-vl-plus` 配置已开启，原两图分析 UNKNOWN 保留且未重试，独立单图校准通过报告 schema。当前证据及范围仅维护在[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-05 `089eb83a / 1.0.425` 连续 AI 工作台已签名并双区部署

本轮提交、推送、COM/CN 独立 Cloud/Local 签名候选、隔离 MV3 安装、目标备份恢复和完整 canonical VPS 验收均完成。两区应用运行 `089eb83ae7620aa8aaabb54e3fd2e7f801bbdf2e / 1.0.425`，服务和数据库/Redis 正常；官网仍公开 `46e17e00 / 1.0.424`，新商品分析与 BYOK 开关保持关闭。没有新增 Provider/Ozon 请求或费用；准确边界、失败原件与证据仅维护在[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-05 `46e17e00 / 1.0.424` 双区官网公开发布完成

COM/CN 应用、官网 latest 和四个 Cloud/Local ZIP 均绑定 `46e17e00622753a8f37ff501697a3cc8d2324baa / 1.0.424`。最终原生 offline、签名 MV3、fresh suite/审核/草稿 assignment/replay、正式 QA04、双区 canonical VPS/REL-04/website approval/CAS、匿名完整下载及 final publication verifier 均通过。COM 保持原 DOTH 三 operation pilot，CN 保持 direct/RDS dark。两轮 suite 共四次 Provider submit、ERP 结算 CNY 0.56，无 Ozon 写入或 Provider 控制台访问；首轮423结果保留，未冒充424执行。准确证据、质量限制与清理状态只维护在[直接适配 owner](donor-workbench/direct-adaptation.md)，公开变更见根 `CHANGELOG.md`。

## 2026-10-05 官网最新版切换接续

官网公开切换已获授权。`59a8454e / 1.0.423` 已完成双区部署、完整原生 offline 和两区 canonical VPS；同 commit 两图 suite 成功，但预览/assignment 对“冻结参考子集”与“完整素材授权”摘要的比较仍有缺口，修复候选为 `1.0.424`。官网仍 `4df9ec38 / 1.0.421`，未执行新 CAS。范围与原件只维护在[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-05 `d376bb1a / 1.0.422` 已提交、推送、签名并双区部署

精铺工作台适配候选已提交并推送到 `feat/ai-media-prompt-registry`，commit 为 `d376bb1a49f071f9c9b4eca1615c33539e61c7c2`。COM/CN Cloud/Local 候选均为 `1.0.422`，外部 Ed25519 签名和隔离 MV3 验收通过；COM/CN 已完成标准部署、备份恢复和 canonical VPS 验收。两区 `/ready` 均返回 `db=ok、redis=ok`，当前指针分别绑定该 commit，COM 继续 DOTH hosted pilot，CN 继续 direct/RDS dark。官网 publication pointer 尚未切换，仍保持旧公开版本；没有新增 Provider/Ozon 写入或发布费用。

## 2026-10-05 精铺自动属性、物流定价、连续准备、SKU复制与多平台采集已本地验收，仍未提交

用户现已授权提交、推送、签名和双区部署 `1.0.422` 候选。发布前复制行 provenance 缺失拒绝及内部 plan 绑定回归、最终完整 preflight、Server/Web 构建和真实 PostgreSQL 11 项均通过，正在准备提交和区域签名部署；当前应用和官网仍为 `1.0.421`。官网 pointer 切换保持独立门禁，准确发布范围只维护在[直接适配 owner](donor-workbench/direct-adaptation.md)。

COM/CN 应用与公开下载仍为 `4df9ec38 / 1.0.421`。同窗自动属性、店铺物流定价、多店连续准备、未知建草稿只读恢复、同窗 SKU 复制/移除及淘宝/天猫/PDD native_v2 采集已通过本地 owner/Chrome 验收；全 server 6868 基线、复制相关回归98项、扩展关联采集/编辑回归、真实 PostgreSQL 视觉7+复制4、MV3/双包校验和 lint/typecheck 通过。视觉校准 Provider POST=2，费用未读取；视觉生产配置仍默认关闭、Ozon=0。复制行生产 Ozon 发布、其他 donor 平台深度适配与新版真实全链路仍有边界。按用户要求全部完成后再提交，当前没有提交/签名/部署；精确范围与证据只维护在[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 历史接续：`1.0.420` 双区部署与 COM 下载消费者修复

`f4b133e6 / 1.0.420` 已完成完整offline、正式QA04、双区VPS/canary/approval/CAS；CN匿名Cloud/Local完整下载通过，COM下载返回404，根因为服务端publication消费者仍只允许原两项operation，脚本已接受显式三项。COM已受控CAS恢复原已批准`1.0.405`并确认latest正常，420pointer原件保留；CN公开420。消费者最小修复T2 RED→GREEN、34项下载回归与typecheck/lint通过，新增TEXT/FULL_EDIT/INPAINT仍拒绝。下一421候选仅publication owner变化，无生图/费用逻辑改动，沿用419suite明确execution bridge，不新增Provider。唯一事实见[直接适配owner](donor-workbench/direct-adaptation.md)。

## 2026-10-04 `1.0.419` 双区与正式 QA04通过；计划按钮修复准备1.0.420

`c4a391e1 / 1.0.419` 双区部署/canonical VPS、完整native offline及签名包MV3通过。真实两图收纳盒suite完成PENDING→preview→review→store-draft assignment/replay，正式QA04已生成；卫衣两图失真已驳回。本轮Provider POST4、ERP费用CNY0.56、Ozon0。真实验收发现官方计划按钮仍转发已删除的旧source listener；最小扩展修复已通过定向回归，最终1.0.420将直接复用既有plan-binding runtime客户端并走新target offline/VPS/canary/approval，再CAS分发。ERP执行源码不变可沿用明确c4execution原件，不重新收费。官网仍1.0.405；事实只维护在[直接适配owner](donor-workbench/direct-adaptation.md)。

## 2026-10-04 最终候选前 Provider 校验收口

`102711d9 / 1.0.417` COM 部署/canonical VPS 通过；原 DOTH 翻译 pilot 已经由配置 API 显式开启、runtime READY，逐图审核及 CN dark 保持。完整 offline 又发现两处依赖旧全局未准入状态的后端测试负例，已在 capability→persistence→execute owner 链复核后改为显式缺证据/异端点负例，七套 `229/229`、typecheck/lint 通过；没有改业务运行时。最终 `1.0.418` 需绑定新 clean commit 完整 offline，官网仍 `1.0.405`，新 suite/QA04/公开门禁尚未执行。当前新增 Provider/Ozon/费用为零；唯一详情见[直接适配 owner](donor-workbench/direct-adaptation.md)。

`f4cebd01 / 1.0.418` 的首次完整 offline 已通过前置和全 server，但 PG 集成发现共享测试 schema 中两个测试 owner 问题：reconciliation recovery 误把其他 fixture 的 due jobs 计入本测试，以及 recovery 手工 Prompt 行不满足严格 source contract。两者均已在测试 owner 修复，26 个 PG 文件 `209/209`、153 migrations 与 upgrade integration 通过；未修改生产 claim 或 Prompt 规则。最终候选需绑定该修正后的 clean commit再执行一次 offline。

接续审计确认原工作树 clean；Provider sandbox 审核表同步已推送为 `c07531fd / 1.0.416` 候选，但该提交完整 offline 在旧默认入口 fixture 缺 `testOnly:false` 处真实失败，没有 PASS receipt。两处 fixture 与正式 QA04 的受限三项 operation 合同现已一起收口，precision 关联 `136/136`、QA04 定向 `3/3`、ESLint 通过，未扩大 operation/endpoint/参考图或生产权限。最终候选使用 `1.0.417`，仍需新的 native offline、fresh normal SUITE/QA04 和双区官网发布门禁；旧签名和失败日志保留。唯一证据见[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-04 受限翻译能力评审与新官网发布准备

已完成七张中文→俄文真实样本：五张通过、两张驳回，保留尺寸表中文残留和密集标题反例。代码注册 exact 翻译 transport，所有结果仍须逐图审核；COM 仅准备在原 DOTH pilot 显式增翻译，CN 保持 dark，当前开关尚未修改。官网旧套图证据被当前源码门禁正确拒绝，正在准备同最终提交的完整 fresh normal suite 与 QA04/双区发布门禁。费用授权已延续为本轮不限金额，不重复询问；未读取 Provider 控制台或写 Ozon。唯一事实与证据见[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-04 `848d308a / 1.0.415` 双区部署与中文→俄文翻译校准完成

`848d308ac3ab49679f61f99620c6cb3a27e9933b / 1.0.415` 已完成 COM pilot、CN dark 双区标准部署。两区 API/Worker/Web active，153 migrations、AI suite DB guard、runtime backup、canonical VPS 均通过（各 0 failure / 1 warning，warning 为未配置远端备份）；Cloud/Local 扩展包 581 pass。官网仍旧 pointer `0d695279 / 1.0.405`，未执行官网 CAS、publication canary 或 distribution probe。

在用户授权不限金额后，COM 对两张合成中文校准图执行了恰好各一次 `qwen-mt-image` 中文→俄文 Provider POST：每张 1 submit、3 polls、1 result GET，两个任务均 `SUCCEEDED`；未重试未知结果、未写 Ozon、未读取 Provider 控制台。ERP 冻结报价为 CNY `0.01`/张，供应商实际账单未读取；两张输出均为 `1000×760 JPEG`，人工检查中文残留、布局、数字/M 和商品身份均通过。该结果只证明本次 sandbox transport/lifecycle/样例质量，不晋升生产翻译能力；`qwen-mt-image` 仍需正式能力和更广中文→俄文质量证据后才能打开生产开关。私有证据在 `release-848d308a-website/translation-submit-0/1-*.safe.json` 与 `translation-results/`，不进 Git。

## 2026-10-04 图案水印、视频发布编译与托管翻译后端继续适配

图案水印已复用账号/店铺模板并完成预览、透明度、缩放、应用及模板漂移保护；主图/富内容视频已接同窗草稿设置、官方媒体地址校验、发布预览与编译。扩展真实托管翻译的单张报价确认、凭据冻结、CNY 预留/结算、审核应用及未知结果恢复已完成本地接线，生产仍关闭，未伪造 `qwen-mt-image` 的中文→俄文能力证据。

隔离 PostgreSQL 三套 `16/16`、扩展关联 `68/68`、图案水印/视频/带报价翻译整页 Chrome fixture、workspace lint/typecheck 通过。全后端检查业务 `6520 passed`，五个历史脚本的 fixture copier 因 extensionless TS 路径失败；最小修复后原五套 `103/103` 通过，未跳过原断言。事实与生产翻译限制仅维护在[直接适配 owner](donor-workbench/direct-adaptation.md)。本轮没有 Provider/Ozon 写入或新增费用。

## 2026-10-04 `556e7ca2 / 1.0.413` 图片工作台适配已推送、签名并双区部署

逐 SKU 图片管理、审核刷新提示、水印服务端预览/应用、1688 来源视频保留/预览和 hero-only“AI 主图＋翻译”已进入新运行版。COM 保持 DOTH 原 pilot，CN 保持 direct/RDS dark；153 migrations、数据库 guard、三服务与 `/ready` 通过。两区完整 canonical VPS 均 `0 failure / 1 warning`，warning 为未配置远端备份；签名 COM Cloud 包的隔离 MV3 来源页/Blob transport 验收通过。官网仍公开 `0d695279 / 1.0.405`，未执行 website approval、发布 canary、CAS 或 distribution probe。功能范围、证据与仍未完成的正式 Ozon 视频发布/生产翻译准入只维护在[直接适配 owner](donor-workbench/direct-adaptation.md)。本轮无新增 Provider/Ozon 请求或费用。

## 2026-10-04 原版图片处理剩余功能已本地闭合，准备 1.0.413 受控部署

逐 SKU 图片表、同窗来源/结果管理之后，本轮补齐水印设置/预览/应用、1688 来源视频保留与预览、hero-only 的“AI 主图＋翻译”顺序。服务端水印使用 `IMAGE_PROCESSED` 独立资产类型、当前来源快照/草稿 CAS、设备店铺权限、幂等回执和失败清理；不产生 AI 费用。来源视频可播放预览，不宣称已支持 Ozon 正式视频发布。`galleryGoals: []` 只生成当前 SKU 主图，默认缺省仍为原套图目标。

本地服务端定向 `237/237`、水印 Prisma 隔离事务 `4/4`、扩展水印/视频/hero-only/刷新回归及真实隔离 MV3 source-page 验收通过；Provider/Ozon/生产写入均为 0。当前工作区尚未提交，官网仍旧 pointer；部署必须绑定本轮最终 clean commit，COM 继续原 DOTH pilot，CN 保持 dark。

## 2026-10-04 原版 SKU 图片交互与审核刷新提示修复，本地完成

工作台已按用户两张截图改为逐 SKU 六列表与同窗来源/结果管理，移除 SKU 下拉和三个重复流程按钮；审核成功不再被后续只读刷新拖成未知 mutation。定向 `57/57`、Cloud/Local package verifier 及隔离 Chrome 的编辑/BYOK/翻译、SKU 切换/审核/刷新失败恢复通过。本轮未提交或发布、无新增费用。当前应用为 `e659d2ec / 1.0.412`，官网仍 `0d695279 / 1.0.405`；原套图已恢复结算，因失真全部驳回。范围、未接入能力与原件仅维护在[直接适配 owner](donor-workbench/direct-adaptation.md)。

## 2026-10-04 `1.0.409` 真实三商品对照完成；原套图尺寸恢复修复准备部署

COM/CN 已运行 `08f9b9ce / 1.0.409`，两区完整 VPS 验收通过；真实 1688 三商品采集、同窗单 SKU 草稿和类目对照完成，长袖 T 恤与卫衣推荐已改善。唯一两图授权已用于两个原 Wanx 任务，它们成功返回 `800×800 PNG`，ERP 按旧尺寸合同拒绝，费用待对账；图像质量也有明显纹理失真，不能审核通过或应用。精确尺寸修复及原任务恢复 owner 已通过独立 PostgreSQL、幂等和原子回滚验证，准备受控部署并驳回不合格候选；无新增 Provider POST。当前证据只维护在[直接适配 owner](donor-workbench/direct-adaptation.md#2026-10-04-10409-真实三商品对照与原套图恢复)，官网仍为 `1.0.405`。

## 2026-10-04 `1.0.408` 双区部署，精铺真实参考图接线继续修复

COM/CN 已运行 `cef39186 / 1.0.408`，官网仍公开 `0d695279 / 1.0.405`。新隔离浏览器已在真实 1688 页面完成官方类目树、属性预览与草稿保存；“准备套图”仍因采集原始 URL 素材键与安全 ID 合同不一致失败，current plan 只读为 null。前后端接线、发送前校验、异步竞态及具体类目排序修复已完成定向验证，准备同一新候选再验收。唯一进度和证据见[直接适配 owner](donor-workbench/direct-adaptation.md#2026-10-04-真实采集参考图到托管计划的接线修复)；CNY 0.28 尚未使用，未写入 Ozon。

## 2026-10-04 精铺类目候选 `1.0.406` 已双区部署，真实功能验收继续

COM/CN 已运行 `26d3fabc / 1.0.406`，当前提交 offline 与两区 canonical VPS evidence 通过；官网仍为 `0d695279 / 1.0.405`。独立真实浏览器已采集 `16 SKU / 26 图片` 并通过正常 owner 配对连接 DOTH。接续检查发现后台五个类目推荐与扩展三项接收限制不一致，最小修复已完成 RED→GREEN，需进入新候选。进一步真实读回确认类目树响应超过旧扩展 512 KiB transport 上限；新修复将该特定路径提升到服务端既定 2 MiB 上限，普通状态响应边界不变。部署恢复、真实输入路径与费用边界仅维护在[直接适配 owner](donor-workbench/direct-adaptation.md#2026-10-04-10406-双区部署与真实工作台验收接续)；新授权 CNY 0.28 尚未使用，不宣称真实套图或全部功能完成。

## 2026-10-03 `0d695279 / 1.0.405` 工作台修复双区官网公开发布完成

COM/CN 应用、官网 latest 与四个 Cloud/Local ZIP 均已绑定 `0d695279369e8fcb4cf71563c4d8a8510b580481 / 1.0.405`。正式 QA04、新双区 VPS/canary、website approval、CAS、匿名完整下载与最终 publication verifier 均通过；整页滚动、类目显式选择、编辑入口和 BYOK 注册恢复已进入公开包，生产图片翻译仍按服务端准入显示不可用。当前证据与限制只维护在[直接适配 owner](donor-workbench/direct-adaptation.md#2026-10-03-10405-双区官网公开发布完成)，公开日志见根目录 `CHANGELOG.md`。本轮没有新增 Provider/Ozon 请求或费用，临时 canary 设备与 CN account sessions 已清理。

## 2026-10-03 `fdee8103 / 1.0.403` 精铺默认入口双区公开发布完成

COM/CN 应用、官网 latest 和四个 Cloud/Local ZIP 均已绑定 `fdee810303d1216d2f587d4c09c9a9f59766abed / 1.0.403`。正式 QA04、新的双区 canonical VPS evidence、REL-04 canary、website approval、CAS、匿名完整下载和最终 publication verifier 已通过；来源页默认打开直接复用的精铺工作台，旧采集/生图/上架安装包入口已清理，利润/物流等独立功能保留。当前证据、CF 登录边界与未覆盖功能只维护在[直接适配 owner](donor-workbench/direct-adaptation.md#2026-10-03-精铺默认入口签名部署与官网发布)。本轮没有新增 Provider/Ozon 请求或费用；新授权的最高 CNY 0.28 未使用。

## 2026-10-02 精铺扩展默认入口改造进行中

来源商品页现在默认挂载直接改造的 `precision-workbench.html`，不再依赖 donor preview 开关或商品 allowlist；旧 source-listing/source-costing 的采集、生图、审核、草稿和上架入口已从来源页装配中移除。利润/物流等其他扩展功能保留，来源核价面板仅保留成本与利润计算及找货源，不再提供独立采集或生图上架按钮。Cloud/Local 构建会排除旧工作台文件；默认 MV3 真实验收已证明普通安装可打开精铺 UI、16 SKU 投影和来源图渲染，Provider/Ozon/ERP mutations=0。当前仍需完成最终代码提交后的签名双区部署与官网更新，不能沿用 `1.0.401` 发布证据。

## 2026-10-02 用户可见精铺工作台交付仍未完成

官网 `1.0.401` 分发已更新，但用户三张截图、签名包入口代码和真实 bridge 的零网络诊断均确认默认仍走旧 SS ERP 面板，缺少草稿时跳转 Web ERP。直接复用 `jp20260803` 的新页面仍被本地 precision preview/商品 allowlist 隔离；本次 live canary 实际验证旧 `media-focus` 并要求新 iframe 隐藏。不能把官网发布完成等同于 donor 功能完成或默认切换。当前主线、证据和剩余验收只维护在[直接适配 owner](donor-workbench/direct-adaptation.md#2026-10-02-用户截图复核官网更新没有切换精铺默认入口)。

## 2026-10-02 `8bab3486 / 1.0.401` 双区官网公开发布完成

COM/CN 均已部署并公开服务 `8bab3486cf5c434617fa1798b6e8a5a4e9ebbce4 / 1.0.401`。正式 QA04、COM hosted-pilot canary、CN 无店铺 dark canary、双区 website approval、CAS、匿名 cloud/local distribution probe 和最终 publication verifier 均通过。COM/CN 官网 approval SHA-256 分别为 `1da5ae08b6c44535bfb795d80e9485e6d5a9c04f108f457ea28df929042541d4`、`95adda74783d37894e61161d8f5294e58bea7fd79efdb09e3882c81e30f25bd3`；Provider/Ozon/ERP 写入均为 0。本轮严格使用 Keep a Changelog 1.1.0，公开版本记录在根目录 `CHANGELOG.md`。

## 2026-10-02 历史任务终止恢复已授权，最终修复完成本地验证

用户已确认仅四个历史失败测试任务终止恢复并保留原件及已结算费用，另两笔未交付 ERP 预留各释放 CNY `0.14`。修复已通过真实 PostgreSQL RED→GREEN 与主 Agent 串行复核；随后完成正式 QA04、区域候选签名部署及官网发布门禁。原付费两图 suite 的生成/审核/assignment/replay 证据保留，不重收费。详细 owner 见[历史恢复收口](donor-workbench/direct-adaptation.md#2026-10-02-已确认历史恢复收口与部署修复)。

## 2026-10-02 1.0.398 实际套图通过；官网分发仍有历史恢复阻塞

两区已运行已推送的 `58cc814e / 1.0.398`，专用 MV3 两图托管生成、审核、DOTH 草稿 assignment 和原幂等键 replay 均真实通过；本轮唯一费用授权 CNY `0.28` 已使用完。官网仍为 `3723f5dd / 1.0.395`。正式 QA04 仍被同 owner 四个历史恢复项、两笔未决费用阻塞；最小费用投影修复只在隔离 worktree 通过，新增明确“放弃恢复”状态合同等待用户确认。双区 synthetic 安装验收的三次 attach 超时保留失败事实，不再盲重试。原件、已验证范围及后续只维护在[直接适配 owner](donor-workbench/direct-adaptation.md#2026-10-02-10398-安装与真实套图历史恢复阻塞)。

## 2026-10-01 donor 适配版签名与双区部署

`94fc7460ca8dc29b7fe0cbfccce06ddb03ddbf4a` 已推送并使用区域独立的 `1.0.396` Cloud/Local 候选完成 Ed25519 签名、COM pilot 与 CN direct/RDS 部署。两区完整 VPS verifier 均 `0 failure / 1 warning`，唯一 warning 为远端备份未配置；150 migrations、suite DB guard、三服务、本机/公网 `/ready` 均通过。COM 保持 DOTH 既有受限 pilot，CN 保持 AI/BYOK/Ozon dark，donor precision 仍为默认关闭的预览入口。官网 pointer 仍为 `3723f5dd / 1.0.395`；本次没有 website approval、REL-04 publication canary、distribution probe、CAS 或 Provider/Ozon 写入。签名、备份与验收摘要只维护在[直接适配 owner](donor-workbench/direct-adaptation.md#2026-10-01-签名与双区部署)。

## 2026-10-01 旧扩展直接适配的本地开发

当前直接复用 `jp20260803` 的原界面和 1688 采集器，同窗口已接采集、草稿编辑、自定义托管方向、BYOK 单图、参考图/FULL_EDIT/INPAINT 控件与 owner flow、图片翻译入口、套图审核/应用及发布预览/确认/回执；每 SKU 包装、官方属性、手工俄文文案/VALIDATE、precision frame/session 和 BYOK 设置也已完成本地 owner 接线。当前 HEAD `1f9d8eba` 的默认 donor fixture 已覆盖采集、全部草稿字段、托管套图审核/assignment、publish preview/receipt；`--byok-flow --translation` 额外覆盖 BYOK 单图未知结果恢复、Blob 预览、审核、ingest/readback 和翻译 owner。参考图、全图修图和圈选重绘的独立浏览器 fixture 也均已通过。保存与生成/发布流程仍是本地 owner/browser fixture 验证，尚未生产验收；复制 SKU 行持久化、donor 淘宝/PDD collector、翻译质量和最终安装版验收仍有缺口。功能完整通过后按用户要求退出旧默认流程。任务、源码映射和证据只维护在[直接适配 owner](donor-workbench/direct-adaptation.md)。官网仍为 `3723f5dd / 1.0.395`；本轮已提交但未 push、未部署，未产生 Provider/Ozon 费用。

## 2026-09-30 `3723f5dd` OOPIF canary 修复、双区发布与官网切换

- `cbafe7a1` / `3723f5dd` 修复 donor live canary 对 extension OOPIF 的误判：runner 现在保存 `Target.attachedToTarget` 的 iframe session/target，在子 session 自己的 `Page.getFrameTree` 上核验 exact shell URL、父页面 frame、默认 extension execution context；不再从父页面 frame tree 查找 extension iframe。定向 canary 合同 `13/13` 通过。
- 真实 1688 release-bound canary 已 PASS，候选 `3723f5dd1a175537a183bd750f8c168a2f742baf / 1.0.395`，正例 `990499606077`、负例 `1048072018093`，统一 media-focus、OOPIF context、iframe 隐藏、关闭/rollback 和 storage cleanup 均通过。COM canary SHA-256 `d4349c6856c0eb2222bacbd155ac4c56e49b21d2ebdbda118d45397a558f5917`；物理坐标路径仍记录为受控 DOM fallback。Provider/Ozon/ERP mutations 均为 0。
- `3723f5dd` 的完整 `pnpm qa:04:offline -- --output` 已通过，offline receipt SHA-256 `b6da8a1d4b9c10febd3dc64bef15b759647ae8918de8ee35b92891a99e4ece36`、日志 SHA-256 `7a8ac01757883de73c8b30e4de31d801fd44cd4c3f111fd9a2fbd5726033e653`；正式 QA04 SHA-256 `daabe132cc64469dd8119b8bec41572334bd959117a37522188495cb918ad8f8`。
- COM pilot 与 CN direct/RDS 已同 commit 部署 `1.0.395`。COM 精确绑定 owner `cmpsj2g6800005ow9rrtvqhay`、DOTH `cmq7r8n1700095o7exbet1xle`、session `5886ecc8-0d79-45a2-a924-f48121a92f3a`、`IMAGE_TO_IMAGE/SUITE`；CN AI/BYOK/Ozon 保持 dark。两区 `/ready`、150 migrations、post-migration guard、签名候选和服务均通过。
- 部署后 canonical VPS evidence：COM `ea71a067435e6824146dc55ff734c29385c631e27f9f80743a91d6096366b5e0`，CN `be525b8f484c98600fd2e3fc2b7d3e6eb32035ec3130cb3c096600106f57ac42`；最终 website-publication=true verifier 两区均 `0 failure / 1 warning`，唯一 warning 为远端备份未配置。
- 双区 REL-04 canary 已通过：COM hosted-pilot `d4349c6856c0eb2222bacbd155ac4c56e49b21d2ebdbda118d45397a558f5917`，CN no-shop dark `f8824df7fe650c3fc1b90149d8546232e33e887f4e512ee5ee56fd750fbead4c`。双区 website approval、CAS、匿名 distribution probe 和 publication verifier 均通过；distribution receipts 为 COM `4ed36b133ea23d6bfa1de274870b2ecfd2239aebf0d715a7a1afbabe611e785a`、CN `b248f319c500b5a41565d665ee23202db91c40b2d6fc2cf4562155c1262a5600`。
- COM/CN 官网 pointer 现已公开服务 `3723f5dd / 1.0.395`；cloud/local ZIP 摘要分别为 COM `cd344d560c9e7fe374bc0df81e09a88a5cf151d3709508f655297646014d657a` / `ef403ef49e7f7efef46cdf036de3444b2911e7a447e164e51dfd3ca52956a0ad`，CN `49a448aa04d47c87450aa701c43efbaadda1eda4bda074bde3c04ea831ad2478` / `d936047cc3984a30eb38427822e141ebe010e23391e60d1b27e57ecbdc7427c1`。本轮没有新增 Provider 请求、Ozon 写入或业务费用。

## 2026-09-30 `761e003c` CN 部署与 direct-mode verifier 收口

- CN 已受控切换到 `761e003c2db04d0581fedf52ec14296bd258011b / 1.0.393`。RDS 150 migrations 无待迁移，post-migration AI suite guard、AI dark gate、systemd、API/Worker/Web 和 `https://ss-erp.cn/ready` 均通过；`current`、三服务和候选签名均绑定目标 commit。
- CN 候选继续使用 cloud ZIP `71c7a9047c33f306dac3dd44b22e3349081a9123f277e13cb11166959c036633`、local ZIP `e0d3f3073ad459ae5639336d8e961d5fb3d9511027c0d29a64d09e42a069f51d`、release evidence `f67a5ffc4544adda0c8343d25ee7fc68987f0dab4f9fe13a9964d172f86ed9b7` 和 detached signature `401a1a43ef9a91daa743b793d3b071e083d2fe5ce0d876f3d97952731b3582a9`。
- 首次 verifier 发现 CN 的 `BACKUP_LOCAL_DIR` 与 `DEPLOY_BACKUP_LOCAL_DIR` 误指向同一目录；未改写原件或绕过 gate，已将 deployment 备份原件复制到 `/var/backups/ss-erp`，保留 runtime 定时备份在 `/var/backups/ss-erp-runtime`，并把共享环境的 `DEPLOY_BACKUP_LOCAL_DIR` 修正为 deployment 目录。修复后 direct-mode 完整 verifier 为 `0 failure / 1 warning`，唯一 warning 为远端备份未配置。
- CN canonical VPS evidence 已由修复后的普通 Node 22 runtime writer 写入 root-owned `0600` 文件 `/var/lib/ss-erp-rel04-evidence/761e003c2db04d0581fedf52ec14296bd258011b/vps-verification.canonical.json`，SHA-256 `0f6ccb260d39d92502a48524bc724f898ac8c5813e902ed6d51db26a600cd980`。本轮没有 Provider POST、Ozon 写入、新增费用或官网 CAS。
- 官网仍安全服务旧 pointer；CN dark canary、COM hosted pilot canary、website approval、distribution probe 和 CAS 尚未执行。后续必须消费同一 commit 的正式 QA04 与双区 canary/approval，不能把应用部署或 VPS evidence 当作官网公开发布。

## 2026-09-29 `761e003c` COM pilot recovery 与 fresh normal suite

- `761e003c2db04d0581fedf52ec14296bd258011b` 已推送并受控部署到 COM pilot；`/ready`、DB/Redis、150 migrations、AI media post-migration guard 与 hosted-pilot 合同均通过。COM 仍限制为 DOTH、原 owner/设备 session、`IMAGE_TO_IMAGE/SUITE`，未执行官网 CAS 或公开 pointer 切换。
- 对旧 fresh suite 的两个已接受 Wanx task 只读 recovery 均使用正确 Provider reconciliation evidence hash，保留原 task ID；Worker 查询后因冻结 edit recovery contract 不完整安全回到 `MANUAL_REVIEW`。未重发 Provider POST，旧 reservation 仍为 `RECONCILIATION_REQUIRED`、`billedUnits=0`，未伪造结算。
- 在单独批准最高 CNY 0.28 后，新建独立计划 `cmumsdxzt000h5o4hugj6omgh`，严格指定 `galleryGoals=[scene]`，预览确认两槽/最高 CNY 0.28；suite `cmumseuo4000r5o4hefxfmvei` 仅派发一次，两个槽各 `attempt=1`，均 `SUCCEEDED`，输出均为归一化 `900x1200 PNG`。两槽已人工审核 `APPROVED`；本轮未执行 Ozon 写入、store-draft assignment、官网 approval/canary/CAS。

## 2026-09-29 Wanx 880x880 实际输出边界（fresh suite 诊断）

- 新鲜 DOTH 草稿 `draft-8e329820-e9f2-491a-9d57-19131b23c899`、快照 `3fe7c02d-e38a-4a80-804b-e8e72826490c` 的两槽 hosted SUITE 已按授权执行一次：计划批准、`START -> CONTINUE` 只各派发一次 Provider 请求，未执行 Ozon。
- 两个已接受的 Wanx task 均实际返回 `880x880 PNG`；当前部署的 `3bd0aa51` 归一化只允许冻结 `1024x1024` 请求或已验证 `1024x1536` fallback，因此两槽安全失败为 `PROVIDER_OUTPUT_DIMENSIONS_MISMATCH`。两笔 reservation 目前均为 `RECONCILIATION_REQUIRED`、`billedUnits=0`，没有伪造结算或重试未知结果。
- 该真实证据证明应在同一 owner 增加精确 `880x880` fallback→`900x1200 PNG`，而不是放宽任意尺寸。对应本地回归已补齐；修复需形成新 commit、部署 COM pilot 后，优先用原已接受 task 做只读 recovery/对账，不新增 Provider POST；若 recovery 不能闭合，再另行取得新的费用授权。

## 2026-09-29 Wanx 尺寸归一化与 1688 工作台几何修复

- `3bd0aa51` 修复 Wanx 套图输出尺寸 owner：保留冻结的 `1024x1024` 请求合同，同时只接受已知的 `1024x1536` Wanx fallback，并按已验证实际像素设置 Sharp 解码上限；新增 fallback→`900x1200` PNG 回归。server 定向联合测试 `64/64`、typecheck、lint 通过。该修复尚未重新发起 Provider suite，也未部署。
- `68773748` 修复 unified `media-focus` 入口的全屏几何：桌面为居中、最大 `1440x960` 且保留 24px 视口边距，移动端保留 8px 边距；普通核价面板拖拽与旧入口不变。1688 正例真实页面复现确认旧规则几乎占满 `2048x1018` 视口，新规则静态注入测得 `1440x960` 居中。extension source/donor 合同通过，cloud/local 包 verifier 分别 `495`/`491` pass，未部署。
- 当前 fresh normal suite `cmum819lz00185oz5tlayxch3` 仍因旧运行代码的 `PROVIDER_OUTPUT_DIMENSIONS_MISMATCH` 失败并已结算 CNY `0.28`；QA04、assignment、website approval/canary/CAS 与官网 pointer 切换仍未完成。后续真实 suite 需要新的费用授权。

## 2026-09-29 `5104bcdf` 双区部署与 live canary 边界

- COM/CN 已受控部署 `5104bcdf4e3cede661bec0c3bf6cd136fb13c85e / 1.0.392`。COM 保持精确 hosted pilot（owner `cmpsj2g6800005ow9rrtvqhay`、DOTH `cmq7r8n1700095o7exbet1xle`、session `45286e40-6f41-4c5e-994d-b31e559b0405`、仅 `IMAGE_TO_IMAGE/SUITE`）；CN 保持 direct-origin/RDS、AI/BYOK/Ozon dark。两区 `/ready` 正常，COM verifier 在 pilot expectation 下通过 `0 failure / 1 warning`，CN direct verifier `0 failure / 1 warning`；唯一 warning 为既定未配置远端备份。
- 区域候选为独立 origin：COM cloud ZIP SHA-256 `565b66c56c41e12f9996c4e4d1a8981a132132bd24da38fb8ca894d87b35960f`，CN cloud ZIP SHA-256 `e6a75fedfa936135cc6606291c184595933cb58fa19e710bade349a8b5312ab5`；COM/CN 使用不同 release evidence/signature，均为 Ed25519 key `ss-erp-extension-release-2026-09-05-01`。
- 新候选的真实 1688 canary 已启动但在统一 media-focus 打开断言处超时；诊断显示 trigger/media-fab/panel 存在但未进入 `media-focus`，未生成 PASS 回执。Provider/Ozon/ERP mutations=0，未新增费用；该失败不能重标为通过，下一步继续排查候选扩展注入/入口事件链。
- 官网仍安全服务旧 pointer `6378b62e / 1.0.364`；本轮未执行 website approval、distribution probe 或 CAS。

## 2026-09-29 `42684fb8` canary 输入链路修复

- `bb003aaa`/`42684fb8` 修复 release-bound live canary 的浏览器输入边界：先等待真实坐标点击结果，若 headless Chromium 未派发 content-script listener，则回退到同一 DOM handler 的受控 `.click()`；关闭按钮使用相同回退。触发路径和诊断仅影响 canary runner，不改变扩展业务 owner。
- 基于当前 HEAD 生成并签名 `1.0.394` COM candidate；真实 1688 canary PASS：正例 `990499606077`、负例 `1048072018093`，打开/关闭/rollback/allowlist cleanup 全部通过，Provider/Ozon/ERP mutations=0、pageErrors=0。回执：`C:\Users\550W\AppData\Local\SS-ERP\private\donor-live-42684fb8\canary-COM-1.0.394.json`，SHA-256 `03e9d954a6577d2ab20818c894347299dbcc9d60107e112c9d7eb449bf51fefc`；截图 SHA-256 `faf62fbc24636b43010024278cbde4dc4cf860ca3f942089d2b71db814518f9d`。
- 该 PASS 明确记录物理坐标输入未触发而使用 DOM fallback；它证明统一入口事件链和安全回滚通过，但不把 headless 坐标输入问题伪装成产品行为。官网 pointer、QA04、website approval、CAS 仍未执行。

## 2026-09-29 `f211bb02` Wanx prompt compaction 与 fresh suite 真实边界

- `8d9ec11a` 修复 Wanx 套图重复通用安全策略并压缩事实 JSON；`f211bb02` 进一步保留完整事实值、序号和短路径，去除超长 URL 编码 SKU 主键。两次定向 prompt 测试均 RED→GREEN，最终 `26/26`、server typecheck/lint 通过。
- COM 已受控部署 `f211bb02765e9ae6ffb4a19e64b24d8d75949c78 / 1.0.391`，三服务、`/ready`、pilot allowlist 和 commit-bound backup/restore（144 public tables）通过；官网 pointer 未切换。
- fresh normal 两槽 suite `cmum819lz00185oz5tlayxch3` 已完成 prepare/dispatch；两槽各仅一次 Provider attempt，均安全失败于 `PROVIDER_OUTPUT_DIMENSIONS_MISMATCH`，没有 UNKNOWN_OUTCOME、重试、Ozon 写入或 assignment。两笔已接受请求按 CNY 0.14/槽做 `RECONCILED_CHARGE`，总计 CNY 0.28；没有读取第三方费用控制台。
- 旧误创建的 planned suite `cmum7qkbg000h5oz5upg5m682` 已通过同一 owner 物化后按 revision CAS cancel，未 dispatch；所有 active jobs/suites/reservations 已清零。临时 Wanx provider 配置已按受控 CAS 恢复为原 custom 配置；正式 QA04、website approval、canary、CAS 和官网公开发布仍未完成。

## 2026-09-29 1.0.388 hydration fix、双区部署与真实 unified media-card canary

- `0116a88288203400362d26a11ca39ab6ae54c8de` 修复 `openPrimaryAiWorkbench` 在 source hydration 为 `refreshing` 时错误提前返回的问题；定向合同与完整 `pnpm preflight` 通过（Server `6340 passed / 325 skipped`）。
- COM/CN 均运行 `0116a88288203400362d26a11ca39ab6ae54c8de / 1.0.388`。COM 受限 hosted pilot 仍只允许 `IMAGE_TO_IMAGE/SUITE`；CN 继续 direct-origin/RDS/AI dark。两区 `/ready`、服务、签名候选、数据库 migration 与 backup/restore gate 均通过；VPS canonical evidence SHA-256 为 COM `51a7e52a69f5639c70327d08e8cf91145e4ffcafba90bc5286902dc0961056e`、CN `74a8e60e87e587cfa07a5cf4f42467d1207832d24f45b07cd8da80f7e66aa8d6`，各唯一 warning 为远端备份未配置。
- 真实 1688 release-bound canary 已 PASS：正例 `1688:990499606077` 统一 media card、8 个 precision actions、iframe 隐藏、关闭/rollback 与 legacy restoration 全部通过；负例 `1688:1048072018093` 被拒绝；Provider/Ozon/ERP mutations=0，pageErrors=0。receipt SHA-256 `06d44e2ba7600d78f5cc6a06294bee31554dd90962b679d1ea778d64960fbbdc`。
- COM/CN website pointer 仍安全服务旧 `6378b62e / 1.0.364`；本轮未执行 final fresh normal QA04、website approval、distribution probe 或 CAS，不能宣称官网最新版已公开。

## 2026-09-29 统一 media card 双区部署与 D4.3 canary owner 修正

- `05a4156a` 将 donor、AI 图片与原 source-costing 图片入口统一到同一个 `media-focus` 卡片；真实 marketplace 页面优先复用该卡片，不再打开全屏 `chrome-extension://` iframe。利润/核价 owner 仍保留物流、汇率和费用能力，图片工作流只在显式 media-focus 中显示。`0db36e3d` 另修复 Windows/Git Bash 部署归档所有权，并已推送到 `origin/feat/ai-media-prompt-registry`。
- 同 commit 的区域扩展 `1.0.384` 已按正确 origin 独立构建和 Ed25519 签名。COM cloud/local SHA-256 为 `f11e097c8d6775da9bb53b91599934e39e4263ec16371e8d5fc9cbe42a928e0c` / `fbd3f82d3cfd664f4421dcb6a58a38180d5c8f19e960e7cac654c7ced5f7cd28`，签名 SHA-256 `8ca1f84d67b665231d32187d0da23b061a3abcb80f419deaac0b9aa3d1dfd076`；CN 为 `8c735d9bac5dba7a2740447f2321de8d198afc7a9ce0b9ba45cd34585de7c3ba` / `7fc27d4e651abff4d5804bf8709e429fabc7095d05ea3b9f4603c01be162d227`，签名 SHA-256 `bea1ef56c4f36becee1ce6913014dad6d538e9c0f2656ce06dec61b45c84218a`。
- COM/CN 已切换运行 `0db36e3d25ada95ea0bb2a842557514239acf422 / 1.0.384`。COM 保持 DOTH 单 active device session 的受限 hosted pilot，仅允许 `IMAGE_TO_IMAGE/SUITE`；CN 使用 RDS/direct-origin 并保持 AI/BYOK/Ozon 全暗。两区备份/恢复分别验证 144/143 张 public 表；完整 VPS verifier 均为 `0 failure / 1 warning`，COM/CN canonical evidence SHA-256 为 `dfdbe8299bc7d68cbcab156a96dce3151d53fbdc6de12515cf4638fe416e30ac` / `b2da296af64dc47afcffcaeb29368690fb8c6d7936eb786508fb68fd5ad9ebfb`，唯一 warning 为未配置远端备份。
- 第一次 release-bound 真实 1688 canary 正确加载签名候选与登录 cookies，但旧 runner 仍等待已取消的 donor iframe，因 `Timed out: donor workbench iframe open` 安全失败；没有 Provider/Ozon/ERP mutation，也没有 PASS 回执。本次 canary owner 改为验证统一 media card 打开、核价内容隔离、donor iframe 保持隐藏、关闭/rollback 与旧核价入口恢复；正式候选仍须在新 commit 重新构建、签名并取得真实 PASS。
- `openPrimaryAiWorkbench` 现在先同步打开 unified `media-focus` 卡片，再异步读取来源/ERP projection；慢或不可用的设备/ERP 状态不会让入口无响应。该 owner 修复随 canary runner 诊断改动进入下一 commit，尚未部署或公开发布。
- donor trigger 与 source-costing panel 之间新增显式 `ss-erp:source-media-focus-request` 事件接线，避免真实 marketplace 页上跨 content-script click 连接失效；旧 `.click()` 仍保留作兼容路径。该接线尚未部署，需随下一候选重建验证。
- 官网 COM/CN pointer 仍安全服务旧 `6378b62e / 1.0.364`。当前未执行新 website approval、distribution probe 或 CAS；`0db36e3d` 的部署成功不能替代 final-commit QA04、D4.3 canary 或官网发布。

## 2026-09-27 donor 工作台 D4.3 授权后预发布阻塞

- 用户已明确授权 D4.3 的构建、签名、双区部署、真实商品 allowlist canary、官网切换与 rollback 验证；该授权不包含新的 Provider 付费请求或 Ozon 发布。实现提交 `5265107d` 修复 cloud/local 打包时 donor 单一 shell WAR 被扩成全 marketplace/ERP 来源的问题；`ad086d3b` 起新增 release-bound live canary，并在后续提交补齐受监控 Worker 启动、签名/evidence/ZIP 字节绑定、真实正负商品指纹、扩展 mutation 监听、清键 rollback 与候选清理。
- 本地 `1.0.366` 至 `1.0.370` 候选均只用于 fail-closed 调试，从未上传或部署。最新 `397d3ac4 / 1.0.370` COM 候选 cloud/local SHA-256 为 `4a63186ea84328bc0860f54d9044337b3e7cb2c5503413b3874af3d91db090c5` / `842d7d195210bfed18d1c781f35946d79b5daf7e73915c251b8cab33f803cf0c`，evidence/signature SHA-256 为 `0225cbbb68f312f68a10b6f2d6d04537102c4974ce3b69f23df656f347491674` / `7dbf07a31fa67dca853b377a08ea8dac8686b7e87b10c26566f1c5e2a4090ab5`；它也未获 live PASS，禁止部署或重标。
- 隔离 Chrome `153.0.8010.48` 已证明受监控 `Extensions.loadUnpacked`、候选 Worker 和最终 exact 1688 frame/loader 可建立，但 clean headless profile 在真实 `990499606077` 上持续保持 `document.readyState=loading`。依次尝试初始 loader `load`、最终 loader `DOMContentLoaded`、最终 frame-tree loader 加 readyState 三种绑定均安全超时；按停止条件不再继续修改 runner 或消耗版本。没有生成 D4.3 canary PASS 回执。
- `6378b62e -> 397d3ac4` 同时包含服务端 draft/media/billing owner 变化，正式 QA04 明确返回 `QA04_ERP_SOURCE_CHANGED`；后续还必须在最终提交重新取得 fresh normal 两图 SUITE 证据，该 Provider 费用需要独立授权。两区生产应用和官网仍为 `6378b62e / 1.0.364`；本轮 Provider、Ozon、ERP 业务 mutation、VPS 部署、website approval 和 CAS 均为 0。

## 2026-09-27 donor 工作台 Phase 4 package gate

- `D4.1` 已完成：正式 extension verifier 新增 donor 必需文件、service-worker handoff owner、content/page 脚本顺序、五个 marketplace WAR 精确来源、默认关闭和无 donor 直连 Ozon/Provider 检查，source verifier 从 `475` 升至 `490 pass`，零 failure/warning。
- 新隔离负例会同时删除 prompt adapter、加入 `<all_urls>`、破坏默认关闭、倒置脚本并注入 Ozon fetch，要求 verifier 对五项逐一拒绝；该测试已进入 preflight。D4.1 完成时 D4.2 allowlist canary 尚未执行；当前 D4.2 已由下述独立回执关闭，D4.3 entrypoint cutover/rollback 仍未执行。
- `D4.2` 隔离 allowlist canary 已完成：donor 除布尔 flag 外还要求最多 20 条精确 `platform:sourceProductId`；clean commit `8106c1688bc44ebce1b18269971a516910664c5a`、extension-tree SHA-256 `999c7f8199d9f7f62c12a3e5a0f92fbd4cbb8e837195b88f8f42298e249f7ee7` 上，flag-only 不注入，`1688:990499606077` 正例注入，相邻 `1688:990499606078` 负例拒绝。私有回执位于 `C:\Users\550W\AppData\Local\Temp\ss-erp-donor-mv3-evidence-9XVUf7\summary.json`。
- 该 canary 使用精确 1688 URL 的拦截合成页面和 unpacked MV3，不是签名候选、生产部署或真实商品业务验收。在该 D4.2 检查点，D4.3 仍需独立生产 cutover 授权；当前授权已取得，但真实 canary 仍在本页顶部记录的浏览器停止点，尚无部署或 rollback PASS 证据。

## 2026-09-27 donor 工作台 Phase 3 设备店铺边界

- Phase 3 的 `D3.1` 已完成本地实现。donor 店铺选择器只接收设备 session 返回的 `{id,name,status}`，新 bridge 显式发送 `deviceOnly:true`；设备 shop reader 缺失或失败时在 legacy account-token 分支前直接拒绝，不会因旧兼容逻辑扩大店铺可见范围。
- 建草稿仍只发送投影内 shop ID、snapshot 与所选来源 SKU，owner/active grant/shop membership/scopes/draft facts 由设备 transport 和服务端重算。donor shell、logistics scoped-auth 与 unpacked MV3 验收通过；真实 Provider、Ozon 和生产 mutation 为 0。
- `D3.2` 现已完成：服务端 suite projection 对每槽仅输出币种、冻结预估/最高 minor units、reservation 状态及最新 settlement kind/实际金额/计量单位；repository 不为该表面选择 reservation/settlement ID。币种、金额或终态结算不一致按 stale context 拒绝，扩展 wire/donor 再次精确净化且 billing 不进入 hosted 命令 authority。
- donor 图片页同时显示 ERP 托管报价/逐槽结算与“自带 API Key · ERP 生图费 0.00”；桌面/移动无溢出，完整 preflight 为 Server `6339 passed / 325 skipped`、extension `475/475`；本轮真实费用、Provider/Ozon 请求和生产 mutation 仍为 0。
- `D3.3` 现已完成本地接线：donor 审核页只发送无 publish 字段的 source/listing/SKU-bound 工作台 handoff；现有 AI 工作台继续独占 publisher preview、显式确认、`listing:publish`/`OZON_PUBLISH` grant、receipt、未知结果恢复和 reconciliation。donor iframe 中没有 Ozon payload、凭据、endpoint 或直接 publish command。
- Phase 3 已本地完成；桌面/390px、unpacked MV3、publish controller/coordinator 与 extension verifier 通过。生产入口仍为原工作台，donor preview flag 默认关闭；Phase 4 的 package/security、allowlist canary、切换与 rollback 尚未执行，本轮 Ozon/Provider/生产写入均为 0。

## 2026-09-27 donor 工作台 Phase 2 草稿与生图接线

- donor 工作台 Phase 2 的 `D2.1-D2.4` 已完成本地实现：店铺草稿继续调用 device-scoped `CREATE_DRAFT` owner；图片阶段新增独立处理 SKU、来源参考图、视觉 JSON 及正/负提示词编辑，并通过现有 SS ERP ERP 托管/自带 API Key 工作台执行，不复制 donor Provider/Ozon 直连或密钥存储。
- 视觉 JSON 与提示词由本地确定性 adapter 基于来源商品、所选 SKU 和参考图编译，不新增 AI planner 请求，也不成为服务端 plan、费用或权限事实。可选提示词只通过 `chrome.storage.session` 交接，绑定完整来源/草稿/SKU 和目标 tab、十分钟过期、消费一次；审核态、已有候选、未知结果或已有输入时只消费不应用。
- 多 SKU 路径保持服务端权威：无来源页明确 SKU 时先取得 `choice_required` 与服务端 binding，再用用户选择的处理 SKU 打开；来源页已有 SKU 时 donor 选择器锁定并随权威投影纠正。审核页通过现有 media-history 和独立确认窗口执行通过/驳回/追加草稿；持久 mutation intent 与服务端幂等键仍是唯一 owner，donor 只展示 replay 回执且不直接 assignment。右侧过程面板只显示 worker 权威允许的取消或 retry-safe 恢复；普通任务没有 PAUSE owner，hosted suite 暂停/继续仍留在现有 AI 工作台。定向合同、桌面/移动 Chromium、unpacked MV3 与四操作 AI 工作台 Provider fixture 均通过；真实 Provider、Ozon 和生产 mutation 为 0。下一阶段是店铺授权细节、计费/结算投影和受控发布。

## 2026-09-27 donor 工作台 Phase 1 默认关闭实现

- 已在 `extensions/ss-erp/` 内新增 donor-derived 全屏 iframe 商品工作台，复用 `jp20260803` 的单工作台交互模型，但没有复制 license、Provider/Ozon 凭据、第三方直连、旧服务地址、`debugger` 或宽域权限。donor 原目录保持只读。
- 来源商品 content bridge 是唯一 runtime caller；iframe 仅接收双重净化后的商品、授权店铺、草稿、任务投影，并只能请求 `COLLECT`、`REFRESH`、`CREATE_DRAFT`、`CLOSE`。建草稿仍由 Phase 0 的 device-scoped 服务端 owner 重算 owner/shop/snapshot/SKU/capture hash。
- 工作台已包含采集、店铺草稿、类目属性、图片处理、审核发布五阶段，SKU/参考素材选择、过程面板和视觉描述 JSON 本地草稿；JSON 尚未接 Provider 或成为服务端事实。开关 `ss-erp:donor-workbench-preview-enabled` 默认关闭，当前生产入口不变。
- 静态合同、隔离 Chromium 桌面/移动和真实 unpacked MV3 合成 1688 商品页注入均通过；后者确认 iframe 收到真实 content-script capture projection。所有验收的未知网络、Provider、Ozon 与生产 mutation 均为 0。该迁移尚未部署或发布，下一阶段见 [`donor-workbench/MASTER.md`](donor-workbench/MASTER.md)。

## 2026-09-27 `e83f4e57` Cloud handoff localhost 热修与旧扩展复用裁决

- `e83f4e57 fix(extension): bind cloud source handoff to packaged origin` 已推送。Cloud 扩展打开来源工作流时现在使用签名包内的 `deployment-defaults.erpBaseUrl`，忽略空配置和残留 `127.0.0.1`；Local/source 构建继续使用本地配置。popup 与来源页状态改为“已创建 ERP 标签页，请确认页面加载后继续创建草稿”，不再把 `chrome.tabs.create` 成功误报为 ERP 页面已可用。
- 定向 handoff/source-workbench、完整 lint/typecheck、`pnpm preflight` 和 extension verifier 通过。隔离串行生成的 `1.0.365` 候选：Cloud ZIP SHA-256 `6b1315ffc56877c783256e845c036f8e00dfb48184f226fc5aa6f0a32f8adbc4`（467 pass）、Local ZIP SHA-256 `e70d306151a78c2cfaa02871983e609a5fdf2f0284378079ac5936b6052d7ca5`（463 pass）。本轮尚未部署、签名、website approval 或 CAS。
- 用户授权将 `C:\Users\550W\Downloads\jp20260803` 作为可复用 donor。迁移裁决：复用其全屏 iframe 工作台、商品编辑器、SKU/类目选择、图片队列、JSON 视觉描述/提示词、过程面板、暂停恢复和多语言结构；替换其本地 license、扩展内 Ozon/Provider 明文凭据、直连 Ozon/Provider 和宽权限。SS ERP 继续由服务端拥有设备、店铺、草稿版本、费用、审核、幂等 assignment 与发布权限。
- 当前偏差不是 CSS，而是 owner/流程边界：SS ERP 来源面板只负责采集和 handoff，创建 listing draft 仍只有 Web `/api/source-listing-workflows POST /`；扩展 device workbench 目前只有 status/media/history，没有“按 snapshot + shop + selectedSkuKeys 创建草稿”的受控命令，因此用户必须跳 Web。下一阶段应以 donor 工作台为前端骨架，先补 server-owned `CREATE_DRAFT` device command，再迁移类目、属性、SKU、图片和计费状态投影；不复制 donor 的客户端密钥或 Ozon 直写。

## 2026-09-27 `6378b62e / 1.0.364` fresh suite 与双区官网公开发布完成

- COM DOTH 隔离草稿 `draft-cf60f546-ac0b-4a4a-bafa-2d6c5aa93a87` 已通过独立 MV3 `1.0.364` 完成两图 SUITE `cmuj52iu3001a5obzxyn5pxis`：两槽均 attempt 1、900x1200 PNG、人工审核 APPROVED；两笔唯一 `SETTLED/CHARGE` 各 CNY 0.14，总计 CNY 0.28。store-draft assignment 将草稿 `r1/v1 -> r2/v2`，新增 SKU hero 与 PRODUCT gallery 两条，exact replay 返回同一 batch 且 `replayed=true`，草稿及 assignment 未重复；Ozon publish attempt 为 0。
- `POST_APPLICATION_EVENT_DERIVATION_V1` 从原始 Codex 会话找回审核前真实 workbench GET：`2026-09-27T01:29:28.681Z` 时 suite 已 `SUCCEEDED` 且两槽仍为 `PENDING`；两次只读 RepeatableRead 数据库快照稳定一致，并绑定不可变审核事件、两条 job/费用、草稿历史、assignment 与 Ozon 零写入。正式 QA04 在 detached clean `6378b62e` worktree 通过，SHA-256 为 `10f6779d1c171b9bbff65253699411880278925095012a2fa78878cda62b1958`。
- COM REL-04 v3 restricted-pilot canary SHA-256 为 `edcef573dbced0a605355f91d248ddf634dafa45a040e81a8dd3df0cf5ec1873`；CN v2 no-shop dark canary 为 `2370d1faaf406f03f305ca00e116083f5df4de3465a9af55a46851371ef008ee`。两区均无 Provider/ERP ingest/Ozon 请求；COM 临时 canary device 已撤销，CN 临时 admin session 已从 Redis 清理且 token 文件删除。
- website approval 为 COM `85ce390a3fb92b62958a5328c510c4a69e4f7a234b644690e50efbe4d6b2bdc4`、CN `0b84c7f387a265ac7e842595d24876f0346e2d319cb79b1ec762cfbbc03aa864`。两区 pointer 已从 `6e38f907 / 1.0.362` CAS 到 `6378b62e / 1.0.364`；匿名 distribution probe receipt 为 COM `c7601f3497ca56cbc3d12dec0486d600ebe727702240fed7c35e5c181478edb9`、CN `b48836043ff4959082fc37cbb0b026043bf11fec709fec85e34085eac0310648`，四个 ZIP 字节摘要与区域候选完全一致，双区 final publication verifier 通过。
- Suite 和 COM canary readiness 窗口曾以独立 CAS 临时切换已验证 Wanx 配置；两个窗口均恢复原 Xiaoyi `custom / https://image.xiaoyiapi.xyz/v1 / gpt-image-2.5 / CNY 0.14` 配置。最终只读状态为 active jobs/suites/reservations 全 0。除已授权 fresh suite 的两个 Provider POST 与 CNY 0.28 外，发布阶段没有新增 Provider POST、ERP ingest、Ozon 写入或费用。

## 2026-09-26 `6378b62e / 1.0.364` 双区应用部署完成（官网 pointer 未切换）

- OpenAI-compatible 生图网关 Base URL 校验已修复：服务端拒绝把 `/image`、`/images`、`/images/generations` 等接口路径当作网关根地址，Web 在保存/检查前直接提示使用 `https://host/v1` 形式。用户已用 `https://image.xiaoyiapi.xyz/v1` 实际验证生图成功。实现提交 `6378b62ee9f452702c4c695485a795bba8d78fbd` 已推送到 `origin/feat/ai-media-prompt-registry`。
- fresh offline 回执 SHA-256 为 `95f563894d2eec8730461c25691e3732a2236401fe23358923f75419f98bc95a`；最终 Server 为 `6335 passed / 325 skipped / 0 failed`，AI Media PostgreSQL `197/197`，扩展 `463 pass / 0 failure / 0 warning`。回执位于 operator-private `C:\Users\550W\AppData\Local\SS-ERP\private\release-6378b62e`，不进入 Git。
- COM `1.0.364` 候选 cloud/local ZIP SHA-256 为 `b2fb86105896761f670241f69b5e910b94770f0d4e2d3cf587429ff2c2cc4943` / `574a91e6411ed1601bd0a0235ec99c2ccad4fa8c6667d2eb0ad86dc45a1b4b76`，release evidence/signature SHA-256 为 `4322414877b1112f7658a3453c2e670036259ba7b53f7dadf224bed8bf73b9af` / `3fc5eea081a33ae7dd1cdb8fe72f40233e0a67c2138a1856c05481db8e47b786`。COM 已按受限 pilot 合同运行，仅 owner `cmpsj2g6800005ow9rrtvqhay`、DOTH `cmq7r8n1700095o7exbet1xle` 和明确配对设备，允许操作仍为 `IMAGE_TO_IMAGE/SUITE`。
- CN `1.0.364` 候选 cloud/local ZIP SHA-256 为 `033abd6fbce95d5ce86de3a95ab4cf1f3e4b29beb5d8e0f54d09a98580c39cdd` / `485a5c73deb8c9f7385809de9c0b90488143c956994ac0fcb5d9c47b3329e6dc`，release evidence/signature SHA-256 为 `5f8393b55b78ed77c79a91d17601bde7e8c5ff0e91af22f97fda05512de80708` / `fc9fe1bf4cfe38051ded5e6e280b1d636fb8b7d5ac5d8e1ed47b7fa150559e2f`。CN 继续 direct-origin/RDS、AI/BYOK/Ozon 全暗。
- 两区部署后的 canonical VPS verifier 均为 `0 failure / 1 warning`，唯一 warning 仍为既定的远程备份未配置；COM/CN 当前服务版本均为 `6378b62e / 1.0.364`，`/ready`、150 migrations 和 post-migration suite guard 通过。
- 官网 extension pointer 仍安全保持 `6e38f907 / 1.0.362`。本轮尚未执行正式 QA04、COM REL-04 v3 canary、CN dark canary、website approval、distribution probe 或 CAS；这些 gate 必须绑定 fresh normal ERP suite evidence 和同一 `6378b62e`，不能用 offline 回执或部署成功替代。没有 Provider POST、ERP ingest、Ozon 写入或新增费用。

## 2026-09-25 `403c1ed4 / 1.0.363` 双区应用部署与双域登录验收完成

- 双域 Cookie、认证 transport、面单下载和首页扩展入口修复提交 `403c1ed4637777998ae688a7f9395579f2d101be` 已推送并部署到 COM/CN。COM 继续绑定既有 DOTH 受限 hosted pilot，仅允许 `IMAGE_TO_IMAGE/SUITE`；CN 继续 direct-origin、外部 RDS、AI/BYOK/Ozon 全暗。两区三服务、公网 `/ready`、150 migrations 和 post-migration suite guard 均通过。
- fresh offline 回执 SHA-256 为 `713170f30b54172f5070cd8f6a4c8f35cc543a12a56258673decb276801397c9`，最终 Server 为 `6332 passed / 325 skipped / 0 failed`，扩展 source 为 `463 pass / 0 failure / 0 warning`。`1.0.363` COM/CN release evidence 分别为 `d832fc694e4f3fa40fc6bfbddec7973596435877b650644989936b79ce7fcdcb`、`35997fa39f7c621dfd3d24b027999f9e80752c15409f537b5d337155d778589e`，签名分别为 `b8549e8ea40d137ed071340fbccdc1949186b6ca086c8da7fd8e3eb8743c40df`、`fcccd9ccb23e4c1cd728f8499aa3a3ff4bd50d15555fad80d0ffdf0f0b03c337`。
- 部署前 COM 本机 PostgreSQL 恢复 `144` 张表，CN RDS 恢复 `143` 张表，临时库均已清理。发布后完整 VPS verifier 均为 `0 failure / 1 warning`，唯一 warning 是既定未配置远端备份；canonical evidence SHA-256 为 COM `e555fc6c5db102ab2a613e67cd092a3dca325298e9fae4a9bb1679b42fa6635c`、CN `4909601fdad60f5ced294155d4f3d1a53730fb0bb8e851cd41899879408d8a1b`。
- 真实 Chrome incognito context 分别以临时 USER/ADMIN 完成 COM/CN 登录。两区都只产生 `app` 与 `admin` 两个 host-only `sserp_token`，均为 `HttpOnly + Secure + SameSite=Lax`；管理员退出后 admin `/me=401`，user `/me=200`。COM/CN 浏览器证据 SHA-256 为 `978607c8f2e7bd7c383135753a4a79787087e8a91b7d74acf92fd0d81bd89020`、`b7c37a607f3a9fe236ed5699f11641e1a442e586d7e0d5ffdd45e700668bcecc`。CN 用户首页保持 `/`，扩展入口可见且 `/download=200`；临时账号及 session 已删除，现有 9222 profile Cookie 未修改。
- 官网 extension pointer 未包含在本次授权中，COM/CN 仍安全服务 `6e38f907 / 1.0.362`；没有 website approval、canary、distribution probe 或 CAS。生产 Turnstile 会正确拒绝不携带 challenge token 的 CLI live/remote smoke，因此本轮用真实浏览器 token 完成双域验收，不把两次 CLI 拒绝写成通过。没有 Provider POST、ERP ingest、Ozon 写入或新增费用。

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

- [人工更新日志](../CHANGELOG.md)：面向用户的显著版本变更，遵循 Keep a Changelog 1.1.0。
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

- 下次起每个显著变更的提交/推送同时维护根目录 `CHANGELOG.md`：人工整理，使用 `Unreleased` 和实际适用的 `Added/Changed/Deprecated/Removed/Fixed/Security`；版本倒序、日期 `YYYY-MM-DD`、每版有链接并明确 SemVer 状态。官网公开成功才移动到发布日期版本；签名、部署或测试不等于公开。空分类省略，不能用 git log 堆砌日志或补造历史发布日期。
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
