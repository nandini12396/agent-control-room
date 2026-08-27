const base = process.env.CONTROL_ROOM_URL || 'http://127.0.0.1:4318';
const runId = `external-${Date.now().toString(36)}`;

const events = [
  { tool: 'search', title: 'Find payment retry code', input: 'retry payment timeout', output: '3 matches', tokens: 281, progress: true, evidence: ['3 candidate symbols'] },
  { tool: 'read', title: 'Inspect retry handler', input: 'src/retry.ts', output: 'Uses absolute deadline', tokens: 492, file: 'src/retry.ts', progress: true },
  { tool: 'test', title: 'Run focused test', input: 'node --test retry', output: '8 passing, 1 failing', tokens: 173, test: { passing: 8, total: 9 }, evidence: ['baseline 8/9'] },
  { tool: 'test', title: 'Run unchanged test', input: 'node --test retry', output: '8 passing, 1 failing', tokens: 173, test: { passing: 8, total: 9 } },
];

console.log(`Streaming OTel-style events as run ${runId}`);
for (const [index, event] of events.entries()) {
  const response = await fetch(`${base}/api/v1/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, seq: index + 1, timestamp: new Date().toISOString(), ...event }),
  });
  const decision = await response.json();
  console.log(`#${index + 1}`, decision);
  await new Promise((resolve) => setTimeout(resolve, 500));
}
