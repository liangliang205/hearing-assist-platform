# Add the FX friendly-name and association values that working APOs have.
$log = 'D:\workspace\hearing-assist-platform\native\hearlink-apo\build\title.txt'
$clsid = '{8D3F1A2B-5C4E-4F60-9B7A-1E2D3C4B5A69}'
$pkeyTitle = '{b725f130-47ef-101a-a5f1-02608c9eebac},10'
$pkeyAssoc = '{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},0'
$pkeyLfx = '{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},1'
$pkeySfx = '{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},5'
$pkeyEfx = '{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},7'
$pkeyDisable = '{1da5d803-d492-4edd-8c23-e0c0ffee7f0e},5'

Set-Content -LiteralPath $log -Value 'title pass'

$src = @'
using System;
using System.Runtime.InteropServices;
public class TitlePriv {
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
if (-not ('TitlePriv' -as [type])) { Add-Type -TypeDefinition $src }
[void][TitlePriv]::Enable('SeTakeOwnershipPrivilege')
[void][TitlePriv]::Enable('SeRestorePrivilege')

$admins = New-Object System.Security.Principal.NTAccount('BUILTIN\Administrators')
$rw = [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree
$own = [System.Security.AccessControl.RegistryRights]::TakeOwnership
$chg = [System.Security.AccessControl.RegistryRights]::ChangePermissions

$renderRoot = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render'
foreach ($key in Get-ChildItem -Path $renderRoot -ErrorAction SilentlyContinue) {
    $state = (Get-ItemProperty -Path $key.PSPath -Name 'DeviceState' -ErrorAction SilentlyContinue).DeviceState
    if ($state -ne 1) { continue }
    $guid = Split-Path $key.PSPath -Leaf
    $sub = 'SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render\' + $guid

    foreach ($p in @($sub, ($sub + '\FxProperties'))) {
        try {
            $k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($p, $rw, $own)
            if ($k) { $a = $k.GetAccessControl([System.Security.AccessControl.AccessControlSections]::None); $a.SetOwner($admins); $k.SetAccessControl($a); $k.Close() }
            $k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($p, $rw, $chg)
            if ($k) { $a = $k.GetAccessControl(); $r = New-Object System.Security.AccessControl.RegistryAccessRule($admins,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $a.SetAccessRule($r); $k.SetAccessControl($a); $k.Close() }
        } catch { }
    }

    try {
        $fx = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($sub + '\FxProperties', $true)
        if (-not $fx) { $fx = [Microsoft.Win32.Registry]::LocalMachine.CreateSubKey($sub + '\FxProperties') }
        $fx.SetValue($pkeyTitle, 'HearLink', [Microsoft.Win32.RegistryValueKind]::String)
        $fx.SetValue($pkeyAssoc, '{00000000-0000-0000-0000-000000000000}', [Microsoft.Win32.RegistryValueKind]::String)
        $fx.SetValue($pkeyLfx, $clsid, [Microsoft.Win32.RegistryValueKind]::String)
        $fx.SetValue($pkeySfx, $clsid, [Microsoft.Win32.RegistryValueKind]::String)
        $fx.SetValue($pkeyEfx, $clsid, [Microsoft.Win32.RegistryValueKind]::String)
        $fx.SetValue($pkeyDisable, 0, [Microsoft.Win32.RegistryValueKind]::DWord)
        $fx.Close()
        ('title+assoc set: ' + $guid) | Add-Content -LiteralPath $log
    } catch {
        ('fail: ' + $guid + ' ' + $_.Exception.Message.Split([Environment]::NewLine)[0]) | Add-Content -LiteralPath $log
    }
}
Restart-Service audiosrv -Force -ErrorAction SilentlyContinue
'done' | Add-Content -LiteralPath $log
