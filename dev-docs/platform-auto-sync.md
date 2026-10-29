# 平台订单与商品自动同步

## 2026-10-29 实现与范围

用户明确要求在 ERP 设置加入订单、价格、库存等自动同步，默认每5分钟一次。本轮在现有 SystemConfig、BullMQ、SyncJob 与 Ozon/Yandex 读取 owner 上实现，无数据库 schema 或迁移变化；不变更平台写入、计费、店铺身份或区域策略。

管理员 `/admin/settings` 的“自动同步”分组包含两类独立开关与间隔：

| 配置 | 默认 | 边界 |
| --- | --- | --- |
| `sync_auto_orders_enabled` | `true` | 读取订单和平台物流状态 |
| `sync_auto_orders_interval_minutes` | `5` | 整数，5–1440分钟 |
| `sync_auto_products_enabled` | `true` | 一次商品读取包含平台售价、库存 |
| `sync_auto_products_interval_minutes` | `5` | 整数，5–1440分钟 |

设置沿用超级管理员网页登录会话、原 batch/expectedRevision/审计；四项一起保存。适用于当前部署区域全部 ACTIVE Ozon/Yandex 店铺，所属账户也须 ACTIVE。停用/异常店铺、冻结账户及未接入平台不自动入队。更新配置约一分钟内由下一轮检查读取；关闭开关停止创建新任务，已在队列中的任务不强制取消。云端必须有真实 Redis/后台 Worker，Redis不可用时不假报成功；`REDIS_DISABLED` 的离线手工同步保持可用，周期自动调度不启动。

## Owner 与执行

- `config/system-config-schema.ts`：配置类型、默认值、上下限和设置元数据；API启动的现有seed创建缺失项，保留已有值。
- `services/shop-auto-sync.ts`：每次读取严格配置快照，以任务结束时间判断到期，不使用商品和订单共用的 `Shop.lastSyncAt`。独立状态流、失败冷却、每批100店铺的游标轮转；首次/常规读取沿用最近90天订单范围。
- `workers/shop-auto-sync.ts`：独立Worker和内嵌Worker启动路径均接入，启动10秒后首次检查，随后每分钟检查；Redis租约减少多进程重复扫描，退出时清理自身计时器。
- `services/platform-sync-reservation.ts`：同店铺、同类型 advisory lock，复用现有 SyncJob PENDING/RUNNING；同幂等队列ID修复入队回执丢失，自动间隔在事务内再次判断。上架后的延迟补同步以原coalescing key保留。执行前再次检查任务/店铺/账户，避免并发执行相同类型读取或再次执行已成功任务。
- `workers/order-sync.ts` / `workers/product-sync.ts`：保留原平台读取与保存、平台限流/队列并发、失败重试及业务规则；不向平台改价、改库存、发货或取消。手动/通知/上架后队列入口使用共同reservation。旧同步直连接口不是新调度入口，本轮未改写其返回合同。

5分钟是目标间隔，从上次任务结束计算。大店铺分页、平台限流、队列等待和多店铺轮转会延后实际完成；周期读取不保证平台数据立即可见，也不等于浏览器列表自动刷新。订单同步沿用原服务费/去重语义，不增加按次同步收费模型。

## 当前证据与发布

T2：默认值/上下限、独立关闭、间隔冷却、手动/自动去重、PENDING恢复、Redis租约/停止调度和失效账户校验均以最小回归 RED→GREEN；真实本机PostgreSQL隔离schema验证并发6次只形成一个原始任务、独立数据流计时、延迟补同步、运行锁和执行前归属校验。

后端8文件28项、设置页原13项合同、本机隔离PG4文件16项通过，0跳过；隔离schema已清理，Server/Web类型、ESLint及Web/API构建均通过。实际React设置页隔离Chrome验证默认两类开启/5分钟、无效输入禁止保存、独立开关、四项带revision保存与读回、390px无横向溢出。截图位于本机临时目录 `ss-erp-auto-sync-ui-zbp7TX`，不进入Git。没有使用生产店铺Key、发起真实平台请求或产生费用。

## 2026-10-29 双区部署与真实周期读回

用户明确授权提交、推送和部署后，源码 `16b5668b4a97180f33ece33dfd3c46de993d1e25` 已推送到 `feat/ai-media-prompt-registry`，COM/CN 标准部署均完成，内部区域签名候选为 `1.0.480`。仅打包元数据增加版本，未修改扩展功能或官网公开指针。COM `.com` 与 CN `.cn` origins 独立签名，分别 SHA256 `3c453ba89acf806c174897a626786723330e110c47ba4fb9eb26ba4771f957ed` / `93519582ca1f2495b32f75d9787f284a18f904af565fe603fa5770f7e0ac3aa2`。

部署前完成目标提交备份恢复，COM146/CN145张public表，临时库清理；COM现有两店/三设备pilot、CN AI/BYOK/Ozon dark均精确预检并保持。API/Worker按标准流程在迁移与守卫期间短暂停止，构建阶段旧服务继续运行。161迁移无待执行项，两区Server/Web构建、区域签名包Cloud639/Local629、源码封存、服务重启、公开ready及DB/Redis通过。未跳过发布流程、未更改权限或数据库结构；CN Web外部资源连接超时重试后构建成功。最初只读预检因未显式传DEPLOY_DIR失败，修正为当前部署目录后通过，未因此停止服务或切换current。

两区 FULL canonical VPS 均 PASS、0failure/1既有warning（远端备份未配置），COM完成时间 `2026-10-29T08:27:33.403Z`，CN `2026-10-29T08:39:49.145Z`。最终三服务进程cwd与ready绑定目标提交的读回为 `08:40:08Z` / `08:40:10Z`。完整私有日志、区域签名和任务读回保存在当前Windows用户私有目录 `release-16b5668b-auto-sync`，canonical原件还保存在对应VPS的 `/var/lib/ss-erp-final-release-evidence/16b5668b4a97180f33ece33dfd3c46de993d1e25/`，不提交Git。

两区实际SystemConfig均为两开关true、间隔5分钟，Worker自动生成带 `trigger=scheduled` 的SyncJob。COM18个合格店铺：首轮15家Ozon与1家Yandex的订单及商品同步成功，随后五分钟目标间隔再次自动创建任务，证明周期执行而非仅启动一次；COM `08:39:14Z`读回Yandex两类均2次成功、队列清空。另2家Ozon因平台限制/无效Api-Key失败，保留原任务错误，没有改凭据或冒报成功。CN12个合格Ozon店铺自动入队，已有成功及失败记录；本轮不在CN额外绑定测试店或手工调用真实店铺验收。

自动同步只读取平台数据并更新ERP快照，未发起Provider、生图、平台改价/库存/发货等写入。原服务费规则保持，未读取用户费用详情，不将后台健康检查声称为全部店铺业务成功。官网公开扩展保持此前472指针，本次ERP功能生效不需要重装扩展。
