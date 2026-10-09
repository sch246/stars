import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { bridgeAllows, bridgeInject, bridgeShim } from '../src/bridge.ts';
import { parse } from '../src/format.ts';
import { lint } from '../src/lint.ts';
import { apply } from '../src/ops.ts';
import { trackProposals, type Proposal } from '../src/proposals.ts';
import { startServer } from '../src/serve.ts';
import { Store } from '../src/store.ts';

const genesisText = readFileSync(new URL('../genesis.stars', import.meta.url), 'utf8');
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'stars-cfg-')); // 服务登记、个人配置别写进真实的家目录
const freePort = () => new Promise<number>((ok) => {
  const s = createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); });
});

test('页面桥:级别是累加的(读 ⊂ 界面 ⊂ 提议 ⊂ 写),没声明作用的命令页面一律不能用', () => {
  const t = (effect: 'read' | 'ui' | 'write' | 'never' | undefined) => (['off', 'read', 'ui', 'propose', 'write'] as const).map((l) => (bridgeAllows(effect, l) ? 1 : 0)).join('');
  assert.equal(t('read'), '01111');
  assert.equal(t('ui'), '00111');
  assert.equal(t('write'), '00011', '「提议」级也放行写命令(执行时改成提议)');
  assert.equal(t('never'), '00000');
  assert.equal(t(undefined), '00000', '没声明 = 不给');
});

test('页面桥:脚本插在 <head> 之后(不会错认 <header>),没有 head 就在 <html> / <!doctype> 之后', () => {
  const T = '<x>';
  assert.equal(bridgeInject('<!doctype html><html><head><title>a</title></head></html>', T), '<!doctype html><html><head><x><title>a</title></head></html>');
  assert.equal(bridgeInject('<html lang="zh"><header>h</header></html>', T), '<html lang="zh"><x><header>h</header></html>');
  assert.equal(bridgeInject('<HEAD class="a"><script>1</script>', T), '<HEAD class="a"><x><script>1</script>');
  assert.equal(bridgeInject('<!DOCTYPE html>\n<p>hi</p>', T), '<!DOCTYPE html><x>\n<p>hi</p>');
  assert.equal(bridgeInject('<p>hi</p>', T), '<x><p>hi</p>');
  assert.throws(() => bridgeShim('"; alert(1); "'), /nonce/, '暗号只能是十六进制');
});

test('页面桥:window.stars 发出带暗号的请求;只认父窗口发回、带同一个暗号的回复和事件', async () => {
  const nonce = 'ab'.repeat(16), sent: any[] = [], listeners: Array<(e: unknown) => void> = [];
  const parent = { postMessage: (m: unknown) => sent.push(m) };
  const win: any = { parent, addEventListener: (_t: string, f: (e: unknown) => void) => listeners.push(f), console };
  win.window = win;
  vm.runInNewContext(bridgeShim(nonce).replace(/^<script>|<\/script>$/g, ''), win);
  const stars = win.stars;
  assert.ok(stars && Object.isFrozen(stars));
  const deliver = (data: unknown, source: unknown = parent) => { for (const f of listeners) f({ source, data }); };

  const p = stars.exec('ls -t file');
  assert.deepEqual({ ...sent[0] }, { line: 'ls -t file', id: 1, kind: 'exec', stars: nonce });
  deliver({ stars: 'cd'.repeat(16), re: 1, ok: true, value: 'forged' });           // 暗号不对
  deliver({ stars: nonce, re: 1, ok: true, value: 'forged' }, { postMessage() {} }); // 不是父窗口
  deliver({ stars: nonce, re: 1, ok: true, value: { out: 'x', data: [1] } });
  assert.deepEqual({ ...(await p) }, { out: 'x', data: [1] });

  const q = stars.exec('rm x');
  deliver({ stars: nonce, re: 2, ok: false, error: '不能用' });
  await assert.rejects(q, /不能用/);

  const got: unknown[] = [];
  const off = stars.on('change', (v: unknown) => got.push(v));
  assert.deepEqual({ ...sent.at(-1) }, { kind: 'sub', event: 'change', stars: nonce }, '第一次订阅时告诉查看器');
  deliver({ stars: nonce, event: 'change', value: 7 });
  off();
  deliver({ stars: nonce, event: 'change', value: 8 });
  assert.deepEqual(got, [7], '取消订阅后不再收到');

  stars.store.set('k', { a: 1 });
  assert.deepEqual({ ...sent.at(-1) }, { op: 'set', key: 'k', value: { a: 1 }, id: 3, kind: 'store', stars: nonce });
});

