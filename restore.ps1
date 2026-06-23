# =============================================================================
# restore.ps1 - Khoi phuc database E2EE Chat tu file backup (chi 1 lenh)
#
# Cach dung:
#   .\restore.ps1
#       -> Tu dong dung file backup MOI NHAT trong thu muc .\backups
#
#   .\restore.ps1 e2ee_20260620_100013.sql.gz
#       -> Khoi phuc tu dung file ban chi dinh (file phai nam trong .\backups)
#
# Script tu lam het: dung backend -> tao lai DB rong -> nap du lieu -> bat backend.
# =============================================================================

param(
    [string]$File   # tuy chon: ten file backup muon khoi phuc
)

$ErrorActionPreference = "Stop"

# Thu muc chua backup = .\backups (canh file restore.ps1 nay)
$backupDir = Join-Path $PSScriptRoot "backups"

# --- 1. Chon file backup ---
if ($File) {
    $leaf = Split-Path $File -Leaf            # chi lay ten file, bo duong dan
} else {
    # Khong chi dinh -> lay file moi nhat
    $latest = Get-ChildItem "$backupDir\e2ee_*.sql.gz" -ErrorAction SilentlyContinue |
              Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latest) {
        Write-Host "Khong tim thay file backup nao trong: $backupDir" -ForegroundColor Red
        exit 1
    }
    $leaf = $latest.Name
}

$path = Join-Path $backupDir $leaf
if (-not (Test-Path $path)) {
    Write-Host "Khong thay file: $path" -ForegroundColor Red
    Write-Host "(File backup phai nam trong thu muc .\backups thi Postgres moi doc duoc)" -ForegroundColor DarkGray
    exit 1
}

# --- 2. Xac nhan (vi se XOA DB hien tai) ---
Write-Host ""
Write-Host "  File khoi phuc : $leaf" -ForegroundColor Cyan
Write-Host "  Canh bao       : Toan bo DB hien tai se bi XOA va thay bang du lieu trong file nay." -ForegroundColor Yellow
$ans = Read-Host "  Go 'yes' de tiep tuc"
if ($ans -ne "yes") {
    Write-Host "Da huy, khong thay doi gi." -ForegroundColor DarkGray
    exit 0
}

# Ham nho: dung script ngay neu lenh docker vua chay bi loi
function Assert-Ok($step) {
    if ($LASTEXITCODE -ne 0) {
        Write-Host "LOI o buoc: $step (ma loi $LASTEXITCODE). Dung lai." -ForegroundColor Red
        exit 1
    }
}

# --- 3. Dung backend de khong ai ghi vao DB trong luc khoi phuc ---
Write-Host "==> [1/4] Dung backend..." -ForegroundColor Yellow
docker compose stop backend
Assert-Ok "dung backend"

# --- 4. Xoa DB cu, tao DB rong cung ten (dung bien moi truong san trong container) ---
Write-Host "==> [2/4] Tao lai database rong..." -ForegroundColor Yellow
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS $POSTGRES_DB WITH (FORCE);" -c "CREATE DATABASE $POSTGRES_DB;"'
Assert-Ok "tao lai database"

# --- 5. Nap du lieu: Postgres tu doc file .gz trong /backups (mount tu .\backups) ---
Write-Host "==> [3/4] Nap du lieu tu backup ($leaf)..." -ForegroundColor Yellow
$restoreCmd = 'gunzip -c /backups/' + $leaf + ' | psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q'
docker compose exec -T postgres sh -c $restoreCmd
Assert-Ok "nap du lieu"

# --- 6. Bat lai backend ---
Write-Host "==> [4/4] Bat lai backend..." -ForegroundColor Yellow
docker compose start backend
Assert-Ok "bat backend"

Write-Host ""
Write-Host "HOAN TAT! Database da duoc khoi phuc tu: $leaf" -ForegroundColor Green
