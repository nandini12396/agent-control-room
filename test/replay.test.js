import test from 'node:test';
import assert from 'node:assert/strict';
import { replayScenario } from '../src/run.js';

test('counterfactual replay reports waste avoided on failure trajectories', () => {
  for (const scenario of ['search-loop', 'bad-hypothesis', 'edit-test-loop']) {
    const result = replayScenario({ scenario });
    assert.equal(result.supervised.outcome, 'circuit opened');
    assert.equal(result.unrestrained.outcome, 'ran to completion');
    assert.ok(result.savings.calls > 0);
    assert.ok(result.savings.tokens > 0);
  }
});

test('healthy recovery has no false positive savings', () => {
  const result = replayScenario({ scenario: 'healthy-recovery' });
  assert.equal(result.supervised.outcome, 'ran to completion');
  assert.equal(result.savings.tokens, 0);
});
