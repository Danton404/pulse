#!/bin/zsh
# Double-click to publish Pulse. It:
#  1. refreshes the offline file list and cache version in sw.js (so phones pick up the update),
#  2. commits and pushes everything to GitHub,
#  3. waits until GitHub Pages serves the new version, then opens the site.
cd "${0:A:h}" || exit 1
SITE="https://danton404.github.io/pulse/"
finish() { echo; read -k1 "?Press any key to close..."; exit ${1:-0}; }

echo "== Update Pulse =="
echo

git fetch -q origin main 2>/dev/null
git pull -q --rebase --autostash origin main || { echo "Pull failed. Fix the conflict, then run again."; finish 1; }

if [[ -z $(git status --porcelain) ]] && [[ -z $(git log origin/main..HEAD --oneline 2>/dev/null) ]]; then
  echo "Nothing changed since the last update. Site: $SITE"
  finish 0
fi

# ---------- 1. Service worker: every app file in the offline list, new cache version
VERSION="pulse-$(date '+%Y%m%d-%H%M')"
python3 - "$VERSION" <<'EOF'
import glob, re, sys
version = sys.argv[1]
files = ['./', 'index.html', 'manifest.webmanifest'] + sorted(glob.glob('css/*.css')) + sorted(glob.glob('js/*.js')) + sorted(glob.glob('icon*'))
src = open('sw.js').read()
src = re.sub(r"const VERSION = '[^']*';", f"const VERSION = '{version}';", src)
shell = 'const SHELL = [\n  ' + ',\n  '.join(f"'{f}'" for f in files) + ',\n];'
src = re.sub(r'const SHELL = \[.*?\];', shell, src, flags=re.S)
open('sw.js', 'w').write(src)
print(f"sw.js: {version}, {len(files)} files cached")
EOF
[[ $? -ne 0 ]] && { echo "Couldn't update sw.js."; finish 1; }

# ---------- 2. Commit and push
echo
git status --short
echo
read "msg?Describe the change (Enter for default): "
[[ -z $msg ]] && msg="Update $(date '+%Y-%m-%d %H:%M')"
git add -A && git commit -q -m "$msg" || { echo "Commit failed."; finish 1; }
git push -q origin main || { echo "Push failed. Check your internet or run: gh auth login"; finish 1; }
echo "Pushed to GitHub ($(git rev-parse --short HEAD))."

# ---------- 3. Wait for GitHub Pages
echo
echo -n "Waiting for the site to update"
for i in {1..30}; do
  if curl -fsS "${SITE}sw.js?nocache=$RANDOM" 2>/dev/null | grep -q "$VERSION"; then
    echo
    echo "Live: $SITE"
    echo "On iPhone: close Pulse in the app switcher and reopen it to load the update."
    open "$SITE"
    finish 0
  fi
  echo -n "."
  sleep 10
done
echo
echo "Pushed, but the site hasn't updated after 5 minutes. Check https://github.com/Danton404/pulse/actions"
finish 1
