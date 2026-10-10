// 剪贴板:Ctrl+C / X / V(复制、移动)、Ctrl+Shift+V(引用)、粘贴文字 = 笔记、粘贴 / 拖进外面的文件;撤销上传 = 文件挪进回收站
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
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

  await page.evaluate(() => navigator.clipboard.writeText('买牛奶\n还有面包'));
  await s.ui('select ideas'); await sleep(200);
  await page.keyboard.press('Control+v'); await sleep(1200);
  const note = [...s.store.load().nodes.values()].find((n) => n.attrs.type === 'note');
  assert.ok(note && note.label === '买牛奶' && s.edge('ideas', 'contains', note.id), '粘贴文字 = 一条笔记');

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
  assert.match((await page.text('#ctxmenu')) ?? '', /复制[\s\S]*剪切/);
  await page.keyboard.press('Escape');

  await s.ui('undo'); await sleep(800);
  assert.ok(!existsSync(join(s.dir, 'image.png')), '撤销上传:文件不在原处了');
  const bin = join(s.dir, '.git/stars-trash');
  assert.ok(readdirSync(bin).some((d) => d.startsWith('undo-') && existsSync(join(bin, d, 'image.png'))), '而是在回收站里');
}));
