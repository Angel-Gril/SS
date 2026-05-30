# SS ERP Windows 打包脚本
# 用途：把 apps/web、apps/server、runtime、扩展、启动器 组装成 dist/SS-ERP-<version>/
# 用法：在仓库根目录运行 powershell -File build/scripts/build-windows.ps1
#       可选参数 -Version 1.0.0  -SkipBuild 跳过编译用现有产物
#       -Zip 同时生成 .zip
param(
    [string]$Version = "1.0.0",
    [switch]$SkipBuild,
    [switch]$Zip
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path "$PSScriptRoot/../..").Path
$buildDir = Join-Path $root "build"
$dist = Join-Path $buildDir "dist"
$out = Join-Path $dist "SS-ERP-$Version"

Write-Host "==== SS ERP 打包 v$Version ====" -ForegroundColor Cyan
Write-Host "仓库根: $root"
Write-Host "输出目录: $out"
Write-Host ""

# ---------- 0. 清理旧产物 ----------
if (Test-Path $out) {
    Write-Host "清理旧产物..."
    Remove-Item -Recurse -Force $out
}
New-Item -ItemType Directory -Path $out | Out-Null

# ---------- 1. 编译 server + web ----------
if (-not $SkipBuild) {
    Write-Host "[0/6] 确保依赖完整..." -ForegroundColor Yellow
    Push-Location $root
    # 显式装齐 dev deps（pnpm 会在 build 时自动 reinstall，且按 NODE_ENV 决定要不要装 dev）
    # 在这里 NODE_ENV 不设，确保 tsup/next 在
    $env:NODE_ENV = ""
    & pnpm install --config.confirmModulesPurge=false 2>&1 | Out-Null
    Pop-Location
    if ($LASTEXITCODE -ne 0) { throw "pnpm install 失败" }
    $global:LASTEXITCODE = 0

    Write-Host "[1/6] 编译 server (tsup)..." -ForegroundColor Yellow
    Push-Location (Join-Path $root "apps/server")
    # Pre-clean dist using robocopy mirror (defensive — in case junctions leaked in)
    $serverDistDir = Join-Path $root "apps/server/dist"
    if (Test-Path $serverDistDir) {
        $emptyTmp = Join-Path $env:TEMP "__empty_dist_$(Get-Random)"
        New-Item -ItemType Directory -Path $emptyTmp -Force | Out-Null
        & robocopy $emptyTmp $serverDistDir /MIR /NFL /NDL /NJH /NJS /R:1 /W:1 2>&1 | Out-Null
        Remove-Item $emptyTmp -Force -ErrorAction SilentlyContinue
        Remove-Item $serverDistDir -Recurse -Force -ErrorAction SilentlyContinue
        $global:LASTEXITCODE = 0
    }
    pnpm run build
    if ($LASTEXITCODE -ne 0) { throw "server build 失败" }
    pnpm prisma generate
    if ($LASTEXITCODE -ne 0) { throw "prisma generate 失败" }
    Pop-Location

    Write-Host "[2/6] 编译 web (next build)..." -ForegroundColor Yellow
    Push-Location (Join-Path $root "apps/web")
    # Pre-clean .next using robocopy mirror trick — next's recursive-delete chokes on junctions
    $nextDir = Join-Path $root "apps/web/.next"
    if (Test-Path $nextDir) {
        $emptyTmp = Join-Path $env:TEMP "__empty_next_$(Get-Random)"
        New-Item -ItemType Directory -Path $emptyTmp -Force | Out-Null
        & robocopy $emptyTmp $nextDir /MIR /NFL /NDL /NJH /NJS /R:1 /W:1 2>&1 | Out-Null
        Remove-Item $emptyTmp -Force -ErrorAction SilentlyContinue
        Remove-Item $nextDir -Recurse -Force -ErrorAction SilentlyContinue
        $global:LASTEXITCODE = 0
    }
    # 构建时注入 API 地址（前端 NEXT_PUBLIC_* 在 build 时内联）
    $env:NEXT_PUBLIC_API_BASE_URL = "http://127.0.0.1:3401"
    $env:NEXT_PUBLIC_RUNTIME_MODE = "local"
    $env:NEXT_PUBLIC_TURNSTILE_SITE_KEY = ""
    pnpm run build
    if ($LASTEXITCODE -ne 0) { throw "web build 失败" }
    Pop-Location
} else {
    Write-Host "[1-2/6] 跳过编译 (-SkipBuild)" -ForegroundColor DarkGray
}

