import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jsoncDelete, jsoncInsert, jsoncParse, jsoncSet, type JsoncNode } from '../src/jsonc.ts';
import { tomlDelete, tomlInsert, tomlParse, tomlSet, type TomlNode } from '../src/toml.ts';

const PKG = `{
  // 包名
  // 发到 npm 上用的
  "name": "stars",
  "version": "0.1.0", // 行尾的注释属于这一项

  // 隔着空行的注释不属于任何一项

  "private": true,
  "n": 3,
  "nil": null,
  "deps": {
    "a": "^1"
  },
  "list": [1, 2, 3],
  "empty": {},
  "multi": [
    "x",
    "y",
  ],
}
`;

test('JSON 表单:解析成和 LLF 同形的树;紧挨在上方的注释属于这一项,隔着空行的不算;认尾逗号', () => {
  const r = jsoncParse(PKG);
  assert.deepEqual(r.entries!.map((e) => [e.key, e.kind, e.type, e.value ?? null]), [
    ['name', 'str', 'string', 'stars'], ['version', 'str', 'string', '0.1.0'], ['private', 'str', 'bool', 'true'], ['n', 'str', 'number', '3'],
    ['nil', 'null', 'null', null], ['deps', 'map', 'object', null], ['list', 'list', 'array', null], ['empty', 'map', 'object', null], ['multi', 'list', 'array', null],
  ]);
  assert.deepEqual(r.entries![0]!.comments, ['包名', '发到 npm 上用的']);
  assert.equal(r.entries![2]!.comments, undefined, '隔着空行');
  assert.deepEqual(r.entries!.map((e) => e.tag ?? ''), ['', '', 'bool', 'number', '', '', '', '', '']);
  assert.equal(jsoncParse('"#ff8800"').tag, 'color');
  assert.equal(jsoncParse('"a\\nb"').block, true);
  for (const [bad, msg] of [['', /空/], ['{', /缺少 \}/], ['{"a" 1}', /冒号/], ['{"a":1 "b":2}', /逗号/], ['{a:1}', /双引号/], ['[1] x', /多余/], ['"\\q"', /转义/], ['/* x', /注释/]] as const) {
    assert.throws(() => jsoncParse(bad), msg, bad);
  }
});

test('JSON 表单:按路径改、加、删,只动那一段 —— 注释、缩进、逗号风格都跟着原来的', () => {
  const diff = (a: string, b: string) => { const x = a.split('\n'), y = b.split('\n'); let i = 0; while (x[i] === y[i]) i++; let j = 0; while (j < x.length - i && x[x.length - 1 - j] === y[y.length - 1 - j]) j++; return [x.slice(i, x.length - j), y.slice(i, y.length - j)]; };
  assert.deepEqual(diff(PKG, jsoncSet(PKG, ['name'], 'a "q"')), [['  "name": "stars",'], ['  "name": "a \\"q\\"",']]);
  assert.deepEqual(diff(PKG, jsoncSet(PKG, ['n'], ' 4.5e3 ')), [['  "n": 3,'], ['  "n": 4.5e3,']], '数字照原样写,不加引号');
  assert.throws(() => jsoncSet(PKG, ['n'], 'abc'), /不是数字/);
  assert.deepEqual(diff(PKG, jsoncSet(PKG, ['nil'], 'hi')), [['  "nil": null,'], ['  "nil": "hi",']], 'null 填了字就成字符串');
  assert.deepEqual(diff(PKG, jsoncSet(PKG, ['nil'], '12')), [['  "nil": null,'], ['  "nil": 12,']], '…能当数字读就是数字');
  assert.deepEqual(diff(PKG, jsoncSet(PKG, ['list', 1], '20')), [['  "list": [1, 2, 3],'], ['  "list": [1, 20, 3],']]);
  assert.deepEqual(diff(PKG, jsoncDelete(PKG, ['name'])), [['  // 包名', '  // 发到 npm 上用的', '  "name": "stars",'], []], '连同它的注释');
  assert.deepEqual(diff(PKG, jsoncDelete(PKG, ['version'])), [['  "version": "0.1.0", // 行尾的注释属于这一项'], []]);
  assert.deepEqual(diff(PKG, jsoncDelete(PKG, ['deps', 'a'])), [['  "deps": {', '    "a": "^1"', '  },'], ['  "deps": {},']], '删空了收成 {}');
  assert.deepEqual(diff(PKG, jsoncDelete(PKG, ['list', 2])), [['  "list": [1, 2, 3],'], ['  "list": [1, 2],']]);
  assert.deepEqual(diff(PKG, jsoncDelete(PKG, ['list', 0])), [['  "list": [1, 2, 3],'], ['  "list": [2, 3],']]);
  assert.deepEqual(diff(PKG, jsoncDelete(PKG, ['multi', 1])), [['    "y",'], []], '尾逗号风格:直接删掉那一行');
  assert.deepEqual(diff(PKG, jsoncInsert(PKG, ['deps'], 'b', '"^2"')), [['    "a": "^1"'], ['    "a": "^1",', '    "b": "^2"']]);
  assert.deepEqual(diff(PKG, jsoncInsert(PKG, ['empty'], 'k', '0')), [['  "empty": {},'], ['  "empty": {', '    "k": 0', '  },']], '空对象跟着外层分行');
  assert.deepEqual(diff(PKG, jsoncInsert(PKG, ['list'], undefined, '4')), [['  "list": [1, 2, 3],'], ['  "list": [1, 2, 3, 4],']]);
  assert.ok(jsoncInsert(PKG, ['multi'], undefined, '"z"').includes('    "y",\n    "z",\n  ],'), '尾逗号风格:新的一项也带逗号');
  assert.throws(() => jsoncInsert(PKG, ['deps'], 'a', '1'), /已经有/);
  const compact = '{"a":1,"b":[1,2]}';
  assert.equal(jsoncInsert(compact, [], 'c', 'true'), '{"a":1,"b":[1,2],"c":true}', '紧凑的写法加进去也是紧凑的');
  assert.equal(jsoncInsert(compact, ['b'], undefined, '3'), '{"a":1,"b":[1,2,3]}');
  assert.equal(jsoncDelete(compact, ['b']), '{"a":1}');
  assert.equal(jsoncInsert('[]', [], undefined, '""'), '[""]');
  assert.equal(jsoncInsert('{}', [], 'k', '1'), '{\n  "k": 1\n}');
});

