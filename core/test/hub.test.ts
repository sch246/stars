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
