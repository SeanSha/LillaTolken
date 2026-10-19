#!/bin/zsh
# 小翻译 · Lilla Tolken — one-click start (double-click this file, or use the Desktop app made by
# `npm run launcher:install`). Starts: Ollama (if needed) -> whisper.cpp -> backend + web.
# Closing this Terminal window or pressing Ctrl-C stops everything this script started.

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO" || exit 1
mkdir -p apps/server/data/logs
LOGS="$REPO/apps/server/data/logs"
OPEN_URL="https://localhost:5173${OPEN_PATH:-/}"   # monitor.command sets OPEN_PATH=/monitor

say_() { printf '\n\033[1m%s\033[0m\n' "$1"; }
listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
lan_ip() { ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null; }

if ! command -v node >/dev/null; then
  say_ "找不到 node。请先安装:brew install node"; read -r "?按回车关闭"; exit 1
fi

if listening 8787 || listening 5173; then
  say_ "程序已经在运行(端口 8787 / 5173 已被占用)。只打开浏览器。"
  open "$OPEN_URL"
  read -r "?按回车关闭此窗口(不会停止程序)"; exit 0
fi

PIDS=()
cleanup() {
  trap - INT TERM EXIT HUP
  say_ "正在停止 ..."
  for p in "${PIDS[@]}"; do kill -TERM -"$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null; done
  sleep 1
  # whisper-server is started by local:start; make sure it is gone too.
  [ -f "$REPO/apps/server/data/whisper-server.pid" ] && kill "$(cat "$REPO/apps/server/data/whisper-server.pid")" 2>/dev/null
  exit 0
}
trap cleanup INT TERM EXIT HUP

# 1) Ollama (the desktop app runs the daemon). It is only started, never reconfigured.
if ! curl -fs --max-time 2 http://127.0.0.1:11434/api/version >/dev/null; then
  say_ "启动 Ollama ..."
  open -ga Ollama
  for _ in {1..30}; do curl -fs --max-time 2 http://127.0.0.1:11434/api/version >/dev/null && break; sleep 1; done
fi

# 2) whisper.cpp + model warm-up (local preset). Skipped silently if not installed: mock / cloud still work.
say_ "启动本地识别引擎(首次约 15 秒)..."
setopt monitor
npm run local:start >"$LOGS/local-start.log" 2>&1 &
PIDS+=($!)

# 3) backend + web (Vite, HTTPS, listens on the LAN for the iPhone)
say_ "启动小翻译 ..."
npm run dev >"$LOGS/dev.log" 2>&1 &
PIDS+=($!)

for _ in {1..60}; do listening 5173 && listening 8787 && break; sleep 1; done
if ! listening 5173; then
  say_ "启动失败。最后的日志:"; tail -n 25 "$LOGS/dev.log"; read -r "?按回车关闭"; exit 1
fi

IP="$(lan_ip)"
say_ "✅ 已启动"
echo "  这台 Mac:      https://localhost:5173/"
echo "  监控面板:      https://localhost:5173/monitor   (密码见 .env 或 apps/server/data/monitor-admin-password)"
[ -n "$IP" ] && echo "  iPhone(同一 Wi-Fi): https://$IP:5173/"
echo
echo "  引擎状态:"; tail -n 4 "$LOGS/local-start.log" | sed 's/^/    /'
echo
echo "  日志: $LOGS"
echo "  在此窗口按 q 然后回车,即可停止全部程序(也可以直接关闭窗口)。"
open "$OPEN_URL"

# q + Enter stops everything. The loop (not `read`) owns the wait, so the EXIT trap still fires
# when the window is closed.
while true; do
  read -r line
  case "$line" in
    q|Q) exit 0 ;;
  esac
done
