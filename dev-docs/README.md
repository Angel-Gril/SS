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

- 加固阶段：stage-1 至 stage-8 已完成并推送；最近代码检查点为 `6e159af8`，随后又推送了文档/验收同步提交 `42729300`。
- 当前主风险：生产/线上运行态、Redis 集群拓扑、外部告警、真实 Provider/Ozon 行为和扩展 live worker 仍未验证；这些不阻塞本地继续开发，但阻塞发布准备。
- 推荐下一步：补齐受管扩展 live worker、真实 Provider/Ozon 与生产环境证据；发布前另开验收/发布准备阶段。
- 未验证项：GitHub 仓库可见性、线上运行态、Redis 集群与告警、真实 Provider/Ozon 行为、完整浏览器回归和扩展 live worker smoke。
