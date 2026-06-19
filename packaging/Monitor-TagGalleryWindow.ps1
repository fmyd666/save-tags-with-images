param(
  [Parameter(Mandatory = $true)]
  [string]$StateFile,

  [string]$Title = "ComfyUI",
  [int]$DefaultWidth = 1410,
  [int]$DefaultHeight = 805
)

$ErrorActionPreference = "SilentlyContinue"

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class WindowTools {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll")]
  public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);

  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool IsWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);

  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowTextLength(IntPtr hWnd);

  public static IntPtr FindWindowByTitleContains(string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((hWnd, lParam) => {
      if (!IsWindowVisible(hWnd)) {
        return true;
      }

      int length = GetWindowTextLength(hWnd);
      if (length <= 0) {
        return true;
      }

      StringBuilder text = new StringBuilder(length + 1);
      GetWindowText(hWnd, text, text.Capacity);
      if (text.ToString().IndexOf(title, StringComparison.OrdinalIgnoreCase) >= 0) {
        found = hWnd;
        return false;
      }

      return true;
    }, IntPtr.Zero);

    return found;
  }
}
"@

function Get-GalleryWindow {
  $handle = [WindowTools]::FindWindowByTitleContains($Title)
  if ($handle -eq [IntPtr]::Zero) {
    return $null
  }

  return $handle
}

function Get-SavedState {
  if (!(Test-Path -LiteralPath $StateFile)) {
    return $null
  }

  try {
    return Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Get-DefaultState {
  $screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $width = [Math]::Min($DefaultWidth, [Math]::Max(900, $screen.Width - 80))
  $height = [Math]::Min($DefaultHeight, [Math]::Max(640, $screen.Height - 80))
  $left = [Math]::Max($screen.Left, [int]($screen.Left + (($screen.Width - $width) / 2)))
  $top = [Math]::Max($screen.Top, [int]($screen.Top + (($screen.Height - $height) * 0.58)))

  return [pscustomobject]@{
    left = $left
    top = $top
    width = $width
    height = $height
  }
}

function Test-StateUsable {
  param($State)
  if (!$State) {
    return $false
  }

  return $State.width -ge 700 -and $State.height -ge 480
}

function Set-WindowState {
  param([IntPtr]$Handle, $State)
  [void][WindowTools]::ShowWindow($Handle, 9)
  [void][WindowTools]::SetWindowPos($Handle, [IntPtr]::Zero, [int]$State.left, [int]$State.top, [int]$State.width, [int]$State.height, 0x0040)
  [void][WindowTools]::MoveWindow($Handle, [int]$State.left, [int]$State.top, [int]$State.width, [int]$State.height, $true)
}

function Save-WindowState {
  param([IntPtr]$Handle)
  if ([WindowTools]::IsIconic($Handle)) {
    return
  }

  $rect = New-Object WindowTools+RECT
  if (![WindowTools]::GetWindowRect($Handle, [ref]$rect)) {
    return
  }

  $state = [pscustomobject]@{
    left = $rect.Left
    top = $rect.Top
    width = $rect.Right - $rect.Left
    height = $rect.Bottom - $rect.Top
    updatedAt = (Get-Date).ToString("o")
  }

  $dir = Split-Path -Parent $StateFile
  if ($dir -and !(Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  $state | ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding UTF8
}

Add-Type -AssemblyName System.Windows.Forms

$window = $null
for ($i = 0; $i -lt 80; $i += 1) {
  $window = Get-GalleryWindow
  if ($window) {
    break
  }
  Start-Sleep -Milliseconds 250
}

if (!$window) {
  exit
}

$handle = $window
$state = Get-DefaultState

Set-WindowState -Handle $handle -State $state

for ($i = 0; $i -lt 8; $i += 1) {
  if (![WindowTools]::IsWindow($handle)) {
    break
  }
  Set-WindowState -Handle $handle -State $state
  Start-Sleep -Milliseconds 200
}
