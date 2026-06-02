$ErrorActionPreference = "Stop"

$Script:SSRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

function Get-SSRoot {
    return $Script:SSRoot
}

function Get-SSLogDir {
    $path = Join-Path (Get-SSRoot) "logs\windows-local"
    if (-not (Test-Path -LiteralPath $path)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
    return $path
}

function Get-SSRuntimePostgresMarkerPath {
    return (Join-Path (Get-SSLogDir) "postgres-runtime.json")
}

function Write-SSInfo {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Write-SSOk {
    param([string]$Message)
    Write-Host "[ OK ] $Message" -ForegroundColor Green
}

function Write-SSWarn {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-SSError {
    param([string]$Message)
    Write-Host "[FAIL] $Message" -ForegroundColor Red
}

function Resolve-SSEnvFile {
    param([string]$EnvFile = ".env.local-windows")

    if ([string]::IsNullOrWhiteSpace($EnvFile)) {
        $EnvFile = ".env.local-windows"
    }
    if ([System.IO.Path]::IsPathRooted($EnvFile)) {
        return $EnvFile
    }
    return (Join-Path (Get-SSRoot) $EnvFile)
}

function Read-SSEnvFile {
    param([string]$Path)

    $values = @{}
    if (-not (Test-Path -LiteralPath $Path)) {
        return $values
    }

    foreach ($rawLine in Get-Content -LiteralPath $Path) {
        $line = $rawLine.Trim()
        if (-not $line -or $line.StartsWith("#")) {
            continue
        }
        if ($line.StartsWith("export ")) {
            $line = $line.Substring(7).Trim()
        }

        $eq = $line.IndexOf("=")
        if ($eq -le 0) {
            continue
        }

        $key = $line.Substring(0, $eq).Trim()
        $value = $line.Substring($eq + 1).Trim()
        if ($value.Length -ge 2) {
            $first = $value.Substring(0, 1)
            $last = $value.Substring($value.Length - 1, 1)
            if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
                $value = $value.Substring(1, $value.Length - 2)
            } else {
                $comment = [regex]::Match($value, "\s+#")
                if ($comment.Success) {
                    $value = $value.Substring(0, $comment.Index).Trim()
                }
            }
        }

        if ($key) {
            $values[$key] = $value
        }
    }

    return $values
}

function Import-SSEnvFile {
    param(
        [string]$EnvFile = ".env.local-windows",
        [switch]$Optional
    )

    $path = Resolve-SSEnvFile $EnvFile
    if (-not (Test-Path -LiteralPath $path)) {
        if ($Optional) {
            return @{}
        }
        throw "Env file not found: $path. Run .\scripts\windows-local\prepare.ps1 first."
    }

    $values = Read-SSEnvFile $path
    foreach ($entry in $values.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, "Process")
    }
    return $values
}

function Set-SSEnvDefault {
    param(
        [string]$Key,
        [string]$Value
    )

    $current = [Environment]::GetEnvironmentVariable($Key, "Process")
    if ([string]::IsNullOrWhiteSpace($current)) {
        [Environment]::SetEnvironmentVariable($Key, $Value, "Process")
    }
}

function Add-SSToProcessPath {
    param([string]$Directory)

    if ([string]::IsNullOrWhiteSpace($Directory) -or -not (Test-Path -LiteralPath $Directory)) {
        return
    }

    $resolved = (Resolve-Path -LiteralPath $Directory).Path
    $currentPath = [Environment]::GetEnvironmentVariable("PATH", "Process")
    $parts = @()
    if (-not [string]::IsNullOrWhiteSpace($currentPath)) {
        $parts = $currentPath -split ";"
    }

    $exists = $parts | Where-Object { $_ -and $_.TrimEnd("\") -ieq $resolved.TrimEnd("\") } | Select-Object -First 1
    if (-not $exists) {
        [Environment]::SetEnvironmentVariable("PATH", "$resolved;$currentPath", "Process")
    }
}

function Set-SSLocalEnvDefaults {
    Set-SSEnvDefault "NODE_ENV" "development"
    Set-SSEnvDefault "RUNTIME_MODE" "local"
    Set-SSEnvDefault "NEXT_PUBLIC_RUNTIME_MODE" "local"
    Set-SSEnvDefault "SERVER_HOST" "127.0.0.1"
    Set-SSEnvDefault "SERVER_PORT" "3001"
    Set-SSEnvDefault "NEXT_PUBLIC_API_BASE_URL" "http://127.0.0.1:3001"
    Set-SSEnvDefault "NEXT_PUBLIC_WEB_BASE_URL" "http://127.0.0.1:3000"
    Set-SSEnvDefault "LOCAL_BASE_URL" "http://127.0.0.1:3001"
    Set-SSEnvDefault "IMAGE_STORAGE_BACKEND" "local"
    Set-SSEnvDefault "SMS_PROVIDER" "console"
    Set-SSEnvDefault "AUTH_COOKIE_SECURE" "false"
    Set-SSEnvDefault "CORS_ORIGIN" "http://127.0.0.1:3000,http://localhost:3000"
    Set-SSEnvDefault "CORS_EXTENSION_ORIGINS" "chrome-extension://*"

    $nodeRuntime = Get-SSNodeRuntimePath
    if ($nodeRuntime) {
        Add-SSToProcessPath ([System.IO.Path]::GetDirectoryName($nodeRuntime))
    }

    $pgBin = Get-SSPostgresBinDir
    if ($pgBin) {
        Add-SSToProcessPath $pgBin
    }
}

function Get-SSCommandPath {
    param([string]$Name)

    $candidates = @()
    if ($Name -eq "pnpm") {
        $candidates = @("pnpm.cmd", "pnpm.exe", "pnpm")
    } elseif ($Name -eq "node") {
        $nodeRuntime = Get-SSNodeRuntimePath
        if ($nodeRuntime) {
            return $nodeRuntime
        }
        $candidates = @("node.exe", "node.cmd", "node")
    } elseif ($Name -in @("psql", "pg_isready", "pg_dump", "pg_restore", "createdb", "dropdb", "pg_ctl", "initdb", "postgres")) {
        $pgBin = Get-SSPostgresBinDir
        if ($pgBin) {
            $pgCommand = Join-Path $pgBin "$Name.exe"
            if (Test-Path -LiteralPath $pgCommand) {
                return $pgCommand
            }
        }
        $candidates = @("$Name.exe", "$Name.cmd", $Name)
    } else {
        $candidates = @("$Name.exe", "$Name.cmd", $Name)
    }

    foreach ($candidate in $candidates) {
        $cmd = Get-Command $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($cmd) {
            return $cmd.Source
        }
    }
    return $null
}

function Resolve-SSRootRelativePath {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ""
    }
    if ([System.IO.Path]::IsPathRooted($Path)) {
        return $Path
    }
    return (Join-Path (Get-SSRoot) $Path)
}

function Get-SSNodeRuntimePath {
    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($env:SS_ERP_NODE_EXE)) {
        $candidates += (Resolve-SSRootRelativePath $env:SS_ERP_NODE_EXE)
    }
    $candidates += @(
        (Join-Path (Get-SSRoot) "runtime\node\node.exe"),
        (Join-Path (Get-SSRoot) "build\runtime\node\node.exe")
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    return $null
}

function Get-SSPostgresBinDir {
    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($env:SS_ERP_POSTGRES_BIN)) {
        $candidates += (Resolve-SSRootRelativePath $env:SS_ERP_POSTGRES_BIN)
    }
    $candidates += @(
        (Join-Path (Get-SSRoot) "runtime\pgsql\bin"),
        (Join-Path (Get-SSRoot) "build\runtime\pgsql\bin")
    )

    foreach ($candidate in $candidates) {
        if (-not (Test-Path -LiteralPath $candidate)) {
            continue
        }
        $postgres = Join-Path $candidate "postgres.exe"
        $pgCtl = Join-Path $candidate "pg_ctl.exe"
        if ((Test-Path -LiteralPath $postgres) -and (Test-Path -LiteralPath $pgCtl)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    return $null
}

function Test-SSCommand {
    param(
        [string]$Name,
        [string]$Hint
    )

    $path = Get-SSCommandPath $Name
    if ($path) {
        Write-SSOk "$Name found: $path"
        return $true
    }

    if ($Hint) {
        Write-SSError "$Name not found. $Hint"
    } else {
        Write-SSError "$Name not found in PATH."
    }
    return $false
}

function Invoke-SSCheckedCommand {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$Label
    )

    Write-SSInfo $Label
    & $FilePath @Arguments
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "$Label failed with exit code $exitCode"
    }
}

function Get-SSDatabaseInfo {
    param([string]$DatabaseUrl)

    $info = [ordered]@{
        Host = "127.0.0.1"
        Port = 5432
        Database = "ss_erp"
        User = ""
    }

    if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
        return $info
    }

    try {
        $uri = [Uri]$DatabaseUrl
        if ($uri.Host) {
            $info.Host = $uri.Host
        }
        if ($uri.Port -gt 0) {
            $info.Port = $uri.Port
        }
        $db = $uri.AbsolutePath.Trim("/")
        if ($db) {
            $info.Database = $db
        }
        if ($uri.UserInfo) {
            $info.User = ([Uri]::UnescapeDataString($uri.UserInfo).Split(":")[0])
        }
    } catch {
        Write-SSWarn "Cannot parse DATABASE_URL, using default host/port checks."
    }

    return $info
}

