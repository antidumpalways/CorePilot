param(
  [int]$Port = 55432
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$localDir = Join-Path $repo '.local'
$dataDir = Join-Path $localDir 'postgres'
$apiEnvPath = Join-Path $repo 'apps/api/.env'
$executorEnvPath = Join-Path $repo 'apps/executor/.env'
$binDir = 'C:\Program Files\PostgreSQL\18\bin'
$initdb = Join-Path $binDir 'initdb.exe'
$pgCtl = Join-Path $binDir 'pg_ctl.exe'
$psql = Join-Path $binDir 'psql.exe'

foreach ($binary in @($initdb, $pgCtl, $psql)) {
  if (-not (Test-Path -LiteralPath $binary)) { throw "PostgreSQL 18 binary missing: $binary" }
}
if (Test-Path -LiteralPath $apiEnvPath) { throw 'apps/api/.env already exists; refusing to overwrite it.' }
if (Test-Path -LiteralPath $dataDir) { throw '.local/postgres already exists; refusing to reinitialize or overwrite it.' }
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  throw "Port $Port is already in use."
}

New-Item -ItemType Directory -Path $localDir -Force | Out-Null
$randomBytes = New-Object byte[] 24
$generator = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $generator.GetBytes($randomBytes) } finally { $generator.Dispose() }
$password = ([BitConverter]::ToString($randomBytes) -replace '-', '').ToLowerInvariant()
$passwordPath = Join-Path $localDir 'pg-init-password.tmp'
$logPath = Join-Path $localDir 'postgres.log'
try {
  [IO.File]::WriteAllText($passwordPath, "$password`n")
  & $initdb -D $dataDir -U corepilot --auth-host=scram-sha-256 --auth-local=scram-sha-256 --pwfile=$passwordPath --encoding=UTF8 --no-instructions
  if ($LASTEXITCODE -ne 0) { throw 'initdb failed; no existing PostgreSQL cluster was modified.' }
} finally {
  if (Test-Path -LiteralPath $passwordPath) { Remove-Item -LiteralPath $passwordPath -Force }
}

& $pgCtl -D $dataDir -l $logPath -o "-h 127.0.0.1 -p $Port" -w start
if ($LASTEXITCODE -ne 0) { throw 'Local CorePilot PostgreSQL did not start.' }

$previousPgPassword = $env:PGPASSWORD
try {
  $env:PGPASSWORD = $password
  & $psql -w -h 127.0.0.1 -p $Port -U corepilot -d postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE corepilot' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'CorePilot database creation failed.' }
} finally {
  if ($null -eq $previousPgPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  else { $env:PGPASSWORD = $previousPgPassword }
}

$lines = [Collections.Generic.List[string]]::new()
$lines.Add('# Local CorePilot development database; never commit this file.')
$lines.Add("DATABASE_URL=postgresql://corepilot:$password@127.0.0.1:$Port/corepilot")
$lines.Add('API_PORT=8001')
$approvedKeys = @('ELYSIUM_RPC_URL','ELYSIUM_CHAIN_ID','PILOT_TOKEN_ADDRESS','STAKING_ADDRESS',
  'STRATEGY_REGISTRY_ADDRESS','EXECUTION_CONTROLLER_ADDRESS','MARKET_DATA_ORACLE_ADDRESS',
  'FEE_MODULE_ADDRESS','RECEIPT_REGISTRY_ADDRESS')
if (Test-Path -LiteralPath $executorEnvPath) {
  foreach ($line in Get-Content -LiteralPath $executorEnvPath) {
    if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$' -and $approvedKeys -contains $Matches[1]) {
      $lines.Add("$($Matches[1])=$($Matches[2])")
    }
  }
}
[IO.File]::WriteAllLines($apiEnvPath, $lines)
Write-Output "CorePilot-only PostgreSQL initialized on 127.0.0.1:$Port; apps/api/.env created (credentials hidden)."
