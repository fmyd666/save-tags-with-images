@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-TagGallery.ps1"
if errorlevel 1 (
  echo.
  echo 启动失败，请把上面的错误截图发给开发者。
  pause
)
