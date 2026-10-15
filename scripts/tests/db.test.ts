import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TodoStore, ConflictError } from '../lib/db.ts';

test('allocates stable codes and enforces optimistic versions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-todo-'));
  const store = new TodoStore(join(directory, 'test.sqlite'));
  try {
    const first = store.create({ title: 'First', dueDate: '2026-10-15' });
    assert.equal(first.code, '0001');
    const updated = store.update(first.code, { ...first, title: 'Updated', expectedVersion: first.version });
    assert.equal(updated.version, 2);
    assert.throws(() => store.update(first.code, { ...first, title: 'Stale', expectedVersion: 1 }), ConflictError);
    store.delete(first.code);
    const second = store.create({ title: 'Second', dueDate: '2026-10-16' });
    assert.equal(second.code, '0002');
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('defaults a missing due date to the current local date', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-todo-date-'));
  const store = new TodoStore(join(directory, 'test.sqlite'));
  const localDate = () => {
    const date = new Date();
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  };
  try {
    const before = localDate();
    const todo = store.create({ title: 'No explicit date' });
    const after = localDate();
    assert.ok([before, after].includes(todo.dueDate));
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
