// 不过 HTTP:服务的核心(hub.ts)+ 进程内的接口(localApi)+ 订阅 —— 以后的 VS Code 宿主就这么接
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HttpError, RawReply, localApi } from '../src/api.ts';
import { createHub } from '../src/hub.ts';
import { Store } from '../src/store.ts';

const genesis = readFileSync(new URL('../genesis.stars', import.meta.url), 'utf8');

test('进程内:localApi 和 HTTP 同一张表;subscribe 先收到快照,之后是增量;出错带状态码;图片是 RawReply', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stars-hub-'));
  const store = new Store(join(dir, 'universe.stars'));
  store.create(genesis);
  writeFileSync(join(dir, 'p.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const hub = createHub(store, dir, () => {}, { agent: false });
  const events: Array<[string, { type?: string; entries?: Array<{ op: { op: string; id?: string } }> }]> = [];
  const off = hub.subscribe({ push: (e, d) => events.push([e, d as never]) });
  try {
    assert.equal(events[0]![0], 'message');
    assert.equal(events[0]![1].type, 'snapshot');
    const api = localApi(hub);
    const r = await api.post('/api/cmd', { name: 'add', args: ['x', '想法'], author: 'host' }) as { out: string; n: number };
    assert.match(r.out, /\+ x/);
    assert.equal(store.readLog().at(-1)!.author, 'host');
    for (let i = 0; i < 100 && !events.some(([, d]) => d.type === 'change' && d.entries?.some((e) => e.op.id === 'x')); i++) await new Promise((ok) => setTimeout(ok, 30));
    assert.ok(events.some(([, d]) => d.type === 'change'), '写入之后收到增量');
    const projects = await api.get('/api/projects') as { open: Array<{ dir: string }> };
    assert.equal(projects.open[0]!.dir, dir);
    await assert.rejects(api.post('/api/cmd', { name: 'nope' }), (e: unknown) => e instanceof HttpError && e.status === 400);
    await assert.rejects(api.get('/api/nope'), (e: unknown) => e instanceof HttpError && e.status === 404);
    const img = await api.get('/api/raw', { path: 'p.png' });
    assert.ok(img instanceof RawReply && img.type === 'image/png' && img.body.length === 4);
    assert.equal(hub.broadcast('config', { name: 'settings' }), 1, '具名事件也推给进程内的订阅者');
    assert.deepEqual(events.at(-1), ['config', { name: 'settings' }]);
  } finally { off(); hub.close(); }
});

test('回放到操作日志的某一条:/api/oplog 列出来,/api/state?op=n 是那一刻的宇宙;删掉的节点放回原位(diff.removedNodes)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stars-oprep-'));
  const store = new Store(join(dir, 'universe.stars'));
  store.create(genesis);
  const hub = createHub(store, dir, () => {}, { agent: false });
  const api = localApi(hub);
  try {
    const cmd = (name: string, ...args: string[]) => api.post('/api/cmd', { name, args, author: 'tester' });
    await cmd('add', 'box', '盒子'); await cmd('add', 'a', 'A'); await cmd('link', 'box', 'contains', 'a'); await cmd('set', 'a', '-l', 'A2'); await cmd('rm', 'a');
    const log = await api.get('/api/oplog') as { entries: Array<{ n: number; summary: string; author: string }>; more: boolean };
    assert.deepEqual(log.entries.map((e) => e.summary), ['+node box', '+node a', '+edge box -contains-> a', '~node a', log.entries[4]!.summary]);
    assert.equal(log.entries[0]!.author, 'tester');
    type St = { nodes: Array<{ id: string; label: string }>; edges: Array<{ from: string; to: string }>; diff: { addedNodes: string[]; changedNodes: string[]; removedNodes: string[] }; entry: { n: number } };
    const at3 = await api.get('/api/state', { op: String(log.entries[2]!.n) }) as St;
    assert.ok(at3.nodes.some((n) => n.id === 'a' && n.label === 'A') && at3.edges.some((e) => e.from === 'box' && e.to === 'a'));
    const at4 = await api.get('/api/state', { op: String(log.entries[3]!.n) }) as St;
    assert.deepEqual(at4.diff.changedNodes, ['a']);
    const at5 = await api.get('/api/state', { op: String(log.entries[4]!.n) }) as St;
    assert.deepEqual(at5.diff.removedNodes, ['a']);
    assert.ok(at5.nodes.some((n) => n.id === 'a' && n.label === 'A2'), '删掉的节点放回来了(好画成红圈)');
    assert.ok(at5.edges.some((e) => e.from === 'box' && e.to === 'a'), '连同装着它的容器边');
    assert.equal(store.load().nodes.has('a'), false, '回放不动宇宙');
    await assert.rejects(api.get('/api/state', { op: '9999' }), /没有第 9999 条/);
    const page = await api.get('/api/oplog', { limit: '2', before: String(log.entries[4]!.n) }) as { entries: Array<{ n: number }>; more: boolean };
    assert.deepEqual([page.entries.map((e) => e.n), page.more], [[log.entries[2]!.n, log.entries[3]!.n], true]);
  } finally { hub.close(); }
});
