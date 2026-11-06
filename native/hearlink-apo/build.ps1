# Build the minimal HearLink verification APO (x64), including the version resource.
param([string]$Config = 'Release')

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$vcvars = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path -LiteralPath $vcvars)) { throw 'vcvars64.bat not found.' }

$outDir = Join-Path $here 'build'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$flags = if ($Config -eq 'Debug') { '/Od /Zi /MDd' } else { '/O2 /MD' }
$cl = 'cl /nologo /LD /EHsc /W3 /utf-8 /D_CRT_SECURE_NO_WARNINGS ' + $flags +
      ' apo.cpp dllmain.cpp /Fo:"' + $outDir + '\\" /Fe:"' + $outDir + '\HearLinkApo.dll"' +
      ' /link /DEF:exports.def /NODEFAULTLIB:atls.lib audiobaseprocessingobject.lib audiomediatypecrt.lib ole32.lib oleaut32.lib uuid.lib "' +
      $outDir + '\HearLinkApo.res"'
$rc = 'rc /nologo /fo "' + $outDir + '\HearLinkApo.res" HearLinkApo.rc'
$cmdLine = 'call "' + $vcvars + '" >nul 2>&1 && cd /d "' + $here + '" && ' + $rc + ' && ' + $cl

Write-Host 'Compiling...'
cmd /c $cmdLine
if ($LASTEXITCODE -ne 0) { throw ('Build failed, exit ' + $LASTEXITCODE) }

$dll = Join-Path $outDir 'HearLinkApo.dll'
if (-not (Test-Path -LiteralPath $dll)) { throw 'Build finished but DLL not found.' }
$size = [math]::Round((Get-Item $dll).Length / 1KB, 1)
$ver = (Get-Item $dll).VersionInfo.FileVersion
Write-Host ('OK: ' + $dll + ' (' + $size + ' KB, version ' + $ver + ')')
