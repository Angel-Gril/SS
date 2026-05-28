@echo off
REM ============================================================
REM  SS ERP 启动器
REM  位置：SS-ERP\start.bat
REM  目录布局：
REM    SS-ERP\
REM      runtime\node\node.exe
REM      runtime\pgsql\bin\
REM      apps\server\dist\index.js
REM      apps\server\prisma\schema.prisma
REM      apps\web\server.js (next standalone)
REM      data\           (PG 数据目录，首次启动 initdb)
REM      logs\
REM      config.json
REM ============================================================

setlocal EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

set "ROOT=%cd%"
set "NODE_DIR=%ROOT%\runtime\node"
set "PG_DIR=%ROOT%\runtime\pgsql"
set "DATA_DIR=%ROOT%\data"
set "LOG_DIR=%ROOT%\logs"
set "PG_LOG=%LOG_DIR%\postgres.log"
set "SERVER_LOG=%LOG_DIR%\server.log"
set "WEB_LOG=%LOG_DIR%\web.log"
set "PATH=%NODE_DIR%;%PG_DIR%\bin;%PATH%"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo.
echo  ============================================
echo   SS ERP 启动中
echo  ============================================
echo.

REM ---------- 0. 清理上一次残留进程（避免端口占用 + 错乱的 DATABASE_URL）----------
echo  [0/5] 清理旧进程...
for %%F in (server.pid web.pid) do (
    if exist "%LOG_DIR%\%%F" (
        for /f %%P in ('type "%LOG_DIR%\%%F"') do (
            taskkill /PID %%P /T /F >nul 2>&1
        )
        del /q "%LOG_DIR%\%%F" >nul 2>&1
    )
)
REM 兜底：按端口杀（PID 文件可能丢失）—— 端口要先读出来
for /f "usebackq tokens=*" %%i in (`node -e "const c=require('./config.json');console.log((c.webPort||3400)+' '+(c.serverPort||3401))"`) do set "_PORTS=%%i"
for /f "tokens=1,2" %%a in ("%_PORTS%") do (
    for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%%a " ^| findstr "LISTENING"') do taskkill /PID %%P /F >nul 2>&1
    for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%%b " ^| findstr "LISTENING"') do taskkill /PID %%P /F >nul 2>&1
)

REM ---------- 1. 读 config.json 端口 ----------
for /f "usebackq tokens=*" %%i in (`node -e "const c=require('./config.json');console.log((c.webPort||3400)+' '+(c.serverPort||3401)+' '+(c.pgPort||5433))"`) do set "PORTS=%%i"
for /f "tokens=1,2,3" %%a in ("%PORTS%") do (
    set "WEB_PORT=%%a"
    set "SERVER_PORT=%%b"
    set "PG_PORT=%%c"
)

REM ---------- 1.5 把 config.json 关键字段灌进环境变量（让 server 子进程继承，绕过 ESM bundle 求值顺序问题）----------
for /f "usebackq delims=" %%i in (`node -e "const c=require('./config.json');console.log(c.redisDisabled?1:0)"`) do set "REDIS_DISABLED=%%i"
for /f "usebackq delims=" %%i in (`node -e "const c=require('./config.json');process.stdout.write(c.jwtSecret||'')"`) do set "JWT_SECRET=%%i"
for /f "usebackq delims=" %%i in (`node -e "const c=require('./config.json');process.stdout.write(c.corsOrigin||'')"`) do set "CORS_ORIGIN=%%i"
for /f "usebackq delims=" %%i in (`node -e "const c=require('./config.json');process.stdout.write(c.uploadDir||'')"`) do set "UPLOAD_DIR=%%i"
echo  端口: web=!WEB_PORT! server=!SERVER_PORT! pg=!PG_PORT!

REM ---------- 2. 首次运行: initdb ----------
if not exist "%DATA_DIR%\PG_VERSION" (
    echo.
    echo  [1/5] 初始化数据库目录...
    if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
    "%PG_DIR%\bin\initdb.exe" -D "%DATA_DIR%" -E UTF8 --locale=C -U postgres --auth=trust >> "%PG_LOG%" 2>&1
    if errorlevel 1 (
        echo  initdb 失败，详见 %PG_LOG%
        pause
        exit /b 1
    )
    REM 修改端口（用 .NET API 写，避免 PowerShell 5 的 utf8 BOM）
    powershell -NoProfile -Command "$p='%DATA_DIR%\postgresql.conf'; $t=(Get-Content $p -Raw) -replace '#port = 5432', 'port = !PG_PORT!'; [System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding $false))"
    set "FIRST_RUN=1"
) else (
    echo  [1/5] 数据库目录已存在
)

REM ---------- 修复 node_modules junction（zip 解压后断裂）----------
if exist "%ROOT%\fix-links.js" (
    "%NODE_DIR%\node.exe" "%ROOT%\fix-links.js" >nul 2>&1
)

