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

实施为D2/T2，身份与数据投影在最小owner测试先RED→GREEN；服务端新route/service及相关策略/配置回归109项、服务端完整TypeScript和改动ESLint通过。前端10项新行为及3项原合同通过，Web完整类型检查及改动ESLint通过。

主Agent在独立Chrome9482、本机合成API边界验证1440桌面/390窄屏无横向溢出；正常保存只提交实际变更与准确expectedRevision；确认取消无写入；HTTP409与网络未知结果均保留编辑且只发一次PUT；非空无效策略/读取失败不写；空策略只有两次明确确认后提交关闭范围。本机截图及请求记录在当前用户私有`extension-access-admin-ui-20261024`，不进入Git。这是实际浏览器与API边界验收，不冒充真实生产配置写入；本轮未测试全量开放或真实付费/Ozon发布。

代码已实现但尚未提交、签名或部署，线上仍是466。生产上线时保留原配置，部署后只做权限拒绝与现值只读核验，不借验收改变真实用户的可用范围。Ozon组包模块已随465上线，入口“订单管理→组包交仓”；真实店铺仓库准入、实货签打印和实际Ozon组包写入仍未验证。
