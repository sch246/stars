# 星罗 core —— 关系的编辑器

> 状态:M0(L0)。这是重构的新内核,与旧的 `src/`、`webapp/`、`media/` 并行存在,互不影响。

## 目标

星罗是**关系的编辑器与维护工具**,不是文本编辑器,也不是图可视化玩具。

- 数据是**挂在文件上的关系层**:节点指向仓库里的文件,正文留在文件里。
- **内核是本体**:库 + CLI,人和 AI 调同一套接口。UI(查看器、VS Code 插件)只是视图。
- 重点不是"建立关系",而是**让关系可维护**:查询、校验、批量变更、审阅。
- 先搓一个宇宙,让一切从里面长出来;每一步都必须能亲眼看到。

## 数据模型(内核只有这些)

- **节点**:`id`(稳定、可读)、`label`、任意 `key=value` 属性。常用属性:`type`、`summary`、`file`、`status`。
- **边**:`(from, type, to)` 三元组唯一确定,可带属性。没有边 id。
- **边类型的性质**由"模式节点"声明:`symmetric`(无向)、`acyclic`(不成环)、`single-parent`(至多一个入边)。
- **n 元关系 / 区域 / tag** 不进内核:用"中心节点 + 成员边"表达,查看器可把中心节点渲染成区域。两种表示可无损互转。
- **模式节点**:id 以 `~` 开头。`~dependsOn kind=edgeType`、`~module kind=nodeType color=#bd00ff`……
  类型本身就是宇宙里的节点,所以改类型定义不需要改代码(这是 L2 自描述的地基)。

## 文本格式

```
stars 1

node auth "认证模块" type=module file=src/auth.ts summary="登录与会话"
node session "会话" type=module
node ~related "关联" kind=edgeType symmetric=true

auth -dependsOn-> session status=proposed
auth -related- session
```

- 一行一个事实,按 id 排序,同一个宇宙总是序列化成同一段文本(git diff 友好)。
- 对称类型写成 `-t-`,方向无关。
- 限制:`#` 注释读入时会丢弃(请用 `summary`);id 不能含空白/引号、不能以 `#` 开头。
- `file` 路径相对于**宇宙文件所在目录**(或环境变量 `STARS_ROOT`)。

## 操作与日志

所有修改走 `apply(universe, op)`,返回**逆操作**。`Store.commit` 落盘并追加一行到 `<file>.log`
(时间、`author`、操作、逆操作),所以 `undo` 免费,将来的**回放**也免费。

给 L3/L4 预留的四个钩子(现在都是空实现):
1. 写入统一入口,每个操作带 `author`(人 / AI 名字 / 将来的代码节点)。
2. 类型与规则是节点,不写死在代码里。
3. `Store.policy`:操作前的权限检查位置,现在恒为允许。
4. 安全模式:将来启动时可不加载任何代码节点。

## 视图 = 函数

画面不是数据的一部分,而是 `evaluateView(宇宙, 视图规格) -> 场景` 这个纯函数的结果(`src/view.ts`)。
规格是一组**有序规则**,第一条匹配的生效:

```jsonc
{
  "look": "galaxy",
  "select": { "withRelations": ["dependsOn"] },          // 显示哪些节点
  "size":  [{ "when": {"type":"dir"},  "attr": "size", "rollup": {"relation":"contains","op":"sum"}, "scale":"log" },
            { "when": {"type":"file"}, "attr": "size", "scale":"sqrt" },
            { "by": "degree" }],                          // 大小来自属性 / 沿关系汇总 / 度数
  "color": [{ "when": {"type":"dir"},  "by": "group", "relation": "contains", "level": 1 },   // 同一子树同色
            { "when": {"type":"file"}, "by": "attr:ext" }, { "by": "type" }],
  "style": [{ "when": {"type":"dir"}, "shape": "nebula" }, { "when": {"type":"module"}, "shape": "ringed" }],
  "relations": { "contains": { "mode": "orbit" }, "describes": { "mode": "faint" }, "*": { "mode": "line", "arrow": true } }
}
```

