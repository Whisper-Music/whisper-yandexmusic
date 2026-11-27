param([switch]$Build)
Set-Location D:\.sc\YandexMusic-WhisperEdition
Get-Process yandex-desktop -ErrorAction SilentlyContinue | Stop-Process -Force
if ($Build) {
  $env:CARGO_BUILD_JOBS = 2
  npx tauri build --config src-tauri/tauri.local.conf.json --no-bundle 2>&1 | Select-String 'error|Finished' | Select -Last 4
}
$env:WHISPER_PERF = 'D:\.sc\perf-smoke.log'; $env:WHISPER_PERF_AUTO = '5'
Remove-Item $env:WHISPER_PERF -ErrorAction SilentlyContinue
$p = Start-Process src-tauri\target\release\yandex-desktop.exe -PassThru
Start-Sleep 60
Stop-Process -Id $p.Id -Force
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Get-Content D:\.sc\perf-smoke.log -Encoding UTF8 | Select-String "boot:ready|smoke|auto:|longframe"
