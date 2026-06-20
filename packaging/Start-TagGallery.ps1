$ErrorActionPreference = "Stop"

$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Join-Path $AppRoot "app"
$RuntimeNode = Join-Path $AppRoot "runtime\node.exe"
$ServerScript = Join-Path $AppDir "server.mjs"
$Port = if ($env:TAG_GALLERY_PORT) { [int]$env:TAG_GALLERY_PORT } else { 5188 }
$Url = "http://127.0.0.1:$Port/"
$PidFile = Join-Path $AppRoot "tag-gallery-server.pid"
$WindowStateFile = Join-Path $AppRoot "window-state.json"
$ShutdownFlagFile = Join-Path $AppRoot "shutdown-window.flag"
$WindowMonitorScript = Join-Path $AppRoot "Monitor-TagGalleryWindow.ps1"
$DefaultWindowWidth = if ($env:TAG_GALLERY_WINDOW_WIDTH) { [int]$env:TAG_GALLERY_WINDOW_WIDTH } else { 1410 }
$DefaultWindowHeight = if ($env:TAG_GALLERY_WINDOW_HEIGHT) { [int]$env:TAG_GALLERY_WINDOW_HEIGHT } else { 760 }

function Get-DefaultWindowState {
  Add-Type -AssemblyName System.Windows.Forms
  $screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $width = [Math]::Min($DefaultWindowWidth, [Math]::Max(900, $screen.Width - 80))
  $height = [Math]::Min($DefaultWindowHeight, [Math]::Max(640, $screen.Height - 80))
  $left = [Math]::Max($screen.Left, [int]($screen.Left + (($screen.Width - $width) / 2)))
  $top = [Math]::Max($screen.Top, [int]($screen.Top + (($screen.Height - $height) * 0.58)))

  return [pscustomobject]@{
    left = $left
    top = $top
    width = $width
    height = $height
  }
}

function Test-WindowStateUsable {
  param($State)
  if (!$State) {
    return $false
  }

  return $State.width -ge 700 -and $State.height -ge 480
}

function Limit-WindowState {
  param($State)
  $default = Get-DefaultWindowState
  if (!(Test-WindowStateUsable -State $State)) {
    return $default
  }

  $width = [Math]::Max(700, [int]$State.width)
  $height = [Math]::Max(480, [int]$State.height)
  foreach ($screen in [System.Windows.Forms.Screen]::AllScreens) {
    $area = $screen.WorkingArea
    $hasHorizontalOverlap = ([int]$State.left -lt $area.Right) -and (([int]$State.left + $width) -gt $area.Left)
    $hasVerticalOverlap = ([int]$State.top -lt $area.Bottom) -and (([int]$State.top + $height) -gt $area.Top)
    if ($hasHorizontalOverlap -and $hasVerticalOverlap) {
      return [pscustomobject]@{
        left = [Math]::Min([Math]::Max([int]$State.left, $area.Left), [Math]::Max($area.Left, $area.Right - 80))
        top = [Math]::Min([Math]::Max([int]$State.top, $area.Top), [Math]::Max($area.Top, $area.Bottom - 80))
        width = [Math]::Min($width, [Math]::Max(700, $area.Width))
        height = [Math]::Min($height, [Math]::Max(480, $area.Height))
      }
    }
  }

  return $default
}

function Get-SavedWindowState {
  if (!(Test-Path -LiteralPath $WindowStateFile)) {
    return $null
  }

  try {
    $state = Get-Content -LiteralPath $WindowStateFile -Raw | ConvertFrom-Json
    if (Test-WindowStateUsable -State $state) {
      return Limit-WindowState -State $state
    }
  } catch {
    return $null
  }

  return $null
}

function Test-PortOpen {
  param([int]$PortToTest)
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $async = $client.BeginConnect("127.0.0.1", $PortToTest, $null, $null)
    $connected = $async.AsyncWaitHandle.WaitOne(250)
    if ($connected) {
      $client.EndConnect($async)
    }
    $client.Close()
    return $connected
  } catch {
    return $false
  }
}

function Wait-Server {
  param([int]$PortToWait)
  for ($i = 0; $i -lt 40; $i += 1) {
    if (Test-PortOpen -PortToTest $PortToWait) {
      return $true
    }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

function Find-Browser {
  $candidates = @(
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }

  return $null
}

if (!(Test-Path -LiteralPath $ServerScript)) {
  throw "Cannot find app server: $ServerScript"
}

Remove-Item -LiteralPath $ShutdownFlagFile -Force -ErrorAction SilentlyContinue

$NodeExe = if (Test-Path -LiteralPath $RuntimeNode) { $RuntimeNode } else { "node" }

if (!(Test-PortOpen -PortToTest $Port)) {
  $env:PORT = "$Port"
  $env:TAG_GALLERY_APP_ROOT = $AppRoot
  $server = Start-Process -FilePath $NodeExe -ArgumentList @($ServerScript) -WorkingDirectory $AppDir -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath $PidFile -Value $server.Id -Encoding ASCII

  if (!(Wait-Server -PortToWait $Port)) {
    throw "用图片保存tag server did not start on $Url"
  }
}

$browser = Find-Browser
if ($browser) {
  $windowState = Get-SavedWindowState
  if (!$windowState) {
    $windowState = Get-DefaultWindowState
  }

  Start-Process -FilePath $browser -ArgumentList @(
    "--app=$Url",
    "--no-first-run",
    "--window-size=$($windowState.width),$($windowState.height)",
    "--window-position=$($windowState.left),$($windowState.top)"
  )
} else {
  Start-Process $Url
}

if (Test-Path -LiteralPath $WindowMonitorScript) {
  Start-Process -FilePath "powershell" -WindowStyle Hidden -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $WindowMonitorScript,
    "-StateFile",
    $WindowStateFile,
    "-Title",
    "用图片保存tag",
    "-DefaultWidth",
    $DefaultWindowWidth,
    "-DefaultHeight",
    $DefaultWindowHeight
  )
}
