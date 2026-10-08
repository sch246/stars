// 实时查看器的服务端:监听宇宙文件,变化时通过 SSE 推给浏览器。零依赖。
// 视图的计算在浏览器里做(同一份 model.ts / view.ts,去掉类型后原样提供),
// 所以展开/收起不需要和服务端往返,CLI 与查看器永远是同一套逻辑。
import { existsSync, readFileSync, watch } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint } from './lint.ts';
import { type Store } from './store.ts';

const here = dirname(fileURLToPath(import.meta.url));
const viewerDir = resolve(here, '..', 'viewer');

/** 浏览器能直接 import 的共享模块(只有这两个,且都不依赖 Node)。 */
const SHARED = new Set(['model', 'view']);

function sharedModule(name: string): string {
  const ts = readFileSync(resolve(here, `${name}.ts`), 'utf8');
  return stripTypeScriptTypes(ts).replace(/from '\.\/(\w+)\.ts'/g, "from './$1.js'");
}

function snapshot(store: Store, baseDir: string): string {
  try {
    const u = store.load();
    return JSON.stringify({
      t: Date.now(),
      nodes: [...u.nodes.values()],
      edges: [...u.edges.values()],
      issues: lint(u, { baseDir }),
      log: store.readLog().slice(-60),
    });
  } catch (err) {
    return JSON.stringify({ t: Date.now(), error: (err as Error).message });
  }
}

export function startServer(store: Store, port: number, baseDir: string): void {
  const clients = new Set<ServerResponse>();
  process.removeAllListeners('warning'); // stripTypeScriptTypes 的实验性提示对用户是噪音

  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0]!;
    if (url === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`data: ${snapshot(store, baseDir)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    const mod = /^\/core\/(\w+)\.js$/.exec(url);
    if (mod && SHARED.has(mod[1]!)) {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-cache' });
      res.end(sharedModule(mod[1]!));
      return;
    }
    const files: Record<string, [string, string]> = {
      '/': ['index.html', 'text/html; charset=utf-8'],
      '/d3.js': ['d3.v7.min.js', 'text/javascript'],
    };
    const hit = files[url];
    if (hit && existsSync(resolve(viewerDir, hit[0]))) {
      res.writeHead(200, { 'content-type': hit[1], 'cache-control': 'no-cache' });
      res.end(readFileSync(resolve(viewerDir, hit[0])));
      return;
    }
    if (url === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }
    res.writeHead(404).end('not found');
  });

  // 监听目录而不是文件:原子保存(写临时文件再 rename)会让文件级监听失效
  let timer: NodeJS.Timeout | undefined;
  const target = basename(store.file);
  watch(dirname(store.file), (_event, name) => {
    if (name !== target && name !== basename(store.logFile)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const payload = `data: ${snapshot(store, baseDir)}\n\n`;
      for (const c of clients) c.write(payload);
    }, 40);
  });

  server.listen(port, () => {
    console.log(`宇宙查看器: http://localhost:${port}   (监听 ${store.file})`);
  });
}
