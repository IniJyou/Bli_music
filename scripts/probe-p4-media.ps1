param(
  [Parameter(Mandatory=$true)][string]$Title,
  [ValidateSet('inspect','pause','play','next','previous','seek')][string]$Action = 'inspect',
  [long]$PositionTicks = 0
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Length -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await-MediaOperation($Operation, [Type]$Type) {
  $asTask.MakeGenericMethod($Type).Invoke($null, @($Operation)).GetAwaiter().GetResult()
}
$manager = Await-MediaOperation ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$session = $null
$observed = @()
for ($attempt = 0; $attempt -lt 20 -and -not $session; $attempt++) {
  foreach ($candidate in $manager.GetSessions()) {
    if ($candidate.SourceAppUserModelId -ne 'com.inijyou.blimusic.p4test') { continue }
    $media = Await-MediaOperation ($candidate.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $observed += $candidate.SourceAppUserModelId
    if ($media.Title -eq $Title) { $session = $candidate; break }
  }
  if (-not $session) { Start-Sleep -Milliseconds 100 }
}
if (-not $session) { throw ('Windows did not expose the isolated Bli Music media session. Matching app IDs: ' + (($observed | Select-Object -Unique) -join ', ') + '. Active sessions: ' + @($manager.GetSessions()).Count) }
$state = $session.GetPlaybackInfo()
$success = switch ($Action) {
  'inspect' { $true }
  'pause' { Await-MediaOperation ($session.TryPauseAsync()) ([bool]) }
  'play' { Await-MediaOperation ($session.TryPlayAsync()) ([bool]) }
  'next' { Await-MediaOperation ($session.TrySkipNextAsync()) ([bool]) }
  'previous' { Await-MediaOperation ($session.TrySkipPreviousAsync()) ([bool]) }
  'seek' { Await-MediaOperation ($session.TryChangePlaybackPositionAsync($PositionTicks)) ([bool]) }
}
[pscustomobject]@{
  source = $session.SourceAppUserModelId
  status = $state.PlaybackStatus.ToString()
  seek = $state.Controls.IsPlaybackPositionEnabled
  success = [bool]$success
} | ConvertTo-Json -Compress
