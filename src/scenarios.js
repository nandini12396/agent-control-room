const baseCandidates = [
  candidate('task-contract', 'Task contract', 'TASK.md', 'brief', 420, 96, true, 'pinned task constraints', true),
  candidate('retry-handler', 'handleRetry()', 'src/worker/retry.ts', 'symbol', 760, 66, true, 'semantic match: retry handling'),
  candidate('legacy-backoff', 'LegacyBackoff', 'src/legacy/backoff.ts', 'symbol', 930, 71, false, 'strong lexical match, low topology confidence'),
  candidate('queue-types', 'QueueMessage', 'src/queue/types.ts', 'symbol', 510, 52, true, 'type dependency'),
  candidate('readme-example', 'Retry example', 'docs/migration.md', 'section', 680, 44, false, 'lexical match in documentation'),
];

const evidenceCandidates = [
  candidate('retry-caller', 'dispatchJob()', 'src/scheduler/dispatch.ts', 'symbol', 840, 88, true, 'promoted by failing stack frame'),
  candidate('lease-clock', 'LeaseClock.now()', 'src/leases/clock.ts', 'symbol', 620, 79, true, 'dependency of failing caller'),
  candidate('integration-test', 'retry preserves lease', 'test/retry.integration.test.ts', 'test', 720, 91, true, 'failing assertion'),
];

function candidate(id, label, path, kind, cost, value, relevant, reason, pinned = false) {
  return { id, label, path, kind, cost, value, relevant, reason, pinned };
}

function event(tool, title, input, output, options = {}) {
  return {
    tool,
    title,
    input,
    output,
    tokens: options.tokens ?? 440,
    durationMs: options.durationMs ?? 820,
    file: options.file,
    test: options.test,
    evidence: options.evidence ?? [],
    progress: options.progress ?? false,
    contradiction: options.contradiction ?? false,
    contradicts: options.contradicts ?? [],
    promote: options.promote ?? [],
    candidates: options.candidates ?? [],
    detail: options.detail ?? output,
  };
}

const opening = () => [
  event('model', 'Plan the investigation', 'Understand retry timeout bug', 'Hypothesis: timeout is lost between queue and worker.', { tokens: 620, progress: true, evidence: ['A falsifiable initial hypothesis'], candidates: baseCandidates }),
  event('search', 'Find retry entry points', 'retry timeout handleRetry', 'Found handleRetry(), LegacyBackoff, dispatchJob().', { tokens: 270, progress: true, evidence: ['3 candidate symbols'] }),
  event('read', 'Inspect retry handler', 'src/worker/retry.ts:handleRetry', 'Handler accepts delayMs and creates a queue message.', { file: 'src/worker/retry.ts', tokens: 510, progress: true, evidence: ['delayMs crosses worker boundary'] }),
  event('read', 'Inspect message shape', 'src/queue/types.ts:QueueMessage', 'QueueMessage stores runAt as an absolute timestamp.', { file: 'src/queue/types.ts', tokens: 390, progress: true, evidence: ['runAt is absolute'] }),
  event('test', 'Establish test baseline', 'node --test retry', '17 passing, 1 failing: retry preserves lease.', { tokens: 180, test: { passing: 17, total: 18 }, progress: true, evidence: ['baseline 17/18'], candidates: [evidenceCandidates[2]] }),
];

function healthyRecovery() {
  return [
    ...opening(),
    event('read', 'Follow the failing stack', 'src/scheduler/dispatch.ts:dispatchJob', 'dispatchJob recomputes runAt with wall-clock time.', { file: 'src/scheduler/dispatch.ts', progress: true, evidence: ['clock mismatch located'], candidates: evidenceCandidates.slice(0, 2), promote: ['retry-caller', 'lease-clock'] }),
    event('edit', 'Inject monotonic lease clock', 'edit src/scheduler/dispatch.ts', 'Use LeaseClock.now() instead of Date.now().', { file: 'src/scheduler/dispatch.ts', tokens: 460, progress: true }),
    event('test', 'Run focused integration test', 'node --test retry.integration', '18 passing, 0 failing.', { tokens: 220, test: { passing: 18, total: 18 }, progress: true, evidence: ['all focused tests pass'] }),
    event('test', 'Verify full suite', 'node --test', '126 passing, 0 failing.', { tokens: 310, test: { passing: 126, total: 126 }, progress: true, evidence: ['full suite passes'] }),
    event('model', 'Summarize verified change', 'Produce final answer', 'Fixed clock-domain mismatch and verified 126 tests.', { tokens: 480, progress: true }),
  ];
}

