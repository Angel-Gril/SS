# Electron 打印代理

## 开发运行

```powershell
cd print-agent/electron
npm install
npm start
```

启动后：
- HTTP 服务监听 `127.0.0.1:9100`
- 任务栏出现托盘图标，点击打开配置窗口
- 配置窗口可选择默认打印机、份数、纸张、静默打印开关

测试打印：
```powershell
# 准备一个 PDF
curl -X POST http://localhost:9100/print -F "file=@test.pdf"
```

## 打包分发

```powershell
# Windows
npm run build:win   # 输出 dist/SS ERP 打印代理 Setup x.x.x.exe (NSIS)

# macOS
npm run build:mac   # 输出 dist/*.dmg
```

打包前需要在 `src/assets/` 放置图标：
- `tray.ico` (Windows 托盘 16x16/32x32)
- `tray.png` (macOS 托盘 22x22)
- `icon.ico` (Windows 安装包 256x256)
- `icon.icns` (macOS 应用)
- `test.pdf` (测试打印用)

## 配置文件位置

- Windows: `%APPDATA%/SS ERP 打印代理/config.json`
- macOS: `~/Library/Application Support/SS ERP 打印代理/config.json`

格式：
```json
{
  "port": 9100,
  "defaultPrinter": "HP LaserJet 1020",
  "copies": 1,
  "paperSize": "",
  "silent": true,
  "allowedOrigins": ["http://localhost:3000"]
}
```

## 打印实现

底层用 `pdf-to-printer`：
- Windows：调用 `SumatraPDF.exe`（需要随安装包打入或独立安装）
- macOS/Linux：调用 `lp` 命令

如果系统没有 SumatraPDF，会回退到 `Start-Process -Verb Print` 方式（弹默认 PDF 阅读器打印）。生产环境建议把 SumatraPDF 一并打包。
