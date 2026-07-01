@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Stop-TagGallery.ps1"
if errorlevel 1 (
  echo.
  echo 停止失败，请把上面的错误截图发给开发者。
  pause
)
