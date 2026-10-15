import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const DEFAULT_DB_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../data/agent-todo.sqlite',
);

const DEFAULT_STATUSES = [
  { id: 'todo', title: '待处理', dotColor: 'bg-slate-400', position: 0, required: true, kind: 'todo' },
  { id: 'in_progress', title: '进行中', dotColor: 'bg-blue-500', position: 1, required: true, kind: 'active' },
  { id: 'review', title: '待验收', dotColor: 'bg-amber-400', position: 2, required: false, kind: 'review' },
  { id: 'done', title: '已完成', dotColor: 'bg-emerald-500', position: 3, required: true, kind: 'complete' },
];

const DEFAULT_CATEGORIES = [
  { id: 'work', name: '工作 (Work)', color: '#f97316', custom: false },
  { id: 'personal', name: '个人 (Personal)', color: '#10b981', custom: false },
];

export class ConflictError extends Error {
  statusCode = 409;
}

export class NotFoundError extends Error {
  statusCode = 404;
}

export function normalizeCode(value: unknown): string {
  const digits = String(value ?? '').trim().replace(/^#/, '');
  if (!/^\d{1,4}$/.test(digits)) throw new Error(`Invalid todo code: ${value}`);
  return digits.padStart(4, '0');
}

function nowIso(): string {
  return new Date().toISOString();
}

function todayLocalDate(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function cleanTags(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.map((tag) => String(tag).replace(/^#/, '').trim()).filter(Boolean))].slice(0, 12);
}

function rowToTodo(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    code: String(row.code),
    title: String(row.title),
    description: String(row.description ?? ''),
    content: String(row.description ?? ''),
    status: String(row.status_id),
    priority: String(row.priority),
    dueDate: row.due_date ? String(row.due_date) : '',
    dueTime: row.due_time ? String(row.due_time) : '',
    projectPath: row.project_path ? String(row.project_path) : '',
    project: row.project_path ? String(row.project_path) : '',
    categoryId: row.category_id ? String(row.category_id) : null,
    area: String(row.area ?? 'workspace'),
    tags: parseJson<string[]>(row.tags_json, []),
    version: Number(row.version),
    completedDate: row.completed_at ? String(row.completed_at).slice(0, 10) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    resultSummary: row.result_summary ? String(row.result_summary) : null,
    artifacts: parseJson<unknown[]>(row.artifacts_json, []),
    handledAt: row.handled_at ? String(row.handled_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function normalizeTodoInput(input: Record<string, unknown>) {
  const status = String(input.status ?? input.statusId ?? 'todo');
  const title = String(input.title ?? '').trim();
  if (!title) throw new Error('Todo title is required.');
  const priority = String(input.priority ?? 'P1').toUpperCase();
  if (!['P0', 'P1', 'P2', 'P3'].includes(priority)) throw new Error(`Invalid priority: ${priority}`);
  const area = String(input.area ?? 'workspace');
  if (!['workspace', 'personal'].includes(area)) throw new Error(`Invalid area: ${area}`);
  return {
    title,
    description: String(input.description ?? input.content ?? ''),
    status,
    priority,
    dueDate: String(input.dueDate ?? input.date ?? '').trim() || todayLocalDate(),
    dueTime: String(input.dueTime ?? '').trim() || null,
    projectPath: String(input.projectPath ?? input.project ?? '').trim() || null,
    categoryId: input.categoryId === null ? null : String(input.categoryId ?? (area === 'personal' ? 'personal' : 'work')),
    area,
    tags: cleanTags(input.tags),
    resultSummary: input.resultSummary == null ? null : String(input.resultSummary),
    artifacts: Array.isArray(input.artifacts) ? input.artifacts : [],
    handledAt: input.handledAt == null ? null : String(input.handledAt),
  };
}

export class TodoStore {
  db: DatabaseSync;
  path: string;

  constructor(path = process.env.AGENT_TODO_DB || DEFAULT_DB_PATH) {
    this.path = resolve(path);
    mkdirSync(dirname(this.path), { recursive: true });
    this.db = new DatabaseSync(this.path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS statuses (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        dot_color TEXT NOT NULL,
        position INTEGER NOT NULL,
        required INTEGER NOT NULL DEFAULT 0,
        kind TEXT NOT NULL DEFAULT 'custom'
      );
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        custom INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status_id TEXT NOT NULL REFERENCES statuses(id),
        priority TEXT NOT NULL DEFAULT 'P1',
        due_date TEXT,
        due_time TEXT,
        project_path TEXT,
        category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
        area TEXT NOT NULL DEFAULT 'workspace',
        tags_json TEXT NOT NULL DEFAULT '[]',
        version INTEGER NOT NULL DEFAULT 1,
        completed_at TEXT,
        result_summary TEXT,
        artifacts_json TEXT NOT NULL DEFAULT '[]',
        handled_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status_id);
      CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);
      CREATE INDEX IF NOT EXISTS idx_todos_updated ON todos(updated_at DESC);
    `);
    const insertStatus = this.db.prepare(`INSERT OR IGNORE INTO statuses
      (id,title,dot_color,position,required,kind) VALUES (?,?,?,?,?,?)`);
    for (const item of DEFAULT_STATUSES) {
      insertStatus.run(item.id, item.title, item.dotColor, item.position, item.required ? 1 : 0, item.kind);
    }
    const insertCategory = this.db.prepare(`INSERT OR IGNORE INTO categories
      (id,name,color,custom) VALUES (?,?,?,?)`);
    for (const item of DEFAULT_CATEGORIES) {
      insertCategory.run(item.id, item.name, item.color, item.custom ? 1 : 0);
    }
    const maxRow = this.db.prepare('SELECT MAX(CAST(code AS INTEGER)) AS max_code FROM todos').get() as any;
    const initialNext = String(Number(maxRow?.max_code ?? 0) + 1);
    this.db.prepare("INSERT OR IGNORE INTO meta (key,value) VALUES ('next_code',?)").run(initialNext);
  }

  close() { this.db.close(); }

  board() {
    const statuses = this.db.prepare('SELECT * FROM statuses ORDER BY position, id').all().map((row: any) => ({
      id: row.id,
      title: row.title,
      dotColor: row.dot_color,
      isSystem: Boolean(row.required),
      required: Boolean(row.required),
      kind: row.kind,
    }));
    const categories = this.db.prepare('SELECT * FROM categories ORDER BY custom, name').all().map((row: any) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      custom: Boolean(row.custom),
    }));
    return { statuses, categories };
  }

  list(filters: Record<string, unknown> = {}) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.area) { where.push('area = ?'); params.push(String(filters.area)); }
    if (filters.status) { where.push('status_id = ?'); params.push(String(filters.status)); }
    if (filters.query) {
      where.push('(title LIKE ? OR description LIKE ? OR project_path LIKE ? OR code LIKE ?)');
      const term = `%${String(filters.query)}%`;
      params.push(term, term, term, term);
    }
    if (filters.tag) { where.push("EXISTS (SELECT 1 FROM json_each(todos.tags_json) WHERE value = ?)"); params.push(String(filters.tag).replace(/^#/, '')); }
    const sql = `SELECT * FROM todos ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, due_date IS NULL, due_date, updated_at DESC`;
    return this.db.prepare(sql).all(...params).map((row: any) => rowToTodo(row));
  }

  get(code: unknown) {
    const normalized = normalizeCode(code);
    const row = this.db.prepare('SELECT * FROM todos WHERE code = ?').get(normalized) as any;
    if (!row) throw new NotFoundError(`Todo ${normalized} does not exist.`);
    return rowToTodo(row);
  }

  getById(id: string) {
    const row = this.db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as any;
    if (!row) throw new NotFoundError(`Todo id ${id} does not exist.`);
    return rowToTodo(row);
  }

  nextCode(): string {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare("SELECT value FROM meta WHERE key='next_code'").get() as any;
      const next = Number(row?.value ?? 1);
      if (next > 9999) throw new Error('Todo code space is exhausted (0001-9999).');
      this.db.prepare("UPDATE meta SET value=? WHERE key='next_code'").run(String(next + 1));
      this.db.exec('COMMIT');
      return String(next).padStart(4, '0');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  create(input: Record<string, unknown>) {
    const value = normalizeTodoInput(input);
    this.ensureStatus(value.status);
    this.ensureCategory(value.categoryId);
    const code = input.code ? normalizeCode(input.code) : this.nextCode();
    if (input.code) {
      const next = Number(code) + 1;
      const current = Number((this.db.prepare("SELECT value FROM meta WHERE key='next_code'").get() as any)?.value ?? 1);
      if (next > current) this.db.prepare("UPDATE meta SET value=? WHERE key='next_code'").run(String(next));
    }
    const id = String(input.id ?? randomUUID());
    const now = nowIso();
    const completedAt = value.status === 'done' ? now : null;
    this.db.prepare(`INSERT INTO todos
      (id,code,title,description,status_id,priority,due_date,due_time,project_path,category_id,area,tags_json,version,completed_at,result_summary,artifacts_json,handled_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?)`).run(
        id, code, value.title, value.description, value.status, value.priority, value.dueDate,
        value.dueTime, value.projectPath, value.categoryId, value.area, JSON.stringify(value.tags),
        completedAt, value.resultSummary, JSON.stringify(value.artifacts), value.handledAt, now, now,
      );
    return this.get(code);
  }

  update(code: unknown, input: Record<string, unknown>, requireVersion = true) {
    const current = this.get(code);
    const expectedVersion = input.expectedVersion ?? input.version;
    if (requireVersion && expectedVersion == null) throw new ConflictError('expectedVersion is required.');
    if (expectedVersion != null && Number(expectedVersion) !== current.version) {
      throw new ConflictError(`Todo ${current.code} changed since it was read. Expected version ${expectedVersion}, current version ${current.version}.`);
    }
    const merged = normalizeTodoInput({ ...current, ...input });
    this.ensureStatus(merged.status);
    this.ensureCategory(merged.categoryId);
    const now = nowIso();
    const completedAt = merged.status === 'done' ? (current.completedAt ?? now) : null;
    const result = this.db.prepare(`UPDATE todos SET
      title=?,description=?,status_id=?,priority=?,due_date=?,due_time=?,project_path=?,category_id=?,area=?,tags_json=?,
      version=version+1,completed_at=?,result_summary=?,artifacts_json=?,handled_at=?,updated_at=?
      WHERE code=? AND version=?`).run(
        merged.title, merged.description, merged.status, merged.priority, merged.dueDate, merged.dueTime,
        merged.projectPath, merged.categoryId, merged.area, JSON.stringify(merged.tags), completedAt,
        merged.resultSummary, JSON.stringify(merged.artifacts), merged.handledAt, now, current.code, current.version,
      );
    if (Number(result.changes) !== 1) throw new ConflictError(`Todo ${current.code} changed during update.`);
    return this.get(current.code);
  }

  delete(code: unknown) {
    const normalized = normalizeCode(code);
    const result = this.db.prepare('DELETE FROM todos WHERE code = ?').run(normalized);
    if (Number(result.changes) !== 1) throw new NotFoundError(`Todo ${normalized} does not exist.`);
    return { deleted: true, code: normalized };
  }

  complete(code: unknown) {
    const current = this.get(code);
    const completeStatus = (this.db.prepare("SELECT id FROM statuses WHERE kind='complete' ORDER BY position LIMIT 1").get() as any)?.id;
    if (!completeStatus) throw new Error('The board has no completion status.');
    return this.update(current.code, { ...current, status: completeStatus, expectedVersion: current.version }, true);
  }

  syncBoard(statuses: unknown, categories: unknown) {
    if (Array.isArray(categories)) {
      const upsert = this.db.prepare(`INSERT INTO categories (id,name,color,custom) VALUES (?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color,custom=excluded.custom`);
      for (const item of categories as any[]) {
        if (!item?.id || !item?.name) continue;
        upsert.run(String(item.id), String(item.name), String(item.color || '#64748b'), item.custom ? 1 : 0);
      }
    }
    if (Array.isArray(statuses)) {
      const upsert = this.db.prepare(`INSERT INTO statuses (id,title,dot_color,position,required,kind) VALUES (?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title,dot_color=excluded.dot_color,position=excluded.position`);
      for (const [position, item] of (statuses as any[]).entries()) {
        if (!item?.id || !item?.title) continue;
        const existing = this.db.prepare('SELECT required,kind FROM statuses WHERE id=?').get(String(item.id)) as any;
        upsert.run(String(item.id), String(item.title), String(item.dotColor || 'bg-slate-400'), position,
          existing?.required ?? (item.required ? 1 : 0), existing?.kind ?? String(item.kind || 'custom'));
      }
    }
    return this.board();
  }

  pruneBoard(statuses: unknown, categories: unknown) {
    if (Array.isArray(statuses)) {
      const keep = new Set((statuses as any[]).map((item) => String(item?.id || '')).filter(Boolean));
      const custom = this.db.prepare('SELECT id FROM statuses WHERE required=0').all() as any[];
      for (const row of custom) {
        if (keep.has(String(row.id))) continue;
        const used = this.db.prepare('SELECT 1 FROM todos WHERE status_id=? LIMIT 1').get(String(row.id));
        if (!used) this.db.prepare('DELETE FROM statuses WHERE id=? AND required=0').run(String(row.id));
      }
    }
    if (Array.isArray(categories)) {
      const keep = new Set((categories as any[]).map((item) => String(item?.id || '')).filter(Boolean));
      const custom = this.db.prepare('SELECT id FROM categories WHERE custom=1').all() as any[];
      for (const row of custom) {
        if (!keep.has(String(row.id))) this.db.prepare('DELETE FROM categories WHERE id=? AND custom=1').run(String(row.id));
      }
    }
    return this.board();
  }

  syncTodos(items: unknown) {
    if (!Array.isArray(items)) return this.list();
    for (const item of items as any[]) {
      try {
        const rawCode = item.code ? normalizeCode(item.code) : null;
        if (rawCode) {
          const existing = this.db.prepare('SELECT code,version FROM todos WHERE code=?').get(rawCode) as any;
          if (existing) this.update(rawCode, { ...item, expectedVersion: existing.version }, true);
          else this.create({ ...item, code: rawCode });
        } else {
          this.create(item);
        }
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
      }
    }
    return this.list();
  }

  ensureStatus(id: string) {
    if (!this.db.prepare('SELECT 1 FROM statuses WHERE id=?').get(id)) throw new Error(`Unknown status: ${id}`);
  }

  ensureCategory(id: string | null) {
    if (id && !this.db.prepare('SELECT 1 FROM categories WHERE id=?').get(id)) throw new Error(`Unknown category: ${id}`);
  }
}
