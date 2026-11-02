#!/bin/zsh
# Creates one double-clickable app on the Desktop: "小翻译".
# It starts the service and opens both the translator and /monitor.
# Stop it from the window this app opens: press q, then Enter.
# If you move the project folder, run this again.
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$HOME/Desktop}"
chmod +x "$REPO/launcher/"*.command
APP="$DEST/小翻译.app"
rm -rf "$APP" "$DEST/小翻译 启动.app" "$DEST/小翻译 监控.app" "$DEST/小翻译 停止.app"
osacompile -o "$APP" -e "do shell script \"open -a Terminal \" & quoted form of \"$REPO/launcher/start.command\""
# osacompile's CFBundleIconName points at Assets.car, which is the plain page icon.
# Drop that so Finder uses the mascot in applet.icns.
cp "$REPO/launcher/mascot.icns" "$APP/Contents/Resources/applet.icns"
rm -f "$APP/Contents/Resources/Assets.car"
plutil -replace CFBundleIconFile -string applet.icns "$APP/Contents/Info.plist"
plutil -remove CFBundleIconName "$APP/Contents/Info.plist"
codesign --force --sign - "$APP" >/dev/null
osascript - "$REPO/launcher/mascot.icns" "$APP" <<'EOF'
use framework "AppKit"
on run argv
  set image to current application's NSImage's alloc()'s initWithContentsOfFile:(item 1 of argv)
  current application's NSWorkspace's sharedWorkspace()'s setIcon:image forFile:(item 2 of argv) options:0
end run
EOF
touch "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" >/dev/null
echo "created: $APP"
echo "Double-click 小翻译. It opens the translator and the monitor. In that window, press q then Enter to stop it."
