param(
    [string]$Version = "0.2.0",
    [string]$OutDir = "",
    [switch]$DryRun,
    [switch]$SkipBuild,
    [switch]$Zip
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\common.ps1"

$root = Get-SSRoot
Set-Location $root

if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path $root "build\windows-local\SS-ERP-Local-runtime-$Version"
} elseif (-not [System.IO.Path]::IsPathRooted($OutDir)) {
    $OutDir = Join-Path $root $OutDir
}

$allowedOutRoot = [System.IO.Path]::GetFullPath((Join-Path $root "build\windows-local")).TrimEnd("\", "/")
$OutDir = [System.IO.Path]::GetFullPath($OutDir)
$allowedOutPrefix = $allowedOutRoot + [System.IO.Path]::DirectorySeparatorChar
if ($OutDir -ne $allowedOutRoot -and -not $OutDir.StartsWith($allowedOutPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "OutDir must stay under $allowedOutRoot to keep package cleanup safe."
}

function Get-SSRuntimeSourceDir {
    param([ValidateSet("node", "pgsql")][string]$Name)

    $candidates = @(
        (Join-Path $root "runtime\$Name"),
        (Join-Path $root "build\runtime\$Name")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    return $null
}

function Assert-SSPostgresRuntimeSourceClean {
    param([string]$Source)

    $forbiddenDirNames = @("data", "pgdata", "log", "logs", "pg_log")
    $forbiddenDir = Get-ChildItem -LiteralPath $Source -Recurse -Force -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -in $forbiddenDirNames } |
        Select-Object -First 1
    if ($forbiddenDir) {
        throw "Refusing to package runtime\pgsql because it contains data/log state directory: $($forbiddenDir.FullName)"
    }

    $pgVersion = Get-ChildItem -LiteralPath $Source -Recurse -Force -File -Filter "PG_VERSION" -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($pgVersion) {
        throw "Refusing to package runtime\pgsql because PostgreSQL data marker was found: $($pgVersion.FullName)"
    }

    $forbiddenFile = Get-ChildItem -LiteralPath $Source -Recurse -Force -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '\.(log|pid|csv)$' -or $_.Name -match '^(postmaster\.opts|postmaster\.pid)$' } |
        Select-Object -First 1
    if ($forbiddenFile) {
        throw "Refusing to package runtime\pgsql because it contains runtime state/log file: $($forbiddenFile.FullName)"
    }
}

$nodeRuntime = Get-SSRuntimeSourceDir "node"
$pgRuntime = Get-SSRuntimeSourceDir "pgsql"

Write-SSInfo "SS ERP Windows local runtime package"
Write-SSInfo "Root: $root"
Write-SSInfo "Output: $OutDir"

if ($DryRun) {
    $nodeRuntimeText = if ($nodeRuntime) { $nodeRuntime } else { "MISSING" }
    $pgRuntimeText = if ($pgRuntime) { $pgRuntime } else { "MISSING" }
    Write-SSInfo "Dry run only. No files will be copied and no build will run."
    Write-Host ""
    Write-Host "Would create runtime-assisted local test package with:" -ForegroundColor Cyan
    Write-Host "- production API: apps/server/dist/index.js"
    Write-Host "- production Web: apps/web/standalone Next server"
    Write-Host "- local extension package: extension/"
    Write-Host "- runtime/node from: $nodeRuntimeText"
    Write-Host "- runtime/pgsql from: $pgRuntimeText"
    Write-Host "- config.json defaults: Web 3003, API 3001, PostgreSQL 5433, REDIS_DISABLED=1, RUN_WORKERS=0"
    Write-Host "- user data dirs: data/pgsql, data/uploads, data/watermarked, data/resized, data/backups"
    Write-Host ""
    Write-Host "No Redis runtime, Docker, cloud service, R2/OSS, SMS or Turnstile dependency is included." -ForegroundColor Cyan
    exit 0
}

if (-not $nodeRuntime -or -not (Test-Path -LiteralPath (Join-Path $nodeRuntime "node.exe"))) {
    throw "Node runtime not found. Put Node.js under runtime\node or build\runtime\node before running package-runtime.ps1."
}
if (-not $pgRuntime -or -not (Test-Path -LiteralPath (Join-Path $pgRuntime "bin\postgres.exe"))) {
    throw "PostgreSQL runtime not found. Put PostgreSQL under runtime\pgsql or build\runtime\pgsql before running package-runtime.ps1."
}
Assert-SSPostgresRuntimeSourceClean $pgRuntime

$pnpm = Get-SSCommandPath "pnpm"
if (-not $pnpm) {
    throw "pnpm not found. The packaging machine still needs pnpm to build the production artifacts."
}

if (-not $SkipBuild) {
    $env:NODE_ENV = ""
    Invoke-SSCheckedCommand $pnpm @("--filter", "server", "build") "Building server production bundle"
    Invoke-SSCheckedCommand $pnpm @("--filter", "server", "db:generate") "Generating Prisma client"

    $env:NEXT_STANDALONE = "1"
    $env:NEXT_PUBLIC_RUNTIME_MODE = "local"
    $env:NEXT_PUBLIC_API_BASE_URL = "http://127.0.0.1:3001"
    $env:NEXT_PUBLIC_WEB_BASE_URL = "http://127.0.0.1:3003"
    $env:NEXT_PUBLIC_TURNSTILE_SITE_KEY = ""
    $env:NEXT_PUBLIC_ADMIN_HOSTNAME = ""
    $env:NEXT_PUBLIC_USER_HOSTNAME = ""
    Invoke-SSCheckedCommand $pnpm @("--filter", "web", "build") "Building web Next standalone bundle"
    Invoke-SSCheckedCommand $pnpm @("build:extension:local") "Building local extension package"
} else {
    Write-SSWarn "Build skipped by -SkipBuild; existing dist/.next/extension artifacts will be used."
}

$serverDist = Join-Path $root "apps\server\dist\index.js"
$webStandalone = Join-Path $root "apps\web\.next\standalone"
$extensionDir = Join-Path $root "build\extensions\ss-erp-local"
if (-not (Test-Path -LiteralPath $serverDist)) { throw "Server dist missing: $serverDist" }
if (-not (Test-Path -LiteralPath $webStandalone)) { throw "Next standalone output missing: $webStandalone. Build with NEXT_STANDALONE=1." }
if (-not (Test-Path -LiteralPath $extensionDir)) { throw "Local extension package missing: $extensionDir" }

if (Test-Path -LiteralPath $OutDir) {
    Remove-Item -LiteralPath $OutDir -Recurse -Force
}
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

Write-SSInfo "Copying runtime/node"
& robocopy $nodeRuntime (Join-Path $OutDir "runtime\node") /E /R:1 /W:1 /NFL /NDL /NJH /NJS /XF "*.log" "*.pid" | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed while copying runtime\node" }
$global:LASTEXITCODE = 0

Write-SSInfo "Copying runtime/pgsql"
& robocopy $pgRuntime (Join-Path $OutDir "runtime\pgsql") /E /R:1 /W:1 /NFL /NDL /NJH /NJS /XF "*.log" "*.pid" "*.csv" | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed while copying runtime\pgsql" }
$global:LASTEXITCODE = 0

Write-SSInfo "Deploying server production dependencies"
$tmpServerDeploy = Join-Path $root "build\tmp-windows-runtime-server"
if (Test-Path -LiteralPath $tmpServerDeploy) {
    Remove-Item -LiteralPath $tmpServerDeploy -Recurse -Force
}
Invoke-SSCheckedCommand $pnpm @("--filter=server", "deploy", "--legacy", "--prod", $tmpServerDeploy) "Deploying server package"

$serverOut = Join-Path $OutDir "apps\server"
New-Item -ItemType Directory -Path $serverOut -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $tmpServerDeploy "dist") -Destination $serverOut -Recurse -Force
Copy-Item -LiteralPath (Join-Path $tmpServerDeploy "node_modules") -Destination $serverOut -Recurse -Force
Copy-Item -LiteralPath (Join-Path $tmpServerDeploy "prisma") -Destination $serverOut -Recurse -Force
Copy-Item -LiteralPath (Join-Path $tmpServerDeploy "package.json") -Destination $serverOut -Force
Remove-Item -LiteralPath $tmpServerDeploy -Recurse -Force
foreach ($dir in @("public\uploads", "public\watermarked", "public\resized")) {
    New-Item -ItemType Directory -Path (Join-Path $serverOut $dir) -Force | Out-Null
}

