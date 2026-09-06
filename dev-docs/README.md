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

- 加固与发布验收阶段：stage-1 至 stage-14 已完成；最近实现检查点 `3d3333ef` 已推送。日本 VPS 与公开扩展仍绑定运行提交 `b64b723c`、版本 `1.0.316`，诊断 helper 提交没有改变运行包字节。
- 已验证：完整 preflight、生产域名/Turnstile/USER+ADMIN 只读 smoke、COM 受管扩展固定 ID 同路径升级、active worker、Unicode smoke、官网指针与 cloud/local 下载摘要。
- 当前主风险：真实 Provider pilot 尚缺费用批准和可关联计费账户；现有 Ozon 绑定店铺 API Key 已被 Ozon 以 `code=3` 拒绝，且没有专用测试店铺；Redis 集群拓扑、外部告警和 CN 远端备份仍未验证。
- 推荐下一步：先绑定可对账的 Provider 账户并逐操作审批一次性 pilot，再提供带有效只读凭据的专用 Ozon 测试店；远端备份按当前用户决定暂不配置。
