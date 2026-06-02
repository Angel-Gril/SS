param(
    [string]$EnvFile = ".env.local-windows",
    [switch]$Install
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\common.ps1"

$root = Get-SSRoot
Set-Location $root

Write-SSInfo "SS ERP Windows local prepare"
Write-SSInfo "Root: $root"

$envPath = Resolve-SSEnvFile $EnvFile
$templatePath = Join-Path $root ".env.local-windows.example"

if (-not (Test-Path -LiteralPath $envPath)) {
    if (-not (Test-Path -LiteralPath $templatePath)) {
        throw "Template not found: $templatePath"
    }

    $jwt = New-SSRandomHex 32
    $enc = New-SSRandomHex 32
    $setup = New-SSRandomHex 16
    $content = Get-Content -LiteralPath $templatePath -Raw
    $content = $content.Replace('JWT_SECRET="replace-with-local-jwt-secret-min-16"', "JWT_SECRET=`"$jwt`"")
    $content = $content.Replace('ENCRYPTION_KEY="replace-with-local-encryption-key-min-32"', "ENCRYPTION_KEY=`"$enc`"")
    $content = $content.Replace('SETUP_TOKEN="replace-with-local-setup-token"', "SETUP_TOKEN=`"$setup`"")
    Set-Content -LiteralPath $envPath -Value $content -Encoding UTF8
    Write-SSOk "Created $envPath with generated local secrets."
} else {
    Write-SSOk "Env file exists: $envPath"
}

$envValues = Import-SSEnvFile $EnvFile
Set-SSLocalEnvDefaults

$nodeRuntime = Get-SSNodeRuntimePath
if ($nodeRuntime) {
    Write-SSOk "Optional Node runtime found: $nodeRuntime"
} else {
    Write-SSInfo "Optional Node runtime not found under runtime\node; PATH Node will be used."
}

$pgRuntimeBin = Get-SSPostgresBinDir
if ($pgRuntimeBin) {
    Write-SSOk "Optional PostgreSQL runtime found: $pgRuntimeBin"
} else {
    Write-SSInfo "Optional PostgreSQL runtime not found under runtime\pgsql; existing PostgreSQL service/client tools will be used."
}

$checks = @(
    (Test-SSCommand "node" "Install Node.js 20+ and reopen PowerShell."),
    (Test-SSCommand "pnpm" "Install pnpm 11.x: corepack enable, then corepack prepare pnpm@11.1.3 --activate."),
    (Test-SSCommand "psql" "Install PostgreSQL client tools and add the bin directory to PATH."),
    (Test-SSCommand "pg_isready" "Install PostgreSQL client tools and add the bin directory to PATH."),
    (Test-SSCommand "pg_dump" "Install PostgreSQL client tools and add the bin directory to PATH."),
    (Test-SSCommand "pg_restore" "Install PostgreSQL client tools and add the bin directory to PATH.")
)

$db = Get-SSDatabaseInfo $env:DATABASE_URL
if (Test-SSTcpPort $db.Host $db.Port) {
    Write-SSOk "PostgreSQL port reachable: $($db.Host):$($db.Port)"
    if (Test-SSDatabaseConnection) {
        Write-SSOk "Target database reachable: $($db.Database)"
    } else {
        Write-SSWarn "PostgreSQL host/port is reachable, but target database '$($db.Database)' is not accessible yet."
        Write-SSWarn "Create it manually, run start.ps1 -CreateDatabase, or use start.ps1 -UseRuntimePostgres when runtime\pgsql is available."
    }
} else {
    Write-SSWarn "PostgreSQL is not reachable at $($db.Host):$($db.Port). Start PostgreSQL and verify DATABASE_URL."
    if ($pgRuntimeBin) {
        Write-SSWarn "runtime\pgsql is available; start.ps1 -UseRuntimePostgres can initialize data\pgsql and create the target database."
    }
}

$redisDisabled = $env:REDIS_DISABLED -eq "1" -or $env:REDIS_DISABLED -eq "true"
if ($redisDisabled) {
    Write-SSWarn "REDIS_DISABLED is enabled. Minimal local login/collection can run, but queue workers are not fully validated."
} else {
    $redis = Get-SSRedisInfo $env:REDIS_URL
    if (Test-SSTcpPort $redis.Host $redis.Port) {
        Write-SSOk "Redis port reachable: $($redis.Host):$($redis.Port)"
    } else {
        Write-SSWarn "Redis is not reachable at $($redis.Host):$($redis.Port). Windows has no official stable Redis build; use WSL/Docker/a trusted compatible service, or set REDIS_DISABLED=1 only for minimal local testing."
    }
}

if ($checks -contains $false) {
    throw "Required command checks failed. Fix PATH/dependencies and rerun prepare.ps1."
}

if ($Install) {
    $pnpm = Get-SSCommandPath "pnpm"
    Invoke-SSCheckedCommand $pnpm @("install", "--frozen-lockfile") "Installing pnpm dependencies"
} elseif (-not (Test-Path -LiteralPath (Join-Path $root "node_modules"))) {
    Write-SSWarn "node_modules is missing. Run pnpm install, or rerun prepare.ps1 -Install."
}

Write-SSOk "Prepare complete."
