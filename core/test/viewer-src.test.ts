// 查看器的源码:app/NN-*.js 拼进同一个函数体,顶层同名的 function 不报错、后写的悄悄盖掉先写的 —— 这里查出来
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { viewerDir, viewerParts } from '../src/page.ts';

test('查看器源码:各个 app/*.js 的顶层名字不重复(拼在一起后同名的 function 会悄悄互相覆盖)', () => {
  const seen = new Map<string, string>(), dup: string[] = [];
  for (const f of viewerParts()) {
    readFileSync(`${viewerDir}/app/${f}`, 'utf8').split('\n').forEach((line, i) => {
      const m = /^(?:async\s+)?function\s*\*?\s*([\w$]+)|^(?:const|let|var|class)\s+([\w$]+)/.exec(line);
      if (!m) return;
      const name = (m[1] ?? m[2])!, at = `${f}:${i + 1}`;
      if (seen.has(name)) dup.push(`${name}:${seen.get(name)} 和 ${at}`); else seen.set(name, at);
    });
  }
  assert.deepEqual(dup, []);
  assert.ok(readdirSync(`${viewerDir}/app`).length > 20);
});
