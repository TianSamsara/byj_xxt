param([switch]$Background)

$ErrorActionPreference = 'Stop'
$bridgeRoot = $PSScriptRoot
$bridgeFile = Join-Path $bridgeRoot 'bridge.mjs'
$workDirectory = Join-Path $bridgeRoot '.bridge-work'
$launcherConfig = Join-Path $workDirectory 'launcher.json'
$launcherMutex = New-Object System.Threading.Mutex($false, 'Local\ByjCodexBridgeLauncher')
$launcherLock = $false
try {
    try { $launcherLock = $launcherMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $launcherLock = $true }
    if (-not $launcherLock) { Write-Output '另一个桥接启动请求正在处理。'; return }
    if (Test-Path -LiteralPath $launcherConfig) {
        $runtime = Get-Content -LiteralPath $launcherConfig -Raw | ConvertFrom-Json
        $nodeBinary = $runtime.node
        $codexBinary = $runtime.codex
    } else {
        $nodeBinary = (Get-Command node -ErrorAction Stop).Source
        $codexBinary = if ($env:CODEX_BIN) { $env:CODEX_BIN } else { (Get-Command codex -ErrorAction Stop).Source }
    }
    foreach ($binary in @($nodeBinary, $codexBinary)) {
        if (-not $binary -or -not [System.IO.Path]::IsPathRooted($binary) -or -not (Test-Path -LiteralPath $binary -PathType Leaf)) {
            throw 'Node.js 或 Codex 路径已失效，请重新运行 install-bridge-launcher.ps1。'
        }
    }
    $env:CODEX_BIN = $codexBinary
    $listeners = @(Get-NetTCPConnection -LocalPort 17653 -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count) {
        foreach ($listener in $listeners) {
            $running = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
            if ($listener.LocalAddress -ne '127.0.0.1' -or $running.ExecutablePath -ne $nodeBinary -or
                -not $running.CommandLine.Contains($bridgeFile)) {
                throw '17653 端口被其他服务占用，请先检查端口。'
            }
        }
        $token = (Get-Content -LiteralPath (Join-Path $bridgeRoot '.bridge-token') -Raw).Trim()
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:17653/health' -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 3
        if ($health.service -ne 'byj-codex-bridge') { throw '桥接状态异常。' }
        Write-Output '桥接已在运行，无需重复启动。'
        return
    }
    if (-not $Background) {
        Set-Location -LiteralPath $bridgeRoot
        & $nodeBinary $bridgeFile
        return
    }
    New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null
    $child = Start-Process -FilePath $nodeBinary -ArgumentList ('"{0}"' -f $bridgeFile) -WorkingDirectory $bridgeRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $workDirectory 'bridge.stdout.log') -RedirectStandardError (Join-Path $workDirectory 'bridge.stderr.log')
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 200
        if ($child.HasExited) { throw '桥接进程已退出，请检查 .bridge-work/bridge.stderr.log。' }
        try {
            $token = (Get-Content -LiteralPath (Join-Path $bridgeRoot '.bridge-token') -Raw).Trim()
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:17653/health' -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 1
            if ($health.service -eq 'byj-codex-bridge') { Write-Output "桥接已在后台启动（PID $($child.Id)）。"; return }
        } catch { if ($attempt -eq 29) { throw '桥接启动超时，请检查 .bridge-work 中的日志。' } }
    }
} finally {
    if ($launcherLock) { $launcherMutex.ReleaseMutex() }
    $launcherMutex.Dispose()
}
