param(
    [string]$EnvFile = ".env.local-windows",
    [switch]$KeepRuntimePostgres
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\common.ps1"

Import-SSEnvFile $EnvFile -Optional | Out-Null
Set-SSLocalEnvDefaults

Write-SSInfo "Stopping SS ERP Windows local Node processes"
Stop-SSManagedProcess "web"
Stop-SSManagedProcess "worker"
Stop-SSManagedProcess "server"
if ($KeepRuntimePostgres) {
    Write-SSInfo "Runtime PostgreSQL stop skipped by -KeepRuntimePostgres."
} else {
    Stop-SSRuntimePostgres
}
Write-SSInfo "Shared PostgreSQL services and Redis were not stopped."
