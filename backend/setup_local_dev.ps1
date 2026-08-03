param(
    [switch]$SkipSeed
)

$ErrorActionPreference = 'Stop'

$backendRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $backendRoot

Write-Host '== ChefAsap local setup ==' -ForegroundColor Green

function Import-DotEnvFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path $Path)) {
        return
    }

    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith('#')) {
            return
        }

        $parts = $line.Split('=', 2)
        if ($parts.Count -ne 2) {
            return
        }

        $key = $parts[0].Trim()
        $value = $parts[1].Trim().Trim('"')
        if ($key) {
            [System.Environment]::SetEnvironmentVariable($key, $value, 'Process')
        }
    }
}

function Get-BackendPython {
    $candidates = @(
        Join-Path $backendRoot '.venv\Scripts\python.exe'
        Join-Path $backendRoot 'venv\Scripts\python.exe'
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCommand) {
        return $pythonCommand.Source
    }

    $pyCommand = Get-Command py -ErrorAction SilentlyContinue
    if ($pyCommand) {
        return $pyCommand.Source
    }

    throw 'No backend Python interpreter found. Create or activate the backend venv first.'
}

$pythonExe = Get-BackendPython
$pythonLabel = Split-Path $pythonExe -Leaf

# Load environment files for scripts that run outside Flask app startup.
Import-DotEnvFile -Path (Join-Path $backendRoot '.env')
Import-DotEnvFile -Path (Join-Path $backendRoot '.env.local')

$env:PYTHONPATH = $backendRoot
$env:DB_MODE = 'local'

Write-Host "Using Python interpreter: $pythonExe" -ForegroundColor Yellow
Write-Host 'Bootstrapping local PostgreSQL schema...' -ForegroundColor Cyan
& $pythonExe .\database\setup_local_postgres.py

if (-not $SkipSeed) {
    Write-Host 'Seeding local test data...' -ForegroundColor Cyan
    & $pythonExe .\database\seed_local_data.py
}

Write-Host ''
Write-Host 'Local setup complete.' -ForegroundColor Green
Write-Host 'Next steps:' -ForegroundColor Green
Write-Host '  1. Start the backend from the backend folder with DB_MODE=local.'
Write-Host '  2. Start Expo from the frontend folder with npx expo start.'
Write-Host '  3. Sign in with customer1@gmail.com / QWEasd123!'
Write-Host '  4. Open Profile -> Guest Test Harness.'