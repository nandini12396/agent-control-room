import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextBudgetManager } from '../src/context-manager.js';

const event = (seq, extra = {}) => ({ seq, tool: 'read', candidates: [], ...extra });
const candidates = [
  { id: 'task', label: 'Task', path: 'TASK.md', kind: 'brief', cost: 400, value: 90, relevant: true, pinned: true },
  { id: 'distractor', label: 'Legacy code', path: 'legacy.ts', kind: 'symbol', cost: 900, value: 80, relevant: false },
  { id: 'caller', label: 'Actual caller', path: 'caller.ts', kind: 'symbol', cost: 800, value: 45, relevant: true },
];

test('dynamic policy evicts contradicted context and promotes evidence', () => {
  const manager = new ContextBudgetManager({ budget: 1600, policy: 'dynamic' });
  const initial = manager.update(event(1), candidates);
  assert.ok(initial.workingSet.some((item) => item.id === 'distractor'));
  const updated = manager.update(event(2, { contradicts: ['distractor'], promote: ['caller'] }));
  assert.ok(!updated.workingSet.some((item) => item.id === 'distractor'));
  assert.ok(updated.workingSet.some((item) => item.id === 'caller'));
  assert.ok(updated.changes.some((change) => change.action === 'evict'));
});

test('allocation never exceeds its token budget', () => {
  for (const policy of ['dynamic', 'ranked', 'append']) {
    const manager = new ContextBudgetManager({ budget: 1600, policy });
    const result = manager.update(event(1), candidates);
    assert.ok(result.used <= 1600);
  }
});

test('whole-file context costs more than symbol slices', () => {
  const symbol = new ContextBudgetManager({ budget: 8000, granularity: 'symbol' }).update(event(1), candidates);
  const file = new ContextBudgetManager({ budget: 8000, granularity: 'file' }).update(event(1), candidates);
  assert.ok(file.used > symbol.used);
});
