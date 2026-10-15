import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { openSync, closeSync, readFileSync, readSync, statSync } from 'node:fs';
import readline from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';

type Json = Record<string, any>;

class CodexRpc {
  child: ChildProcessWithoutNullStreams;
  nextId = 1;
  pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  stderr = '';

  constructor() {
    const command = process.env.CODEX_CLI_PATH || 'codex';
    this.child = spawn(command, ['-c', 'mcp_servers={}', '-s', 'read-only', '-a', 'never', 'app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    readline.createInterface({ input: this.child.stdout }).on('line', (line) => this.onLine(line));
    this.child.stderr.on('data', (chunk) => { this.stderr = `${this.stderr}${chunk}`.slice(-4000); });
    this.child.on('error', (error) => this.rejectAll(error));
    this.child.on('exit', (code) => this.rejectAll(new Error(`Codex app-server exited with code ${code}. ${this.stderr}`)));
  }

  onLine(line: string) {
    let message: Json;
    try { message = JSON.parse(line); } catch { return; }
    const id = Number(message.id);
    const item = this.pending.get(id);
    if (!item) return;
    clearTimeout(item.timer);
    this.pending.delete(id);
    if (message.error) item.reject(new Error(message.error.message || 'Codex RPC failed.'));
    else item.resolve(message.result);
  }

  rejectAll(error: Error) {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
  }

  request(method: string, params: Json = {}, timeoutMs = 10000): Promise<any> {
    const id = this.nextId++;
    this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex RPC ${method} timed out.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  notify(method: string, params: Json = {}) {
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'agent-todo', version: '0.1.0' } }, 20000);
    this.notify('initialized', {});
  }

  close() { if (!this.child.killed) this.child.kill(); }
}

function readTail(path: string, maxBytes = 8 * 1024 * 1024): Json[] {
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    const fd = openSync(path, 'r');
    try { readSync(fd, buffer, 0, buffer.length, start); } finally { closeSync(fd); }
    let text = buffer.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    return text.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch { return []; }
}

function readUnreadThreadIds() {
  const ids = new Set<string>();
  try {
    const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
    const state = JSON.parse(readFileSync(join(codexHome, '.codex-global-state.json'), 'utf8'));
    const readState = state?.['electron-thread-read-state-v1'];
    const identities = readState?.unreadByIdentity || {};
    for (const hosts of Object.values(identities) as Json[]) {
      for (const value of Object.values(hosts || {})) {
        if (Array.isArray(value)) value.forEach((id) => ids.add(String(id)));
      }
    }
    if (!readState?.legacyMigration?.cleared) {
      const legacyHosts = readState?.legacyMigration?.unreadThreadIdsByHostId || {};
      for (const value of Object.values(legacyHosts)) {
        if (Array.isArray(value)) value.forEach((id) => ids.add(String(id)));
      }
    }
  } catch {
    // Codex 桌面端未运行或尚未生成读状态时，未读集合保持为空。
  }
  return ids;
}

function sessionActivity(thread: Json) {
  const events = thread.path ? readTail(thread.path) : [];
  let startedAt = 0;
  let completedAt = 0;
  let lastActivityAt = 0;
  let waitingSignal = false;
  for (const event of events) {
    const timestamp = Date.parse(event.timestamp || '') || 0;
    lastActivityAt = Math.max(lastActivityAt, timestamp);
    const payload = event.payload || {};
    if (event.type === 'event_msg' && payload.type === 'task_started') startedAt = Math.max(startedAt, timestamp);
    if (event.type === 'event_msg' && payload.type === 'task_complete') completedAt = Math.max(completedAt, timestamp);
    if (event.type === 'response_item' && payload.type === 'custom_tool_call') {
      const name = String(payload.name || payload.tool_name || '工具调用').replace(/^functions\./, '');
      const status = payload.status === 'completed' ? 'done' : 'in_progress';
      if (/request_user_input|approval|confirm/i.test(name) && status !== 'done') waitingSignal = true;
    }
    if (event.type === 'event_msg' && /approval|request_user_input|elicitation/i.test(String(payload.type || ''))) waitingSignal = true;
  }
  const unfinished = startedAt > completedAt;
  const quietMs = Date.now() - lastActivityAt;
  let status = 'idle';
  if (unfinished && (waitingSignal || quietMs > 90_000)) status = 'waiting_approval';
  else if (unfinished) status = 'busy';
  return { status, lastActivityAt };
}

function quotaSnapshot(result: Json) {
  const buckets = result?.rateLimitsByLimitId || {};
  const snapshot = buckets.codex || result?.rateLimits || null;
  const primary = snapshot?.primary || null;
  const secondary = snapshot?.secondary || null;
  const chosen = secondary || primary;
  const usedPercent = Number(chosen?.usedPercent ?? 0);
  const remainingPercent = Math.max(0, Math.min(100, 100 - usedPercent));
  const duration = Number(chosen?.windowDurationMins || 0);
  const windowName = duration >= 10080 ? '周额度' : duration >= 300 ? `${Math.round(duration / 60)} 小时额度` : 'Coding plan 额度';
  return {
    available: Boolean(chosen),
    source: 'codex-app-server',
    limitId: snapshot?.limitId || 'codex',
    planType: snapshot?.planType || null,
    ordinaryUsageAllowed: result?.ordinaryUsageAllowed ?? null,
    remainingPercent,
    usedPercent,
    windowName,
    resetsAt: chosen?.resetsAt ? new Date(Number(chosen.resetsAt) * 1000).toISOString() : null,
    primary,
    secondary,
    resetCredits: result?.rateLimitResetCredits || null,
  };
}

