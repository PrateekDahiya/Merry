#!/bin/bash
# Merry backup script — backs up both Docker volumes to a timestamped tar.gz
# Usage: bash scripts/backup.sh
# Env vars:
#   BACKUP_DIR           — where to write backups (default: /opt/backups/merry)
#   BACKUP_KEEP_DAYS     — how many days to keep (default: 7)
#   RCLONE_REMOTE        — optional rclone remote for cloud upload (e.g. "s3:mybucket")
set -euo pipefail

DATE=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="${BACKUP_DIR:-/opt/backups/merry}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
ARCHIVE="merry-${DATE}.tar.gz"

mkdir -p "$BACKUP_DIR"
echo "[$(date)] Starting Merry backup..."

docker run --rm \
  -v merry_merry_data:/source/data:ro \
  -v merry_merry_knowledge:/source/knowledge:ro \
  -v "$BACKUP_DIR":/dest \
  alpine \
  tar czf "/dest/$ARCHIVE" /source

echo "[$(date)] Written: $BACKUP_DIR/$ARCHIVE"
echo "[$(date)] Size: $(du -sh "$BACKUP_DIR/$ARCHIVE" | cut -f1)"

# Remove backups older than KEEP_DAYS
find "$BACKUP_DIR" -name "merry-*.tar.gz" -mtime +"$KEEP_DAYS" -delete
REMAINING=$(ls "$BACKUP_DIR"/merry-*.tar.gz 2>/dev/null | wc -l | tr -d ' ')
echo "[$(date)] Kept $REMAINING backup(s) (older than ${KEEP_DAYS}d removed)"

# Optional cloud upload via rclone
if [[ -n "${RCLONE_REMOTE:-}" ]]; then
  echo "[$(date)] Uploading to $RCLONE_REMOTE..."
  rclone copy "$BACKUP_DIR/$ARCHIVE" "$RCLONE_REMOTE/merry-backups/"
  echo "[$(date)] Upload complete"
fi

echo "[$(date)] Backup done: $ARCHIVE"
