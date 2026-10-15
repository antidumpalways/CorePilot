param([Parameter(Mandatory = $true)][string]$RpcUrl)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$uri = [uri]$RpcUrl
if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'elysium-testnet.g.alchemy.com' -or
    -not $uri.AbsolutePath.StartsWith('/v2/', [StringComparison]::Ordinal) -or
    $uri.Query -or $uri.Fragment) {
  throw 'Expected an HTTPS Alchemy Elysium testnet RPC URL.'
}

$targets = [ordered]@{
  'apps/api/.env' = 'ELYSIUM_RPC_URL'
  'apps/web/.env' = 'VITE_ELYSIUM_RPC_URL'
  'apps/executor/.env' = 'ELYSIUM_RPC_URL'
}
$updates = [ordered]@{}
foreach ($relative in $targets.Keys) {
  $path = Join-Path $repoRoot $relative
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing $relative" }
  $key = $targets[$relative]
  $lines = Get-Content -LiteralPath $path
  $matching = @($lines | Where-Object { $_.StartsWith("$key=") })
  if ($matching.Count -ne 1) { throw "Expected exactly one $key in $relative" }
  $updates[$path] = (($lines | ForEach-Object {
    if ($_.StartsWith("$key=")) { "$key=$RpcUrl" } else { $_ }
  }) -join "`r`n") + "`r`n"
}

foreach ($path in $updates.Keys) {
  [System.IO.File]::WriteAllText($path, $updates[$path], [System.Text.UTF8Encoding]::new($false))
}
Write-Output 'Updated only the Elysium RPC URL in three ignored local .env files. API key not displayed.'