function threadTitle(thread: Json) {
  return String(thread.name || thread.preview?.split('\n')[0] || '未命名 Codex 任务').trim();
}

function makeCodexAgent(threads: Json[], quota: Json, unreadThreadIds: Set<string>) {
  const tasks = threads.map((thread) => ({ thread, activity: sessionActivity(thread) }))
    .filter(({ thread, activity }) => activity.status !== 'idle' || unreadThreadIds.has(String(thread.id)))
    .sort((a, b) => {
      const weight = (status: string) => status === 'waiting_approval' ? 3 : status === 'busy' ? 2 : 1;
      return weight(b.activity.status) - weight(a.activity.status)
        || b.activity.lastActivityAt - a.activity.lastActivityAt
        || Number(b.thread.updatedAt || 0) - Number(a.thread.updatedAt || 0);
    });
  const hasWaiting = tasks.some(({ activity }) => activity.status === 'waiting_approval');
  const hasBusy = tasks.some(({ activity }) => activity.status === 'busy');
  const status = hasWaiting ? 'waiting_approval' : hasBusy ? 'busy' : 'idle';
  const statusMap: Record<string, Json> = {
    busy: { label: '忙碌', badge: 'text-rose-500 bg-rose-50 border border-rose-100', dot: 'bg-rose-500 animate-pulse' },
    waiting_approval: { label: '待确认', badge: 'text-orange-600 bg-orange-50 border border-orange-100', dot: 'bg-orange-500 animate-ping' },
    idle: { label: '空闲', badge: 'text-emerald-600 bg-emerald-50 border border-emerald-100', dot: 'bg-emerald-500' },
  };
  const visual = statusMap[status];
  const latestActivityAt = Math.max(0, ...tasks.map(({ activity }) => activity.lastActivityAt));
  const taskTitle = tasks.length === 0 ? '暂无当前任务' : tasks.length === 1 ? threadTitle(tasks[0].thread) : `${tasks.length} 个并行任务`;
  return {
    id: 'codex',
    threadId: tasks[0]?.thread?.id || null,
    name: 'Codex',
    role: tasks.length ? `${tasks.length} 个当前任务 · Codex` : '等待本地任务 · Codex',
    avatarLetter: 'C',
    avatarBg: 'bg-[#0f172a] text-white',
    status,
    statusLabel: visual.label,
    statusBadgeClass: visual.badge,
    dotColor: visual.dot,
    task: taskTitle,
    timeEst: latestActivityAt ? new Date(latestActivityAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '',
    progress: status === 'busy' ? 68 : 0,
    pendingAction: status === 'waiting_approval' ? '请回到 Codex 处理输入或审批' : null,
    codingPlanName: `Coding plan ${quota.windowName || '额度'}`,
    codingPlanRemainingPct: quota.remainingPercent ?? 0,
    codingPlanRemainingStr: `剩余 ${Math.round(quota.remainingPercent ?? 0)}%`,
    codingPlanResetCycle: quota.resetsAt ? `重置：${new Date(quota.resetsAt).toLocaleString('zh-CN')}` : '重置时间不可用',
    quotaUsed: quota.usedPercent ?? 0,
    quotaTotal: 100,
    quotaRemaining: `${Math.round(quota.remainingPercent ?? 0)}%`,
    quotaPct: quota.remainingPercent ?? 0,
    isLoadingQuota: false,
    lastUpdated: '刚刚',
    agentTasks: tasks.map(({ thread, activity }, index) => {
      const waiting = activity.status === 'waiting_approval';
      const busy = activity.status === 'busy';
      return {
        id: String(thread.id || `codex-task-${index + 1}`),
        threadId: thread.id,
        num: `任务${index + 1}`,
        title: threadTitle(thread),
        status: waiting ? 'waiting_approval' : busy ? 'in_progress' : 'done',
        statusLabel: waiting ? '待用户确认' : busy ? '进行中' : '已完成未读',
      };
    }),
    cwd: tasks[0]?.thread?.cwd || null,
    updatedAt: latestActivityAt ? new Date(latestActivityAt).toISOString() : null,
  };
}

export async function fetchCodexSnapshot() {
  const rpc = new CodexRpc();
  try {
    await rpc.initialize();
    const [limits, threads] = await Promise.all([
      rpc.request('account/rateLimits/read', {}, 8000),
      rpc.request('thread/list', { limit: 100, sortKey: 'updated_at', sortDirection: 'desc' }, 10000),
    ]);
    const quota = quotaSnapshot(limits);
    const agent = makeCodexAgent(threads?.data || [], quota, readUnreadThreadIds());
    return { ok: true, source: 'codex-app-server+local-session-events+desktop-read-state', quota, agents: [agent], updatedAt: new Date().toISOString(), error: null };
  } catch (error) {
    return { ok: false, source: 'unavailable', quota: { available: false, remainingPercent: 0 }, agents: [], updatedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) };
  } finally {
    rpc.close();
  }
}
