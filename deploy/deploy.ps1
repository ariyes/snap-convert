# Snap Convert deploy for Windows PowerShell (P25). Same steps as deploy.sh; both run
# deploy/deploy.ts. Settings: deploy\.env (copy deploy\.env.example; never put passwords in it).
#
#   powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1              build, check, upload, switch
#   powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -DryRun      build and pack, print the
#                                                                           scp/ssh commands, don't connect
#   powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -SkipBuild   reuse build\client
#   powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Local C:\temp\snap-target
#
# Uses Windows' own OpenSSH client (ssh, scp) and tar. Log in with an SSH key; start the
# ssh-agent service and `ssh-add` your key once so you are not asked for the passphrase twice.
param(
  [switch]$DryRun,
  [switch]$SkipBuild,
  [string]$Local = ''
)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

# Windows opened before Node was installed don't have it on PATH yet.
foreach ($dir in @("$env:ProgramFiles\nodejs", "$env:APPDATA\npm")) {
  if ((Test-Path $dir) -and -not (($env:Path -split ';') -contains $dir)) { $env:Path += ";$dir" }
}

$need = @('node', 'pnpm', 'tar')
if (-not $Local -and -not $DryRun) { $need += @('ssh', 'scp') }
foreach ($tool in $need) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    Write-Error "deploy: '$tool' not found. ssh/scp: Settings > Apps > Optional features > OpenSSH Client."
    exit 1
  }
}

$nodeArgs = @('deploy/deploy.ts')
if ($DryRun) { $nodeArgs += '--dry-run' }
if ($SkipBuild) { $nodeArgs += '--skip-build' }
if ($Local) { $nodeArgs += @('--local', $Local) }

& node @nodeArgs
exit $LASTEXITCODE
