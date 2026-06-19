$ErrorActionPreference = "SilentlyContinue"

$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $AppRoot "tag-gallery-server.pid"

if (Test-Path -LiteralPath $PidFile) {
  $pidValue = Get-Content -LiteralPath $PidFile -Raw
  $pidValue = $pidValue.Trim()
  if ($pidValue) {
    Stop-Process -Id ([int]$pidValue) -Force
  }
  Remove-Item -LiteralPath $PidFile -Force
}