function Get-SSRedisInfo {
    param([string]$RedisUrl)

    $info = [ordered]@{
        Host = "127.0.0.1"
        Port = 6379
    }

    if ([string]::IsNullOrWhiteSpace($RedisUrl)) {
        return $info
    }

    try {
        $uri = [Uri]$RedisUrl
        if ($uri.Host) {
            $info.Host = $uri.Host
        }
        if ($uri.Port -gt 0) {
            $info.Port = $uri.Port
        }
    } catch {
        Write-SSWarn "Cannot parse REDIS_URL, using default host/port checks."
    }

    return $info
}

function Test-SSTcpPort {
    param(
        [string]$HostName,
        [int]$Port,
        [int]$TimeoutMs = 1500
    )

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
            return $false
        }
        $client.EndConnect($async)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Get-SSPidFile {
    param([string]$Name)
    return (Join-Path (Get-SSLogDir) "$Name.pid")
}

function Get-SSManagedProcess {
    param([string]$Name)

    $pidFile = Get-SSPidFile $Name
    if (-not (Test-Path -LiteralPath $pidFile)) {
        return $null
    }

    $pidText = (Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    $processId = 0
    if (-not [int]::TryParse([string]$pidText, [ref]$processId)) {
        return $null
    }

    return (Get-Process -Id $processId -ErrorAction SilentlyContinue)
}

function Start-SSManagedProcess {
    param(
        [string]$Name,
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )

    $existing = Get-SSManagedProcess $Name
    if ($existing) {
        Write-SSWarn "$Name already running (PID $($existing.Id))."
        return $existing
    }

    $logDir = Get-SSLogDir
    $stdout = Join-Path $logDir "$Name.log"
    $stderr = Join-Path $logDir "$Name.err.log"
    $pidFile = Get-SSPidFile $Name

    $process = Start-Process `
        -FilePath $FilePath `
        -ArgumentList $Arguments `
        -WorkingDirectory $WorkingDirectory `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru

    Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ASCII
    Write-SSOk "$Name started (PID $($process.Id)); logs: $stdout"
    return $process
}

function Stop-SSManagedProcess {
    param([string]$Name)

    $pidFile = Get-SSPidFile $Name
    $process = Get-SSManagedProcess $Name
    if (-not $process) {
        if (Test-Path -LiteralPath $pidFile) {
            Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
        }
        Write-SSWarn "$Name is not running."
        return
    }

    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    Write-SSOk "$Name stopped (PID $($process.Id))."
}

function Wait-SSHttpReady {
    param(
        [string]$Url,
        [int]$TimeoutSeconds = 60
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return $true
            }
        } catch {
            Start-Sleep -Seconds 1
        }
    }
    return $false
}

