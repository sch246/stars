import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  LlfError, LlfTagged, llfDelete, llfDocValue, llfFind, llfParse, llfParseDoc, llfParseFrames, llfParseMulti,
  llfSetString, llfStringify, llfToJson, llfUntag, type LlfDoc, type LlfNode, type LlfOptions, type LlfValue,
} from '../src/llf.ts';

// vectors.json 原样拷自 sch246/llf-format(参考实现的机器可读向量)
interface Vector { id: number | string; input: string; expected?: unknown; expected_multi?: unknown[]; expected_frames?: unknown[]; error?: string; tags?: boolean }
const V = JSON.parse(readFileSync(new URL('./fixtures/llf-vectors.json', import.meta.url), 'utf8')) as Record<string, Vector[]>;

// python 参考实现给出的错误行号(llf.py 的 LLFError.line)
const PY_LINES: Record<string, number | null> = {
  'vectors/22': null, 'vectors/23': 1, 'vectors/24': 1, 'vectors/25': 2, 'vectors/26': 2, 'vectors/27': 4, 'vectors/28': 2,
  'vectors/29': 2, 'vectors/30': 2, 'vectors/31': 3, 'vectors/33': 1, 'vectors/43': 1, 'vectors/44': 1, 'vectors/45': 1,
  'vectors/46': 1, 'vectors/48': 2, 'vectors/53': 2, 'vectors/54': 2, 'vectors/55': 1, 'vectors/66': 3, 'vectors/67': null,
  'vectors/68': null, 'vectors/70': null, 'vectors/71': 2, 'vectors/72': null, 'vectors/73': 1, 'vectors/75': 1, 'vectors/77': 1,
  'tag_vectors/12': 1, 'tag_vectors/13': 1, 'tag_vectors/14': 1, 'tag_vectors/15': 1, 'tag_vectors/16': 1, 'tag_vectors/17': 2,
  'tag_vectors/18': 2, 'tag_vectors/19': 1, 'tag_vectors/20': 1, 'tag_vectors/21': 2,
};

/** 值相等,且键序也相等(deepStrictEqual 不看键序) */
function sameValue(got: unknown, want: unknown, msg: string): void {
  assert.deepStrictEqual(got, want, msg);
  assert.equal(JSON.stringify(llfToJson(got as LlfValue)), JSON.stringify(llfToJson(want as LlfValue)), `${msg}(键序)`);
}

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof LlfError) return e.code;
    throw e;
  }
}

// 与 tests/test_llf.py 的 check_one / check_frames / check_tags 一一对应
function checkVector(group: string, v: Vector, opts: LlfOptions): void {
  const tag = `${group} ${v.id}${opts.tags ? ' (tags)' : ''}`;
  if (v.expected_multi) {
    sameValue(llfParseMulti(v.input, opts).map(llfToJson), v.expected_multi, tag);
    return;
  }
  const run = group === 'frame_vectors' ? () => llfParseFrames(v.input, opts).map(llfToJson) : () => llfToJson(llfParse(v.input, opts));
  let got: unknown;
  try {
    got = run();
  } catch (e) {
    assert.ok(e instanceof LlfError, `${tag}: 意外异常 ${e}`);
    assert.equal(e.code, v.error, `${tag}: 期望 ${v.error ?? '成功'},实际抛 ${e.code}`);
    const want = PY_LINES[`${group}/${v.id}`];
    if (want !== undefined) assert.equal(e.line, want, `${tag}: 行号`);
    return;
  }
  assert.equal(v.error, undefined, `${tag}: 期望错误 ${v.error},实际解析成 ${JSON.stringify(got)}`);
  sameValue(got, group === 'frame_vectors' ? v.expected_frames : v.expected, tag);
}

test('LLF 向量:81 条默认模式向量(含多消息)', () => {
  assert.equal(V.vectors.length, 81);
  for (const v of V.vectors) checkVector('vectors', v, {});
});

test('LLF 向量:严格模式向量', () => {
  assert.ok(V.strict_vectors.length >= 2);
  for (const v of V.strict_vectors) checkVector('strict_vectors', v, { strict: true });
});

test('LLF 向量:帧流向量', () => {
  assert.ok(V.frame_vectors.length >= 6);
  for (const v of V.frame_vectors) checkVector('frame_vectors', v, {});
});

test('LLF 向量:类型标签向量', () => {
  assert.ok(V.tag_vectors.length >= 22);
  for (const v of V.tag_vectors) checkVector('tag_vectors', v, { tags: v.tags ?? true });
});

test('LLF 向量:本体向量在 tags=true 下结果完全相同(扩展只占用非法写法)', () => {
  for (const v of V.vectors) checkVector('vectors', v, { tags: true });
  for (const v of V.strict_vectors) checkVector('strict_vectors', v, { strict: true, tags: true });
});

