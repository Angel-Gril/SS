# 多平台店铺上下文

## 范围与 owner

用户批准“平台→店铺”的两级筛选及相关页面同步调整。沿用当前 Web 组件、平台原生业务 owner 与服务端租户校验，无 schema、金额、平台状态映射或权限开关变更。商品列表仍按具体店铺读取；不能把旧的空 shopId 当作已实现跨店商品汇总。全部平台/店铺用于列表查看，平台写操作由原 owner 校验具体记录，批量备货入口要求明确 Ozon 店铺。

- `components/shops/platform-shop-filter.tsx`：平台名称、店铺搜索/收藏、连接状态与当前 COM/CN 站点展示。站点标签指 ERP 部署站点，不推测卖家所在地；收藏只保存浏览器偏好，不授予访问权限。
- `services/platform-shop-scope.ts`：平台/店铺参数验证和对已授权店铺 IDs 的交集，不对未知、他人、停用店铺或冲突平台扩大到全部店铺。
- 订单列表/流水线、导出、订单统计、利润、退货及异常件 routes 为只读消费者；授权和原生履约继续由原服务端业务 owner 执行。
- Web 消费者覆盖订单、商品、打包发货、物流绑定、退货、异常件、运输中、利润与 Ozon 客服。Ozon 专有组包明确显示 Ozon 店铺；Yandex 搬运继续分别显示来源 Ozon 和目标 Yandex，避免平台范围歧义。

## 2026-10-30 首版已部署及收口修复

首版源码 `1486da871197940f69a7683c175803624694e70d` 已推送并按标准流程部署 COM/CN，内部区域签名候选1.0.480。两区三服务、161 migrations、备份恢复、DB/Redis/ready 和 FULL VPS verifier 通过，各保留1条既有远端备份未配置warning。官网继续公开1.0.472，扩展本体不需为 ERP 筛选变化重新安装。

随后复核发现首版导出忽略 platform、统计忽略 shopId、无效筛选异常件/退货会扩到多店、商品恢复被首店覆盖/空选择残留数据、发货同步忽略单店、客服切店残留会话。当前收口修复加入同一窗口店铺搜索收藏、明确上下文与平台操作分流；商品切平台要求重新选择店铺，旧响应不能覆盖新商品或订单范围，退货同步不再默认猜测第一店。佣金读取现有接口仍读取当前账号全部可用 Ozon 店铺，按钮明确“同步全部 Ozon 佣金”，不误称单店。

T2：新增14项API回归先复现12处失败后修复通过，覆盖导出平台、统计单店、非法参数400、停用/外店及冲突平台不扩大范围。与原订单/商品/退货和Yandex操作回归共88项通过。Server/Web类型、改动ESLint、Server/Web生产构建通过。

T3：隔离Chrome运行实际React页面，本地有界模拟API；先复现商品恢复丢失和单店同步遍历多店，再修复并通过。最终12项检查包括搜索收藏、商品恢复/清空、单店同步、五类列表平台过滤、390px布局、客服切店清理与退货统计范围。证据 `C:/Users/550W/AppData/Local/Temp/ss-erp-platform-shop-ui-o8n5BO`，测试profile已关闭，无真实Provider/Ozon/Yandex业务写入或费用。本地模拟不宣称真实平台写接口通过。

旧 `scripts/web-products-ui-polish.test.mjs` 的单行编辑按钮源码断言在未改动的1486da87上同样不匹配，属于既有静态合同漂移，本轮不以它声称通过，也不修改旧断言掩盖问题。

## 收口修复已推送并双区部署

最终源码 `d91ee3db67306c5e9b35943309cd630c16df0d2c` 已推送至 `feat/ai-media-prompt-registry`。GitHub直连连接重置/超时后，使用已有本机7897代理的单次Git参数推送成功，未修改系统代理或Git全局配置。区域独立签名候选1.0.481的COM/CN签名SHA256分别为`50b7d56a6f3c830a4843ed8e1d925c3a3af85aa465bb0fb2627e12d0a3eb3300`、`9fc187e4d835d66d1ed4edd356e167bff27c0d5a64e5e869bf0e73d237070b83`。

COM146/CN145张public表目标备份恢复通过，临时库已清理；原COM两店/三设备pilot及CN dark预检保持。标准部署重新构建、封存源码、检查161 migrations（无待执行项）和套图DB守卫、切换current及三服务，健康检查均首轮HTTP200。API/Worker在标准迁移/守卫阶段有短暂停服，未跳过gate；官网公开扩展仍1.0.472，未执行CAS、approval或分发探针。

最终三服务cwd及ready于COM`2026-10-30T10:44:20.208Z`、CN`10:44:17.436Z`读回目标提交，DB/Redis正常。FULL canonical VPS两区均PASS、0failure/1既有远端备份warning；COM完成`10:41:03Z`，CN完成`10:45:49Z`。真实回执仅在对应VPS `/var/lib/ss-erp-final-release-evidence/d91ee3db67306c5e9b35943309cd630c16df0d2c/`及Windows私有`release-d91ee3db67306c5e9b35943309cd630c16df0d2c-platform-shop`，不进入Git。浏览器证据仅为本机隔离模拟API，不宣称生产登录交互或第三方业务写入已验收。未新增Provider请求、平台业务写入或费用；既有自动同步继续运行。