REM ---------- 3. 启动 PostgreSQL ----------
echo  [2/5] 启动 PostgreSQL...
REM 先检测是否已经在跑（pg_isready 比 pg_ctl 更可靠）
"%PG_DIR%\bin\pg_isready.exe" -p !PG_PORT! -h 127.0.0.1 -t 1 >nul 2>&1
if not errorlevel 1 (
    echo   PostgreSQL 已在运行，跳过启动
    goto :PG_READY
)
REM 用 PowerShell Start-Process 脱离 console 启动 PG（不 -Wait，因为 pg_ctl 启动 postgres 后会保持子进程让 -Wait 永远阻塞）
powershell -NoProfile -Command "Start-Process -FilePath '%PG_DIR%\bin\pg_ctl.exe' -ArgumentList @('-D','%DATA_DIR%','-l','%PG_LOG%','-s','start') -WindowStyle Hidden" >nul 2>&1
REM 等 PG ready（最多 30 秒）
set "PG_RETRY=0"
:WAIT_PG
"%PG_DIR%\bin\pg_isready.exe" -p !PG_PORT! -h 127.0.0.1 -t 1 >nul 2>&1
if not errorlevel 1 goto :PG_READY
set /a PG_RETRY+=1
if !PG_RETRY! GEQ 30 (
    echo  PostgreSQL 启动超时，详见 %PG_LOG%
    pause
    exit /b 1
)
timeout /t 1 /nobreak >nul
goto :WAIT_PG
:PG_READY

REM ---------- 4. 建库（幂等）+ Prisma migrate ----------
echo  [3/5] 创建数据库 ss_erp（如已存在则跳过）...
"%PG_DIR%\bin\createdb.exe" -h 127.0.0.1 -p !PG_PORT! -U postgres ss_erp >nul 2>&1
REM createdb returns 1 if db already exists — that's fine

echo  [4/5] 应用数据库迁移...
cd /d "%ROOT%\apps\server"
set "DATABASE_URL=postgresql://postgres@127.0.0.1:!PG_PORT!/ss_erp"
"%NODE_DIR%\node.exe" "%ROOT%\apps\server\node_modules\prisma\build\index.js" migrate deploy > "%LOG_DIR%\migrate.log" 2>&1
if errorlevel 1 (
    echo  Prisma migrate 失败，详见 %LOG_DIR%\migrate.log
    cd /d "%ROOT%"
    "%PG_DIR%\bin\pg_ctl.exe" -D "%DATA_DIR%" stop >nul 2>&1
    pause
    exit /b 1
)
cd /d "%ROOT%"

REM ---------- 5. 启动 server + web ----------
echo  [5/5] 启动服务...
set "NODE_ENV=production"
set "SS_ERP_CONFIG=%ROOT%\config.json"
set "SERVER_PORT=!SERVER_PORT!"
set "PORT=!WEB_PORT!"
set "HOSTNAME=0.0.0.0"

REM 用 PowerShell Start-Process 拿 PID 写文件，stop.bat 读文件停服务
powershell -NoProfile -Command "$p = Start-Process -FilePath '%NODE_DIR%\node.exe' -ArgumentList '\""%ROOT%\apps\server\dist\index.js\"" ' -WorkingDirectory '%ROOT%\apps\server' -WindowStyle Hidden -RedirectStandardOutput '%SERVER_LOG%' -RedirectStandardError '%LOG_DIR%\server.err.log' -PassThru; $p.Id | Out-File -Encoding ascii '%LOG_DIR%\server.pid'"
powershell -NoProfile -Command "$p = Start-Process -FilePath '%NODE_DIR%\node.exe' -ArgumentList @('\""%ROOT%\apps\web\node_modules\next\dist\bin\next\""', 'start', '-p', '!WEB_PORT!', '-H', '0.0.0.0') -WorkingDirectory '%ROOT%\apps\web' -WindowStyle Hidden -RedirectStandardOutput '%WEB_LOG%' -RedirectStandardError '%LOG_DIR%\web.err.log' -PassThru; $p.Id | Out-File -Encoding ascii '%LOG_DIR%\web.pid'"

REM 等 web 起来再开浏览器
set "RETRY=0"
:WAIT_WEB
timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri http://127.0.0.1:!WEB_PORT! -UseBasicParsing -TimeoutSec 1).StatusCode } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    set /a RETRY+=1
    if !RETRY! GEQ 30 (
        echo  Web 服务启动超时，请查看 %WEB_LOG%
        goto :SHOW_INFO
    )
    goto :WAIT_WEB
)

start "" "http://127.0.0.1:!WEB_PORT!"

:SHOW_INFO
echo.
echo  ============================================
echo   启动完成
echo   访问: http://127.0.0.1:!WEB_PORT!
echo   日志: %LOG_DIR%
echo  --------------------------------------------
echo   服务在后台运行，可以直接关闭本窗口
echo   要停止服务请运行 stop.bat
echo  ============================================
echo.
echo  按任意键关闭本窗口（后台服务保持运行）...
pause >nul
endlocal
