#!/usr/bin/env bash
# Installs Cutaway and links its skill into Claude Code and Codex.
#
#   curl -fsSL https://raw.githubusercontent.com/half144/cutaway/master/install.sh | bash
#
# Running it again updates the install. CUTAWAY_HOME changes where it lives (default ~/.cutaway).
set -euo pipefail

repo="https://github.com/half144/cutaway.git"
dir="${CUTAWAY_HOME:-$HOME/.cutaway}"

say() { printf '\033[1;35m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m==>\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31merror:\033[0m %s\n' "$1" >&2; exit 1; }

command -v git >/dev/null || fail "git is required."
command -v node >/dev/null || fail "Node.js 22 or newer is required: https://nodejs.org"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' \
  || fail "Node.js 22 or newer is required; found $(node -v)."

if [ -d "$dir/.git" ]; then
  say "Updating $dir"
  git -C "$dir" pull --ff-only --quiet
else
  say "Downloading Cutaway into $dir"
  git clone --quiet --depth 1 "$repo" "$dir"
fi

say "Installing dependencies and Chromium"
(cd "$dir" && npm ci --silent --no-audit --no-fund && npx --yes playwright install chromium >/dev/null)

# The skill runs the CLI through its link, so it must stay a link to this checkout. A link or folder that
# points somewhere else (a development clone) is left alone.
for home in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" "${CODEX_HOME:-$HOME/.codex}"; do
  [ -d "$home" ] || continue
  target="$home/skills/cutaway"
  if [ -e "$target" ] || [ -L "$target" ]; then
    if [ "$(cd "$target" 2>/dev/null && pwd -P)" = "$(cd "$dir/skills/cutaway" && pwd -P)" ]; then
      say "Skill already linked: $target"
    else
      warn "Skipped $target: it already points somewhere else."
    fi
    continue
  fi
  mkdir -p "$home/skills"
  ln -s "$dir/skills/cutaway" "$target"
  say "Linked skill: $target"
done

if ! command -v ffmpeg >/dev/null; then
  case "$(uname -s)" in
    Darwin) hint="brew install ffmpeg" ;;
    *) hint="sudo apt install ffmpeg (or your system's package manager)" ;;
  esac
  warn "FFmpeg is missing, and exporting needs it: $hint"
fi

say "Done. Try it: node $dir/src/cli.mjs record $dir/examples/demo.json --out /tmp/cutaway-demo"
[ "$(uname -s)" = Darwin ] && say "Optional, for the macOS wallpapers: (cd $dir && npm run wallpapers)"
exit 0