test('LLF 文档模型:错误码与 llfParse 相同', () => {
  for (const [group, strict] of [['vectors', false], ['strict_vectors', true], ['tag_vectors', false]] as const) {
    for (const v of V[group]) {
      if (v.expected_multi) continue;
      const opts = { strict, tags: group === 'tag_vectors' ? v.tags ?? true : false };
      assert.equal(codeOf(() => llfParseDoc(v.input, opts)), codeOf(() => llfParse(v.input, opts)), `${group} ${v.id}`);
    }
  }
});

// ---------- 往返 fuzz ----------

function makeRng(seed: number) {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number): number => Math.floor(next() * n);
  const pick = <T>(arr: readonly T[]): T => arr[int(arr.length)];
  return { next, int, pick };
}
type Rng = ReturnType<typeof makeRng>;

// __proto__ 之类的键必须是自有属性
function put(obj: Record<string, LlfValue>, key: string, value: LlfValue): void {
  Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
}

const STRINGS = [
  '', ' ', '  x', 'x  ', 'a b', 'a"b', 'a\\b', 'a\nb', 'x\n', '\n', '3', '007', 'true', 'null', '-', '_', '{}', '[]', '#x', '名字',
  'line1\nline2\n', 'tab\there', 'a\r\nb', 'x\r', 'call - fake', ' x', 'x　', '　', '|x', '|', '--LLF-END', '--LLF-END\n',
  ' lead', 'trail ', '"q"', 'x - y', '😀 emoji', '--LLF-BEGIN', '!t - v', '  |z',
];
const KEYS = [
  'key', 'a b', 'q"q', '-', '_', '', '#h', '名字', 'a\tb', 'a\nb', '--LLF-END', '　', ' ', '\u000b', 'k\u001c',
  '__proto__', 'constructor', '"q"', ' lead', 'trail ', '|x', '!t', '1', '{}', 'x - y',
];
const CHARS = [...'ab0 \t\n\r-_|#"\\{}[]', '　', ' ', '\u000b', '\u001c', ' ', ':', '.', '/', '😀'];
const TAG_NAMES = ['color', 'int', '!x', '名字', 'a-b', '-', '_', '{}', '|'];

function randomChars(rng: Rng, max = 6): string {
  let s = '';
  for (let n = rng.int(max + 1); n > 0; n--) s += rng.pick(CHARS);
  return s;
}

/** mode: vocab = 固定词汇;chars = 随机字符;tagged 时深度 > 0 的值有 40% 带标签 */
function randomValue(rng: Rng, mode: 'vocab' | 'chars', tagged: boolean, depth = 0): LlfValue {
  const kinds = depth < 3 ? ['str', 'null', 'map', 'list'] : ['str', 'null'];
  const kind = rng.pick(kinds);
  let v: LlfValue;
  if (kind === 'str') v = mode === 'vocab' ? rng.pick(STRINGS) : randomChars(rng);
  else if (kind === 'null') v = null;
  else if (kind === 'list') v = Array.from({ length: rng.int(5) }, () => randomValue(rng, mode, tagged, depth + 1));
  else {
    const obj: Record<string, LlfValue> = {};
    for (let n = rng.int(5); n > 0; n--) put(obj, mode === 'vocab' ? rng.pick(KEYS) : randomChars(rng), randomValue(rng, mode, tagged, depth + 1));
    v = obj;
  }
  if (tagged && depth > 0 && rng.next() < 0.4) v = new LlfTagged(rng.pick(TAG_NAMES), v);
  return v;
}

const hasCR = (v: LlfValue): boolean => JSON.stringify(llfToJson(v)).includes('\\r');

test('LLF fuzz:定长词汇 2000 组往返(严格模式;不含 CR 的也走宽松模式)', () => {
  const rng = makeRng(20260921);
  for (let i = 0; i < 2000; i++) {
    const value = randomValue(rng, 'vocab', false);
    const text = llfStringify(value);
    sameValue(llfParse(text, { strict: true }), value, `fuzz ${i}\n${text}`);
    if (!hasCR(value)) sameValue(llfParse(text), value, `fuzz ${i} 宽松\n${text}`);
  }
});

test('LLF fuzz:随机字符 3000 组往返', () => {
  const rng = makeRng(5000);
  for (let i = 0; i < 3000; i++) {
    const value = randomValue(rng, 'chars', false);
    const text = llfStringify(value);
    sameValue(llfParse(text, { strict: true }), value, `byte fuzz ${i}\n${text}`);
  }
});

test('LLF fuzz:类型标签 2000 组往返,untag 后也能往返', () => {
  const rng = makeRng(20261009);
  for (let i = 0; i < 2000; i++) {
    const value = randomValue(rng, i % 2 ? 'vocab' : 'chars', true);
    const text = llfStringify(value);
    sameValue(llfParse(text, { strict: true, tags: true }), value, `tag fuzz ${i}\n${text}`);
    const plain = llfUntag(value);
    sameValue(llfParse(llfStringify(plain), { strict: true }), plain, `tag fuzz ${i} untag`);
  }
});

