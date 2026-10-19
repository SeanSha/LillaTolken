#!/bin/zsh
# Creates double-clickable apps on your Desktop: "小翻译 启动" and "小翻译 监控" (opens /monitor).
# They only open Terminal and run a script from THIS folder. Stop the translator from the window
# the launcher opens: press q, then Enter. If you move the project folder, run this again.
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$HOME/Desktop}"
chmod +x "$REPO/launcher/"*.command
mk() { # name, script
  rm -rf "$DEST/$1.app"
  osacompile -o "$DEST/$1.app" -e "do shell script \"open -a Terminal \" & quoted form of \"$REPO/launcher/$2\""
  echo "created: $DEST/$1.app"
}
mk "小翻译 启动" start.command
mk "小翻译 监控" monitor.command
rm -rf "$DEST/小翻译 停止.app"
echo "Double-click 小翻译 启动 to run everything. In that window, press q then Enter to stop it."
