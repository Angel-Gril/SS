param(
    [string]$Version = "0.1.0",
    [string]$OutDir = "",
    [switch]$DryRun,
    [switch]$Zip,
    [switch]$IncludeRuntime
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\common.ps1"

$root = Get-SSRoot
Set-Location $root

if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path $root "build\windows-local\SS-ERP-local-$Version"
} elseif (-not [System.IO.Path]::IsPathRooted($OutDir)) {
    $OutDir = Join-Path $root $OutDir
}

$allowedOutRoot = [System.IO.Path]::GetFullPath((Join-Path $root "build\windows-local")).TrimEnd("\", "/")
$OutDir = [System.IO.Path]::GetFullPath($OutDir)
$allowedOutPrefix = $allowedOutRoot + [System.IO.Path]::DirectorySeparatorChar
if ($OutDir -ne $allowedOutRoot -and -not $OutDir.StartsWith($allowedOutPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "OutDir must stay under $allowedOutRoot to keep package cleanup safe."
}

$excludeDirs = @(
    ".git",
    "node_modules",
    ".pnpm-store",
    "runtime",
    "build\dist",
    "build\extensions",
    "build\runtime",
    "build\windows-local",
    "data",
    "logs",
    "backups",
    "apps\server\public\uploads",
    "apps\server\public\watermarked",
    "apps\server\public\resized",
    "apps\web\.next",
    "apps\server\dist"
)

$excludeFiles = @(
    ".env*",
    "*.log",
    "*.pid",
    "*.zip",
    "*.7z",
    "*.tar",
    "*.tar.gz"
)

Write-SSInfo "SS ERP Windows local package"
Write-SSInfo "Root: $root"
Write-SSInfo "Output: $OutDir"

if ($DryRun) {
    Write-SSInfo "Dry run only. No files will be copied."
    Write-Host ""
    Write-Host "Would create portable source package with:" -ForegroundColor Cyan
    Write-Host "- repository source"
    Write-Host "- scripts/windows-local"
    Write-Host "- .env.local-windows.example"
    Write-Host "- docs/local-windows-package.md"
    if ($IncludeRuntime) {
        Write-Host "- runtime/node and runtime/pgsql if present (Redis is still not bundled)"
    } else {
        Write-Host "- no node_modules, no Node runtime, no PostgreSQL runtime, no Redis runtime"
    }
    Write-Host ""
    Write-Host "Excluded directories:" -ForegroundColor Cyan
    $excludeDirs | ForEach-Object { Write-Host "- $_" }
    Write-Host ""
    Write-Host "Excluded files:" -ForegroundColor Cyan
    $excludeFiles | ForEach-Object { Write-Host "- $_" }
    exit 0
}

if (Test-Path -LiteralPath $OutDir) {
    Remove-Item -LiteralPath $OutDir -Recurse -Force
}
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

$robocopyArgs = @(
    $root,
    $OutDir,
    "/MIR",
    "/R:1",
    "/W:1",
    "/NFL",
    "/NDL",
    "/NJH",
    "/NJS",
    "/XD"
) + ($excludeDirs | ForEach-Object { Join-Path $root $_ }) + @("/XF") + $excludeFiles

Write-SSInfo "Copying portable source tree..."
& robocopy @robocopyArgs | Out-Null
$robocopyExitCode = $LASTEXITCODE
if ($robocopyExitCode -ge 8) {
    throw "robocopy failed with exit code $robocopyExitCode"
}
$global:LASTEXITCODE = 0

Get-ChildItem -LiteralPath $root -Filter ".env*.example" -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $OutDir $_.Name) -Force
}

if ($IncludeRuntime) {
    foreach ($runtimePart in @("node", "pgsql")) {
        $source = Join-Path $root "runtime\$runtimePart"
        if (-not (Test-Path -LiteralPath $source)) {
            Write-SSWarn "Optional runtime not found, skipped: runtime\$runtimePart"
            continue
        }

        if ($runtimePart -eq "pgsql") {
            $forbiddenDirNames = @("data", "pgdata", "log", "logs", "pg_log")
            $forbiddenDir = Get-ChildItem -LiteralPath $source -Recurse -Force -Directory -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -in $forbiddenDirNames } |
                Select-Object -First 1
            if ($forbiddenDir) {
                throw "Refusing to package runtime\pgsql because it contains data/log state directory: $($forbiddenDir.FullName)"
            }

            $pgVersion = Get-ChildItem -LiteralPath $source -Recurse -Force -File -Filter "PG_VERSION" -ErrorAction SilentlyContinue |
                Select-Object -First 1
            if ($pgVersion) {
                throw "Refusing to package runtime\pgsql because PostgreSQL data marker was found: $($pgVersion.FullName)"
            }

            $forbiddenFile = Get-ChildItem -LiteralPath $source -Recurse -Force -File -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -match '\.(log|pid|csv)$' -or $_.Name -match '^(postmaster\.opts|postmaster\.pid)$' } |
                Select-Object -First 1
            if ($forbiddenFile) {
                throw "Refusing to package runtime\pgsql because it contains runtime state/log file: $($forbiddenFile.FullName)"
            }
        }

        $dest = Join-Path $OutDir "runtime\$runtimePart"
        Write-SSInfo "Copying optional runtime: runtime\$runtimePart"
        & robocopy $source $dest /E /R:1 /W:1 /NFL /NDL /NJH /NJS /XF "*.log" "*.pid" | Out-Null
        $runtimeCopyExitCode = $LASTEXITCODE
        if ($runtimeCopyExitCode -ge 8) {
            throw "robocopy failed with exit code $runtimeCopyExitCode while copying runtime\$runtimePart"
        }
        $global:LASTEXITCODE = 0
    }
}

$readme = @"
SS ERP Windows Local Portable v$Version

This package does not include Redis, node_modules, or user data.
By default it also excludes Node.js and PostgreSQL runtime. If it was created with -IncludeRuntime,
runtime/node and runtime/pgsql may be present and can be used with start.ps1 -UseRuntimePostgres.

Start here:
1. Install pnpm 11.x. Install Node.js 20+ and PostgreSQL unless this package includes matching runtime/node and runtime/pgsql.
   Redis/compatible service is still not bundled.
2. Run: .\scripts\windows-local\prepare.ps1
3. Edit: .env.local-windows
4. Run: .\scripts\windows-local\start.ps1
   Optional with bundled PostgreSQL runtime: .\scripts\windows-local\start.ps1 -UseRuntimePostgres
5. Open: http://127.0.0.1:3003

Docs:
- docs/local-windows-package.md
"@
Set-Content -LiteralPath (Join-Path $OutDir "WINDOWS-LOCAL-README.txt") -Value $readme -Encoding UTF8

Write-SSOk "Portable source package created: $OutDir"

if ($Zip) {
    $zipPath = "$OutDir.zip"
    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }
    Compress-Archive -Path $OutDir -DestinationPath $zipPath -CompressionLevel Optimal
    Write-SSOk "Zip created: $zipPath"
}
