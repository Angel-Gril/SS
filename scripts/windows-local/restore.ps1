param(
    [string]$EnvFile = ".env.local-windows",
    [string]$BackupFile = "",
    [string]$BackupDir = "data\backups",
    [switch]$Latest,
    [switch]$ConfirmRestore
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\common.ps1"

$root = Get-SSRoot
Set-Location $root

Import-SSEnvFile $EnvFile | Out-Null
Set-SSLocalEnvDefaults

$pgRestore = Get-SSCommandPath "pg_restore"
if (-not $pgRestore) {
    throw "pg_restore not found. Install PostgreSQL client tools and add them to PATH."
}

if ([string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
    throw "DATABASE_URL is empty. Check $EnvFile."
}

$target = $BackupFile
if ($Latest) {
    $dir = if ([System.IO.Path]::IsPathRooted($BackupDir)) { $BackupDir } else { Join-Path $root $BackupDir }
    $latestDirectory = Get-ChildItem -LiteralPath $dir -Directory -Filter "ss_erp_*" -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "database.dump") } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if ($latestDirectory) {
        $target = $latestDirectory.FullName
    } else {
        $latestFile = Get-ChildItem -LiteralPath $dir -Filter "ss_erp_*.dump" -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
        if (-not $latestFile) {
            throw "No backup files found in $dir"
        }
        $target = $latestFile.FullName
    }
}

if ([string]::IsNullOrWhiteSpace($target)) {
    throw "Pass -BackupFile <path> or -Latest."
}

if (-not [System.IO.Path]::IsPathRooted($target)) {
    $target = Join-Path $root $target
}

if (-not (Test-Path -LiteralPath $target)) {
    throw "Backup file not found: $target"
}

$databaseDump = $target
$assetRoot = $null
if ((Get-Item -LiteralPath $target).PSIsContainer) {
    $databaseDump = Join-Path $target "database.dump"
    $assetRoot = Join-Path $target "assets"
    if (-not (Test-Path -LiteralPath $databaseDump)) {
        throw "Backup directory missing database.dump: $target"
    }
}

if (-not $ConfirmRestore) {
    Write-SSWarn "Restore is destructive: it will clean database objects before replaying $databaseDump."
    if ($assetRoot) {
        Write-SSWarn "Local asset files from $assetRoot will be copied over existing files with the same names."
    }
    Write-SSWarn "Rerun with -ConfirmRestore to continue."
    exit 2
}

Write-SSInfo "Restoring PostgreSQL backup: $databaseDump"
& $pgRestore --dbname $env:DATABASE_URL --clean --if-exists --no-owner --no-acl $databaseDump
if ($LASTEXITCODE -ne 0) {
    throw "pg_restore failed with exit code $LASTEXITCODE"
}

if ($assetRoot -and (Test-Path -LiteralPath $assetRoot)) {
    foreach ($name in @("uploads", "watermarked", "resized")) {
        $source = Join-Path $assetRoot $name
        $dest = Join-Path $root "apps\server\public\$name"
        if (Test-Path -LiteralPath $source) {
            if (-not (Test-Path -LiteralPath $dest)) {
                New-Item -ItemType Directory -Path $dest -Force | Out-Null
            }
            Copy-Item -Path (Join-Path $source "*") -Destination $dest -Recurse -Force -ErrorAction SilentlyContinue
            Write-SSOk "Asset restore copied: apps/server/public/$name"
        }
    }
} else {
    Write-SSWarn "No asset backup found; restored database only."
}

Write-SSOk "Restore complete."
