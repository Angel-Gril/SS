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

- 实现检查点 `c10cdc61` 已推送并通过完整 QA-04 offline gate 和 Linux/Node 22 发布关键合同；旧运行版本的备份恢复与 verifier 证据已记录。后续已执行一次真实 Xiaoyi 图像生成并取得结果，但正式计费核对未关闭；Ozon 完成只读资料检查。新部署与官网切换仍未执行，详细结果与下一步见[当前状态审计](current-state-audit.md)。
- 历史已验证：对应提交的完整 preflight、生产域名/Turnstile/USER+ADMIN 只读 smoke、COM 受管扩展固定 ID 同路径升级、active worker、Unicode smoke、官网指针与 cloud/local 下载摘要；不自动覆盖本轮新改动。
- 当前主风险：Xiaoyi 请求日志与累计计量不一致，旧 Wanx 编辑仍有独立的计费账户错配；Ozon 已有自有归档商品资料，但测试隔离、素材及精确 compiler/pilot 绑定未完成。两台 VPS 的 Redis 最近盘点均为 standalone、无副本/集群和专用告警；远端备份仍按决定未配置。Node ESM 提示已解决，Next build 的 flat-config 检测提示仍属工具链限制。
- 推荐下一步：只读关闭原 Provider 请求的账单差异，不重发；按执行清单核实 Ozon 测试隔离及正常编译链。不能用单张生成成功代替完整 QA-02、正式 QA-04 或发布批准。