test('JSON 表单:随机的改动 —— 结果仍是合法 JSON,值和直接改对象一样', () => {
  let seed = 11;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const gen = (d: number): unknown => {
    const r = rnd();
    if (d > 2 || r < 0.4) return pick([1, -2.5, 'a', 'x "y"', true, false, null, '星']);
    if (r < 0.7) return Array.from({ length: Math.floor(rnd() * 4) }, () => gen(d + 1));
    return Object.fromEntries(Array.from({ length: Math.floor(rnd() * 4) }, (_, i) => ['k' + i, gen(d + 1)]));
  };
  const paths = (v: unknown, p: (string | number)[] = []): (string | number)[][] => {
    const out = [p];
    if (Array.isArray(v)) v.forEach((x, i) => out.push(...paths(x, [...p, i])));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) out.push(...paths(x, [...p, k]));
    return out;
  };
  const at = (v: any, p: (string | number)[]) => p.reduce((x, k) => x[k], v);
  for (let n = 0; n < 400; n++) {
    const v = { root: gen(0) };
    let text = JSON.stringify(v, null, pick([0, 2, '\t']));
    const want = structuredClone(v) as any;
    const ps = paths(v).filter((p) => p.length);
    const p = pick(ps), parent = at(want, p.slice(0, -1)), last = p[p.length - 1]!, target = at(want, p);
    const r = rnd();
    if (r < 0.35) {
      text = jsoncDelete(text, p);
      if (Array.isArray(parent)) parent.splice(last as number, 1); else delete parent[last];
    } else if (r < 0.7 && target && typeof target === 'object') {
      if (Array.isArray(target)) { text = jsoncInsert(text, p, undefined, '"新"'); target.push('新'); }
      else { const k = 'new' + n; text = jsoncInsert(text, p, k, '[0]'); target[k] = [0]; }
    } else if (target === null || typeof target !== 'object') {
      const node = (jsoncParse(text) && (p.reduce<JsoncNode | undefined>((x, k) => (x!.kind === 'map' ? x!.entries!.find((e) => e.key === k) : x!.items![k as number]), jsoncParse(text))))!;
      const nv = node.type === 'number' ? '7' : node.type === 'bool' ? 'false' : node.type === 'null' ? 'null' : 'z\n"';
      text = jsoncSet(text, p, nv);
      parent[last] = node.type === 'number' ? 7 : node.type === 'bool' ? false : node.type === 'null' ? null : 'z\n"';
    } else continue;
    assert.deepEqual(JSON.parse(text), want, text);
  }
});

