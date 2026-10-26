import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const run = promisify(execFile), root = fileURLToPath(new URL('./', import.meta.url));
const text = readFileSync(new URL('./install-byj-bridge.cmd', import.meta.url), 'utf8');
const payload = JSON.parse(Buffer.from(text.match(/\$ByjPayload = '([A-Za-z0-9+/=]+)'/)?.[1] || '', 'base64').toString('utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
test('one-file installer bundles all dependencies reproducibly and excludes secrets and user settings', () => {
  assert.equal(payload.version, '0.15.0');
  assert.deepEqual(Object.keys(payload.files).sort(), ['bridge.mjs','bridge-pool.mjs','bridge-setup.mjs','bridge-runtime.ps1','start-bridge.ps1','install-bridge-launcher.ps1'].sort());
  for (const [name, entry] of Object.entries(payload.files)) {
    let source = readFileSync(path.join(root, name), 'utf8').replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
    if (name.endsWith('.ps1')) source = '\uFEFF' + source;
    const bytes = Buffer.from(entry.data, 'base64'); assert.equal(digest(bytes), entry.sha256); assert.deepEqual(bytes, Buffer.from(source));
  }
  assert.doesNotMatch(text, /C:\\Users\\tians|D:\\xkf|Bearer [a-f0-9]{64}|%1/);
  assert.ok(text.indexOf('exit /b') < text.indexOf('\n# BYJ_INSTALL_POWERSHELL'));
  const sources = ['bridge-runtime.ps1', 'install-local-bridge.ps1'].map(name => readFileSync(path.join(root, name), 'utf8').replace(/^\uFEFF/, '').replaceAll('\r\n', '\n'));
  for (const source of sources) assert.ok(text.replaceAll('\r\n', '\n').includes(source));
});
test('the download ZIP contains exactly the standalone installer', () => {
  const zip = readFileSync(new URL('./install-byj-bridge.zip', import.meta.url));
  assert.equal(zip.readUInt32LE(0), 0x04034b50); assert.equal(zip.readUInt16LE(8), 8);
  const nameLength = zip.readUInt16LE(26), start = 30 + nameLength + zip.readUInt16LE(28);
  assert.equal(zip.subarray(30, 30 + nameLength).toString(), 'install-byj-bridge.cmd');
  assert.equal(inflateRawSync(zip.subarray(start, start + zip.readUInt32LE(18))).toString('utf8'), text);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50); assert.equal(zip.readUInt16LE(zip.length - 12), 1);
});

const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const quote = value => "'" + value.replaceAll("'", "''") + "'";
async function powershell(script, env = process.env) {
  const prefix = `[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false); $writer = New-Object IO.StreamWriter([Console]::OpenStandardError(),(New-Object Text.UTF8Encoding($false))); $writer.AutoFlush = $true; [Console]::SetError($writer); $ProgressPreference = 'SilentlyContinue'; $ErrorActionPreference = 'Stop'; . ${quote(path.join(root, 'bridge-runtime.ps1'))}; Initialize-BridgePowerShell; . ${quote(path.join(root, 'install-local-bridge.ps1'))}; `;
  const operation = prefix + 'try { ' + script + ' } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }';
  return run(ps, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(operation, 'utf16le').toString('base64')], { windowsHide: true, timeout: 45000, env });
}
test('Windows installs with Codex alone and no Node on PATH, preserves keys, and rejects corrupt or unknown contents', { skip: process.platform !== 'win32', timeout: 90000 }, async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'byj-installer-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const target = path.join(temporary, 'bridge with spaces'), payloadFile = path.join(temporary, 'payload.json');
  await fs.writeFile(payloadFile, JSON.stringify(payload));
  const env = { ...process.env, PATH: path.join(process.env.SystemRoot, 'System32') }; delete env.Path; delete env.CODEX_BIN;
  const load = `$p = Get-Content -LiteralPath ${quote(payloadFile)} -Raw | ConvertFrom-Json; `;
  const install = `Install-BYJBridge -Payload $p -InstallRoot ${quote(target)} -NoRegister -NoStart | ConvertTo-Json -Compress`;
  const result = await powershell(load + install, env);
  assert.match(result.stdout, /"started":false/);
  const settingsFile = path.join(target, '.bridge-work', 'launcher.json'); const config = JSON.parse((await fs.readFile(settingsFile, 'utf8')).replace(/^\uFEFF/, ''));
  assert.match(config.node, /OpenAI[\\/]Codex[\\/]runtimes[\\/]cua_node/); assert.match(config.codex, /codex\.exe$/i);
  const key = 'b'.repeat(64) + '\n'; await fs.writeFile(path.join(target, '.bridge-token'), key);
  await powershell(load + install, env);
  assert.equal(await fs.readFile(path.join(target, '.bridge-token'), 'utf8'), key);
  const before = await fs.readFile(path.join(target, 'bridge.mjs'));
  await assert.rejects(powershell(load + "$p.files.'bridge.mjs'.sha256 = 'bad'; " + install, env), error => /校验失败/.test(error.stderr));
  assert.deepEqual(await fs.readFile(path.join(target, 'bridge.mjs')), before);
  const unknown = path.join(temporary, 'unknown'); await fs.mkdir(unknown); await fs.writeFile(path.join(unknown, 'keep.txt'), 'keep');
  await assert.rejects(powershell(load + `Install-BYJBridge -Payload $p -InstallRoot ${quote(unknown)} -NoRegister -NoStart`, env), error => /已有其他内容/.test(error.stderr));
  assert.equal(await fs.readFile(path.join(unknown, 'keep.txt'), 'utf8'), 'keep');
});

test('the generated CMD runs by itself from a Unicode path with spaces', { skip: process.platform !== 'win32', timeout: 45000 }, async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'byj-cmd-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const directory = path.join(temporary, '安装 测试'); await fs.mkdir(directory);
  const resultFile = path.join(temporary, 'result.json'), destination = path.join(temporary, 'fresh-runtime');
  const cutoff = text.lastIndexOf("$ErrorActionPreference = 'Stop'");
  const entry = `\r\n$ErrorActionPreference = 'Stop'\r\ntry { $payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ByjPayload)) | ConvertFrom-Json; $result = Install-BYJBridge -Payload $payload -InstallRoot ${quote(destination)} -NoRegister -NoStart; [IO.File]::WriteAllText(${quote(resultFile)},($result | ConvertTo-Json -Compress)) } catch { exit 1 }\r\n`;
  // Replace only the interactive finish action; keep the shipped CMD bootstrap and embedded sources.
  const file = path.join(directory, 'install.cmd'); await fs.writeFile(file, text.slice(0, cutoff) + entry);
  const launcher = `& ${quote(file)}; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`;
  await run(ps, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(launcher, 'utf16le').toString('base64')], { windowsHide: true, timeout: 40000 });
  const result = JSON.parse(await fs.readFile(resultFile, 'utf8'));
  assert.equal(result.version, '0.15.0'); assert.equal(result.started, false); assert.equal(result.registered, false);
  assert.ok((await fs.stat(path.join(destination, 'bridge.mjs'))).size > 1000);
});
