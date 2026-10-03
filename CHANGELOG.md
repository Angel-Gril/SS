# 更新日志

项目的显著变更在此人工整理，格式遵循 [Keep a Changelog 1.1.0](https://keepachangelog.com/zh-CN/1.1.0/)。
浏览器扩展采用 `major.minor.patch` 版本号；整个 ERP 尚未声明严格遵循语义化版本规范。
版本日期表示官网公开发布日期；仅提交、签名或部署的变更保留在 `Unreleased`，不视为公开发布。
本文件从 `1.0.395` 起整理已核实的公开版本；未在官网公开的候选版本不列为已发布版本。

## [Unreleased]

## [1.0.403] - 2026-10-03

### Changed

- 来源商品页默认打开基于原精铺工具改造的工作台，保留商品表格、SKU 选择和图片交互；不再需要预览开关或商品白名单。
- 利润核价面板只负责成本、利润计算与找货源，物流、Cookie 和选品等独立功能继续保留。

### Removed

- 从安装包和页面入口移除旧采集、生图、草稿审核和上架工作台，避免多个入口重复跳转 ERP。
- 移除 Ozon 商品详情与列表中的旧一键上架和 ERP 批量采集入口。

### Fixed

- 部署解包后先规范 release 文件权限，避免部署校验拒绝目录的组或其他用户写权限。

## [1.0.401] - 2026-10-02

### Added

- 提供受控预览的 donor 工作台适配版，接通 1688 采集、草稿编辑、托管套图审核与发布预览；普通入口当时仍使用旧面板。
- 为历史失败套图增加受审计的终止恢复和费用对账收口，保留已结算费用并释放未交付预留。

### Changed

- 双区 COM/CN 均绑定 `8bab3486cf5c434617fa1798b6e8a5a4e9ebbce4`，扩展版本为 `1.0.401`。
- 官网分发通过双区 REL-04 canary、website approval、CAS 和匿名 cloud/local 下载探针。

### Fixed

- 正式 QA04 读回区分 execution 与 target runtime，避免历史恢复状态污染发布证据。
- CN dark canary 使用无店铺账号验证，保持 AI、BYOK 与 Ozon 默认关闭。
- 保留托管计划的结构化来源媒体引用，修复历史套图未交付预留的释放投影并保留已结算费用。

## [1.0.395] - 2026-09-30

### Added

- 增加按商品白名单开放的扩展工作台预览，提供店铺草稿创建、图片处理与审核交接，并显示逐槽 ERP 费用。

### Changed

- 统一来源页图片工作台入口；桌面卡片居中并保留视口边距，采集和 ERP 核价继续使用各自入口。

### Fixed

- Cloud 扩展打开采集工作流时使用安装包中的 ERP 地址，避免残留 localhost 配置导致错误跳转。
- 修复来源数据刷新期间工作台打不开的问题；入口先响应，再读取云端状态。
- 修复 Wanx 套图提示词重复规则和冗长字段路径，保留商品事实及输入长度限制。
- 正确归一化已验证的 Wanx 输出尺寸，避免已生成的图片因尺寸差异被拒绝。
- 修复 1688 工作台验收对独立扩展 iframe 的识别，避免正确打开的工作台被误判为失败。

[Unreleased]: https://github.com/Angel-Gril/SS/compare/fdee810303d1216d2f587d4c09c9a9f59766abed...HEAD
[1.0.403]: https://github.com/Angel-Gril/SS/compare/8bab3486cf5c434617fa1798b6e8a5a4e9ebbce4...fdee810303d1216d2f587d4c09c9a9f59766abed
[1.0.395]: https://github.com/Angel-Gril/SS/commit/3723f5dd1a175537a183bd750f8c168a2f742baf
[1.0.401]: https://github.com/Angel-Gril/SS/commit/8bab3486cf5c434617fa1798b6e8a5a4e9ebbce4
