# Go 打印代理

## 依赖

- Go 1.22+
- Windows 推荐安装 [SumatraPDF](https://www.sumatrapdfreader.org/)（无 GUI 弹窗的静默打印）
- macOS / Linux：内置 `lp` 命令（CUPS）

## 开发运行

```powershell
cd print-agent/go
go mod tidy
go run .
```

启动后：
- HTTP 服务监听 `127.0.0.1:9100`
- 系统托盘出现 "SS ERP" 图标
- 右键托盘可选择默认打印机、测试打印、退出

## 编译

```powershell
# Windows（无控制台窗口）
$env:GOOS="windows"; go build -ldflags="-H windowsgui -s -w" -o ss-erp-print-agent.exe

# macOS
GOOS=darwin go build -ldflags="-s -w" -o ss-erp-print-agent

# Linux
GOOS=linux go build -ldflags="-s -w" -o ss-erp-print-agent
```

`-s -w` 去除调试符号，体积约 5~8MB。

## 配置文件位置

- Windows: `%APPDATA%/ss-erp-print-agent/config.json`
- macOS: `~/Library/Application Support/ss-erp-print-agent/config.json`
- Linux: `~/.config/ss-erp-print-agent/config.json`

托盘菜单选择默认打印机后会自动写入。手动改完需重启代理。

## 打印实现

| 平台 | 方式 |
|------|------|
| Windows | `SumatraPDF.exe -print-to <printer> -silent` |
| Windows 备选 | `Start-Process -Verb Print` (无 SumatraPDF 时) |
| macOS / Linux | `lp -d <printer> -n <copies>` |

## 自启动

**Windows**：把 exe 路径加到 `shell:startup` 文件夹的快捷方式。

**macOS**：写一个 `~/Library/LaunchAgents/com.sserp.printagent.plist`：
```xml
<plist version="1.0">
<dict>
  <key>Label</key><string>com.sserp.printagent</string>
  <key>ProgramArguments</key>
  <array><string>/usr/local/bin/ss-erp-print-agent</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
```

**Linux**：systemd user unit 或 `~/.config/autostart/`。
