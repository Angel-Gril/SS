param(
    [string]$ConfigFile = "config.json",
    [switch]$KeepPostgres
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\common.ps1"

$root = Get-SSRoot
Set-Location $root

try {
    Import-SSRuntimeConfig -ConfigFile $ConfigFile | Out-Null
} catch {
    Write-SSWarn "Runtime config could not be loaded; using default local runtime paths for stop."
    $env:DATABASE_URL = "postgresql://postgres@127.0.0.1:5433/ss_erp"
    $env:SS_ERP_POSTGRES_BIN = "runtime/pgsql/bin"
    $env:SS_ERP_POSTGRES_DATA_DIR = "data/pgsql"
}

Write-SSInfo "Stopping SS ERP Windows runtime package"
Stop-SSManagedProcess "web"
Stop-SSManagedProcess "server"
Stop-SSManagedProcess "worker"

if ($KeepPostgres) {
    Write-SSInfo "Runtime PostgreSQL stop skipped by -KeepPostgres."
} else {
    Stop-SSRuntimePostgres
}

Write-SSInfo "Only script-managed SS ERP processes were stopped."