function New-SSRandomHex {
    param([int]$Bytes = 32)

    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($buffer)
    } finally {
        $rng.Dispose()
    }
    return (($buffer | ForEach-Object { $_.ToString("x2") }) -join "")
}

function Get-SSRuntimePostgresDataDir {
    if (-not [string]::IsNullOrWhiteSpace($env:SS_ERP_POSTGRES_DATA_DIR)) {
        if ([System.IO.Path]::IsPathRooted($env:SS_ERP_POSTGRES_DATA_DIR)) {
            return $env:SS_ERP_POSTGRES_DATA_DIR
        }
        return (Join-Path (Get-SSRoot) $env:SS_ERP_POSTGRES_DATA_DIR)
    }
    return (Join-Path (Get-SSRoot) "data\pgsql")
}

function Get-SSFullPath {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ""
    }
    if (Test-Path -LiteralPath $Path) {
        return (Resolve-Path -LiteralPath $Path).Path
    }
    return [System.IO.Path]::GetFullPath($Path)
}

function Test-SSRuntimePostgresHost {
    param([string]$HostName)

    if ([string]::IsNullOrWhiteSpace($HostName)) {
        return $true
    }
    $normalized = $HostName.Trim().Trim("[", "]").ToLowerInvariant()
    return ($normalized -eq "127.0.0.1" -or $normalized -eq "localhost")
}

