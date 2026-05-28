# SS ERP 打印代理

本地 HTTP 服务，监听 9100 端口，接收 ERP 后台发来的 PDF 面单并调用本机打印机。

提供两种实现，二选一安装：

| 版本 | 体积 | 内存 | 优势 | 劣势 |
|------|------|------|------|------|
| Electron | 80~150MB | 150~300MB | 开发完整、配置 UI 友好、自动更新现成 | 体积大、对老仓库电脑不友好 |
| Go | 5~8MB | 5~20MB | 单文件、启动快、资源占用低 | 配置 UI 简单（仅 systray） |

第一阶段建议 Electron。版本稳定后用 Go 重写优化体积。

## HTTP API（两版本一致）

```
GET  /status      → { ok, version, defaultPrinter, platform }
GET  /printers    → { ok, printers: [...] }
POST /print       multipart/form-data
                  - file: PDF blob (必填)
                  - printer: 打印机名称 (可选，默认走配置)
                  - copies: 份数 (可选)
                  → { ok, printer }
```

CORS 默认允许 `http://localhost:3000` / `http://localhost:3001`，其他来源在 `config.json` 的 `allowedOrigins` 里加。

## ERP 前端配置入口

ERP 已有 `apps/web/src/lib/print-agent.ts`，配置项：
- `enabled: true` — 启用代理打印（不勾就走浏览器打印）
- `url: 'http://localhost:9100'` — 代理地址

`printLabel()` 会优先走代理，失败时自动 fallback 浏览器打印。

## 选哪个？

- 仓库电脑配置好（4C8G 以上）、需要可视化配置打印机/纸张/份数 → **Electron**
- 仓库电脑老旧（2C4G）、追求极简部署 → **Go**

详见 `electron/README.md` 和 `go/README.md`。