test('LLF:__proto__ 等键是普通的自有键,能往返', () => {
  const v = llfParse('"__proto__" - x\nconstructor {}\n  __proto__ _\n--LLF-END\n') as Record<string, LlfValue>;
  assert.equal(Object.getPrototypeOf(v), Object.prototype);
  assert.deepEqual(Object.keys(v), ['__proto__', 'constructor']);
  assert.equal(Object.getOwnPropertyDescriptor(v, '__proto__')!.value, 'x');
  assert.deepEqual(Object.keys(v.constructor as object), ['__proto__']);
  assert.equal(llfStringify(v), '__proto__ - x\nconstructor {}\n  __proto__ _\n--LLF-END\n');
  const fromJson = JSON.parse('{"__proto__": {"a": "1"}, "b": [{"__proto__": null}]}');
  sameValue(llfParse(llfStringify(fromJson)), fromJson, 'JSON 来的 __proto__');
  sameValue(llfToJson(llfUntag(llfParse(llfStringify(fromJson)))), fromJson, 'untag / toJson 保留 __proto__');
  assert.equal(Object.getPrototypeOf(v.constructor), Object.prototype, '没有改到原型');
});

test('LLF:编码器拒绝顶层标签、嵌套标签、非法标签名和非字符串标量', () => {
  assert.throws(() => llfStringify(new LlfTagged('t', 'x')), TypeError);
  assert.throws(() => llfStringify({ a: new LlfTagged('t', new LlfTagged('u', 'x')) }), TypeError);
  assert.throws(() => llfStringify({ a: new LlfTagged('a b', 'x') }), TypeError);
  assert.throws(() => llfStringify({ a: 1 } as unknown as LlfValue), TypeError);
  assert.throws(() => llfStringify([undefined] as unknown as LlfValue), TypeError);
  assert.throws(() => llfStringify(new Map() as unknown as LlfValue), TypeError);
  assert.equal(llfStringify(Object.create(null)), '--LLF-END\n');
  assert.equal(llfStringify({ a: new LlfTagged('color', null), b: ['x'] }), 'a !color _\nb []\n  - x\n--LLF-END\n');
  assert.equal(llfStringify('x\n'), '-\n  |x\n  |\n--LLF-END\n');
});

test('LLF:LlfError 带错误码与行号;多消息里行号按每条消息自己算', () => {
  try {
    llfParse('a - x\na - y\n--LLF-END\n');
    assert.fail('应当报错');
  } catch (e) {
    assert.ok(e instanceof LlfError && e instanceof Error);
    assert.equal(e.name, 'LlfError');
    assert.equal(e.code, 'E06');
    assert.equal(e.line, 2);
    assert.match(e.message, /^E06: .*\(line 2\)$/);
  }
  try {
    llfParseMulti('a - 1\n--LLF-END\nb - 1\nb - 2\n--LLF-END\n');
    assert.fail('应当报错');
  } catch (e) {
    assert.ok(e instanceof LlfError);
    assert.equal(e.code, 'E06');
    assert.equal(e.line, 2);
  }
  assert.equal(codeOf(() => llfParse('﻿a - 1\n--LLF-END\n')), 'E01');
  assert.deepEqual(llfParse('a - 1\r\n--LLF-END\r\n'), { a: '1' });
  assert.deepEqual(llfParseMulti(''), []);
});

// ---------- 文档模型 ----------

const CONFIG = [
  '# Stars 显示设置',
  '# 改完保存即可生效',
  'title - 星罗',
  'volume !percent - 80',
  'accent !color -   #ff8800  ',
  '# 窗口位置',
  'window !rect {}',
  '  x - 0',
  '  # 宽度',
  '  width - 1280',
  'palette []',
  '  !color - #fff',
  '  # 渐变',
  '  !gradient {}',
  '    from - #000',
  '    to - #fff',
  '  - plain',
  'notes -',
  '  |第一行',
  '  |  缩进的第二行',
  '  |',
  'code !code -',
  '|#!/bin/sh',
  '|echo hi',
  '"display name" - Alice',
  'empty -',
  'nothing _',
  '# 文件末尾',
  '--LLF-END',
  '',
].join('\n');
const TAGS = { tags: true };

function lineStart(text: string, n: number): number {
  let pos = 0;
  for (let i = 0; i < n; i++) pos = text.indexOf('\n', pos) + 1;
  return pos;
}