# ---------- 3. 拷贝 server ----------
Write-Host "[3/6] 收集 server..." -ForegroundColor Yellow
$serverOut = Join-Path $out "apps/server"
New-Item -ItemType Directory -Path $serverOut -Force | Out-Null

# pnpm deploy --legacy 把 server 包 + 生产依赖装到独立目录
# 它会把 server 包整体拷到 .pnpm/node_modules/server，含源码、public 等
# 我们用完后手动剥离非必需文件
Push-Location (Join-Path $root "apps/server")
$tmpDeploy = Join-Path $buildDir "tmp-server-deploy"
if (Test-Path $tmpDeploy) { Remove-Item -Recurse -Force $tmpDeploy }
pnpm deploy --legacy --prod --filter=server $tmpDeploy 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path "$tmpDeploy/node_modules")) {
    Pop-Location
    throw "pnpm deploy 失败：$tmpDeploy"
}
Pop-Location

# 拷 dist + node_modules + prisma + package.json
Copy-Item -Recurse -Force "$tmpDeploy/dist" $serverOut
Copy-Item -Recurse -Force "$tmpDeploy/node_modules" $serverOut
Copy-Item -Recurse -Force "$tmpDeploy/prisma" $serverOut
Copy-Item -Force "$tmpDeploy/package.json" $serverOut
Remove-Item -Recurse -Force $tmpDeploy

# 修复 pnpm deploy 解引用 symlink 导致的依赖网破损
# Fix pnpm deploy --prod dereferencing top-level symlinks (transitive deps go missing)
# Solution: convert top-level entries back to junctions pointing into .pnpm/<pkg>/node_modules/<pkg>
Write-Host "  - rebuild server node_modules junction..." -ForegroundColor DarkGray
$serverNm2 = Join-Path $serverOut "node_modules"
$serverPnpm = Join-Path $serverNm2 ".pnpm"
$serverPnpmDirs = @(Get-ChildItem $serverPnpm -Directory -ErrorAction SilentlyContinue)

function Find-PnpmPkgPath {
    param($name, $pnpmDirs)
    $expectedPrefix = if ($name -match '^@') { ($name -replace '/', '+') + '@' } else { "$name@" }
    $candidates = $pnpmDirs | Where-Object { $_.Name -like "$expectedPrefix*" }
    if (-not $candidates) { return $null }
    $best = $candidates | Sort-Object { $_.Name.Length } | Select-Object -First 1
    $pkgPath = Join-Path $best.FullName "node_modules\$name"
    if (Test-Path $pkgPath) { return $pkgPath }
    return $null
}

$convertedCount = 0
$topItems = Get-ChildItem $serverNm2 -Force | Where-Object {
    $_.PSIsContainer -and $_.Name -notin @('.pnpm','.bin','.cache','.modules.yaml','@types')
}
foreach ($it in $topItems) {
    if ($it.Name -like '@*') {
        # @scope namespace
        foreach ($child in (Get-ChildItem $it.FullName -Force)) {
            $pkgName = "$($it.Name)/$($child.Name)"
            $real = Find-PnpmPkgPath $pkgName $serverPnpmDirs
            if (-not $real) { continue }
            Remove-Item $child.FullName -Recurse -Force -ErrorAction SilentlyContinue
            cmd /c "mklink /J `"$($child.FullName)`" `"$real`"" 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) { $convertedCount++ }
        }
        continue
    }
    # workspace package keep as real dir
    if ($it.Name -eq 'shared') { continue }
    $real = Find-PnpmPkgPath $it.Name $serverPnpmDirs
    if (-not $real) { continue }
    Remove-Item $it.FullName -Recurse -Force -ErrorAction SilentlyContinue
    cmd /c "mklink /J `"$($it.FullName)`" `"$real`"" 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $convertedCount++ }
}
Write-Host "    junction: $convertedCount" -ForegroundColor DarkGray

