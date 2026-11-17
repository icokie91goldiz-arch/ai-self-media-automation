#!/bin/zsh
# 把天锋装成 macOS 开机自启服务（launchd）：守护进程 + 可选的远程访问隧道。
#   scripts/install-launchd.sh            安装守护进程
#   scripts/install-launchd.sh --tunnel   顺带安装 cloudflared 快速隧道（需要先 brew install cloudflared）
#   scripts/install-launchd.sh --uninstall
# 服务名前缀默认 com.maitian，可用环境变量 MAITIAN_LABEL 改。
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
NODE=$(command -v node)
PREFIX=${MAITIAN_LABEL:-com.maitian}
AGENTS=~/Library/LaunchAgents
UID_=$(id -u)
mkdir -p "$ROOT/data" "$AGENTS"

plist() {   # $1 label  $2 脚本  $3 参数  $4 日志
  cat > "$AGENTS/$1.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$1</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$ROOT/$2</string>${3:+<string>$3</string>}</array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>60</integer>
  <key>StandardOutPath</key><string>$ROOT/data/$4</string><key>StandardErrorPath</key><string>$ROOT/data/$4</string>
</dict></plist>
EOF
  launchctl bootout "gui/$UID_/$1" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_" "$AGENTS/$1.plist"
  echo "已安装 $1（日志 data/$4）"
}

if [[ "$1" == "--uninstall" ]]; then
  for l in "$PREFIX.daemon" "$PREFIX.tunnel"; do launchctl bootout "gui/$UID_/$l" 2>/dev/null && echo "已卸载 $l"; rm -f "$AGENTS/$l.plist"; done
  exit 0
fi
[[ -f "$ROOT/config.json" ]] || { echo "先复制 config.example.json 为 config.json 并填好"; exit 1; }
plist "$PREFIX.daemon" src/hub.mjs daemon daemon.log
[[ "$1" == "--tunnel" ]] && plist "$PREFIX.tunnel" src/tunnel.mjs "" tunnel.log
echo "重启守护进程：launchctl kickstart -k gui/$UID_/$PREFIX.daemon"
