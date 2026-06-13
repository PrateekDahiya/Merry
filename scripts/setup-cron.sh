#!/bin/bash
# Install a daily 3am cron job for Merry backups
# Usage: bash scripts/setup-cron.sh
# Optional: BACKUP_HOUR=4 bash scripts/setup-cron.sh  (run at 4am instead)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/backup.sh"
HOUR="${BACKUP_HOUR:-3}"
LOG_FILE="${BACKUP_LOG:-/var/log/merry-backup.log}"

if [[ ! -f "$BACKUP_SCRIPT" ]]; then
  echo "Error: backup.sh not found at $BACKUP_SCRIPT"
  exit 1
fi

chmod +x "$BACKUP_SCRIPT"

CRON_JOB="0 $HOUR * * * bash $BACKUP_SCRIPT >> $LOG_FILE 2>&1"

# Remove any existing merry backup cron, add the new one
(crontab -l 2>/dev/null | grep -v "merry.*backup"; echo "$CRON_JOB") | crontab -

echo "Cron job installed successfully!"
echo "Schedule: daily at ${HOUR}:00"
echo "Log: $LOG_FILE"
echo ""
echo "Current cron for merry:"
crontab -l | grep merry || echo "(none)"
echo ""
echo "To run a backup right now: bash $BACKUP_SCRIPT"
echo "To remove the cron:        crontab -e  (delete the merry line)"