# 补齐 .pnpm/node_modules/ 下所有未 hoist 到顶层的包
# pnpm deploy 的 hoisting 不完整，很多传递依赖只在 .pnpm/node_modules/ 里
$pnpmNodeModules = Join-Path $serverNm2 ".pnpm/node_modules"
if (Test-Path $pnpmNodeModules) {
    Get-ChildItem $pnpmNodeModules -Force -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.Name -in @('.bin','.pnpm','.modules.yaml','.cache')) { return }
        if ($_.Name -like '@*') {
            Get-ChildItem $_.FullName -Force -Directory | ForEach-Object {
                $scopedTarget = Join-Path $serverNm2 "$($_.Parent.Name)/$($_.Name)"
                if (-not (Test-Path $scopedTarget)) {
                    $parent = Split-Path $scopedTarget -Parent
                    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
                    cmd /c "mklink /J `"$scopedTarget`" `"$($_.FullName)`"" 2>&1 | Out-Null
                }
            }
        } else {
            $target = Join-Path $serverNm2 $_.Name
            if (-not (Test-Path $target)) {
                cmd /c "mklink /J `"$target`" `"$($_.FullName)`"" 2>&1 | Out-Null
            }
        }
    }
}
# Copy .prisma/client (Prisma generate output, required at runtime)
# 顺序：先把源仓库 .pnpm 中已 generate 的 .prisma/client 拷到 dist 的 .pnpm 同位置，
# 然后在 node_modules 顶层建 junction 指向它，让 require('.prisma/client') 能解析
$rootPnpm = Join-Path $root "node_modules/.pnpm"
$srcDotPrisma = Get-ChildItem $rootPnpm -Filter "@prisma+client@*" -Directory -ErrorAction SilentlyContinue |
    Select-Object -First 1 |
    ForEach-Object { Join-Path $_.FullName "node_modules/.prisma" }
$dstPnpmPcDir = Get-ChildItem $serverPnpm -Filter "@prisma+client@*" -Directory -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($srcDotPrisma -and (Test-Path $srcDotPrisma) -and $dstPnpmPcDir) {
    $dstDotPrisma = Join-Path $dstPnpmPcDir.FullName "node_modules/.prisma"
    if (-not (Test-Path $dstDotPrisma)) {
        Write-Host "  - copy .prisma/client..." -ForegroundColor DarkGray
        & robocopy $srcDotPrisma $dstDotPrisma /E /NFL /NDL /NJH /NJS `
            /XF "libquery_engine-*.so*" "libquery_engine-*.dylib*" `
                "schema-engine-linux*" "schema-engine-darwin*" `
                "query_engine-linux*" "query_engine-darwin*" `
                "prisma-fmt-linux*" "prisma-fmt-darwin*" 2>&1 | Out-Null
        $global:LASTEXITCODE = 0
    }
    # 顶层 node_modules/.prisma -> .pnpm/@prisma+client@*/node_modules/.prisma
    $topDotPrisma = Join-Path $serverNm2 ".prisma"
    if ((Test-Path $dstDotPrisma) -and -not (Test-Path $topDotPrisma)) {
        cmd /c "mklink /J `"$topDotPrisma`" `"$dstDotPrisma`"" 2>&1 | Out-Null
        Write-Host "    junction: node_modules/.prisma" -ForegroundColor DarkGray
    }
}

# 剥离 .pnpm/node_modules/server 里的源代码垃圾（pnpm deploy 会把整个包链过来）
$pnpmServerDir = Join-Path $serverOut "node_modules/.pnpm/node_modules/server"
if (Test-Path $pnpmServerDir) {
    Write-Host "  - 剥离 server 源码副本..." -ForegroundColor DarkGray
    foreach ($drop in @("public", "src", ".env", ".env.local", ".env.production", "tsup.config.ts", "tsconfig.json", "scripts", "test", "tests", "__tests__")) {
        $p = Join-Path $pnpmServerDir $drop
        if (Test-Path $p) { Remove-Item -Recurse -Force $p -ErrorAction SilentlyContinue }
    }
}

# 删 typescript（被 prisma deps 拖进来，但运行不需要）
Get-ChildItem -Path (Join-Path $serverOut "node_modules") -Recurse -Force -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq "typescript" -and $_.FullName -like "*node_modules\typescript" } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

# 清理非 Windows 平台的 Prisma engines + sharp 二进制
Write-Host "  - 清理跨平台二进制..." -ForegroundColor DarkGray
$serverNm = Join-Path $serverOut "node_modules"
Get-ChildItem -Path $serverNm -Recurse -Force -File -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -match 'libquery_engine-.*\.(so|dylib)' -or
        $_.Name -match '^(schema|migration|introspection)-engine-(linux|darwin|debian|rhel|alpine|musl)' -or
        $_.Name -match '^prisma-fmt-(linux|darwin|debian|rhel|alpine|musl)' -or
        $_.Name -match '^query_engine-(linux|darwin|debian|rhel|alpine|musl)\.'
    } |
    Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path $serverNm -Recurse -Force -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^@img.+sharp-(linux|linuxmusl|darwin)' -or $_.Name -match '^sharp-(linux|linuxmusl|darwin)' } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue


