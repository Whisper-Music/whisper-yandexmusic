# bench.ps1 — замер скорости: Whisper Edition против официального приложения Яндекс Музыки (для таблицы в README).
# Оба приложения меряются одинаково и снаружи, средствами Windows, — без perf.js, чтобы условия были равными:
#   * запуск: от старта процесса до первого видимого окна (не меньше 300×200, не скрытое DWM) — Runs раз по очереди, медиана;
#   * память: рабочий набор и личная память всего дерева процессов (у Electron — его процессы, у нас — свои WebView2),
#     через Settle с после запуска, во время игры и в свёрнутом окне;
#   * процессор: средняя загрузка всего дерева за Sample с — в простое, во время игры, во время игры в свёрнутом окне;
#   * размер установленного приложения.
# Играет ли приложение, видно по уровню звука его процессов (Core Audio, все устройства вывода). Включение — см. Play. Запуск: powershell -ExecutionPolicy Bypass -File scripts\bench.ps1 [-Runs 5] [-App all]
# Во время замера компьютер лучше не трогать: оба приложения перезапускаются и играют музыку. Официальное приложение
# включать надо самому: на «BENCH_WAIT_PLAY official» нажми Play в его окне (ждёт до 3 минут).
# -StartOnly — только время запуска, -IdleOnly — только простой. Результат — JSON в -Out (по умолчанию %TEMP%).
# Перед замером официальное приложение стоит один раз запустить и подождать: оно обновляется само, а установщик
# скрипт не трогает и ждёт его (WaitInstallers).
param(
  [ValidateSet("all", "whisper", "official")] [string]$App = "all",
  [int]$Runs = 5,
  [int]$Settle = 60,                   # сколько ждать после запуска: раньше оба ещё догружаются в фоне (таблица в README — с 60)
  [int]$Sample = 60,
  [string]$Track = "95887450",
  [switch]$StartOnly,                  # только время запуска (без памяти и процессора)
  [switch]$IdleOnly,                   # только простой: без запусков на время и без музыки
  [string]$Out = "$env:TEMP\whisper-bench.json",
  # другой exe Whisper (например, свежая сборка src-tauri\target\release) — размер тогда считается по самому exe
  [string]$WhisperExe = ""
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

// Уровень звука по процессам (Core Audio: сессии устройства вывода по умолчанию). Нужен замеру скорости (bench.ps1),
// чтобы понять, правда ли приложение играет, — без доступа к его окну.
public static class AudioPeak {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator { [PreserveSig] int EnumAudioEndpoints(int dataFlow, int mask, out IMMDeviceCollection c); }
  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection { [PreserveSig] int GetCount(out int n); [PreserveSig] int Item(int i, out IMMDevice d); }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice { [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
  [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 { int N1(); int N2(); [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator e); }
  [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator { [PreserveSig] int GetCount(out int n); [PreserveSig] int GetSession(int i, out IAudioSessionControl s); }
  [Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl { int N1(); }
  [Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    int N1(); int N2(); int N3(); int N4(); int N5(); int N6(); int N7(); int N8(); int N9();
    [PreserveSig] int GetSessionIdentifier(out IntPtr s); [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr s);
    [PreserveSig] int GetProcessId(out uint pid);
  }
  [Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioMeterInformation { [PreserveSig] int GetPeakValue(out float peak); }

  /// pid → наибольший пик среди его сессий (0…1) прямо сейчас — на всех включённых устройствах вывода
  /// (приложение может играть не на устройство по умолчанию: у Whisper есть свой выбор устройства)
  public static Dictionary<uint, float> Peaks() {
    var res = new Dictionary<uint, float>();
    var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDeviceCollection col; if (en.EnumAudioEndpoints(0, 1, out col) != 0) return res;
    int nd; col.GetCount(out nd);
    for (int d = 0; d < nd; d++) {
      IMMDevice dev; if (col.Item(d, out dev) != 0) continue;
      var iid = typeof(IAudioSessionManager2).GUID; object o;
      if (dev.Activate(ref iid, 23, IntPtr.Zero, out o) != 0) continue;
      IAudioSessionEnumerator se; if (((IAudioSessionManager2)o).GetSessionEnumerator(out se) != 0) continue;
      int n; se.GetCount(out n);
      for (int i = 0; i < n; i++) {
        IAudioSessionControl s; if (se.GetSession(i, out s) != 0) continue;
        uint pid; ((IAudioSessionControl2)s).GetProcessId(out pid);
        float pk; ((IAudioMeterInformation)s).GetPeakValue(out pk);
        float old; res[pid] = res.TryGetValue(pid, out old) ? Math.Max(old, pk) : pk;
      }
    }
    return res;
  }
}


public static class Win {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint f, UIntPtr e);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
  public struct RECT { public int L, T, R, B; }
  /// большие видимые окна этих процессов (свёрнутые тоже считаются: окно есть)
  public static List<IntPtr> Windows(HashSet<uint> pids) {
    var res = new List<IntPtr>();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (!pids.Contains(p) || !IsWindowVisible(h)) return true;
      int cloaked = 0; DwmGetWindowAttribute(h, 14, out cloaked, 4);
      RECT r; GetWindowRect(h, out r);
      if (cloaked == 0 && (IsIconic(h) || (r.R - r.L >= 300 && r.B - r.T >= 200))) res.Add(h);
      return true;
    }, IntPtr.Zero);
    return res;
  }
  public static void Key(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(40); keybd_event(vk, 0, 2, UIntPtr.Zero); }
}
"@

$official = Get-ChildItem "$env:LOCALAPPDATA\Programs\YandexMusic" -Filter *.exe -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch "^Uninstall" } | Select-Object -First 1
$whisper = Get-Item $(if ($WhisperExe) { $WhisperExe } else { "$env:LOCALAPPDATA\yandex-desktop\yandex-desktop.exe" }) -ErrorAction SilentlyContinue
$APPS = [ordered]@{}
if ($whisper) { $APPS.whisper = @{ name = "Whisper Edition"; exe = $whisper.FullName; dir = $whisper.DirectoryName } }
if ($official) { $APPS.official = @{ name = "Официальное"; exe = $official.FullName; dir = $official.DirectoryName } }
if ($App -ne "all") { foreach ($k in @($APPS.Keys)) { if ($k -ne $App) { $APPS.Remove($k) } } }
if (!$APPS.Count) { throw "Не нашлось ни одного приложения" }
$CORES = [Environment]::ProcessorCount
if ($env:BENCH_PROBE) {
  # отладка: какие процессы сейчас звучат
  $pk = [AudioPeak]::Peaks()
  foreach ($id in $pk.Keys) { $p = Get-Process -Id $id -ErrorAction SilentlyContinue; "{0,6} {1,-22} {2:N4}" -f $id, $p.ProcessName, $pk[$id] }
  return
}

# Дерево процессов. Windows переиспользует номера: у давно живущего чужого процесса номер родителя может совпасть
# с номером нашего — поэтому потомок засчитывается, только если он запущен не раньше родителя.
function Tree([int]$root) {
  $all = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CreationDate
  $born = @{}; $kids = @{}
  foreach ($p in $all) {
    $born[[int]$p.ProcessId] = $p.CreationDate
    $k = [int]$p.ParentProcessId; if (!$kids.ContainsKey($k)) { $kids[$k] = New-Object System.Collections.ArrayList }
    [void]$kids[$k].Add([int]$p.ProcessId)
  }
  $out = New-Object System.Collections.Generic.HashSet[uint32]
  if (!$born.ContainsKey($root)) { return , $out }
  $q = New-Object System.Collections.Queue; $q.Enqueue($root)
  while ($q.Count) {
    $x = [int]$q.Dequeue()
    if (!$out.Add([uint32]$x)) { continue }
    if ($kids.ContainsKey($x)) { foreach ($c in $kids[$x]) { if ($born[$c] -ge $born[$x]) { $q.Enqueue($c) } } }
  }
  , $out
}
function Roots($exe) { @(Get-Process | Where-Object { try { $_.Path -eq $exe } catch { $false } }) }
# Закрыть приложение. Убиваются только процессы самого приложения (файлы из его папки) и его WebView2 — НИКОГДА не
# установщик: официальное приложение обновляется само (electron-updater: сначала удаляет старую версию, потом ставит
# новую), и прерванное обновление оставляет его неустановленным. Идёт обновление — ждём, пока установщик закончит.
function StopApp($exe) {
  $dir = Split-Path $exe
  foreach ($p in Roots $exe) {
    $t = Tree $p.Id
    try { [void]$p.CloseMainWindow() } catch {}
    Start-Sleep -Milliseconds 1500
    foreach ($id in $t) {
      $q = Get-Process -Id $id -ErrorAction SilentlyContinue
      if (!$q) { continue }
      $path = try { $q.Path } catch { "" }
      if ($path -and ($path.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase) -or $q.ProcessName -eq "msedgewebview2")) {
        Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
      }
    }
  }
  WaitInstallers
  Start-Sleep 2
}
function WaitInstallers {
  for ($i = 0; $i -lt 600; $i++) {
    $busy = Get-Process | Where-Object { $_.ProcessName -match "^(Yandex_Music|Uninstall|.*setup|.*installer)" }
    if (!$busy) { return }
    if ($i -eq 0) { Write-Host "Идёт установка/обновление ($($busy[0].ProcessName)) — жду, не мешаю" }
    Start-Sleep 1
  }
}
function Mem($pids) {
  $ws = 0; $pv = 0
  foreach ($id in $pids) { $p = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($p) { $ws += $p.WorkingSet64; $pv += $p.PrivateMemorySize64 } }
  @{ ws = [math]::Round($ws / 1MB); priv = [math]::Round($pv / 1MB) }
}
function CpuTime($pids) {
  $s = 0.0
  foreach ($id in $pids) { $p = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($p) { try { $s += $p.TotalProcessorTime.TotalMilliseconds } catch {} } }
  $s
}
# средняя загрузка дерева за sec секунд, % от всего процессора (все ядра = 100 %)
function Cpu([int]$root, [int]$sec) {
  $t = Tree $root; $a = CpuTime $t; $sw = [Diagnostics.Stopwatch]::StartNew()
  Start-Sleep $sec
  $t2 = Tree $root; foreach ($x in $t2) { [void]$t.Add($x) }
  $b = CpuTime $t
  [math]::Round(($b - $a) / $sw.Elapsed.TotalMilliseconds / $CORES * 100, 1)
}
function Playing([int]$root) {
  $t = Tree $root
  for ($i = 0; $i -lt 20; $i++) {
    $pk = [AudioPeak]::Peaks()
    foreach ($id in $t) { if ($pk.ContainsKey($id) -and $pk[$id] -gt 0.001) { return $true } }
    Start-Sleep -Milliseconds 150
  }
  $false
}
# Включить музыку. Whisper — своей ссылкой whisper://track/<номер> (deeplink.rs → share.js: тот же путь, что ссылка
# из мессенджера). У официального приложения такой ссылки нет — скрипт пишет «BENCH_WAIT_PLAY» и ждёт до 3 минут,
# пока Play нажмут в окне (руками или инструментом, который видит экран). Нажатия скриптом не шлём: многие окна их
# не принимают от чужого процесса, а замер должен быть одинаковым для обоих.
function Play($key, [int]$root) {
  if (Playing $root) { return "уже играло" }
  if ($key -eq "whisper") {
    Start-Process "whisper://track/$Track"
    for ($i = 0; $i -lt 10; $i++) { Start-Sleep 2; if (Playing $root) { return "ссылка whisper://" } }
  }
  Write-Host "BENCH_WAIT_PLAY $key — включи воспроизведение в окне"
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt 180) { if (Playing $root) { return "кнопка в окне" }; Start-Sleep 1 }
  $null
}
function Launch($exe) {
  WaitInstallers
  if (!(Test-Path $exe)) { throw "Нет файла $exe — приложение удалено или обновляется" }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process $exe -PassThru
  $set = New-Object System.Collections.Generic.HashSet[uint32]; [void]$set.Add([uint32]$p.Id)
  $n = 0; $main = $p.Id
  while ($sw.Elapsed.TotalSeconds -lt 60) {
    if ([Win]::Windows($set).Count) { return @{ pid = $main; ms = [math]::Round($sw.Elapsed.TotalMilliseconds) } }
    # Electron может передать запуск уже живому экземпляру или своему процессу — раз в ~0,3 с берём все процессы этого exe
    if ((++$n % 12) -eq 0) {
      foreach ($r in Roots $exe) { [void]$set.Add([uint32]$r.Id); if ($p.HasExited) { $main = $r.Id } }
    }
    Start-Sleep -Milliseconds 25
  }
  $info = foreach ($r in Roots $exe) { "{0} окно={1} «{2}»" -f $r.Id, $r.MainWindowHandle, $r.MainWindowTitle }
  Write-Host "  окно не найдено за 60 с; запущенный $($p.Id) $(if ($p.HasExited) { 'завершился' } else { 'жив' }); процессы: $($info -join '; ')"
  @{ pid = $main; ms = $null }
}
function Median($a) { $s = @($a | Where-Object { $_ -ne $null } | Sort-Object); if (!$s.Count) { return $null }; $s[[math]::Floor(($s.Count - 1) / 2)] }

$R = [ordered]@{ date = (Get-Date).ToString("yyyy-MM-dd HH:mm"); machine = @{
  cpu = (Get-CimInstance Win32_Processor).Name.Trim(); cores = $CORES
  ram = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
  os = (Get-CimInstance Win32_OperatingSystem).Caption }; apps = [ordered]@{} }
foreach ($k in $APPS.Keys) {
  $a = $APPS[$k]
  $ver = (Get-Item $a.exe).VersionInfo.ProductVersion
  # своя сборка лежит среди файлов сборки — тогда считается только exe (установленный Whisper — это exe и деинсталлятор)
  $size = if ($k -eq "whisper" -and $WhisperExe) { [math]::Round((Get-Item $a.exe).Length / 1MB, 1) }
    else { [math]::Round((Get-ChildItem $a.dir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB, 1) }
  $R.apps[$k] = [ordered]@{ name = $a.name; version = $ver; sizeMB = $size; start = @() }
  StopApp $a.exe
}

# 1. запуск: по очереди, чтобы оба были в одинаковых условиях (кэш диска, фоновые задачи)
for ($i = 1; $i -le $(if ($IdleOnly) { 0 } else { $Runs }); $i++) {
  foreach ($k in $APPS.Keys) {
    $a = $APPS[$k]
    Start-Sleep 3
    $l = @(Launch $a.exe) | Where-Object { $_ -is [hashtable] } | Select-Object -Last 1
    Write-Host ("запуск {0} · {1}: {2} мс" -f $i, $a.name, $l.ms)
    $R.apps[$k].start += $l.ms
    Start-Sleep 6
    StopApp $a.exe
  }
}

# 2. память и процессор: простой → игра → игра в свёрнутом окне
foreach ($k in $(if ($StartOnly) { @() } else { $APPS.Keys })) {
  $a = $APPS[$k]; $m = $R.apps[$k]   # не $r: имена в PowerShell без учёта регистра, $r затёр бы $R
  Start-Sleep 3
  $l = @(Launch $a.exe) | Where-Object { $_ -is [hashtable] } | Select-Object -Last 1
  Write-Host "$($a.name): жду $Settle с, пока успокоится"
  Start-Sleep $Settle
  $m.memIdle = Mem (Tree $l.pid)
  $m.cpuIdle = Cpu $l.pid $(if ($IdleOnly) { $Sample } else { [math]::Min($Sample, 30) })
  if ($IdleOnly) { Write-Host ("{0}: простой {1}% / {2} МБ" -f $a.name, $m.cpuIdle, $m.memIdle.ws); StopApp $a.exe; continue }
  $how = Play $k $l.pid
  $m.playVia = $how
  if ($how) {
    Start-Sleep 5
    $m.cpuPlay = Cpu $l.pid $Sample
    $m.memPlay = Mem (Tree $l.pid)
    $m.playOk = Playing $l.pid
    foreach ($w in [Win]::Windows((Tree $l.pid))) { [void][Win]::ShowWindow($w, 6) }   # свернуть
    Start-Sleep 5
    $m.cpuMin = Cpu $l.pid $Sample
    $m.memMin = Mem (Tree $l.pid)
    $m.minOk = Playing $l.pid
  } else { Write-Host "$($a.name): не получилось включить музыку — замеры игры пропущены" }
  Write-Host ("{0}: простой {1}% / {2} МБ, игра {3}% / {4} МБ, свёрнуто {5}% / {6} МБ" -f $a.name, $m.cpuIdle, $m.memIdle.ws, $m.cpuPlay, $m.memPlay.ws, $m.cpuMin, $m.memMin.ws)
  StopApp $a.exe
}
foreach ($k in $APPS.Keys) { $R.apps[$k].startMedian = Median $R.apps[$k].start }
$R | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $Out
Write-Host "Готово: $Out"
