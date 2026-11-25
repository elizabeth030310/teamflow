$ErrorActionPreference = 'Stop'
$frontend = Resolve-Path (Join-Path $PSScriptRoot '../../../frontend')
$destination = Join-Path $PSScriptRoot ('.preview-deploy/' + [guid]::NewGuid().ToString('N'))
$previousMode = $env:VITE_TEAMFLOW_NODE_API

Push-Location $frontend
try {
    $env:VITE_TEAMFLOW_NODE_API = '1'
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'TeamFlow frontend build failed' }
} finally {
    $env:VITE_TEAMFLOW_NODE_API = $previousMode
    Pop-Location
}

$public = Join-Path $destination 'public'
New-Item -ItemType Directory -Path $public | Out-Null
foreach ($name in @('api', 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'vercel.json')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $destination -Recurse
}
Get-ChildItem -LiteralPath (Join-Path $frontend 'dist') | Copy-Item -Destination $public -Recurse
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'public/index.html') -Destination (Join-Path $public 'auth-preview.html')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'public/preview.js') -Destination $public
Write-Output $destination