# ---------- 4. 拷贝 web ----------
Write-Host "[4/6] 收集 web (next start mode)..." -ForegroundColor Yellow
$webOut = Join-Path $out "apps/web"
New-Item -ItemType Directory -Path $webOut -Force | Out-Null

# pnpm deploy 把 web 包+生产依赖打成独立目录
Push-Location (Join-Path $root "apps/web")
$tmpWebDeploy = Join-Path $buildDir "tmp-web-deploy"
if (Test-Path $tmpWebDeploy) { Remove-Item -Recurse -Force $tmpWebDeploy }
pnpm deploy --legacy --prod --filter=web $tmpWebDeploy 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path "$tmpWebDeploy/node_modules")) {
    Pop-Location
    throw "pnpm deploy (web) 失败：$tmpWebDeploy"
}
Pop-Location

# 拷贝 .next（已 build）+ public + package.json + node_modules
Copy-Item -Force "$tmpWebDeploy/package.json" $webOut
& robocopy (Join-Path $root "apps/web/.next") (Join-Path $webOut ".next") /E /R:0 /W:0 /NFL /NDL /NJH /NJS 2>&1 | Out-Null
$global:LASTEXITCODE = 0
if (Test-Path (Join-Path $root "apps/web/public")) {
    & robocopy (Join-Path $root "apps/web/public") (Join-Path $webOut "public") /E /R:0 /W:0 /NFL /NDL /NJH /NJS 2>&1 | Out-Null
    $global:LASTEXITCODE = 0
}
& robocopy "$tmpWebDeploy/node_modules" (Join-Path $webOut "node_modules") /E /R:0 /W:0 /NFL /NDL /NJH /NJS 2>&1 | Out-Null
$global:LASTEXITCODE = 0
Remove-Item -Recurse -Force $tmpWebDeploy -ErrorAction SilentlyContinue

# 验证
if (-not (Test-Path (Join-Path $webOut ".next/BUILD_ID"))) { throw "web 打包失败：.next/BUILD_ID 缺失" }
if (-not (Test-Path (Join-Path $webOut "node_modules/next"))) { throw "web 打包失败：node_modules/next 缺失" }

# 剥离 .pnpm/node_modules/web 源码副本（pnpm deploy 把整个 workspace 包链过来）
$pnpmWebDir = Join-Path $webOut "node_modules/.pnpm/node_modules/web"
if (Test-Path $pnpmWebDir) {
    Write-Host "  - 剥离 web 源码副本..." -ForegroundColor DarkGray
    foreach ($drop in @("public", "src", ".env", ".env.local", ".env.production", "next.config.mjs", "tailwind.config.ts", "tsconfig.json", "scripts", "test", "tests", "__tests__", ".next")) {
        $p = Join-Path $pnpmWebDir $drop
        if (Test-Path $p) { Remove-Item -Recurse -Force $p -ErrorAction SilentlyContinue }
    }
}

# 清理 web 跨平台二进制：sharp / @next/swc / @img sharp-libvips / @rollup
Write-Host "  - 清理 web 跨平台二进制..." -ForegroundColor DarkGray
$webNm = Join-Path $webOut "node_modules"
Get-ChildItem -Path $webNm -Recurse -Force -Directory -ErrorAction SilentlyContinue |
    Where-Object {
        $n = $_.Name
        ($n -match '^@img.+sharp-(linux|linuxmusl|darwin|wasm32)') -or
        ($n -match '^sharp-(linux|linuxmusl|darwin|wasm32)') -or
        ($n -match '^@next\+swc-(linux|darwin)') -or
        ($n -match '^swc-(linux|darwin)') -or
        ($n -match '^@rollup\+rollup-(linux|darwin|freebsd|android|wasm)') -or
        ($n -match '^rollup-(linux|darwin|freebsd|android|wasm)')
    } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
# 清理 .pnpm 目录内同名跨平台模块
Get-ChildItem -Path (Join-Path $webNm ".pnpm") -Force -Directory -ErrorAction SilentlyContinue |
    Where-Object {
        $n = $_.Name
        ($n -match '^@img\+sharp-(linux|linuxmusl|darwin|wasm32)') -or
        ($n -match '^@next\+swc-(linux|darwin)') -or
        ($n -match '^@rollup\+rollup-(linux|darwin|freebsd|android|wasm)')
    } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue


