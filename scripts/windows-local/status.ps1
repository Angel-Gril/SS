param(
    [string]$EnvFile = ".env.local-windows"
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\common.ps1"

Import-SSEnvFile $EnvFile -Optional | Out-Null
Set-SSLocalEnvDefaults

Write-SSInfo "SS ERP Windows local status"

foreach ($name in @("server", "worker", "web")) {
    $process = Get-SSManagedProcess $name
    if ($process) {
        Write-SSOk "$name running (PID $($process.Id))"
    } else {
        Write-SSWarn "$name not running"
    }
}

$db = Get-SSDatabaseInfo $env:DATABASE_URL
if (Test-SSTcpPort $db.Host $db.Port) {
    Write-SSOk "PostgreSQL reachable: $($db.Host):$($db.Port)"
} else {
    Write-SSError "PostgreSQL not reachable: $($db.Host):$($db.Port)"
}

$redisDisabled = $env:REDIS_DISABLED -eq "1" -or $env:REDIS_DISABLED -eq "true"
if ($redisDisabled) {
    Write-SSWarn "Redis disabled by REDIS_DISABLED"
} else {
    $redis = Get-SSRedisInfo $env:REDIS_URL
    if (Test-SSTcpPort $redis.Host $redis.Port) {
        Write-SSOk "Redis reachable: $($redis.Host):$($redis.Port)"
    } else {
        Write-SSError "Redis not reachable: $($redis.Host):$($redis.Port)"
    }
}

$apiReady = ($env:NEXT_PUBLIC_API_BASE_URL.TrimEnd("/")) + "/ready"
try {
    $api = Invoke-WebRequest -Uri $apiReady -UseBasicParsing -TimeoutSec 3
    Write-SSOk "API ready responded HTTP $($api.StatusCode): $apiReady"
} catch {
    Write-SSWarn "API ready check failed: $apiReady"
}

$webUrl = $env:NEXT_PUBLIC_WEB_BASE_URL.TrimEnd("/")
try {
    $web = Invoke-WebRequest -Uri $webUrl -UseBasicParsing -TimeoutSec 3
    Write-SSOk "Web responded HTTP $($web.StatusCode): $webUrl"
} catch {
    Write-SSWarn "Web check failed: $webUrl"
}
