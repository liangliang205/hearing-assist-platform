$log = 'D:\workspace\hearing-assist-platform\native\hearlink-apo\build\owner.txt'
$render = 'SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render'
$guid = '{4b10bba8-c788-4503-9200-cbc63c11a893}'
$sub = "$render\$guid"

function Try-Step($name, $block) {
    try { & $block; "$name => OK" | Add-Content -LiteralPath $log }
    catch { "$name => FAIL: " + $_.Exception.GetType().Name + ': ' + $_.Exception.Message.Split([Environment]::NewLine)[0] | Add-Content -LiteralPath $log }
}

"whoami: $(whoami)" | Set-Content -LiteralPath $log
whoami /groups | Select-String 'S-1-16' | ForEach-Object { "IL: $($_.Line.Trim())" } | Add-Content -LiteralPath $log

$takeOwnership = [System.Security.AccessControl.RegistryRights]::TakeOwnership
$readWrite = [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree

Try-Step 'open endpoint key (read)' {
    $k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($sub, $false)
    if ($null -eq $k) { throw 'null key' }
    $k.Close()
}

Try-Step 'open endpoint key (rw)' {
    $k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($sub, $true)
    if ($null -eq $k) { throw 'null key' }
    $k.Close()
}

Try-Step 'open with TakeOwnership' {
    $k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($sub, $readWrite, $takeOwnership)
    if ($null -eq $k) { throw 'null key' }
    $k.Close()
}

Try-Step 'set owner to Administrators' {
    $k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($sub, $readWrite, $takeOwnership)
    $acl = $k.GetAccessControl([System.Security.AccessControl.AccessControlSections]::None)
    $admins = New-Object System.Security.Principal.NTAccount('BUILTIN\Administrators')
    $acl.SetOwner($admins)
    $k.SetAccessControl($acl)
    $k.Close()
}

Try-Step 'grant Administrators FullControl' {
    $k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($sub, $readWrite, [System.Security.AccessControl.RegistryRights]::ChangePermissions)
    $acl = $k.GetAccessControl()
    $admins = New-Object System.Security.Principal.NTAccount('BUILTIN\Administrators')
    $rule = New-Object System.Security.AccessControl.RegistryAccessRule($admins, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.SetAccessRule($rule)
    $k.SetAccessControl($acl)
    $k.Close()
}

Try-Step 'create FxProperties + write value' {
    $fx = [Microsoft.Win32.Registry]::LocalMachine.CreateSubKey("$sub\FxProperties")
    $fx.SetValue('{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},5', '{8D3F1A2B-5C4E-4F60-9B7A-1E2D3C4B5A69}', 'String')
    $fx.Close()
}