Write-Host "[5/6] 组装 runtime/扩展/脚本..." -ForegroundColor Yellow

$runtimeSrc = Join-Path $buildDir "runtime"
if (-not (Test-Path "$runtimeSrc/node/node.exe")) { throw "缺少 runtime/node/node.exe" }
if (-not (Test-Path "$runtimeSrc/pgsql/bin/postgres.exe")) { throw "缺少 runtime/pgsql/bin/postgres.exe" }
Copy-Item -Recurse -Force $runtimeSrc (Join-Path $out "runtime")

# 扩展
$extOut = Join-Path $out "extension"
New-Item -ItemType Directory -Path $extOut -Force | Out-Null
Copy-Item -Recurse -Force (Join-Path $root "extensions/ss-erp/*") $extOut

# Launcher scripts (force CRLF — without it cmd loses first char of each line)
foreach ($bat in @("start.bat","stop.bat","backup.bat","restore.bat")) {
    $batSrc = Join-Path $buildDir "scripts/$bat"
    $batDst = Join-Path $out $bat
    $batContent = [System.IO.File]::ReadAllText($batSrc)
    $batCRLF = $batContent -replace "`r`n","`n" -replace "`n","`r`n"
    [System.IO.File]::WriteAllText($batDst, $batCRLF, (New-Object System.Text.UTF8Encoding $false))
}
# fix-links.js（首次启动修复 junction）
Copy-Item -Force (Join-Path $buildDir "scripts/fix-links.js") (Join-Path $out "fix-links.js")

# config.json 模板
$jwtSecret = -join ((1..48) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
$encryptionKey = -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
$configContent = @"
{
  "webPort": 3400,
  "serverPort": 3401,
  "pgPort": 5433,
  "databaseUrl": "postgresql://postgres@127.0.0.1:5433/ss_erp",
  "jwtSecret": "$jwtSecret",
  "encryptionKey": "$encryptionKey",
  "corsOrigin": "http://127.0.0.1:3400",
  "redisDisabled": true,
  "uploadDir": "./data/uploads",
  "httpsProxy": ""
}
"@
[System.IO.File]::WriteAllText((Join-Path $out "config.json"), $configContent, (New-Object System.Text.UTF8Encoding $false))

# README
$readme = @"
SS ERP 跨境电商管理系统 v$Version

【快速开始】
1. 解压本目录到不含中文/空格的英文路径（如 D:\SS-ERP）
2. 双击 start.bat 启动
3. 浏览器自动打开 http://127.0.0.1:3400
4. 首次启动会引导初始化超级管理员
5. 关闭：双击 stop.bat

【浏览器扩展安装】
1. 打开 Chrome -> 扩展程序 -> 开发者模式 -> 加载已解压的扩展
2. 选择本目录下 extension 文件夹

【目录说明】
- apps/         应用代码
- runtime/      Node + PostgreSQL 便携版
- extension/    浏览器扩展（手动加载）
- data/         数据库文件（首次启动自动创建）
- logs/         运行日志
- config.json   端口/数据库配置
"@
[System.IO.File]::WriteAllText((Join-Path $out "README.txt"), $readme, (New-Object System.Text.UTF8Encoding $false))

# 空 logs 目录占位
New-Item -ItemType Directory -Path (Join-Path $out "logs") -Force | Out-Null

# ---------- 6. 打 zip ----------
if ($Zip) {
    Write-Host "[6/6] 生成 zip..." -ForegroundColor Yellow
    $zipPath = Join-Path $dist "SS-ERP-$Version.zip"
    if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
    Compress-Archive -Path $out -DestinationPath $zipPath -CompressionLevel Optimal
    Write-Host "zip: $zipPath ($([math]::Round((Get-Item $zipPath).Length / 1MB, 1)) MB)" -ForegroundColor Green
} else {
    Write-Host "[6/6] 跳过 zip (-Zip 启用)" -ForegroundColor DarkGray
}

# ---------- 总结 ----------
$totalSize = [math]::Round((Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Host ""
Write-Host "==== 打包完成 ====" -ForegroundColor Green
Write-Host "目录: $out"
Write-Host "大小: $totalSize MB"
Write-Host ""
Write-Host "测试启动: cd '$out'; .\start.bat"
