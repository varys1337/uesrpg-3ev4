# One-time repair for *installed* UESRPG 14.2.1 metadata on Windows.
# Does not change any world data or alter GitHub release assets.
# Run only with Foundry VTT stopped. Foundry v14.368+ is required by 14.3.0.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstalledSystemDirectory
)

$ErrorActionPreference = 'Stop'
$manifestPath = Join-Path -Path $InstalledSystemDirectory -ChildPath 'system.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "system.json was not found at $manifestPath"
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$original = [System.IO.File]::ReadAllText($manifestPath)
$manifest = $original | ConvertFrom-Json
if ($manifest.id -ne 'uesrpg-3ev4') {
    throw "Unexpected system ID '$($manifest.id)'; no changes made."
}
if ($manifest.version -eq '14.2.1') {
    Write-Host 'Already normalized to 14.2.1; no changes made.'
    exit 0
}
if ($manifest.version -ne 'v14.2.1') {
    throw "Expected installed version v14.2.1, got '$($manifest.version)'; no changes made."
}

$stableManifest = 'https://github.com/varys1337/uesrpg-3ev4/releases/latest/download/system.json'
if ($manifest.manifest -ne $stableManifest) {
    throw "Unexpected update manifest URL '$($manifest.manifest)'; no changes made."
}

# Match the root-level version property, without reserializing the whole manifest.
$pattern = '(?m)^(\s{2}"version"\s*:\s*)"v14\.2\.1"(\s*,?\s*)$'
$matches = [regex]::Matches($original, $pattern)
if ($matches.Count -ne 1) {
    throw "Expected exactly one root version field; found $($matches.Count). No changes made."
}
$updated = [regex]::Replace($original, $pattern, '${1}"14.2.1"${2}')
$parsedUpdated = $updated | ConvertFrom-Json
if ($parsedUpdated.version -ne '14.2.1') {
    throw 'Version normalization failed preflight; no changes made.'
}

$backupPath = "$manifestPath.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item -LiteralPath $manifestPath -Destination $backupPath -ErrorAction Stop
try {
    [System.IO.File]::WriteAllText($manifestPath, $updated, $utf8NoBom)
} catch {
    Copy-Item -LiteralPath $backupPath -Destination $manifestPath -Force
    throw
}

Write-Host "Installed package metadata normalized: v14.2.1 -> 14.2.1"
Write-Host "Backup saved to: $backupPath"
Write-Host 'Start Foundry v14.368 or later and check for updates again.'
