# Take ownership of the audio endpoint FX property key and write the APO registration.
# Must run elevated. ASCII only.

$log = 'D:\workspace\hearing-assist-platform\native\hearlink-apo\build\fix-fx.txt'
Set-Content -LiteralPath $log -Value ('user: ' + (whoami))
whoami /groups | Select-String 'S-1-16' | ForEach-Object { 'IL: ' + $_.Line.Trim() } | Add-Content -LiteralPath $log

$src = @'
using System;
using System.Runtime.InteropServices;
public class FxPriv {
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
if (-not ('FxPriv' -as [type])) { Add-Type -TypeDefinition $src }
[void][FxPriv]::Enable('SeTakeOwnershipPrivilege')
[void][FxPriv]::Enable('SeRestorePrivilege')

$clsid = '{8D3F1A2B-5C4E-4F60-9B7A-1E2D3C4B5A69}'
$pkeyStreamClsid = '{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},5'
$pkeyModes = '{d3993a3f-99c2-4402-b5ec-a92a0367664b},5'
$modeDefault = '{C18E2F7E-933D-4965-B7D1-1EEF228D2AF3}'
$modeMedia = '{4780004E-7133-41D8-8C74-660DADD2C0EE}'

$admins = New-Object System.Security.Principal.NTAccount('BUILTIN\Administrators')
$rw = [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree
$own = [System.Security.AccessControl.RegistryRights]::TakeOwnership
$chg = [System.Security.AccessControl.RegistryRights]::ChangePermissions

function Take-Key([string]$sub) {
    try {
        $k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($sub, $rw, $own)
        if ($null -eq $k) { return 'missing' }
        $acl = $k.GetAccessControl([System.Security.AccessControl.AccessControlSections]::None)
        $acl.SetOwner($admins)
        $k.SetAccessControl($acl)
        $k.Close()
    } catch { return ('owner-fail: ' + $_.Exception.Message) }

    try {
        $k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($sub, $rw, $chg)
        $acl = $k.GetAccessControl()
        $rule = New-Object System.Security.AccessControl.RegistryAccessRule($admins, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.SetAccessRule($rule)
        $k.SetAccessControl($acl)
        $k.Close()
    } catch { return ('acl-fail: ' + $_.Exception.Message) }

    return 'ok'
}

$renderRoot = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render'
$devices = @()
foreach ($key in Get-ChildItem -Path $renderRoot -ErrorAction SilentlyContinue) {
    $state = (Get-ItemProperty -Path $key.PSPath -Name 'DeviceState' -ErrorAction SilentlyContinue).DeviceState
    if ($state -eq 1) {
        $devices += [pscustomobject]@{ Guid = (Split-Path $key.PSPath -Leaf) }
    }
}

foreach ($device in $devices) {
    $sub = 'SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render\' + $device.Guid
    '--- ' + $device.Guid | Add-Content -LiteralPath $log

    ('parent  => ' + (Take-Key $sub)) | Add-Content -LiteralPath $log
    ('fxprop  => ' + (Take-Key ($sub + '\FxProperties'))) | Add-Content -LiteralPath $log

    try {
        $fx = [Microsoft.Win32.Registry]::LocalMachine.CreateSubKey($sub + '\FxProperties')
        $fx.SetValue($pkeyStreamClsid, $clsid, [Microsoft.Win32.RegistryValueKind]::String)
        $fx.SetValue($pkeyModes, [string[]]@($modeDefault, $modeMedia), [Microsoft.Win32.RegistryValueKind]::MultiString)
        $fx.Close()
        'write   => ok' | Add-Content -LiteralPath $log
    } catch {
        ('write   => fail: ' + $_.Exception.Message.Split([Environment]::NewLine)[0]) | Add-Content -LiteralPath $log
    }
}

Restart-Service audiosrv -Force -ErrorAction SilentlyContinue
'monitor => restarted audiosrv' | Add-Content -LiteralPath $log