- **关系怎么画由视图决定**:`contains` 在 `galaxy` 里是轨道(子绕父转),在 `tree` 里是连线,在 `deps` 里被隐藏。
- **派生属性是规则**:目录大小 = 沿 `contains` 汇总子孙的 `size`;颜色可以继承祖先。
- 视图存放在宇宙里:`kind=view` 的节点,id 为 `~view/<名字>`,`spec` 属性是上面的 JSON;同名覆盖内置视图。改它,查看器立刻变化。
- CLI/AI 也能算视图:`stars views`、`stars view galaxy [--json]`。

## 容器、展开与边提升

文件夹不是特殊结构:`contains` 只是一条普通关系。任何有子节点的节点就是**容器**,它有一个展开状态,
由视图规格的 `expand` 规则和用户的手动操作共同决定:

| 状态 | 表现 |
|---|---|
| 收起 | 容器是一个点;视觉上是一个小星系,粒子是它里面内容的缩影(颜色、大小取自子孙) |
| 展开(`region`) | 子节点出现在一个柔和的"域"里,域之间互相推开,保持疆界 |
| 展开(`orbit`) | 子节点绕父节点公转(`orbit` 视图) |
| 展开(`line`) | 就是普通连线的树(`tree` 视图) |

- **边提升**:容器收起时,内部的关系消失;跨容器的关系**提升**到容器上并汇总计数
  (`a/x.ts -dependsOn-> b/y.ts` ⇒ `a/ -dependsOn-> b/ ×2`)。提升的边是**派生**的(`lifted: true`),
  查看器里画成细点线并标 `×N`;面板里能看到"收起后的对外关系(含内部汇总)"。
- **语义缩放**(`expand.auto.radiusPx`):用户放大使容器的视觉半径超过阈值就自动展开,缩小到内容很小就收起
  (有滞后)。只响应用户自己的缩放/平移,"适应窗口"不会触发,所以总是从全局概览开始。
  双击或 `E` 手动展开/收起(优先级最高),`0` 重置。
- 容器大小沿 `contains` 汇总,所以展开/收起前后节点大小不变;归一化对全部入选节点统一做,不会跳变。
- `contains` 里有环时会在环上断开一条父链,保证每个节点都可达。

CLI:`stars view arch`(架构级,只展开一层、隐藏文件)、`stars view galaxy --depth 2`、`--expand a/,b/`。

### 内置视图
`galaxy`(默认,域 + 语义缩放)· `orbit`(全部展开,子绕父转)· `arch`(架构级)· `deps`(只看语义关系)· `tree`(平面连线)

### 同一份代码在两端运行
`model.ts` / `view.ts` 只依赖标准库。`stars serve` 把它们去掉类型后以 JS 提供给浏览器(`/core/*.js`,
用 Node 的 `module.stripTypeScriptTypes`,这是实验性 API),所以展开、收起、切换视图完全在浏览器本地计算,
CLI 与查看器永远是同一套逻辑。

## 信号与"最近编辑"

宇宙文件本身不记录时间,但有两个来源,做成视图可引用的**信号**(`EvalOptions.signals`,id → 毫秒时间戳):

| 信号 | 来源 | 含义 |
|---|---|---|
| `touched` | 操作日志 | 这个节点(或连着它的边)最近一次被编辑 |
| `fileChanged` | git 最近提交时间;工作区里未提交的文件用 mtime | 节点指向的文件最近一次变动;目录取后代里最新的 |

(干净克隆下所有文件的 mtime 都是克隆时间,没有意义,所以 mtime 只用于"工作区里有未提交修改"的文件。)

视图规则里:`{"by":"recency","signal":"fileChanged","halfLifeDays":10,"from":"#2f3b6e","to":"#ffcf70"}`
让颜色随"多久之前动过"在冷→热之间渐变(每过一个半衰期,新鲜度减半);`size` 规则也可以用
`signal` + `recency`;`rollup: {relation:"contains", op:"max"}` 让容器取后代里最新的。内置视图 `recent` 就是这样的热力图:
大小是体量,颜色是新旧。视图仍是纯函数 —— 当前时间(`now`)和信号都是输入,所以测试里可以固定它们。

