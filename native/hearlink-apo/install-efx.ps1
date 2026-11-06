# Register the APO on the EFx (endpoint effect) slot, which is what the
# Realtek endpoint actually uses. Backs up existing values for restore.
# Must run elevated. ASCII only.

param([switch]$Restore)

$log = 'D:\workspace\hearing-assist-platform\native\hearlink-apo\build\efx.txt'
$backup = 'C:\ProgramData\HearLink\fx-backup.json'
$clsid = '{8D3F1A2B-5C4E-4F60-9B7A-1E2D3C4B5A69}'
$pkeyEfx = '{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},7'
$pkeyModes7 = '{d3993a3f-99c2-4402-b5ec-a92a0367664b},7'
$modeDefault = '{C18E2F7E-933D-4965-B7D1-1EEF228D2AF3}'
$pkeyDisable = '{1da5d803-d492-4edd-8c23-e0c0ffee7f0e},5'

Set-Content -LiteralPath $log -Value ('mode: ' + $(if ($Restore) { 'restore' } else { 'install' }))

# endpoint FX keys are SYSTEM-owned
$src = @'
using System;
using System.Runtime.InteropServices;
public class EfxPriv {
  [DllImport("advapi32.dll", SetLastError=true)] public static extern bool OpenProcessToken(IntPtr h, uint acc, out IntPtr tok);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool LookupPrivilegeValue(string host, string name, out long luid);
  [DllImport("advapi32.dll", SetLastError=true)] public static extern bool AdjustTokenPrivileges(IntPtr tok, bool dis, ref TokPriv1Luid newst, int len, IntPtr prev, IntPtr relen);
  [StructLayout(LayoutKind.Sequential, Pack=1)] public struct TokPriv1Luid { public int Count; public long Luid; public int Attr; }
  public static bool Enable(string name) {
    IntPtr tok;
    if (!OpenProcessToken(System.Diagnostics.Process.GetCurrentProcess().Handle, 0x28, out tok)) return false;
    TokPriv1Luid tp; tp.Count = 1; tp.Attr = 2;
    if (!LookupPrivilegeValue(null, name, out tp.Luid)) return false;
    return AdjustTokenPrivileges(tok, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
  }
}
'@
if (-not ('EfxPriv' -as [type])) { Add-Type -TypeDefinition $src }
[void][EfxPriv]::Enable('SeTakeOwnershipPrivilege')
[void][EfxPriv]::Enable('SeRestorePrivilege')

$admins = New-Object System.Security.Principal.NTAccount('BUILTIN\Administrators')
$rw = [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree
$own = [System.Security.AccessControl.RegistryRights]::TakeOwnership
$chg = [System.Security.AccessControl.RegistryRights]::ChangePermissions

function Grant([string]$sub) {
    try {
        $k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($sub, $rw, $own)
        if ($k) {
            $acl = $k.GetAccessControl([System.Security.AccessControl.AccessControlSections]::None)
            $acl.SetOwner($admins); $k.SetAccessControl($acl); $k.Close()
        }
        $k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($sub, $rw, $chg)
        if ($k) {
            $acl = $k.GetAccessControl()
            $rule = New-Object System.Security.AccessControl.RegistryAccessRule($admins, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
            $acl.SetAccessRule($rule); $k.SetAccessControl($acl); $k.Close()
        }
    } catch { }
}

$renderRoot = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render'

if ($Restore) {
    if (-not (Test-Path -LiteralPath $backup)) { 'no backup file' | Add-Content $log; exit 0 }
    $map = Get-Content -LiteralPath $backup -Raw | ConvertFrom-Json
    foreach ($guid in $map.PSObject.Properties.Name) {
        $sub = 'SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render\' + $guid
        Grant $sub; Grant ($sub + '\FxProperties')
        $fx = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($sub + '\FxProperties', $true)
        if ($fx) {
            $orig = $map.$guid
            if ($null -ne $orig.efx -and $orig.efx -ne '') { $fx.SetValue($pkeyEfx, $orig.efx, [Microsoft.Win32.RegistryValueKind]::String) }
            else { $fx.DeleteValue($pkeyEfx, $false) }
            if ($null -ne $orig.modes -and $orig.modes.Count -gt 0) { $fx.SetValue($pkeyModes7, [string[]]$orig.modes, [Microsoft.Win32.RegistryValueKind]::MultiString) }
            else { $fx.DeleteValue($pkeyModes7, $false) }
            $fx.Close()
            ('restored ' + $guid) | Add-Content $log
        }
    }
    Restart-Service audiosrv -Force -ErrorAction SilentlyContinue
    exit 0
}

# --- install: back up current EFx values, then point EFx at our APO
$backupMap = [ordered]@{}
foreach ($key in Get-ChildItem -Path $renderRoot -ErrorAction SilentlyContinue) {
    $state = (Get-ItemProperty -Path $key.PSPath -Name 'DeviceState' -ErrorAction SilentlyContinue).DeviceState
    if ($state -ne 1) { continue }
    $guid = Split-Path $key.PSPath -Leaf
    $sub = 'SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render\' + $guid

    Grant $sub
    Grant ($sub + '\FxProperties')

    $fxRead = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($sub + '\FxProperties', $false)
    $oldEfx = $null
    $oldModes = @()
    if ($fxRead) {
        $oldEfx = $fxRead.GetValue($pkeyEfx)
        $oldModes = @($fxRead.GetValue($pkeyModes7))
        $fxRead.Close()
    }
    $backupMap[$guid] = [pscustomobject]@{ efx = $oldEfx; modes = $oldModes }

    try {
        $fx = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($sub + '\FxProperties', $true)
        if (-not $fx) { $fx = [Microsoft.Win32.Registry]::LocalMachine.CreateSubKey($sub + '\FxProperties') }
        $fx.SetValue($pkeyEfx, $clsid, [Microsoft.Win32.RegistryValueKind]::String)
        $fx.SetValue($pkeyModes7, [string[]]@($modeDefault), [Microsoft.Win32.RegistryValueKind]::MultiString)
        $fx.SetValue($pkeyDisable, 0, [Microsoft.Win32.RegistryValueKind]::DWord)
        $fx.Close()
        ('efx set: ' + $guid + ' (old=' + $oldEfx + ')') | Add-Content $log
    } catch {
        ('efx fail: ' + $guid + ' ' + $_.Exception.Message.Split([Environment]::NewLine)[0]) | Add-Content $log
    }
}
New-Item -ItemType Directory -Force -Path 'C:\ProgramData\HearLink' | Out-Null
($backupMap | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $backup -Encoding UTF8

Restart-Service audiosrv -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
'done' | Add-Content $log
