# Build the standalone APO host (x64).
param()
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$vcvars = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path -LiteralPath $vcvars)) { throw 'vcvars64.bat not found.' }

$outDir = Join-Path $here 'build'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$cl = 'cl /nologo /EHa /W3 /utf-8 /D_CRT_SECURE_NO_WARNINGS /MD host.cpp /Fo:"' + $outDir + '\\" /Fe:"' + $outDir + '\ApoHost.exe" /link ole32.lib oleaut32.lib uuid.lib'
$cmdLine = 'call "' + $vcvars + '" >nul 2>&1 && cd /d "' + $here + '" && ' + $cl
cmd /c $cmdLine
if ($LASTEXITCODE -ne 0) { throw ('Build failed, exit ' + $LASTEXITCODE) }
Write-Host ('OK: ' + (Join-Path $outDir 'ApoHost.exe'))