const CARGO = `# 文件头注释

title = "示例" # 行尾
# 作者
owner.name = 'Tom'
owner.dob = 1979-05-27T07:32:00-08:00
ports = [ 8000, 8001, 8002 ]
data = [
  "a", # 第一
  "b",
]
inline = { x = 1, y = "two" }
multi = """
第一行
第二行"""
hex = 0xff

# 数据库
[database]
enabled = true

[servers.alpha]
ip = "10.0.0.1"

[[products]]
name = "Hammer"

[[products]]
name = "Nail"

[products.extra]
color = "gray"

[empty]
`;

test('TOML 表单:表头、数组表、点号键、内联表、各种值都解析成同一种树,记着每张表是怎么来的', () => {
  const r = tomlParse(CARGO);
  const flat = (n: TomlNode, p = ''): string[] => (n.entries ?? n.items ?? []).flatMap((e, i) => {
    const q = p + (e.key ?? `#${i}`);
    return [`${q}:${e.type}:${e.def}${e.value !== undefined ? '=' + e.value : ''}`, ...flat(e, q + '.')];
  });
  assert.deepEqual(flat(r), [
    'title:string:value=示例', 'owner:table:dotted', 'owner.name:string:value=Tom', 'owner.dob:datetime:value=1979-05-27T07:32:00-08:00',
    'ports:array:value', 'ports.#0:integer:value=8000', 'ports.#1:integer:value=8001', 'ports.#2:integer:value=8002',
    'data:array:value', 'data.#0:string:value=a', 'data.#1:string:value=b',
    'inline:table:inline', 'inline.x:integer:value=1', 'inline.y:string:value=two', 'multi:string:value=第一行\n第二行', 'hex:integer:value=0xff',
    'database:table:header', 'database.enabled:bool:value=true',
    'servers:table:implicit', 'servers.alpha:table:header', 'servers.alpha.ip:string:value=10.0.0.1',
    'products:array:aotList', 'products.#0:table:aot', 'products.#0.name:string:value=Hammer', 'products.#1:table:aot', 'products.#1.name:string:value=Nail',
    'products.#1.extra:table:header', 'products.#1.extra.color:string:value=gray', 'empty:table:header',
  ]);
  assert.deepEqual(r.entries!.find((e) => e.key === 'database')!.comments, ['数据库']);
  assert.equal(r.entries![0]!.comments, undefined, '文件头的注释隔着空行,不属于 title');
  assert.equal(r.entries!.find((e) => e.key === 'hex')!.tag, undefined, '0xff 不用数字框(浏览器的数字框认不出)');
  for (const [bad, msg] of [['a = ', /缺少值/], ['a = 1\na = 2', /重复的键/], ['[a]\n[a]', /重复定义/], ['a = "x', /没有结束/], ['a = 1 b', /不该是/], ['a.b = 1\n[a.b]', /重复定义/], ['x = [1, 2', /缺少 \]/]] as const) {
    assert.throws(() => tomlParse(bad), msg, bad);
  }
});