## 视图规则编辑器与接口

规格就是宇宙里一个 `kind=view` 的节点,所以**所有入口走同一条通道**(都带 `author`、写操作日志、可撤销):

- 查看器里的 **✎ 视图规则**:改 JSON,250ms 后实时预览(无效时给出具体问题),"保存到宇宙"/"另存"/"删除"。
- CLI:`stars view <名> --spec` 读,`stars view-set <名> --spec '<JSON>' | --from 文件` 写(先 `validateSpec`)。
- HTTP:`POST /api/op`(`{op, author}`),`GET /api/history`、`/api/state?commit=`。
- 直接改 `universe.stars`:`~view/<名>` 节点的 `spec` 属性。

**写接口的安全**:默认只监听 `127.0.0.1`;校验 `Host`(防 DNS 重绑定);写和读历史都要求页面里内嵌的
随机 token(每次启动不同),并拒绝跨源请求。`--host 0.0.0.0` 会警告。

### 自由度的阶梯

| 层级 | 形式 | 能表达 | 代价 |
|---|---|---|---|
| a. 规则 JSON(现在) | 有序规则 + `when` 相等匹配 | 大小/颜色/样式/关系模式/折叠,基本覆盖看图需求 | 不能写公式 |
| b. 表达式(下一步) | 规则字段里放安全的表达式:`"size": "log(size+1)*2"`、`"when": "age < 7d && degree > 3"` | 数值映射、组合条件 | 要写一个小解析器;仍可静态分析、可 diff |
| c. 沙箱函数 | `(node, ctx) => {r, color, shape}`,在 Worker/隔离环境里跑 | 任意算法(聚类、PageRank、自定义布局力) | 不可分析("为什么它这么大?"),要限时限内存 |
| d. 槽位接代码节点 | 规则字段写 `{"fn": "~script/heat"}`,指向宇宙里的代码节点(`file` 指向脚本) | agent 可以生成/替换视图的任意一段 | 同 c,另加权限问题 |

建议**逐级放开,且 JSON 始终是规范形式**:UI 编辑它,AI 补丁它,CLI 校验它;c、d 只作为"字段值可以是一个函数"的逃生口。
c/d 的函数必须是**纯函数**(输入:序列化的宇宙 + 信号;输出:经过 schema 校验的 JSON),在无 DOM、无网络、
无写权限的环境里运行 —— 写入是另一种能力(L3,关系式权限),绝不借道视图。这样 agent 可以放心地改视图,
而最坏结果只是画面难看。

## 历史、分叉与合并

回放的依据是 **git 里宇宙文件的提交图(DAG)**,不是一条线:`gitHistory` 取所有分支上改动过它的提交
(含合并提交的两个父节点)和分支名,`gitSnapshot` 还原任一提交时的宇宙,`diffUniverses` 给出与父提交的差异。
操作日志(`.log`)是线性的,只负责提交**之内**的细粒度(谁、何时、改了什么,以及撤销);它是只追加的,
所以 `*.stars.log merge=union`。

宇宙文件是排序后"一行一个事实",两个分支在同一处相邻插入时 git 的**文本**合并会冲突。所以提供了**按事实的三方合并**
(`merge.ts`):节点/边按身份合并,同一事实的**不同字段**各改各的能自动合并;只有"同一字段改成不同值"、
"一边删一边改"才算冲突(取 ours 并报告),"一边删节点、另一边给它连了边"会恢复节点。
`stars install-merge` 把它装成 git 合并驱动(`.gitattributes` 里 `*.stars merge=stars`)。

查看器的 **⏱ 时间线**:画出分支与合并,点击任一提交回放那一刻的宇宙(新增节点有绿环 + 扩散动画,修改的是橙环,
顶部显示 +新增 ~修改 −删除),◀ ▶ / ← → 单步,▶ 沿主线播放,Esc 回到现在;有未提交修改时会多一个"工作区"。
回放时节点位置按 id 延续,所以能看到宇宙"长"出来。演示:`bash demo/history.sh`(生成一个有分叉与合并的仓库)。

