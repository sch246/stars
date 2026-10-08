#!/usr/bin/env bash
# 演示:文件系统的变化实时出现在查看器里(像 VS Code 的资源管理器)。
#   bash core/demo/live-fs.sh        打开 http://localhost:4331,然后在另一个终端 cd 到打印出的目录里随便改文件
#   AUTO=1 bash core/demo/live-fs.sh  自动演示:创建 / 改名 / 修改 / 删除
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d)"
cd "$work"
export GIT_AUTHOR_NAME=demo GIT_AUTHOR_EMAIL=d@d GIT_COMMITTER_NAME=demo GIT_COMMITTER_EMAIL=d@d
git init -q -b main
printf 'node_modules/\nuniverse.stars*\n' > .gitignore
mkdir -p src/ui src/core docs
for f in app router store; do echo "export const $f = 1;" > "src/core/$f.ts"; done
for f in button panel; do echo "export const $f = 1;" > "src/ui/$f.ts"; done
echo "# demo" > README.md; echo "design notes" > docs/design.md
S="node $here/core/src/cli.ts -f $work/universe.stars"
$S init >/dev/null && $S scan . --under repo >/dev/null
STARS_AUTHOR=human $S add goal "拆分 core" -t concept -s "把 store 从 app 里拆出来" >/dev/null
STARS_AUTHOR=human $S link goal describes src/core/store.ts >/dev/null
git add -A >/dev/null && git commit -qm init
echo "项目目录: $work   (在另一个终端里进入这个目录,新建/改名/修改/删除文件试试)"
node "$here/core/src/cli.ts" -f "$work/universe.stars" serve --port "${PORT:-4331}" --watch &
srv=$!
trap 'kill $srv 2>/dev/null' EXIT
if [ -n "${AUTO:-}" ]; then
  sleep 4
  step() { echo "\$ $*"; "$@"; sleep "${DELAY:-1.6}"; }
  step bash -c 'echo "export const cache = 1;" > src/core/cache.ts'
  step bash -c 'mkdir -p src/net && echo x > src/net/http.ts && echo x > src/net/ws.ts'
  step mv src/core/store.ts src/core/state.ts            # 改名:goal 的关系跟着走
  step bash -c 'yes "export const big = 1;" | head -3000 > src/core/app.ts'   # 变大:节点变大,宇宙文件不被改写
  step rm src/ui/panel.ts
  step rm src/core/state.ts                               # 有关系的文件被删:标记缺失,关系保留
  echo ">>> 演示结束,查看器继续运行,Ctrl-C 退出"
fi
wait $srv