test('TOML 表单:改值保持引号风格;删一项删掉定义它的行 / 段 / 括号里的项;加一项按这张表是怎么来的放在对的地方', () => {
  const diff = (a: string, b: string) => { const x = a.split('\n'), y = b.split('\n'); let i = 0; while (x[i] === y[i]) i++; let j = 0; while (j < x.length - i && x[x.length - 1 - j] === y[y.length - 1 - j]) j++; return [x.slice(i, x.length - j), y.slice(i, y.length - j)]; };
  assert.deepEqual(diff(CARGO, tomlSet(CARGO, ['title'], '新"标题')), [['title = "示例" # 行尾'], ['title = "新\\"标题" # 行尾']]);
  assert.deepEqual(diff(CARGO, tomlSet(CARGO, ['owner', 'name'], 'Ann')), [["owner.name = 'Tom'"], ["owner.name = 'Ann'"]], '单引号还是单引号');
  assert.deepEqual(diff(CARGO, tomlSet(CARGO, ['owner', 'name'], "O'Neil")), [["owner.name = 'Tom'"], ['owner.name = "O\'Neil"']], '放不进单引号就换双引号');
  assert.deepEqual(diff(CARGO, tomlSet(CARGO, ['multi'], 'a\nb\\c')), [['第一行', '第二行"""'], ['a', 'b\\\\c"""']], '多行字符串还是多行');
  assert.deepEqual(diff(CARGO, tomlSet(CARGO, ['ports', 1], '9000')), [['ports = [ 8000, 8001, 8002 ]'], ['ports = [ 8000, 9000, 8002 ]']]);
  assert.deepEqual(diff(CARGO, tomlSet(CARGO, ['inline', 'y'], 'three')), [['inline = { x = 1, y = "two" }'], ['inline = { x = 1, y = "three" }']]);
  assert.throws(() => tomlSet(CARGO, ['hex'], 'abc'), /不是数字/);
  assert.throws(() => tomlSet(CARGO, ['owner', 'dob'], 'tomorrow'), /日期/);

  assert.deepEqual(diff(CARGO, tomlDelete(CARGO, ['owner'])), [['# 作者', "owner.name = 'Tom'", 'owner.dob = 1979-05-27T07:32:00-08:00'], []], '点号键带出来的表:删掉那几行,连同注释');
  assert.ok(tomlDelete(CARGO, ['database']).includes('hex = 0xff\n\n[servers.alpha]'), '一整段,连同上方的注释');
  assert.ok(tomlDelete(CARGO, ['servers']).includes('[database]\nenabled = true\n\n[[products]]'), '只出现在别的表头里的表:删掉它下面的每一段');
  assert.ok(tomlDelete(CARGO, ['products', 1]).includes('name = "Hammer"\n\n[empty]'), '数组表的一张,连同它的子表');
  assert.ok(tomlDelete(CARGO, ['products', 0]).includes('[[products]]\nname = "Nail"') && !tomlDelete(CARGO, ['products', 0]).includes('Hammer'), '只删第一张');
  assert.deepEqual(diff(CARGO, tomlDelete(CARGO, ['data', 0])), [['  "a", # 第一'], []]);
  assert.deepEqual(diff(CARGO, tomlDelete(CARGO, ['inline', 'x'])), [['inline = { x = 1, y = "two" }'], ['inline = { y = "two" }']]);
  assert.equal(tomlDelete('t = { a.x = 1, b = 2, a.y = 3 }\n', ['t', 'a']), 't = { b = 2 }\n', '内联表里点号键带出来的表:删掉定义它的每个成员');
  assert.ok(tomlDelete(CARGO, ['empty']).endsWith('color = "gray"\n'), '删到文件末尾:多出来的空行也收掉');

  assert.deepEqual(diff(CARGO, tomlInsert(CARGO, [], 'k', '""')), [[], ['k = ""']], '顶层:接在最后一个顶层键值后面');
  assert.ok(tomlInsert(CARGO, [], 'k', '""').includes('hex = 0xff\nk = ""\n'));
  assert.ok(tomlInsert(CARGO, ['owner'], 'email', '"a@b"').includes("owner.dob = 1979-05-27T07:32:00-08:00\nowner.email = \"a@b\"\n"), '点号键的表:同样用点号写');
  assert.ok(tomlInsert(CARGO, ['database'], 'port', '5432').includes('enabled = true\nport = 5432\n'));
  assert.ok(tomlInsert(CARGO, ['servers'], 'region', '"eu"').includes('[servers]\nregion = "eu"\n\n[servers.alpha]'), '补上它自己的表头');
  assert.ok(tomlInsert(CARGO, ['products'], undefined, '{}').includes('color = "gray"\n\n[[products]]\n\n[empty]'), '数组表:加一段 [[…]]');
  assert.ok(tomlInsert(CARGO, ['products', 0], 'price', '1.5').includes('name = "Hammer"\nprice = 1.5\n'));
  assert.ok(tomlInsert(CARGO, ['empty'], 'k', 'true').endsWith('[empty]\nk = true\n'));
  assert.ok(tomlInsert(CARGO, ['inline'], 'z', '[]').includes('inline = { x = 1, y = "two", z = [] }'));
  assert.ok(tomlInsert(CARGO, ['data'], undefined, '"c"').includes('  "b",\n  "c",\n]'));
  assert.equal(tomlInsert('', [], 'a', '1'), 'a = 1\n');
  assert.equal(tomlInsert('[x]\n', [], 'a', '1'), 'a = 1\n\n[x]\n', '还没有顶层键值:放在第一个表头前面');
  assert.equal(tomlInsert('e = {}', ['e'], 'k', '1'), 'e = { k = 1 }');
  assert.equal(tomlInsert('[x]\na = 1', ['x'], 'b', '2'), '[x]\na = 1\nb = 2\n', '最后一行没有换行');
  assert.equal(tomlInsert('a = 1\n', [], 'b c', '2'), 'a = 1\n"b c" = 2\n', '裸写不了的键加引号');
  // 每一种改动之后都还是合法的 TOML
  for (const t of [tomlInsert(CARGO, ['servers'], 'region', '"eu"'), tomlInsert(CARGO, ['products'], undefined, '{}'), tomlDelete(CARGO, ['servers', 'alpha'])]) tomlParse(t);
});

