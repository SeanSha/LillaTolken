#!/bin/zsh
# Opens the monitoring dashboard (/monitor). If the translator is not running yet it is started first
# (same as start.command), and the browser opens straight on /monitor.
REPO="$(cd "$(dirname "$0")/.." && pwd)"
if lsof -nP -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1 && lsof -nP -iTCP:8787 -sTCP:LISTEN >/dev/null 2>&1; then
  open "https://localhost:5173/monitor"
  echo "已打开监控面板。密码:.env 里的 MONITOR_ADMIN_PASSWORD,或 $REPO/apps/server/data/monitor-admin-password"
  sleep 2
  exit 0
fi
export OPEN_PATH=/monitor
exec /bin/zsh "$REPO/launcher/start.command"
