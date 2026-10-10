# 星罗 (Stars)

> 本项目使用 AI 辅助生成

把一个项目画成一张能直接编辑的图:文件、文件夹、概念是节点,它们之间的关系是带类型的边。
整张图存在项目里的一个文本文件 `universe.stars` 里,跟代码一起进 git。

## 能做什么

- **文件夹自动铺成图**,磁盘上的新增、改名、删除实时同步进来。在图里拖动、复制、打包、解散,磁盘上的文件真的跟着动;
  删掉的文件进回收站,每一步都能撤销。
- **同一份数据,多种看法**:星系、最近编辑、标签、依赖、树……视图是一份 JSON 规则,里面可以写表达式、调用函数节点,改了立刻生效。
- **说明会过期**:给文件写的说明记着当时的文件版本,文件之后改了就会提醒。
- **人、脚本、AI 一起改**:命令行、查看器、脚本走同一套命令,每一步都进操作日志,记着是谁改的。
  AI 写进来的可以先只是「提议」,审阅后再接受;批量改动可以先进草稿,看过再整批应用。
- **脚本节点**:一段 JS 存在宇宙里,手动跑,或者在文件变化、宇宙变化、定时的时候自动跑,每次运行都有记录。
- **运行零依赖**:Node ≥ 22.18 直接运行 TypeScript 源码,不需要构建。

## 开始

```bash
git clone https://github.com/sch246/stars
cd stars/core && npm link      # 之后哪个目录里都能用 stars 命令(不想 link 就用 node <路径>/core/src/cli.ts)

cd 你的项目
stars init                     # 新建 universe.stars
stars scan .                   # 把文件夹铺成节点
stars serve --watch            # 打开 http://localhost:4321;磁盘上的变化实时同步进来
```

查看器里按 `?` 看所有快捷键,按 `` ` `` 打开控制台,`Ctrl K` 打开命令面板。`stars help` 列出所有命令。

设计、用法和已知限制都写在 [`core/DESIGN.md`](core/DESIGN.md)。

## 仓库里有什么

| 位置 | 是什么 |
|---|---|
| [`core/`](core/) | 现在的星罗:内核、命令行、实时查看器 |
| `universe.stars` | 用星罗描述星罗自己 |
| `src/`、`webapp/`、`index.html` | 旧版:VS Code 扩展和网页版([stars.sch246.com](https://stars.sch246.com)),说明见 [`LEGACY.md`](LEGACY.md) |

## 开发

```bash
cd core
npm test                       # 单元测试
npm run test:ui                # 浏览器里的交互测试(要装了 Chrome / Chromium / Edge)
npm ci && npm run typecheck    # 类型检查(只有这一步要装东西:typescript、@types/node)
```

推到 GitHub 后,CI 会在 Node 22 / 24 上跑类型检查和单元测试,另外单独跑一遍浏览器测试。

## 贡献

本项目目前不接受外部代码贡献或功能请求。感谢理解。

## 许可证

MIT License.
