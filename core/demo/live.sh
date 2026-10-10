#!/usr/bin/env bash
# M0 演示:打开查看器,然后看着宇宙一点点长出来。
#   bash core/demo/live.sh        然后在浏览器打开 http://localhost:4321
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d)"
S="node $here/core/src/cli.ts -f $work/universe.stars"
export STARS_ROOT="$here"

$S init >/dev/null
$S serve --port "${PORT:-4321}" &
server=$!
trap 'kill $server 2>/dev/null' EXIT
echo ">>> 打开 http://localhost:${PORT:-4321} ,5 秒后开始生长(点掉 file/dir 以外的类型过滤可以更清楚)"
sleep 5

step() { echo "\$ stars $*"; $S "$@" >/dev/null; sleep "${DELAY:-0.7}"; }
export STARS_AUTHOR=scan;   step scan "$here" --under repo
export STARS_AUTHOR=claude
step add goal "关系编辑器" -t concept -s "内核+CLI 是本体,UI 只是视图"
step add core "内核" -t module --ref core/
step add viewer "实时查看器" -t module --ref core/viewer/index.html
step add old-webapp "旧 webapp" -t module --ref webapp/
step link repo related goal
step link goal dependsOn core
step link viewer dependsOn core
step link old-webapp dependsOn core --proposed
step link repo contains core
step link goal contains core            # contains 可以有多个上级:core 既在仓库里,也归在"关系编辑器"这个目标下
step link core contains goal            # 但不能成环(contains 声明了 acyclic):lint 报 error,节点亮红圈
step add oops "孤儿节点" -t concept       # lint 提示孤儿
echo ">>> 完成。查看器会一直开着,Ctrl-C 退出。可以另开终端:"
echo "    STARS_ROOT=$here node $here/core/src/cli.ts -f $work/universe.stars lint"
wait $server
