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
| L1 | 路径查询、保存的查询(= 动态区域)、过期检测(文件哈希)、批量变更预览、审阅界面 | 下一步 |
| L2 | 视图/规则/查询都是节点;在图里改类型样式即时生效 | |
| L3 | 代码节点 + 用关系表达的权限(`script --canWrite--> region`),沙箱运行 | |
| L4 | agent 循环(事件/定时触发),运行记录写成节点 | |

## 已知限制 / 待决问题

- 多进程并发写入是"最后写入者胜"(每次 commit 前会重新读盘,窗口很小,但没有锁)。
- `contains` 同时用于文件系统层级(`single-parent`)和逻辑分组时会冲突:逻辑上的"模块包含文件"目前只能用 `describes`。是否拆成两种类型(`contains` / `groups`)待定。
- 查看器是独立的小实现,**没有**复用旧 webapp 的渲染层(它绑定在旧 schema 上)。视图规格目前只能改文件/用 CLI 改,查看器里还没有编辑器。
- 视图规则只支持相等匹配(`when`),还没有表达式;`rollup` 假定关系无环。
- 还没有查询语言;`ls/nb/path` 只覆盖最基本的过滤、邻域、最短路径。
