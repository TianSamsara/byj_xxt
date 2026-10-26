# Registers a fixed, per-user action. Incoming URI text is deliberately never passed to PowerShell.
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'bridge-runtime.ps1')
Initialize-BridgePowerShell
$protocolKey = 'HKCU:\Software\Classes\byj-codex'
$launchScript = Join-Path $PSScriptRoot 'start-bridge.ps1'
$existingCommand = (Get-ItemProperty -LiteralPath "$protocolKey\shell\open\command" -ErrorAction SilentlyContinue).'(default)'
if ($existingCommand -and -not $existingCommand.Contains('"' + $launchScript + '"')) {
    throw 'byj-codex 协议已被其他目录占用，请先从原目录卸载启动器。'
}
if ($Uninstall) {
    if (Test-Path -LiteralPath $protocolKey) { Remove-Item -LiteralPath $protocolKey -Recurse -Force }
    Write-Output '已卸载本目录的桥接启动器；桥接文件和密钥保留。'
    return
}
$runtime = Resolve-BridgeRuntime $PSScriptRoot -AllowDownload
$nodeBinary = $runtime.node
$codexBinary = $runtime.codex
foreach ($binary in @($nodeBinary, $codexBinary)) {
    if ([System.IO.Path]::GetExtension($binary) -ne '.exe' -or -not (Test-Path -LiteralPath $binary -PathType Leaf)) {
        throw '启动器需要 node.exe 和 codex.exe；可用 CODEX_BIN 指定本机 Codex 可执行文件。'
    }
}
$workDirectory = Join-Path $PSScriptRoot '.bridge-work'
New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null
@{ node = $nodeBinary; codex = $codexBinary } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $workDirectory 'launcher.json') -Encoding UTF8
$powershellBinary = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
# No %1 substitution: links can only start this project's bridge, never supply commands or secrets.
$launchCommand = '"{0}" -NoProfile -NonInteractive -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "{1}" -Background -CopyKey' -f $powershellBinary, $launchScript
New-Item -Path "$protocolKey\shell\open\command" -Force | Out-Null
Set-Item -LiteralPath $protocolKey -Value 'URL:BYJ Local Codex Bridge'
New-ItemProperty -LiteralPath $protocolKey -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
Set-Item -LiteralPath "$protocolKey\shell\open\command" -Value $launchCommand
Write-Output '桥接启动器已注册。安装新版油猴脚本后，可在 AI 连接中点击“启动本地桥接”。'
Write-Output '此注册仅作用于当前 Windows 用户，不设置开机自启。项目移动或运行时更新后请重新注册。'
