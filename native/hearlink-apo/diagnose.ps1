$log = 'D:\workspace\hearing-assist-platform\native\hearlink-apo\build\diag.txt'
"whoami: $(whoami)" | Set-Content -LiteralPath $log
whoami /groups | Select-String 'S-1-16' | ForEach-Object { "IL: $($_.Line.Trim())" } | Add-Content -LiteralPath $log

$clsid = '{8D3F1A2B-5C4E-4F60-9B7A-1E2D3C4B5A69}'
$tests = [ordered]@{
    'CLSID root'      = "HKLM:\SOFTWARE\Classes\CLSID\$clsid"
    'CLSID InProc'    = "HKLM:\SOFTWARE\Classes\CLSID\$clsid\InProcServer32"
    'AudioEngine'     = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AudioEngine\AudioProcessingObjects\$clsid"
    'MMDevices FX'    = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render\{4b10bba8-c788-4503-9200-cbc63c11a893}\FxProperties"
    'SOFTWARE test'   = 'HKLM:\SOFTWARE\HearLinkDiagTest'
}

foreach ($name in $tests.Keys) {
    $path = $tests[$name]
    try {
        New-Item -Path $path -Force -ErrorAction Stop | Out-Null
        $ok = 'OK'
    } catch {
        $ok = 'FAIL: ' + $_.Exception.Message.Split([Environment]::NewLine)[0]
    }
    "$name => $ok" | Add-Content -LiteralPath $log
}

try {
    Restart-Service audiosrv -Force -ErrorAction Stop
    'Restart audiosrv => OK' | Add-Content -LiteralPath $log
} catch {
    'Restart audiosrv => FAIL: ' + $_.Exception.Message | Add-Content -LiteralPath $log
}

Remove-Item 'HKLM:\SOFTWARE\HearLinkDiagTest' -Force -ErrorAction SilentlyContinue
