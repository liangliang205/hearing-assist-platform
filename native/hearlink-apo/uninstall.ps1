# 卸载 HearLink 最小验证 APO，恢复系统原始音频行为。
# 需要管理员权限。

$ErrorActionPreference = 'Stop'

$clsid = '{8D3F1A2B-5C4E-4F60-9B7A-1E2D3C4B5A69}'
$pkeyStreamClsid = '{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},5'
$pkeyModes = '{d3993a3f-99c2-4402-b5ec-a92a0367664b},5'

# 1) 移除所有端点上的注册
$renderRoot = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render'
foreach ($key in Get-ChildItem -Path $renderRoot -ErrorAction SilentlyContinue) {
    $fx = Join-Path $key.PSPath 'FxProperties'
    if (-not (Test-Path -LiteralPath $fx)) { continue }
    $current = (Get-ItemProperty -Path $fx -Name $pkeyStreamClsid -ErrorAction SilentlyContinue).$pkeyStreamClsid
    if ($current -eq $clsid) {
        Remove-ItemProperty -Path $fx -Name $pkeyStreamClsid -ErrorAction SilentlyContinue
        Remove-ItemProperty -Path $fx -Name $pkeyModes -ErrorAction SilentlyContinue
        Write-Host ('已从端点移除: ' + (Split-Path $key.PSPath -Leaf))
    }
}

# 2) 移除音频引擎注册
$engineKey = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AudioEngine\AudioProcessingObjects\$clsid"
if (Test-Path -LiteralPath $engineKey) { Remove-Item -Path $engineKey -Recurse -Force }

# 3) 移除 COM 注册
$comKey = "HKLM:\SOFTWARE\Classes\CLSID\$clsid"
if (Test-Path -LiteralPath $comKey) { Remove-Item -Path $comKey -Recurse -Force }

# 4) 删除 DLL（保留日志方便排查）
$installDir = 'C:\ProgramData\HearLink\Apo'
if (Test-Path -LiteralPath $installDir) { Remove-Item -LiteralPath $installDir -Recurse -Force -ErrorAction SilentlyContinue }

Restart-Service audiosrv -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host '已卸载，音频恢复原始状态。'
