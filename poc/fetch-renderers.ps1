# Downloads the two MusicXML renderers compared by renderers.html into poc/vendor/ (gitignored).
# Pinned versions, straight from the npm packages via jsDelivr.

$ErrorActionPreference = 'Stop'

$dst = Join-Path $PSScriptRoot 'vendor'
New-Item -ItemType Directory -Force $dst | Out-Null

$files = @(
    @{ Url = 'https://cdn.jsdelivr.net/npm/opensheetmusicdisplay@2.2.0/build/opensheetmusicdisplay.min.js'; Name = 'opensheetmusicdisplay.min.js' },
    @{ Url = 'https://cdn.jsdelivr.net/npm/verovio@6.3.0/dist/verovio-toolkit-wasm.js'; Name = 'verovio-toolkit-wasm.js' }
)

foreach ($f in $files) {
    $out = Join-Path $dst $f.Name
    Invoke-WebRequest -Uri $f.Url -OutFile $out -UseBasicParsing
    Write-Host ('{0} ({1:N1} MB)' -f $f.Name, ((Get-Item $out).Length / 1MB))
}

Write-Host "Done: $dst"
