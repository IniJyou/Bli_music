# Run after authorization of the download batch in docs/p5_download_plan.md.
$ErrorActionPreference = 'Stop'
$musicProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ([System.IO.Path]::GetPathRoot($musicProjectRoot) -ne 'D:\') {
    throw 'P5 downloads and caches must stay on drive D.'
}
$musicEnvironment = @{
    NPM_CONFIG_CACHE = (Join-Path $musicProjectRoot '.cache\npm')
    ELECTRON_CACHE = (Join-Path $musicProjectRoot '.cache\electron')
    electron_config_cache = (Join-Path $musicProjectRoot '.cache\electron')
    ELECTRON_BUILDER_CACHE = (Join-Path $musicProjectRoot '.cache\electron-builder')
    TEMP = (Join-Path $musicProjectRoot '.cache\tmp')
    TMP = (Join-Path $musicProjectRoot '.cache\tmp')
}
$musicPrevious = @{}
$musicLocation = Get-Location
try {
    foreach ($musicName in $musicEnvironment.Keys) {
        $musicPrevious[$musicName] = [Environment]::GetEnvironmentVariable($musicName, 'Process')
        [Environment]::SetEnvironmentVariable($musicName, $musicEnvironment[$musicName], 'Process')
        New-Item -ItemType Directory -Force -Path $musicEnvironment[$musicName] | Out-Null
    }
    Set-Location -LiteralPath $musicProjectRoot
    & npm.cmd install --save-dev --save-exact electron-builder@26.18.0 --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org
    if ($LASTEXITCODE -ne 0) { throw "P5 dependency installation failed: $LASTEXITCODE" }
} finally {
    Set-Location -LiteralPath $musicLocation
    foreach ($musicName in $musicPrevious.Keys) {
        [Environment]::SetEnvironmentVariable($musicName, $musicPrevious[$musicName], 'Process')
    }
}
