# SS ERP 内部开发真源

本目录记录当前项目状态、技术组合、owner 边界、阶段执行和验收证据。公开安装、使用、部署与运维说明仍由 `docs/` 负责。

## 当前真源索引

- [当前状态审计](current-state-audit.md)
- [技术选型与基础决定](technical-selection.md)
- [架构与 Owner Map](architecture.md)
- [验收与停止条件](acceptance.md)
- [2026-09 项目加固阶段](stages/project-hardening-2026-09.md)

## 文档职责

- `current-state-audit.md`：当前代码、Git、运行、文档、风险和进入点。
- `technical-selection.md`：沿用或迁移技术组合的唯一决策理由与外部证据 owner。
- `architecture.md`：当前进程、模块、数据、权限和部署边界的宏观投影。
- `acceptance.md`：本地、数据库、浏览器、安全和发布各证据面的最低门禁。
- `stages/`：只有跨 owner 或有序工作才物化；一份文件同时承载计划、当前子阶段和回写。

## 更新规则

- 先更新唯一 owner，再更新引用它的消费者；禁止复制第二份状态表。
- 当前代码和新鲜命令证据高于旧计划与历史发布记录。
- `docs/plans/` 和 `docs/archive/` 是历史/专题证据，不自动代表当前实施状态。
- `docs/deployment.md` 的线上记录只证明对应提交和日期；不能证明当前工作树已部署。
- 内部决定变更时更新本索引；完成的阶段保留为历史证据并明确结束状态。
- 推送前检查本目录是否包含密钥、手机号、客户数据、生产回执或不可公开的商业信息。

## 当前状态

- 实现检查点 `c10cdc61` 已推送并通过完整 QA-04 offline gate 和 Linux/Node 22 发布关键合同。两地已刷新本地备份与恢复认证，当前版本完整 VPS verifier 都为 `0 failure / 1 warning`。正式试点仍缺计费关联、明确费用上限和商品事实；尚未部署新代码或切换官网指针。详细结果与下一步见[当前状态审计](current-state-audit.md)。
- 历史已验证：对应提交的完整 preflight、生产域名/Turnstile/USER+ADMIN 只读 smoke、COM 受管扩展固定 ID 同路径升级、active worker、Unicode smoke、官网指针与 cloud/local 下载摘要；不自动覆盖本轮新改动。
- 当前主风险：真实 Provider pilot 尚缺可关联计费账户和明确费用上限；Ozon 最近预检与合成测试图 OSS 上传已有证据，但仍需真实测试商品事实及精确 owner/shop/device 的 pilot 绑定。两台 VPS 的 Redis 最近盘点均为 standalone、无副本/集群和专用告警；远端备份仍按决定未配置。Node ESM 提示已解决，Next build 的 flat-config 检测提示仍属工具链限制。
- 推荐下一步：先绑定可对账的 Provider 账户并逐操作审批一次性 pilot，再为 Ozon 测试店绑定明确的写入/回滚 pilot；远端备份按当前用户决定暂不配置。
