import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TodoStore } from './lib/db.ts';
import { fetchCodexSnapshot } from './lib/codex.ts';
import { DASHBOARD_HOST, DASHBOARD_PORT, DASHBOARD_URL } from './lib/config.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = resolve(root, 'assets/web');
const host = DASHBOARD_HOST;
const port = DASHBOARD_PORT;
const store = new TodoStore();

let codexCache: any = { ok: false, agents: [], quota: { available: false, remainingPercent: 0 }, updatedAt: null, error: '尚未同步' };
let codexRefresh: Promise<any> | null = null;

async function refreshCodex(forceMetadata = false) {
  if (!codexRefresh) {
    codexRefresh = fetchCodexSnapshot(forceMetadata).then((value) => (codexCache = value)).finally(() => { codexRefresh = null; });
  }
  return codexRefresh;
}

function json(res: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function errorResponse(res: ServerResponse, error: any) {
  const status = Number(error?.statusCode || (error instanceof SyntaxError ? 400 : 500));
  json(res, status, { ok: false, error: error instanceof Error ? error.message : String(error) });
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  const method = req.method || 'GET';
  const path = url.pathname;
  if (path === '/api/health' && method === 'GET') return json(res, 200, { ok: true, service: 'agent-todo', database: store.path });
  if (path === '/api/state' && method === 'GET') {
    const board = store.board();
    return json(res, 200, { ok: true, tasks: store.list(), categories: board.categories, statuses: board.statuses });
  }
  if (path === '/api/state' && method === 'PATCH') {
    const body = await readJson(req);
    store.syncBoard(body.statuses, body.categories);
    store.syncTodos(body.tasks);
    const board = store.pruneBoard(body.statuses, body.categories);
    const tasks = store.list();
    return json(res, 200, { ok: true, tasks, categories: board.categories, statuses: board.statuses });
  }
  if (path === '/api/board' && method === 'GET') return json(res, 200, { ok: true, ...store.board() });
  if (path === '/api/todos' && method === 'GET') {
    const filters = Object.fromEntries(url.searchParams.entries());
    return json(res, 200, { ok: true, todos: store.list(filters) });
  }
  if (path === '/api/todos' && method === 'POST') {
    return json(res, 201, { ok: true, todo: store.create(await readJson(req)) });
  }
  const todoMatch = path.match(/^\/api\/todos\/([^/]+)$/);
  if (todoMatch) {
    const code = decodeURIComponent(todoMatch[1]);
    if (method === 'GET') return json(res, 200, { ok: true, todo: store.get(code) });
    if (method === 'PUT' || method === 'PATCH') return json(res, 200, { ok: true, todo: store.update(code, await readJson(req), true) });
    if (method === 'DELETE') return json(res, 200, { ok: true, ...store.delete(code) });
  }
  if (path === '/api/codex/status' && method === 'GET') {
    if (!codexCache.updatedAt || Date.now() - Date.parse(codexCache.updatedAt) > 5_000) await refreshCodex();
    return json(res, 200, codexCache);
  }
  if (path === '/api/codex/refresh' && method === 'POST') return json(res, 200, await refreshCodex(true));
  return json(res, 404, { ok: false, error: 'API endpoint not found.' });
}

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.wasm': 'application/wasm',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

async function staticFile(res: ServerResponse, pathname: string) {
  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = resolve(webRoot, normalize(requested));
  if (filePath !== webRoot && !filePath.startsWith(`${webRoot}\\`) && !filePath.startsWith(`${webRoot}/`)) {
    return json(res, 403, { ok: false, error: 'Forbidden.' });
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  } catch { json(res, 404, { ok: false, error: 'Not found.' }); }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`);
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else await staticFile(res, url.pathname);
  } catch (error) { errorResponse(res, error); }
});

server.listen(port, host, () => {
  console.log(JSON.stringify({ ok: true, url: DASHBOARD_URL, database: store.path }));
  void refreshCodex();
});

const timer = setInterval(() => void refreshCodex(), 5_000);
timer.unref();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { clearInterval(timer); server.close(() => { store.close(); process.exit(0); }); });
}
