import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSessionFacts, sessionActivity } from '../lib/codex.ts';

const started = {
  timestamp: '2026-10-16T08:47:05.252Z',
  type: 'event_msg',
  payload: { type: 'task_started' },
};

const approvalCall = {
  timestamp: '2026-10-16T08:47:15.776Z',
  type: 'response_item',
  payload: {
    type: 'custom_tool_call',
    id: 'ctc-1',
    call_id: 'call-1',
    status: 'completed',
    name: 'exec',
    input: '{"sandbox_permissions":"require_escalated","justification":"Confirm deletion"}',
  },
};

test('recognizes a generic exec call that is waiting for escalation approval', () => {
  const facts = parseSessionFacts([started, approvalCall]);
  assert.equal(facts.waitingSignal, true);
  assert.ok(facts.startedAt > facts.completedAt);
});

test('clears an escalation wait after its tool output arrives', () => {
  const output = {
    timestamp: new Date().toISOString(),
    type: 'response_item',
    payload: { type: 'custom_tool_call_output', call_id: 'call-1', output: [] },
  };
  const facts = parseSessionFacts([started, approvalCall, output]);
  assert.equal(facts.waitingSignal, false);
  assert.equal(facts.approvalResolvedSinceTaskStart, true);
});

test('ignores a stale app-server approval flag after the matching tool output', () => {
  const output = {
    timestamp: new Date().toISOString(),
    type: 'response_item',
    payload: { type: 'custom_tool_call_output', call_id: 'call-1', output: [] },
  };
  const dir = mkdtempSync(join(tmpdir(), 'agent-todo-codex-'));
  const path = join(dir, 'session.jsonl');
  try {
    writeFileSync(path, [started, approvalCall, output].map((event) => JSON.stringify(event)).join('\n'));
    const activity = sessionActivity({
      status: { type: 'active', activeFlags: ['waitingOnApproval'] },
      path,
    });
    assert.equal(activity.status, 'busy');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses app-server waitingOnApproval flags without waiting for the quiet fallback', () => {
  const activity = sessionActivity({
    status: { type: 'active', activeFlags: ['waitingOnApproval'] },
    path: '',
  });
  assert.equal(activity.status, 'waiting_approval');
});
