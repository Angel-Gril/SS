param(
    [string]$EnvFile = ".env.local-windows",
    [string]$BackupDir = "data\backups"
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\common.ps1"

$root = Get-SSRoot
Set-Location $root

Import-SSEnvFile $EnvFile | Out-Null
Set-SSLocalEnvDefaults

$pgDump = Get-SSCommandPath "pg_dump"
if (-not $pgDump) {
    throw "pg_dump not found. Install PostgreSQL client tools and add them to PATH."
}

if ([string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
    throw "DATABASE_URL is empty. Check $EnvFile."
}

$targetDir = if ([System.IO.Path]::IsPathRooted($BackupDir)) { $BackupDir } else { Join-Path $root $BackupDir }
if (-not (Test-Path -LiteralPath $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupRoot = Join-Path $targetDir "ss_erp_$stamp"
$backupFile = Join-Path $backupRoot "database.dump"
$assetRoot = Join-Path $backupRoot "assets"
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
New-Item -ItemType Directory -Path $assetRoot -Force | Out-Null

Write-SSInfo "Creating PostgreSQL backup: $backupFile"
& $pgDump --dbname $env:DATABASE_URL --format custom --no-owner --no-acl --file $backupFile
if ($LASTEXITCODE -ne 0) {
    throw "pg_dump failed with exit code $LASTEXITCODE"
}

foreach ($name in @("uploads", "watermarked", "resized")) {
    $source = Join-Path $root "apps\server\public\$name"
    $dest = Join-Path $assetRoot $name
    if (Test-Path -LiteralPath $source) {
        Copy-Item -LiteralPath $source -Destination $dest -Recurse -Force
        Write-SSOk "Asset backup copied: apps/server/public/$name"
    } else {
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
        Write-SSWarn "Asset directory missing, created empty backup folder: apps/server/public/$name"
    }
}

$manifest = @"
{
  "createdAt": "$(Get-Date -Format "o")",
  "database": "database.dump",
  "assets": ["uploads", "watermarked", "resized"]
}
"@
Set-Content -LiteralPath (Join-Path $backupRoot "manifest.json") -Value $manifest -Encoding UTF8

$sizeMb = [math]::Round((Get-ChildItem -LiteralPath $backupRoot -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 2)
Write-SSOk "Backup complete: $backupRoot ($sizeMb MB)"
