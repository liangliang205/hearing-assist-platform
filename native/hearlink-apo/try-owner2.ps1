$log = 'D:\workspace\hearing-assist-platform\native\hearlink-apo\build\owner2.txt'
Set-Content -LiteralPath $log -Value ("whoami: " + (whoami))
whoami /groups | Select-String 'S-1-16' | ForEach-Object { "IL: $($_.Line.Trim())" } | Add-Content -LiteralPath $log

$src = @'
using System;
using System.Runtime.InteropServices;
public class Priv {
  [DllImport("advapi32.dll", SetLastError=true)]
  public static extern bool OpenProcessToken(IntPtr h, uint acc, out IntPtr tok);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool LookupPrivilegeValue(string host, string name, out long luid);
  [DllImport("advapi32.dll", SetLastError=true)]
  public static extern bool AdjustTokenPrivileges(IntPtr tok, bool dis, ref TokPriv1Luid newst, int len, IntPtr prev, IntPtr relen);
  [StructLayout(LayoutKind.Sequential, Pack=1)]
  public struct TokPriv1Luid { public int Count; public long Luid; public int Attr; }
  public static bool Enable(string name) {
    IntPtr tok;
    if (!OpenProcessToken(System.Diagnostics.Process.GetCurrentProcess().Handle, 0x28, out tok)) return false;
    TokPriv1Luid tp; tp.Count = 1; tp.Attr = 2;
    if (!LookupPrivilegeValue(null, name, out tp.Luid)) return false;
    return AdjustTokenPrivileges(tok, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
  }
}
'@
Add-Type -TypeDefinition $src
"SeTakeOwnership: $([Priv]::Enable('SeTakeOwnershipPrivilege'))" | Add-Content -LiteralPath $log
"SeRestore: $([Priv]::Enable('SeRestorePrivilege'))" | Add-Content -LiteralPath $log

$sub = 'SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render\{4b10bba8-c788-4503-9200-cbc63c11a893}'
$rw = [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree
$own = [System.Security.AccessControl.RegistryRights]::TakeOwnership

try {
    $k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($sub, $rw, $own)
    $acl = $k.GetAccessControl([System.Security.AccessControl.AccessControlSections]::None)
    $acl.SetOwner((New-Object System.Security.Principal.NTAccount('BUILTIN\Administrators')))
    $k.SetAccessControl($acl)
    $k.Close()
    'set owner => OK' | Add-Content -LiteralPath $log
} catch {
    ('set owner => FAIL: ' + $_.Exception.Message.Split([Environment]::NewLine)[0]) | Add-Content -LiteralPath $log
}
