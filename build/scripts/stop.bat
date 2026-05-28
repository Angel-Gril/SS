@echo off
REM SS ERP 停止脚本
chcp 65001 >nul
cd /d "%~dp0"

set "ROOT=%cd%"
set "PG_DIR=%ROOT%\runtime\pgsql"
set "DATA_DIR=%ROOT%\data"
set "LOG_DIR=%ROOT%\logs"

echo.
echo  停止 SS ERP 服务...

REM 按 PID 文件停 server / web
for %%F in (server.pid web.pid) do (
    if exist "%LOG_DIR%\%%F" (
        for /f %%P in ('type "%LOG_DIR%\%%F"') do (
            taskkill /PID %%P /T /F >nul 2>&1
        )
        del /q "%LOG_DIR%\%%F" >nul 2>&1
    )
)

REM 关 PG
if exist "%DATA_DIR%\PG_VERSION" (
    "%PG_DIR%\bin\pg_ctl.exe" -D "%DATA_DIR%" stop -m fast >nul 2>&1
)

echo  已停止
timeout /t 2 /nobreak >nul
