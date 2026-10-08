// 实时查看器的服务端:监听宇宙文件,变化时通过 SSE 推给浏览器。零依赖。
import { existsSync, readFileSync, watch } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint } from './lint.ts';
import { evaluateView, listViews } from './view.ts';
import { type Store } from './store.ts';

const viewerDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'viewer');

function snapshot(store: Store, baseDir: string, viewName: string): string {
  try {
    const u = store.load();
    const { specs, errors } = listViews(u);
    const view = specs[viewName] ? viewName : Object.keys(specs)[0]!;
    return JSON.stringify({
      t: Date.now(),
      view,
      views: Object.keys(specs),
      viewErrors: Object.values(errors),
      scene: evaluateView(u, specs[view]!),
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
  const clients = new Map<ServerResponse, string>();

  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/events')) {
      const viewName = new URL(url, 'http://x').searchParams.get('view') ?? 'galaxy';
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`data: ${snapshot(store, baseDir, viewName)}\n\n`);
      clients.set(res, viewName);
      req.on('close', () => clients.delete(res));
      return;
    }
    const files: Record<string, [string, string]> = {
      '/': ['index.html', 'text/html; charset=utf-8'],
      '/d3.js': ['d3.v7.min.js', 'text/javascript'],
    };
    const hit = files[url];
    if (hit && existsSync(resolve(viewerDir, hit[0]))) {
      res.writeHead(200, { 'content-type': hit[1] });
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
      for (const [c, viewName] of clients) c.write(`data: ${snapshot(store, baseDir, viewName)}\n\n`);
    }, 40);
  });

  server.listen(port, () => {
    console.log(`宇宙查看器: http://localhost:${port}   (监听 ${store.file})`);
  });
}
