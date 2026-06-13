#!/bin/bash
# Merry restore script — restores volumes from a backup archive
# Usage: bash scripts/restore.sh /opt/backups/merry/merry-20260612-030000.tar.gz
set -euo pipefail

BACKUP_FILE="${1:?Usage: restore.sh <path/to/merry-YYYYMMDD-HHMMSS.tar.gz>}"

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Error: file not found: $BACKUP_FILE"
  exit 1
fi

echo "========================================"
echo "  MERRY RESTORE"
echo "========================================"
echo "Backup file : $BACKUP_FILE"
echo "Size        : $(du -sh "$BACKUP_FILE" | cut -f1)"
echo ""
echo "WARNING: This will REPLACE the current data and knowledge volumes."
echo "         Make sure the Merry container is stopped first:"
echo "         docker-compose stop merry"
echo ""
read -rp "Type YES to proceed: " confirm
[[ "$confirm" == "YES" ]] || { echo "Aborted."; exit 0; }

echo ""
echo "Stopping container if running..."
(docker-compose stop merry 2>/dev/null || true)

echo "Restoring volumes..."
docker run --rm \
  -v merry_merry_data:/dest/data \
  -v merry_merry_knowledge:/dest/knowledge \
  -v "$(cd "$(dirname "$BACKUP_FILE")" && pwd)":/source \
  alpine \
  sh -c "
    rm -rf /dest/data/* /dest/knowledge/* 2>/dev/null || true
    cd / && tar xzf /source/$(basename "$BACKUP_FILE") --strip-components=1
    echo 'Extraction complete'
  "

echo ""
echo "Restore complete!"
echo "Start Merry again with: docker-compose up -d"
