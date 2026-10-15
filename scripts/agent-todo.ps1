[CmdletBinding()]
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$TodoArguments)

$ErrorActionPreference = 'Stop'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Agent Todo requires Node.js 22.13 or newer.' }
$cli = Join-Path $PSScriptRoot 'cli.ts'
& $node $cli @TodoArguments
exit $LASTEXITCODE
