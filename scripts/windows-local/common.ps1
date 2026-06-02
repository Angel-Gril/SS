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
}

function Get-SSCommandPath {
    param([string]$Name)

    $candidates = @()
    if ($Name -eq "pnpm") {
        $candidates = @("pnpm.cmd", "pnpm.exe", "pnpm")
    } elseif ($Name -eq "node") {
        $candidates = @("node.exe", "node.cmd", "node")
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
