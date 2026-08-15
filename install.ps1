# Install DSH WSL presets into %USERPROFILE%\.dsh\.agent-presets
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $env:USERPROFILE '.dsh\.agent-presets'

New-Item -ItemType Directory -Force -Path $dest | Out-Null

Copy-Item -Recurse -Force (Join-Path $repo 'presets\minimal-wsl') $dest
Copy-Item -Recurse -Force (Join-Path $repo 'presets\code-wsl') $dest

Write-Host 'Installed presets:'
Write-Host "  $dest\minimal-wsl"
Write-Host "  $dest\code-wsl"
Write-Host ''
Write-Host 'Next: start DSH Web with the wsl-bash host patch:'
Write-Host "  dsh --profile web --patch $repo\host\dsh-wsl-bash\cordis.patch.yml --port 3xxx"