Write-SSInfo "Copying web standalone"
$webOut = Join-Path $OutDir "apps\web\standalone"
& robocopy $webStandalone $webOut /E /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed while copying web standalone" }
$global:LASTEXITCODE = 0

$webRuntimeRoot = Join-Path $webOut "apps\web"
if (-not (Test-Path -LiteralPath (Join-Path $webRuntimeRoot "server.js"))) {
    $webRuntimeRoot = $webOut
}
$staticSource = Join-Path $root "apps\web\.next\static"
if (Test-Path -LiteralPath $staticSource) {
    & robocopy $staticSource (Join-Path $webRuntimeRoot ".next\static") /E /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed while copying web static assets" }
    $global:LASTEXITCODE = 0
}
$publicSource = Join-Path $root "apps\web\public"
if (Test-Path -LiteralPath $publicSource) {
    & robocopy $publicSource (Join-Path $webRuntimeRoot "public") /E /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed while copying web public assets" }
    $global:LASTEXITCODE = 0
}
if (-not (Test-Path -LiteralPath (Join-Path $webRuntimeRoot "server.js"))) {
    throw "Packaged Next server.js missing under $webOut"
}

Write-SSInfo "Copying local extension and runtime scripts"
& robocopy $extensionDir (Join-Path $OutDir "extension") /E /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed while copying extension" }
$global:LASTEXITCODE = 0

