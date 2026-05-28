@echo off
REM ============================================================
REM  SS ERP 数据恢复
REM  用途：从 backups\ 目录的 .sql 文件恢复 ss_erp 库
REM  警告：会覆盖当前数据库！
REM ============================================================

setlocal EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

set "ROOT=%cd%"
set "NODE_DIR=%ROOT%\runtime\node"
set "PG_DIR=%ROOT%\runtime\pgsql"
set "BACKUP_DIR=%ROOT%\backups"

echo.
echo  ============================================
echo   SS ERP 数据恢复
echo  ============================================
echo.

if not exist "%BACKUP_DIR%" (
    echo  备份目录不存在: %BACKUP_DIR%
    pause
    exit /b 1
)

REM 读 config.json 端口
for /f "usebackq tokens=*" %%i in (`"%NODE_DIR%\node.exe" -e "const c=require('./config.json');console.log(c.pgPort||5433)"`) do set "PG_PORT=%%i"

REM 检查 PG 是否在运行
"%PG_DIR%\bin\pg_isready.exe" -p !PG_PORT! -h 127.0.0.1 -t 2 >nul 2>&1
if errorlevel 1 (
    echo  PostgreSQL 未运行，请先启动 start.bat
    pause
    exit /b 1
)

REM 列出可用备份
echo  可用备份文件：
echo.
set "I=0"
for /f "delims=" %%F in ('dir /b /o-d "%BACKUP_DIR%\*.sql" 2^>nul') do (
    set /a I+=1
    set "FILE_!I!=%%F"
    echo    !I!. %%F
)

if !I!==0 (
    echo  没有找到备份文件
    pause
    exit /b 1
)

echo.
set /p CHOICE="请输入要恢复的编号 (1-!I!，或 q 退出): "

if /i "!CHOICE!"=="q" exit /b 0

REM 校验输入
if "!CHOICE!"=="" (
    echo  无效输入
    pause
    exit /b 1
)

set "TARGET=!FILE_%CHOICE%!"
if "!TARGET!"=="" (
    echo  无效编号
    pause
    exit /b 1
)

set "BACKUP_FILE=%BACKUP_DIR%\!TARGET!"

echo.
echo  即将从 !TARGET! 恢复数据
echo  警告：当前 ss_erp 库的所有数据会被清空并替换！
echo.
set /p CONFIRM="确认继续？输入 YES 继续: "
if not "!CONFIRM!"=="YES" (
    echo  已取消
    pause
    exit /b 0
)

echo.
echo  [1/3] 删除现有数据库...
"%PG_DIR%\bin\dropdb.exe" -h 127.0.0.1 -p !PG_PORT! -U postgres ss_erp 2>nul

echo  [2/3] 创建新数据库...
"%PG_DIR%\bin\createdb.exe" -h 127.0.0.1 -p !PG_PORT! -U postgres ss_erp
if errorlevel 1 (
    echo  创建数据库失败
    pause
    exit /b 1
)

echo  [3/3] 导入数据...
"%PG_DIR%\bin\psql.exe" -h 127.0.0.1 -p !PG_PORT! -U postgres -d ss_erp -f "!BACKUP_FILE!" -q
if errorlevel 1 (
    echo.
    echo  恢复失败
    pause
    exit /b 1
)

echo.
echo  ============================================
echo   恢复完成
echo   建议重启服务: stop.bat ^&^& start.bat
echo  ============================================
echo.
pause
endlocal
