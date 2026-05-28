@echo off
REM ============================================================
REM  SS ERP 数据备份
REM  用途：用 pg_dump 把整个 ss_erp 库导出成 sql 文件
REM  输出：backups\ss_erp-YYYYMMDD-HHMMSS.sql
REM ============================================================

setlocal EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

set "ROOT=%cd%"
set "NODE_DIR=%ROOT%\runtime\node"
set "PG_DIR=%ROOT%\runtime\pgsql"
set "BACKUP_DIR=%ROOT%\backups"
set "LOG_DIR=%ROOT%\logs"

if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo.
echo  ============================================
echo   SS ERP 数据备份
echo  ============================================
echo.

REM 读 config.json 端口
for /f "usebackq tokens=*" %%i in (`"%NODE_DIR%\node.exe" -e "const c=require('./config.json');console.log(c.pgPort||5433)"`) do set "PG_PORT=%%i"

REM 检查 PG 是否在运行
"%PG_DIR%\bin\pg_isready.exe" -p !PG_PORT! -h 127.0.0.1 -t 2 >nul 2>&1
if errorlevel 1 (
    echo  PostgreSQL 未运行，请先启动 start.bat
    pause
    exit /b 1
)

REM 生成时间戳文件名
for /f "usebackq tokens=*" %%i in (`"%NODE_DIR%\node.exe" -e "const d=new Date();const p=n=>String(n).padStart(2,'0');console.log(d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds()))"`) do set "STAMP=%%i"

set "BACKUP_FILE=%BACKUP_DIR%\ss_erp-!STAMP!.sql"

echo  备份到: !BACKUP_FILE!
echo.

"%PG_DIR%\bin\pg_dump.exe" -h 127.0.0.1 -p !PG_PORT! -U postgres -d ss_erp -F p --no-owner --no-acl -f "!BACKUP_FILE!"
if errorlevel 1 (
    echo.
    echo  备份失败
    pause
    exit /b 1
)

REM 显示文件大小
for %%A in ("!BACKUP_FILE!") do set "SIZE=%%~zA"
set /a SIZE_KB=!SIZE! / 1024

echo.
echo  ============================================
echo   备份完成
echo   文件: !BACKUP_FILE!
echo   大小: !SIZE_KB! KB
echo  ============================================
echo.
pause
endlocal
