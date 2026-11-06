# Full APO install: DLL + COM + HKCR engine registration + endpoint FX slots.
# Must run elevated. ASCII only.

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$source = Join-Path $here 'build\HearLinkApo.dll'
if (-not (Test-Path -LiteralPath $source)) { throw 'Run build.ps1 first.' }

$clsid = '{8D3F1A2B-5C4E-4F60-9B7A-1E2D3C4B5A69}'
$apoInterface0 = '{FD7F2B29-24D0-4B5C-B177-592C39F9CA10}'
$pkeyLfx = '{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},1'
$pkeyGfx = '{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},2'
$pkeySfx = '{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},5'
$pkeyModes = '{d3993a3f-99c2-4402-b5ec-a92a0367664b},5'
$pkeyDisable = '{1da5d803-d492-4edd-8c23-e0c0ffee7f0e},5'
$modeDefault = '{C18E2F7E-933D-4965-B7D1-1EEF228D2AF3}'

# 1) deploy DLL
$dataDir = 'C:\ProgramData\HearLink'
$installDir = Join-Path $dataDir 'Apo'
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
$target = Join-Path $installDir 'HearLinkApo.dll'
Copy-Item -LiteralPath $source -Destination $target -Force
$gainFile = Join-Path $dataDir 'gain.txt'
if (-not (Test-Path -LiteralPath $gainFile)) { Set-Content -LiteralPath $gainFile -Value '2.0' -Encoding ascii }

# 2) COM registration
$comKey = "HKLM:\SOFTWARE\Classes\CLSID\$clsid\InProcServer32"
New-Item -Path $comKey -Force | Out-Null
Set-ItemProperty -Path $comKey -Name '(default)' -Value $target
Set-ItemProperty -Path $comKey -Name 'ThreadingModel' -Value 'Both'

# 3) audio engine registration (HKCR view == HKLM\SOFTWARE\Classes)
$engineKey = "HKLM:\SOFTWARE\Classes\AudioEngine\AudioProcessingObjects\$clsid"
New-Item -Path $engineKey -Force | Out-Null
$values = [ordered]@{
    'FriendlyName'         = @('HearLink minimal verification APO', 'String')
    'Copyright'            = @('HearLink', 'String')
    'MajorVersion'         = @(1, 'DWord')
    'MinorVersion'         = @(0, 'DWord')
    'Flags'                = @(14, 'DWord')
    'MinInputConnections'  = @(1, 'DWord')
    'MaxInputConnections'  = @(1, 'DWord')
    'MinOutputConnections' = @(1, 'DWord')
    'MaxOutputConnections' = @(1, 'DWord')
    'MaxInstances'         = @([uint32]::MaxValue, 'DWord')
    'NumAPOInterfaces'     = @(1, 'DWord')
    'APOInterface0'        = @($apoInterface0, 'String')
}
foreach ($name in $values.Keys) {
    $value, $type = $values[$name]
    New-ItemProperty -Path $engineKey -Name $name -Value $value -PropertyType $type -Force | Out-Null
}

# 4) endpoint FX slots (keys are SYSTEM-owned, need TakeOwnership + ACL grant)
$src = @'
using System;
using System.Runtime.InteropServices;
public class InstallPriv {
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
if (-not ('InstallPriv' -as [type])) { Add-Type -TypeDefinition $src }
[void][InstallPriv]::Enable('SeTakeOwnershipPrivilege')
[void][InstallPriv]::Enable('SeRestorePrivilege')

$admins = New-Object System.Security.Principal.NTAccount('BUILTIN\Administrators')
$rw = [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree
$own = [System.Security.AccessControl.RegistryRights]::TakeOwnership
$chg = [System.Security.AccessControl.RegistryRights]::ChangePermissions

function Grant([string]$sub) {
    try {
        $k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($sub, $rw, $own)
        if ($k) {
            $acl = $k.GetAccessControl([System.Security.AccessControl.AccessControlSections]::None)
            $acl.SetOwner($admins)
            $k.SetAccessControl($acl)
            $k.Close()
        }
        $k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($sub, $rw, $chg)
        if ($k) {
            $acl = $k.GetAccessControl()
            $rule = New-Object System.Security.AccessControl.RegistryAccessRule($admins, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
            $acl.SetAccessRule($rule)
            $k.SetAccessControl($acl)
            $k.Close()
        }
    } catch { }
}

$renderRoot = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render'
foreach ($key in Get-ChildItem -Path $renderRoot -ErrorAction SilentlyContinue) {
    $state = (Get-ItemProperty -Path $key.PSPath -Name 'DeviceState' -ErrorAction SilentlyContinue).DeviceState
    if ($state -ne 1) { continue }
    $guid = Split-Path $key.PSPath -Leaf
    $sub = 'SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render\' + $guid

    Grant $sub
    Grant ($sub + '\FxProperties')

    try {
        $fx = [Microsoft.Win32.Registry]::LocalMachine.CreateSubKey($sub + '\FxProperties')
        $fx.SetValue($pkeyLfx, $clsid, [Microsoft.Win32.RegistryValueKind]::String)
        $fx.SetValue($pkeySfx, $clsid, [Microsoft.Win32.RegistryValueKind]::String)
        $fx.SetValue($pkeyModes, [string[]]@($modeDefault), [Microsoft.Win32.RegistryValueKind]::MultiString)
        $fx.SetValue($pkeyDisable, 0, [Microsoft.Win32.RegistryValueKind]::DWord)
        $fx.Close()
        Write-Host ('registered: ' + $guid)
    } catch {
        Write-Host ('failed: ' + $guid + ' ' + $_.Exception.Message)
    }
}

Restart-Service audiosrv -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Write-Host 'install complete'
