param([switch]$SoftwareRendering)
$ErrorActionPreference = 'Stop'
$musicProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $musicProjectRoot
if (-not (Test-Path -LiteralPath 'node_modules\electron\path.txt')) {
    throw 'Dependencies are not installed. Follow docs/p0_download_plan.md with download authorization.'
}
& node.exe scripts/run.mjs build
if ($LASTEXITCODE -ne 0) { throw 'Build failed. Check the preceding output.' }
$musicStartMode = if ($SoftwareRendering) { 'start-software' } else { 'start' }
& node.exe scripts/run.mjs $musicStartMode
if ($LASTEXITCODE -ne 0) { throw 'Bli Music exited with an error.' }