/** 检查每个节点的位置信息都自洽 */
function checkSpans(doc: LlfDoc): void {
  const t = doc.text;
  const walk = (node: LlfNode, lo: number, hi: number): void => {
    assert.ok(node.start >= lo && node.end <= hi && node.start <= node.end, `范围嵌套 ${node.start}-${node.end} ⊄ ${lo}-${hi}`);
    if (node.indent >= 0) {
      assert.ok(node.start === 0 || t[node.start - 1] === '\n', '起点是行首');
      assert.equal(t[node.end - 1], '\n', '终点在行尾之后');
      assert.equal(node.line, t.slice(0, node.start).split('\n').length - 1, 'line 是行下标');
      assert.equal(t.slice(node.start, node.start + node.indent), ' '.repeat(node.indent));
      assert.notEqual(t[node.start + node.indent], ' ');
      const head = t.slice(node.headStart!).split(/[ \n]/, 1)[0];
      assert.equal(head, { str: '-', null: '_', map: '{}', list: '[]' }[node.kind], '头的位置');
    }
    if (node.kind === 'str') {
      const span = t.slice(node.valueStart, node.valueEnd);
      if (node.block) {
        const lines = span.slice(0, -1).split('\n').map((l) => l.replace(/^ */, ''));
        assert.ok(lines.every((l) => l.startsWith('|')));
        assert.equal(lines.map((l) => l.slice(1)).join('\n'), node.value);
        assert.equal(node.valueEnd, node.end);
      } else {
        assert.equal(span, node.value, '行内值的范围');
      }
    }
    let prev = node.indent >= 0 ? t.indexOf('\n', node.start) + 1 : node.start;
    for (const child of node.entries ?? node.items ?? []) {
      assert.equal(child.indent, node.indent + 2);
      walk(child, prev, node.end);
      prev = child.end;
    }
  };
  walk(doc.root, 0, t.length);
}

test('LLF 文档模型:位置、注释、标签、值与 llfParse 一致', () => {
  const doc = llfParseDoc(CONFIG, TAGS);
  checkSpans(doc);
  sameValue(llfDocValue(doc), llfParse(CONFIG, TAGS), '文档值');
  assert.equal(doc.text, CONFIG);
  assert.equal(doc.tags, true);
  assert.equal(doc.strict, false);
  const root = doc.root;
  assert.equal(root.kind, 'map');
  assert.equal(root.indent, -2);
  assert.equal(root.line, -1);
  assert.equal(root.end, lineStart(CONFIG, 27), '隐式顶层的 end = 最后一个条目之后');

  const title = llfFind(doc, ['title'])!;
  assert.deepEqual(title.comments, ['Stars 显示设置', '改完保存即可生效']);
  assert.equal(title.line, 2);
  assert.equal(title.start, lineStart(CONFIG, 2));

  const volume = llfFind(doc, ['volume'])!;
  assert.equal(volume.key, 'volume');
  assert.equal(volume.tag, 'percent');
  assert.equal(volume.value, '80');
  assert.equal(volume.comments, undefined);
  assert.equal(CONFIG.slice(volume.headStart, volume.end), '- 80\n');

  const accent = llfFind(doc, ['accent'])!;
  assert.equal(CONFIG.slice(accent.valueStart, accent.valueEnd), '#ff8800');

  const win = llfFind(doc, ['window'])!;
  assert.equal(win.tag, 'rect');
  assert.deepEqual(win.comments, ['窗口位置']);
  assert.equal(win.end, lineStart(CONFIG, 10));
  assert.deepEqual(llfFind(doc, ['window', 'width'])!.comments, ['宽度']);

  const gradient = llfFind(doc, ['palette', 1])!;
  assert.equal(gradient.tag, 'gradient');
  assert.equal(gradient.key, undefined);
  assert.deepEqual(gradient.comments, ['渐变']);
  assert.equal(llfFind(doc, ['palette', 1, 'to'])!.value, '#fff');

  const notes = llfFind(doc, ['notes'])!;
  assert.equal(notes.block, true);
  assert.equal(notes.value, '第一行\n  缩进的第二行\n');
  assert.equal(CONFIG.slice(notes.valueStart, notes.valueEnd), '  |第一行\n  |  缩进的第二行\n  |\n');
  assert.equal(llfFind(doc, ['code'])!.value, '#!/bin/sh\necho hi');

  assert.equal(llfFind(doc, ['display name'])!.value, 'Alice');
  const empty = llfFind(doc, ['empty'])!;
  assert.equal(empty.value, '');
  assert.equal(empty.valueStart, empty.valueEnd);
  assert.equal(llfFind(doc, ['nothing'])!.kind, 'null');

  for (const p of [['missing'], ['volume', 'x'], ['palette', 9], ['palette', 'x'], ['window', 0], ['palette', -1]]) {
    assert.equal(llfFind(doc, p), null, JSON.stringify(p));
  }
  assert.equal(llfFind(doc, []), root);
});