## 校验(lint)

`stars lint`,有 error 时退出码 1。规则在 `src/lint.ts` 的 `RULES` 里,一项一个函数:

| 规则 | 级别 | 说明 |
|---|---|---|
| `dangling-edge` | error | 边指向不存在的节点 |
| `cycle` | error | `acyclic=true` 的类型出现环 |
| `multiple-parents` | error | `single-parent=true` 的类型有多个上级 |
| `undeclared-edge-type` / `undeclared-node-type` | warn | 类型没有对应的模式节点 |
| `missing-file` | warn | `file` 指向的文件不存在 |
| `orphan` | info | 没有任何关系的节点 |
| `proposed` | info | 等待人确认的 AI 提议边 |

AI 建议用 `stars link ... --proposed --author <名字>` 写入;人用 `stars accept` 确认。

## 快速开始

```bash
cd core
node --test "test/*.test.ts"                 # 测试
bash demo/live.sh                            # 打开 http://localhost:4321,看宇宙生长
bash demo/history.sh                         # 打开 http://localhost:4322,点 ⏱ 时间线,回放一段有分叉与合并的历史
node src/cli.ts install-merge                # 在 git 仓库里启用按事实合并

# 或手动:
node src/cli.ts init                         # 在当前目录建 universe.stars
node src/cli.ts scan .                       # 把仓库铺成 dir/file 节点
node src/cli.ts add auth "认证" -t module --ref src/auth.ts
node src/cli.ts link auth dependsOn session --proposed --author claude
node src/cli.ts serve                        # 实时查看器
```

仓库根目录的 `universe.stars` 就是用它描述星罗自己的宇宙(第一个居民)。

## 路线

| 级别 | 内容 | 状态 |
|---|---|---|
| L0 | 内核 + 文本格式 + CLI + 实时查看器 | ✅ 本次 |
| L1 | 视图规则编辑器 ✅、最近编辑信号 ✅、git 历史回放(含分叉)✅、按事实合并 ✅;还差:路径查询、保存的查询(= 动态区域)、过期检测(文件哈希)、批量变更预览、接受/拒绝 proposed 与"提升为真边"的界面 | 进行中 |
| L2 | 视图/规则/查询都是节点;在图里改类型样式即时生效 | |
| L3 | 代码节点 + 用关系表达的权限(`script --canWrite--> region`),沙箱运行 | |
| L4 | agent 循环(事件/定时触发),运行记录写成节点 | |

## 已知限制 / 待决问题

- 多进程并发写入是"最后写入者胜"(每次 commit 前会重新读盘,窗口很小,但没有锁)。
- `contains` 同时用于文件系统层级(`single-parent`)和逻辑分组时会冲突:逻辑上的"模块包含文件"目前只能用 `describes`。是否拆成两种类型(`contains` / `groups`)待定。
- 查看器是独立的小实现,**没有**复用旧 webapp 的渲染层(它绑定在旧 schema 上)。视图规格目前只能改文件/用 CLI 改,查看器里还没有编辑器。
- 视图规则只支持相等匹配(`when`),还没有表达式;`rollup` 假定关系无环。
- 展开/收起状态不持久化(刷新后回到视图默认);提升的边还不能一键"提升为真边"。
- 回放以提交为粒度;提交之内的细粒度(操作日志)还没接进时间线。回放时看不到被删除的节点(只显示 −N)。
- 表达式与代码槽位(见"自由度的阶梯")尚未实现。
- 背景里的远方星系纯属装饰(固定种子,不可交互);让它们代表真实的"别的宇宙"是后话。
- `/core/*.js` 依赖 Node 的实验性 `stripTypeScriptTypes`,将来 API 变了需要换成构建步骤。
- 还没有查询语言;`ls/nb/path` 只覆盖最基本的过滤、邻域、最短路径。
