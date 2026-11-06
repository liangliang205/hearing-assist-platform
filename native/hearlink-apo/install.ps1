# Install the HearLink verification APO on active render endpoints.
# Must run elevated (High integrity). ASCII only on purpose.

param([string[]]$Endpoint = @())

$ErrorActionPreference = 'Stop'
$clsid = '{8D3F1A2B-5C4E-4F60-9B7A-1E2D3C4B5A69}'
$apoInterface0 = '{FD7F2B29-24D0-4B5C-B177-592C39F9CA10}'
$pkeyStreamClsid = '{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},5'
$pkeyModes = '{d3993a3f-99c2-4402-b5ec-a92a0367664b},5'
$modeDefault = '{C18E2F7E-933D-4965-B7D1-1EEF228D2AF3}'
$modeMedia = '{4780004E-7133-41D8-8C74-660DADD2C0EE}'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$source = Join-Path $here 'build\HearLinkApo.dll'
if (-not (Test-Path -LiteralPath $source)) { throw 'Run build.ps1 first.' }

$dataDir = 'C:\ProgramData\HearLink'
$installDir = Join-Path $dataDir 'Apo'
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
$target = Join-Path $installDir 'HearLinkApo.dll'
Copy-Item -LiteralPath $source -Destination $target -Force

$gainFile = Join-Path $dataDir 'gain.txt'
if (-not (Test-Path -LiteralPath $gainFile)) { Set-Content -LiteralPath $gainFile -Value '2.0' -Encoding ascii }

# --- COM registration
$comKey = "HKLM:\SOFTWARE\Classes\CLSID\$clsid\InProcServer32"
New-Item -Path $comKey -Force | Out-Null
Set-ItemProperty -Path $comKey -Name '(default)' -Value $target
Set-ItemProperty -Path $comKey -Name 'ThreadingModel' -Value 'Both'

# --- Audio engine registration
$engineKey = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AudioEngine\AudioProcessingObjects\$clsid"
New-Item -Path $engineKey -Force | Out-Null
$engineValues = [ordered]@{
    'FriendlyName'         = @('HearLink minimal verification APO', 'String')
    'Copyright'            = @('HearLink', 'String')
    'MajorVersion'         = @(1, 'DWord')
    'MinorVersion'         = @(0, 'DWord')
    'Flags'                = @(14, 'DWord')
    'MinInputConnections'  = @(1, 'DWord')
    'MaxInputConnections'  = @(1, 'DWord')
    'MinOutputConnections' = @(1, 'DWord')
    'MaxOutputConnections' = @(1, 'DWord')
    'MaxInstances'         = @(100, 'DWord')
    'NumAPOInterfaces'     = @(1, 'DWord')
    'APOInterface0'        = @($apoInterface0, 'String')
}
foreach ($name in $engineValues.Keys) {
    $value, $type = $engineValues[$name]
    New-ItemProperty -Path $engineKey -Name $name -Value $value -PropertyType $type -Force | Out-Null
}

# --- Enable SeTakeOwnershipPrivilege (endpoint keys are owned by SYSTEM)
$src = @'
using System;
using System.Runtime.InteropServices;
public class HlPriv {
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
if (-not ('HlPriv' -as [type])) { Add-Type -TypeDefinition $src }
[void][HlPriv]::Enable('SeTakeOwnershipPrivilege')
[void][HlPriv]::Enable('SeRestorePrivilege')

# --- Pick endpoints
$renderRoot = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render'
$all = @()
foreach ($key in Get-ChildItem -Path $renderRoot -ErrorAction SilentlyContinue) {
    $state = (Get-ItemProperty -Path $key.PSPath -Name 'DeviceState' -ErrorAction SilentlyContinue).DeviceState
    $friendly = (Get-ItemProperty -Path (Join-Path $key.PSPath 'Properties') -Name '{a45c254e-df1c-4efd-8020-67d146a850e0},2' -ErrorAction SilentlyContinue).'{a45c254e-df1c-4efd-8020-67d146a850e0},2'
    $all += [pscustomobject]@{ Guid = Split-Path $key.PSPath -Leaf; State = $state; Friendly = $friendly }
}
$active = $all | Where-Object { $_.State -eq 1 }
$selected = if ($Endpoint.Count -gt 0) { $active | Where-Object { $Endpoint -contains $_.Guid } } else { $active }
if (-not $selected) { throw 'No active render endpoint found.' }

$admins = New-Object System.Security.Principal.NTAccount('BUILTIN\Administrators')
$rw = [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree

foreach ($device in $selected) {
    $sub = 'SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render\' + $device.Guid

    # take ownership then grant Administrators full control (SYSTEM keeps its rights)
    try {
        $k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($sub, $rw, [System.Security.AccessControl.RegistryRights]::TakeOwnership)
        $acl = $k.GetAccessControl([System.Security.AccessControl.AccessControlSections]::None)
        $acl.SetOwner($admins)
        $k.SetAccessControl($acl)
        $k.Close()
    } catch {
        Write-Host ('  [warn] take ownership failed for ' + $device.Guid + ': ' + $_.Exception.Message)
    }

    try {
        $k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($sub, $rw, [System.Security.AccessControl.RegistryRights]::ChangePermissions)
        $acl = $k.GetAccessControl()
        $rule = New-Object System.Security.AccessControl.RegistryAccessRule($admins, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.SetAccessRule($rule)
        $k.SetAccessControl($acl)
        $k.Close()
    } catch {
        Write-Host ('  [warn] set ACL failed for ' + $device.Guid + ': ' + $_.Exception.Message)
    }

    $fx = [Microsoft.Win32.Registry]::LocalMachine.CreateSubKey($sub + '\FxProperties')
    $fx.SetValue($pkeyStreamClsid, $clsid, [Microsoft.Win32.RegistryValueKind]::String)
    $fx.SetValue($pkeyModes, [string[]]@($modeDefault, $modeMedia), [Microsoft.Win32.RegistryValueKind]::MultiString)
    $fx.Close()

    Write-Host ('registered: ' + $device.Friendly + ' [' + $device.Guid + ']')
}

Restart-Service audiosrv -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host ''
Write-Host 'Install done.'
Write-Host ('  dll   : ' + $target)
Write-Host ('  gain  : ' + (Get-Content -LiteralPath $gainFile))
Write-Host ('  log   : ' + (Join-Path $dataDir 'apo.log'))
Write-Host '  verify: play any audio, then read the log.'