test('LLF 文档模型:顶层单独值、空消息、CRLF', () => {
  const single = llfParseDoc('# 结果\n[]\n  - a\n  -\n    |b\n--LLF-END\n');
  checkSpans(single);
  assert.equal(single.root.kind, 'list');
  assert.equal(single.root.indent, 0);
  assert.equal(single.root.line, 1);
  assert.deepEqual(single.root.comments, ['结果']);
  assert.deepEqual(llfDocValue(single), ['a', 'b']);

  const empty = llfParseDoc('# 只有注释\n--LLF-END');
  assert.deepEqual(empty.root.entries, []);
  assert.equal(empty.root.end, '# 只有注释\n'.length);

  const crlf = llfParseDoc('a - 1\r\nb -\r\n  |x\r\n--LLF-END\r\n');
  assert.equal(crlf.text, 'a - 1\nb -\n  |x\n--LLF-END\n');
  checkSpans(crlf);
  assert.deepEqual(llfDocValue(crlf), { a: '1', b: 'x' });

  const strict = llfParseDoc('a -\n  |x\r\n--LLF-END\n', { strict: true });
  assert.equal(llfFind(strict, ['a'])!.value, 'x\r');
});

/** b 相对 a 只有 [from, to) 这一段被换掉(断言前后缀逐字节相同) */
function assertOnlyChanged(a: string, b: string, from: number, to: number, msg = ''): void {
  assert.equal(b.slice(0, from), a.slice(0, from), `${msg} 前缀不变`);
  assert.ok(b.length >= a.length - to && b.slice(b.length - (a.length - to)) === a.slice(to), `${msg} 后缀不变`);
}

function edited(text: string, path: (string | number)[], value: string | null): string {
  const out = llfSetString(text, path, value, TAGS);
  assert.ok(out.endsWith('\n--LLF-END\n'), '结束符仍在最后');
  checkSpans(llfParseDoc(out, TAGS));
  return out;
}

test('LLF 写回:改值只动目标那一段,键、标签、注释原样保留', () => {
  const doc = llfParseDoc(CONFIG, TAGS);
  // 行内 → 行内:只换值本身
  let out = edited(CONFIG, ['volume'], '90');
  assert.equal(out, CONFIG.replace('volume !percent - 80', 'volume !percent - 90'));
  out = edited(CONFIG, ['accent'], '#000000');
  assert.equal(out, CONFIG.replace('accent !color -   #ff8800  ', 'accent !color -   #000000  '));
  out = edited(CONFIG, ['palette', 1, 'to'], 'x - y');
  assert.equal(out, CONFIG.replace('    to - #fff', '    to - x - y'));
  assert.equal((llfUntag(llfParse(out, TAGS)) as any).palette[1].to, 'x - y');

  // 看起来像结构的内容仍然安全
  for (const v of ['--LLF-END', '|z', '# not comment', '- -', '{}', '"q"', '!t - v', '--LLF-BEGIN']) {
    out = edited(CONFIG, ['title'], v);
    const title = llfFind(doc, ['title'])!;
    assertOnlyChanged(CONFIG, out, title.valueStart!, title.valueEnd!, v);
    assert.equal((llfParse(out, TAGS) as any).title, v);
  }

  // 行内 → 文本块(含换行 / 首尾空白)
  out = edited(CONFIG, ['title'], 'two\nlines');
  assert.equal(out, CONFIG.replace('title - 星罗\n', 'title -\n  |two\n  |lines\n'));
  out = edited(CONFIG, ['window', 'x'], ' padded ');
  assert.equal(out, CONFIG.replace('  x - 0\n', '  x -\n    | padded \n'));
  out = edited(CONFIG, ['volume'], 'x\n');
  assert.equal(out, CONFIG.replace('volume !percent - 80\n', 'volume !percent -\n  |x\n  |\n'));

  // 文本块 → 行内;文本块 → 文本块沿用原来 `|` 的缩进
  out = edited(CONFIG, ['notes'], 'single line');
  assert.equal(out, CONFIG.replace('notes -\n  |第一行\n  |  缩进的第二行\n  |\n', 'notes - single line\n'));
  out = edited(CONFIG, ['code'], 'echo bye\n');
  assert.equal(out, CONFIG.replace('|#!/bin/sh\n|echo hi\n', '|echo bye\n|\n'));
  assert.equal((llfParse(out, TAGS) as any).code.value, 'echo bye\n');

  // 空值、null、空串
  out = edited(CONFIG, ['empty'], 'filled');
  assert.equal(out, CONFIG.replace('empty -\n', 'empty - filled\n'));
  out = edited(CONFIG, ['nothing'], 'now set');
  assert.equal(out, CONFIG.replace('nothing _\n', 'nothing - now set\n'));
  out = edited(CONFIG, ['title'], null);
  assert.equal(out, CONFIG.replace('title - 星罗\n', 'title _\n'));
  out = edited(CONFIG, ['volume'], '');
  assert.equal(out, CONFIG.replace('volume !percent - 80\n', 'volume !percent -\n'));

  // 引号键保留引号;整棵子树换成字符串时子层(含其中的注释)一起替换
  out = edited(CONFIG, ['display name'], 'Bob');
  assert.equal(out, CONFIG.replace('"display name" - Alice', '"display name" - Bob'));
  out = edited(CONFIG, ['window'], 'flat');
  assert.equal(out, CONFIG.replace('window !rect {}\n  x - 0\n  # 宽度\n  width - 1280\n', 'window !rect - flat\n'));
  assert.deepEqual((llfParse(out, TAGS) as any).window, new LlfTagged('rect', 'flat'));
});

