# Copies the rehearsal MP3s from the repo-root audio/ folder into poc/audio/ so poc/ can be served or uploaded as-is. 

$ErrorActionPreference = 'Stop'

$src = Join-Path (Split-Path $PSScriptRoot -Parent) 'audio'
$dst = Join-Path $PSScriptRoot 'audio'

New-Item -ItemType Directory -Force $dst | Out-Null

foreach ($n in 1..4) {
    $file = Join-Path $src "test$n.mp3"
    if (-not (Test-Path $file)) {
        throw "Missing source file: $file"
    }
    Copy-Item $file $dst -Force
    Write-Host "Copied test$n.mp3"
}

Write-Host "Done: $dst"
