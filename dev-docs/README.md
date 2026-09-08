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

- 实现检查点 `c10cdc61` 已推送并通过对应完整 QA-04 offline gate；后续 Xiaoyi 单张生成及用户凭单离线对账已完成，原审批币种差异保留。Ozon 资料与主图已核实；ERP-only 实跑发现并在源码修复幂等锁 500，但尚未部署。新部署与官网切换仍未执行，详细结果与下一步见[当前状态审计](current-state-audit.md)。
- 历史已验证：对应提交的完整 preflight、生产域名/Turnstile/USER+ADMIN 只读 smoke、COM 受管扩展固定 ID 同路径升级、active worker、Unicode smoke、官网指针与 cloud/local 下载摘要；不自动覆盖本轮新改动。
- 当前主风险：Wanx 三项历史编辑的技术/质量证据已复核完整，但计费账户错配及完整 QA-02 仍未关闭。Ozon ERP-only 完整数据库隔离链路已通过，线上草稿仍需部署修复后重验；DOTH 样本存在 FBS 库存，不能当作已证实的专用测试店。两台 VPS 的 Redis 最近盘点均为 standalone、无副本/集群和专用告警；远端备份仍按决定未配置。Node ESM 提示已解决，Next build 的 flat-config 检测提示仍属工具链限制。
- 推荐下一步：保存并验证当前修复检查点，按既有 QA-02/QA-04 和签名门禁推进后续部署；不再查询已确认的 Xiaoyi 单笔金额或重发。真实 Ozon 写入仍等待专用测试隔离，不能用 ERP 草稿准备或单张生成代替完整试点验收。
- 最新功能收口（2026-09-09）：按用户要求优先修复 AI 工作台。四操作的隔离浏览器生成、预览、显式批准和接收入口已验证；改图审核交接、多行提示词、合法响应 metadata 和临时核验失败保留候选已修复。完整 preflight、lint/typecheck 与双模式扩展包通过。真实付费通道、MV3/ERP 外部验收和 Wanx 正常托管接线仍不在该通过结论内，详情只维护在[当前状态审计](current-state-audit.md)。