test('提议的节点:attrs.status = proposed,按 #id 记是谁提的;确认 / 删除 / 改名都跟着走;体检里列出来', () => {
  const u = parse(genesisText);
  const map: Record<string, Proposal> = {};
  let n = 0;
  const run = (author: string, op: Parameters<typeof apply>[1]) => { apply(u, op); trackProposals(map, { n: ++n, t: new Date(2026, 0, n).toISOString(), author, op }); };
  run('page:agent.html', { op: 'addNode', id: 'idea', label: '想法', attrs: { status: 'proposed' } });
  run('page:agent.html', { op: 'addNode', id: 'idea2', label: '想法 2', attrs: { status: 'proposed' } });
  run('human', { op: 'addNode', id: 'plain', label: '普通' });
  assert.deepEqual(Object.keys(map).sort(), ['#idea', '#idea2']);
  assert.equal(map['#idea']!.author, 'page:agent.html');
  assert.deepEqual(lint(u).filter((i) => i.rule === 'proposed').map((i) => i.nodes), [['idea'], ['idea2']]);
  run('human', { op: 'setNode', id: 'idea', unset: ['status'] });
  assert.ok(!('#idea' in map), '确认之后不再算');
  run('human', { op: 'renameNodes', pairs: [['idea2', 'idea3']] });
  assert.deepEqual(Object.keys(map), ['#idea3'], '改名后键跟着走');
  run('human', { op: 'removeNode', id: 'idea3' });
  assert.deepEqual(Object.keys(map), []);
  run('page:agent.html', { op: 'setNode', id: 'plain', set: { status: 'proposed' } });
  assert.deepEqual(Object.keys(map), ['#plain'], 'setNode 把 status 设成 proposed 也算');
  run('human', { op: 'setNode', id: 'plain', set: { status: 'done' } });
  assert.deepEqual(Object.keys(map), [], 'status 改成别的就不算了');
});

test('预览:/preview 用单独的预览 token(拿它进不了 /api);?bridge=<暗号> 只往 HTML 里注入 window.stars;授权存在 grants.llf', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stars-pv-'));
  mkdirSync(join(dir, 'web'));
  writeFileSync(join(dir, 'web/index.html'), '<!doctype html><html><head><title>t</title></head><body>hi</body></html>');
  writeFileSync(join(dir, 'web/style.css'), 'body{color:red}');
  const store = new Store(join(dir, 'universe.stars')); store.create(genesisText);
  const port = await freePort();
  const srv = startServer(store, port, dir, '127.0.0.1', () => {});
  await new Promise((r) => setTimeout(r, 150));
  const base = `http://127.0.0.1:${port}`, nonce = '0f'.repeat(16);
  const pv = (tok: string, path: string) => fetch(`${base}/preview/${tok}/_/${path}`);
  try {
    assert.notEqual(srv.previewToken, srv.token);
    const page = await (await fetch(`${base}/`)).text();
    assert.ok(page.includes(`<meta name="stars-preview" content="${srv.previewToken}">`), '页面里带着预览 token');
    assert.equal((await pv(srv.token, 'web/index.html')).status, 403, '/api 的 token 不能用来预览');
    const plain = await pv(srv.previewToken, 'web/index.html');
    assert.equal(plain.status, 200);
    assert.match(plain.headers.get('content-security-policy') ?? '', /^sandbox /);
    assert.ok(!(await plain.text()).includes('window.stars'), '不带 bridge 不注入');
    const html = await (await pv(srv.previewToken, `web/index.html?bridge=${nonce}`)).text();
    assert.ok(html.startsWith(`<!doctype html><html><head><script>(function () {\n  var N = "${nonce}"`), '注入在 <head> 之后、页面自己的东西之前');
    assert.ok(!(await (await pv(srv.previewToken, 'web/index.html?bridge=nope')).text()).includes('window.stars'), '暗号格式不对不注入');
    assert.equal(await (await pv(srv.previewToken, `web/style.css?bridge=${nonce}`)).text(), 'body{color:red}', '只注入 HTML');
    assert.equal((await fetch(`${base}/api/raw?t=${srv.previewToken}&path=web/style.css`)).status, 403, '预览 token 进不了 /api');
    // 授权文件走个人配置的同一套接口
    const H = { 'x-stars-token': srv.token, 'content-type': 'application/json' };
    const cfg = JSON.parse(/<script type="application\/json" id="stars-config">([\s\S]*?)<\/script>/.exec(page)![1]!) as { defaults: Record<string, string> };
    assert.match(cfg.defaults.grants!, /^pages \{\}$/m);
    const text = `pages {}\n  "${dir}" {}\n    web/index.html - propose\n--LLF-END\n`;
    const w = await fetch(`${base}/api/config`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'grants', content: text, mtime: null }) });
    assert.equal(w.status, 200);
    assert.equal(readFileSync(join(process.env.XDG_CONFIG_HOME!, 'stars', 'grants.llf'), 'utf8'), text);
  } finally { srv.close(); }
});
