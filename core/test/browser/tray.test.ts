// 剪贴板:Ctrl+C / X / V(复制、移动)、Ctrl+Shift+V(引用 / 换一种)、外面复制的文字(预览;文件夹里 = 文件,概念里 = 笔记)、
// 粘贴 / 拖进外面的文件、右键菜单和 Ctrl+V 说的一样;撤销上传 = 文件挪进回收站
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { scene, sleep } from './stage.ts';

test('剪贴板:复制 / 剪切 / 粘贴 / 引用;粘贴文字成笔记;外面的文件拖进来、粘贴进来;撤销', (t) => scene(t, async (s) => {
  const { page } = s;
  await page.mouse.click(...await s.emptySpot()); await sleep(200);   // 焦点在画布上
  await s.ui('select idea/a'); await sleep(200);
  await page.keyboard.press('Control+c'); await sleep(400);
  assert.match((await page.text('#tray')) ?? '', /想法A/, '进了剪贴板');
  await s.ui('select docs/'); await sleep(200);
  await page.keyboard.press('Control+v'); await sleep(1200);
  assert.ok(s.edge('docs/', 'contains', 'idea/a-copy'), 'Ctrl+V = 复制进去');

  await s.ui('select idea/b'); await sleep(200);
  await page.keyboard.press('Control+x'); await sleep(300);
  await s.ui('select docs/'); await sleep(200);
  await page.keyboard.press('Control+v'); await sleep(1200);
  assert.ok(s.edge('docs/', 'contains', 'idea/b') && !s.edge('ideas', 'contains', 'idea/b'), '剪切再粘贴 = 移动');
  await s.ui('select auth-mod'); await sleep(200);
  await page.keyboard.press('Control+Shift+v'); await sleep(1200);
  assert.ok(s.edge('auth-mod', 'contains', 'idea/b') && s.edge('docs/', 'contains', 'idea/b'), 'Ctrl+Shift+V = 引用');

  // 外面复制的文字:窗口拿回焦点时读到,显示成列表里的「外部」一行;列表底下写着 Ctrl+V 会怎样
  await page.evaluate(() => navigator.clipboard.writeText('买牛奶\n还有面包'));
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); }); await sleep(400);
  await s.ui('select ideas'); await sleep(200);
  assert.match((await page.text('#tray')) ?? '', /外部 · 买牛奶/, '外面复制的显示出来了');
  assert.match((await page.text('#tray')) ?? '', /Ctrl V\s*新建笔记「买牛奶」,放进「想法」/, '提示:在概念里粘贴文字 = 笔记');
  assert.match((await s.ui('paste --dry')).out, /新建笔记「买牛奶」/);
  await page.keyboard.press('Control+v'); await sleep(1200);
  const note = [...s.store.load().nodes.values()].find((n) => n.attrs.type === 'note');
  assert.ok(note && note.label === '买牛奶' && note.attrs.summary === '买牛奶\n还有面包' && s.edge('ideas', 'contains', note.id), '粘贴文字 = 一条笔记(全文)');

  await s.ui('select docs/'); await sleep(200);
  assert.match((await page.text('#tray')) ?? '', /Ctrl V\s*新建文件 docs\/买牛奶\.md/, '提示:在文件夹里粘贴文字 = 文件');
  await page.keyboard.press('Control+v'); await sleep(1200);
  assert.equal(readFileSync(join(s.dir, 'docs/买牛奶.md'), 'utf8'), '买牛奶\n还有面包', '在文件夹里粘贴文字 = 存成文件,名字取第一行');
  assert.ok(s.edge('docs/', 'contains', 'docs/买牛奶.md'));
  await page.keyboard.press('Control+Shift+v'); await sleep(1200);   // 选中的是刚建的文件 → 粘贴进它所在的 docs/,换一种 = 笔记
  const notes = [...s.store.load().nodes.values()].filter((n) => n.attrs.type === 'note');
  assert.ok(notes.length === 2 && notes.some((n) => s.edge('docs/', 'contains', n.id)), 'Ctrl+Shift+V = 换一种:文件夹里也能粘贴成笔记');

  const long = '长文\n' + '很长的一段话。'.repeat(400);
  await page.evaluate((t: string) => navigator.clipboard.writeText(t), long);
  await s.ui('select ideas'); await sleep(200);
  await page.keyboard.press('Control+v'); await sleep(1200);
  assert.equal(readFileSync(join(s.dir, '长文.md'), 'utf8'), long, '太长的文字在概念里也存成文件(项目根),不截断');
  assert.ok(s.edge('ideas', 'contains', '长文.md'), '概念装着它');

  // 点列表里的一条 = 写回系统剪贴板,外部那一行就没了
  await page.evaluate(() => { (document.querySelector('#tray [data-trk] .lb') as HTMLElement).click(); }); await sleep(300);
  assert.doesNotMatch((await page.text('#tray')) ?? '', /外部 ·/);
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^idea\//, '系统剪贴板里换成了那一条的 id');

  await s.ui('select'); await s.ui('fit');
  const D = await s.emptySpot('docs/');
  for (const type of ['dragover', 'drop']) {
    await page.evaluate((ty: string, x: number, y: number) => {
      const dt = new DataTransfer(); dt.items.add(new File(['hello world'], 'my note.txt', { type: 'text/plain' }));
      document.getElementById('c')!.dispatchEvent(new DragEvent(ty, { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    }, type, ...D);
    await sleep(300);
  }
  await sleep(1200);
  assert.ok(existsSync(join(s.dir, 'docs/my-note.txt')), '拖进 docs 的文件存进了 docs(空白换成 -)');

  await s.ui('select ideas'); await sleep(200);
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await sleep(1500);
  assert.ok(existsSync(join(s.dir, 'image.png')) && s.edge('ideas', 'contains', 'image.png'), '粘贴进概念的文件:存进项目根,概念也装着');

  await s.ui('select'); await s.ui('fit'); await sleep(500);
  await page.mouse.click(...await s.at('idea/c'), 'right'); await sleep(300);
  const menu = (await page.text('#ctxmenu')) ?? '', dry = (await s.ui('paste --dry')).out;
  assert.match(menu, /复制[\s\S]*剪切/);
  assert.ok(menu.includes('粘贴:' + dry) && /存成文件 .*「想法C」也装着/.test(dry), `菜单里的粘贴和 Ctrl+V 是同一个决定(刚粘贴过的图片 → 存进项目根,想法C 装着):${menu}`);
  await page.keyboard.press('Escape');

  await s.ui('undo'); await sleep(800);
  assert.ok(!existsSync(join(s.dir, 'image.png')), '撤销上传:文件不在原处了');
  const bin = join(s.dir, '.git/stars-trash');
  assert.ok(readdirSync(bin).some((d) => d.startsWith('undo-') && existsSync(join(bin, d, 'image.png'))), '而是在回收站里');
}));
