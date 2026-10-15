import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TodoStore, normalizeCode } from './lib/db.ts';
import { DASHBOARD_PORT, DASHBOARD_URL } from './lib/config.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const command = args.shift() || 'dashboard';
const formatIndex = args.indexOf('--format');
const format = formatIndex >= 0 ? args[formatIndex + 1] : 'json';
if (formatIndex >= 0) args.splice(formatIndex, 2);

function option(name: string) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
}

function inputFile() {
  const path = option('--input');
  if (!path) throw new Error('--input PATH is required.');
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

function print(value: any) {
  if (format === 'text') {
    if (Array.isArray(value)) {
      for (const item of value) console.log(`【${item.code}】${item.title} · ${item.status} · ${item.dueDate || '未排期'}`);
    } else if (value?.code) {
      console.log(`【${value.code}】${value.title}`);
      console.log(`状态: ${value.status}  优先级: ${value.priority}  排期: ${value.dueDate || '未排期'}`);
      if (value.projectPath) console.log(`项目: ${value.projectPath}`);
      if (value.description) console.log(value.description);
    } else console.log(JSON.stringify(value, null, 2));
  } else console.log(JSON.stringify(value, null, 2));
}

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function health() {
  try {
    const response = await fetch(`${DASHBOARD_URL}api/health`);
    const body = await response.json();
    return response.ok && body?.ok === true && body?.service === 'agent-todo';
  } catch { return false; }
}

function openDashboard() {
  if (process.platform === 'win32') spawn('rundll32', ['url.dll,FileProtocolHandler', DASHBOARD_URL], { detached: true, windowsHide: true }).unref();
  else if (process.platform === 'darwin') spawn('open', [DASHBOARD_URL], { detached: true }).unref();
  else spawn('xdg-open', [DASHBOARD_URL], { detached: true }).unref();
}

async function ensureDashboard(openWhenRunning = false, noOpen = false) {
  let started = false;
  if (!(await health())) {
    const child = spawn(process.execPath, [resolve(root, 'scripts/server.ts')], {
      detached: true,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    child.unref();
    for (let attempt = 0; attempt < 50 && !(await health()); attempt++) await sleep(100);
    if (!(await health())) throw new Error(`Agent Todo server did not start on port ${DASHBOARD_PORT}. Check whether the port is available.`);
    started = true;
  }
  if (!noOpen && (started || openWhenRunning)) openDashboard();
  return { ok: true, url: DASHBOARD_URL, started };
}

async function dashboard() {
  const noOpen = args.includes('--no-open');
  print(await ensureDashboard(true, noOpen));
}

async function main() {
  if (command === 'dashboard' || command === 'open' || command === 'serve') return dashboard();
  await ensureDashboard(false, false);
  const store = new TodoStore();
  try {
    if (command === 'board') return print(store.board());
    if (command === 'list') return print(store.list({ area: option('--area'), status: option('--status'), tag: option('--tag'), query: option('--query') }));
    if (command === 'get') return print(store.get(normalizeCode(args[0])));
    if (command === 'create') return print(store.create(inputFile()));
    if (command === 'update') return print(store.update(normalizeCode(args[0]), inputFile(), true));
    if (command === 'complete') return print(store.complete(normalizeCode(args[0])));
    if (command === 'delete') return print(store.delete(normalizeCode(args[0])));
    throw new Error(`Unknown command: ${command}`);
  } finally { store.close(); }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
