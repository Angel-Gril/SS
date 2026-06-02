param(
    [string]$ConfigFile = "config.json",
    [switch]$SkipMigrate,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\common.ps1"

$root = Get-SSRoot
Set-Location $root

$runtimeConfig = Import-SSRuntimeConfig -ConfigFile $ConfigFile -CreateIfMissing

Write-SSInfo "Starting SS ERP Windows runtime package"
Write-SSInfo "Root: $root"
Write-SSInfo "Config: $($runtimeConfig.Path)"

$node = Get-SSNodeRuntimePath
if (-not $node) {
    throw "Node runtime not found. Expected runtime\node\node.exe or SS_ERP_NODE_EXE."
}
if (-not (Test-SSPostgresRuntime)) {
    throw "PostgreSQL runtime not found. Expected runtime\pgsql\bin with postgres.exe, pg_ctl.exe, initdb.exe, psql.exe, pg_dump.exe and pg_restore.exe."
}

foreach ($dir in @(
    "data\pgsql",
    "data\backups",
    "data\uploads",
    "data\watermarked",
    "data\resized",
    "logs\windows-local",
    "apps\server\public\uploads",
    "apps\server\public\watermarked",
    "apps\server\public\resized"
)) {
    $path = Join-Path $root $dir
    if (-not (Test-Path -LiteralPath $path)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
}

foreach ($portCheck in @(
    @{ Name = "API"; Process = "server"; Host = "127.0.0.1"; Port = $runtimeConfig.ServerPort },
    @{ Name = "Web"; Process = "web"; Host = "127.0.0.1"; Port = $runtimeConfig.WebPort }
)) {
    if (Test-SSTcpPort $portCheck.Host ([int]$portCheck.Port)) {
        $managed = Get-SSManagedProcess $portCheck.Process
        if (-not $managed) {
            throw "$($portCheck.Name) port is already in use: $($portCheck.Host):$($portCheck.Port). Edit config.json or stop the other process."
        }
    }
}

$db = Get-SSDatabaseInfo $env:DATABASE_URL
Start-SSRuntimePostgres $db
Ensure-SSDatabaseExists $db

if (-not $SkipMigrate) {
    $prismaCli = Join-Path $root "apps\server\node_modules\prisma\build\index.js"
    $schema = Join-Path $root "apps\server\prisma\schema.prisma"
    if (-not (Test-Path -LiteralPath $prismaCli)) {
        throw "Prisma CLI not found in package: $prismaCli"
    }
    if (-not (Test-Path -LiteralPath $schema)) {
        throw "Prisma schema not found in package: $schema"
    }
    Invoke-SSCheckedCommand $node @($prismaCli, "migrate", "deploy", "--schema", $schema) "Applying Prisma migrations"
}

$env:RUN_WORKERS = "0"
$serverDir = Join-Path $root "apps\server"
$serverEntry = Join-Path $serverDir "dist\index.js"
if (-not (Test-Path -LiteralPath $serverEntry)) {
    throw "Server production entry not found: $serverEntry"
}
Start-SSManagedProcess "server" $node @($serverEntry) $serverDir | Out-Null

$webCandidates = @(
    (Join-Path $root "apps\web\standalone\apps\web\server.js"),
    (Join-Path $root "apps\web\standalone\server.js")
)
$webEntry = $webCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $webEntry) {
    throw "Next standalone server.js not found under apps\web\standalone."
}

$env:PORT = [string]$runtimeConfig.WebPort
$env:HOSTNAME = "127.0.0.1"
$env:NEXT_TELEMETRY_DISABLED = "1"
Start-SSManagedProcess "web" $node @($webEntry) (Split-Path -Path $webEntry -Parent) | Out-Null

$apiReady = ($runtimeConfig.ApiBaseUrl.TrimEnd("/")) + "/ready"
if (Wait-SSHttpReady $apiReady 90) {
    Write-SSOk "API ready: $apiReady"
} else {
    Write-SSWarn "API did not become ready within 90 seconds. Check logs/windows-local/server.err.log."
}

$webUrl = $runtimeConfig.WebBaseUrl.TrimEnd("/")
if (Wait-SSHttpReady $webUrl 90) {
    Write-SSOk "Web ready: $webUrl"
} else {
    Write-SSWarn "Web did not become ready within 90 seconds. Check logs/windows-local/web.err.log."
}

Write-SSOk "Local runtime URLs: Web=$webUrl API=$($runtimeConfig.ApiBaseUrl)"
if (-not $NoBrowser) {
    Start-Process $webUrl
}
