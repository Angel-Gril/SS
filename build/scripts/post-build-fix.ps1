# SS ERP post-build fix script
# Run after build-windows.ps1 to fix pnpm symlink issues in the dist
# Usage: powershell -NoProfile -File build/scripts/post-build-fix.ps1 [-Dist <path>]
param(
    [string]$Dist = ""
)

$ErrorActionPreference = "Stop"

if (-not $Dist) {
    $Dist = Join-Path (Resolve-Path "$PSScriptRoot/../..").Path "build/dist/SS-ERP-1.0.0"
}
if (-not (Test-Path $Dist)) { throw "Dist not found: $Dist" }

$root = (Resolve-Path "$PSScriptRoot/../..").Path
Write-Host "== Post-build fix ==" -ForegroundColor Cyan
Write-Host "Dist: $Dist"
Write-Host "Root: $root"
Write-Host ""

# ---------- 1. Server: top-level packages -> junction into .pnpm ----------
Write-Host "[1/4] Server node_modules junction..." -ForegroundColor Yellow
$serverNm = Join-Path $Dist "apps/server/node_modules"
$serverPnpm = Join-Path $serverNm ".pnpm"
$pnpmDirs = @(Get-ChildItem $serverPnpm -Directory -ErrorAction SilentlyContinue)

function Find-PnpmPkg {
    param($name, $dirs)
    $prefix = if ($name -match '^@') { ($name -replace '/', '+') + '@' } else { "$name@" }
    $match = $dirs | Where-Object { $_.Name -like "$prefix*" } | Sort-Object { $_.Name.Length } | Select-Object -First 1
    if (-not $match) { return $null }
    $p = Join-Path $match.FullName "node_modules\$name"
    if (Test-Path $p) { return $p }
    return $null
}

$count = 0
$topItems = Get-ChildItem $serverNm -Force | Where-Object {
    $_.PSIsContainer -and $_.Name -notin @('.pnpm','.bin','.cache','.modules.yaml','@types','.prisma')
}
foreach ($it in $topItems) {
    if ($it.Name -like '@*') {
        foreach ($child in (Get-ChildItem $it.FullName -Force)) {
            $real = Find-PnpmPkg "$($it.Name)/$($child.Name)" $pnpmDirs
            if (-not $real) { continue }
            Remove-Item $child.FullName -Recurse -Force -ErrorAction SilentlyContinue
            cmd /c "mklink /J `"$($child.FullName)`" `"$real`"" 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) { $count++ }
        }
        continue
    }
    if ($it.Name -eq 'shared') { continue }
    $real = Find-PnpmPkg $it.Name $pnpmDirs
    if (-not $real) { continue }
    Remove-Item $it.FullName -Recurse -Force -ErrorAction SilentlyContinue
    cmd /c "mklink /J `"$($it.FullName)`" `"$real`"" 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $count++ }
}
Write-Host "  -> $count junction created" -ForegroundColor Green

# ---------- 2. Server: .prisma/client ----------
Write-Host "[2/4] Copy .prisma/client..." -ForegroundColor Yellow
$srcDotPrisma = Get-ChildItem (Join-Path $root "node_modules/.pnpm") -Filter "@prisma+client@*" -Directory -ErrorAction SilentlyContinue |
    Select-Object -First 1 | ForEach-Object { Join-Path $_.FullName "node_modules/.prisma" }
$dstPrismaTarget = Get-ChildItem $serverPnpm -Filter "@prisma+client@*" -Directory -ErrorAction SilentlyContinue |
    Select-Object -First 1 | ForEach-Object { Join-Path $_.FullName "node_modules/.prisma" }

if ($srcDotPrisma -and (Test-Path $srcDotPrisma) -and $dstPrismaTarget -and -not (Test-Path $dstPrismaTarget)) {
    & robocopy $srcDotPrisma $dstPrismaTarget /E /NFL /NDL /NJH /NJS `
        /XF "libquery_engine-*.so*" "libquery_engine-*.dylib*" `
            "schema-engine-linux*" "schema-engine-darwin*" `
            "query_engine-linux*" "query_engine-darwin*" 2>&1 | Out-Null
    Write-Host "  -> copied" -ForegroundColor Green
} elseif (Test-Path $dstPrismaTarget) {
    Write-Host "  -> already exists" -ForegroundColor DarkGray
} else {
    Write-Host "  -> SKIP (source not found)" -ForegroundColor Red
}

# ---------- 3. Web standalone: flatten .pnpm packages to top-level node_modules ----------
Write-Host "[3/4] Web standalone flatten..." -ForegroundColor Yellow
$webOut = Join-Path $Dist "apps/web"
$webNm = Join-Path $webOut "node_modules"
$webPnpm = Join-Path $webNm ".pnpm"
$flatCount = 0
if (Test-Path $webPnpm) {
    $pnpmPkgs = Get-ChildItem $webPnpm -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne "node_modules" }
    foreach ($pkgDir in $pnpmPkgs) {
        $nmDir = Join-Path $pkgDir.FullName "node_modules"
        if (-not (Test-Path $nmDir)) { continue }
        Get-ChildItem $nmDir -Force | ForEach-Object {
            $targetTop = Join-Path $webNm $_.Name
            if ($_.Name -like '@*') {
                Get-ChildItem $_.FullName -Force | ForEach-Object {
                    $scopedTarget = Join-Path $targetTop $_.Name
                    if (-not (Test-Path $scopedTarget)) {
                        $parentDir = Split-Path $scopedTarget -Parent
                        if (-not (Test-Path $parentDir)) { New-Item -ItemType Directory $parentDir -Force | Out-Null }
                        cmd /c "mklink /J `"$scopedTarget`" `"$($_.FullName)`"" 2>&1 | Out-Null
                        if ($LASTEXITCODE -eq 0) { $script:flatCount++ }
                    }
                }
            } else {
                if (-not (Test-Path $targetTop)) {
                    cmd /c "mklink /J `"$targetTop`" `"$($_.FullName)`"" 2>&1 | Out-Null
                    if ($LASTEXITCODE -eq 0) { $script:flatCount++ }
                }
            }
        }
    }
}
Write-Host "  -> $flatCount packages flattened" -ForegroundColor Green

# ---------- 4. Batch files: ensure CRLF ----------
Write-Host "[4/4] CRLF batch files..." -ForegroundColor Yellow
Get-ChildItem $Dist -Filter "*.bat" | ForEach-Object {
    $content = [System.IO.File]::ReadAllText($_.FullName)
    $normalized = $content -replace "`r`n","`n" -replace "`n","`r`n"
    [System.IO.File]::WriteAllText($_.FullName, $normalized, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "  -> $($_.Name)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "== Done ==" -ForegroundColor Green
