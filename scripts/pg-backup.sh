#!/bin/sh
# =============================================================================
# pg-backup.sh — Sao lưu định kỳ PostgreSQL cho hệ thống E2EE Chat
#
# Chạy trong container postgres:16-alpine (đã có sẵn pg_dump cùng version DB).
# Mỗi chu kỳ: pg_dump toàn DB -> nén gzip -> lưu file timestamp -> xóa bản cũ.
#
# An toàn E2EE: file backup chỉ chứa ciphertext + public key + metadata,
# KHÔNG có plaintext hay private key (private key nằm ở IndexedDB trên browser).
# =============================================================================

set -eu                 # -e: thoát ngay khi có lệnh lỗi; -u: lỗi nếu dùng biến chưa khai báo
set -o pipefail         # nếu pg_dump trong pipe "pg_dump | gzip" lỗi -> cả pipe coi như lỗi
                        # (busybox ash của Alpine hỗ trợ pipefail)

# --- Bắt buộc phải có các biến này, thiếu là dừng ngay (không backup mù) ---
: "${POSTGRES_USER:?Thieu POSTGRES_USER}"
: "${POSTGRES_DB:?Thieu POSTGRES_DB}"
: "${PGPASSWORD:?Thieu PGPASSWORD}"     # pg_dump tự đọc PGPASSWORD, không cần truyền trên CLI

# --- Cấu hình có giá trị mặc định (override được qua biến môi trường) ---
DB_HOST="${DB_HOST:-postgres}"                      # tên service Postgres trong docker network
BACKUP_DIR="${BACKUP_DIR:-/backups}"                # thư mục lưu (map ra volume backup_data)
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"        # chu kỳ giây, mặc định 24h
KEEP="${BACKUP_KEEP:-7}"                            # số bản backup giữ lại

mkdir -p "$BACKUP_DIR"

echo "[pg-backup] khoi dong | host=$DB_HOST db=$POSTGRES_DB interval=${INTERVAL}s keep=$KEEP dir=$BACKUP_DIR"

while true; do
    TS=$(date +%Y%m%d_%H%M%S)                       # vd: 20260620_031500
    FILE="$BACKUP_DIR/e2ee_${TS}.sql.gz"            # file đích cuối cùng
    TMP="${FILE}.tmp"                               # ghi tạm trước, tránh file backup dở dang

    echo "[pg-backup] $(date +%Y-%m-%dT%H:%M:%S) dang dump -> $FILE"

    # --no-owner / --no-privileges: backup gọn, restore được sang DB mới không vướng quyền sở hữu cũ
    if pg_dump -h "$DB_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
            --no-owner --no-privileges | gzip -c > "$TMP"; then
        mv "$TMP" "$FILE"                          # atomic: chỉ đổi tên thành file thật khi dump OK
        echo "[pg-backup] THANH CONG ($(du -h "$FILE" | cut -f1))"
    else
        echo "[pg-backup] LOI: dump that bai, xoa file tam" >&2
        rm -f "$TMP"
    fi

    # --- Prune: liệt kê theo thời gian mới->cũ, bỏ qua KEEP bản đầu, xóa phần còn lại ---
    ls -1t "$BACKUP_DIR"/e2ee_*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
        echo "[pg-backup] xoa ban cu: $old"
        rm -f "$old"
    done

    sleep "$INTERVAL"
done
