param()

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\common.ps1"

Write-SSInfo "Stopping SS ERP Windows local Node processes"
Stop-SSManagedProcess "web"
Stop-SSManagedProcess "worker"
Stop-SSManagedProcess "server"
Write-SSInfo "PostgreSQL and Redis were not stopped because they may be shared local services."
