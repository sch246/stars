// 静态导出:一个自包含的 HTML,file:// 直接打开;视图脚本从页面里的 import map 加载(互相 import 也行)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { exportHtml } from '../../src/exporter.ts';
import { Store } from '../../src/store.ts';
import { viewSources } from '../../src/viewload.ts';
import { launch, sleep } from './cdp.ts';

const genesis = readFileSync(new URL('../../genesis.stars', import.meta.url), 'utf8');

test('静态导出:file:// 打开,视图脚本(.js 和 .ts,互相 import)从页面里的 import map 加载', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'stars-export-'));
  const store = new Store(join(dir, 'universe.stars'));
  store.create(genesis);
  store.commit({ op: 'batch', ops: [
    { op: 'addNode', id: 'idea', label: '想法', attrs: { type: 'concept' } },
    { op: 'addNode', id: '~view/cyc', label: 'cyc', attrs: { kind: 'view', spec: JSON.stringify({ script: 'views/a.js' }) } },
  ] } as never, { author: 't' });
  mkdirSync(join(dir, 'views'));
  writeFileSync(join(dir, 'views/a.js'), "import { pick } from './b.ts';\nexport const name = 'a';\nexport const spec = { base: 'galaxy' };\nexport function color(n) { return n.id === 'idea' ? pick() : undefined; }\n");
  writeFileSync(join(dir, 'views/b.ts'), "import { name } from './a.js';\nexport function pick(): string { return name === 'a' ? '#13579b' : '#000000'; }\n");
  const out = join(dir, 'out.html');
  writeFileSync(out, exportHtml(store, dir, await viewSources(store.load(), dir)));

  const browser = await launch();
  if (!browser && process.env.CI) throw new Error('CI 上没找到 Chrome / Chromium');
  if (!browser) { t.skip('没找到 Chrome / Chromium'); rmSync(dir, { recursive: true, force: true }); return; }
  const { page } = browser;
  try {
    await page.goto(`${pathToFileURL(out).href}#view=cyc`);
    await page.waitFor(() => document.getElementById('status')?.textContent?.includes('静态导出'), 15_000);
    await sleep(800);
    await page.clickOn('#hint [data-cmd="panel console"]');
    await page.waitFor(() => document.activeElement?.id === 'con-in');
    await page.keyboard.type('look idea');
    await page.keyboard.press('Enter');
    await page.waitFor(() => /#13579b/.test(document.getElementById('con-out')?.textContent ?? ''), 10_000);
    assert.doesNotMatch(await page.text('#banner') ?? '', /加载失败|加载不了/);
    assert.deepEqual(page.errors.filter((e) => !/favicon/.test(e)), []);
  } finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }
});
