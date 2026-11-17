#!/usr/bin/env pwsh
# Deploy script for Sabor +58 — publishes the current working tree to production.
# Usage: .\scripts\deploy.ps1 [-Commit] [-Push] [-NoTest]
#
# WARNING: This script does NOT touch Neon (database) or .env by default.
# The deploy only commits + pushes code; database migrations must be applied
# separately with explicit consent.

# --------------------------------------------------
# Parse parameters
# --------------------------------------------------
[CmdletBinding()]
param(
    [Switch]$Commit,
    [Switch]$Push,
    [Switch]$NoTest
)

$VerbosePreference = 'SilentlyContinue'

function Write-Good { Write-Host "$using:Green [deploy] $args" -ForegroundColor $using:Green }
function Write-Warn { Write-Host "$using:Yellow [deploy] $args" -ForegroundColor $using:Yellow }
function Write-Err  { Write-Host "$using:Red [deploy] $args"   -ForegroundColor $using:Red }

function Usage {
    $help = @"
Usage: .\scripts\deploy.ps1 [-Commit] [-Push] [-NoTest] [-Help]

Options:
  -Commit           Stage and commit all changes (default: no commit)
  -Push             Push to remote (default: no push)
  -NoTest           Skip the test suite
  -Help             Show this help message

Examples:
  .\scripts\deploy.ps1                  # dry run: tests only, no commit/push
  .\scripts\deploy.ps1 -Commit -Push   # full publish: tests → commit → push
"@
    $help
    exit 0
}

# Parse named parameters manually (simple approach)
$argsRemaining = @()
for ($i = 0; $i -lt $args.Count; $i++) {
    switch -regex $args[$i] {
        '^-Commit$'    { $Commit=$true; continue }
        '^-Push$'      { $Push=$true; continue }
        '^-NoTest$'    { $NoTest=$true; continue }
        '^-Help$'|'^-?' { Usage; continue }
        default        { $argsRemaining += $args[$i]; continue }
    }
}
if ($argsRemaining.Contains('Help')) { Usage }

$ROOT = Split-Path (Get-Location -PSParentPath).Path -Parent
$ROOT = [io]::Path::GetFullPath("$ROOT/..")
Set-Location $ROOT

# --------------------------------------------------
# 1. Test suite
# --------------------------------------------------
if (-not $NoTest) {
    Write-Good "Running test suite..."
    $testResult = npm test 2>&1
    $passCount = ($testResult | Select-String 'pass \d').Matches.Groups[1].Value
    $failCount = ($testResult | Select-String 'fail \d').Matches.Groups[1].Value
    Write-Good "Tests: $passCount passed, $failCount failed"

    if ($failCount -gt 0) {
        Write-Err "Tests failed — aborting deploy"
        exit 1
    }
} else {
    Write-Warn "Tests skipped (–NoTest)"
}

# --------------------------------------------------
# 2. Sanity checks
# --------------------------------------------------
Write-Good "Running sanity checks..."

# Check for PowerShell-style corruption ($' trailing content)
$corruptFiles = @()
Get-ChildItem -Recurse -Include *.js,*.html,*.md . |
    Where-Object { $_.FullName -notmatch '\.impeccable' -and $_.FullName -notmatch 'node_modules' } |
    ForEach-Object {
        $content = Get-Content $_.FullName -Raw
        # Look for the "$' pattern that PowerShell bug introduced
        if ($content -match '\$') {
            # Quick heuristic: the file has been modified via PowerShell replacement strings
            # Check specifically for the COP→es-VE replacement pattern duplication
            if ($content -match "minimumFractionDigits: 0, maximumFractionDigits: 2\)\.format\(Number\(value\) \|\| 0\)") {
                $corruptFiles += $_.FullName
            }
        }
    }

if ($corruptFiles.Count -gt 0) {
    Write-Err "Corrupt files detected (PowerShell $' bug): $($corruptFiles -join ', ')"
    exit 2
}

# Check for mojibake-style UTF-8 bytes (simplified: look for common broken chars)
$mojibakeFiles = @()
Get-ChildItem -Recurse -Include *.js,*.html,*.md . |
    Where-Object { $_.FullName -notmatch '\.impeccable' -and $_.FullName -notmatch 'node_modules' } |
    ForEach-Object {
        $content = Get-Content $_.FullName -Raw
        # Look for typical UTF-8 mojibake sequences
        if ($content -match 'ÃÂ­|ÃÂ©|ÃÂ±') {
            $mojibakeFiles += $_.FullName
        }
    }

if ($mojibakeFiles.Count -gt 0) {
    Write-Err "Mojibake files detected: $($mojibakeFiles -join ', ')"
    exit 2
}

Write-Good "Sanity checks passed ✓"

# --------------------------------------------------
# 3. Commit (optional)
# --------------------------------------------------
if ($Commit) {
    Write-Good "Staging changes..."
    git Add -Path . -ErrorAction Stop

    $timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH-mm-ssZ")
    $commitMsg = "deploy: $timestamp

- Dropdown de método de pago: fix de contraste en <option>
- Cola: FIFO + aging badges + legibilidad de cocina
- Cierre de caja: panel pre-cierre vivo + confirmación de dos pasos
- Localización: es-VE / America/Caracas (no rieles de pago)"

    $commitResult = git Commit -Message $commitMsg -ErrorAction Stop
    Write-Good "Committed ✓"
} else {
    Write-Warn "Skipping commit (–Commit not set)"
}

# --------------------------------------------------
# 4. Push (optional)
# --------------------------------------------------
if ($Push) {
    if (-not (git Remote Get-UniqueUrl origin -ErrorAction SilentlyContinue)) {
        Write-Err "No remote 'origin' configured — cannot push"
        exit 2
    }

    $branch = git Branch -tracking | Where-Object { $_.Label -match '\\* (.+)' } | ForEach-Object { $_.Matches.Groups[1].Value }
    Write-Good "Pushing to $branch..."
    git Push Origin $branch -ErrorAction Stop
    Write-Good "Pushed ✓"
} else {
    Write-Warn "Skipping push (–Push not set)"
}

# --------------------------------------------------
# 5. Summary
# --------------------------------------------------
Write-Good "Deploy summary:"
git Status --short
Write-Host "`nDone." -ForegroundColor $using:Green