test('LLF 写回:缺的键追加在父字典末尾,缺的中间层建成 {}', () => {
  let out = edited(CONFIG, ['window', 'height'], '720');
  assert.equal(out, CONFIG.replace('  width - 1280\n', '  width - 1280\n  height - 720\n'));
  out = edited(CONFIG, ['window', 'pos', 'x'], '5');
  assert.equal(out, CONFIG.replace('  width - 1280\n', '  width - 1280\n  pos {}\n    x - 5\n'));
  out = edited(CONFIG, ['new', 'deep', 'key'], 'a\nb');
  assert.equal(out, CONFIG.replace('nothing _\n', 'nothing _\nnew {}\n  deep {}\n    key -\n      |a\n      |b\n'));
  out = edited(CONFIG, ['palette', 1, 'mid'], '#888');
  assert.equal(out, CONFIG.replace('    to - #fff\n', '    to - #fff\n    mid - #888\n'));
  out = edited(CONFIG, ['palette', 3], 'appended');
  assert.equal(out, CONFIG.replace('  - plain\n', '  - plain\n  - appended\n'));
  out = edited(CONFIG, ['palette', 3, 'k'], 'v');
  assert.equal(out, CONFIG.replace('  - plain\n', '  - plain\n  {}\n    k - v\n'));
  out = edited(CONFIG, ['list', 0], 'first');
  assert.equal(out, CONFIG.replace('nothing _\n', 'nothing _\nlist []\n  - first\n'));
  // 需要引号的新键
  out = edited(CONFIG, ['a b', '-', ''], null);
  assert.equal(out, CONFIG.replace('nothing _\n', 'nothing _\n"a b" {}\n  "-" {}\n    "" _\n'));
  sameValue((llfUntag(llfParse(out, TAGS)) as any)['a b'], { '-': { '': null } }, '引号键');

  // 空消息 / 只有注释 / 结束符后没有换行 / CRLF
  assert.equal(llfSetString('--LLF-END\n', ['a'], '1'), 'a - 1\n--LLF-END\n');
  assert.equal(llfSetString('# hi\n--LLF-END\n', ['a'], '1'), '# hi\na - 1\n--LLF-END\n');
  assert.equal(llfSetString('a - 1\n--LLF-END', ['b'], '2'), 'a - 1\nb - 2\n--LLF-END');
  assert.equal(llfSetString('a - 1\r\n--LLF-END\r\n', ['a'], '2'), 'a - 2\n--LLF-END\n');
  assert.equal(llfSetString('e {}\n# c\nf - 1\n--LLF-END\n', ['e', 'k'], 'v'), 'e {}\n  k - v\n# c\nf - 1\n--LLF-END\n');
  const proto = llfSetString('--LLF-END\n', ['__proto__'], 'x');
  assert.equal(proto, '__proto__ - x\n--LLF-END\n');
  assert.deepEqual(Object.keys(llfParse(proto) as object), ['__proto__']);

  // 顶层单独值
  assert.equal(llfSetString('# r\n- 3\n--LLF-END\n', [], 'x\ny'), '# r\n-\n  |x\n  |y\n--LLF-END\n');
  assert.equal(llfSetString('[]\n  - a\n--LLF-END\n', [1], 'b'), '[]\n  - a\n  - b\n--LLF-END\n');
});

test('LLF 写回:路径错误抛 EPATH,解析错误照常抛格式错误码', () => {
  const epath = (fn: () => unknown) => assert.equal(codeOf(fn), 'EPATH');
  epath(() => llfSetString(CONFIG, ['volume', 'x'], 'v', TAGS));
  epath(() => llfSetString(CONFIG, ['nothing', 'x'], 'v', TAGS));
  epath(() => llfSetString(CONFIG, ['palette', 'x'], 'v', TAGS));
  epath(() => llfSetString(CONFIG, ['palette', 5], 'v', TAGS));
  epath(() => llfSetString(CONFIG, ['palette', -1], 'v', TAGS));
  epath(() => llfSetString(CONFIG, ['window', 0], 'v', TAGS));
  epath(() => llfSetString(CONFIG, ['new', 1], 'v', TAGS));
  epath(() => llfSetString(CONFIG, [], 'v', TAGS));
  epath(() => llfDelete(CONFIG, [], TAGS));
  epath(() => llfDelete(CONFIG, ['volume', 'x'], TAGS));
  assert.equal(codeOf(() => llfSetString(CONFIG, ['title'], 'x')), 'E07', '带标签的文件不开 tags 会报 E07');
  assert.equal(codeOf(() => llfSetString('a - 1\n', ['a'], 'x')), 'E02');
});

