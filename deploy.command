#!/bin/zsh
# Double-click to publish Pulse: commits and pushes to GitHub; GitHub Pages republishes in about a minute.
cd "${0:A:h}" || exit 1
finish() { echo; read -k1 "?Press any key to close..."; exit ${1:-0}; }

echo "== Pulse deploy =="
if [[ -n $(git status --porcelain) ]]; then
  git status --short
  read "msg?Commit message (Enter for default): "
  [[ -z $msg ]] && msg="Update $(date '+%Y-%m-%d %H:%M')"
  git add -A && git commit -q -m "$msg" || { echo "Commit failed."; finish 1; }
fi
git pull -q --rebase origin main || { echo "Pull failed. Fix the conflict, then run again."; finish 1; }
git push -q origin main || { echo "Push failed."; finish 1; }
echo "Pushed. Live at https://danton404.github.io/pulse/ in about a minute."
finish 0