function Assert-SSRuntimePostgresHost {
    param($DatabaseInfo)

    if (-not (Test-SSRuntimePostgresHost $DatabaseInfo.Host)) {
        throw "Runtime PostgreSQL only supports loopback hosts 127.0.0.1 or localhost because initdb uses trust auth. Use an existing PostgreSQL service for non-loopback DATABASE_URL values."
    }
}

function Assert-SSRuntimePostgresDataDirSafe {
    param([string]$DataDir)

    $rootData = Get-SSFullPath (Join-Path (Get-SSRoot) "data")
    $resolvedDataDir = Get-SSFullPath $DataDir
    if ([string]::IsNullOrWhiteSpace($resolvedDataDir)) {
        throw "Runtime PostgreSQL data directory is empty."
    }

    $rootDataPrefix = $rootData.TrimEnd("\", "/") + [System.IO.Path]::DirectorySeparatorChar
    $normalizedDataDir = $resolvedDataDir.TrimEnd("\", "/")
    if ($normalizedDataDir -eq $rootData.TrimEnd("\", "/") -or -not $normalizedDataDir.StartsWith($rootDataPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Runtime PostgreSQL data directory must be a child directory under $(Join-Path (Get-SSRoot) "data") to avoid stopping or packaging shared PostgreSQL data: $resolvedDataDir"
    }
}

function Test-SSRuntimePostgresMarkerMatches {
    param(
        $Marker,
        $DatabaseInfo,
        [string]$DataDir
    )

    if (-not $Marker) {
        return $false
    }

    $markerPort = 0
    if (-not [int]::TryParse([string]$Marker.port, [ref]$markerPort)) {
        return $false
    }
    if ($markerPort -ne [int]$DatabaseInfo.Port) {
        return $false
    }

    if (-not (Test-SSRuntimePostgresHost ([string]$Marker.host))) {
        return $false
    }
    if (-not (Test-SSRuntimePostgresHost ([string]$DatabaseInfo.Host))) {
        return $false
    }

    $expectedDataDir = (Get-SSFullPath $DataDir).TrimEnd("\", "/")
    $markerDataDir = (Get-SSFullPath ([string]$Marker.dataDir)).TrimEnd("\", "/")
    if (-not $expectedDataDir -or -not $markerDataDir) {
        return $false
    }
    return $expectedDataDir.Equals($markerDataDir, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-SSRuntimePostgresConnectionMatches {
    param(
        $DatabaseInfo,
        [string]$DataDir
    )

    $psql = Get-SSCommandPath "psql"
    if (-not $psql) {
        return $false
    }

    $expectedDataDir = (Get-SSFullPath $DataDir).TrimEnd("\", "/")
    $actualDataDir = & $psql (Get-SSDatabaseMaintenanceUrl $DatabaseInfo) "-tAc" "SHOW data_directory" 2>$null
    if ($LASTEXITCODE -ne 0) {
        return $false
    }

    $actual = (Get-SSFullPath (($actualDataDir -join "").Trim())).TrimEnd("\", "/")
    if (-not $expectedDataDir -or -not $actual) {
        return $false
    }
    return $expectedDataDir.Equals($actual, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-SSPostgresRuntime {
    $pgBin = Get-SSPostgresBinDir
    if (-not $pgBin) {
        return $false
    }

    foreach ($name in @("postgres.exe", "pg_ctl.exe", "initdb.exe", "createdb.exe", "psql.exe", "pg_isready.exe", "pg_dump.exe", "pg_restore.exe")) {
        if (-not (Test-Path -LiteralPath (Join-Path $pgBin $name))) {
            return $false
        }
    }
    return $true
}

function Get-SSDatabaseMaintenanceUrl {
    param($DatabaseInfo)

    $source = $env:DATABASE_URL
    if ([string]::IsNullOrWhiteSpace($source)) {
        return "postgresql://postgres@127.0.0.1:5432/postgres"
    }

    try {
        $uri = [Uri]$source
        $builder = [System.UriBuilder]::new($uri)
        $builder.Path = "postgres"
        $builder.Query = ""
        $builder.Fragment = ""
        return $builder.Uri.AbsoluteUri
    } catch {
        $user = if ($DatabaseInfo.User) { $DatabaseInfo.User } else { "postgres" }
        return "postgresql://$user@$($DatabaseInfo.Host):$($DatabaseInfo.Port)/postgres"
    }
}

function Initialize-SSRuntimePostgres {
    param(
        $DatabaseInfo,
        [switch]$Force
    )

    Assert-SSRuntimePostgresHost $DatabaseInfo

    $pgBin = Get-SSPostgresBinDir
    if (-not $pgBin) {
        throw "PostgreSQL runtime not found. Put PostgreSQL under runtime\pgsql or set SS_ERP_POSTGRES_BIN."
    }

    $dataDir = Get-SSRuntimePostgresDataDir
    Assert-SSRuntimePostgresDataDirSafe $dataDir
    $pgVersion = Join-Path $dataDir "PG_VERSION"
    if ((Test-Path -LiteralPath $pgVersion) -and -not $Force) {
        Write-SSOk "PostgreSQL data directory exists: $dataDir"
        return
    }

    if ((Test-Path -LiteralPath $dataDir) -and -not (Test-Path -LiteralPath $pgVersion)) {
        $hasContent = Get-ChildItem -LiteralPath $dataDir -Force -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($hasContent -and -not $Force) {
            throw "PostgreSQL data directory is not empty and has no PG_VERSION: $dataDir"
        }
    }

    if (-not (Test-Path -LiteralPath $dataDir)) {
        New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    }

    $initdb = Join-Path $pgBin "initdb.exe"
    $user = if ($DatabaseInfo.User) { $DatabaseInfo.User } else { "postgres" }
    Write-SSInfo "Initializing PostgreSQL data directory: $dataDir"
    & $initdb "-D" $dataDir "-E" "UTF8" "--locale=C" "-U" $user "--auth=trust"
    if ($LASTEXITCODE -ne 0) {
        throw "initdb failed with exit code $LASTEXITCODE"
    }

    Write-SSOk "PostgreSQL data directory initialized."
}

function Start-SSRuntimePostgres {
    param($DatabaseInfo)

    Assert-SSRuntimePostgresHost $DatabaseInfo

    $pgBin = Get-SSPostgresBinDir
    if (-not $pgBin) {
        throw "PostgreSQL runtime not found. Put PostgreSQL under runtime\pgsql or set SS_ERP_POSTGRES_BIN."
    }

    $dataDir = Get-SSRuntimePostgresDataDir
    Assert-SSRuntimePostgresDataDirSafe $dataDir
    $pgCtl = Join-Path $pgBin "pg_ctl.exe"
    $pgReady = Join-Path $pgBin "pg_isready.exe"
    $logPath = Join-Path (Get-SSLogDir) "postgres.log"

    if (Test-SSTcpPort $DatabaseInfo.Host $DatabaseInfo.Port) {
        $markerPath = Get-SSRuntimePostgresMarkerPath
        $marker = $null
        if (Test-Path -LiteralPath $markerPath) {
            try {
                $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
            } catch {
                throw "PostgreSQL port is already reachable at $($DatabaseInfo.Host):$($DatabaseInfo.Port), but runtime marker is invalid. Use start.ps1 without -UseRuntimePostgres for an existing service, or remove stale marker after checking $markerPath."
            }
        }

        if (Test-SSRuntimePostgresMarkerMatches $marker $DatabaseInfo $dataDir) {
            & $pgCtl "-D" $dataDir "status" 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0 -and (Test-SSRuntimePostgresConnectionMatches $DatabaseInfo $dataDir)) {
                Write-SSOk "Runtime PostgreSQL already running: $($DatabaseInfo.Host):$($DatabaseInfo.Port)"
                return
            }
        }
        throw "PostgreSQL port is already reachable at $($DatabaseInfo.Host):$($DatabaseInfo.Port), but it is not the matching script-managed runtime PostgreSQL. Use start.ps1 without -UseRuntimePostgres for an existing service, or change DATABASE_URL to a free local port."
    }

    Initialize-SSRuntimePostgres $DatabaseInfo

    Write-SSInfo "Starting runtime PostgreSQL on $($DatabaseInfo.Host):$($DatabaseInfo.Port)"
    $serverOptions = "-h 127.0.0.1 -p $($DatabaseInfo.Port)"
    & $pgCtl "-D" $dataDir "-l" $logPath "-o" $serverOptions "-w" "start"
    if ($LASTEXITCODE -ne 0) {
        throw "pg_ctl start failed with exit code $LASTEXITCODE. Check $logPath"
    }

    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        & $pgReady "-h" $DatabaseInfo.Host "-p" ([string]$DatabaseInfo.Port) "-d" "postgres" "-t" "1" | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $marker = @{
                startedAt = (Get-Date).ToString("o")
                pgBin = $pgBin
                dataDir = $dataDir
                host = $DatabaseInfo.Host
                port = $DatabaseInfo.Port
            } | ConvertTo-Json -Depth 3
            Set-Content -LiteralPath (Get-SSRuntimePostgresMarkerPath) -Value $marker -Encoding UTF8
            Write-SSOk "Runtime PostgreSQL started."
            return
        }
        Start-Sleep -Seconds 1
    }

    throw "Runtime PostgreSQL did not become ready within 30 seconds. Check $logPath"
}

function Stop-SSRuntimePostgres {
    $markerPath = Get-SSRuntimePostgresMarkerPath
    if (-not (Test-Path -LiteralPath $markerPath)) {
        Write-SSWarn "No runtime PostgreSQL marker found; leaving PostgreSQL untouched."
        return
    }

    $marker = $null
    try {
        $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
    } catch {
        Write-SSWarn "Runtime PostgreSQL marker is not valid JSON; leaving PostgreSQL untouched: $markerPath"
        return
    }

    $currentDb = Get-SSDatabaseInfo $env:DATABASE_URL
    if (-not (Test-SSRuntimePostgresHost $currentDb.Host)) {
        Write-SSWarn "Current DATABASE_URL host is not loopback; leaving runtime PostgreSQL untouched."
        Write-SSWarn "Marker: $markerPath"
        return
    }

    $expectedDataDir = Get-SSRuntimePostgresDataDir
    Assert-SSRuntimePostgresDataDirSafe $expectedDataDir
    if (-not (Test-SSRuntimePostgresMarkerMatches $marker $currentDb $expectedDataDir)) {
        Write-SSWarn "Runtime PostgreSQL marker does not match current DATABASE_URL/data dir; leaving PostgreSQL untouched."
        Write-SSWarn "Marker: $markerPath"
        return
    }

    if (-not (Test-SSRuntimePostgresConnectionMatches $currentDb $expectedDataDir)) {
        Write-SSWarn "Connected PostgreSQL data_directory does not match the runtime data dir; leaving PostgreSQL untouched."
        return
    }

    $pgBin = if ($marker.pgBin) { [string]$marker.pgBin } else { Get-SSPostgresBinDir }
    if (-not $pgBin) {
        Write-SSWarn "PostgreSQL runtime bin not found; cannot stop runtime PostgreSQL."
        return
    }

    $dataDir = $expectedDataDir
    $pgCtl = Join-Path $pgBin "pg_ctl.exe"
    if (-not (Test-Path -LiteralPath $pgCtl)) {
        Write-SSWarn "pg_ctl not found in marker runtime bin; leaving PostgreSQL untouched: $pgCtl"
        return
    }
    Write-SSInfo "Stopping runtime PostgreSQL: $dataDir"
    & $pgCtl "-D" $dataDir "-m" "fast" "-w" "stop"
    if ($LASTEXITCODE -ne 0) {
        Write-SSWarn "pg_ctl stop returned exit code $LASTEXITCODE."
    } else {
        Write-SSOk "Runtime PostgreSQL stopped."
        Remove-Item -LiteralPath $markerPath -Force -ErrorAction SilentlyContinue
    }
}

function Ensure-SSDatabaseExists {
    param($DatabaseInfo)

    $dbName = $DatabaseInfo.Database
    if ([string]::IsNullOrWhiteSpace($dbName)) {
        throw "DATABASE_URL does not include a database name."
    }

    $psql = Get-SSCommandPath "psql"
    if (-not $psql) {
        throw "psql not found. Install PostgreSQL client tools, or provide runtime\pgsql\bin."
    }

    $maintenanceUrl = Get-SSDatabaseMaintenanceUrl $DatabaseInfo
    Write-SSInfo "Ensuring PostgreSQL database exists: $dbName"

    $escapedName = $dbName.Replace("'", "''")
    $result = & $psql $maintenanceUrl "-tAc" "SELECT 1 FROM pg_database WHERE datname = '$escapedName'"
    if ($LASTEXITCODE -eq 0 -and (($result -join "").Trim() -eq "1")) {
        Write-SSOk "Database already exists: $dbName"
        return
    }

    $quotedName = '"' + $dbName.Replace('"', '""') + '"'
    & $psql $maintenanceUrl "-v" "ON_ERROR_STOP=1" "-c" "CREATE DATABASE $quotedName"
    if ($LASTEXITCODE -eq 0) {
        Write-SSOk "Database created: $dbName"
        return
    }

    throw "CREATE DATABASE failed with exit code $LASTEXITCODE for database $dbName"
}

function Test-SSDatabaseConnection {
    $psql = Get-SSCommandPath "psql"
    if (-not $psql) {
        Write-SSWarn "psql not found; cannot verify target database connection."
        return $false
    }

    if ([string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
        Write-SSWarn "DATABASE_URL is empty; cannot verify target database connection."
        return $false
    }

    $result = & $psql $env:DATABASE_URL "-tAc" "SELECT 1" 2>$null
    if ($LASTEXITCODE -eq 0 -and (($result -join "").Trim() -eq "1")) {
        return $true
    }
    return $false
}
