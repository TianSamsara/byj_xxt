"""Generate a downloadable, self-contained Windows installer; never bundle local settings or credentials."""
from pathlib import Path
import base64
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parent
FILES = ('bridge.mjs', 'bridge-pool.mjs', 'bridge-setup.mjs', 'bridge-runtime.ps1', 'start-bridge.ps1', 'install-bridge-launcher.ps1')

def build():
    payload = {'version': json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version'], 'files': {}}
    for name in FILES:
        # PowerShell 5.1 needs a BOM for the Chinese messages; normalize for reproducible builds.
        data = (ROOT / name).read_text(encoding='utf-8-sig').replace('\r\n', '\n').encode('utf-8')
        if name.endswith('.ps1'):
            data = b'\xef\xbb\xbf' + data
        payload['files'][name] = {'sha256': hashlib.sha256(data).hexdigest(), 'data': base64.b64encode(data).decode('ascii')}
    encoded = base64.b64encode(json.dumps(payload, ensure_ascii=True, separators=(',', ':')).encode()).decode()
    header = '''@echo off
setlocal
set "BYJ_INSTALL_SOURCE=%~f0"
"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -STA -ExecutionPolicy Bypass -Command "$text=[IO.File]::ReadAllText($env:BYJ_INSTALL_SOURCE,[Text.Encoding]::UTF8); $marker='# BYJ_INSTALL_'+'POWERSHELL'; & ([ScriptBlock]::Create($text.Substring($text.IndexOf($marker)+$marker.Length)))"
if errorlevel 1 pause
exit /b
# BYJ_INSTALL_POWERSHELL
'''
    runtime = (ROOT / 'bridge-runtime.ps1').read_text(encoding='utf-8-sig')
    installer = (ROOT / 'install-local-bridge.ps1').read_text(encoding='utf-8-sig')
    entry = '''
$ErrorActionPreference = 'Stop'
try {
    $payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ByjPayload)) | ConvertFrom-Json
    $result = Install-BYJBridge -Payload $payload
    Write-Host '安装完成。返回学习通，在密钥框按 Ctrl+V，再获取模型并保存。以后直接点击启动本地桥接。'
    Write-Host ('安装位置：' + $result.root)
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show('本地桥接已安装并启动。密钥已尝试复制到剪贴板，返回学习通粘贴后获取模型。复制失败时可用脚本中的“复制本地密钥”。', '白玉京 · 安装完成') | Out-Null
} catch {
    Write-Host ('安装未完成：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
'''
    source = header + runtime + '\n' + installer + "\n$ByjPayload = '" + encoded + "'\n" + entry
    command = source.replace('\r\n', '\n').replace('\n', '\r\n').encode('utf-8')
    (ROOT / 'install-byj-bridge.cmd').write_bytes(command)
    info = zipfile.ZipInfo('install-byj-bridge.cmd', (2026, 10, 26, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    with zipfile.ZipFile(ROOT / 'install-byj-bridge.zip', 'w') as archive:
        archive.writestr(info, command)
    return payload

if __name__ == '__main__':
    result = build()
    print(f"已生成 install-byj-bridge.zip / .cmd，版本 {result['version']}，包含 {len(result['files'])} 个程序文件")