test('TOML 表单:随机的改动 —— 结果仍是合法 TOML,值和直接改对象一样', () => {
  let seed = 5;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const isAot = (v: unknown): v is Record<string, unknown>[] => Array.isArray(v) && v.length > 0 && v.every(isObj);
  const gen = (d: number): Record<string, unknown> => Object.fromEntries(Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, i) => {
    const r = rnd();
    const v = d > 2 || r < 0.45 ? pick<unknown>([1, 'a', true, 'b c', -3])
      : r < 0.6 ? Array.from({ length: Math.floor(rnd() * 3) }, () => pick([1, 2, 'x']))
        : r < 0.85 ? gen(d + 1) : Array.from({ length: 1 + Math.floor(rnd() * 2) }, () => gen(d + 1));
    return ['k' + i, v];
  }));
  const lit = (v: unknown): string => (Array.isArray(v) ? `[${v.map(lit).join(', ')}]` : typeof v === 'string' ? JSON.stringify(v) : String(v));
  const ser = (o: Record<string, unknown>, path: string[]): string => {
    let out = Object.entries(o).filter(([, v]) => !isObj(v) && !isAot(v)).map(([k, v]) => `${k} = ${lit(v)}\n`).join('');
    for (const [k, v] of Object.entries(o)) {
      if (isObj(v)) out += `\n[${[...path, k].join('.')}]\n` + ser(v, [...path, k]);
      else if (isAot(v)) for (const el of v) out += `\n[[${[...path, k].join('.')}]]\n` + ser(el, [...path, k]);
    }
    return out;
  };
  const val = (n: TomlNode): unknown => n.kind === 'map' ? Object.fromEntries(n.entries!.map((e) => [e.key, val(e)])) : n.kind === 'list' ? n.items!.map(val)
    : n.type === 'integer' ? Number(n.value) : n.type === 'bool' ? n.value === 'true' : n.value;
  const paths = (v: unknown, p: (string | number)[] = []): (string | number)[][] => {
    const out = [p];
    if (Array.isArray(v)) v.forEach((x, i) => out.push(...paths(x, [...p, i])));
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) out.push(...paths(x, [...p, k]));
    return out;
  };
  const at = (v: any, p: (string | number)[]) => p.reduce((x, k) => x[k], v);
  for (let n = 0; n < 400; n++) {
    const v = gen(0);
    let text = ser(v, []);
    assert.deepEqual(val(tomlParse(text)), v, text);
    const want = structuredClone(v) as any;
    const p = pick(paths(v).filter((x) => x.length)), parent = at(want, p.slice(0, -1)), last = p[p.length - 1]!, target = at(want, p);
    const r = rnd();
    if (r < 0.4) {
      text = tomlDelete(text, p);
      if (Array.isArray(parent)) parent.splice(last as number, 1); else delete parent[last];
      if (Array.isArray(parent) && !parent.length && isAot(at(v, p.slice(0, -1)))) { const gp = at(want, p.slice(0, -2)); delete gp[p[p.length - 2]!]; }   // 数组表删空了就没有了
    } else if (r < 0.75 && target && typeof target === 'object') {
      if (isAot(target)) { text = tomlInsert(text, p, undefined, '{}'); target.push({}); }
      else if (Array.isArray(target)) { text = tomlInsert(text, p, undefined, '"新"'); target.push('新'); }
      else { const k = 'n' + n; text = tomlInsert(text, p, k, '[0]'); target[k] = [0]; }
    } else if (typeof target !== 'object') {
      const nv = typeof target === 'number' ? '7' : typeof target === 'boolean' ? 'false' : 'z "q"';
      text = tomlSet(text, p, nv);
      parent[last] = typeof target === 'number' ? 7 : typeof target === 'boolean' ? false : 'z "q"';
    } else continue;
    assert.deepEqual(val(tomlParse(text)), want, `${JSON.stringify(p)}\n${text}`);
  }
});
