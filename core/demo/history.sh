#!/usr/bin/env bash
# 演示:一个有分叉与合并历史的宇宙。打开查看器 → 点 "⏱ 时间线" → 点任一提交/按 ▶ 回放。
#   bash core/demo/history.sh          然后访问 http://localhost:4322
#   NO_SERVE=1 bash core/demo/history.sh   只生成仓库并打印路径
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d)"
cd "$work"
export GIT_AUTHOR_NAME=demo GIT_AUTHOR_EMAIL=d@d GIT_COMMITTER_NAME=demo GIT_COMMITTER_EMAIL=d@d
S="node $here/core/src/cli.ts -f $work/universe.stars"
day=0
commit() { day=$((day+1)); local d; d="2026-09-$(printf '%02d' $day)T10:00:00"; GIT_AUTHOR_DATE=$d GIT_COMMITTER_DATE=$d git commit -qam "$1"; }

git init -q -b main
$S init >/dev/null && git add . >/dev/null && echo 'universe.stars.log' > .gitignore && git add .gitignore && commit "创世"
$S install-merge >/dev/null && git add .gitattributes && commit "启用按事实合并"

export STARS_AUTHOR=human
$S add auth "认证" -t module -s "登录与会话" >/dev/null; $S add session "会话" -t module >/dev/null; $S link auth dependsOn session >/dev/null
commit "第一批模块"

git checkout -qb agent-explore
export STARS_AUTHOR=claude
$S add db "数据库" -t module >/dev/null; $S add cache "缓存" -t module >/dev/null
$S link session dependsOn db --proposed >/dev/null; $S link session dependsOn cache --proposed >/dev/null
commit "AI:探索存储层(提议)"
$S accept session dependsOn db >/dev/null; $S add queue "队列" -t module >/dev/null; $S link db related queue >/dev/null
commit "AI:确认 db,新增队列"

git checkout -q main
export STARS_AUTHOR=human
$S add notes "设计笔记" -t note -s "为什么要分层" >/dev/null; $S link notes describes auth >/dev/null
$S add api "接口" -t module >/dev/null; $S link api dependsOn auth >/dev/null
commit "笔记与接口"

git merge -q --no-edit agent-explore
$S lint | grep -v '^info' || true

git checkout -qb refactor
$S rm cache >/dev/null; $S set auth -a owner=alice >/dev/null; $S add gateway "网关" -t module >/dev/null; $S link gateway dependsOn api >/dev/null
commit "重构:去掉缓存,加网关"
git checkout -q main
$S add metrics "指标" -t module >/dev/null; $S link metrics related api >/dev/null
commit "指标"
git merge -q --no-edit refactor
$S add draft "未提交的想法" -t concept >/dev/null; $S link draft related auth >/dev/null   # 留作"工作区"

echo "仓库: $work"
if [ -z "${NO_SERVE:-}" ]; then
  exec node "$here/core/src/cli.ts" -f "$work/universe.stars" serve --port "${PORT:-4322}"
fi
