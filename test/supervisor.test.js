import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightSupervisor } from '../src/supervisor.js';
import { scenarioEvents } from '../src/scenarios.js';

function evaluate(scenario, mode = 'hybrid') {
  const supervisor = new FlightSupervisor({ mode });
  return scenarioEvents(scenario).map((event) => supervisor.observe(event));
}

test('healthy trajectory is never terminated', () => {
  const results = evaluate('healthy-recovery');
  assert.equal(results.at(-1).decision, 'continue');
  assert.ok(results.every((result) => result.decision !== 'terminate'));
});

test('repeated searches eventually open the circuit', () => {
  const results = evaluate('search-loop');
  const termination = results.findIndex((result) => result.decision === 'terminate');
  assert.ok(termination >= 8);
  assert.ok(results[termination].signals.repeatRatio > 0);
  assert.ok(results[termination].signals.tokensSinceProgress > 0);
});

test('supervisor intervenes before it terminates a bad hypothesis', () => {
  const decisions = evaluate('bad-hypothesis').map((result) => result.decision);
  assert.ok(decisions.indexOf('intervene') >= 0);
  assert.ok(decisions.indexOf('terminate') > decisions.indexOf('intervene'));
});

test('all supervisor modes produce bounded deterministic scores', () => {
  for (const mode of ['heuristic', 'judge', 'hybrid']) {
    const first = evaluate('edit-test-loop', mode).map((result) => result.score);
    const second = evaluate('edit-test-loop', mode).map((result) => result.score);
    assert.deepEqual(first, second);
    assert.ok(first.every((score) => score >= 0 && score <= 100));
  }
});