test('LLF 写回:删除连同子层、文本块和紧贴的注释', () => {
  const del = (path: (string | number)[]) => {
    const out = llfDelete(CONFIG, path, TAGS);
    assert.ok(out.endsWith('\n--LLF-END\n'));
    checkSpans(llfParseDoc(out, TAGS));
    return out;
  };
  assert.equal(del(['window']), CONFIG.replace('# 窗口位置\nwindow !rect {}\n  x - 0\n  # 宽度\n  width - 1280\n', ''));
  assert.equal(del(['window', 'width']), CONFIG.replace('  # 宽度\n  width - 1280\n', ''));
  assert.equal(del(['palette', 1]), CONFIG.replace('  # 渐变\n  !gradient {}\n    from - #000\n    to - #fff\n', ''));
  assert.equal(del(['notes']), CONFIG.replace('notes -\n  |第一行\n  |  缩进的第二行\n  |\n', ''));
  assert.equal(del(['title']), CONFIG.replace('# Stars 显示设置\n# 改完保存即可生效\ntitle - 星罗\n', ''));
  assert.equal(del(['nothing']), CONFIG.replace('nothing _\n', ''), '后面的注释不属于它');
  assert.equal(del(['missing']), CONFIG);
  assert.equal(del(['palette', 7]), CONFIG);
  const v = llfUntag(llfParse(del(['palette', 0]), TAGS)) as any;
  assert.equal(v.palette.length, 2);
  assert.equal(llfDelete('a - 1\r\n--LLF-END\r\n', ['a']), '--LLF-END\n');
});

// ---------- 写回 fuzz ----------

type Path = (string | number)[];
const unwrap = (v: LlfValue): LlfValue => (v instanceof LlfTagged ? v.value : v);
const isMap = (v: LlfValue): v is Record<string, LlfValue> => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof LlfTagged);
// Unicode White_Space(SPEC §4),与 JS 的 trim 不完全相同
const WS = '[\\t-\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const WS_EDGE = new RegExp(`^${WS}|${WS}$`);
const inlineOk = (s: string): boolean => s !== '' && !s.includes('\n') && !WS_EDGE.test(s);

function clone(v: LlfValue): LlfValue {
  if (v instanceof LlfTagged) return new LlfTagged(v.tag, clone(v.value));
  if (Array.isArray(v)) return v.map(clone);
  if (isMap(v)) {
    const o: Record<string, LlfValue> = {};
    for (const k of Object.keys(v)) put(o, k, clone(v[k]));
    return o;
  }
  return v;
}

function getAt(v: LlfValue, path: Path): LlfValue {
  let cur = v;
  for (const seg of path) cur = (unwrap(cur) as any)[seg];
  return cur;
}

function allPaths(v: LlfValue, prefix: Path = [], out: Path[] = []): Path[] {
  out.push(prefix);
  const u = unwrap(v);
  if (Array.isArray(u)) u.forEach((x, i) => allPaths(x, [...prefix, i], out));
  else if (isMap(u)) for (const k of Object.keys(u)) allPaths(u[k], [...prefix, k], out);
  return out;
}

/** 在纯值上做与 llfSetString 相同的修改:保留原有标签,缺的中间层按下一段的类型建 {} / [] */
function setPath(root: LlfValue, path: Path, value: string | null): LlfValue {
  if (path.length === 0) return value;
  let cur = unwrap(root) as Record<string, LlfValue> | LlfValue[];
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    const last = i === path.length - 1;
    const old = Array.isArray(cur) ? cur[seg as number] : Object.hasOwn(cur, seg) ? cur[seg as string] : undefined;
    let next: LlfValue;
    if (last) next = old instanceof LlfTagged ? new LlfTagged(old.tag, value) : value;
    else next = old !== undefined ? old : typeof path[i + 1] === 'string' ? {} : [];
    if (Array.isArray(cur)) cur[seg as number] = next;
    else put(cur, seg as string, next);
    if (!last) cur = unwrap(next) as Record<string, LlfValue> | LlfValue[];
  }
  return root;
}

function deletePath(root: LlfValue, path: Path): LlfValue {
  const parent = unwrap(getAt(root, path.slice(0, -1))) as any;
  const seg = path[path.length - 1];
  if (Array.isArray(parent)) parent.splice(seg as number, 1);
  else delete parent[seg];
  return root;
}

const NASTY = [
  '-', '_', '{}', '[]', '|x', '#x', '--LLF-END', '--LLF-BEGIN', ' lead', 'trail ', 'a\nb', '', '名字😀', '"q"', 'x - y',
  '\n', 'x\n', '　x', 'a\tb', '!t - v', '  |z', '# c', 'k - v', 'a\r\nb', 'x\r', 'plain', '80',
];

