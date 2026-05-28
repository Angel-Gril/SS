$src = 'D:\AI Agent\Work\QE\SS ERP\build\scripts\start.bat'
$dst = 'D:\AI Agent\Work\QE\SS ERP\build\dist\SS-ERP-1.0.2\start.bat'
$content = [IO.File]::ReadAllText($src)
$lf = [regex]::Replace($content, "`r`n", "`n")
$crlf = [regex]::Replace($lf, "`n", "`r`n")
[IO.File]::WriteAllText($dst, $crlf, (New-Object System.Text.UTF8Encoding $false))
Write-Host "synced, size=$((Get-Item $dst).Length)"
