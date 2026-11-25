param([string[]]$MavenArgs = @())

$ErrorActionPreference = 'Stop'
$runId = [Guid]::NewGuid().ToString('N')
$container = 'teamflow-test-' + $runId
$database = 'teamflow_test_' + $runId
$previousDockerPassword = $env:POSTGRES_PASSWORD
$previousTestPassword = $env:TEAMFLOW_TEST_DB_PASSWORD
$previousTestUrl = $env:TEAMFLOW_TEST_DB_URL
$started = $false

Push-Location -LiteralPath $PSScriptRoot
try {
    $env:TEAMFLOW_TEST_DB_PASSWORD = [Guid]::NewGuid().ToString('N')
    $env:POSTGRES_PASSWORD = $env:TEAMFLOW_TEST_DB_PASSWORD
    docker run --detach --rm --name $container --publish '127.0.0.1::5432' --tmpfs '/var/lib/postgresql/data' --env POSTGRES_PASSWORD --env POSTGRES_USER=teamflow_test --env "POSTGRES_DB=$database" postgres:16-alpine | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not start isolated PostgreSQL' }
    $started = $true
    $binding = docker port $container 5432/tcp
    if ($LASTEXITCODE -ne 0 -or $binding -notmatch '^127\.0\.0\.1:(\d+)$') {
        throw 'Could not resolve isolated PostgreSQL port'
    }
    $env:TEAMFLOW_TEST_DB_URL = 'jdbc:postgresql://127.0.0.1:' + $Matches[1] + '/' + $database

    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        docker exec $container pg_isready -h 127.0.0.1 -U teamflow_test -d $database | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $ready = $true
            break
        }
        Start-Sleep -Seconds 1
    }
    if (!$ready) { throw 'Isolated PostgreSQL did not become ready' }

    .\mvnw.cmd test @MavenArgs
    if ($LASTEXITCODE -ne 0) { throw 'Backend test command failed' }
} finally {
    if ($started) { docker stop $container | Out-Null }
    $env:POSTGRES_PASSWORD = $previousDockerPassword
    $env:TEAMFLOW_TEST_DB_PASSWORD = $previousTestPassword
    $env:TEAMFLOW_TEST_DB_URL = $previousTestUrl
    Pop-Location
}
