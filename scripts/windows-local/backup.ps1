param(
    [string]$EnvFile = ".env.local-windows",
    [string]$ConfigFile = "",
    [string]$BackupDir = "data\backups"
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\common.ps1"

$root = Get-SSRoot
Set-Location $root

$usingRuntimeConfig = -not [string]::IsNullOrWhiteSpace($ConfigFile)
if (-not $usingRuntimeConfig) {
    Import-SSEnvFile $EnvFile | Out-Null
    Set-SSLocalEnvDefaults
} else {
    Import-SSRuntimeConfig -ConfigFile $ConfigFile | Out-Null
}

$pgDump = Get-SSCommandPath "pg_dump"
if (-not $pgDump) {
    throw "pg_dump not found. Install PostgreSQL client tools and add them to PATH."
}

if ([string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
    throw "DATABASE_URL is empty. Check $EnvFile."
}

if ($usingRuntimeConfig) {
    Assert-SSRuntimeDatabaseTargetSafe "Backup"
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
    $source = Get-SSLocalAssetDir $name
    $dest = Join-Path $assetRoot $name
    if (Test-Path -LiteralPath $source) {
        Copy-Item -LiteralPath $source -Destination $dest -Recurse -Force
        Write-SSOk "Asset backup copied: $source"
    } else {
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
        Write-SSWarn "Asset directory missing, created empty backup folder: $source"
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
