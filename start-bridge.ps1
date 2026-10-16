$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw '未找到 Node.js，请安装 Node.js 20 或更新版本并重新打开终端。'
}
if (-not (Get-Command codex -ErrorAction SilentlyContinue) -and -not $env:CODEX_BIN) {
    throw '未找到 codex。请将 Codex CLI 加入 PATH，或设置环境变量 CODEX_BIN 指向 codex.exe。'
}
node (Join-Path $PSScriptRoot 'bridge.mjs')
