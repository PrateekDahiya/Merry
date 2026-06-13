#!/bin/bash
# Merry backup verification — checks archive integrity and lists contents
# Usage: bash scripts/verify-backup.sh /opt/backups/merry/merry-20260612-030000.tar.gz
set -euo pipefail

BACKUP_FILE="${1:?Usage: verify-backup.sh <path/to/backup.tar.gz>}"

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Error: file not found: $BACKUP_FILE"
  exit 1
fi

echo "Verifying: $BACKUP_FILE"
echo "Size: $(du -sh "$BACKUP_FILE" | cut -f1)"
echo ""
echo "Contents (first 30 files):"

docker run --rm \
  -v "$(cd "$(dirname "$BACKUP_FILE")" && pwd)":/source:ro \
  alpine \
  tar tzf "/source/$(basename "$BACKUP_FILE")" | head -30

echo ""
echo "Integrity: OK (archive is valid)"
