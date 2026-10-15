param(
  [string]$BroadcastPath = 'packages/contracts/broadcast/Deploy.s.sol/99801/run-latest.json'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$resolvedBroadcast = (Resolve-Path (Join-Path $repoRoot $BroadcastPath)).Path
$expectedBroadcast = Join-Path $repoRoot 'packages/contracts/broadcast/Deploy.s.sol/99801'
if (-not $resolvedBroadcast.StartsWith($expectedBroadcast, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Broadcast file is outside the Elysium testnet deployment directory.'
}
$broadcast = Get-Content -LiteralPath $resolvedBroadcast -Raw | ConvertFrom-Json
if ($broadcast.chain -and [string]$broadcast.chain -ne '99801') { throw 'Wrong chain in broadcast.' }
if (($broadcast.receipts | Where-Object { $_.status -ne '0x1' }).Count -gt 0) { throw 'A deployment transaction failed.' }

$contractKeys = [ordered]@{
  PilotToken = 'PILOT_TOKEN_ADDRESS'
  PilotStaking = 'STAKING_ADDRESS'
  StrategyRegistry = 'STRATEGY_REGISTRY_ADDRESS'
  ExecutionController = 'EXECUTION_CONTROLLER_ADDRESS'
  FeeModule = 'FEE_MODULE_ADDRESS'
  SignedMarketDataOracle = 'MARKET_DATA_ORACLE_ADDRESS'
  ExecutionReceiptRegistry = 'RECEIPT_REGISTRY_ADDRESS'
}
$addresses = [ordered]@{}
foreach ($contract in $contractKeys.Keys) {
  $deployments = @($broadcast.transactions | Where-Object { $_.transactionType -eq 'CREATE' -and $_.contractName -eq $contract })
  if ($deployments.Count -ne 1 -or $deployments[0].contractAddress -notmatch '^0x[a-fA-F0-9]{40}$') {
    throw "Expected exactly one valid $contract deployment."
  }
  $addresses[$contractKeys[$contract]] = $deployments[0].contractAddress
}

$files = @('apps/api/.env', 'apps/web/.env', 'apps/executor/.env')
$originals = [ordered]@{}
$updates = [ordered]@{}
foreach ($relative in $files) {
  $path = Join-Path $repoRoot $relative
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing $relative" }
  $raw = Get-Content -LiteralPath $path -Raw
  $lines = $raw -split "`r?`n"
  $prefix = if ($relative -eq 'apps/web/.env') { 'VITE_' } else { '' }
  $previous = [ordered]@{}
  foreach ($key in $addresses.Keys) {
    $envKey = "$prefix$key"
    $matches = @($lines | Where-Object { $_ -match "^$envKey=" })
    if ($matches.Count -ne 1) { throw "Expected one $envKey in $relative" }
    $previous[$envKey] = ($matches[0] -split '=', 2)[1]
  }
  $newLines = foreach ($line in $lines) {
    $replacement = $line
    foreach ($key in $addresses.Keys) {
      $envKey = "$prefix$key"
      if ($line.StartsWith("$envKey=")) { $replacement = "$envKey=$($addresses[$key])"; break }
    }
    $replacement
  }
  $originals[$relative] = $previous
  $updates[$relative] = $newLines -join "`r`n"
}

$manifestPath = Join-Path $repoRoot 'deployments/elysium-testnet.json'
$manifestDir = Split-Path $manifestPath -Parent
New-Item -ItemType Directory -Path $manifestDir -Force | Out-Null
$history = @()
if (Test-Path -LiteralPath $manifestPath) {
  $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $history = @($priorManifest.previousDeployments | Where-Object { $null -ne $_ }) + @($priorManifest)
}
$manifest = [ordered]@{
  chainId = 99801
  network = 'Elysium Testnet'
  deployedAt = (Get-Date).ToUniversalTime().ToString('o')
  broadcastPath = $BroadcastPath.Replace('\', '/')
  transactionHashes = @($broadcast.receipts | ForEach-Object { $_.transactionHash })
  addresses = $addresses
  previousPublicAddresses = $originals
  previousDeployments = $history
}
foreach ($relative in $files) {
  [System.IO.File]::WriteAllText((Join-Path $repoRoot $relative), $updates[$relative], [System.Text.UTF8Encoding]::new($false))
}
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))
Write-Output 'Synchronized public deployment addresses in API, web, and executor env files.'
Write-Output "Deployment manifest: $manifestPath"
