import assert from 'node:assert/strict';
import { test } from 'node:test';
import { textDiff, textHash, textNormEol, textPatch } from '../src/textsync.ts';

test('增量保存:textDiff 给出唯一改动的一段,textPatch 拼回去等于新文本;不劈开代理对;哈希两端一致、对改动敏感', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };
  const pieces = ['a', 'b', '\n', '星', '😀', '😁', '\r\n', ' ', 'xyz'];
  const word = (n: number) => Array.from({ length: n }, () => pieces[Math.floor(rnd() * pieces.length)]).join('');
  for (let i = 0; i < 3000; i++) {
    const a = word(Math.floor(rnd() * 40));
    // 在 a 上随机改一处或两处
    let cps = Array.from(a);   // 按码点编辑:真实的编辑不会劈开 emoji
    for (let k = rnd() < 0.5 ? 1 : 2; k > 0; k--) { const at = Math.floor(rnd() * (cps.length + 1)), del = Math.floor(rnd() * 4); cps = [...cps.slice(0, at), ...Array.from(word(Math.floor(rnd() * 4))), ...cps.slice(at + del)]; }
    const b = cps.join('');
    const p = textDiff(a, b);
    assert.equal(textPatch(a, p), b, JSON.stringify({ a, b, p }));
    assert.ok(p.end - p.start <= a.length && p.insert.length <= b.length);
    for (const s of [p.insert, a.slice(p.start, p.end)]) {
      assert.ok(!/^[\udc00-\udfff]/.test(s) && !/[\ud800-\udbff]$/.test(s), `改动的边界劈开了代理对 ${JSON.stringify({ a, b, p })}`);
    }
  }
  assert.deepEqual(textDiff('hello world', 'hello brave world'), { start: 6, end: 6, insert: 'brave ' });
  assert.deepEqual(textDiff('same', 'same'), { start: 4, end: 4, insert: '' });
  assert.equal(textHash('abc'), textHash('abc'));
  assert.notEqual(textHash('abc'), textHash('abd'));
  assert.notEqual(textHash(''), textHash('\n'));
  assert.equal(textNormEol('a\r\nb\rc\n'), 'a\nb\nc\n');
  assert.throws(() => textPatch('abc', { start: 2, end: 9, insert: '' }), RangeError);
});
