# Execute only after the user explicitly authorizes the batch in docs/p0_download_plan.md.
$ErrorActionPreference = 'Stop'
$musicProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ([System.IO.Path]::GetPathRoot($musicProjectRoot) -ne 'D:\') {
    throw 'The authorized download and cache locations must be on drive D.'
}
$musicCacheRoot = Join-Path $musicProjectRoot '.cache'
$musicInstallEnvironment = @{
    'NPM_CONFIG_CACHE' = (Join-Path $musicCacheRoot 'npm')
    'ELECTRON_CACHE' = (Join-Path $musicCacheRoot 'electron')
    'electron_config_cache' = (Join-Path $musicCacheRoot 'electron')
    'ELECTRON_BUILDER_CACHE' = (Join-Path $musicCacheRoot 'electron-builder')
    'TEMP' = (Join-Path $musicCacheRoot 'tmp')
    'TMP' = (Join-Path $musicCacheRoot 'tmp')
    'ELECTRON_MIRROR' = 'https://github.com/electron/electron/releases/download/'
}
$musicPreviousEnvironment = @{}
$musicPreviousLocation = Get-Location
try {
    foreach ($musicEnvironmentName in $musicInstallEnvironment.Keys) {
        $musicPreviousEnvironment[$musicEnvironmentName] = [Environment]::GetEnvironmentVariable($musicEnvironmentName, 'Process')
        [Environment]::SetEnvironmentVariable($musicEnvironmentName, $musicInstallEnvironment[$musicEnvironmentName], 'Process')
    }
    foreach ($musicCacheDirectory in @('npm', 'electron', 'electron-builder', 'node-gyp', 'tmp')) {
        New-Item -ItemType Directory -Path (Join-Path $musicCacheRoot $musicCacheDirectory) -Force | Out-Null
    }
    Set-Location -LiteralPath $musicProjectRoot
    & npm.cmd install --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org
    if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed: $LASTEXITCODE" }
    & node.exe (Join-Path $musicProjectRoot 'node_modules\electron\install.js')
    if ($LASTEXITCODE -ne 0) { throw "Electron runtime download failed: $LASTEXITCODE" }
    Write-Output 'P0 dependencies installed. Caches and extraction temp directories were scoped to drive D.'
} finally {
    Set-Location -LiteralPath $musicPreviousLocation
    foreach ($musicEnvironmentName in $musicPreviousEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($musicEnvironmentName, $musicPreviousEnvironment[$musicEnvironmentName], 'Process')
    }
}