/** 给编码结果加点手写的样子:随机注释(缩进随意)、文本行缩进随意、结构行尾部空格 */
function decorate(rng: Rng, text: string): string {
  const out: string[] = [];
  for (const line of text.split('\n').slice(0, -2)) {
    const isText = /^ *\|/.test(line);
    if (!isText && rng.next() < 0.25) out.push(' '.repeat(rng.int(7)) + rng.pick(['# c', '#', '#  x', '## y', '# |not text', '# - x', '# --LLF-END']));
    if (isText) out.push(' '.repeat(rng.int(9)) + line.replace(/^ */, ''));
    else out.push(rng.next() < 0.15 ? line + ' '.repeat(1 + rng.int(3)) : line);
  }
  if (rng.next() < 0.3) out.push('# tail');
  out.push('--LLF-END', '');
  return out.join('\n');
}

test('LLF 写回 fuzz:随机文档 × 随机路径的改 / 加 / 删,重新解析等于在值上做同样的修改,其余字节不变', () => {
  const rng = makeRng(424242);
  const counts = { set: 0, add: 0, del: 0 };
  for (let i = 0; i < 5000; i++) {
    const tags = i % 2 === 0;
    const value = randomValue(rng, i % 4 === 1 ? 'chars' : 'vocab', tags);
    // 宽松模式表示不了行尾 CR(SPEC §2),含 CR 的值走严格模式
    const strict = i % 3 === 0 || hasCR(value);
    const opts = { strict, tags };
    const text = decorate(rng, llfStringify(value));
    const ctx = `case ${i} ${JSON.stringify(opts)}\n${text}`;
    sameValue(llfParse(text, opts), value, `装饰后的文档 ${ctx}`);
    const doc = llfParseDoc(text, opts);
    checkSpans(doc);

    let nv: string | null = rng.next() < 0.1 ? null : rng.next() < 0.7 ? rng.pick(NASTY) : randomChars(rng);
    if (!strict && nv !== null) nv = nv.replaceAll('\r', '');
    const paths = allPaths(value);
    // 隐式顶层字典不能整体替换;顶层单独值可以(路径 [])
    const settable = isMap(value) ? paths.slice(1) : paths;
    const containers = paths.filter((p) => {
      const u = unwrap(getAt(value, p));
      return Array.isArray(u) || isMap(u);
    });
    const op = rng.int(3);
    let out: string;
    let expected: LlfValue;
    let what: string;

    if (op === 0 && settable.length) {
      const path = rng.pick(settable);
      const node = llfFind(doc, path)!;
      out = llfSetString(text, path, nv, opts);
      what = `set ${JSON.stringify(path)} = ${JSON.stringify(nv)}`;
      assertOnlyChanged(text, out, node.headStart!, node.end, what);
      if (nv !== null && node.kind === 'str' && !node.block && node.value !== '' && inlineOk(nv)) {
        assert.equal(out, text.slice(0, node.valueStart) + nv + text.slice(node.valueEnd), `行内只换值本身 ${what}`);
      }
      expected = setPath(clone(value), path, nv);
      counts.set++;
    } else if (op === 1 && containers.length) {
      // 加新键 / 追加列表项,可能再带几层缺失的中间层
      const parentPath = rng.pick(containers);
      const parent = unwrap(getAt(value, parentPath));
      const first = Array.isArray(parent) ? parent.length : rng.pick([...KEYS, 'fresh', 'new key']);
      if (isMap(parent) && Object.hasOwn(parent, first)) continue;
      const path: Path = [...parentPath, first];
      for (let n = rng.int(3); n > 0; n--) path.push(rng.next() < 0.8 ? rng.pick(['x', 'y z', '-', '']) : 0);
      const parentNode = llfFind(doc, parentPath)!;
      out = llfSetString(text, path, nv, opts);
      what = `add ${JSON.stringify(path)} = ${JSON.stringify(nv)}`;
      assertOnlyChanged(text, out, parentNode.end, parentNode.end, what);
      expected = setPath(clone(value), path, nv);
      counts.add++;
    } else if (paths.length > 1) {
      const path = rng.pick(paths.slice(1));
      const node = llfFind(doc, path)!;
      out = llfDelete(text, path, opts);
      what = `delete ${JSON.stringify(path)}`;
      // 删掉的是 [from, node.end):节点本身,加上它上方紧贴的注释行
      const from = node.end - (text.length - out.length);
      assertOnlyChanged(text, out, from, node.end, what);
      assert.ok(from <= node.start, what);
      assert.ok(text.slice(from, node.start).split('\n').slice(0, -1).every((l) => /^ *#/.test(l)), `只多删了注释 ${what}`);
      if (from > 0) assert.doesNotMatch(text.slice(text.lastIndexOf('\n', from - 2) + 1, from), /^ *#/, `紧贴的注释都删掉了 ${what}`);
      expected = deletePath(clone(value), path);
      counts.del++;
    } else {
      continue;
    }
    assert.ok(out.endsWith('--LLF-END\n'), `结束符仍在最后 ${what}`);
    sameValue(llfParse(out, opts), expected, `${what} ${ctx}\n→\n${out}`);
    checkSpans(llfParseDoc(out, opts));
  }
  assert.ok(counts.set > 1000 && counts.add > 500 && counts.del > 500, `各类操作都要覆盖到:${JSON.stringify(counts)}`);
});
