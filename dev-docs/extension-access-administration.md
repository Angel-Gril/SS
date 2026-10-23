# 扩展与托管访问管理

## 2026-10-24 实现与范围

用户要求完善后续用户、店铺和设备授权的可视化管理。此次为现有权限模型的管理界面与最小只读对象查询，不新建角色/权限模型，不改schema，不在部署时修改COM原试点或CN dark。官网466兼容修复和原465套图复用已独立完成；本功能不进入该四文件证据例外，也不新发Provider/Ozon请求。

系统设置 `/admin/settings` 新增“扩展与托管访问”，显示当前区域和服务器实际配置。仅超级管理员可读写；普通用户继续在顶部“扩展连接”配对自己的设备并选择本人店铺。安装公开扩展不授予托管AI或额外设备scope。

| 管理内容 | 唯一后端owner | 界面行为 |
| --- | --- | --- |
| 来源采集、草稿、类目、发布与图片工作台范围 | `services/source-workflow-feature-flags.ts` | 逐功能总开关与off/pilot/global；遵守原owner/shop/device/platform交集及stage/listingStage限制 |
| 托管AI用户范围 | `services/ai-media-rollout.ts` | 指定用户名单或all；功能、额度和设备授权仍独立生效 |
| 托管总开关、套图、改图、翻译、文案和商品分析 | `config/system-config-schema.ts`及既有各能力owner | 读取现值、只保存变更项，不代替Provider准入、价格、余额或日限额 |
| 配置保存、并发与审计 | `routes/system-config.ts`的batch PUT | 每项expectedRevision、现有Serializable事务及审计；新面板不增加第二个写入owner |
| BYOK策略 | 既有`extension-ai-admin-controls.tsx`及后台BYOK owner | 保留既有独立面板，移除重复的托管总开关写入，避免两个编辑器同时覆盖 |

总开关与策略必须同时允许；同一维度内任选其一，不同维度之间同时匹配。店铺工作流/类目/发布的pilot必须指定店铺且禁止deviceSessionIds；来源采集与扩展工作台沿用各自上下文要求。global去除名单；变更范围/工作流阶段或开启能力前，确认摘要显示具体对象、旧/新值和当前区域。普通动作不暴露原策略JSON。

## 只读选项与数据边界

新`GET /api/admin/extension-rollout/options`只有超级管理员当前网页登录会话可以访问，独立service为`extension-rollout-admin-options.ts`。search≤100、ownerUserIds≤50、limit≤500；只枚举ACTIVE主账号，未选owner不查店铺/设备。店铺限定选中owner和ACTIVE；设备限定选中owner、ACTIVE、未过期，仅返回最小ID/状态/scope/授权店铺。返回feature枚举来自原来源工作流owner，不另建业务规则清单。不会返回手机号、余额、API密钥、token或JTI。

原策略中本次未返回的ID保留并提示，不因搜索/分页而自动删除；对象切换中禁止使用旧瞬态列表。加载失败或策略无效明确阻止保存，不当成off。仅精确初始空对象`{}`提供显式确认后的本地关闭策略初始化，仍须再次核对保存，其他无效原值不一键覆盖。

409配置冲突与未知保存结果保留编辑并禁止重发，要求管理员显式重新读取；重读前提示放弃编辑。新增选择API不更改设备或店铺授权，不替用户配对；此界面保存也不生成图片或发布Ozon商品。

## 验证与未验证边界

实施为D2/T2，身份与数据投影在最小owner测试先RED→GREEN；服务端新route/service及相关策略/配置回归109项、服务端完整TypeScript和改动ESLint通过。前端最初10项新行为及3项原合同通过，Web完整类型检查及改动ESLint通过；最终复查发现旧AI_FEATURE_KEYS还会提交被隐藏的图片翻译开关，已最小RED→GREEN移除旧键和无效控件，新增写入键集合无交集回归后为11项新行为+3项原合同。翻译Provider字段保留，未更改生产开关。

