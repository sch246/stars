import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AgentLoop, runScriptNode, type AgentEvent } from '../src/agent.ts';
import { runKernel, type CliOpts } from '../src/commands.ts';
import { readRuns } from '../src/runlog.ts';
import { globToRegExp, parseDuration, parseTriggers, type RunRecord } from '../src/scriptnode.ts';
import { startServer } from '../src/serve.ts';
import { readDraft, Store } from '../src/store.ts';

const genesis = readFileSync(new URL('../genesis.stars', import.meta.url), 'utf8');
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'stars-cfg-'));

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'stars-agent-'));
  const file = join(dir, 'universe.stars');
  const store = new Store(file);
  store.create(genesis);
  const run = (cmd: string, args: string[] = [], o: CliOpts = {}) => runKernel(cmd, args, o, { store, author: 'me', root: dir });
  return { dir, file, store, run };
}
/** 等 agent 跑完 n 次 */
function collector() {
  const ends: RunRecord[] = [];
  let wake: (() => void) | null = null;
  const onEvent = (e: AgentEvent) => { if (e.phase === 'end' && e.record) { ends.push(e.record); wake?.(); } };
  const until = async (n: number, ms = 8000) => {
    const t = Date.now();
    while (ends.length < n && Date.now() - t < ms) await new Promise<void>((ok) => { wake = ok; setTimeout(ok, 200); });
    return ends;
  };
  return { ends, onEvent, until };
}

test('脚本节点:触发的写法、时长、通配', () => {
  assert.equal(parseDuration('10m'), 600_000);
  assert.equal(parseDuration('1.5s'), 1500);
  assert.equal(parseDuration('30'), 30_000);
  assert.equal(parseDuration('soon'), null);
  assert.ok(globToRegExp('src/**').test('src/a/b.ts'));
  assert.ok(globToRegExp('**/*.ts').test('a.ts') && globToRegExp('**/*.ts').test('x/y/a.ts'));
  assert.ok(!globToRegExp('src/*.ts').test('src/a/b.ts'));
  assert.ok(globToRegExp('docs/').test('docs/x/readme.md'));
  const t = parseTriggers('change, file:src/** ; stale,start, file');
  assert.deepEqual(t.triggers.map((x) => x.kind), ['change', 'file', 'stale', 'start', 'file']);
  assert.deepEqual(parseTriggers('change,whenever').errors.length, 1);
});

test('脚本节点:手动跑 —— 拿到参数和 trigger,写进宇宙,记录追加到 .runs;没事的运行不再写 ~run 节点', async () => {
  const { dir, file, store, run } = project();
  run('script-set', ['hi'], { code: 'export default async (stars, args) => { await stars.cmd.add("n-" + args[0], { type: "note" }); return stars.trigger.kind + ":" + args.join(","); }', summary: '打招呼' });
  const r1 = await runScriptNode('hi', { store, file, root: dir, args: ['a', 'b'] });
  assert.deepEqual([r1.status, r1.ops, r1.trigger, r1.out.trim()], ['ok', 1, 'manual', 'manual:a,b']);
  assert.ok(store.load().nodes.has('n-a'));
  const runNode = store.load().nodes.get('~run/hi')!;
  assert.deepEqual([runNode.attrs.status, runNode.attrs.ops, runNode.attrs.kind], ['ok', '1', 'run']);
  assert.equal(store.readLog().at(-1)!.author, 'agent', '运行记录的作者是 agent');
  // 只读的脚本:跑完状态没变、没写东西 → 只进 .runs,不再提交 ~run 节点
  run('script-set', ['look'], { code: 'export default async (stars) => (await stars.graph()).nodes.length' });
  await runScriptNode('look', { store, file, root: dir });
  const n = store.logCount();
  await runScriptNode('look', { store, file, root: dir });
  assert.equal(store.logCount(), n, '安静的运行不刷日志');
  assert.equal(readRuns(file, { script: 'look' }).length, 2);
  // 出错
  run('script-set', ['bad'], { code: 'throw new Error("坏了")' });
  const r3 = await runScriptNode('bad', { store, file, root: dir });
  assert.equal(r3.status, 'error');
  assert.match(r3.out, /坏了/);
  assert.equal(store.load().nodes.get('~run/bad')!.attrs.status, 'error');
  // 指向文件的脚本 + draft=true:写进草稿
  mkdirSync(join(dir, 'tools'));
  writeFileSync(join(dir, 'tools', 'd.mjs'), 'await stars.cmd.add("drafted"); stars.print("ok");');
  run('script-set', ['dr'], { ref: 'tools/d.mjs', attr: ['draft=true'] });
  const r4 = await runScriptNode('dr', { store, file, root: dir });
  assert.deepEqual([r4.status, r4.ops, r4.draft], ['ok', 0, 1]);
  assert.ok(!store.load().nodes.has('drafted') && readDraft(file).length === 1, '在草稿里,没落进宇宙');
  assert.match(run('scripts').out, /dr\s+只能手动 · 写进草稿\s+\[tools\/d\.mjs\]/);
  await assert.rejects(runScriptNode('nope', { store, file, root: dir }), /没有脚本节点/);
  assert.throws(() => run('script-set', ['x'], { code: '1', attr: ['every=1s'] }), /至少 5s/);
  assert.throws(() => run('script-set', ['x'], {}), /没有代码/);
});