$scriptOut = Join-Path $OutDir "scripts\windows-local"
New-Item -ItemType Directory -Path $scriptOut -Force | Out-Null
foreach ($script in @("common.ps1", "start-runtime.ps1", "stop-runtime.ps1", "backup.ps1", "restore.ps1")) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $script) -Destination (Join-Path $scriptOut $script) -Force
}

foreach ($dir in @("data", "data\pgsql", "data\uploads", "data\watermarked", "data\resized", "data\backups", "logs", "logs\windows-local")) {
    New-Item -ItemType Directory -Path (Join-Path $OutDir $dir) -Force | Out-Null
}

New-SSRuntimeConfigFile (Join-Path $OutDir "config.json")

$startBat = @"
@echo off
set "ROOT=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\windows-local\start-runtime.ps1"
if errorlevel 1 pause
"@
$stopBat = @"
@echo off
set "ROOT=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\windows-local\stop-runtime.ps1"
if errorlevel 1 pause
"@
$backupBat = @"
@echo off
set "ROOT=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\windows-local\backup.ps1" -ConfigFile "%ROOT%config.json"
if errorlevel 1 pause
"@
$restoreBat = @"
@echo off
set "ROOT=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\windows-local\restore.ps1" -ConfigFile "%ROOT%config.json" -Latest
if errorlevel 1 pause
"@
Set-Content -LiteralPath (Join-Path $OutDir "start.bat") -Value $startBat -Encoding ASCII
Set-Content -LiteralPath (Join-Path $OutDir "stop.bat") -Value $stopBat -Encoding ASCII
Set-Content -LiteralPath (Join-Path $OutDir "backup.bat") -Value $backupBat -Encoding ASCII
Set-Content -LiteralPath (Join-Path $OutDir "restore-latest.bat") -Value $restoreBat -Encoding ASCII

$readme = @"
SS ERP Local Runtime Package v$Version

Start:
1. Extract this directory.
2. Double-click start.bat.
3. Open http://127.0.0.1:3003 if the browser does not open automatically.

Stop:
- Double-click stop.bat.

Backup:
- Double-click backup.bat. Backups are written to data/backups.

Restore:
- restore-latest.bat prints the restore safety warning. Re-run the PowerShell command with -ConfirmRestore only after confirming the latest backup is the one you want.

Default mode:
- Node runtime is bundled under runtime/node.
- PostgreSQL runtime is bundled under runtime/pgsql and stores data under data/pgsql.
- Redis is disabled by default. Worker queues are not started.
- Images are stored under data/uploads, data/watermarked and data/resized.
- OSS/R2, SMS and Turnstile are not required.

Advanced settings:
- Edit config.json before start.
"@
Set-Content -LiteralPath (Join-Path $OutDir "README.txt") -Value $readme -Encoding UTF8

Write-SSOk "Runtime package created: $OutDir"

if ($Zip) {
    $zipPath = "$OutDir.zip"
    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }
    Compress-Archive -Path $OutDir -DestinationPath $zipPath -CompressionLevel Optimal
    Write-SSOk "Zip created: $zipPath"
}