主Agent在独立Chrome9482、本机合成API边界验证1440桌面/390窄屏无横向溢出；正常保存只提交实际变更与准确expectedRevision；确认取消无写入；HTTP409与网络未知结果均保留编辑且只发一次PUT；非空无效策略/读取失败不写；空策略只有两次明确确认后提交关闭范围。本机截图及请求记录在当前用户私有`extension-access-admin-ui-20261024`，不进入Git。这是实际浏览器与API边界验收，不冒充真实生产配置写入；本轮未测试全量开放或真实付费/Ozon发布。

## 双区部署和生产只读验收

功能提交`5db6ccad569116f90122290cdbc7a1c5e25f6ef2`及旧翻译写入残留修复`d6e693a38fc05f2b107856dc8ff6f7ece9f7d39d`均已合入`feat/ai-media-prompt-registry`并推送。最终双区API/Worker/Web均运行d6e693a3，部署内部区域签名候选为1.0.468；官网继续公开已验收的`a2e70f59 / 1.0.466`。本次功能在ERP后台生效，扩展本体未改，不需要用户再次换包；没有把468候选当官网公开版本。

Web/API production build、已有类型/lint及定向/浏览器验证通过；两区标准部署、160迁移无待执行项、目标部署备份与运行备份恢复、FULL VPS均通过。最终VPS COM SHA`5bed964364f0221eb069d2e52cd20ebd7db302cf008c9ea6624165238fc34272`、CN`54b205d18f989cfe0f5266ec1df0b30a8ea09debf42189181893f93897abe9c1`，原远端备份未配置warning保留。此处未运行/宣称管理功能提交的新完整native offline、付费suite、官网QA04/CAS，未扩大原465→466的精确证据复用范围。

部署前后各区24项实际开关/策略/修订完整比对一致，配置写入0；COM保留原DOTH+BINI试点，CN保持dark和初始来源策略`{}`。使用现有短时smoke账户会话进行真实HTTP只读核验：匿名401、普通用户403、超管200、limit501拒绝400、原system-config可读、所选owner店铺/设备不串且仅最小字段。两区实际管理员页面浏览器只读打开：COM9项功能正常显示且无错误；CN因原策略精确`{}`显示初始化关闭范围提示、保存禁用，未点击初始化或写入配置。COM早两次取证脚本在React数据稳定前切换折叠项导致等待，实际API均200；调整只读取证顺序后通过，失败不计成功。Cloudflare的RUM POST被浏览器guard阻止，不影响业务只读核验；所有业务写请求均未发送。全部短时验证会话和私有临时token已撤销/清理，专用浏览器关闭，用户9222保留。

CN在467首次构建曾因Prisma官方引擎校验文件网络请求失败，失败目标未执行迁移，原466服务保持；失败副本改名保留。后续构建将当前已验证Prisma6.19.3、engine commit`c2990dca591cba766e3b7ef5d9e8a84796e47ab7`的windows/debian引擎复制至本次临时构建home标准缓存，分别核对官方SHA后由Prisma继续自身完整性验证；未改源码、版本、锁文件或关闭checksum校验，临时home仍由部署owner清理。正常门禁的API/Worker停机事实保留，不宣称零停机。后续可在独立范围内优化下载可靠性，不能用本次记录当任意依赖缓存信任。

最终签名SHA：COM`e1bbb8915e411fd909fa5c61e1222c77c6f0591371de675831fb29bb91475a1c`、CN`1b6f99acc17f458ee29b9e160847fa0f8e7d180fe0dc02c08328be95779225ee`。私有部署/备份/HTTP/真实界面/回执位于`release-5db6ccad-orders`和`release-d6e693a3-orders`，隔离前端证据为`extension-access-admin-ui-20261024`，均在当前Windows用户private目录，不进入Git。官网四包匿名HEAD仍200并保持466；其实际下载/验签证明沿用本次已成功的466公开发布原件，不伪称468已走官网门禁。新增Provider请求、Ozon业务写入、费用均0。

生产配置分配须由超级管理员在对应区域`/admin/settings`保存并核对摘要；普通用户仍在顶部“扩展连接”选择本人店铺并配对设备。此页面没有替用户配对或代发Provider/Ozon。Ozon组包模块已随465上线，入口“订单管理→组包交仓”；真实店铺仓库准入、实货签打印和实际Ozon组包写入仍未验证。