function searchLoop() {
  const repeated = Array.from({ length: 11 }, (_, index) => event(
    index % 3 === 2 ? 'read' : 'search',
    index % 3 === 2 ? 'Reopen the same handler' : 'Search retry paths again',
    index % 3 === 2 ? 'src/worker/retry.ts:handleRetry' : 'retry timeout handleRetry',
    index % 3 === 2 ? 'Handler accepts delayMs and creates a queue message.' : 'Found handleRetry(), LegacyBackoff, dispatchJob().',
    { file: index % 3 === 2 ? 'src/worker/retry.ts' : undefined, tokens: 610 + index * 20 },
  ));
  return [...opening(), ...repeated];
}

function badHypothesis() {
  return [
    ...opening(),
    event('read', 'Choose the attractive legacy implementation', 'src/legacy/backoff.ts:LegacyBackoff', 'LegacyBackoff multiplies the delay before enqueue.', { file: 'src/legacy/backoff.ts', tokens: 690 }),
    event('edit', 'Port legacy multiplier', 'edit src/worker/retry.ts', 'Applied LegacyBackoff multiplier to delayMs.', { file: 'src/worker/retry.ts', tokens: 580 }),
    event('test', 'Run focused test', 'node --test retry.integration', '17 passing, 1 failing: expected lease 3000, got 9000.', { tokens: 240, test: { passing: 17, total: 18 } }),
    event('read', 'Re-read legacy multiplier', 'src/legacy/backoff.ts:LegacyBackoff', 'LegacyBackoff multiplies the delay before enqueue.', { file: 'src/legacy/backoff.ts', tokens: 680 }),
    event('edit', 'Adjust multiplier boundary', 'edit src/worker/retry.ts', 'Moved multiplier after queue serialization.', { file: 'src/worker/retry.ts', tokens: 610 }),
    event('test', 'Retry the same focused test', 'node --test retry.integration', '17 passing, 1 failing: expected lease 3000, got 9000.', { tokens: 240, test: { passing: 17, total: 18 }, contradiction: true, contradicts: ['legacy-backoff'], promote: ['retry-caller', 'lease-clock', 'integration-test'], candidates: evidenceCandidates }),
    event('model', 'Defend the multiplier hypothesis', 'Explain repeated failure', 'The multiplier is still likely correct; perhaps serialization caches it.', { tokens: 840, contradiction: true }),
    event('edit', 'Try another multiplier variant', 'edit src/worker/retry.ts', 'Added explicit numeric conversion.', { file: 'src/worker/retry.ts', tokens: 620 }),
    event('test', 'Run unchanged failure again', 'node --test retry.integration', '17 passing, 1 failing: expected lease 3000, got 9000.', { tokens: 240, test: { passing: 17, total: 18 } }),
    event('read', 'Inspect the actual caller too late', 'src/scheduler/dispatch.ts:dispatchJob', 'dispatchJob recomputes runAt with wall-clock time.', { file: 'src/scheduler/dispatch.ts', progress: true, evidence: ['clock mismatch located'] }),
  ];
}

function editTestLoop() {
  const loop = [];
  for (let index = 0; index < 5; index += 1) {
    loop.push(event('edit', index % 2 ? 'Reapply the timeout patch' : 'Adjust the timeout patch', 'edit src/worker/retry.ts', index % 2 ? 'Restored delay conversion.' : 'Changed delay conversion.', { file: 'src/worker/retry.ts', tokens: 560 }));
    loop.push(event('test', 'Run the same failing test', 'node --test retry.integration', '17 passing, 1 failing: expected lease 3000, got 9000.', { tokens: 220, test: { passing: 17, total: 18 } }));
    if (index < 4) loop.push(event('revert', 'Undo the timeout patch', 'revert src/worker/retry.ts', 'Restored previous delay conversion.', { file: 'src/worker/retry.ts', tokens: 310 }));
  }
  return [...opening(), ...loop];
}

export const scenarios = {
  'healthy-recovery': {
    name: 'Healthy recovery',
    description: 'The agent gathers evidence, finds the clock mismatch, and verifies the fix.',
    events: healthyRecovery,
  },
  'search-loop': {
    name: 'Repeated search loop',
    description: 'Equivalent searches and reads burn tokens without adding evidence.',
    events: searchLoop,
  },
  'bad-hypothesis': {
    name: 'Persistent bad hypothesis',
    description: 'A plausible legacy implementation survives contradictory test evidence.',
    events: badHypothesis,
  },
  'edit-test-loop': {
    name: 'Edit / test churn',
    description: 'The same file is repeatedly edited, tested, and reverted.',
    events: editTestLoop,
  },
};

export function scenarioEvents(id) {
  const scenario = scenarios[id] || scenarios['bad-hypothesis'];
  return scenario.events().map((item, index) => ({ ...item, seq: index + 1 }));
}
