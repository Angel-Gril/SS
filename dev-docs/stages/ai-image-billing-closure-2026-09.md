# 生图与计费本地链路收口（2026-09）

## 当前阶段与事实

- 当前子阶段：**四次实测质量均拒绝；新增最多 CNY 0.50 的两张条件重测已批准，正在实现受控预算追加和冻结新执行修订**。`18ec006d` 是第四次实测的历史冻结点；接续主线 `fd4007f0`、线上维护版本 `63b98b2c`。当前授权、HTTP 来源复验、计费入口修复及证据摘要只维护在[当前状态审计](../current-state-audit.md#生图与计费接续http-来源复验及重测授权2026-09-15)。
- 2026-09-14 离线诊断已完成：四次 wire 请求均与冻结报告一致，未发现 prompt 截断、变量注入、函数选择或遮罩方向错误；官方 `strength` 参数不适用于 INPAINT。合成验收参考证明选区内渐变可以同时满足目标色和遮罩外零变化，但不代表 Provider 能达到该效果。诊断和参考均为离线证据，不改变生产行为。
- 2026-09-14 13:16 的只读追踪显示指定 Key 今日用量已回显 1 次、原生账单明细仍为 4 条且第四条免费抵扣、当前应付零；最终账单仍受次月出具和约 24 小时延迟规则约束，继续保持 `canFinalize:false`。
- 2026-09-14 13:28 的外部只读验收已确认账户、第四次任务 GET、今日用量和四条免费抵扣明细；原生 task→bill 关联、正式结算和正常 ERP 链路仍未证明。线上 ERP 工作流/Web Media 均关闭，完整 QA-02/QA-04 继续未完成。
- 开始基线：`ae65fd15`，主工作区 clean；继续沿用 Next/Fastify/Prisma/Redis/MV3。
- 同一新 Wanx Key 已执行 2 次 FULL_EDIT、2 次 INPAINT，均未重试；四个改色样本质量均未通过，逐笔费用状态以当前状态审计为准。
- `scoped-print-preview-v2` 仍只供离线查看；隔离实验版未晋升到普通 hosted 路径。
- 原四笔保守占位 CNY 1 必须完整保留；用户已批准新增最多 CNY 0.50，累计最多 CNY 1.50。每张最多 CNY 0.25，INPAINT 先行，质量通过才允许 FULL_EDIT；免费抵扣不恢复预算，不改写旧审批、scope、claim、原图或报告。新额度只在同一物理 campaign 的受控追加机制通过验证、绑定新执行修订和两份固定输入后生效。

## 本地交付与 Owner

| 范围 | 唯一实现 owner | 调用者与消费者 | 验收边界 |
| --- | --- | --- | --- |
| 隔离实验提示词 | 根 Agent：`ai-image-edit-prompt-contract.ts`、`ai-image-edit-provider-contract.ts`、`ai-image-wanx-trial-input.ts`、`ai-image-wanx-trial-preparation.ts` 及定向测试 | 原编译/准备 CLI、single-submit 的 trial 路径 | 新实验 profile 显式选择且绑定完整快照；preview 仍不可发包，普通 hosted 仍固定 v1；历史 v1/preview 摘要不变 |
| 跨 round 累计上限 | 预算 Agent：新的 campaign 预算 owner、`ai-image-wanx-trial-execution.ts` 与专用测试 | trial claim 及最后发包校验 | 同一物理私有根绑定账户和 CNY 1；读取并保留历史已消费槽位，跨进程累计，超限在发包前拒绝；失败/未知/免费不释放金额 |
| 原生控制台明细 | 账单 Agent：新的 ListConsumeDetails 观察 owner、必要的共享原生 JSON/金额 reader 及测试 | 根 Agent 接入现有 billing CLI；真实私有采集回放 | Count/Data 原始响应及查询范围保真；账号、分页、日期、精确金额、免费抵扣分别验证；只输出脱敏观察，不能生成正式结算或晋升能力 |
| CLI、组合门禁和真源 | 根 Agent：billing CLI、package scripts、对应 CLI 测试、`dev-docs/` 和必要 runbook | 操作员、后续 Agent、正式原生证据回放 | 完成源码/命令验证后，使用真实已采集账单回放；准备新的可审阅输入，任何新真实请求等待单独批准 |

## 顺序与测试门禁

1. **T2**：先在各 owner 写失败用例，确认缺失行为 RED，再实现 GREEN。共享 JSON reader 若提取，按 **T1** 先建立 QueryBill 原门禁基线并保持其输出/拒绝合同。
2. 实验 profile 仅在明确 trial 语境接受；不修改按量金额、账户身份、正常托管开关、Provider 或原 v4 审批字段含义。
3. 累计预算在本目录的已核对账户作用域内执行；历史占位按最大授权额导入，不能按临时零费用抹去。并发预占必须先于当前操作槽位，最后发包前再次核验。
4. 控制台观察保留 ListConsumeDetails 身份和 native 日期/数量/金额，不包装成 QueryBill。字节完整性不等于采集认证；待对账状态与 `actualCost:null` 继续保留。
5. 组合回归、类型检查、构建与适用的完整门禁通过后形成单一目的提交；真实账单回放和后续实测分开记录。不得以 mock、测试数量或免费额度替代真实质量/结算验收。

## 当前执行记录

- 已完成当前真源、代码与 Git 基线核对；以上三个范围可并行实施，各自只写所列 owner。
- 实验 profile：18 项新增用例中 14 RED、4 原有拒绝基线保持通过；实现后连原 prompt/preview/preparation 为 114 项通过。补齐 v4 到 single-submit 的实验 INPAINT 正例与两种 v1 摘要零 POST 拒绝，未改变真实请求 fingerprint 含义。
- 跨 round 预算：13 项初始 RED；补齐只读观察、并发进程、故障留锁及篡改等 21 项。独立复核发现同前缀普通文件误当目录，再以 3 RED 修复并增加 6 项兼容/拒绝回归；最终 campaign 27 项与 execution 20 项组合 47/47 通过，复核确认问题关闭。
- ListConsumeDetails：50 项初始 RED；内嵌 JSON 空白、凭据键拒绝另有 RED→GREEN。最终新 59 项及旧 QueryBill 48 项通过，T1 提取保持旧合同；CLI 已新增实际子进程正反例，并纳入 sandbox strict typecheck。
- 真实私有账单与历史预算已在工作树只读回放，结果及私有摘要统一记录于[当前状态审计](../current-state-audit.md#生图实验与累计计费本地收口2026-09-13)。这一步不产生结算，也不消费第四次槽位。
- 当前源码已冻结；完整 preflight 通过，包含后端 5808 passed / 258 条条件性 skipped、扩展 459 pass / 0 failure / 0 warning；全仓 lint、sandbox strict typecheck、定向 CLI lint 和 server build 通过。20 个受改源码/配置/测试文件在整轮门禁前后 SHA-256 一致。该结果是本地门禁，不能代替独立 PostgreSQL/Provider/正式 QA-04 验收；独立 clean 检出上的后续回放与新输入准备见下条。
- 提交前 staged diff 检查发现新原生 JSON helper 的文件尾多余空行，按 T0 清理并复核 diff；门禁后没有其他源码调整。
- 源码已提交为 `18ec006d`，真正独立 clean 检出及离线锁定依赖已就绪；该提交上的正式账单 CLI、预算只读回放、新输入 compile→prepare→verify→approval-draft 均已完成。未批准草稿被收费前核验拒绝，原审批/claim/report 未改，未创建新执行预占。详细结果以当前状态审计为准，不复制第二份账单或输入清单。
- 上述 2026-09-13 本地交付记录未产生新的 Provider 请求；随后第四次实测、118 项新鲜定向测试、质量复核及费用观察见[2026-09-14 接续记录](../current-state-audit.md#第四次实验接续与质量验收2026-09-14)。本次未修改产品源码、未执行 ERP/Ozon 写入、推送或部署。

## 剩余外部验收

- 新实验提示词的真实质量、正常 ERP 任务来源与候选接收链、非零扣费分支及正式单任务最终结算尚未通过。
- 第四次输入已经消费，四次授权均不能重用；先保留结果并做离线诊断，新实测另需完整预算和审批绑定。
- 当前离线诊断未证明质量根因；继续以质量阈值、提示词/参数合同和原生账单只读核对为主，新增生成必须重新取得整轮预算及逐次批准。
- 外部账单最终性遵守原计费 runbook，不能仅凭日期、零应付或单条时间窗匹配宣称完成。
