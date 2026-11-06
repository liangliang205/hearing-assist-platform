# Diagnostics: verify APO registration and why the engine did not load it.
$log = 'D:\workspace\hearing-assist-platform\native\hearlink-apo\build\diag2.txt'
Set-Content -LiteralPath $log -Value ('user: ' + (whoami))
whoami /groups | Select-String 'S-1-16' | ForEach-Object { 'IL: ' + $_.Line.Trim() } | Add-Content -LiteralPath $log

$clsid = '{8D3F1A2B-5C4E-4F60-9B7A-1E2D3C4B5A69}'
function W($line) { $line | Add-Content -LiteralPath $log }

# 1. COM + engine registration
$com = "HKLM:\SOFTWARE\Classes\CLSID\$clsid\InProcServer32"
W ('COM InProcServer32 exists: ' + (Test-Path $com))
if (Test-Path $com) { W ('  value: ' + (Get-ItemProperty $com).'(default)') }

$eng = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AudioEngine\AudioProcessingObjects\$clsid"
W ('AudioEngine key exists: ' + (Test-Path $eng))
if (Test-Path $eng) {
    $p = Get-ItemProperty $eng
    W ('  Flags=' + $p.Flags + ' NumAPOInterfaces=' + $p.NumAPOInterfaces + ' APOInterface0=' + $p.APOInterface0)
    W ('  FriendlyName=' + $p.FriendlyName)
}

# 2. Endpoint FX values + Disable_SysFx
$render = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render'
foreach ($k in Get-ChildItem $render -ErrorAction SilentlyContinue) {
    $state = (Get-ItemProperty $k.PSPath -Name DeviceState -ErrorAction SilentlyContinue).DeviceState
    if ($state -ne 1) { continue }
    $guid = Split-Path $k.PSPath -Leaf
    $fx = Join-Path $k.PSPath 'FxProperties'
    $v = $null
    try { $v = (Get-ItemProperty $fx -Name '{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},5' -ErrorAction SilentlyContinue).'{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},5' } catch {}
    $disable = $null
    try { $disable = (Get-ItemProperty (Join-Path $k.PSPath 'Properties') -Name '{1da5d803-d492-4edd-8c23-e0c0ffee7f0e},5' -ErrorAction SilentlyContinue).'{1da5d803-d492-4edd-8c23-e0c0ffee7f0e},5' } catch {}
    W ("endpoint $guid  fxClsid=$v  disableSysFx=$disable")
}

# 3. Is our DLL loaded inside audiodg?
$audiodg = Get-Process audiodg -ErrorAction SilentlyContinue
if ($audiodg) {
    try {
        $mods = $audiodg.Modules | Where-Object { $_.ModuleName -like '*HearLink*' }
        W ('audiodg pid=' + $audiodg.Id + ' HearLink module loaded: ' + [bool]$mods)
    } catch { W ('audiodg modules unreadable: ' + $_.Exception.Message) }
} else {
    W 'audiodg not running'
}

# 4. Recent audio-related event log entries
try {
    $events = Get-WinEvent -LogName 'Microsoft-Windows-Audio/Operational' -MaxEvents 15 -ErrorAction Stop
    foreach ($e in $events) { W ('EVT ' + $e.TimeCreated + ' [' + $e.Id + '] ' + $e.Message.Split([Environment]::NewLine)[0]) }
} catch {
    W ('audio operational log unavailable: ' + $_.Exception.Message)
}
