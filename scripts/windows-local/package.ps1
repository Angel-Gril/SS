param(
    [string]$Version = "0.1.0",
    [string]$OutDir = "",
    [switch]$DryRun,
    [switch]$Zip
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
    "build\dist",
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
    Write-Host "- no node_modules, no Node runtime, no PostgreSQL runtime, no Redis runtime"
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

$readme = @"
SS ERP Windows Local Portable v$Version

This package does not include Node.js, PostgreSQL, Redis, node_modules, or user data.

Start here:
1. Install Node.js 20+, pnpm 11.x, PostgreSQL, and Redis/compatible service.
2. Run: .\scripts\windows-local\prepare.ps1
3. Edit: .env.local-windows
4. Run: .\scripts\windows-local\start.ps1
5. Open: http://127.0.0.1:3000

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
