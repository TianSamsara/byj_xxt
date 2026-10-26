# Source for the self-contained install-byj-bridge.cmd. No Git, Node installation or repository checkout is required.
function Install-BYJBridge {
    param([Parameter(Mandatory=$true)]$Payload, [string]$InstallRoot, [switch]$NoRegister, [switch]$NoStart)
    $ErrorActionPreference = 'Stop'
    Initialize-BridgePowerShell
    $expectedFiles = @('bridge.mjs','bridge-pool.mjs','bridge-setup.mjs','bridge-runtime.ps1','start-bridge.ps1','install-bridge-launcher.ps1')
    $decoded = @{}
    foreach ($file in $expectedFiles) {
        $entry = $Payload.files.$file
        if (-not $entry) { throw "安装包缺少文件：$file" }
        $bytes = [Convert]::FromBase64String($entry.data)
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $hash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
        if ($hash -ne $entry.sha256) { throw "安装包文件校验失败：$file" }
        $decoded[$file] = $bytes
    }
    $registry = 'HKCU:\Software\Classes\byj-codex'
    $existing = (Get-ItemProperty -LiteralPath "$registry\shell\open\command" -ErrorAction SilentlyContinue).'(default)'
    if (-not $InstallRoot) {
        # Repair our existing registration in place, including installations made from a full checkout.
        if ($existing) {
            $label = (Get-Item -LiteralPath $registry).GetValue('')
            if ($label -ne 'URL:BYJ Local Codex Bridge' -or $existing -notmatch '-File "([^"\r\n]+\\start-bridge\.ps1)" -Background -CopyKey$') { throw '本机同名启动入口属于其他程序，未覆盖。请先检查或卸载旧入口。' }
            $InstallRoot = Split-Path $Matches[1]
        } else { $InstallRoot = Join-Path $env:LOCALAPPDATA 'BYJCodexBridge' }
    }
    $target = [IO.Path]::GetFullPath($InstallRoot)
    if ($target -eq [IO.Path]::GetPathRoot($target)) { throw '安装目录不能是磁盘根目录。' }
    $marker = Join-Path $target 'installation.json'
    if (Test-Path -LiteralPath $target) {
        if ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '安装目录是链接，请选择普通目录。' }
        $items = @(Get-ChildItem -LiteralPath $target -Force)
        if ($items.Count) {
            $owned = $false
            if (Test-Path -LiteralPath $marker) { try { $owned = (Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json).owner -eq 'byj-codex-bridge' } catch {} }
            $legacy = $existing -and $existing.Contains('"' + (Join-Path $target 'start-bridge.ps1') + '"') -and (Test-Path -LiteralPath (Join-Path $target 'bridge.mjs')) -and (Test-Path -LiteralPath (Join-Path $target '.bridge-token'))
            if (-not $owned -and -not $legacy) { throw '安装目录已有其他内容，未覆盖。请使用空目录。' }
        }
    }
    $mutex = New-Object Threading.Mutex($false, 'Local\ByjCodexBridgeInstaller')
    $locked = $false; $stopped = $false; $changed = $false; $backup = $null; $hadServer = $false
    $launchMutex = $null; $launchLocked = $false
    try {
        try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
        if (-not $locked) { throw '另一个安装正在进行，请等待完成。' }
        New-Item -ItemType Directory -Path $target -Force | Out-Null
        @{ owner = 'byj-codex-bridge'; version = $Payload.version } | ConvertTo-Json | Set-Content -LiteralPath $marker -Encoding UTF8
        Write-Host '正在检测本机 Codex 和运行组件…'
        $runtime = Resolve-BridgeRuntime $target -AllowDownload
        $launchMutex = New-Object Threading.Mutex($false, 'Local\ByjCodexBridgeLauncher')
        try { $launchLocked = $launchMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $launchLocked = $true }
        if (-not $launchLocked) { throw '桥接正在启动，请等待启动完成后重试安装。' }
        $work = Join-Path $target '.bridge-work'; New-Item -ItemType Directory -Path $work -Force | Out-Null
        $keyFile = Join-Path $target '.bridge-token'; $headers = $null
        if (Test-Path -LiteralPath $keyFile) {
            $key = (Get-Content -LiteralPath $keyFile -Raw).Trim()
            if ($key -notmatch '^[a-f0-9]{64}$') { throw '原密钥文件格式不正确，未覆盖。' }
            $headers = @{ Authorization = "Bearer $key" }
        }
        $listener = Get-NetTCPConnection -LocalPort 17653 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($listener) {
            $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
            $serverFile = Join-Path $target 'bridge.mjs'
            $serverPattern = '(?:"' + [regex]::Escape($serverFile) + '"|(?:^|\s)' + [regex]::Escape($serverFile) + '(?:\s|$))'
            if ($listener.LocalAddress -ne '127.0.0.1' -or -not $owner -or $owner.Name -ne 'node.exe' -or $owner.CommandLine -notmatch $serverPattern -or -not $headers) { throw '17653 端口属于其他服务，未停止任何程序。' }
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:17653/health' -Headers $headers -TimeoutSec 3
            if ($health.service -ne 'byj-codex-bridge') { throw '端口服务身份不匹配，未停止任何程序。' }
            $hadServer = $true
            Write-Host '正在等待作答结束并备份原桥接…'
            $deadline = (Get-Date).AddSeconds(60)
            while ($health.active -gt 0) {
                if ((Get-Date) -ge $deadline) { throw '当前仍在作答，未替换桥接；请暂停作答后重新安装。' }
                Start-Sleep -Milliseconds 500
                $health = Invoke-RestMethod -Uri 'http://127.0.0.1:17653/health' -Headers $headers -TimeoutSec 3
            }
        }
        $backup = Join-Path $work ('backups\' + [guid]::NewGuid().ToString())
        New-Item -ItemType Directory -Path $backup -Force | Out-Null
        foreach ($file in $expectedFiles) { if (Test-Path -LiteralPath (Join-Path $target $file)) { Copy-Item -LiteralPath (Join-Path $target $file) -Destination (Join-Path $backup $file) } }
        $config = Join-Path $work 'launcher.json'
        if (Test-Path -LiteralPath $config) { Copy-Item -LiteralPath $config -Destination (Join-Path $backup 'launcher.json') }
        if ($hadServer) {
            $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($owner.ProcessId)"
            if (-not $current -or $current.CreationDate -ne $owner.CreationDate -or $current.CommandLine -ne $owner.CommandLine) { throw '桥接进程已改变，未停止任何程序。' }
            & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $owner.ProcessId /T /F 2>$null | Out-Null
            if ($LASTEXITCODE -ne 0) { throw '无法停止旧桥接，未替换源码。' }
            $stopped = $true
        }
        Write-Host '正在安装桥接和启动入口，原密钥保留…'
        $changed = $true
        foreach ($file in $expectedFiles) { [IO.File]::WriteAllBytes((Join-Path $target $file), $decoded[$file]) }
        $runtime | ConvertTo-Json | Set-Content -LiteralPath $config -Encoding UTF8
        if (-not $NoRegister) { & (Join-Path $target 'install-bridge-launcher.ps1') | Out-Null }
        $launchMutex.ReleaseMutex(); $launchLocked = $false
        if (-not $NoStart) {
            & (Join-Path $target 'start-bridge.ps1') -Background | Out-Null
            try { Set-Clipboard -Value ((Get-Content -LiteralPath $keyFile -Raw).Trim()) } catch { Write-Warning '剪贴板暂时不可用，请返回脚本点击“复制本地密钥”。' }
        }
        return @{ root = $target; version = $Payload.version; started = -not $NoStart; registered = -not $NoRegister }
    } catch {
        if ($changed -and $backup) {
            try {
                foreach ($file in $expectedFiles) {
                    if (Test-Path -LiteralPath (Join-Path $backup $file)) { Copy-Item -LiteralPath (Join-Path $backup $file) -Destination (Join-Path $target $file) -Force }
                    elseif (Test-Path -LiteralPath (Join-Path $target $file)) { Remove-Item -LiteralPath (Join-Path $target $file) }
                }
                if (Test-Path -LiteralPath (Join-Path $backup 'launcher.json')) { Copy-Item -LiteralPath (Join-Path $backup 'launcher.json') -Destination (Join-Path $target '.bridge-work\launcher.json') -Force }
                if ($launchLocked) { $launchMutex.ReleaseMutex(); $launchLocked = $false }
                if ($stopped) { & (Join-Path $target 'start-bridge.ps1') -Background | Out-Null }
            } catch { Write-Warning '恢复旧桥接时遇到问题，请检查安装目录中的日志。' }
        }
        throw
    } finally { if ($launchLocked) { $launchMutex.ReleaseMutex() }; if ($launchMutex) { $launchMutex.Dispose() }; if ($locked) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
}