test('agent 循环:change 触发(不算自己写的,不会自己触发自己);file 触发带上路径;超时就停', async () => {
  const { dir, file, store, run } = project();
  run('script-set', ['echo'], { attr: ['on=change', 'debounce=100ms'], code: `export default async (stars) => {
    const t = stars.trigger;
    await stars.cmd.add('seen-' + t.ops.map((o) => o.n).join('-'), { type: 'note' });
  }` });
  run('script-set', ['files'], { attr: ['on=file:src/**', 'debounce=100ms'], code: `await stars.cmd.add('f', { summary: stars.trigger.paths.join(',') });` });
  run('script-set', ['slow'], { attr: ['timeout=1s'], code: 'while (true) {}' });
  const c = collector();
  const loop = new AgentLoop({ store, root: dir, onEvent: c.onEvent });
  loop.start();
  try {
    const before = store.logCount();
    run('add', ['x']);
    loop.onOps(store.readLog().filter((e) => e.n > before));
    await c.until(1);
    assert.equal(c.ends[0]!.status, 'ok');
    const seen = [...store.load().nodes.keys()].filter((id) => id.startsWith('seen-'));
    assert.deepEqual(seen, [`seen-${before + 1}`], 'trigger.ops 里是别人的那条');
    // 它自己写的、运行记录(作者 agent)不触发它
    loop.onOps(store.readLog().filter((e) => e.n > before + 1));
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(c.ends.length, 1, '没有再跑');
    loop.onFiles(['docs/a.md', 'src/a.ts', 'src/b/c.ts']);
    await c.until(2);
    assert.equal(store.load().nodes.get('f')!.attrs.summary, 'src/a.ts,src/b/c.ts');
    const t = await loop.runNow('slow');
    assert.equal(t.status, 'timeout');
    assert.match(t.out, /超过 1s/);
    assert.equal(store.load().nodes.get('~run/slow')!.attrs.status, 'timeout');
  } finally { loop.stop(); }
});

test('agent 循环:服务端 —— /api/run 跑完返回记录,/api/runs 列出,运行开始、结束推给页面', async () => {
  const { dir, run } = project();
  run('script-set', ['count'], { code: 'export default async (stars) => "共 " + (await stars.graph()).nodes.length + " 个节点"' });
  const port = await new Promise<number>((ok) => { const s = createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); }); });
  const { store } = { store: new Store(join(dir, 'universe.stars')) };
  const srv = startServer(store, port, dir, '127.0.0.1', () => {});
  const base = `http://127.0.0.1:${port}`;
  const post = async (path: string, body: unknown) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'x-stars-token': srv.token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, j: await r.json() as Record<string, any> };
  };
  try {
    await new Promise((r) => setTimeout(r, 150));
    const ctl = new AbortController();
    const events = await fetch(`${base}/events`, { signal: ctl.signal });
    const reader = events.body!.getReader();
    let buf = '';
    const until = async (re: RegExp) => {
      const t = Date.now();
      while (Date.now() - t < 8000) {
        const { value, done } = await Promise.race([reader.read(), new Promise<{ value: undefined; done: true }>((r) => setTimeout(() => r({ value: undefined, done: true }), 8000))]);
        if (value) buf += new TextDecoder().decode(value);
        if (re.test(buf)) return true;
        if (done) return false;
      }
      return false;
    };
    const r = await post('/api/run', { name: 'count', author: 'tester' });
    assert.equal(r.status, 200);
    assert.equal(r.j.record.status, 'ok');
    assert.match(r.j.record.out, /共 \d+ 个节点/);
    assert.ok(await until(/"type":"run","phase":"end","script":"count"/), '推了运行结束');
    const runs = await (await fetch(`${base}/api/runs?script=count`, { headers: { 'x-stars-token': srv.token } })).json() as { runs: RunRecord[] };
    assert.equal(runs.runs.length, 1);
    assert.equal((await post('/api/run', { name: 'nope' })).status, 400);
    ctl.abort();
  } finally { srv.close(); }
});
