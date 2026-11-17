#!/usr/bin/env pwsh
# Deploy script for Sabor +58 - publishes the current working tree to production.
# Usage: .\scripts\deploy.ps1 [-Commit] [-Push] [-NoTest] [-Help]
#
# WARNING: This script does NOT touch Neon (database) or .env.
# The deploy only commits + pushes code; database migrations must be applied
# separately with explicit consent.
#
# Exit codes: 0 = success, 1 = test failure, 2 = sanity check failed, 3 = git error

[CmdletBinding()]
param(
    [Switch]$Commit,
    [Switch]$Push,
    [Switch]$NoTest,
    [Switch]$Help
)

function Write-Good { param([string]$Message) Write-Host "[deploy] $Message" -ForegroundColor Green }
function Write-Warn { param([string]$Message) Write-Host "[deploy] $Message" -ForegroundColor Yellow }
function Write-Err  { param([string]$Message) Write-Host "[deploy] $Message" -ForegroundColor Red }

function Usage {
    @"
Usage: .\scripts\deploy.ps1 [-Commit] [-Push] [-NoTest] [-Help]

Options:
  -Commit           Stage and commit all changes (default: no commit)
  -Push             Push to remote (default: no push)
  -NoTest           Skip the test suite
  -Help             Show this help message

Examples:
  .\scripts\deploy.ps1                  # dry run: tests only, no commit/push
  .\scripts\deploy.ps1 -Commit -Push   # full publish: tests, commit, push
"@
    exit 0
}

if ($Help) { Usage }

$ErrorActionPreference = 'Stop'
$ROOT = Split-Path -Parent $PSScriptRoot
Set-Location $ROOT

# --------------------------------------------------
# 1. Test suite
# --------------------------------------------------
if (-not $NoTest) {
    Write-Good "Running test suite..."
    npm test | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Tests failed - aborting deploy"
        exit 1
    }
    Write-Good "Tests passed"
} else {
    Write-Warn "Tests skipped (-NoTest)"
}

# --------------------------------------------------
# 2. Sanity checks
# --------------------------------------------------
Write-Good "Running sanity checks..."

# Scan for leaked secrets (api keys, private keys) in tracked + untracked working files.
$secretHits = @()
$candidates = Get-ChildItem -Recurse -File -Include *.js,*.html,*.md,*.json,*.sh,*.ps1,*.yml,*.yaml . |
    Where-Object { $_.FullName -notmatch '\\node_modules\\|\\.git\\|\\.impeccable\\' -and $_.FullName -notmatch '\\.env$' } |
    Select-String -Pattern 'rnd_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY' -List -ErrorAction SilentlyContinue
foreach ($hit in $candidates) { $secretHits += $hit.Path }
$secretHits = $secretHits | Sort-Object -Unique

if ($secretHits.Count -gt 0) {
    Write-Err "Possible secrets found in files: $($secretHits -join ', ')"
    exit 2
}

# Block .env from ever entering the index
if ((git ls-files --error-unmatch .env 2>$null)) {
    Write-Err ".env is tracked by git - refusing to continue"
    exit 2
}

Write-Good "Sanity checks passed"

# --------------------------------------------------
# 3. Commit (optional)
# --------------------------------------------------
if ($Commit) {
    Write-Good "Staging changes..."
    git add -A
    if ($LASTEXITCODE -ne 0) { Write-Err "git add failed"; exit 3 }

    $timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH-mm-ssZ")
    git commit -m "deploy: $timestamp" | Out-Host
    if ($LASTEXITCODE -ne 0) { Write-Err "git commit failed (nothing to commit?)"; exit 3 }
    Write-Good "Committed"
} else {
    Write-Warn "Skipping commit (-Commit not set)"
}

# --------------------------------------------------
# 4. Push (optional)
# --------------------------------------------------
if ($Push) {
    git remote get-url origin | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Err "No remote 'origin' configured - cannot push"
        exit 3
    }

    $branch = git rev-parse --abbrev-ref HEAD
    Write-Good "Pushing to $branch..."
    git push origin $branch | Out-Host
    if ($LASTEXITCODE -ne 0) { Write-Err "git push failed"; exit 3 }
    Write-Good "Pushed"
} else {
    Write-Warn "Skipping push (-Push not set)"
}

# --------------------------------------------------
# 5. Summary
# --------------------------------------------------
Write-Good "Deploy summary:"
git status --short | Out-Host
Write-Host "`nDone." -ForegroundColor Green
exit 0
