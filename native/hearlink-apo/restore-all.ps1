# Remove all HearLink APO traces and restore original EFx values.
$clsid = '{8D3F1A2B-5C4E-4F60-9B7A-1E2D3C4B5A69}'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

# restore EFx values from backup
& (Join-Path $here 'install-efx.ps1') -Restore

# remove APO registration keys
foreach ($path in @(
    "HKLM:\SOFTWARE\Classes\AudioEngine\AudioProcessingObjects\$clsid",
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AudioEngine\AudioProcessingObjects\$clsid",
    "HKLM:\SOFTWARE\Classes\CLSID\$clsid"
)) {
    if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host ('removed ' + $path)
    }
}

Restart-Service audiosrv -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Remove-Item 'C:\ProgramData\HearLink\Apo' -Recurse -Force -ErrorAction SilentlyContinue
Write-Host 'restore complete'
