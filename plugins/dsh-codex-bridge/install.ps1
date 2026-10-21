param(
    [string]$HarnessPath = (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'),
    [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $HarnessPath -PathType Leaf)) { throw 'DeepSeek Harness was not found. Pass -HarnessPath with its installed executable.' }
$harnessResources = Join-Path (Split-Path -Parent $HarnessPath) 'resources'
if (-not (Test-Path -LiteralPath (Join-Path $harnessResources 'app.asar') -PathType Leaf)) { throw 'Harness resources are missing.' }
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileDirectory = Join-Path $dshHome 'profiles\desktop'
$manifestPath = Join-Path $profileDirectory 'package.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Open Harness once to initialize its desktop profile, then retry.' }
$backupDirectory = Join-Path $dshHome ('storages\codex-local-bridge\install-backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
foreach ($file in @('package.json', 'cordis.patch.yml', 'pnpm-lock.yaml')) {
    $sourceFile = Join-Path $profileDirectory $file
    if (Test-Path -LiteralPath $sourceFile -PathType Leaf) { Copy-Item -LiteralPath $sourceFile -Destination (Join-Path $backupDirectory $file) }
}
$oldNodeMode = $env:ELECTRON_RUN_AS_NODE
$oldResources = $env:DSH_CODEX_INSTALL_RESOURCES
try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    $env:DSH_CODEX_INSTALL_RESOURCES = $harnessResources
    $arguments = if ($Uninstall) { @('remove', 'dsh-plugin-codex-local-bridge') } else { @('add', $PSScriptRoot) }
    $cliArguments = @('--expose-internals', (Join-Path $PSScriptRoot 'install-cli.mjs'), 'plugin', '--profile', 'desktop') + $arguments
    $quotedArguments = ($cliArguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
    $child = Start-Process -FilePath $HarnessPath -ArgumentList $quotedArguments -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $backupDirectory 'install.stdout.log') -RedirectStandardError (Join-Path $backupDirectory 'install.stderr.log')
    if ($child.ExitCode -ne 0) { throw "Harness plugin installation failed. Diagnostics: $backupDirectory" }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $present = $null -ne $manifest.dependencies.'dsh-plugin-codex-local-bridge'
    if ($Uninstall -and $present) { throw 'The plugin is still present; uninstall was not confirmed.' }
    if (-not $Uninstall -and (-not $present -or $manifest.dsh.profile.bundles -notcontains 'dsh-plugin-codex-local-bridge')) { throw 'Plugin activation was not confirmed.' }
    Write-Output $(if ($Uninstall) { 'Plugin removed. Existing bridge and provider settings were preserved.' } else { 'Plugin installed. Open the Codex bridge sidebar panel in Harness; restart Harness if it is not visible.' })
} finally {
    $env:ELECTRON_RUN_AS_NODE = $oldNodeMode
    $env:DSH_CODEX_INSTALL_RESOURCES = $oldResources
}
