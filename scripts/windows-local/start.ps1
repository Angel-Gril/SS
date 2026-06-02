param(
    [string]$EnvFile = ".env.local-windows",
    [switch]$SkipMigrate,
    [switch]$SkipWorker,
    [switch]$CreateDatabase,
    [switch]$UseRuntimePostgres
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\common.ps1"

$root = Get-SSRoot
Set-Location $root

Import-SSEnvFile $EnvFile | Out-Null
Set-SSLocalEnvDefaults

Write-SSInfo "Starting SS ERP Windows local stack"
Write-SSInfo "Root: $root"

$node = Get-SSCommandPath "node"
$pnpm = Get-SSCommandPath "pnpm"
$pgReady = Get-SSCommandPath "pg_isready"
$psql = Get-SSCommandPath "psql"

if (-not $node) { throw "node not found. Run prepare.ps1 first." }
if (-not $pnpm) { throw "pnpm not found. Run prepare.ps1 first." }
if (-not $pgReady) { throw "pg_isready not found. Install PostgreSQL client tools." }
if (-not $psql) { throw "psql not found. Install PostgreSQL client tools." }

$db = Get-SSDatabaseInfo $env:DATABASE_URL
if ($UseRuntimePostgres) {
    if (-not (Test-SSPostgresRuntime)) {
        throw "PostgreSQL runtime not found. Put PostgreSQL under runtime\pgsql or set SS_ERP_POSTGRES_BIN, then rerun start.ps1 -UseRuntimePostgres."
    }
    Start-SSRuntimePostgres $db
    Ensure-SSDatabaseExists $db
} else {
    if (-not (Test-SSTcpPort $db.Host $db.Port)) {
        throw "PostgreSQL is not reachable at $($db.Host):$($db.Port). Start PostgreSQL and verify DATABASE_URL, or use -UseRuntimePostgres when runtime\pgsql is available."
    }
    Write-SSOk "PostgreSQL reachable: $($db.Host):$($db.Port)"

    if ($CreateDatabase) {
        Ensure-SSDatabaseExists $db
    } elseif (-not (Test-SSDatabaseConnection)) {
        throw "DATABASE_URL host/port is reachable, but the target database is not accessible. Create database '$($db.Database)' first, or rerun with -CreateDatabase if this user can create databases."
    }
}

if (Test-SSDatabaseConnection) {
    Write-SSOk "Target database reachable: $($db.Database)"
} else {
    throw "Target database check failed after PostgreSQL setup. Verify DATABASE_URL."
}

$redisDisabled = $env:REDIS_DISABLED -eq "1" -or $env:REDIS_DISABLED -eq "true"
if ($redisDisabled) {
    Write-SSWarn "REDIS_DISABLED=1; standalone worker will be skipped because several BullMQ workers require Redis."
    $SkipWorker = $true
} else {
    $redis = Get-SSRedisInfo $env:REDIS_URL
    if (-not (Test-SSTcpPort $redis.Host $redis.Port)) {
        throw "Redis is not reachable at $($redis.Host):$($redis.Port). Start Redis or set REDIS_DISABLED=1 for minimal local testing."
    }
    Write-SSOk "Redis reachable: $($redis.Host):$($redis.Port)"
}

if (-not $SkipMigrate) {
    Invoke-SSCheckedCommand $pnpm @("--filter", "server", "db:deploy") "Applying Prisma migrations"
}

$env:RUN_WORKERS = "0"
Start-SSManagedProcess "server" $pnpm @("--filter", "server", "dev") $root | Out-Null

if (-not $SkipWorker) {
    $env:RUN_WORKERS = "1"
    Start-SSManagedProcess "worker" $pnpm @("--filter", "server", "exec", "tsx", "src/worker.ts") $root | Out-Null
} else {
    Write-SSWarn "worker process skipped."
}

Start-SSManagedProcess "web" $pnpm @("--filter", "web", "dev") $root | Out-Null

$apiUrl = ($env:NEXT_PUBLIC_API_BASE_URL.TrimEnd("/")) + "/ready"
$webUrl = $env:NEXT_PUBLIC_WEB_BASE_URL.TrimEnd("/")

if (Wait-SSHttpReady $apiUrl 60) {
    Write-SSOk "API ready: $apiUrl"
} else {
    Write-SSWarn "API did not become ready within 60 seconds. Check logs/windows-local/server.err.log."
}

if (Wait-SSHttpReady $webUrl 60) {
    Write-SSOk "Web ready: $webUrl"
} else {
    Write-SSWarn "Web did not become ready within 60 seconds. Check logs/windows-local/web.err.log."
}

Write-SSOk "Local URLs: Web=$webUrl API=$($env:NEXT_PUBLIC_API_BASE_URL)"
