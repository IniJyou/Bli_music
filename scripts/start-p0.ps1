$ErrorActionPreference = 'Stop'
$musicProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $musicProjectRoot
if (-not (Test-Path -LiteralPath 'node_modules\electron\path.txt')) {
    throw 'P0 dependencies are not installed. Follow docs/p0_download_plan.md after download authorization.'
}
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'P0 build failed. Check the preceding build output.' }
& npm.cmd run start
if ($LASTEXITCODE -ne 0) { throw 'P0 exited with an error.' }
