# Shared by the one-file installer and the registered launcher. No machine-specific paths are shipped.
function Initialize-BridgePowerShell {
    [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
    $env:PSModulePath = (Join-Path $PSHOME 'Modules') + ';' + (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules')
}
function Test-BridgeExe([string]$File, [string]$Kind) {
    if (-not $File -or -not [IO.Path]::IsPathRooted($File) -or [IO.Path]::GetExtension($File) -ne '.exe' -or -not (Test-Path -LiteralPath $File -PathType Leaf)) { return $false }
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $File; $info.Arguments = '--version'; $info.UseShellExecute = $false
    $info.CreateNoWindow = $true; $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process; $process.StartInfo = $info
    try {
        if (-not $process.Start()) { return $false }
        if (-not $process.WaitForExit(5000)) { $process.Kill(); return $false }
        $value = $process.StandardOutput.ReadToEnd().Trim()
        if ($process.ExitCode -ne 0) { return $false }
        if ($Kind -eq 'node') { return $value -match '^v(\d+)\.' -and [int]$Matches[1] -ge 20 }
        return $value -match '^codex[- ]cli\s'
    } catch { return $false } finally { $process.Dispose() }
}
function Find-BridgeCodex {
    $candidates = @($env:CODEX_BIN)
    $command = Get-Command codex.exe -ErrorAction SilentlyContinue
    if ($command) { $candidates += $command.Source }
    $bin = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'
    $candidates += Join-Path $bin 'codex.exe'
    foreach ($folder in @(Get-ChildItem -LiteralPath $bin -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 40)) {
        $candidates += Join-Path $folder.FullName 'codex.exe'
        $candidates += Join-Path $folder.FullName 'resources\codex.exe'
    }
    foreach ($base in @((Join-Path $env:LOCALAPPDATA 'Programs\Codex'), (Join-Path $env:LOCALAPPDATA 'Programs\OpenAI Codex'))) {
        $candidates += Join-Path $base 'resources\codex.exe'
    }
    # Store installations and currently opened desktop apps need not be on PATH.
    try {
        foreach ($app in @(Get-AppxPackage '*Codex*' -ErrorAction SilentlyContinue | Select-Object -First 8)) {
            foreach ($relative in @('app\resources\codex.exe', 'resources\codex.exe', 'bin\codex.exe')) { $candidates += Join-Path $app.InstallLocation $relative }
        }
    } catch {}
    try {
        foreach ($app in @(Get-CimInstance Win32_Process -Filter "Name='Codex.exe'" -ErrorAction SilentlyContinue | Select-Object -First 8)) {
            if ($app.ExecutablePath) {
                $candidates += Join-Path (Split-Path $app.ExecutablePath) 'resources\codex.exe'
                if ($app.ExecutablePath -match '\\(?:bin|resources)\\.*codex\.exe$') { $candidates += $app.ExecutablePath }
            }
        }
    } catch {}
    foreach ($npm in @((Join-Path $env:APPDATA 'npm\node_modules'), (Join-Path $env:ProgramFiles 'nodejs\node_modules'))) {
        foreach ($arch in @('x64', 'arm64')) {
            $target = if ($arch -eq 'arm64') { 'aarch64-pc-windows-msvc' } else { 'x86_64-pc-windows-msvc' }
            $candidates += Join-Path $npm "@openai\codex-win32-$arch\vendor\$target\codex\codex.exe"
            $candidates += Join-Path $npm "@openai\codex\node_modules\@openai\codex-win32-$arch\vendor\$target\codex\codex.exe"
            $candidates += Join-Path $npm "@openai\codex\vendor\$target\codex\codex.exe"
        }
    }
    foreach ($file in @($candidates | Where-Object { $_ } | Select-Object -Unique)) { if (Test-BridgeExe $file 'codex') { return (Resolve-Path -LiteralPath $file).Path } }
    throw '未找到 Codex 的本地命令组件。请先安装并打开官方 Codex、完成 ChatGPT 登录后，再运行此安装器。'
}
function Find-BridgeNode([string]$Root, [switch]$AllowDownload) {
    $candidates = @((Join-Path $Root 'runtime\node.exe'))
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($command) { $candidates += $command.Source }
    $runtime = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\runtimes\cua_node'
    foreach ($folder in @(Get-ChildItem -LiteralPath $runtime -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 12)) { $candidates += Join-Path $folder.FullName 'bin\node.exe' }
    foreach ($file in $candidates) { if (Test-BridgeExe $file 'node') { return (Resolve-Path -LiteralPath $file).Path } }
    if (-not $AllowDownload) { throw '运行组件已失效，请点击“安装／修复本地桥接”重新安装；密钥会保留。' }
    Write-Host '正在准备运行组件（首次下载可能需要一些时间）…'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $arch = if ($env:PROCESSOR_ARCHITEW6432 -eq 'ARM64' -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    $version = 'v24.22.1'
    $base = "https://nodejs.org/dist/$version"
    $relative = "win-$arch/node.exe"
    $sums = (Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt" -TimeoutSec 45 -MaximumRedirection 0).Content
    $pattern = '(?m)^([a-f0-9]{64})\s+' + [regex]::Escape($relative) + '\s*$'
    if ($sums -notmatch $pattern) { throw '无法核对运行组件版本，请检查网络后重试。' }
    $expected = $Matches[1]
    $pinned = @{ x64 = 'd702daa815eabbff763c7d3808e235cf031cf2ca70211b56847bc72f51e240e5'; arm64 = '8bea91dc437fe01e7d92ef0efc6c9eaf654369aaba9b2d3e9841552ea7b95a00' }
    if ($expected -ne $pinned[$arch]) { throw '运行组件清单与内置校验不匹配，未下载或运行。' }
    $directory = Join-Path $Root 'runtime'; New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $temporary = Join-Path $directory ('node-' + [guid]::NewGuid().ToString() + '.download')
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "$base/$relative" -OutFile $temporary -TimeoutSec 180 -MaximumRedirection 0
        if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw '运行组件校验失败，未启动下载内容。' }
        $destination = Join-Path $directory 'node.exe'
        Move-Item -LiteralPath $temporary -Destination $destination -Force
        if (-not (Test-BridgeExe $destination 'node')) { throw '运行组件无法启动，请检查系统架构或安全软件提示。' }
        return $destination
    } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary } }
}
function Resolve-BridgeRuntime([string]$Root, [switch]$AllowDownload) {
    $codex = Find-BridgeCodex
    $node = Find-BridgeNode $Root -AllowDownload:$AllowDownload
    return @{ node = $node; codex = $codex }
}
